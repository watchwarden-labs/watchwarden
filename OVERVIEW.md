# WatchWarden — Technical Overview

## What It Is

WatchWarden is a Docker container update manager that works in two modes:

- **Solo Mode** — drop-in Watchtower replacement. Single binary, no dependencies. Mount docker.sock and go.
- **Managed Mode** — multi-host management with a central Controller (Node.js), lightweight Agents (Go), and a real-time Web UI (React).

```
Solo Mode:                          Managed Mode:

  Agent (Go)                           Web UI (React)
     |                                      |  WebSocket
  Docker API                          Controller (Node.js)
     |                                /    |    \  WebSocket
  Containers                      Agent   Agent   Agent
                                   |       |       |
                                 Docker  Docker  Docker
```

## Project Scale

| Metric | Count |
|--------|-------|
| Source code | ~17,000 LOC |
| Test code | ~7,500 LOC |
| Test cases | 263 (98 Go + 115 TS + 50 React) |
| API endpoints | 39 REST |
| WebSocket message types | 22 (9 inbound, 13 outbound) |
| DB migrations | 10 |

## Architecture Decisions

### Why Three Components?

**Controller** runs where your database is. Handles scheduling, notifications, audit, and orchestration. Stateless except for PostgreSQL — can be restarted without losing state.

**Agents** are deployed per Docker host. They do the actual Docker operations (inspect, pull, stop, create, start). Agents are ~4MB Go binaries with zero dependencies. They reconnect automatically with full-jitter exponential backoff if the controller goes down.

**UI** is a static React build served by nginx. No server-side rendering — pure client-side with WebSocket for real-time updates. Can be replaced or disabled without affecting the system.

### Why WebSocket Instead of REST Polling?

Every container status change, update progress step, and health check result is pushed in real-time. The UI never polls. This enables live progress bars during multi-container updates across multiple hosts. The controller broadcasts to all connected UI clients simultaneously via `UiBroadcaster`.

### Why Go for the Agent?

The agent runs on every Docker host and needs to be lightweight. Go compiles to a single static binary (~15MB), starts instantly, has excellent concurrency primitives for handling Docker operations in parallel, and has first-class Docker SDK support.

## Key Technical Solutions

### 1. Atomic Container Updates with Crash Recovery

The update sequence is designed to survive crashes at any point:

```
1. Snapshot current container config     → saved to disk with fsync
2. Pull new image                        → idempotent, safe to retry
3. Stop old container                    → snapshot ensures we can recreate
4. Remove old container                  → snapshot has full config
5. Create + start new container          → if fails, rollback to old image
```

**Crash at step 3-4**: On restart, `RecoverOrphans` finds the snapshot on disk, sees no container with that name, and recreates it from the snapshot using the old image digest (not `:latest` — that might be the broken version).

**Crash during blue-green**: `RecoverOrphans` detects orphaned `-ww-new` containers and either completes the rename transition or cleans them up.

### 2. Per-Container Mutex with Safe Cleanup

Each container gets its own `sync.Mutex` (keyed by canonical name, not Docker ID) to prevent concurrent updates, rollbacks, and checks from interleaving. The lock uses a two-phase cleanup pattern:

- A background goroutine periodically `TryLock`s idle entries and marks them `deleted`
- `lockContainer()` retries if it acquires a deleted entry, getting a fresh one
- This prevents unbounded map growth while avoiding races between cleanup and acquisition

The lock is released during image pull (which can take minutes) and re-acquired for the destructive stop/remove/create sequence. This prevents a hung Docker pull from blocking rollbacks and health checks.

### 3. Blue-Green Zero-Downtime Updates

```
1. Create new container with "-ww-new" suffix
2. Wait for health check to pass (up to 60s)
3. Save snapshot of old container
4. Stop and remove old container
5. Rename new container to original name
```

If the new container fails health checks, it's cleaned up and the old one keeps running. The cleanup uses `context.Background()` (not the parent context) to ensure orphan removal even if the WebSocket connection dies mid-update.

### 4. Connection-Scoped Context Cancellation

Every Docker operation derives its context from the WebSocket connection lifecycle:

```go
ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
```

When the controller disconnects, `ConnectionCtx()` is cancelled, which propagates to all in-flight Docker operations. This prevents orphaned goroutines from continuing to pull images or stop containers after the controller loses interest.

The image pull reader uses a `contextReader` wrapper that makes `json.Decoder.Decode()` respect cancellation — normally it blocks on the underlying `io.Reader` until data arrives.

### 5. Serialized Message Processing (No Async Interleaving)

Node.js async handlers can interleave at `await` points. Two concurrent `HEARTBEAT` messages from the same agent could both reach `upsertContainers` simultaneously, corrupting state.

