package main

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCompat_PollInterval(t *testing.T) {
	os.Unsetenv("WW_SCHEDULE")
	t.Setenv("WATCHTOWER_POLL_INTERVAL", "3600")

	mappings := applyWatchtowerCompat()

	assert.Equal(t, "@every 3600s", os.Getenv("WW_SCHEDULE"))
	assert.NotEmpty(t, mappings)
}

func TestCompat_Schedule(t *testing.T) {
	os.Unsetenv("WW_SCHEDULE")
	t.Setenv("WATCHTOWER_SCHEDULE", "0 4 * * *")

	applyWatchtowerCompat()

	assert.Equal(t, "0 4 * * *", os.Getenv("WW_SCHEDULE"))
}

func TestCompat_WW_OverridesWatchtower(t *testing.T) {
	t.Setenv("WW_SCHEDULE", "@every 1h")
	t.Setenv("WATCHTOWER_SCHEDULE", "0 4 * * *")

	applyWatchtowerCompat()

	// WW_* should NOT be overridden by WATCHTOWER_*
	assert.Equal(t, "@every 1h", os.Getenv("WW_SCHEDULE"))
}

func TestCompat_Cleanup(t *testing.T) {
	os.Unsetenv("WW_PRUNE")
	t.Setenv("WATCHTOWER_CLEANUP", "true")

	applyWatchtowerCompat()

	assert.Equal(t, "true", os.Getenv("WW_PRUNE"))
}

func TestCompat_RollingRestart(t *testing.T) {
	os.Unsetenv("WW_UPDATE_STRATEGY")
	t.Setenv("WATCHTOWER_ROLLING_RESTART", "true")

	applyWatchtowerCompat()

	assert.Equal(t, "start-first", os.Getenv("WW_UPDATE_STRATEGY"))
}

func TestCompat_LabelEnable(t *testing.T) {
	os.Unsetenv("WATCHWARDEN_LABEL_ENABLE_ONLY")
	t.Setenv("WATCHTOWER_LABEL_ENABLE", "true")

	applyWatchtowerCompat()

	assert.Equal(t, "true", os.Getenv("WATCHWARDEN_LABEL_ENABLE_ONLY"))
}

func TestCompat_RegistryCreds(t *testing.T) {
	os.Unsetenv("WW_DOCKER_USERNAME")
	os.Unsetenv("WW_DOCKER_PASSWORD")
	t.Setenv("REPO_USER", "myuser")
	t.Setenv("REPO_PASS", "mypass")

	applyWatchtowerCompat()

	assert.Equal(t, "myuser", os.Getenv("WW_DOCKER_USERNAME"))
	assert.Equal(t, "mypass", os.Getenv("WW_DOCKER_PASSWORD"))
}

func TestCompat_TelegramNotification(t *testing.T) {
	os.Unsetenv("WW_TELEGRAM_TOKEN")
	os.Unsetenv("WW_TELEGRAM_CHAT_ID")
	t.Setenv("WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN", "123:ABC")
	t.Setenv("WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID", "-100123")

	applyWatchtowerCompat()

	assert.Equal(t, "123:ABC", os.Getenv("WW_TELEGRAM_TOKEN"))
	assert.Equal(t, "-100123", os.Getenv("WW_TELEGRAM_CHAT_ID"))
}

func TestCompat_SlackNotification(t *testing.T) {
	os.Unsetenv("WW_SLACK_WEBHOOK")
	t.Setenv("WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL", "https://hooks.slack.com/services/T/B/X")

	applyWatchtowerCompat()

	assert.Equal(t, "https://hooks.slack.com/services/T/B/X", os.Getenv("WW_SLACK_WEBHOOK"))
}

func TestCompat_HTTPToken(t *testing.T) {
	os.Unsetenv("WW_HTTP_TOKEN")
	t.Setenv("WATCHTOWER_HTTP_API_TOKEN", "secret-token")

	applyWatchtowerCompat()

	assert.Equal(t, "secret-token", os.Getenv("WW_HTTP_TOKEN"))
}
