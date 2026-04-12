---
title: Architecture — Update Pipeline
type: architecture
sources: [OVERVIEW.md, reference-feature-audit.md]
updated: 2026-04-12
---

# Architecture — Update Pipeline

The update pipeline is the core of WatchWarden. It runs on the Agent (Go) and is designed to survive crashes, avoid concurrent corruption, and support zero-downtime updates.

## Strategies

Two update strategies exist (`WW_UPDATE_STRATEGY`):

**Recreate** (default): Stop old → remove → create new. Simpler, brief downtime.

**Blue-Green** (start-first): Create new with `-ww-new` suffix → health-check → rename. Falls back automatically to recreate on port conflicts.

## Atomic Update Sequence (Recreate)

```
1. Snapshot current container config   → saved to disk with fsync
2. Pull new image                      → idempotent, safe to retry
3. Stop old container                  → snapshot ensures recreatability
4. Remove old container                → snapshot has full config
5. Create + start new container        → if fails, rollback to old image digest
```

**Crash recovery** (`RecoverOrphans` on agent startup):
- Crash at step 3–4: finds snapshot on disk, no container with that name → recreates from snapshot using **old image digest** (not `:latest` — that might be the broken new version)
- Crash during blue-green: detects orphaned `-ww-new` containers → completes rename or cleans up

## Blue-Green Sequence

```
1. Create new container with "-ww-new" suffix
2. Wait for Docker health check to pass (up to 60s)
3. Save snapshot of old container
4. Stop and remove old container
5. Rename new container to original name
```

If health check fails: new container cleaned up with `context.Background()` (not parent context — ensures cleanup even if WebSocket dies mid-update), old container keeps running.

See `agent/updater.go` `BlueGreenUpdate()`, `waitForHealthy()`.

## Per-Container Mutex

Each container gets its own `sync.Mutex` keyed by **canonical name** (not Docker ID) to prevent concurrent updates, rollbacks, and checks from interleaving.

**Two-phase cleanup pattern** prevents map growth without races:
- Background goroutine periodically `TryLock`s idle entries and marks them `deleted`
- `lockContainer()` retries if it acquires a deleted entry, getting a fresh one

The lock is **released during image pull** (which can take minutes) and re-acquired for the destructive stop/remove/create sequence. This prevents a hung Docker pull from blocking rollbacks and health checks on other containers.

## Health Monitoring & Auto-Rollback

After every update, the controller can instruct the agent to monitor health for a configurable stability window (`update_policies.stability_window_seconds`):

- Every 5s: polls Docker health status
- Healthy for full window → stable, monitoring ends
- Unhealthy > 30s → **auto-rollback** to pre-update snapshot
- RestartCount ≥ 3 in 60s → **crash-loop rollback**

`rollbackInProgress` guard prevents both detectors from simultaneously rolling back the same container.

Rollback emits `UPDATE_RESULT` WS with `isRollback: true`, `autoRolledBack: true`, `rollbackReason`.

See `agent/healthmon.go`, `agent/updater.go` `RollbackContainer()`.

## Context Cancellation

Every Docker operation derives its context from the WebSocket connection lifecycle:

```go
ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
```

When the controller disconnects, all in-flight Docker operations are cancelled. A `contextReader` wrapper makes `json.Decoder.Decode()` (used for Docker pull stream) respect cancellation — normally it blocks on the underlying `io.Reader`.

## Staged / Orchestrated Updates

When the controller sends `UPDATE_SEQUENTIAL` (Managed Mode), the agent executes batches derived from `update_group` + `update_priority` + `depends_on` topological sort. Containers in the same group and priority update in parallel; groups sequence by priority order; `depends_on` ensures ordering within groups.

See `controller/src/scheduler/orchestrator.ts`, `agent/managed.go`.

## Related Pages

- [Feature: Health-Gated Rollback](../features/feature-03-health-rollback.md)
- [Feature: Staged Rollouts](../features/feature-05-staged-rollouts.md)
- [System Design](system-design.md)
- [ADR: Snapshot-Based Crash Recovery](../decisions/adr-003-snapshot-recovery.md)
