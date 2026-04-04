package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WSClient manages the WebSocket connection to the controller.
type WSClient struct {
	url             string
	token           string
	agentName       string
	dockerVersion   *DockerVersionInfo
	conn            *websocket.Conn
	sendCh          chan Message
	mu              sync.Mutex
	connected       bool
	onStateChange   func(connected bool)
	handlers        map[string]func(json.RawMessage)
	getContainers   func() []ContainerInfo
	heartbeatPeriod time.Duration
	maxBackoff      time.Duration
	// connCtx is cancelled when the current connection dies (DOCKER-01).
	connCtx    context.Context
	connCancel context.CancelFunc
	connMu     sync.Mutex
}

// WSClientConfig holds configuration for creating a WSClient.
type WSClientConfig struct {
	URL             string
	Token           string
	AgentName       string
	DockerVersion   *DockerVersionInfo
	GetContainers   func() []ContainerInfo
	OnStateChange   func(connected bool)
	HeartbeatPeriod time.Duration
	MaxBackoff      time.Duration
}

// NewWSClient creates a new WebSocket client.
func NewWSClient(config WSClientConfig) *WSClient {
	hbPeriod := config.HeartbeatPeriod
	if hbPeriod == 0 {
		hbPeriod = 15 * time.Second
	}
	maxBackoff := config.MaxBackoff
	if maxBackoff == 0 {
		maxBackoff = 60 * time.Second
	}

	// SCALE-04: buffer 256 to reduce drops under burst; critical messages block with SendCritical.
	return &WSClient{
		url:             config.URL,
		token:           config.Token,
		agentName:       config.AgentName,
		dockerVersion:   config.DockerVersion,
		sendCh:          make(chan Message, 256),
		handlers:        make(map[string]func(json.RawMessage)),
		getContainers:   config.GetContainers,
		onStateChange:   config.OnStateChange,
		heartbeatPeriod: hbPeriod,
		maxBackoff:      maxBackoff,
	}
}

// OnMessage registers a handler for a specific message type.
func (w *WSClient) OnMessage(msgType string, handler func(json.RawMessage)) {
	w.handlers[msgType] = handler
}

// Send queues a message to be sent to the controller.
// Non-blocking — drops the message if the channel is full.
func (w *WSClient) Send(msg Message) {
	select {
	case w.sendCh <- msg:
	default:
		log.Printf("send channel full, dropping %s message", msg.Type)
	}
}

// SendCritical enqueues a message and blocks until it is accepted or ctx is done.
// Use for UPDATE_RESULT and ROLLBACK_RESULT where dropping is unacceptable.
func (w *WSClient) SendCritical(ctx context.Context, msg Message) {
	select {
	case w.sendCh <- msg:
	case <-ctx.Done():
		log.Printf("context cancelled before %s could be sent", msg.Type)
	}
}

// ConnectionCtx returns a context that is cancelled when the current WS connection dies.
// Message handlers should derive their operation contexts from this so that
// Docker operations are aborted on disconnect (DOCKER-01).
func (w *WSClient) ConnectionCtx() context.Context {
	w.connMu.Lock()
	defer w.connMu.Unlock()
	if w.connCtx != nil {
		return w.connCtx
	}
	return context.Background()
}

// ConnectLoop runs the connection loop with reconnection logic.
func (w *WSClient) ConnectLoop(ctx context.Context) {
	backoff := 1 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := w.dial(ctx)
		if err == nil {
			backoff = 1 * time.Second // Reset on success
			w.setConnected(true)
			w.register()
			w.readWriteLoop(ctx)
			w.setConnected(false)
		}

		// Full-jitter: sleep = random_between(0, backoff) — RC-05.
		// Previously jitter was capped at backoff/4 (max 250ms at 1s backoff),
		// which caused 100 agents to all reconnect within a 1.25s window and
		// saturate the controller's bcrypt auth queue. Full jitter spreads the
		// reconnect storm evenly across the entire backoff window.
		jitter := time.Duration(rand.Int63n(int64(backoff)))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff + jitter):
		}

		backoff = backoff * 2
		if backoff > w.maxBackoff {
			backoff = w.maxBackoff
		}
	}
}

