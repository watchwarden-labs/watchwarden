---
title: WatchWarden — Project Overview
type: overview
sources: [OVERVIEW.md, README.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# WatchWarden — Project Overview

WatchWarden is a Docker container update manager with two distinct operating modes:

- **Solo Mode** — drop-in replacement for Watchtower. Single Go binary, no dependencies, just mount `docker.sock`.
- **Managed Mode** — multi-host management with a central Controller (Node.js/TypeScript), lightweight Agents (Go), and a real-time Web UI (React).

## Scale

| Metric | Count |
|--------|-------|
| Source code | ~17,000 LOC |
| Test code | ~7,500 LOC |
| Test cases | 263 (98 Go + 115 TS + 50 React) |
| API endpoints | 39 REST |
| WebSocket message types | 22 (9 inbound, 13 outbound) |
| DB migrations | 10+ |

## Operating Modes

```
Solo Mode:                          Managed Mode:

  Agent (Go)                           Web UI (React)
     |                                      |  WebSocket
  Docker API                          Controller (Node.js)
     |                                /    |    \  WebSocket
  Containers                      Agent   Agent   Agent
                                   |       |       |
                                 Docker  Docker  Docker
```

**Solo Mode** suits single-host setups where you want Watchtower-like behavior with optional notifications (Telegram, Slack, webhook). Configured entirely via environment variables. Compatible with Watchtower env vars via `agent/compat.go`.

**Managed Mode** adds: central scheduling, multi-agent orchestration, grouped/staged updates, health-gated rollback, a web UI with live progress, audit logging, and registry credential management.

## Key Properties

- **Atomic updates with crash recovery** — snapshot persisted to disk before stop; `RecoverOrphans` restores on restart using old image digest (not `:latest`).
- **Blue-green zero-downtime** — new container created with `-ww-new` suffix, health-checked, then old renamed away. Falls back to stop-first on port conflict.
- **Health-gated rollback** — auto-rollback if container is unhealthy > 30s post-update, or crash-loops within 60s.
- **Staged/ordered updates** — `update_group`, `update_priority`, `depends_on` enable topological-sort batching across agents.
- **Real-time UI** — no polling; all status pushed via WebSocket. Controller broadcasts to all connected UI clients via `UiBroadcaster`.
- **Backpressure** — controller throttles `UPDATE_PROGRESS` to 10/s per container; UI batches state updates in 100ms windows.
- **Security** — AES-256-GCM for credentials/notification configs at rest; 5-layer SSRF protection for webhooks; bcrypt agent tokens; JWT UI auth.

## Feature Status Summary

See [features/index.md](features/index.md) for the full 13-feature audit.

| Phase | Features | Status |
|-------|----------|--------|
| Done | Health rollback, staged rollouts, notifications, stack ordering, schedule validation | Fully implemented |
| Phase 1 | Semver policies (UI edit), diff in history, client-side cron validation | Partially implemented |
| Phase 2 | Aging/maintenance windows, per-container metrics, monitor-only refinements | Partially implemented |
| Phase 3 | UI for groups/deps, tag pattern presets, registry rate-limit handling | Partially implemented |
| Phase 4 | GitOps / PR-based mode | Not implemented |

## Related Pages

- [Architecture: System Design](architecture/system-design.md)
- [Architecture: Update Pipeline](architecture/update-pipeline.md)
- [Roadmap](roadmap.md)
- [Features Index](features/index.md)
- [Component: Controller](components/controller.md)
- [Component: Agent](components/agent.md)
- [Component: UI](components/ui.md)
