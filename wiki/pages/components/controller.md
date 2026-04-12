---
title: Component — Controller (Node.js/TypeScript)
type: component
sources: [OVERVIEW.md, CLAUDE.md]
updated: 2026-04-12
---

# Component — Controller (Node.js/TypeScript)

The controller is the central coordinator — it manages agent connections, schedules checks, orchestrates updates, sends notifications, and serves the REST API.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, boot sequence |
| `src/types.ts` | Shared types, WebSocket message unions |
| `src/db/` | PostgreSQL schema + queries (postgres.js) |
| `src/api/` | REST routes + auth middleware |
| `src/ws/hub.ts` | WebSocket hub — per-agent queues, message dispatch, `pendingDiffs` |
| `src/ws/ui-broadcaster.ts` | Broadcasts state to all connected UI clients |
| `src/scheduler/engine.ts` | `node-cron` scheduler, hot-reload, global/per-agent schedules |
| `src/scheduler/orchestrator.ts` | `resolveUpdateBatches()`, `topologicalSort()`, `executeOrchestratedUpdate()` |
| `src/notifications/` | `session-batcher.ts`, `notifier.ts`, `senders/` |
| `src/api/routes/metrics.ts` | Prometheus `/metrics` endpoint |

## Message Processing

Per-agent **promise chain** (`agentQueues` in `hub.ts`) serializes concurrent WebSocket messages. Two concurrent `HEARTBEAT` messages from the same agent cannot interleave at `await` points. Errors are caught and logged without breaking the chain.

## Scheduling

- `engine.ts` runs `node-cron` with hot-reload when `global_schedule` changes in DB.
- Per-agent `schedule_override` takes precedence.
- On schedule fire: `orchestrator.ts` fetches all containers, builds update batches, sends `UPDATE_SEQUENTIAL` per agent.

## Database

PostgreSQL via `postgres.js`. Schema managed by numbered migration files in `src/db/migrations/`. Shared test container via `globalSetup` + `fileParallelism: false` (prevents test isolation issues).

## Testing

- Vitest + Fastify `inject()` for REST endpoints
- Real PostgreSQL via testcontainers (shared per test run)
- Real WebSocket connections for WS message tests
- 0 leaked containers after test runs

## Related Pages

- [Architecture: System Design](../architecture/system-design.md)
- [ADR: Why WebSocket](../decisions/adr-002-websocket.md)
- [ADR: UI Backpressure](../decisions/adr-004-ui-backpressure.md)
