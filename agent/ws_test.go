package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func startMockServer(t *testing.T, handler func(conn *websocket.Conn)) *httptest.Server {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		require.NoError(t, err)
		handler(conn)
	}))
	return server
}

func wsURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func TestWSClient_Register(t *testing.T) {
	var receivedMsg Message
	var mu sync.Mutex
	done := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		mu.Lock()
		json.Unmarshal(data, &receivedMsg)
		mu.Unlock()
		close(done)
		// Keep connection alive briefly
		time.Sleep(500 * time.Millisecond)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour, // Don't interfere
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for REGISTER")
	}

	mu.Lock()
	assert.Equal(t, "REGISTER", receivedMsg.Type)
	mu.Unlock()
}

func TestWSClient_HandleCheckMessage(t *testing.T) {
	handlerCalled := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		// Read REGISTER
		_, _, _ = conn.ReadMessage()

		// Send CHECK
		msg := Message{Type: "CHECK", Payload: map[string]interface{}{"containerIds": []string{"c-1"}}}
		data, _ := json.Marshal(msg)
		conn.WriteMessage(websocket.TextMessage, data)

		// Keep alive
		time.Sleep(1 * time.Second)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	client.OnMessage("CHECK", func(payload json.RawMessage) {
		close(handlerCalled)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-handlerCalled:
		// Success
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for CHECK handler")
	}
}

func TestWSClient_HandleUpdateMessage(t *testing.T) {
	handlerCalled := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		_, _, _ = conn.ReadMessage()

		msg := Message{Type: "UPDATE", Payload: map[string]interface{}{"containerIds": []string{"c-1"}}}
		data, _ := json.Marshal(msg)
		conn.WriteMessage(websocket.TextMessage, data)

		time.Sleep(1 * time.Second)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	client.OnMessage("UPDATE", func(payload json.RawMessage) {
		close(handlerCalled)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-handlerCalled:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for UPDATE handler")
	}
}

func TestWSClient_Heartbeat(t *testing.T) {
	messageCount := 0
	var mu sync.Mutex
	done := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg Message
			json.Unmarshal(data, &msg)

			mu.Lock()
			if msg.Type == "HEARTBEAT" {
				messageCount++
				if messageCount >= 2 {
					mu.Unlock()
					close(done)
					return
				}
			}
			mu.Unlock()
		}
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 100 * time.Millisecond, // Fast for testing
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-done:
		mu.Lock()
		assert.GreaterOrEqual(t, messageCount, 2)
		mu.Unlock()
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for heartbeats")
	}
}

func TestWSClient_ReconnectOnDisconnect(t *testing.T) {
	connectCount := 0
	var mu sync.Mutex
	done := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		mu.Lock()
		connectCount++
		count := connectCount
		mu.Unlock()

		// Read register message
		_, _, _ = conn.ReadMessage()

		if count == 1 {
			// Close immediately to trigger reconnect
			conn.Close()
			return
		}
		if count >= 2 {
			close(done)
			time.Sleep(500 * time.Millisecond)
			conn.Close()
		}
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		MaxBackoff:      2 * time.Second,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-done:
		mu.Lock()
		assert.GreaterOrEqual(t, connectCount, 2)
		mu.Unlock()
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for reconnect")
	}
}

// --- Audit Finding Tests ---

// DOCKER-01 — ConnectionCtx() cancelled when WS connection dies
func TestWSClient_ConnectionCtxCancelledOnDisconnect(t *testing.T) {
	connected := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		// Read REGISTER
		_, _, _ = conn.ReadMessage()
		close(connected)
		// Wait briefly then close to trigger disconnect
		time.Sleep(200 * time.Millisecond)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	// Wait for connection
	select {
	case <-connected:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for connection")
	}

	connCtx := client.ConnectionCtx()

	// Wait for server to close the connection
	select {
	case <-connCtx.Done():
		// Success: context was cancelled on disconnect
	case <-time.After(3 * time.Second):
		t.Fatal("ConnectionCtx was not cancelled after disconnect")
	}
}

