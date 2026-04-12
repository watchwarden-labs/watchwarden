---
title: Feature 4 — Aging / Maintenance Windows
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 4 — Aging / Maintenance Windows

> **Status**: Largely implemented. Minimum update age done; maintenance window abstraction still missing.

## What's Implemented

- `controller/src/scheduler/engine.ts` — `Scheduler` with `node-cron`. Global `config.global_schedule` (default `0 4 * * *`). Per-agent `agents.schedule_override`. Hot-reload supported.
- `ui/src/pages/AgentDetail.tsx` — `CronPicker` to set/clear schedule override per agent.
- `agent/scheduler.go` — `LocalScheduler` with `robfig/cron`; fallback when controller is unreachable.
- `controller/src/db/migrations/021-aging.sql` — `update_first_seen BIGINT` on `containers`, `min_age_hours INTEGER DEFAULT 0` on `update_policies`.
- `controller/src/ws/hub.ts` — detects `has_update` flips, stamps/clears `update_first_seen`, enforces `min_age_hours` in auto-update filter.
- `ui/src/pages/AgentDetail.tsx` `StabilityPolicyCard` — "Min age before auto-update (hours)" input.

## Remaining Gap

- No time-of-day/day-of-week maintenance window abstraction — `maintenance_window TEXT` JSON column on `agents` was proposed but not implemented.

## Related Pages

- [Roadmap Phase 2](../roadmap.md#phase-2)
- [Feature 12: Schedule Validation](feature-12-schedule-validation.md)