func (w *WSClient) dial(ctx context.Context) error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	conn, _, err := dialer.DialContext(ctx, w.url, nil)
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}
	conn.SetReadLimit(1 << 20) // 1 MB — prevent OOM from large payloads

	// Create a new per-connection context (DOCKER-01).
	// Cancelled in readWriteLoop when the connection exits.
	w.connMu.Lock()
	if w.connCancel != nil {
		w.connCancel()
	}
	w.connCtx, w.connCancel = context.WithCancel(ctx)
	w.connMu.Unlock()

	w.mu.Lock()
	w.conn = conn
	w.mu.Unlock()
	return nil
}

func (w *WSClient) register() {
	hostname, _ := os.Hostname()
	var containers []ContainerInfo
	if w.getContainers != nil {
		containers = w.getContainers()
	}

	payload := map[string]interface{}{
		"token":      w.token,
		"hostname":   hostname,
		"agentName":  w.agentName,
		"version":    Version,
		"containers": containers,
	}
	if w.dockerVersion != nil {
		payload["dockerVersion"] = w.dockerVersion.ServerVersion
		payload["dockerApiVersion"] = w.dockerVersion.APIVersion
		payload["os"] = w.dockerVersion.OS
		payload["arch"] = w.dockerVersion.Arch
	}

	w.sendDirect(Message{Type: "REGISTER", Payload: payload})
}

func (w *WSClient) readWriteLoop(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	defer func() {
		cancel()
		// DOCKER-01: cancel the per-connection context so in-flight handlers abort.
		w.connMu.Lock()
		if w.connCancel != nil {
			w.connCancel()
		}
		w.connMu.Unlock()
	}()

	// OBS-02: heartbeat goes through sendCh so it serializes with write goroutine
	// and never blocks behind a slow write holding the mutex.
	go func() {
		ticker := time.NewTicker(w.heartbeatPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var containers []ContainerInfo
				if w.getContainers != nil {
					containers = w.getContainers()
				}
				w.Send(Message{
					Type: "HEARTBEAT",
					Payload: map[string]interface{}{
						"containers": containers,
					},
				})
			}
		}
	}()

	// Single write goroutine — sole owner of conn.WriteMessage (gorilla not concurrent-safe).
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-w.sendCh:
				w.sendDirect(msg)
			}
		}
	}()

	// Read loop (blocking)
	for {
		w.mu.Lock()
		conn := w.conn
		w.mu.Unlock()

		if conn == nil {
			return
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		if handler, ok := w.handlers[msg.Type]; ok {
			// BUG-08 FIX: pass the read-loop context to handler goroutines so they
			// are cancelled on disconnect. Without this, a handler that blocks on a
			// slow Docker call leaks the goroutine (~8KB stack) forever.
			go func(h func(json.RawMessage), p json.RawMessage, t string, handlerCtx context.Context) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[ws] panic in %s handler: %v", t, r)
					}
				}()
				// Check context before invoking — no point starting if already cancelled
				if handlerCtx.Err() != nil {
					return
				}
				h(p)
			}(handler, msg.Payload, msg.Type, ctx)
		}
	}
}

// sendDirect writes a message directly to the WS connection.
// OBS-01: holds w.mu for the entire operation (conn read + WriteMessage) to
// prevent concurrent writes, since gorilla WebSocket is not write-concurrent-safe.
// Only the write goroutine in readWriteLoop calls this (plus register which runs
// before the write goroutine starts), so contention is minimal.
func (w *WSClient) sendDirect(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	w.mu.Lock()
	conn := w.conn
	if conn == nil {
		w.mu.Unlock()
		return
	}
	err = conn.WriteMessage(websocket.TextMessage, data)
	w.mu.Unlock()

	if err != nil {
		log.Printf("write error: %v", err)
	}
}

func (w *WSClient) setConnected(connected bool) {
	w.mu.Lock()
	w.connected = connected
	w.mu.Unlock()
	if w.onStateChange != nil {
		w.onStateChange(connected)
	}
}

// Close closes the WebSocket connection.
func (w *WSClient) Close() {
	w.mu.Lock()
	if w.conn != nil {
		w.conn.Close()
		w.conn = nil
	}
	w.mu.Unlock()
}
