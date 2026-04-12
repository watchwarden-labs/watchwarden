---
title: Feature 6 — Notifications
type: feature
sources: [reference-feature-audit.md, OVERVIEW.md]
updated: 2026-04-12
---

# Feature 6 — Notifications

> **Status**: Fully implemented for core use cases.

## What's Implemented

**Controller channels**: Telegram, Slack, Webhook, ntfy — `controller/src/notifications/senders/`
**Agent solo channels**: same + Shoutrrr parser — `agent/notify.go`

**Batching** (`controller/src/notifications/session-batcher.ts`):
- 15s window, 5 min max
- 1h dedup per `agentId/containerName/latestDigest`
- `expectCheckResults(count)` waits for all agents to report before sending a consolidated notification

**Events**: `update_available`, `update_success`, `update_failed` per channel (configurable per channel).

**Templates**: `{{eventType}}`, `{{agentName}}`, `{{containers}}`, `{{count}}` + link templates (Docker Hub/GHCR/Quay.io presets).

**UI**: `NotificationsTab.tsx`, `AddChannelModal.tsx`, `ChannelCard.tsx` — full CRUD + test-send.

**Audit**: `notification_logs` table.

## Gaps

- No per-agent or per-container channel targeting (every channel fires for every agent/container).
- `{{oldVersion}}`/`{{newVersion}}` template vars not wired in controller notification templates — only available in agent solo-mode `notify.go`.

## Remaining Work

- Add `agent_ids TEXT` JSON array to `notification_channels`; filter in `notifier.ts`.
- Extend `controller/src/notifications/template-helpers.ts` with `{{oldVersion}}`/`{{newVersion}}`.

## Related Pages

- [Feature 13: Monitor-Only & Alert Suppression](feature-13-monitor-only.md)
- [Architecture: System Design](../architecture/system-design.md)
