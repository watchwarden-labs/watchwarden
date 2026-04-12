---
title: Feature 4 — Aging / Maintenance Windows
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 4 — Aging / Maintenance Windows

> **Status**: Partially implemented. Schedules exist; aging and maintenance window abstractions do not.

## What's Implemented

- `controller/src/scheduler/engine.ts` — `Scheduler` with `node-cron`. Global `config.global_schedule` (default `0 4 * * *`). Per-agent `agents.schedule_override`. Hot-reload supported.
- `ui/src/pages/AgentDetail.tsx` — `CronPicker` to set/clear schedule override per agent.
- `agent/scheduler.go` — `LocalScheduler` with `robfig/cron`; fallback when controller is unreachable.

## What's Missing

1. No "first seen" timestamp — updates are acted on immediately when the schedule fires, even for very fresh images.
2. No time-of-day/day-of-week window abstraction beyond cron syntax.

## Remaining Work (Phase 2)

- Add `update_first_seen BIGINT` (nullable) to `containers`. Set on first `has_update = true` flip in `hub.ts`; clear when `has_update = false`.
- Add `min_age_hours INTEGER` to `update_policies`; evaluate in `engine.ts` before auto-update trigger.
- Add `maintenance_window TEXT` JSON column to `agents` (e.g. `{daysOfWeek:[1-5], startHour:2, endHour:5}`); evaluate in `engine.ts`.
- Extend UI policy editor to configure minimum age.

## Related Pages

- [Roadmap Phase 2](../roadmap.md#phase-2)
- [Feature 12: Schedule Validation](feature-12-schedule-validation.md)
