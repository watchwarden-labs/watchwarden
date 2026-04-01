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

func TestNtfySender_Send(t *testing.T) {
	var receivedTitle, receivedBody, receivedPriority string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedTitle = r.Header.Get("Title")
		receivedPriority = r.Header.Get("Priority")
		body, _ := io.ReadAll(r.Body)
		receivedBody = string(body)
		w.WriteHeader(200)
	}))
	defer server.Close()

	sender := &NtfySender{
		server:   server.URL,
		topic:    "watchwarden",
		priority: "high",
		client:   server.Client(),
	}

	assert.Equal(t, "ntfy:watchwarden", sender.Name())

	err := sender.Send(t.Context(), "Test Title", "Test Body")
	require.NoError(t, err)
	assert.Equal(t, "Test Title", receivedTitle)
	assert.Equal(t, "Test Body", receivedBody)
	assert.Equal(t, "high", receivedPriority)
}

func TestNtfySender_DefaultPriority(t *testing.T) {
	var receivedPriority string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPriority = r.Header.Get("Priority")
		w.WriteHeader(200)
	}))
	defer server.Close()

	sender := &NtfySender{
		server:   server.URL,
		topic:    "test",
		priority: "default",
		client:   server.Client(),
	}

	err := sender.Send(t.Context(), "Title", "Body")
	require.NoError(t, err)
	assert.Empty(t, receivedPriority, "should not set Priority header when priority is 'default'")
}

func TestNtfySender_WithToken(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(200)
	}))
	defer server.Close()

	sender := &NtfySender{
		server: server.URL,
		topic:  "test",
		token:  "tk_secrettoken",
		client: server.Client(),
	}

	err := sender.Send(t.Context(), "Title", "Body")
	require.NoError(t, err)
	assert.Equal(t, "Bearer tk_secrettoken", receivedAuth)
}

func TestNtfySender_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(429)
	}))
	defer server.Close()

	sender := &NtfySender{
		server: server.URL,
		topic:  "test",
		client: server.Client(),
	}

	err := sender.Send(t.Context(), "Title", "Body")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "429")
}

func TestParseShoutrrrURL_Ntfy(t *testing.T) {
	// ntfy://server/topic
	sender := parseShoutrrrURL("ntfy://ntfy.example.com/watchwarden")
	require.NotNil(t, sender)
	ns, ok := sender.(*NtfySender)
	require.True(t, ok)
	assert.Equal(t, "https://ntfy.example.com", ns.server)
	assert.Equal(t, "watchwarden", ns.topic)
}

func TestParseShoutrrrURL_NtfyDefaultServer(t *testing.T) {
	// ntfy://topic (defaults to ntfy.sh)
	sender := parseShoutrrrURL("ntfy://my-updates")
	require.NotNil(t, sender)
	ns, ok := sender.(*NtfySender)
	require.True(t, ok)
	assert.Equal(t, "https://ntfy.sh", ns.server)
	assert.Equal(t, "my-updates", ns.topic)
}

func TestNewNotifier_WithNtfy(t *testing.T) {
	cfg := &AgentConfig{
		NtfyURL:      "https://ntfy.sh",
		NtfyTopic:    "watchwarden-test",
		NtfyPriority: "high",
	}
	n := NewNotifier(cfg)
	assert.Equal(t, 1, len(n.senders))
	assert.Contains(t, n.Summary(), "ntfy:watchwarden-test")
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

func TestRenderNotificationTemplate_Valid(t *testing.T) {
	tmpl := "{{.ContainerName}} updated to {{.NewDigest}}"
	vars := map[string]string{
		"ContainerName": "nginx",
		"NewDigest":     "sha256:abc123",
	}
	result := renderNotificationTemplate(tmpl, vars, "fallback")
	assert.Equal(t, "nginx updated to sha256:abc123", result)
}

func TestRenderNotificationTemplate_Empty(t *testing.T) {
	result := renderNotificationTemplate("", nil, "fallback")
	assert.Equal(t, "fallback", result)
}

func TestRenderNotificationTemplate_Invalid(t *testing.T) {
	result := renderNotificationTemplate("{{.Missing", nil, "fallback")
	assert.Equal(t, "fallback", result)
}

func TestNotifier_WithTemplate(t *testing.T) {
	var receivedTitle, receivedBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		data, _ := io.ReadAll(r.Body)
		json.Unmarshal(data, &body)
		receivedTitle = body["title"].(string)
		receivedBody = body["body"].(string)
		w.WriteHeader(200)
	}))
	defer server.Close()

	n := &Notifier{
		senders:     []Sender{&WebhookSender{url: server.URL, client: server.Client()}},
		cooldown:    make(map[string]time.Time),
		cooldownTTL: 5 * time.Minute,
		template:    "{{.ContainerName}} - {{.EventType}}\n{{.Duration}}",
	}

	n.NotifyResult(&UpdateResult{
		ContainerName: "nginx",
		Success:       true,
		DurationMs:    5000,
	})

	assert.Equal(t, "nginx - update_result", receivedTitle)
	assert.Equal(t, "5000ms", receivedBody)
}
