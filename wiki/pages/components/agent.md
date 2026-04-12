---
title: Component — Agent (Go)
type: component
sources: [OVERVIEW.md, CLAUDE.md]
updated: 2026-04-12
---

# Component — Agent (Go)

The agent is a Go binary deployed on every Docker host. It has two operating modes — Solo and Managed — determined at startup by the presence of `CONTROLLER_URL`.

## Key Files

| File | Purpose |
|------|---------|
| `main.go` | Entry point; shared init + mode branch |
| `config.go` | All config from env vars (including Watchtower compat) |
| `compat.go` | Watchtower env var compatibility layer |
| `managed.go` | Managed mode — WebSocket + controller commands |
| `solo.go` | Solo mode — standalone scheduler + notify |
| `docker.go` | Docker API client wrapper |
| `updater.go` | Atomic update/rollback; `BlueGreenUpdate`, `RollbackContainer`, `RecoverOrphans` |
| `healthmon.go` | Health monitoring + crash-loop detection |
| `scheduler.go` | Local cron fallback (`LocalScheduler`) |
| `ws.go` | WebSocket client with full-jitter exponential backoff |
| `registry.go` | Registry API calls; semver/pattern filtering; ETag TODO |
| `credstore.go` | Registry credential management; ECR refresh |
| `diff.go` | `DiffImages` — compares two image configs |
| `notify.go` | Notification senders (Telegram, Slack, Webhook) for Solo mode |
| `httpserver.go` | HTTP status server (`/health`, `/api/*`) |
| `snapshot_store.go` | Snapshot persistence for crash recovery |
| `interfaces.go` | Interfaces for testability (Docker client mock) |

## Concurrency Model

- Each container gets a `sync.Mutex` keyed by canonical name (not Docker ID).
- Lock released during pull; re-acquired for destructive stop/remove/create sequence.
- Two-phase cleanup: background goroutine marks idle entries `deleted`; `lockContainer()` retries on stale entries.
- Docker operations derive context from `wsClient.ConnectionCtx()` — cancel on disconnect.
- `contextReader` wrapper makes `json.Decoder` cancellation-safe during pull stream reading.

## Testing

- Go `testing` + testify
- Interface-based Docker mock (`interfaces.go`) — thread-safe `recordCall()`/`getCalls()`
- Race detector (`-race`) on all tests
- Concurrent lock/channel tests for mutex correctness

## Related Pages

- [Architecture: System Design](../architecture/system-design.md)
- [Architecture: Update Pipeline](../architecture/update-pipeline.md)
- [ADR: Why Go](../decisions/adr-001-go-agent.md)
- [ADR: Snapshot Recovery](../decisions/adr-003-snapshot-recovery.md)
