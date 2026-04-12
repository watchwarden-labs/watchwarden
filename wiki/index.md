# WatchWarden Wiki — Index

Content catalog. Updated on every ingest. LLM reads this first when answering queries.

---

## Pages

### Overview & Roadmap

| Page | Summary |
|------|---------|
| [overview.md](pages/overview.md) | What WatchWarden is, two modes, scale, key properties, feature status summary |
| [roadmap.md](pages/roadmap.md) | 4-phase roadmap with per-feature tasks and current status |

### Architecture

| Page | Summary |
|------|---------|
| [architecture/system-design.md](pages/architecture/system-design.md) | Why three components, communication model, data model, security model |
| [architecture/update-pipeline.md](pages/architecture/update-pipeline.md) | Update strategies, atomic sequence, crash recovery, mutex, health monitoring, context cancellation |

### Features (13)

| Page | Summary |
|------|---------|
| [features/index.md](pages/features/index.md) | Status table for all 13 features |
| [features/feature-01-semver-policies.md](pages/features/feature-01-semver-policies.md) | F1: Semver — infrastructure done, UI editing and enforcement missing |
| [features/feature-02-diff-detection.md](pages/features/feature-02-diff-detection.md) | F2: Diff detection — fully implemented; no release notes fetching |
| [features/feature-03-health-rollback.md](pages/features/feature-03-health-rollback.md) | F3: Health-gated updates and auto-rollback — fully implemented |
| [features/feature-04-aging.md](pages/features/feature-04-aging.md) | F4: Aging / maintenance windows — schedules exist, aging logic missing |
| [features/feature-05-staged-rollouts.md](pages/features/feature-05-staged-rollouts.md) | F5: Staged rollouts — container level done, UI editing and agent groups missing |
| [features/feature-06-notifications.md](pages/features/feature-06-notifications.md) | F6: Notifications — core fully done; per-agent targeting and version vars missing |
| [features/feature-07-metrics.md](pages/features/feature-07-metrics.md) | F7: Metrics — aggregate only; no per-container labels yet |
| [features/feature-08-stack-ordering.md](pages/features/feature-08-stack-ordering.md) | F8: Stack/dependency ordering — fully implemented via update_group/depends_on |
| [features/feature-09-tag-patterns.md](pages/features/feature-09-tag-patterns.md) | F9: Tag patterns — logic done, UI presets and editing missing |
| [features/feature-10-registry.md](pages/features/feature-10-registry.md) | F10: Registry — creds and ECR done; ETag caching and rate-limit backoff missing |
| [features/feature-11-gitops.md](pages/features/feature-11-gitops.md) | F11: GitOps — not implemented |
| [features/feature-12-schedule-validation.md](pages/features/feature-12-schedule-validation.md) | F12: Schedule validation — server-side done; client-side preview missing |
| [features/feature-13-monitor-only.md](pages/features/feature-13-monitor-only.md) | F13: Monitor-only — basic cooldown done; env separation and digest-independent dedup missing |

### Components

| Page | Summary |
|------|---------|
| [components/agent.md](pages/components/agent.md) | Go agent — key files, concurrency model, testing |
| [components/controller.md](pages/components/controller.md) | Node.js controller — WS hub, scheduler, orchestrator, DB |
| [components/ui.md](pages/components/ui.md) | React UI — state model, key components, testing |

### Decisions (ADRs)

| Page | Summary |
|------|---------|
| [decisions/adr-001-go-agent.md](pages/decisions/adr-001-go-agent.md) | Why Go for the agent (binary size, concurrency, Docker SDK) |
| [decisions/adr-002-websocket.md](pages/decisions/adr-002-websocket.md) | Why WebSocket over REST polling (bidirectional, live progress, no polling) |
| [decisions/adr-003-snapshot-recovery.md](pages/decisions/adr-003-snapshot-recovery.md) | Snapshot-based crash recovery (fsync before destructive ops, old digest on restore) |
| [decisions/adr-004-ui-backpressure.md](pages/decisions/adr-004-ui-backpressure.md) | UI backpressure — controller throttle + UI 100ms debounce |

---

## Raw Sources

| File | Date ingested | Notes |
|------|--------------|-------|
| (initial bootstrap from existing repo docs — OVERVIEW.md, WW-roadmap-for-claude.md, reference-feature-audit.md) | 2026-04-12 | Not in raw/ — docs live in repo root |

---

## Tags

- `#update-pipeline` → [update-pipeline.md](pages/architecture/update-pipeline.md), [feature-03-health-rollback.md](pages/features/feature-03-health-rollback.md), [feature-05-staged-rollouts.md](pages/features/feature-05-staged-rollouts.md)
- `#security` → [system-design.md](pages/architecture/system-design.md), [adr-003-snapshot-recovery.md](pages/decisions/adr-003-snapshot-recovery.md)
- `#notifications` → [feature-06-notifications.md](pages/features/feature-06-notifications.md), [feature-13-monitor-only.md](pages/features/feature-13-monitor-only.md)
- `#registry` → [feature-10-registry.md](pages/features/feature-10-registry.md), [feature-09-tag-patterns.md](pages/features/feature-09-tag-patterns.md)
- `#websocket` → [adr-002-websocket.md](pages/decisions/adr-002-websocket.md), [adr-004-ui-backpressure.md](pages/decisions/adr-004-ui-backpressure.md), [components/controller.md](pages/components/controller.md)
- `#roadmap` → [roadmap.md](pages/roadmap.md), [features/index.md](pages/features/index.md)
