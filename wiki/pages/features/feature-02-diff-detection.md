---
title: Feature 2 — Change-Awareness / Diff Detection
type: feature
sources: [reference-feature-audit.md]
updated: 2026-04-12
---

# Feature 2 — Change-Awareness / Diff Detection

> **Status**: Fully implemented. Minor gap: no upstream release notes fetching.

## What's Implemented

- `agent/diff.go` — `DiffImages(current, target image.InspectResponse) ImageDiff`. Compares env, ports, entrypoint, cmd, labels, workdir, user, volumes. `ImageDiff.HasBreakingChanges = true` when ports/entrypoint/volumes change.
- `agent/updater.go:406–423` — calls `DiffImages` in `CheckForUpdates`; stored in `CheckResult.Diff`.
- `containers.last_diff` TEXT/JSON (migration 005).
- `update_log.diff` TEXT/JSON (migration 021) — persists diff per update event.
- `controller/src/ws/hub.ts` — `pendingDiffs` map caches diff from `CHECK_RESULT`; writes to `update_log` on `UPDATE_RESULT`.
- `ui/src/components/diff/ImageDiffView.tsx` — full diff view with `DiffBadge`.
- `ui/src/components/agents/ContainerRow.tsx:284–309` — diff badge in row, click opens dialog.
- `ui/src/pages/History.tsx` — `DiffBadge` in expanded rows, click opens `ImageDiffView` dialog.

## Remaining Gap

- No upstream release notes fetching (e.g. Docker Hub description, GitHub releases).

## Related Pages

- [Update Pipeline](../architecture/update-pipeline.md)
- [Roadmap Phase 1](../roadmap.md#phase-1)
