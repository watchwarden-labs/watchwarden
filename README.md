# WatchWarden

**Distributed Docker container update manager.** Think Watchtower, but with multi-host support, a real-time dashboard, and centralized control.

[![CI](https://github.com/alexneo2003/watchwarden/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/alexneo2003/watchwarden/actions)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE)

---

## Features

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
- **Blue-green updates** — start new container first, verify health, then stop old (zero-downtime)
- **Rollback** — roll back to any previous version or pick a specific tag from the registry
- **Update groups** — label-based dependency ordering (`com.watchwarden.group`, `com.watchwarden.depends_on`)
- **Pinned version detection** — blocks accidental updates for containers with explicit version tags (e.g. `postgres:18-alpine`)
- **Image diff preview** — shows env, port, entrypoint, and volume changes before updating
- **Health-based auto-rollback** — rolls back automatically if a container becomes unhealthy after update
- **Crash-loop detection** — detects and rolls back containers stuck in restart loops
- **Volume pre-flight check** — verifies all bind mount sources exist before attempting an update

### Security & Compliance
- **Private registry support** — encrypted credential storage, auto-synced to agents
- **Vulnerability scanning** — Trivy-based CVE scanning per container image, results stored and broadcast to dashboard
- **Image signing** — optional cosign signature verification before pulling (`REQUIRE_SIGNED_IMAGES=true`)
- **Audit log** — full trail of every check, update, rollback, config change, and agent event

### Notifications
- **Telegram, Slack, Webhook** — configurable channels with batched, deduplicated messages
- **Auto-rollback alerts** — notifies when a container is automatically rolled back

### Resource Management
- **Image pruning** — remove old images per agent, keeping N previous versions for rollback safety
- **Container exclusion** — skip containers via Docker labels (`com.watchwarden.enable=false`)

## WatchWarden vs Watchtower

WatchWarden is a modern alternative to [Watchtower](https://github.com/containrrr/watchtower) with multi-host management and a real-time dashboard.

| Feature | WatchWarden | Watchtower |
|---------|:-----------:|:----------:|
| Web Dashboard | ✅ Real-time UI | ❌ CLI only |
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
| Pinned Version Detection | ✅ Blocks updates for explicit tags | ❌ None |
| Update Scheduling | ✅ Global + per-agent cron | ✅ Cron schedule |
| Audit Log | ✅ Full audit trail | ❌ None |
| Auto-update | ✅ Per-agent or global | ✅ Global |
| Image Pruning | ✅ Keeps N-1 for rollback | ✅ Cleanup flag |
| Docker Version Reporting | ✅ Per-agent in dashboard | ❌ None |
| REST API | ✅ Full CRUD | ❌ None |
| WebSocket Real-time | ✅ Live progress | ❌ None |
| Database | ✅ PostgreSQL | ❌ Stateless |
| License | BSL 1.1 | Apache 2.0 |

---

## Architecture

```
                    ┌──────────────────────┐
                    │     Web UI (React)    │
                    │    :8080              │
                    └──────────┬───────────┘
                               │ WebSocket
                    ┌──────────┴───────────┐
                    │  Controller (Node.js) │
                    │  :3000  PostgreSQL    │
                    └──┬───────────────┬───┘
                       │ WebSocket     │ WebSocket
               ┌───────┴──┐     ┌─────┴────┐
               │  Agent 1  │     │  Agent 2  │
               │  (Go)     │     │  (Go)     │
               └───┬───────┘     └────┬──────┘
                   │ Docker API       │ Docker API
               ┌───┴───┐         ┌───┴───┐
               │Containers│       │Containers│
               └─────────┘       └─────────┘
```

## Quick Start

### One-command deploy

Copy [`docker-compose.production.yml`](docker-compose.production.yml) to any machine with Docker and run:

```bash
curl -O https://raw.githubusercontent.com/alexneo2003/watchwarden/main/docker-compose.production.yml
docker compose -f docker-compose.production.yml up -d
```

That's it. Open **http://localhost:8080** — default password: `admin`.

Pulls pre-built images and starts PostgreSQL + controller + UI + local agent. No cloning, no building, no `.env` file needed.

> For production, edit the passwords and secrets in the file (marked with `⚠️`).

### Build from source

```bash
git clone https://github.com/alexneo2003/watchwarden.git
cd watchwarden
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD, JWT_SECRET, and ENCRYPTION_KEY
docker compose up -d --build
```

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

### Adding a remote agent

1. Go to **Agents → Add Agent** in the UI
2. Copy the generated docker-compose snippet
3. On the remote server:

```bash
docker run -d \
  --name watchwarden-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://YOUR_CONTROLLER:3000 \
  -e AGENT_TOKEN=your-generated-token \
  -e AGENT_NAME=production-server \
  --restart unless-stopped \
  alexneo/watchwarden-agent:latest
```

## Docker Images

| Image | Description |
|-------|-------------|
| `alexneo/watchwarden-controller` | API server + WebSocket hub + scheduler |
| `alexneo/watchwarden-agent` | Lightweight Go agent (one per Docker host) |
| `alexneo/watchwarden-ui` | React dashboard served via Nginx |

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

### Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTROLLER_URL` | **Yes** | — | WebSocket URL (e.g. `ws://controller:3000`) |
| `AGENT_TOKEN` | **Yes** | — | Authentication token (must match a registered agent) |
| `AGENT_NAME` | No | hostname | Display name in dashboard |
| `WATCHWARDEN_LABEL_ENABLE_ONLY` | No | `false` | Only monitor containers with `com.watchwarden.enable=true` |
| `REQUIRE_SIGNED_IMAGES` | No | `false` | Block updates if image signature fails cosign verification |
| `COSIGN_PUBLIC_KEY` | No | — | PEM-encoded cosign public key for signature verification |
| `LOCAL_SCHEDULE` | No | — | Cron expression for offline fallback checks when controller is unreachable |

### Container Labels

| Label | Example Value | Effect |
|-------|--------------|--------|
| `com.watchwarden.enable` | `false` | Exclude from monitoring |
| `com.watchwarden.enable` | `true` | Include (required when `LABEL_ENABLE_ONLY=true`) |
| `com.watchwarden.group` | `backend` | Assign container to an update group |
| `com.watchwarden.priority` | `10` | Update priority within a group (lower = first) |
| `com.watchwarden.depends_on` | `db,cache` | Wait for these containers to update successfully first |

## Development

### Prerequisites

- Node.js 22+
- Go 1.25+
- Docker (Docker Desktop, Colima, or Podman)
- PostgreSQL 18+ (or use Docker)

### Setup

```bash
git clone https://github.com/alexneo2003/watchwarden.git
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
# Controller — 115 tests (needs Docker for testcontainers)
cd controller && npm test

# Agent — 63 tests (use -race for race detection)
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

## License

[Business Source License 1.1](LICENSE) — free to use and self-host. Commercial hosting/reselling requires a separate license. Converts to Apache 2.0 on 2029-03-26.
