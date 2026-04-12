---
title: Feature 8 — Stack / Application Grouping
type: feature
sources: [reference-feature-audit.md]
updated: 2026-04-12
---

# Feature 8 — Stack / Application Grouping

> **Status**: Fully implemented (no "stack" noun, but equivalent exists via update_group + depends_on).

## What's Implemented

- `update_group` + `update_priority` + `depends_on` = stack concept.
- `orchestrator.ts` — topological sort + priority batching handles ordered updates.
- `is_stateful` (migration 019) — excludes databases and other stateful containers from bulk updates.
- `UPDATE_SEQUENTIAL` handled in `agent/managed.go`.

## Gap

- No named "stack" summary view (no user-facing concept of a stack as a first-class entity).

UI editing of groups and dependencies is now done — see [Feature 5](feature-05-staged-rollouts.md).

## Related Pages

- [Feature 5: Staged Rollouts](feature-05-staged-rollouts.md)
- [Update Pipeline](../architecture/update-pipeline.md)
