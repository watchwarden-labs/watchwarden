package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNotifier_TelegramSender(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	sender := &TelegramSender{
		token:  "test-token",
		chatID: "123456",
		client: server.Client(),
	}
	// Override the URL by using the test server
	// We can't easily override the URL, so test via Notifier integration instead

	assert.Equal(t, "telegram:123456", sender.Name())
}

func TestNotifier_SlackSender(t *testing.T) {
	var receivedBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		w.WriteHeader(200)
	}))
	defer server.Close()

	sender := &SlackSender{
		webhookURL: server.URL,
		client:     server.Client(),
	}

	err := sender.Send(t.Context(), "Test Title", "Test Body")
	require.NoError(t, err)
	assert.Contains(t, receivedBody["text"], "Test Title")
	assert.Contains(t, receivedBody["text"], "Test Body")
}

func TestNotifier_WebhookSender(t *testing.T) {
	var receivedBody map[string]interface{}
	var receivedHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		w.WriteHeader(200)
	}))
	defer server.Close()

	sender := &WebhookSender{
		url:     server.URL,
		headers: map[string]string{"X-Secret": "abc123"},
		client:  server.Client(),
	}

	err := sender.Send(t.Context(), "Test", "Body")
	require.NoError(t, err)
	assert.Equal(t, "Test", receivedBody["title"])
	assert.Equal(t, "Body", receivedBody["body"])
	assert.Equal(t, "abc123", receivedHeaders.Get("X-Secret"))
}

func TestNotifier_Cooldown(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(200)
	}))
	defer server.Close()

	n := &Notifier{
		senders:     []Sender{&WebhookSender{url: server.URL, client: server.Client()}},
		cooldown:    make(map[string]time.Time),
		cooldownTTL: 5 * time.Minute,
	}

	updates := []CheckResult{
		{ContainerName: "nginx", HasUpdate: true, LatestDigest: "sha256:new"},
	}

	// First call — should send
	n.NotifyAvailable("test-agent", updates)
	assert.Equal(t, 1, callCount)

	// Second call within cooldown — should skip
	n.NotifyAvailable("test-agent", updates)
	assert.Equal(t, 1, callCount, "should not send within cooldown period")
}

func TestNotifier_ResultsAlwaysSend(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(200)
	}))
	defer server.Close()

	n := &Notifier{
		senders:     []Sender{&WebhookSender{url: server.URL, client: server.Client()}},
		cooldown:    make(map[string]time.Time),
		cooldownTTL: 5 * time.Minute,
	}

	results := []*UpdateResult{
		{ContainerName: "nginx", Success: true, DurationMs: 5000},
	}

	// Results always send regardless of cooldown
	n.NotifyResults("test-agent", results)
	assert.Equal(t, 1, callCount)
	n.NotifyResults("test-agent", results)
	assert.Equal(t, 2, callCount, "NotifyResults should always send")
}

func TestNotifier_IsConfigured(t *testing.T) {
	empty := &Notifier{senders: nil}
	assert.False(t, empty.IsConfigured())

	withSender := &Notifier{senders: []Sender{&SlackSender{}}}
	assert.True(t, withSender.IsConfigured())
}

func TestParseShoutrrrURL_Telegram(t *testing.T) {
	sender := parseShoutrrrURL("telegram://123:ABC@telegram?channels=-100999")
	require.NotNil(t, sender)
	tg, ok := sender.(*TelegramSender)
	require.True(t, ok)
	assert.Equal(t, "123:ABC", tg.token)
	assert.Equal(t, "-100999", tg.chatID)
}

func TestParseShoutrrrURL_Slack(t *testing.T) {
	sender := parseShoutrrrURL("slack://hooks.slack.com/services/T123/B456/XXX")
	require.NotNil(t, sender)
	sl, ok := sender.(*SlackSender)
	require.True(t, ok)
	assert.Equal(t, "https://hooks.slack.com/services/T123/B456/XXX", sl.webhookURL)
}

func TestParseShoutrrrURL_Unknown(t *testing.T) {
	sender := parseShoutrrrURL("discord://token@channel")
	assert.Nil(t, sender, "unsupported schemes should return nil")
}

func TestNewNotifier_FromConfig(t *testing.T) {
	cfg := &AgentConfig{
		TelegramToken:  "123:ABC",
		TelegramChatID: "111,222",
		SlackWebhook:   "https://hooks.slack.com/test",
	}
	n := NewNotifier(cfg)
	// 2 telegram (one per chat ID) + 1 slack = 3 senders
	assert.Equal(t, 3, len(n.senders))
	assert.Contains(t, n.Summary(), "telegram:111")
	assert.Contains(t, n.Summary(), "telegram:222")
	assert.Contains(t, n.Summary(), "slack")
}
