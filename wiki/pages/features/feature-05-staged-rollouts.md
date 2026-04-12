---
title: Feature 5 — Staged Rollouts / Canary Groups
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 5 — Staged Rollouts / Canary Groups

> **Status**: Fully implemented at container level including UI editing. Agent-level grouping still missing.

## What's Implemented

- DB columns `containers.update_group`, `containers.update_priority` (default 100), `containers.depends_on` JSON (migration 003).
- `controller/src/scheduler/orchestrator.ts` — `resolveUpdateBatches()`, `topologicalSort()`, `executeOrchestratedUpdate()` → sends `UPDATE_SEQUENTIAL`.
- `agent/managed.go` — handles `UPDATE_SEQUENTIAL`, executes batches with health waits between groups.
- `ui/src/components/agents/ContainerRow.tsx` — displays group badge and `depends_on` sub-line.
- `controller/src/api/routes/agents.ts` — `PATCH /api/agents/:id/containers/:id/orchestration` endpoint (validates priority range 1–999).
- `controller/src/db/queries.ts` — `updateContainerOrchestration()`. COALESCE fix: agent heartbeat no longer overwrites user-set values.
- `ui/src/components/agents/ContainerRow.tsx` — orchestration dialog (pencil icon next to group badge) with group name, priority, and depends-on inputs.

## What's Missing

- No agent-level grouping (e.g. "canary" vs "prod" agents) — `group TEXT` column on `agents` not added.
- No "promote canary → prod" workflow.
- No named stack summary view.

## Related Pages

- [Feature 8: Stack/Dependency Ordering](feature-08-stack-ordering.md)
- [Update Pipeline](../architecture/update-pipeline.md)
- [Roadmap Phase 3](../roadmap.md#phase-3)
