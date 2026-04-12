---
title: ADR-003 — Snapshot-Based Crash Recovery
type: decision
sources: [OVERVIEW.md]
updated: 2026-04-12
---

# ADR-003 — Snapshot-Based Crash Recovery

## Context

Container updates involve destructive operations (stop, remove, recreate). If the agent process crashes mid-update, the container is gone and cannot be recreated without knowing its original configuration.

## Decision

Before any destructive step, the agent persists the full container config snapshot to disk (with `fsync`). On startup, `RecoverOrphans` scans for orphaned snapshots and restores affected containers.

## Rationale

- A snapshot written with `fsync` survives both process crashes and system reboots
- The snapshot stores the **old image digest** (not `:latest`) — if the update broke the container, recovery uses the last known good image, not the potentially broken new one
- `RecoverOrphans` can detect both recreate-mode orphans (container missing after stop/remove) and blue-green orphans (`-ww-new` containers whose rename was interrupted)
- Idempotent: if recovery runs twice (e.g., double restart), it's safe — it just finds no orphans the second time

## Consequences

- Snapshot files must be cleaned up after successful updates to avoid false recovery on the next startup
- The snapshot path must be on a durable volume in containerized deployments (not `/tmp`)
- Recovery uses old digest — edge case: if old image is no longer pullable (registry deleted it), recovery will fail

## Related Pages

- [Update Pipeline](../architecture/update-pipeline.md)
- [Component: Agent](../components/agent.md)
