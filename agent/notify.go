package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Notifier fans out notifications to configured channels with per-container cooldown.
type Notifier struct {
	senders     []Sender
	cooldown    map[string]time.Time
	cooldownMu  sync.Mutex
	cooldownTTL time.Duration
}

// Sender is the interface for a notification channel.
type Sender interface {
	Send(ctx context.Context, title, body string) error
	Name() string
}

// NewNotifier creates a notifier from the agent config.
func NewNotifier(cfg *AgentConfig) *Notifier {
	var senders []Sender

	// Direct env var senders
	if cfg.TelegramToken != "" && cfg.TelegramChatID != "" {
		for _, chatID := range strings.Split(cfg.TelegramChatID, ",") {
			chatID = strings.TrimSpace(chatID)
			if chatID != "" {
				senders = append(senders, &TelegramSender{
					token:  cfg.TelegramToken,
					chatID: chatID,
					client: &http.Client{Timeout: 10 * time.Second},
				})
			}
		}
	}

	if cfg.SlackWebhook != "" {
		senders = append(senders, &SlackSender{
			webhookURL: cfg.SlackWebhook,
			client:     &http.Client{Timeout: 10 * time.Second},
		})
	}

	if cfg.WebhookURL != "" {
		senders = append(senders, &WebhookSender{
			url:     cfg.WebhookURL,
			headers: cfg.WebhookHeaders,
			client:  &http.Client{Timeout: 10 * time.Second},
		})
	}

	// Parse shoutrrr-style notification URLs
	for _, rawURL := range cfg.NotificationURLs {
		if s := parseShoutrrrURL(rawURL); s != nil {
			senders = append(senders, s)
		}
	}

	return &Notifier{
		senders:     senders,
		cooldown:    make(map[string]time.Time),
		cooldownTTL: 5 * time.Minute,
	}
}

// IsConfigured returns true if at least one sender is configured.
func (n *Notifier) IsConfigured() bool {
	return len(n.senders) > 0
}

// Summary returns a human-readable list of configured channels.
func (n *Notifier) Summary() string {
	names := make([]string, len(n.senders))
	for i, s := range n.senders {
		names[i] = s.Name()
	}
	return strings.Join(names, ", ")
}

// NotifyAvailable sends a notification about available updates.
// Respects per-container cooldown to prevent spam.
func (n *Notifier) NotifyAvailable(agentName string, updates []CheckResult) {
	if !n.IsConfigured() || len(updates) == 0 {
		return
	}

	// Filter by cooldown
	var filtered []CheckResult
	n.cooldownMu.Lock()
	now := time.Now()
	for _, u := range updates {
		lastSent, exists := n.cooldown[u.ContainerName]
		if !exists || now.Sub(lastSent) >= n.cooldownTTL {
			filtered = append(filtered, u)
			n.cooldown[u.ContainerName] = now
		}
	}
	n.cooldownMu.Unlock()

	if len(filtered) == 0 {
		return
	}

	title := fmt.Sprintf("Updates Available — %s", agentName)
	var lines []string
	for _, u := range filtered {
		lines = append(lines, fmt.Sprintf("• %s → %s", u.ContainerName, u.LatestDigest))
	}
	body := strings.Join(lines, "\n")

	n.broadcast(title, body)
}

// NotifyResult sends a notification about a single update result.
func (n *Notifier) NotifyResult(result *UpdateResult) {
	if !n.IsConfigured() || result == nil {
		return
	}
	var title, body string
	if result.Success {
		title = fmt.Sprintf("Updated — %s", result.ContainerName)
		body = fmt.Sprintf("Duration: %dms", result.DurationMs)
	} else {
		title = fmt.Sprintf("Update Failed — %s", result.ContainerName)
		body = result.Error
	}
	n.broadcast(title, body)
}

// NotifyResults sends a consolidated notification about multiple update results.
func (n *Notifier) NotifyResults(agentName string, results []*UpdateResult) {
	if !n.IsConfigured() || len(results) == 0 {
		return
	}

	successes := 0
	failures := 0
	var lines []string
	for _, r := range results {
		if r.Success {
			successes++
			lines = append(lines, fmt.Sprintf("✓ %s (%dms)", r.ContainerName, r.DurationMs))
		} else {
			failures++
			lines = append(lines, fmt.Sprintf("✗ %s: %s", r.ContainerName, r.Error))
		}
	}

	var title string
	if failures == 0 {
		title = fmt.Sprintf("Update Complete — %s (%d containers)", agentName, successes)
	} else {
		title = fmt.Sprintf("Update Finished — %s (%d ok, %d failed)", agentName, successes, failures)
	}

	n.broadcast(title, strings.Join(lines, "\n"))
}

