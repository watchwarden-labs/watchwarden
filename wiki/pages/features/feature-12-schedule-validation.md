---
title: Feature 12 — Schedule Validation
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 12 — Schedule Validation

> **Status**: Largely implemented. Minor UX gap in client-side validation.

## What's Implemented

- `controller/src/api/routes/config.ts` — `cron.validate(value)` from `node-cron`; returns HTTP 400 on invalid.
- Same validation in `routes/agents.ts` for `scheduleOverride`.
- `agent/scheduler.go` — `robfig/cron` returns error on parse failure; logged.
- `agent/compat.go` — converts `WATCHTOWER_POLL_INTERVAL` (seconds) to `@every Ns`.

## What's Missing

- No client-side validation in `CronPicker.tsx` before API call — users get server errors instead of inline feedback.
- Agent solo mode: invalid schedule causes silent log error, no visible feedback.

## Remaining Work (Phase 1)

- `CronPicker.tsx` — add `cronstrue` for human-readable preview and inline error display.
- Agent solo mode — consider `log.Fatal` or emit to `/api/events` on schedule parse failure.

## Related Pages

- [Feature 4: Aging / Maintenance Windows](feature-04-aging.md)
- [Roadmap Phase 1](../roadmap.md#phase-1)
