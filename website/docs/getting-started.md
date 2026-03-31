---
sidebar_position: 1
title: Getting Started
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Getting Started

WatchWarden runs in two modes. Pick the one that fits your setup.

<Tabs>
<TabItem value="solo" label="Solo Mode (Standalone)" default>

**No controller, no database, no UI.** Just mount the Docker socket and go.

```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WW_SCHEDULE="@every 6h" \
  -e WW_AUTO_UPDATE=true \
  --restart unless-stopped \
  alexneo/watchwarden-agent:latest
```

Add Telegram notifications:

```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WW_SCHEDULE="@every 6h" \
  -e WW_AUTO_UPDATE=true \
  -e WW_TELEGRAM_TOKEN=123456:ABC-DEF \
  -e WW_TELEGRAM_CHAT_ID=-100123456 \
  --restart unless-stopped \
  alexneo/watchwarden-agent:latest
```

**Key Solo Mode variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_SCHEDULE` | `@every 24h` | Check interval (`@every 6h`) or cron (`0 4 * * *`) |
| `WW_AUTO_UPDATE` | `false` | Automatically apply updates |
| `WW_UPDATE_STRATEGY` | `recreate` | `recreate` or `start-first` (blue-green) |
| `WW_PRUNE` | `false` | Remove old images after update |

See [Agent Configuration](/docs/configuration/agent-env) for the full reference.

</TabItem>
<TabItem value="managed" label="Managed Mode (Full UI)">

**Multi-host management** with a central controller, real-time dashboard, and per-agent configuration.

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: watchwarden
      POSTGRES_USER: watchwarden
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  controller:
    image: alexneo/watchwarden-controller:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://watchwarden:${POSTGRES_PASSWORD}@postgres:5432/watchwarden
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    depends_on:
      postgres:
        condition: service_healthy

  ui:
    image: alexneo/watchwarden-ui:latest
    ports:
      - "8080:8080"
    depends_on:
      - controller

  agent:
    image: alexneo/watchwarden-agent:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTROLLER_URL: ws://controller:3000
      AGENT_TOKEN: ${LOCAL_AGENT_TOKEN}
      AGENT_NAME: local

volumes:
  postgres_data:
```

Generate secrets and start:

```bash
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export ADMIN_PASSWORD=$(openssl rand -base64 16)
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export LOCAL_AGENT_TOKEN=$(openssl rand -base64 32)

docker compose up -d
```

Open **http://localhost:8080** and log in.

### Adding Remote Agents

1. Go to **Agents > Add Agent** in the dashboard
2. Copy the generated token
3. On the remote host:

```bash
docker run -d \
  --name watchwarden-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://YOUR_CONTROLLER_IP:3000 \
  -e AGENT_TOKEN=your-generated-token \
  -e AGENT_NAME=production-server \
  --restart unless-stopped \
  alexneo/watchwarden-agent:latest
```

</TabItem>
</Tabs>

## What's Next?

- [Configuration Reference](/docs/configuration/agent-env) — all environment variables
- [Architecture](/docs/architecture) — how the components work together
- [WatchWarden vs Watchtower](/docs/comparison) — feature comparison
