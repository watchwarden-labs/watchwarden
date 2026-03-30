---
name: watchwarden
description: >
  Project context and conventions for WatchWarden — a distributed Docker container update manager.
  Use this skill whenever working on any part of the watchwarden codebase: controller (Node.js/Fastify),
  agent (Go), or UI (React/Vite). Trigger for any code changes, bug fixes, new features, refactoring,
  or build/deploy questions. Also trigger when the user mentions containers, agents, updates, rollbacks,
  notifications, Docker, or any watchwarden-specific terminology.
---

# WatchWarden Project Skill

## Architecture

```
┌─────────┐  WS   ┌────────────┐  WS   ┌─────────┐
│  Agent   │◄─────►│ Controller │◄─────►│   UI    │
│  (Go)    │       │ (Node/TS)  │       │ (React) │
└────┬────┘       └─────┬──────┘       └─────────┘
     │                  │
  Docker             SQLite
  Socket
```

- **Controller** (`controller/`): Node.js 20, Fastify 5, TypeScript strict, better-sqlite3, WebSocket hub
- **Agent** (`agent/`): Go 1.26, Docker SDK, gorilla/websocket, robfig/cron
- **UI** (`ui/`): React 19, Vite 8, TanStack Query v5, Zustand, shadcn/ui v4, Tailwind v4

## Critical Conventions

### shadcn/ui v4 uses @base-ui/react (NOT Radix)

Components in `ui/src/components/ui/` are shadcn v4 which uses `@base-ui/react` primitives.

**`asChild` does NOT exist.** Use the `render` prop instead:

```tsx
// WRONG — will cause build errors
<TooltipTrigger asChild>
  <Button>hover me</Button>
</TooltipTrigger>

// CORRECT — base-ui pattern
<TooltipTrigger render={<span />}>
  <Button>hover me</Button>
</TooltipTrigger>

// For links styled as buttons, use buttonVariants:
<Link className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
  Click me
</Link>
```

### Path Alias

UI uses `@/` alias → `./src/*`. Configured in both `tsconfig.app.json` and `vite.config.ts`.
The `vitest.config.ts` also needs this alias (separate file from vite.config.ts).

```tsx
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
```

### Biome (not ESLint/Prettier)

Single `biome.json` at repo root. Both controller and UI use it:
- Single quotes, semicolons always, 2-space indent, 100-char line width
- Warns on unused variables/imports and explicit `any`

### TypeScript Strict Mode

Both controller and UI enforce `noUnusedLocals`, `noUnusedParameters`. Controller also has `noUncheckedIndexedAccess`.

### Dark Theme Only

The UI is dark-by-default. CSS variables in `ui/src/index.css` use oklch colors. No light theme toggle exists. Key semantic colors: `--primary` (accent blue), `--success` (green), `--destructive` (red), `--warning` (amber).

## Development Commands

### Controller
```bash
cd controller
npm run dev          # tsx watch
npm run build        # tsc
npm run lint         # tsc --noEmit && biome check .
npm test             # vitest
```

### Agent
```bash
cd agent
go build ./...
go vet ./...
go test ./... -count=1
```

### UI
```bash
cd ui
npm run dev          # vite dev server
npm run build        # tsc -b && vite build
npm run lint         # tsc --noEmit && biome check .
npm test             # vitest (uses vitest.config.ts, NOT vite.config.ts)
```

### Docker
```bash
docker compose build
docker compose up -d
docker compose logs -f
```

Uses Colima (not Docker Desktop) on this machine. ARM64 native binaries in `~/bin/`.

## Verification — ALWAYS Run After Changes

After every code change, run verification before declaring done:

1. **Controller**: `cd controller && npm run lint && npm test`
2. **Agent**: `cd agent && go vet ./... && go test ./...`
3. **UI**: `cd ui && npm run lint && npm test`
4. **Docker** (if deploying): `docker compose build`

Current test counts: ~72 controller, ~34 agent, ~26 UI (132+ total).

## Project Structure