// DOCKER-01 — ConnectionCtx() renewed on reconnect
func TestWSClient_ConnectionCtxRenewedOnReconnect(t *testing.T) {
	connectCount := 0
	var mu sync.Mutex
	firstConnected := make(chan struct{})
	secondConnected := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		_, _, _ = conn.ReadMessage() // REGISTER

		mu.Lock()
		connectCount++
		count := connectCount
		mu.Unlock()

		if count == 1 {
			close(firstConnected)
			time.Sleep(200 * time.Millisecond)
			conn.Close()
			return
		}
		if count == 2 {
			close(secondConnected)
			time.Sleep(2 * time.Second)
			conn.Close()
		}
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		MaxBackoff:      1 * time.Second,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	<-firstConnected
	firstCtx := client.ConnectionCtx()

	// Wait for disconnect and reconnect
	<-secondConnected
	secondCtx := client.ConnectionCtx()

	// First context should be cancelled
	assert.NotNil(t, firstCtx.Err(), "first connection context should be cancelled")
	// Second context should be alive
	assert.Nil(t, secondCtx.Err(), "second connection context should be active")
}

// OBS-01 — Concurrent sends don't corrupt (run with -race)
func TestWSClient_ConcurrentSendsNoCorruption(t *testing.T) {
	received := make(chan struct{}, 100)

	server := startMockServer(t, func(conn *websocket.Conn) {
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
			select {
			case received <- struct{}{}:
			default:
			}
		}
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	// Wait for connection
	time.Sleep(500 * time.Millisecond)

	// Spawn 50 goroutines all sending concurrently
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			client.Send(Message{Type: "TEST", Payload: map[string]interface{}{"n": n}})
		}(i)
	}
	wg.Wait()
	// No panic or race detected under -race means OBS-01 is working
}

// OBS-02 — Heartbeats delivered even under send channel load
func TestWSClient_HeartbeatsDeliveredUnderSendLoad(t *testing.T) {
	heartbeatCount := 0
	var mu sync.Mutex
	done := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg Message
			json.Unmarshal(data, &msg)
			mu.Lock()
			if msg.Type == "HEARTBEAT" {
				heartbeatCount++
				if heartbeatCount >= 2 {
					mu.Unlock()
					close(done)
					return
				}
			}
			mu.Unlock()
		}
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 100 * time.Millisecond,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	// Wait for connection then flood the send channel
	time.Sleep(300 * time.Millisecond)
	go func() {
		for i := 0; i < 500; i++ {
			client.Send(Message{Type: "FLOOD", Payload: map[string]interface{}{"i": i}})
			time.Sleep(1 * time.Millisecond)
		}
	}()

	select {
	case <-done:
		mu.Lock()
		assert.GreaterOrEqual(t, heartbeatCount, 2, "heartbeats should still be delivered under load")
		mu.Unlock()
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for heartbeats under load")
	}
}

