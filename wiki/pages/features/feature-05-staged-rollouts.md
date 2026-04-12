---
title: Feature 5 — Staged Rollouts / Canary Groups
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 5 — Staged Rollouts / Canary Groups

> **Status**: Fully implemented at container level. Agent-level grouping and UI editing missing.

## What's Implemented

- DB columns `containers.update_group`, `containers.update_priority` (default 100), `containers.depends_on` JSON (migration 003).
- `controller/src/scheduler/orchestrator.ts` — `resolveUpdateBatches()`, `topologicalSort()`, `executeOrchestratedUpdate()` → sends `UPDATE_SEQUENTIAL`.
- `agent/managed.go` — handles `UPDATE_SEQUENTIAL`, executes batches with health waits between groups.
- `ui/src/components/agents/ContainerRow.tsx` — displays group badge and `depends_on` sub-line; **read-only**.

## What's Missing

- No UI for editing groups, priorities, or dependencies.
- No agent-level grouping (e.g. "canary" vs "prod" agents).
- No "promote canary → prod" workflow.

## Remaining Work (Phase 3)

- UI to edit `update_group`, `update_priority`, `depends_on` per container.
- Add `group TEXT` column to `agents` (new migration); UI filter/trigger by group.
- Optional: stack summary view.

## Related Pages

- [Feature 8: Stack/Dependency Ordering](feature-08-stack-ordering.md)
- [Update Pipeline](../architecture/update-pipeline.md)
- [Roadmap Phase 3](../roadmap.md#phase-3)
