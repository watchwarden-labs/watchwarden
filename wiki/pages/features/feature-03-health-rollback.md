---
title: Feature 3 — Health-Gated Updates & Auto-Rollback
type: feature
sources: [reference-feature-audit.md, OVERVIEW.md]
updated: 2026-04-12
---

# Feature 3 — Health-Gated Updates & Auto-Rollback

> **Status**: Fully implemented.

## What's Implemented

- `agent/healthmon.go` — `HealthMonitor.StartMonitoring()`, polls Docker health every 5s. Triggers rollback if unhealthy > `maxUnhealthy` (default 30s). `StartCrashLoopDetector()` detects `RestartCount >= 3` within 60s.
- `agent/updater.go` — `BlueGreenUpdate()` + `waitForHealthy()` (up to 5 min). Fallback to stop-first on port conflict.
- `agent/updater.go` — `RollbackContainer()`, `RollbackToImage()`.
- `update_policies` table (migration 002) — `stability_window_seconds`, `auto_rollback_enabled`, `max_unhealthy_seconds`.
- Rollback emits `UPDATE_RESULT` WS with `isRollback: true`, `autoRolledBack: true`, `rollbackReason`.
- `ui/src/pages/AgentDetail.tsx` `StabilityPolicyCard` — UI to configure policy fields and strategy selector.

## Minor Gap

No per-container health policy override — policy is per-agent only. All containers on an agent share one stability config.

## Related Pages

- [Update Pipeline](../architecture/update-pipeline.md)
- [Feature 5: Staged Rollouts](feature-05-staged-rollouts.md)
