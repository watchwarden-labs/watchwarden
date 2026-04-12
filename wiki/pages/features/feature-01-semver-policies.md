---
title: Feature 1 — Semver Policies & Update Levels
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 1 — Semver Policies & Update Levels

> **Status**: Partially implemented. Semver infrastructure exists; controller enforcement and UI editing are missing.

## What's Implemented

- `agent/registry.go` — `FilterByPattern`, `FindLatestSemver`, `FindLatestSemverAtLevel`, `SemverMatchesLevel`. Full level semantics: `"patch"` = same major.minor; `"minor"` = same major; `"major"`/`"all"` = any higher.
- `agent/updater.go:348–385` — reads Docker labels `com.watchwarden.tag_pattern` and `com.watchwarden.update_level` per container.
- DB columns `containers.policy`, `containers.tag_pattern`, `containers.update_level` (migrations 012, 013, 015).
- `agent/interfaces.go` `ContainerInfo.Policy` — values `"auto"`, `"notify"`, `"manual"`.
- `ui/src/components/agents/ContainerRow.tsx` — MANUAL/NOTIFY badge and TAG badge; **read-only display only**.

## What's Missing

1. **Controller doesn't enforce `update_level`** — auto-update decisions in `controller/src/ws/hub.ts` don't check semver delta against the policy before triggering.
2. **No UI editing** — `policy`, `tag_pattern`, `update_level` are set only via Docker labels; no in-app editing.
3. **No global semver policy** — no `global_update_level` default in the config table.

## Remaining Work (Phase 1)

- `controller/src/ws/hub.ts` — evaluate `update_level` against semver delta before triggering auto-update.
- DB: add `global_update_level` key to `config` table.
- UI: add edit popover in `AgentDetail.tsx` or `ContainerRow.tsx` for `policy` and `update_level`.
- Tests: unit tests for semver policy evaluation + integration test "auto-update blocked for minor/major when policy says patch-only".

## Related Pages

- [Roadmap Phase 1](../roadmap.md#phase-1)
- [Feature 9: Tag Patterns](feature-09-tag-patterns.md)
