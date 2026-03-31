package main

import (
	"fmt"
	"os"
)

// applyWatchtowerCompat reads WATCHTOWER_* env vars and sets WW_* equivalents
// if WW_* is not already set. Returns a list of mapping descriptions for logging.
func applyWatchtowerCompat() []string {
	var mappings []string

	// Direct mappings: WATCHTOWER_* → WW_*
	directMaps := []struct {
		from string
		to   string
	}{
		{"WATCHTOWER_SCHEDULE", "WW_SCHEDULE"},
		{"WATCHTOWER_CLEANUP", "WW_PRUNE"},
		{"WATCHTOWER_MONITOR_ONLY", "WW_MONITOR_ONLY"},
		{"WATCHTOWER_INCLUDE_STOPPED", "WW_INCLUDE_STOPPED"},
		{"WATCHTOWER_INCLUDE_RESTARTING", "WW_INCLUDE_RESTARTING"},
		{"WATCHTOWER_LABEL_ENABLE", "WATCHWARDEN_LABEL_ENABLE_ONLY"},
		{"WATCHTOWER_TIMEOUT", "WW_STOP_TIMEOUT"},
		{"WATCHTOWER_HTTP_API_TOKEN", "WW_HTTP_TOKEN"},
		{"WATCHTOWER_NOTIFICATION_URL", "WW_NOTIFICATION_URL"},
		{"REPO_USER", "WW_DOCKER_USERNAME"},
		{"REPO_PASS", "WW_DOCKER_PASSWORD"},
	}

	for _, m := range directMaps {
		if mapped := mapEnvIfUnset(m.from, m.to); mapped {
			mappings = append(mappings, fmt.Sprintf("%s=%s → %s", m.from, os.Getenv(m.to), m.to))
		}
	}

	// WATCHTOWER_POLL_INTERVAL → WW_SCHEDULE (seconds → @every Ns)
	if interval := os.Getenv("WATCHTOWER_POLL_INTERVAL"); interval != "" && os.Getenv("WW_SCHEDULE") == "" {
		os.Setenv("WW_SCHEDULE", "@every "+interval+"s")
		mappings = append(mappings, fmt.Sprintf("WATCHTOWER_POLL_INTERVAL=%s → WW_SCHEDULE=@every %ss", interval, interval))
	}

	// WATCHTOWER_ROLLING_RESTART → WW_UPDATE_STRATEGY
	if os.Getenv("WATCHTOWER_ROLLING_RESTART") == "true" && os.Getenv("WW_UPDATE_STRATEGY") == "" {
		os.Setenv("WW_UPDATE_STRATEGY", "start-first")
		mappings = append(mappings, "WATCHTOWER_ROLLING_RESTART=true → WW_UPDATE_STRATEGY=start-first")
	}

	// Legacy notification compat: WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL → WW_SLACK_WEBHOOK
	if hookURL := os.Getenv("WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL"); hookURL != "" && os.Getenv("WW_SLACK_WEBHOOK") == "" {
		os.Setenv("WW_SLACK_WEBHOOK", hookURL)
		mappings = append(mappings, fmt.Sprintf("WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL → WW_SLACK_WEBHOOK"))
	}

	// Legacy Telegram compat
	if token := os.Getenv("WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN"); token != "" && os.Getenv("WW_TELEGRAM_TOKEN") == "" {
		os.Setenv("WW_TELEGRAM_TOKEN", token)
		mappings = append(mappings, "WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN → WW_TELEGRAM_TOKEN")
	}
	if chatID := os.Getenv("WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID"); chatID != "" && os.Getenv("WW_TELEGRAM_CHAT_ID") == "" {
		os.Setenv("WW_TELEGRAM_CHAT_ID", chatID)
		mappings = append(mappings, "WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID → WW_TELEGRAM_CHAT_ID")
	}

	return mappings
}

// mapEnvIfUnset copies the value of `from` env var to `to` env var
// only if `to` is not already set. Returns true if a mapping was applied.
func mapEnvIfUnset(from, to string) bool {
	val := os.Getenv(from)
	if val == "" {
		return false
	}
	if os.Getenv(to) != "" {
		return false // WW_* already set, don't override
	}
	os.Setenv(to, val)
	return true
}
