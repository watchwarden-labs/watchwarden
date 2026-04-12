---
title: Feature 7 — Metrics / Observability
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 7 — Metrics / Observability

> **Status**: Partially implemented. Aggregate only; no per-container labels.

## What's Implemented

**Controller** (`controller/src/api/routes/metrics.ts`) exposes Prometheus `/metrics`:
- `watchwarden_agents_total`, `watchwarden_agents_online`
- `watchwarden_containers_total`, `watchwarden_containers_updates_available`, `watchwarden_containers_excluded`
- `watchwarden_updates_total{status="success|failed|rolled_back"}`

**Agent** (`agent/httpserver.go`) exposes: `/health`, `/api/status`, `/api/containers`, `/api/events`, `/api/check`, `/api/update/{id}`.

## What's Missing

All metrics are aggregate — no `container` or `agent` label breakdown. No agent-side `/metrics` endpoint.

## Remaining Work (Phase 2)

Add to `routes/metrics.ts` (no schema change needed, just extend the SQL join):
```
watchwarden_container_info{agent="...", container="...", image="..."} 1
watchwarden_container_has_update{agent="...", container="..."} 0|1
watchwarden_container_last_updated{agent="...", container="..."} <unix_ms>
```

## Related Pages

- [Roadmap Phase 2](../roadmap.md#phase-2)
- [Architecture: System Design](../architecture/system-design.md)
