---
sidebar_position: 1
title: Agent Environment Variables
---

# Agent Configuration

## Mode Detection

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTROLLER_URL` | — | If set: **Managed Mode** (connects to controller). If unset: **Solo Mode** (standalone). |
| `AGENT_TOKEN` | — | Authentication token for controller (Managed Mode only) |
| `AGENT_NAME` | hostname | Display name for the agent |

## Solo Mode

### Scheduling

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_SCHEDULE` | `@every 24h` | Check schedule. Supports cron (`0 4 * * *`) and intervals (`@every 6h`, `@every 30m`). |
| `WW_AUTO_UPDATE` | `false` | Automatically apply updates when found |
| `WW_MONITOR_ONLY` | `false` | Check for updates but never apply them |

### Update Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_UPDATE_STRATEGY` | `recreate` | `recreate` (stop-first) or `start-first` (blue-green zero-downtime). Blue-green automatically falls back to stop-first for containers with direct port mappings. |
| `WW_PRUNE` | `false` | Remove old images after successful update |
| `WW_STOP_TIMEOUT` | `10` | Container stop timeout in seconds |
| `WW_INCLUDE_STOPPED` | `false` | Also monitor stopped containers |
| `WW_INCLUDE_RESTARTING` | `false` | Also monitor restarting containers |

### Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_NOTIFICATION_URL` | — | Space-separated shoutrrr URLs (e.g. `telegram://TOKEN@telegram?channels=CHATID`) |
| `WW_TELEGRAM_TOKEN` | — | Telegram bot token |
| `WW_TELEGRAM_CHAT_ID` | — | Telegram chat ID (comma-separated for multiple chats) |
| `WW_SLACK_WEBHOOK` | — | Slack incoming webhook URL |
| `WW_WEBHOOK_URL` | — | Generic HTTP POST webhook endpoint |
| `WW_WEBHOOK_HEADERS` | — | JSON object of extra headers: `'{"X-Secret":"abc"}'` |

#### ntfy

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_NTFY_URL` | — | ntfy server URL (e.g., `https://ntfy.sh` or self-hosted) |
| `WW_NTFY_TOPIC` | — | Topic name for notifications |
| `WW_NTFY_PRIORITY` | `default` | Message priority: `low`, `default`, `high`, `urgent` |

```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WW_SCHEDULE="@every 6h" \
  -e WW_NTFY_URL=https://ntfy.sh \
  -e WW_NTFY_TOPIC=watchwarden-updates \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

### Notification Templates

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_NOTIFICATION_TEMPLATE` | — | Go [text/template](https://pkg.go.dev/text/template) for custom message formatting |

Available variables: `{{.AgentName}}`, `{{.ContainerName}}`, `{{.Image}}`, `{{.OldDigest}}`, `{{.NewDigest}}`, `{{.Duration}}`, `{{.Error}}`, `{{.EventType}}`

Example:
```bash
WW_NOTIFICATION_TEMPLATE='{{.ContainerName}} {{.EventType}}\nImage: {{.Image}} ({{.Duration}})'
```

### HTTP Status Server

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_HTTP_PORT` | `8080` | Status server port |
| `WW_HTTP_TOKEN` | — | Bearer token for API auth (optional; `/health` always open) |

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check for Docker HEALTHCHECK |
| `GET` | `/api/status` | Token | Agent mode, schedule, uptime, Docker info |
| `GET` | `/api/containers` | Token | Monitored container list with update status |
| `GET` | `/api/events` | Token | Recent events (checks, updates, errors) |
| `POST` | `/api/check` | Token | Trigger immediate check |
| `POST` | `/api/update/{id}` | Token | Trigger update for specific container |

### Registry Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_DOCKER_USERNAME` | — | Registry username |
| `WW_DOCKER_PASSWORD` | — | Registry password |
| `WW_DOCKER_SERVER` | `index.docker.io` | Registry server |
| `WW_REGISTRY_AUTH` | — | JSON array for multiple registries |

**Example multi-registry:**
```bash
WW_REGISTRY_AUTH='[
  {"registry":"ghcr.io","username":"user","password":"token"},
  {"registry":"registry.example.com","username":"admin","password":"secret"}
]'
```

## Shared (Both Modes)

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path (for rootless Docker/Podman setups) |
| `WATCHWARDEN_LABEL_ENABLE_ONLY` | `false` | Only monitor containers with `com.watchwarden.enable=true` |
| `REQUIRE_SIGNED_IMAGES` | `false` | Block updates if cosign signature verification fails |
| `COSIGN_PUBLIC_KEY` | — | PEM-encoded public key for cosign verification |

## Watchtower Compatibility {#watchtower-compatibility}

All standard Watchtower environment variables are automatically mapped on startup. WatchWarden-native `WW_*` variables take precedence if both are set.

| Watchtower Variable | WatchWarden Equivalent | Transform |
|---|---|---|
| `WATCHTOWER_POLL_INTERVAL` | `WW_SCHEDULE` | Seconds → `@every Ns` |
| `WATCHTOWER_SCHEDULE` | `WW_SCHEDULE` | Direct (cron expression) |
| `WATCHTOWER_CLEANUP` | `WW_PRUNE` | Direct |
| `WATCHTOWER_MONITOR_ONLY` | `WW_MONITOR_ONLY` | Direct |
| `WATCHTOWER_INCLUDE_STOPPED` | `WW_INCLUDE_STOPPED` | Direct |
| `WATCHTOWER_INCLUDE_RESTARTING` | `WW_INCLUDE_RESTARTING` | Direct |
| `WATCHTOWER_LABEL_ENABLE` | `WATCHWARDEN_LABEL_ENABLE_ONLY` | Direct |
| `WATCHTOWER_ROLLING_RESTART` | `WW_UPDATE_STRATEGY` | `true` → `start-first` |
| `WATCHTOWER_TIMEOUT` | `WW_STOP_TIMEOUT` | Direct (seconds) |
| `WATCHTOWER_HTTP_API_TOKEN` | `WW_HTTP_TOKEN` | Direct |
| `WATCHTOWER_NOTIFICATION_URL` | `WW_NOTIFICATION_URL` | Direct (shoutrrr URLs) |
| `WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN` | `WW_TELEGRAM_TOKEN` | Direct |
| `WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID` | `WW_TELEGRAM_CHAT_ID` | Direct |
| `WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL` | `WW_SLACK_WEBHOOK` | Direct |
| `REPO_USER` | `WW_DOCKER_USERNAME` | Direct |
| `REPO_PASS` | `WW_DOCKER_PASSWORD` | Direct |

Mappings are logged at startup:
```
[compat] WATCHTOWER_POLL_INTERVAL=3600 → WW_SCHEDULE=@every 3600s
[compat] WATCHTOWER_CLEANUP=true → WW_PRUNE
```
