# Contributing to WatchWarden

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22+ | [nodejs.org](https://nodejs.org) |
| Go | 1.25+ | [go.dev](https://go.dev/dl/) |
| Docker | Any recent | Docker Desktop, Colima, or Podman |
| PostgreSQL | 18+ | Via Docker: `docker compose up -d postgres` |

### Getting Started

```bash
# Clone the repo
git clone https://github.com/alexneo2003/watchwarden.git
cd watchwarden

# Start PostgreSQL
docker compose up -d postgres

# Install controller dependencies
cd controller && npm install && cd ..

# Install UI dependencies
cd ui && npm install && cd ..

# Install Go dependencies
cd agent && go mod tidy && cd ..
```

### Running Locally

```bash
# Terminal 1: Controller
cd controller
DATABASE_URL=postgresql://watchwarden:watchwarden@localhost:5432/watchwarden npm run dev

# Terminal 2: UI
cd ui
npm run dev

# Terminal 3: Agent (optional, needs Docker socket)
cd agent
CONTROLLER_URL=ws://localhost:3000 AGENT_TOKEN=your-token AGENT_NAME=dev go run .
```

The UI is at http://localhost:5173 (Vite dev server with proxy to controller).

## Running Tests

```bash
# All controller tests (needs Docker for testcontainers)
cd controller && npm test

# Specific test file
cd controller && npx vitest run src/db/__tests__/queries.test.ts

# Agent tests
cd agent && go test ./... -count=1 -v

# UI tests
cd ui && npm test
```

## Code Style

### TypeScript (Controller + UI)

We use **Biome** for linting and formatting (not ESLint/Prettier):

```bash
# Check
npm run lint        # tsc --noEmit && biome check .

# Auto-fix
npm run lint:fix    # biome check --fix .

# Format
npm run format      # biome format --write .
```

Key rules:
- Single quotes, semicolons always
- 2-space indent, 100-char line width
- No unused variables/imports (warning)
- No explicit `any` without a comment explaining why
- TypeScript strict mode everywhere

### Go (Agent)

Standard `gofmt` formatting. Run `go vet ./...` before committing.

### TDD

We follow Test-Driven Development:
1. Write a failing test
2. Implement the minimum code to pass
3. Refactor

Tests live in `__tests__/` directories (TypeScript) or `*_test.go` files (Go).

## Project Structure

```
watchwarden/
├── controller/src/           # Node.js + TypeScript
│   ├── index.ts              # Entry point
│   ├── types.ts              # Shared types
│   ├── db/                   # PostgreSQL queries + migrations
│   ├── api/routes/           # REST API endpoints
│   ├── ws/                   # WebSocket hub + UI broadcaster
│   ├── scheduler/            # Cron scheduler
│   ├── notifications/        # Telegram/Slack/Webhook senders
│   └── lib/                  # Crypto, registry client
├── agent/                    # Go agent
│   ├── main.go               # Entry point (shared init + mode branch)
│   ├── config.go             # Centralized config from env vars
│   ├── compat.go             # Watchtower env var compatibility
│   ├── managed.go            # Managed mode (WebSocket + controller)
│   ├── solo.go               # Solo mode (standalone scheduler + notify)
│   ├── notify.go             # Notification senders (Telegram, Slack, Webhook)
│   ├── httpserver.go         # HTTP status server (/health, /api/*)
│   ├── docker.go             # Docker SDK wrapper
│   ├── updater.go            # Atomic update/rollback
│   ├── ws.go                 # WebSocket client
│   ├── healthmon.go          # Health monitoring + crash-loop detection
│   ├── snapshot_store.go     # Snapshot persistence for rollback
│   └── credstore.go          # Registry credentials
├── ui/src/                   # React + TypeScript
│   ├── api/hooks/            # TanStack Query hooks
│   ├── ws/                   # WebSocket hook
│   ├── store/                # Zustand store
│   ├── components/           # shadcn/ui components
│   └── pages/                # Route pages
└── docker-compose.yml
```

## How To...

### Add a new API endpoint

1. Add the route in `controller/src/api/routes/<domain>.ts`
2. If it needs DB access, add query functions in `controller/src/db/queries.ts` (all async)
3. Register the route plugin in `controller/src/index.ts` if it's a new file
4. Write tests in `controller/src/api/__tests__/`

### Add a new WebSocket message

1. Define the message type in `controller/src/types.ts`
2. Handle it in `controller/src/ws/hub.ts` (agent→controller) or `controller/src/ws/ui-broadcaster.ts` (controller→UI)
3. Handle it in `agent/main.go` (controller→agent) or `agent/ws.go`
4. Handle it in `ui/src/store/useStore.ts` `handleWSEvent` (controller→UI)

### Add a new UI page

1. Create the page component in `ui/src/pages/`
2. Add the route in `ui/src/App.tsx`
3. Add a sidebar link in `ui/src/components/layout/Sidebar.tsx`
4. Create any needed API hooks in `ui/src/api/hooks/`

### Add a new shadcn component

```bash
cd ui
npx shadcn add <component-name>
```

Note: shadcn v4 uses `@base-ui/react`, not Radix. Use `render` prop instead of `asChild`.

## Branch Naming

| Prefix | Use |
|--------|-----|
| `feature/` | New features (`feature/notification-discord`) |
| `fix/` | Bug fixes (`fix/rollback-stale-id`) |
| `chore/` | Maintenance (`chore/upgrade-deps`) |
| `docs/` | Documentation only |

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(agent): add Docker label filtering
fix(hub): handle null containers in heartbeat
docs: update README with Docker Hub images
chore(controller): migrate to PostgreSQL
```

## Pull Request Process

1. Create a branch from `main`
2. Make your changes
3. Run the full verification:
   ```bash
   cd controller && npm run lint && npm test
   cd ../agent && go vet ./... && go test -race ./...
   cd ../ui && npm run lint && npm test
   ```
4. Open a PR against `main`
5. CI will run tests automatically
6. After review and approval, squash-merge

## Questions?

Open an issue or start a discussion on GitHub.
