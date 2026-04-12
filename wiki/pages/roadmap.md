---
title: Roadmap
type: roadmap
sources: [WW-roadmap-for-claude.md, reference-feature-audit.md]
updated: 2026-04-12
---

# Roadmap

## Global Priority Order

1. Finish and expose what is **already partially implemented**
2. Strengthen **safety, observability, and operator UX** (aging, metrics, monitor-only, registry)
3. Only then tackle **large epics** (GitOps / PR-based mode)

Goal: frequent, safe increments with visible user value. No destabilizing the update pipeline.

---

## Phase 0 — Done

Features complete and should not be changed except for extensions or UX polish.

| Feature | Notes |
|---------|-------|
| Health-gated updates & auto-rollback (F3) | Blue/green, health monitoring, stability window, auto-rollback |
| Staged rollouts at container level (F5) | `update_group`, `update_priority`, `depends_on`, ordered batches |
| Notifications core (F6) | Multi-channel, session batching, dedup, templates, audit |
| Stack/dependency ordering (F8) | Same group/priority/depends_on + `is_stateful` for bulk-update exclusion |
| Schedule validation (F12) | Server-side cron validation |

---

## Phase 1 — Quick Wins / UX & Safety Polish {#phase-1}

**Goal**: finish partially implemented core behaviors and expose existing power in the UI.

### 1. Semver Policies & Editable Policy in UI (F1)

- Enforce `update_level` semantics in `controller/src/ws/hub.ts` before sending auto-updates
- Add `global_update_level` default to config table
- Add UI controls to edit per-container `policy` and `update_level` (and optionally `tag_pattern`)
- Key files: `agent/registry.go`, `agent/updater.go`, migrations 012–015, `ContainerRow.tsx`
- [Feature page →](features/feature-01-semver-policies.md)

### 2. Diff in Update History (F2)

- `update_log.diff` column already exists (migration 021); controller already caches diffs
- Confirm diff is being written on UPDATE_RESULT (check `hub.ts` `pendingDiffs` map)
- Extend History UI to show `DiffBadge` / dialog when `entry.diff` is present
- [Feature page →](features/feature-02-diff-detection.md)

### 3. Client-side Cron Validation & Preview (F12 gap)

- Add `cronstrue` to `CronPicker.tsx` for human-readable preview + inline validation
- [Feature page →](features/feature-12-schedule-validation.md)

---

## Phase 2 — Safety, Aging, Metrics & Monitor-Only {#phase-2}

**Goal**: make updates less risky over time, improve observability.

### 4. Aging / Minimum Update Age (F4)

- `update_first_seen BIGINT` on `containers` (set on first `has_update = true` flip)
- `min_age_hours INTEGER` in `update_policies`; evaluate in `engine.ts` before auto-update
- [Feature page →](features/feature-04-aging.md)

### 5. Per-container Metrics (F7)

- Extend `routes/metrics.ts` SQL to join `containers + agents` for per-container labels
- No schema change needed
- [Feature page →](features/feature-07-metrics.md)

### 6. Monitor-Only Refinements (F13)

- `com.watchwarden.env=dev|staging|prod` → `env TEXT` on containers
- Extend dedup key in `session-batcher.ts` to `containerName + agentId` (24h TTL, digest-independent)
- `lastResultNotified` map in `agent/notify.go` with 1-min TTL for failure suppression
- [Feature page →](features/feature-13-monitor-only.md)

---

## Phase 3 — UX for Groups/Stacks, Tag Patterns, Registry {#phase-3}

**Goal**: expose orchestration power in the UI, make registry interactions smarter.

### 7. UI for Groups/Dependencies (F5 & F8 gaps)

- UI to edit `update_group`, `update_priority`, `depends_on` per container
- Agent `group` field (new migration) + UI filter/trigger by group
- [Feature page →](features/feature-05-staged-rollouts.md)

### 8. Tag Pattern Presets (F9)

- `TagPatternPicker` component with presets: strict semver, date-based, numeric-only, custom regex
- `PUT /api/agents/:agentId/containers/:id` endpoint to persist changes
- [Feature page →](features/feature-09-tag-patterns.md)

### 9. Registry-aware Behavior (F10)

- ETag/`If-None-Match` caching in `agent/registry.go`; handle HTTP 304
- Backoff on 429/503 (reuse pattern from `agent/ws.go`)
- Diagnostics bundle: add `registries` section
- [Feature page →](features/feature-10-registry.md)

---

## Phase 4 — GitOps / PR-Based Mode {#phase-4}

**Goal**: opt-in mode for Git-based infrastructure management.

### 10. GitOps Mode (F11)

- No Git integration currently — starting from scratch
- Minimal config model: `gitops_mode`, `gitops_repos`
- New `controller/src/gitops/` module
- Start with read-only patch generation before auto-PR
- [Feature page →](features/feature-11-gitops.md)