// NotifyHealth sends a notification about health-triggered rollback.
func (n *Notifier) NotifyHealth(containerName, reason string) {
	if !n.IsConfigured() {
		return
	}
	n.broadcast(fmt.Sprintf("Auto-Rollback — %s", containerName), reason)
}

func (n *Notifier) broadcast(title, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, s := range n.senders {
		if err := s.Send(ctx, title, body); err != nil {
			log.Printf("[notify] %s send failed: %v", s.Name(), err)
		}
	}
}

// --- Telegram Sender ---

type TelegramSender struct {
	token  string
	chatID string
	client *http.Client
}

func (t *TelegramSender) Name() string { return "telegram:" + t.chatID }

func (t *TelegramSender) Send(ctx context.Context, title, body string) error {
	text := fmt.Sprintf("<b>%s</b>\n\n%s", title, body)
	payload, _ := json.Marshal(map[string]interface{}{
		"chat_id":    t.chatID,
		"text":       text,
		"parse_mode": "HTML",
	})
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.token)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("telegram API returned %d", resp.StatusCode)
	}
	return nil
}

// --- Slack Sender ---

type SlackSender struct {
	webhookURL string
	client     *http.Client
}

func (s *SlackSender) Name() string { return "slack" }

func (s *SlackSender) Send(ctx context.Context, title, body string) error {
	text := fmt.Sprintf("*%s*\n%s", title, body)
	payload, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, "POST", s.webhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("slack webhook returned %d", resp.StatusCode)
	}
	return nil
}

// --- Webhook Sender ---

type WebhookSender struct {
	url     string
	headers map[string]string
	client  *http.Client
}

func (w *WebhookSender) Name() string { return "webhook" }

func (w *WebhookSender) Send(ctx context.Context, title, body string) error {
	payload, _ := json.Marshal(map[string]interface{}{
		"title":     title,
		"body":      body,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	req, err := http.NewRequestWithContext(ctx, "POST", w.url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range w.headers {
		req.Header.Set(k, v)
	}
	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

// --- Shoutrrr URL Parser ---

func parseShoutrrrURL(rawURL string) Sender {
	client := &http.Client{Timeout: 10 * time.Second}

	if strings.HasPrefix(rawURL, "telegram://") {
		// telegram://TOKEN@telegram?channels=CHATID
		rawURL = strings.TrimPrefix(rawURL, "telegram://")
		parts := strings.SplitN(rawURL, "@", 2)
		if len(parts) < 2 {
			log.Printf("[notify] invalid telegram URL: missing @")
			return nil
		}
		token := parts[0]
		query := ""
		if idx := strings.Index(parts[1], "?"); idx >= 0 {
			query = parts[1][idx+1:]
		}
		chatID := ""
		for _, param := range strings.Split(query, "&") {
			kv := strings.SplitN(param, "=", 2)
			if len(kv) == 2 && kv[0] == "channels" {
				chatID = kv[1]
			}
		}
		if token == "" || chatID == "" {
			log.Printf("[notify] invalid telegram URL: missing token or channels")
			return nil
		}
		return &TelegramSender{token: token, chatID: chatID, client: client}
	}

	if strings.HasPrefix(rawURL, "slack://") {
		// slack://hooks.slack.com/services/T.../B.../... or slack://TOKEN-A/TOKEN-B/TOKEN-C
		trimmed := strings.TrimPrefix(rawURL, "slack://")
		var webhookURL string
		if strings.HasPrefix(trimmed, "hooks.slack.com") {
			webhookURL = "https://" + trimmed
		} else {
			webhookURL = "https://hooks.slack.com/services/" + strings.SplitN(trimmed, "@", 2)[0]
		}
		return &SlackSender{webhookURL: webhookURL, client: client}
	}

	log.Printf("[notify] unsupported notification URL scheme: %s (use WW_WEBHOOK_URL for generic webhooks)", rawURL)
	return nil
}
