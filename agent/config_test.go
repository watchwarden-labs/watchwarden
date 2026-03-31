package main

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func clearEnv(keys ...string) {
	for _, k := range keys {
		os.Unsetenv(k)
	}
}

func TestLoadConfig_Defaults(t *testing.T) {
	clearEnv("CONTROLLER_URL", "AGENT_TOKEN", "WW_SCHEDULE", "WW_AUTO_UPDATE",
		"WW_UPDATE_STRATEGY", "WW_PRUNE", "WW_HTTP_PORT", "WATCHWARDEN_LABEL_ENABLE_ONLY")

	cfg := loadConfig()

	assert.Equal(t, "", cfg.ControllerURL)
	assert.Equal(t, "@every 24h", cfg.Schedule)
	assert.False(t, cfg.AutoUpdate)
	assert.Equal(t, "recreate", cfg.UpdateStrategy)
	assert.False(t, cfg.PruneAfterUpdate)
	assert.Equal(t, "8080", cfg.HTTPPort)
	assert.False(t, cfg.LabelEnableOnly)
}

func TestLoadConfig_SoloMode(t *testing.T) {
	clearEnv("CONTROLLER_URL")
	t.Setenv("WW_SCHEDULE", "*/5 * * * *")
	t.Setenv("WW_AUTO_UPDATE", "true")
	t.Setenv("WW_UPDATE_STRATEGY", "start-first")

	cfg := loadConfig()

	assert.Equal(t, "", cfg.ControllerURL)
	assert.Equal(t, "*/5 * * * *", cfg.Schedule)
	assert.True(t, cfg.AutoUpdate)
	assert.Equal(t, "start-first", cfg.UpdateStrategy)
}

func TestLoadConfig_ManagedMode(t *testing.T) {
	t.Setenv("CONTROLLER_URL", "ws://controller:3000")
	t.Setenv("AGENT_TOKEN", "test-token")

	cfg := loadConfig()

	assert.Equal(t, "ws://controller:3000", cfg.ControllerURL)
	assert.Equal(t, "test-token", cfg.AgentToken)
}

func TestLoadConfig_MonitorOnlyDisablesAutoUpdate(t *testing.T) {
	clearEnv("CONTROLLER_URL")
	t.Setenv("WW_AUTO_UPDATE", "true")
	t.Setenv("WW_MONITOR_ONLY", "true")

	cfg := loadConfig()

	assert.True(t, cfg.MonitorOnly)
	assert.False(t, cfg.AutoUpdate, "MonitorOnly should override AutoUpdate")
}

func TestValidate_ManagedModeRequiresToken(t *testing.T) {
	cfg := &AgentConfig{ControllerURL: "ws://test:3000", AgentToken: ""}
	assert.Error(t, cfg.validate())

	cfg.AgentToken = "token"
	assert.NoError(t, cfg.validate())
}

func TestValidate_SoloModeNoTokenRequired(t *testing.T) {
	cfg := &AgentConfig{ControllerURL: "", AgentToken: ""}
	assert.NoError(t, cfg.validate())
}

func TestParseHeadersJSON(t *testing.T) {
	headers := parseHeadersJSON(`{"X-Secret":"abc","Content-Type":"text/plain"}`)
	assert.Equal(t, "abc", headers["X-Secret"])
	assert.Equal(t, "text/plain", headers["Content-Type"])
}

func TestParseHeadersJSON_Invalid(t *testing.T) {
	headers := parseHeadersJSON("not json")
	assert.Empty(t, headers)
}
