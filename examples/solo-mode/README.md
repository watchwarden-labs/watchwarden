# Solo Mode

Run WatchWarden as a standalone agent on a single host. No controller or database needed.

## Quick Start

```bash
docker compose up -d
```

## Configuration

### Schedule

Set `WW_SCHEDULE` to control how often WatchWarden checks for updates:

- `@every 6h` -- every 6 hours
- `@every 30m` -- every 30 minutes
- `0 4 * * *` -- daily at 4 AM (standard cron)
- `@daily` -- once per day at midnight

### Auto-Update

- `WW_AUTO_UPDATE=true` -- automatically pull and recreate containers
- `WW_AUTO_UPDATE=false` -- check only, notify but do not update

### Notifications

Uncomment one of the notification blocks in `docker-compose.yml`:

| Provider | Variables |
|----------|-----------|
| Telegram | `WW_TELEGRAM_TOKEN`, `WW_TELEGRAM_CHAT_ID` |
| ntfy | `WW_NTFY_URL`, `WW_NTFY_TOPIC` |
| Slack | `WW_SLACK_WEBHOOK` |

### Excluding Containers

Add a label to containers you want WatchWarden to ignore:

```yaml
labels:
  - "com.watchwarden.ignore=true"
```
