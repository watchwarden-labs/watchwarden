# WatchWarden

Distributed Docker container update manager with a central Controller, lightweight Agents, and a web UI.

## Architecture

```
┌─────────┐  WS   ┌────────────┐  WS   ┌─────────┐
│  Agent   │◄─────►│ Controller │◄─────►│   UI    │
│  (Go)   │       │ (Node/TS)  │       │ (React) │
└────┬────┘       └─────┬──────┘       └─────────┘
     │                  │
  Docker           PostgreSQL
  Socket
```

## Tech Stack

- **Controller**: Node.js 22, Fastify 5, TypeScript strict, PostgreSQL (postgres.js), ws, node-cron, JWT
- **Agent**: Go 1.25+, Docker SDK, gorilla/websocket, robfig/cron
- **UI**: React 19, TypeScript, Vite, TanStack Query v5, Zustand, shadcn/ui, Tailwind CSS v4

## Development Commands

### Controller
```bash
cd controller
npm install          # Install dependencies
npm run dev          # Start dev server (tsx watch)
npm run build        # Compile TypeScript
npm run start        # Run compiled JS
npm test             # Run tests (vitest)
npm test -- src/db/  # Run specific test dir
```

### Agent
```bash
cd agent
go mod tidy          # Install dependencies
go build .           # Build binary
go test ./...        # Run all tests
go test -v -run TestUpdater  # Run specific test
```

### UI
```bash
cd ui
npm install          # Install dependencies
npm run dev          # Start Vite dev server
npm run build        # Production build
npm test             # Run tests (vitest)
```

### Docker Compose
```bash
docker compose up -d           # Start all services
docker compose up -d controller # Start single service
docker compose logs -f          # Follow logs
docker compose down             # Stop all
```

## Project Structure

```
watchwarden/
├── controller/          # Node.js + TypeScript server
│   └── src/
│       ├── index.ts     # Entry point, boot sequence
│       ├── types.ts     # Shared types, WS message unions
│       ├── db/          # PostgreSQL schema + queries
│       ├── api/         # REST routes + auth middleware
│       ├── ws/          # WebSocket hub + UI broadcaster
│       └── scheduler/   # Cron engine
├── agent/               # Go lightweight agent
│   ├── main.go          # Entry point
│   ├── interfaces.go    # Interfaces for testability
│   ├── docker.go        # Docker API client
│   ├── updater.go       # Atomic update/rollback
│   ├── ws.go            # WebSocket client
│   ├── healthmon.go     # Health monitoring + crash-loop detection
│   ├── scheduler.go     # Local cron fallback
│   └── snapshot_store.go # Snapshot persistence for rollback
├── ui/                  # React + TypeScript + Vite
│   └── src/
│       ├── api/         # API client + TanStack Query hooks
│       ├── ws/          # WebSocket hook
│       ├── store/       # Zustand store
│       ├── pages/       # Route pages
│       └── components/  # UI components
├── docker-compose.yml
└── CLAUDE.md
```

## Coding Conventions

- TypeScript: strict mode, no `any` without comment, ESM (`"type": "module"`)
- Go: standard `gofmt`, interfaces for testability
- All async functions must handle errors; API returns `{ error: string }` on failure
- No hardcoded secrets — all via environment variables
- No polling from UI — WebSocket for real-time updates

## TDD Workflow

Write tests before implementation for every module.

- **Controller tests**: Vitest + Fastify `inject()` + testcontainers PostgreSQL
- **Agent tests**: Go `testing` + testify, mock Docker interface
- **UI tests**: Vitest + React Testing Library + MSW (Mock Service Worker)
- **Convention**: tests in `__tests__/` dirs (TS) or `*_test.go` files (Go)
- **Cycle**: RED (failing test) → GREEN (implement) → REFACTOR

## Environment Variables

### Controller
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP/WS server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `ADMIN_PASSWORD` | `admin` | Admin login password |
| `JWT_SECRET` | `changeme` | JWT signing secret |
| `NODE_ENV` | `development` | Environment |

### Agent
| Variable | Default | Description |
|----------|---------|-------------|
| `CONTROLLER_URL` | — | WebSocket URL to controller (ws:// or wss://) |
| `AGENT_TOKEN` | — | Pre-shared auth token |
| `AGENT_NAME` | hostname | Display name |
| `LOCAL_SCHEDULE` | — | Cron for offline fallback |
| `WATCHWARDEN_LABEL_ENABLE_ONLY` | `false` | Only monitor containers with enable label |

### UI
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_CONTROLLER_URL` | `http://localhost:3000` | Controller base URL |
