package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHTTPServer_HealthEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	cfg := &AgentConfig{HTTPPort: "0"}

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		mode := "solo"
		if cfg.ControllerURL != "" {
			mode = "managed"
		}
		writeJSON(w, map[string]interface{}{"status": "ok", "mode": mode})
	})

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "ok", body["status"])
	assert.Equal(t, "solo", body["mode"])
}

func TestHTTPServer_TokenAuth_NoToken(t *testing.T) {
	auth := tokenAuthMiddleware("")
	handler := auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})

	// No token configured — should allow access
	req := httptest.NewRequest("GET", "/api/status", nil)
	w := httptest.NewRecorder()
	handler(w, req)
	assert.Equal(t, 200, w.Code)
}

func TestHTTPServer_TokenAuth_ValidToken(t *testing.T) {
	auth := tokenAuthMiddleware("secret-123")
	handler := auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})

	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer secret-123")
	w := httptest.NewRecorder()
	handler(w, req)
	assert.Equal(t, 200, w.Code)
}

func TestHTTPServer_TokenAuth_InvalidToken(t *testing.T) {
	auth := tokenAuthMiddleware("secret-123")
	handler := auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})

	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	w := httptest.NewRecorder()
	handler(w, req)
	assert.Equal(t, 401, w.Code)
}

func TestHTTPServer_TokenAuth_MissingHeader(t *testing.T) {
	auth := tokenAuthMiddleware("secret-123")
	handler := auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	})

	req := httptest.NewRequest("GET", "/api/status", nil)
	w := httptest.NewRecorder()
	handler(w, req)
	assert.Equal(t, 401, w.Code)
}

func TestEventLog_RingBuffer(t *testing.T) {
	el := NewEventLog(5)

	for i := 0; i < 10; i++ {
		el.Add(Event{Type: "test", Details: string(rune('A' + i))})
	}

	recent := el.Recent(5)
	assert.Len(t, recent, 5)
	// Newest first
	assert.Equal(t, string(rune('A'+9)), recent[0].Details)
	assert.Equal(t, string(rune('A'+5)), recent[4].Details)
}

func TestEventLog_RecentLessThanAvailable(t *testing.T) {
	el := NewEventLog(100)
	el.Add(Event{Type: "a"})
	el.Add(Event{Type: "b"})
	el.Add(Event{Type: "c"})

	recent := el.Recent(2)
	assert.Len(t, recent, 2)
	assert.Equal(t, "c", recent[0].Type)
	assert.Equal(t, "b", recent[1].Type)
}

func TestEventLog_RecentMoreThanAvailable(t *testing.T) {
	el := NewEventLog(100)
	el.Add(Event{Type: "a"})

	recent := el.Recent(10)
	assert.Len(t, recent, 1)
}
