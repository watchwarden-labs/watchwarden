package main

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// AgentConfig holds all configuration for the agent, populated from env vars.
type AgentConfig struct {
	// Mode detection
	ControllerURL string
	AgentToken    string
	AgentName     string

	// Scheduling
	Schedule    string // cron expression or @every format
	AutoUpdate  bool
	MonitorOnly bool

	// Update behavior
	UpdateStrategy    string // "recreate" (default) | "start-first" (blue-green)
	PruneAfterUpdate  bool
	StopTimeout       time.Duration
	IncludeStopped    bool
	IncludeRestarting bool

	// Label filtering
	LabelEnableOnly bool

	// Notifications
	NotificationURLs []string
	TelegramToken    string
	TelegramChatID   string
	SlackWebhook     string
	WebhookURL       string
	WebhookHeaders   map[string]string
	NtfyURL          string
	NtfyTopic        string
	NtfyPriority     string

	// HTTP server
	HTTPPort  string
	HTTPToken string

	// Registry auth
	DockerUsername string
	DockerPassword string
	DockerServer   string
	RegistryAuth   string // JSON array

	// Custom notification template (Go text/template)
	NotificationTemplate string

	// Security
	RequireSigned   bool
	CosignPublicKey string

	// Managed mode only
	LocalSchedule string
}

// loadConfig reads all environment variables, applies Watchtower compatibility
// mappings, validates, and returns a typed config struct.
func loadConfig() *AgentConfig {
	// Apply Watchtower compat first (sets WW_* env vars from WATCHTOWER_*)
	mappings := applyWatchtowerCompat()
	for _, m := range mappings {
		log.Printf("[compat] %s", m)
	}

	cfg := &AgentConfig{
		ControllerURL:     os.Getenv("CONTROLLER_URL"),
		AgentToken:        os.Getenv("AGENT_TOKEN"),
		AgentName:         getEnvDefault("AGENT_NAME", ""),
		Schedule:          getEnvDefault("WW_SCHEDULE", "@every 24h"),
		AutoUpdate:        getEnvBool("WW_AUTO_UPDATE", false),
		MonitorOnly:       getEnvBool("WW_MONITOR_ONLY", false),
		UpdateStrategy:    getEnvDefault("WW_UPDATE_STRATEGY", "recreate"),
		PruneAfterUpdate:  getEnvBool("WW_PRUNE", false),
		StopTimeout:       time.Duration(getEnvInt("WW_STOP_TIMEOUT", 10)) * time.Second,
		IncludeStopped:    getEnvBool("WW_INCLUDE_STOPPED", false),
		IncludeRestarting: getEnvBool("WW_INCLUDE_RESTARTING", false),
		LabelEnableOnly:   getEnvBool("WATCHWARDEN_LABEL_ENABLE_ONLY", false),
		TelegramToken:     os.Getenv("WW_TELEGRAM_TOKEN"),
		TelegramChatID:    os.Getenv("WW_TELEGRAM_CHAT_ID"),
		SlackWebhook:      os.Getenv("WW_SLACK_WEBHOOK"),
		WebhookURL:        os.Getenv("WW_WEBHOOK_URL"),
		HTTPPort:          getEnvDefault("WW_HTTP_PORT", "8080"),
		HTTPToken:         os.Getenv("WW_HTTP_TOKEN"),
		DockerUsername:    os.Getenv("WW_DOCKER_USERNAME"),
		DockerPassword:    os.Getenv("WW_DOCKER_PASSWORD"),
		DockerServer:      getEnvDefault("WW_DOCKER_SERVER", "index.docker.io"),
		RegistryAuth:      os.Getenv("WW_REGISTRY_AUTH"),
		RequireSigned:     getEnvBool("REQUIRE_SIGNED_IMAGES", false),
		CosignPublicKey:   os.Getenv("COSIGN_PUBLIC_KEY"),
		LocalSchedule:     os.Getenv("LOCAL_SCHEDULE"),
	}

	cfg.NotificationTemplate = os.Getenv("WW_NOTIFICATION_TEMPLATE")

	// Parse notification URLs
	if rawURLs := os.Getenv("WW_NOTIFICATION_URL"); rawURLs != "" {
		cfg.NotificationURLs = strings.Fields(rawURLs)
	}

	// Parse webhook headers
	if headersJSON := os.Getenv("WW_WEBHOOK_HEADERS"); headersJSON != "" {
		cfg.WebhookHeaders = parseHeadersJSON(headersJSON)
	}

	// ntfy config
	cfg.NtfyURL = os.Getenv("WW_NTFY_URL")
	cfg.NtfyTopic = os.Getenv("WW_NTFY_TOPIC")
	cfg.NtfyPriority = getEnvDefault("WW_NTFY_PRIORITY", "default")

	// Default agent name to hostname
	if cfg.AgentName == "" {
		hostname, _ := os.Hostname()
		cfg.AgentName = hostname
	}

	// MonitorOnly implies no auto-update
	if cfg.MonitorOnly {
		cfg.AutoUpdate = false
	}

	// Log mode
	if cfg.ControllerURL != "" {
		log.Printf("[watchwarden] Starting in Managed Mode (controller: %s)", cfg.ControllerURL)
	} else {
		log.Printf("[watchwarden] Starting in Solo Mode (schedule: %s, auto-update: %v)", cfg.Schedule, cfg.AutoUpdate)
	}

	return cfg
}

// validate checks required fields based on mode. Returns error if invalid.
func (c *AgentConfig) validate() error {
	if c.ControllerURL != "" {
		// Managed mode requires token
		if c.AgentToken == "" {
			return fmt.Errorf("AGENT_TOKEN is required in Managed Mode")
		}
	}
	return nil
}

func getEnvDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	return v == "true" || v == "1" || v == "yes"
}

func getEnvInt(key string, defaultVal int) int {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

func parseHeadersJSON(raw string) map[string]string {
	// Simple JSON object parsing without encoding/json to avoid import in this file
	// Format: {"Key":"Value","Key2":"Value2"}
	headers := make(map[string]string)
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") || !strings.HasSuffix(raw, "}") {
		return headers
	}
	raw = raw[1 : len(raw)-1]
	for _, pair := range strings.Split(raw, ",") {
		parts := strings.SplitN(pair, ":", 2)
		if len(parts) == 2 {
			key := strings.Trim(strings.TrimSpace(parts[0]), `"`)
			val := strings.Trim(strings.TrimSpace(parts[1]), `"`)
			if key != "" {
				headers[key] = val
			}
		}
	}
	return headers
}
