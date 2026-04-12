---
title: Features — Index
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Features — Index

13 feature areas audited. Status reflects the codebase as of 2026-04-12.

| # | Feature | Status | Roadmap Phase | Page |
|---|---------|--------|---------------|------|
| 1 | Semver policies & update levels | Partial | Phase 1 | [→](feature-01-semver-policies.md) |
| 2 | Change-awareness / diff detection | **Full** | Done | [→](feature-02-diff-detection.md) |
| 3 | Health-gated updates & auto-rollback | **Full** | Done | [→](feature-03-health-rollback.md) |
| 4 | Aging / maintenance windows | Partial | Phase 2 | [→](feature-04-aging.md) |
| 5 | Staged rollouts / canary groups | **Full** (container level) | Done | [→](feature-05-staged-rollouts.md) |
| 6 | Notifications | **Full** | Done | [→](feature-06-notifications.md) |
| 7 | Metrics / observability | Partial | Phase 2 | [→](feature-07-metrics.md) |
| 8 | Stack / dependency ordering | **Full** | Done | [→](feature-08-stack-ordering.md) |
| 9 | Tag pattern presets & non-semver | Partial | Phase 3 | [→](feature-09-tag-patterns.md) |
| 10 | Registry-aware behavior & rate limits | Partial | Phase 3 | [→](feature-10-registry.md) |
| 11 | GitOps / PR-based updates | **None** | Phase 4 | [→](feature-11-gitops.md) |
| 12 | Schedule validation | Largely done | Phase 1 (small gap) | [→](feature-12-schedule-validation.md) |
| 13 | Monitor-only refinements & alert suppression | Partial | Phase 2 | [→](feature-13-monitor-only.md) |

## Status Key

- **Full** — core behavior complete and tested
- **Partial** — logic exists but gaps in UI, enforcement, or edge cases
- **Largely done** — minor gaps only
- **None** — not started

## Related Pages

- [Roadmap](../roadmap.md)
- [Update Pipeline](../architecture/update-pipeline.md)
