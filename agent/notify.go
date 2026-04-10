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
	"text/template"
	"time"
)

// Notifier fans out notifications to configured channels with per-container cooldown.
type Notifier struct {
	senders     []Sender
	cooldown    map[string]time.Time
	cooldownMu  sync.Mutex
	cooldownTTL time.Duration
	template    string // user-provided Go text/template
}

// renderNotificationTemplate renders a Go text/template with the given variables.
// If the template is empty or invalid, returns the fallback string.
func renderNotificationTemplate(tmpl string, vars map[string]string, fallback string) string {
	if tmpl == "" {
		return fallback
	}
	t, err := template.New("notification").Parse(tmpl)
	if err != nil {
		log.Printf("[notify] invalid template, using default: %v", err)
		return fallback
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		log.Printf("[notify] template execution failed, using default: %v", err)
		return fallback
	}
	return buf.String()
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

	if cfg.NtfyURL != "" && cfg.NtfyTopic != "" {
		senders = append(senders, &NtfySender{
			server:   cfg.NtfyURL,
			topic:    cfg.NtfyTopic,
			priority: cfg.NtfyPriority,
			client:   &http.Client{Timeout: 10 * time.Second},
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
		template:    cfg.NotificationTemplate,
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

	if n.template != "" {
		// Build container list as a single string for template use
		var names []string
		for _, u := range filtered {
			names = append(names, u.ContainerName)
		}
		vars := map[string]string{
			"EventType":  "update_available",
			"AgentName":  agentName,
			"Containers": strings.Join(names, ", "),
			"Count":      fmt.Sprintf("%d", len(filtered)),
		}
		rendered := renderNotificationTemplate(n.template, vars, title+"\n"+body)
		parts := strings.SplitN(rendered, "\n", 2)
		title = parts[0]
		if len(parts) > 1 {
			body = parts[1]
		} else {
			body = ""
		}
	}

	n.broadcast(title, body)
}

// formatImageLabel returns a human-readable image label combining tag and short digest.
// Format: "image:tag (sha256:short...)" or just the tag/digest if only one is available.
func formatImageLabel(image, digest string) string {
	if image == "" && digest == "" {
		return ""
	}
	if image == "" {
		if len(digest) > 19 {
			return digest[:19] + "..."
		}
		return digest
	}
	if digest != "" {
		short := digest
		if len(short) > 19 {
			short = short[:19] + "..."
		}
		return fmt.Sprintf("%s (%s)", image, short)
	}
	return image
}

// NotifyResult sends a notification about a single update result.
func (n *Notifier) NotifyResult(result *UpdateResult) {
	if !n.IsConfigured() || result == nil {
		return
	}
	var title, body string
	if result.Success {
		title = fmt.Sprintf("Updated — %s", result.ContainerName)
		newLabel := formatImageLabel(result.NewImage, result.NewDigest)
		if newLabel != "" {
			body = fmt.Sprintf("%s (%dms)", newLabel, result.DurationMs)
		} else {
			body = fmt.Sprintf("Duration: %dms", result.DurationMs)
		}
	} else {
		title = fmt.Sprintf("Update Failed — %s", result.ContainerName)
		body = result.Error
	}
	if n.template != "" {
		vars := map[string]string{
			"EventType":     "update_result",
			"ContainerName": result.ContainerName,
			"ContainerID":   result.ContainerID,
			"Success":       fmt.Sprintf("%v", result.Success),
			"OldDigest":     result.OldDigest,
			"NewDigest":     result.NewDigest,
			"OldImage":      result.OldImage,
			"NewImage":      result.NewImage,
			"Duration":      fmt.Sprintf("%dms", result.DurationMs),
			"Error":         result.Error,
		}
		rendered := renderNotificationTemplate(n.template, vars, title+"\n"+body)
		parts := strings.SplitN(rendered, "\n", 2)
		title = parts[0]
		if len(parts) > 1 {
			body = parts[1]
		} else {
			body = ""
		}
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
			newLabel := formatImageLabel(r.NewImage, r.NewDigest)
			if newLabel != "" {
				lines = append(lines, fmt.Sprintf("✓ %s → %s (%dms)", r.ContainerName, newLabel, r.DurationMs))
			} else {
				lines = append(lines, fmt.Sprintf("✓ %s (%dms)", r.ContainerName, r.DurationMs))
			}
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
	body := strings.Join(lines, "\n")

	if n.template != "" {
		var names []string
		for _, r := range results {
			names = append(names, r.ContainerName)
		}
		vars := map[string]string{
			"EventType":  "update_results",
			"AgentName":  agentName,
			"Containers": strings.Join(names, ", "),
			"Successes":  fmt.Sprintf("%d", successes),
			"Failures":   fmt.Sprintf("%d", failures),
			"Total":      fmt.Sprintf("%d", len(results)),
		}
		rendered := renderNotificationTemplate(n.template, vars, title+"\n"+body)
		parts := strings.SplitN(rendered, "\n", 2)
		title = parts[0]
		if len(parts) > 1 {
			body = parts[1]
		} else {
			body = ""
		}
	}

	n.broadcast(title, body)
}

// NotifyHealth sends a notification about health-triggered rollback.
func (n *Notifier) NotifyHealth(containerName, reason string) {
	if !n.IsConfigured() {
		return
	}
	title := fmt.Sprintf("Auto-Rollback — %s", containerName)
	body := reason
	if n.template != "" {
		vars := map[string]string{
			"EventType":     "health_rollback",
			"ContainerName": containerName,
			"Reason":        reason,
		}
		rendered := renderNotificationTemplate(n.template, vars, title+"\n"+body)
		parts := strings.SplitN(rendered, "\n", 2)
		title = parts[0]
		if len(parts) > 1 {
			body = parts[1]
		} else {
			body = ""
		}
	}
	n.broadcast(title, body)
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

// --- ntfy Sender ---

type NtfySender struct {
	server   string
	topic    string
	priority string
	token    string
	client   *http.Client
}

func (n *NtfySender) Name() string { return "ntfy:" + n.topic }

func (n *NtfySender) Send(ctx context.Context, title, body string) error {
	url := strings.TrimRight(n.server, "/") + "/" + n.topic
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Title", title)
	if n.priority != "" && n.priority != "default" {
		req.Header.Set("Priority", n.priority)
	}
	if n.token != "" {
		req.Header.Set("Authorization", "Bearer "+n.token)
	}
	resp, err := n.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ntfy returned %d", resp.StatusCode)
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

	if strings.HasPrefix(rawURL, "ntfy://") {
		// ntfy://server/topic or ntfy://topic (defaults to https://ntfy.sh)
		trimmed := strings.TrimPrefix(rawURL, "ntfy://")
		parts := strings.SplitN(trimmed, "/", 2)
		var server, topic string
		if len(parts) == 2 && (strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":")) {
			server = "https://" + parts[0]
			topic = parts[1]
		} else {
			server = "https://ntfy.sh"
			topic = trimmed
		}
		if topic == "" {
			log.Printf("[notify] invalid ntfy URL: missing topic")
			return nil
		}
		return &NtfySender{server: server, topic: topic, priority: "default", client: client}
	}

	log.Printf("[notify] unsupported notification URL scheme: %s (use WW_WEBHOOK_URL for generic webhooks)", rawURL)
	return nil
}