```
watchwarden/
├── controller/src/
│   ├── index.ts              # Entry point, boot sequence
│   ├── types.ts              # Shared types, WS message unions
│   ├── db/
│   │   ├── schema.ts         # SQLite schema + migrations
│   │   └── queries.ts        # All DB access
│   ├── api/routes/
│   │   ├── agents.ts         # Agent CRUD + check/update/rollback
│   │   ├── auth.ts           # JWT login
│   │   ├── config.ts         # Global config
│   │   ├── history.ts        # Update log
│   │   ├── notifications.ts  # Notification channels CRUD
│   │   └── registries.ts     # Registry credentials CRUD
│   ├── ws/
│   │   ├── hub.ts            # Agent WS hub (auth, messages, auto-update)
│   │   └── ui-broadcaster.ts # UI WS push (no auth)
│   ├── scheduler/engine.ts   # Cron scheduler (global + per-agent)
│   ├── notifications/        # Telegram/Slack/Webhook senders + session batcher
│   └── lib/
│       ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│       └── registry-client.ts # Docker Hub/V2 tag fetching
├── agent/
│   ├── main.go               # Entry point, WS message handlers
│   ├── interfaces.go         # DockerAPI interface, types
│   ├── docker.go             # Docker SDK wrapper
│   ├── updater.go            # Atomic update/rollback with progress
│   ├── ws.go                 # WebSocket client with reconnection
│   ├── scheduler.go          # Local cron fallback
│   └── credstore.go          # Registry credential store
├── ui/src/
│   ├── App.tsx               # Router, QueryClient, WS hook
│   ├── store/useStore.ts     # Zustand (auth, WS state, toasts, progress)
│   ├── ws/useSocket.ts       # WebSocket hook → store + query invalidation
│   ├── api/
│   │   ├── client.ts         # fetch wrapper (auto 401→logout)
│   │   └── hooks/            # TanStack Query hooks per domain
│   ├── components/
│   │   ├── ui/               # shadcn/ui generated components
│   │   ├── layout/           # Sidebar, TopBar
│   │   ├── agents/           # AgentCard, AgentListRow, ContainerRow
│   │   ├── common/           # StatusDot, DigestBadge, CronPicker, Toaster
│   │   ├── notifications/    # NotificationsTab, ChannelCard, AddChannelModal
│   │   ├── registries/       # RegistriesTab, RegistryModal
│   │   └── rollback/         # VersionPickerModal
│   └── pages/                # Dashboard, Agents, AgentDetail, History, Settings, Login
└── docker-compose.yml
```

## Testing Approach (TDD)

### Controller Tests (`vitest`)
- In-memory SQLite (`:memory:`) for DB tests
- Fastify `inject()` for API tests (no real HTTP)
- `ws` client library for WebSocket tests
- Tests in `src/**/__tests__/*.test.ts`

### Agent Tests (`go test`)
- Mock `DockerAPI` interface for Docker operations
- `httptest` + gorilla/websocket upgrader for WS tests
- `testify` for assertions
- Tests in `*_test.go` files

### Test Container Cleanup — Always Remove After Tests

**Never leave created or stopped Docker containers behind.** When a test creates a real container (integration tests, manual verification), always clean it up:

```go
// Go: use t.Cleanup for guaranteed removal even on failure
containerID := createTestContainer(t, ...)
t.Cleanup(func() {
    d.cli.ContainerRemove(context.Background(), containerID,
        container.RemoveOptions{Force: true, RemoveVolumes: true})
})
```

```bash
# Bash: always force-remove after a test session
docker rm -f <container-name-or-id>
```

This applies to manual testing too — if you start a container to verify behavior, remove it before finishing the session.

### UI Tests (`vitest`)
- React Testing Library + jsdom
- QueryClientProvider wrapper needed for components using TanStack Query
- Zustand store can be set directly: `useStore.setState({...})`
- Tests in `src/**/__tests__/*.test.{ts,tsx}`
- **Important**: `vitest.config.ts` is separate from `vite.config.ts` and needs the `@/` alias

## Key Patterns

### WebSocket Message Flow
Agent → Controller: `REGISTER`, `HEARTBEAT`, `CHECK_RESULT`, `UPDATE_RESULT`, `UPDATE_PROGRESS`
Controller → Agent: `CHECK`, `UPDATE`, `ROLLBACK`, `CONFIG_UPDATE`, `CREDENTIALS_SYNC`
Controller → UI: `AGENT_STATUS`, `HEARTBEAT_RECEIVED`, `CHECK_COMPLETE`, `UPDATE_PROGRESS`, `UPDATE_COMPLETE`

### Container ID Resolution
Container IDs become stale after recreation. The agent has `ResolveContainerID()` which tries by ID first, then by name. Rollback passes both `containerId` and `containerName` so the agent can resolve.

### Progress Tracking
Update/rollback progress uses the **original** (stale) container ID for WS messages so the UI can match it to the DB row. Docker operations use the resolved live ID.

### Notification Dedup
`notifiedUpdates` set prevents re-notifying about the same container+image. Cleared only when a new digest appears, not after updates. Auto-update skips "updates available" notification.

### DB Migrations
New columns added via `PRAGMA table_info` check in `schema.ts` `runMigrations()`. Example: `excluded` and `exclude_reason` columns were added after initial schema.

## Security Rules