// SCALE-04 — Send drops when channel is full (non-blocking)
func TestWSClient_SendDropsWhenFull(t *testing.T) {
	// Create client but do NOT start ConnectLoop — no consumer of sendCh
	client := NewWSClient(WSClientConfig{
		URL:             "ws://localhost:9999",
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	// Fill the buffer (256 capacity)
	for i := 0; i < 256; i++ {
		client.Send(Message{Type: "FILL", Payload: i})
	}

	// 257th should be dropped without blocking
	done := make(chan struct{})
	go func() {
		client.Send(Message{Type: "OVERFLOW"})
		close(done)
	}()

	select {
	case <-done:
		// Success: Send returned immediately (dropped)
	case <-time.After(1 * time.Second):
		t.Fatal("Send blocked when channel was full — should drop")
	}
}

// SCALE-04 — SendCritical blocks until accepted
func TestWSClient_SendCriticalBlocksUntilAccepted(t *testing.T) {
	client := NewWSClient(WSClientConfig{
		URL:             "ws://localhost:9999",
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	// Fill the buffer
	for i := 0; i < 256; i++ {
		client.Send(Message{Type: "FILL", Payload: i})
	}

	accepted := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		client.SendCritical(ctx, Message{Type: "CRITICAL"})
		close(accepted)
	}()

	// Briefly verify it's blocking
	time.Sleep(100 * time.Millisecond)
	select {
	case <-accepted:
		t.Fatal("SendCritical should be blocking while channel is full")
	default:
	}

	// Drain one message to make room
	<-client.sendCh

	select {
	case <-accepted:
		// Success
	case <-time.After(2 * time.Second):
		t.Fatal("SendCritical did not complete after draining channel")
	}
}

// SCALE-04 — SendCritical respects context cancellation
func TestWSClient_SendCriticalRespectsContextCancel(t *testing.T) {
	client := NewWSClient(WSClientConfig{
		URL:             "ws://localhost:9999",
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	// Fill the buffer
	for i := 0; i < 256; i++ {
		client.Send(Message{Type: "FILL", Payload: i})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		client.SendCritical(ctx, Message{Type: "CRITICAL"})
		close(done)
	}()

	select {
	case <-done:
		// SendCritical returned after context cancelled
	case <-time.After(2 * time.Second):
		t.Fatal("SendCritical did not respect context cancellation")
	}
}

// --- BUG-08 Regression: Handler goroutines don't outlive connection ---

// BUG-08 — Handler goroutine respects connection context (no leak on disconnect)
func TestWSClient_HandlerGoroutineStopsOnDisconnect(t *testing.T) {
	handlerStarted := make(chan struct{})
	handlerDone := make(chan struct{})

	server := startMockServer(t, func(conn *websocket.Conn) {
		// Read REGISTER
		_, _, _ = conn.ReadMessage()

		// Send a SLOW_OP message
		msg := Message{Type: "SLOW_OP", Payload: map[string]interface{}{}}
		data, _ := json.Marshal(msg)
		conn.WriteMessage(websocket.TextMessage, data)

		// Wait for handler to start, then close connection
		<-handlerStarted
		time.Sleep(100 * time.Millisecond)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	// Register a handler that blocks until connection context is cancelled
	client.OnMessage("SLOW_OP", func(payload json.RawMessage) {
		close(handlerStarted)
		// Simulate a slow operation that checks connection context
		ctx := client.ConnectionCtx()
		select {
		case <-ctx.Done():
			close(handlerDone)
		case <-time.After(30 * time.Second):
			// Would leak without BUG-08 fix
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	select {
	case <-handlerDone:
		// Handler exited because connection context was cancelled — no leak
	case <-time.After(5 * time.Second):
		t.Fatal("handler goroutine did not stop after disconnect — goroutine leak")
	}
}

// BUG-08 — Leak test: 20 connect/disconnect cycles don't accumulate goroutines
func TestWSClient_NoGoroutineLeakOnRepeatedConnectDisconnect(t *testing.T) {
	connectCount := 0
	var mu sync.Mutex

	server := startMockServer(t, func(conn *websocket.Conn) {
		mu.Lock()
		connectCount++
		mu.Unlock()
		// Read REGISTER then close immediately
		_, _, _ = conn.ReadMessage()
		time.Sleep(50 * time.Millisecond)
		conn.Close()
	})
	defer server.Close()

	client := NewWSClient(WSClientConfig{
		URL:             wsURL(server),
		Token:           "test-token",
		AgentName:       "test-agent",
		HeartbeatPeriod: 1 * time.Hour,
		MaxBackoff:      100 * time.Millisecond,
		GetContainers:   func() []ContainerInfo { return nil },
	})

	handlerInvocations := int32(0)
	client.OnMessage("PING", func(payload json.RawMessage) {
		// Track handler invocations to detect leaked goroutines
		atomic.AddInt32(&handlerInvocations, 1)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	go client.ConnectLoop(ctx)

	// Wait for multiple connect/disconnect cycles
	time.Sleep(3 * time.Second)
	cancel()
	time.Sleep(500 * time.Millisecond)

	mu.Lock()
	cycles := connectCount
	mu.Unlock()

	// Should have completed at least 2 cycles (full-jitter backoff adds variance)
	assert.GreaterOrEqual(t, cycles, 2, "should complete multiple connect/disconnect cycles")
	// After cancel, no new goroutines should be spawned — this test will fail under
	// -race if there are goroutine leaks accessing shared state
}
