---
title: Feature 13 — Monitor-Only Refinements & Alert Suppression
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 13 — Monitor-Only Refinements & Alert Suppression

> **Status**: Partially implemented. Basic cooldown exists; env separation and improved dedup missing.

## What's Implemented

- `agent/notify.go` `Notifier` — 5-min per-container cooldown for `NotifyAvailable`.
- `controller/src/notifications/session-batcher.ts` — 1h dedup per `agentId/containerName/latestDigest`.
- `WW_MONITOR_ONLY=true` → forces `AutoUpdate = false` (`agent/config.go:80`).
- `com.watchwarden.policy=notify` label → controller skips auto-update.

## What's Missing

- No dev/lab/prod container environment concept.
- `NotifyResult` (post-update) has no cooldown — repeated failures all fire.
- 1h dedup uses digest as key — rolling `latest` tags bypass dedup entirely (digest changes on every new push).

## Remaining Work (Phase 2)

- `com.watchwarden.env=dev|staging|prod` label → `env TEXT` column on `containers`; notification channels can filter by env.
- Extend dedup key in `session-batcher.ts` to `containerName + agentId` (24h TTL, **digest-independent**).
- Add `lastResultNotified map[string]time.Time` in `agent/notify.go Notifier` with 1-min TTL for repeated failure suppression.

## Related Pages

- [Feature 6: Notifications](feature-06-notifications.md)
- [Roadmap Phase 2](../roadmap.md#phase-2)