These rules come from a full security audit (`AUDIT.md` in the repo root). Follow them on every change — violating any introduces known vulnerabilities.

### 1. Secrets — Never Use Defaults; Always Throw

`JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD` must **never fall back to a hardcoded string**. Throw if missing so the process refuses to start.

```typescript
// ❌ WRONG — creates false sense of security
const secret = process.env.JWT_SECRET || 'changeme';

// ✅ RIGHT — fails loudly at startup
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET env var is required');
```

### 2. CORS — Use `CORS_ORIGIN` Env Var, Never `origin: true`

`origin: true` allows cross-site requests from any domain.

```typescript
// ❌ WRONG
await app.register(cors, { origin: true });

// ✅ RIGHT
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  credentials: true,
});
```

### 3. Both WebSocket Endpoints Must Validate JWT

`/ws/agent` authenticates via the REGISTER message. `/ws/ui` has **no default auth** — add token validation before upgrading:

```typescript
// In /ws/ui upgrade handler
const token = new URL(req.url, 'http://x').searchParams.get('token');
try { jwt.verify(token ?? '', JWT_SECRET); }
catch { socket.destroy(); return; }
```

### 4. Auth Endpoints — Always Rate-Limited

Every login route needs `@fastify/rate-limit` (already installed). Max 5 attempts per minute per IP.

### 5. Image Refs Passed to exec.Command — Validate First

Before passing any image string to `cosign` or `trivy` (in `verify.go`, `scanner.go`):

```go
var validImageRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$`)
if !validImageRef.MatchString(image) {
    return fmt.Errorf("invalid image reference: %q", image)
}
```

### 6. Error Responses — Never Expose Internals

5xx errors must return a generic message (not `error.message` which can leak DB errors/stack traces):

```typescript
app.setErrorHandler((error, _req, reply) => {
  app.log.error(error);
  const code = error.statusCode ?? 500;
  reply.status(code).send({ error: code >= 500 ? 'Internal server error' : error.message });
});
```

### 7. Security Headers — Always in nginx.conf

When editing `ui/nginx.conf`, the `server` block must have:

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
```

### 8. Query `limit` Params — Cap at 200

```typescript
const limit = Math.min(Number.parseInt(limitStr, 10) || 50, 200);
```

Apply to every route that accepts `limit` (history, audit, etc.).

### 9. Agent WebSocket — Set Read Limit After Connect

```go
conn.SetReadLimit(1 << 20) // 1 MB — prevents OOM from large payloads
```

### 10. Temp Files With Secrets — Explicit 0600 Permissions

```go
tmpFile, err := os.CreateTemp("", "cosign-pubkey-*.pem")
// ...
tmpFile.Chmod(0600) // never rely on umask
// Do NOT log the file path
```

### 11. Docker Compose Production — No Hardcoded Secrets

```yaml
# ❌ WRONG
JWT_SECRET: changeme-to-random-secret

# ✅ RIGHT — Compose fails loudly if unset
JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET to a random secret before deploying}
```

### 12. Go Message Handlers — Always Check json.Unmarshal Error

```go
var cmd UpdateCommand
if err := json.Unmarshal(payload, &cmd); err != nil {
    log.Printf("[handler] invalid payload: %v", err)
    return
}
```

---

## Environment Variables

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | Controller | No (`3000`) | HTTP/WS port |
| `HOST` | Controller | No (`0.0.0.0`) | Bind address |
| `DATABASE_URL` | Controller | **Yes** (throws) | PostgreSQL connection string |
| `ADMIN_PASSWORD` | Controller | No (`"admin"`) | Login password ⚠️ audit C1: should throw |
| `JWT_SECRET` | Controller | No (`"changeme"`) | JWT signing ⚠️ audit C1: should throw |
| `ENCRYPTION_KEY` | Controller | No (insecure default) | AES-256 key for credentials ⚠️ audit C1: should throw |
| `LOCAL_AGENT_TOKEN` | Controller | No | Auto-register local agent on startup |
| `CONTROLLER_URL` | Agent | **Yes** (fatal) | WebSocket URL to controller |
| `AGENT_TOKEN` | Agent | **Yes** (fatal) | Auth token |
| `AGENT_NAME` | Agent | No (hostname) | Display name in dashboard |
| `LOCAL_SCHEDULE` | Agent | No | Cron expression for offline fallback checks |
| `WATCHWARDEN_LABEL_ENABLE_ONLY` | Agent | No (`false`) | Only monitor containers with `com.watchwarden.enable=true` |
| `REQUIRE_SIGNED_IMAGES` | Agent | No (`false`) | Block updates if cosign signature fails |
| `COSIGN_PUBLIC_KEY` | Agent | No | PEM public key for cosign verification |
