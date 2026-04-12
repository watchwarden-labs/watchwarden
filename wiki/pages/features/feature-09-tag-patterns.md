---
title: Feature 9 — Tag Pattern Presets & Non-Semver Handling
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 9 — Tag Pattern Presets & Non-Semver Handling

> **Status**: Fully implemented.

## What's Implemented

- `agent/registry.go` — `FilterByPattern` (regex), `FindLatestSemver`, `FindLatestSemverAtLevel`, `SemverMatchesLevel`.
- Date-like tags (e.g. `2024-01-15`) parsed numerically via `extractVersionParts()`.
- Config only via Docker labels `com.watchwarden.tag_pattern` / `com.watchwarden.update_level`.
- `containers.tag_pattern` displayed read-only in UI (badge tooltip).

## What's Missing

- No preset patterns in UI.
- No UI editing of `tag_pattern`.

## Remaining Work (Phase 3)

- `TagPatternPicker` component with presets:
  - Strict semver: `^v?\d+\.\d+\.\d+.*$`
  - Date: `^\d{8}$`
  - Two-part: `^\d+\.\d+$`
  - Custom regex
- `PUT /api/agents/:agentId/containers/:id` endpoint to persist `tag_pattern` + `update_level` changes to DB.

## Related Pages

- [Feature 1: Semver Policies](feature-01-semver-policies.md)
- [Roadmap Phase 3](../roadmap.md#phase-3)