Solution: per-agent promise chain. Each message appends to a queue:

```typescript
const prev = this.agentQueues.get(agentId) ?? Promise.resolve();
const next = prev.then(process).catch(err => log.error(...));
this.agentQueues.set(agentId, next);
```

Messages are processed strictly in order. Errors are caught and logged without breaking the chain (previous version used `.then(process, process)` which created infinite microtask loops on persistent errors).

### 6. Notification Batching Across Agents

When "Check All" fires, results from multiple agents arrive seconds apart. Without batching, the first agent's notification triggers a 60-second rate limit, silencing the second.

Solution: `expectCheckResults(count)` tells the batcher how many agents to wait for. Results accumulate until all agents report (or a 30-second timeout). One consolidated notification is sent:

```
Updates Available — 2 agents, 6 containers
  servarr: Jackett, qbittorrent, radarr
  local: app-mongo-1
```

### 7. UI Backpressure and Progress Debouncing

During bulk updates, agents send `UPDATE_PROGRESS` events for every container at every step. Without protection:
- Controller would flood all UI clients (100s of events/sec)
- UI would trigger 100s of React re-renders per second

**Controller-side**: Throttles `UPDATE_PROGRESS` broadcasts to 10/sec per container. Skips clients with >1MB buffered write data. Iterates a snapshot of the client Set to avoid skipping clients during deletion.

**UI-side**: Buffers progress updates for 100ms before flushing to Zustand state in a single `set()` call. Toast notifications track timer IDs and clear them on removal to prevent memory leaks during bulk operations.

### 8. Encryption & SSRF Protection

**AES-256-GCM** with 12-byte IV (NIST SP 800-38D compliant) encrypts registry credentials and notification configs at rest. Key derivation uses `scrypt` with a per-deployment salt stored in the database.

**Webhook SSRF protection** uses 5 layers:
1. URL pattern blocklist (localhost, private ranges)
2. DNS pre-resolution before fetch
3. Resolved IP validation against private ranges
4. Direct IP connection (no DNS rebinding)
5. Blocked header injection (Host, X-Forwarded, etc.)

### 9. Health Monitoring and Auto-Rollback

After every update, the controller can instruct the agent to monitor container health for a configurable stability window. The agent polls Docker's health status every 5 seconds:

- **Healthy for full window** → container is stable, monitoring ends
- **Unhealthy > 30 seconds** → auto-rollback to pre-update snapshot
- **Crash loop detected** → separate detector triggers rollback if restarts persist > 60 seconds

A `rollbackInProgress` guard prevents the health monitor and crash loop detector from both rolling back the same container simultaneously.

### 10. Audit Trail with Rich Details

Every REST API action (login, config change, update, rollback, agent registration) is logged with:
- Actor, action, target type/ID
- Full request body (sensitive fields like passwords/tokens redacted as `***`)
- Client IP address

The UI resolves agent UUIDs to human-readable names in the display.

## Testing Strategy

| Layer | Framework | Strategy |
|-------|-----------|----------|
| Agent (Go) | `testing` + testify | Interface-based Docker mock, race detector (`-race`), concurrent lock/channel tests |
| Controller (TS) | Vitest + testcontainers | Real PostgreSQL per test run (shared via `globalSetup`), Fastify `inject()`, real WebSocket connections |
| UI (React) | Vitest + Testing Library | Mock WebSocket, fake timers for debounce/toast tests, Zustand state reset between tests |

**Key testing patterns:**
- Thread-safe mock with `recordCall()`/`getCalls()` for Go race-safe assertion
- Single PostgreSQL container shared across all controller test files (`globalSetup` + `fileParallelism: false`)
- 0 leaked Docker containers after test runs (previously leaked 20+ per run)

## Deployment

### Development
```bash
docker compose up -d
```

### Production
```bash
docker compose -f docker-compose.production.yml up -d
```

### Remote Agent
```yaml
services:
  agent:
    image: alexneo/watchwarden-agent:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTROLLER_URL: "ws://YOUR_CONTROLLER:3000"
      AGENT_TOKEN: "<token from UI>"
      AGENT_NAME: "my-server"
    restart: unless-stopped
```

## Security Model

- **Agent authentication**: bcrypt-hashed pre-shared tokens with token-prefix index for fast lookup and constant-time comparison (dummy hash prevents timing attacks)
- **UI authentication**: JWT with role validation (`role === "admin"`), httpOnly cookies, expired tokens cannot be refreshed
- **Encryption at rest**: AES-256-GCM for registry credentials and notification configs
- **Rate limiting**: per-agent WebSocket (30 msg/s burst 60), login brute-force protection
- **Audit**: every mutation logged with actor, details, and IP
