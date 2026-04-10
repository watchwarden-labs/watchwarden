# WatchWarden

**Distributed Docker container update manager.** Think Watchtower, but with multi-host support, a real-time dashboard, and centralized control.

[![CI](https://github.com/watchwarden-labs/watchwarden/actions/workflows/release.yml/badge.svg)](https://github.com/watchwarden-labs/watchwarden/actions)
[![Release](https://img.shields.io/github/v/release/watchwarden-labs/watchwarden)](https://github.com/watchwarden-labs/watchwarden/releases/latest)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE)
[![Controller](https://ghcr-badge.egpl.dev/watchwarden-labs/watchwarden-controller/size?label=controller)](https://github.com/watchwarden-labs/watchwarden/pkgs/container/watchwarden-controller)
[![Agent](https://ghcr-badge.egpl.dev/watchwarden-labs/watchwarden-agent/size?label=agent)](https://github.com/watchwarden-labs/watchwarden/pkgs/container/watchwarden-agent)
[![UI](https://ghcr-badge.egpl.dev/watchwarden-labs/watchwarden-ui/size?label=ui)](https://github.com/watchwarden-labs/watchwarden/pkgs/container/watchwarden-ui)

---

## Project Status

WatchWarden is currently in an **early-adopter / beta** stage.

- The core architecture and features were initially developed with significant assistance from AI tools, then iterated on through manual review, refactoring, security audits, and automated tests (380+ tests across controller, agent, and UI).
- Security features (API token authentication, scoped access, rate limiting, timing-safe comparisons) were designed with modern best practices and have passed focused security reviews.
- The project is actively used by the maintainer across multiple Docker hosts, but **has not yet seen extensive large-scale production use** in diverse environments. Some edge cases in complex setups (unusual network modes, non-standard registries, large container counts) may still surface.

**Before using WatchWarden for critical workloads:**
- Test thoroughly in a staging or sandbox environment first.
- Start with `com.watchwarden.policy=notify` on important containers before enabling auto-update.
- Open issues with details about your environment if you encounter unexpected behavior.

---

## Features

### Solo Mode (Watchtower replacement)
- **Zero-config standalone** — runs without Controller/UI, just mount docker.sock
- **Watchtower drop-in** — supports all standard `WATCHTOWER_*` environment variables
- **Cron & interval scheduling** — `WW_SCHEDULE="@every 6h"` or `WW_SCHEDULE="0 4 * * *"`
- **Built-in notifications** — Telegram, Slack, and generic webhooks via env vars
- **HTTP status API** — `/health`, `/api/containers`, `/api/events` for monitoring
- **All advanced features** — blue-green updates, crash recovery, auto-rollback work in Solo Mode

### Dashboard & Monitoring
- **Real-time dashboard** — WebSocket-powered live progress for check, update, and rollback operations
- **Grid & list views** — switch between card and table layouts for agents
- **Health monitoring** — tracks container health status with configurable stability windows
- **Docker version info** — displays Docker engine version, API version, and OS/arch per agent
- **Dark theme UI** — built with React, shadcn/ui, and Tailwind CSS

### Multi-host Management
- **Multi-host control** — deploy lightweight Go agents on any Docker host, manage from one dashboard
- **Automatic reconnect** — agents reconnect on controller restart with exponential backoff
- **Local schedule fallback** — agents run cron checks independently when controller is unreachable

### Updates & Rollback
- **Automatic updates** — schedule checks globally or per-agent, with optional auto-update
- **Minimum update age** — hold back auto-updates until an available update has been visible for N hours (configurable per agent), avoiding races with newly-broken tags
- **Blue-green updates** — start new container first, verify health, then stop old (zero-downtime). Automatically falls back to stop-first if port conflicts are detected (e.g. containers with direct port mappings)
- **Rollback** — roll back to any previous version or pick a specific tag from the registry
- **Update groups** — label-based (`com.watchwarden.group`, `com.watchwarden.depends_on`) or UI-editable: assign group name, priority, and dependencies per container directly from the dashboard
- **Per-container policies** — label-driven control: `com.watchwarden.policy=auto|notify|manual` per container; editable from the UI without labels
- **Semver update levels** — restrict how far images can be upgraded (`patch`, `minor`, `major`) per container or globally via Settings; enforced before auto-update
- **Tag pattern matching** — filter registry tags by regex via `com.watchwarden.tag_pattern` label or the UI policy dialog with built-in presets (semver, v-semver, date, numeric)
- **Pinned version detection** — blocks accidental updates for containers with explicit version tags (e.g. `postgres:16.2-alpine`), while correctly treating floating tags (`alpine`, `lts`, `stable`) as updatable
- **Config-only change detection** — detects image updates even when only entrypoint/env/labels changed (same manifest digest, different image ID)
- **Image diff preview** — shows env, port, entrypoint, and volume changes before updating; diff is also persisted in update history so you can review configuration changes post-update
- **Image tags in history** — update history shows human-readable image references (`postgres:16.2 → postgres:latest`) alongside the digest; old records fall back to digest-only display
- **Health-based auto-rollback** — rolls back automatically if a container becomes unhealthy after update, respects healthcheck `start_period` for slow-starting containers
- **Crash-loop detection** — detects and rolls back containers stuck in restart loops (requires 3+ restarts in 60s to avoid false positives)
- **AutoRemove container support** — safely updates `--rm` containers by handling Docker API 409/404 during removal
- **Stateful container protection** — auto-detects 30+ known database/stateful images (postgres, mysql, mongo, redis, etc.) and skips them during "Update All" and auto-update to prevent data loss. Individual explicit updates still work. Override with `com.watchwarden.stateful=true|false` label.
- **Volume pre-flight check** — verifies all bind mount sources exist before attempting an update

### Security & Compliance
- **Private registry support** — encrypted credential storage with ECR/GCR/ACR cloud auth, auto-synced to agents
- **Vulnerability scanning** — Trivy-based CVE scanning per container image, results stored and broadcast to dashboard
- **Image signing** — optional cosign signature verification before pulling (`REQUIRE_SIGNED_IMAGES=true`)
- **API token authentication** — scoped tokens (`full`, `read`, `write`) with optional expiration for external integrations
- **Audit log** — full trail of every check, update, rollback, config change, and agent event
- **Container hardening** — production compose uses `read_only`, `no-new-privileges`, and `tmpfs` for controller and UI services

### Integrations
- **Integration API** — stable REST API at `/api/integrations/watchwarden/*` for Home Assistant, CI/CD, and custom tools
- **Home Assistant** — custom integration (planned) with sensors and services for container management
- **TypeScript SDK** — `@watchwarden/sdk` for programmatic access

### Observability
- **Prometheus metrics** — `/metrics` endpoint with per-container labeled gauges (`container_info`, `container_has_update`, `container_last_updated_ms`) and aggregate counters for agents, update counts by status
- **Registry ETag caching** — agent caches OCI v2 tag-list responses with ETag/If-None-Match; 304 Not Modified responses skip JSON parsing entirely, reducing registry bandwidth on repeated checks
- **Rate-limit backoff** — automatically backs off and retries on 429/503 registry responses, honouring `Retry-After` headers (capped at 60 s) before retrying once
- **Diagnostics bundle** — downloadable ZIP from Settings → About containing controller info, agent statuses, registry credential summary (passwords redacted), anonymous Docker Hub image list, and recent controller logs

### Notifications
- **Telegram, Slack, Webhook, ntfy** — configurable channels with batched, deduplicated messages
- **Notification templates** — customize message format with Go text/template (`WW_NOTIFICATION_TEMPLATE`)
- **Link templates** — auto-generated links to Docker Hub, GHCR, or Quay.io tag pages in notifications
- **Auto-rollback alerts** — notifies when a container is automatically rolled back

### Resource Management
- **Image pruning** — remove old images per agent, keeping N previous versions for rollback safety
- **Container exclusion** — skip containers via Docker labels (`com.watchwarden.enable=false`)

## WatchWarden vs Watchtower

WatchWarden is a modern alternative to [Watchtower](https://github.com/containrrr/watchtower). Use it as a drop-in replacement (Solo Mode) or scale to multi-host with the Controller + UI.

| Feature | WatchWarden | Watchtower |
|---------|:-----------:|:----------:|
| Standalone Mode | ✅ Solo + Managed | ✅ Standalone only |
| Watchtower Env Var Compat | ✅ Drop-in replacement | — |
| Web Dashboard | ✅ Real-time UI (Managed Mode) | ❌ CLI only |
| Multi-host Management | ✅ Central controller + agents | ❌ Single host |
| Rollback | ✅ Any version + version picker | ❌ None |
| Update Groups / Dependencies | ✅ Label-based ordering | ❌ None |
| Private Registry Auth | ✅ Encrypted, synced to agents | ✅ Config file |
| Notifications | ✅ Telegram, Slack, Webhook | ✅ Email, Slack, etc. |
| Container Exclusion | ✅ Labels | ✅ Labels |
| Health-based Auto-Rollback | ✅ Stability window + crash-loop detection | ❌ None |
| Blue-green Updates | ✅ Zero-downtime, health-verified | ❌ None |
| Vulnerability Scanning | ✅ Trivy-based CVE scanning | ❌ None |
| Image Signing (Cosign) | ✅ Verify before pull | ❌ None |
| Image Diff Preview | ✅ Before update | ❌ None |
| Stateful Container Protection | ✅ Auto-skips databases in bulk updates | ❌ None |
| Pinned Version Detection | ✅ Blocks explicit tags, allows floating | ❌ None |
| Config-only Change Detection | ✅ Detects entrypoint/env changes | ❌ None |
| AutoRemove (`--rm`) Support | ✅ Handles 409/404 gracefully | ❌ Breaks |
| Update Scheduling | ✅ Global + per-agent cron | ✅ Cron schedule |
| Audit Log | ✅ Full audit trail | ❌ None |
| Auto-update | ✅ Per-agent or global | ✅ Global |
| Image Pruning | ✅ Keeps N-1 for rollback | ✅ Cleanup flag |
| ntfy Notifications | ✅ Dedicated sender | ❌ None |
| Notification Templates | ✅ Customizable | ❌ Fixed format |
| Per-container Policies | ✅ Label-driven | ❌ Global only |
| Tag Pattern Matching | ✅ Regex + UI presets | ❌ None |
| Update Groups / Dependencies UI | ✅ Edit group, priority, deps in dashboard | ❌ None |
| Registry ETag Caching | ✅ 304 shortcut, bandwidth-efficient | ❌ Polls every time |
| Registry Rate-limit Backoff | ✅ 429/503 retry with Retry-After | ❌ None |
| Diagnostics Bundle | ✅ Downloadable ZIP with logs + registry info | ❌ None |
| Update History Image Tags | ✅ Shows `image:tag` not just SHA256 | ❌ None |
| Prometheus Metrics | ✅ /metrics endpoint | ❌ None |
| Cloud Registry Auth | ✅ ECR/GCR/ACR | ❌ Basic only |
| API Token Auth | ✅ Scoped tokens with expiration | ❌ None |
| Integration API | ✅ Stable HTTP contract for HA/CI | ❌ None |
| TypeScript SDK | ✅ @watchwarden/sdk | ❌ None |
| Docker Version Reporting | ✅ Per-agent in dashboard | ❌ None |
| REST API | ✅ Full CRUD | ❌ None |
| WebSocket Real-time | ✅ Live progress | ❌ None |
| Database | ✅ PostgreSQL | ❌ Stateless |
| License | BSL 1.1 | Apache 2.0 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web UI (React)                       │
│                       :8080                             │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket
┌────────────────────────┴────────────────────────────────┐
│               Controller (Node.js) :3000                │
│          ┌──────────────────────────────┐               │
│          │     PostgreSQL :5432         │               │
│          └──────────────────────────────┘               │
└──────┬──────────────────────────────────────┬───────────┘
       │ WebSocket                            │ WebSocket
┌──────┴──────────┐                  ┌────────┴─────────┐
│   Agent (Go)    │                  │   Agent (Go)     │
│   Host A        │                  │   Host B         │
└──────┬──────────┘                  └────────┬─────────┘
       │ Docker API                           │ Docker API
       ▼                                      ▼
┌─────────────┐                      ┌─────────────┐
│ Containers  │                      │ Containers  │
└─────────────┘                      └─────────────┘
```

## Quick Start

### Solo Mode (Watchtower replacement)

Run the agent standalone — no controller, no database, no UI required:

```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WW_SCHEDULE="@every 1h" \
  -e WW_AUTO_UPDATE=true \
  --restart unless-stopped \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

Add notifications:
```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WW_SCHEDULE="@every 6h" \
  -e WW_AUTO_UPDATE=true \
  -e WW_TELEGRAM_TOKEN=123456:ABC-DEF \
  -e WW_TELEGRAM_CHAT_ID=-100123456 \
  --restart unless-stopped \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

Drop-in Watchtower replacement (same env vars):
```bash
docker run -d \
  --name watchwarden \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_POLL_INTERVAL=3600 \
  -e WATCHTOWER_CLEANUP=true \
  -e WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN=123456:ABC-DEF \
  -e WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID=-100123456 \
  --restart unless-stopped \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

### Multi-host deploy (Controller + UI + Agents)

### One-command deploy

Copy [`docker-compose.production.yml`](docker-compose.production.yml) to any machine with Docker and run:

```bash
curl -O https://raw.githubusercontent.com/watchwarden-labs/watchwarden/main/docker-compose.production.yml
docker compose -f docker-compose.production.yml up -d
```

That's it. Open **http://localhost:8080** — default password: `admin`.

Pulls pre-built images and starts PostgreSQL + controller + UI + local agent. No cloning, no building, no `.env` file needed.

> For production, edit the passwords and secrets in the file (marked with `⚠️`).

### Build from source

```bash
git clone https://github.com/watchwarden-labs/watchwarden.git
cd watchwarden
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD, JWT_SECRET, and ENCRYPTION_KEY
docker compose up -d --build
```

### Examples

See the `examples/` directory for ready-to-use configurations:
- **[Solo Mode](examples/solo-mode/)** — standalone agent with notifications
- **[Multi-host](examples/multi-host/)** — controller + remote agents
- **[Private Registry](examples/private-registry/)** — Docker Hub, GHCR, custom registry auth
- **[Reverse Proxy](examples/reverse-proxy/)** — Traefik with automatic TLS
- **[Update Groups](examples/update-groups/)** — dependency-ordered updates

### Docker socket permissions

The agent runs as a non-root `warden` user for security but needs access to `/var/run/docker.sock`. The agent's entrypoint script **automatically detects** the socket's group ID at runtime and adds the `warden` user to the appropriate group. No manual `DOCKER_GID` configuration is needed.

This works across all platforms:

| Platform | Socket GID | How it works |
|----------|------------|--------------|
| Linux (standard Docker) | `999` (docker group) | Detects GID, adds `warden` to `docker` group |
| macOS (Docker Desktop) | `0` (root) | Adds `warden` to `root` group |
| macOS (Colima) | varies (e.g. `991`) | Detects GID, creates `dockersock` group |
| Windows (Docker Desktop / WSL2) | `0` (root) | Same as macOS Docker Desktop |

> **Security note**: Docker socket access (`/var/run/docker.sock`) grants effective root-equivalent access on the host. The agent needs this to manage containers. If you require stronger isolation, consider using a [Docker socket proxy](https://github.com/Tecnativa/docker-socket-proxy) to restrict API access to only the endpoints the agent needs (`CONTAINERS=1`, `IMAGES=1`, `NETWORKS=1`).

### Rootless Docker & Podman

WatchWarden supports rootless Docker and Podman out of the box. The agent uses `client.FromEnv`, which respects the `DOCKER_HOST` environment variable.

**Rootless Docker:**
```bash
docker run -d \
  --name watchwarden-agent \
  -v $XDG_RUNTIME_DIR/docker.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://controller:3000 \
  -e AGENT_TOKEN=your-token \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

**Podman:**
```bash
podman run -d \
  --name watchwarden-agent \
  -v $XDG_RUNTIME_DIR/podman/podman.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://controller:3000 \
  -e AGENT_TOKEN=your-token \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

**Docker Compose (rootless):**
Set `DOCKER_SOCKET` in your `.env` file:
```bash
DOCKER_SOCKET=/run/user/1000/docker.sock
```

Or pass it on the command line:
```bash
DOCKER_SOCKET=$XDG_RUNTIME_DIR/docker.sock docker compose up -d
```

### Adding a remote agent

1. Go to **Agents → Add Agent** in the UI
2. Copy the generated docker-compose snippet
3. On the remote server:

```bash
docker run -d \
  --name watchwarden-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v watchwarden_snapshots:/var/lib/watchwarden/snapshots \
  -e CONTROLLER_URL=ws://YOUR_CONTROLLER:3000 \
  -e AGENT_TOKEN=your-generated-token \
  -e AGENT_NAME=production-server \
  --restart unless-stopped \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

> **Snapshot volume**: The `-v watchwarden_snapshots:/var/lib/watchwarden/snapshots` mount persists rollback snapshots across agent restarts. Without it, snapshots are stored in memory only and lost on restart. The agent works without this volume but crash recovery after an agent restart won't be able to restore containers.
>
> **Bind mount permissions**: If using a bind mount (e.g. `-v /docker/watchwarden/snapshots:/var/lib/watchwarden/snapshots`) instead of a named volume, ensure the directory is owned by UID `100:101` (the `warden` user inside the container): `sudo chown 100:101 /docker/watchwarden/snapshots`

## Docker Images

| Image | Description |
|-------|-------------|
| `ghcr.io/watchwarden-labs/watchwarden-controller` | API server + WebSocket hub + scheduler |
| `ghcr.io/watchwarden-labs/watchwarden-agent` | Lightweight Go agent (one per Docker host) |
| `ghcr.io/watchwarden-labs/watchwarden-ui` | React dashboard served via Nginx |

### Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `beta` | Pre-release / develop branch |
| `x.y.z` | Specific version (e.g. `0.1.0`) |
| `sha-abc1234` | Specific commit |

## Configuration

### Controller

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `ADMIN_PASSWORD` | **Yes** (first run) | — | Dashboard login password. Stored as bcrypt hash on first startup; env var can be removed after. |
| `JWT_SECRET` | **Yes** (first run) | — | JWT signing secret. Stored in DB on first startup. |
| `ENCRYPTION_KEY` | **Yes** | — | AES-256 key for encrypting registry credentials. Must be set on every startup. |
| `CORS_ORIGIN` | **Yes** (production) | `http://localhost:8080` | Allowed CORS origin. **Required** when `NODE_ENV=production`; throws if unset. |
| `ENCRYPTION_SALT` | Recommended | `watchwarden-salt` | Salt for scrypt key derivation. **Set a unique value per deployment** — warns at startup in production if unset. Changing this invalidates all existing encrypted data (registry credentials, notification configs). |
| `LOCAL_AGENT_TOKEN` | No | — | Auto-register a local agent with this pre-shared token |
| `PORT` | No | `3000` | HTTP/WS server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `NODE_ENV` | No | `development` | Set to `production` to enforce CORS_ORIGIN and enable secure cookies |

> **Database config keys** (set via Settings UI or `PUT /api/config`):
>
> | Key | Default | Description |
> |-----|---------|-------------|
> | `check_on_startup` | `false` | Run a catch-up check on startup if last scheduled check was >24h ago |

### Agent — Managed Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTROLLER_URL` | **Yes** | — | WebSocket URL (e.g. `ws://controller:3000`). If unset, agent runs in Solo Mode. |
| `AGENT_TOKEN` | **Yes** | — | Authentication token (must match a registered agent) |
| `AGENT_NAME` | No | hostname | Display name in dashboard |

### Agent — Solo Mode

When `CONTROLLER_URL` is not set, the agent runs autonomously.

| Variable | Default | Description |
|----------|---------|-------------|
| `WW_SCHEDULE` | `@every 24h` | Check schedule (cron expression or `@every` interval) |
| `WW_AUTO_UPDATE` | `false` | Automatically apply updates (set `true` to enable) |
| `WW_MONITOR_ONLY` | `false` | Check only, never update |
| `WW_UPDATE_STRATEGY` | `recreate` | `recreate` (stop-first) or `start-first` (blue-green zero-downtime). Blue-green auto-falls back to stop-first for containers with port mappings. |
| `WW_PRUNE` | `false` | Remove old images after update |
| `WW_STOP_TIMEOUT` | `10` | Container stop timeout in seconds |
| `WW_TELEGRAM_TOKEN` | — | Telegram bot token for notifications |
| `WW_TELEGRAM_CHAT_ID` | — | Telegram chat ID (comma-separated for multiple) |
| `WW_SLACK_WEBHOOK` | — | Slack incoming webhook URL |
| `WW_WEBHOOK_URL` | — | Generic HTTP POST webhook |
| `WW_WEBHOOK_HEADERS` | — | JSON object of extra headers for webhook |
| `WW_NOTIFICATION_URL` | — | Space-separated shoutrrr URLs (`telegram://...`, `slack://...`) |
| `WW_HTTP_PORT` | `8080` | HTTP status server port |
| `WW_HTTP_TOKEN` | — | Bearer token for HTTP API (optional) |
| `WW_DOCKER_USERNAME` | — | Registry username |
| `WW_DOCKER_PASSWORD` | — | Registry password |
| `WW_DOCKER_SERVER` | `index.docker.io` | Registry server |
| `WW_NTFY_URL` | — | ntfy server URL (e.g. `https://ntfy.sh`) |
| `WW_NTFY_TOPIC` | — | ntfy topic name |
| `WW_NTFY_PRIORITY` | `default` | ntfy priority: `low`, `default`, `high`, `urgent` |
| `WW_NOTIFICATION_TEMPLATE` | — | Go text/template for custom notification formatting |

### Agent — Shared (both modes)

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_NAME` | hostname | Display name |
| `WATCHWARDEN_LABEL_ENABLE_ONLY` | `false` | Only monitor containers with `com.watchwarden.enable=true` |
| `REQUIRE_SIGNED_IMAGES` | `false` | Block updates if image signature fails cosign verification |
| `COSIGN_PUBLIC_KEY` | — | PEM-encoded cosign public key |

### Watchtower Compatibility

All standard Watchtower environment variables are automatically mapped to WatchWarden equivalents:

| Watchtower Variable | WatchWarden Equivalent |
|---|---|
| `WATCHTOWER_POLL_INTERVAL` | `WW_SCHEDULE` (converted to `@every Ns`) |
| `WATCHTOWER_SCHEDULE` | `WW_SCHEDULE` |
| `WATCHTOWER_CLEANUP` | `WW_PRUNE` |
| `WATCHTOWER_MONITOR_ONLY` | `WW_MONITOR_ONLY` |
| `WATCHTOWER_LABEL_ENABLE` | `WATCHWARDEN_LABEL_ENABLE_ONLY` |
| `WATCHTOWER_ROLLING_RESTART` | `WW_UPDATE_STRATEGY=start-first` |
| `WATCHTOWER_HTTP_API_TOKEN` | `WW_HTTP_TOKEN` |
| `WATCHTOWER_NOTIFICATION_TELEGRAM_TOKEN` | `WW_TELEGRAM_TOKEN` |
| `WATCHTOWER_NOTIFICATION_TELEGRAM_CHAT_ID` | `WW_TELEGRAM_CHAT_ID` |
| `WATCHTOWER_NOTIFICATION_SLACK_HOOK_URL` | `WW_SLACK_WEBHOOK` |
| `REPO_USER` / `REPO_PASS` | `WW_DOCKER_USERNAME` / `WW_DOCKER_PASSWORD` |

### Container Labels

| Label | Example Value | Effect |
|-------|--------------|--------|
| `com.watchwarden.enable` | `false` | Exclude from monitoring |
| `com.watchwarden.enable` | `true` | Include (required when `LABEL_ENABLE_ONLY=true`) |
| `com.watchwarden.group` | `backend` | Assign container to an update group |
| `com.watchwarden.priority` | `10` | Update priority within a group (lower = first) |
| `com.watchwarden.depends_on` | `db,cache` | Wait for these containers to update successfully first |
| `com.watchwarden.policy` | `auto` / `notify` / `manual` | Per-container update policy |
| `com.watchwarden.tag_pattern` | `^v3\.\d+$` | Filter tags by regex for update checks |
| `com.watchwarden.update_level` | `major` / `minor` / `patch` / `all` | Semver level filter for updates (requires `tag_pattern`) |
| `com.watchwarden.pinned` | `true` | Force-pin a floating tag (skip update checks) |
| `com.watchwarden.stateful` | `true` / `false` | Override stateful auto-detection (stateful containers are skipped by bulk updates) |

## Development

### Prerequisites

- Node.js 22+
- Go 1.25+
- Docker (Docker Desktop, Colima, or Podman)
- PostgreSQL 18+ (or use Docker)

### Setup

```bash
git clone https://github.com/watchwarden-labs/watchwarden.git
cd watchwarden

# Start PostgreSQL
docker compose up -d postgres

# Controller
cd controller
npm install
DATABASE_URL=postgresql://watchwarden:watchwarden@localhost:5432/watchwarden npm run dev

# Agent (in another terminal)
cd agent
go run .

# UI (in another terminal)
cd ui
npm install
npm run dev
```

### Running Tests

```bash
# Controller — 181 tests (needs Docker for testcontainers)
cd controller && npm test

# Agent — 160 tests (use -race for race detection)
cd agent && go test -race ./... -count=1

# UI — 50 tests
cd ui && npm test
```


### Tech Stack

- **Controller**: Node.js 22, Fastify 5, TypeScript, PostgreSQL (postgres.js), WebSocket
- **Agent**: Go 1.25, Docker SDK, gorilla/websocket
- **UI**: React 19, Vite, TanStack Query, Zustand, shadcn/ui, Tailwind CSS v4
- **Linting**: Biome (TypeScript), gofmt (Go)
- **Testing**: Vitest + testcontainers (controller), Go testing + testify (agent), Vitest + React Testing Library (UI)
- **SDK**: `@watchwarden/types` + `@watchwarden/sdk` (TypeScript, in `packages/`)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

## License

[Business Source License 1.1](LICENSE) — free to use and self-host. Commercial hosting/reselling requires a separate license. Converts to Apache 2.0 on 2029-03-26.
