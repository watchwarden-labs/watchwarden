---
sidebar_position: 3
title: Architecture
---

# Architecture

WatchWarden operates in two modes with shared core components.

## Solo Mode

Single binary, no external dependencies. The agent handles everything locally.

```
┌─────────────────────────────┐
│     WatchWarden Agent       │
│                             │
│  ┌──────────┐ ┌──────────┐  │
│  │Scheduler │ │ Notifier │  │
│  └────┬─────┘ └──────────┘  │
│       │                     │
│  ┌────┴─────┐ ┌──────────┐  │
│  │ Updater  │ │HTTP :8080│  │
│  └────┬─────┘ └──────────┘  │
│       │                     │
│  ┌────┴─────────────────┐   │
│  │     Docker Client    │   │
│  └──────────────────────┘   │
└──────────┬──────────────────┘
           │ /var/run/docker.sock
     ┌─────┴──────┐
     │ Containers │
     └────────────┘
```

**Components:**
- **Scheduler** — cron or interval-based check triggers
- **Updater** — atomic update/rollback with per-container mutex
- **Notifier** — Telegram, Slack, Webhook, ntfy notifications with custom templates
- **HTTP Server** — health check + status API
- **Docker Client** — Docker SDK operations

## Managed Mode

Multi-host architecture with centralized control.

```
┌──────────────────────────────────────────────────────┐
│                   Web UI (React)                     │
│                      :8080                           │
└───────────────────────┬──────────────────────────────┘
                        │ WebSocket
┌───────────────────────┴──────────────────────────────┐
│              Controller (Node.js) :3000              │
│         ┌─────────────────────────────┐              │
│         │     PostgreSQL :5432        │              │
│         └─────────────────────────────┘              │
└─────┬─────────────────────────────────────┬──────────┘
      │ WebSocket                           │ WebSocket
┌─────┴──────────┐                 ┌────────┴────────┐
│  Agent (Go)    │                 │  Agent (Go)     │
│  Host A        │                 │  Host B         │
└─────┬──────────┘                 └────────┬────────┘
      │ Docker API                          │ Docker API
      ▼                                     ▼
┌────────────┐                     ┌────────────┐
│ Containers │                     │ Containers │
└────────────┘                     └────────────┘
```

**Components:**
- **Controller** — REST API, WebSocket hub, cron scheduler, notification dispatcher
- **Agents** — lightweight Docker SDK clients, one per host
- **UI** — React dashboard with real-time WebSocket updates
- **PostgreSQL** — container state, update history, audit log

## Core Engine (Shared)

Both modes use the same update engine:

### Update Sequence

```
1. Snapshot container config → persist to disk (fsync)
2. Pull new image → idempotent, safe to retry
3. Stop old container → snapshot ensures recovery
4. Remove old container → snapshot has full config
5. Create + start new → if fails, rollback to old image
```

### Blue-Green Update

```
1. Create new container with -ww-new suffix
2. Wait for health check (up to 60s)
3. Save snapshot of old container
4. Stop + remove old container
5. Rename new container to original name
```

:::tip Port conflict fallback
If the new container fails to start due to a port conflict (e.g. direct port mappings like `7575:7575`), the agent automatically falls back to the stop-first strategy. Blue-green is most effective for containers behind a reverse proxy without direct port bindings.
:::

### Crash Recovery

On agent restart, `RecoverOrphans` checks all persisted snapshots against running containers. If a container is missing but a snapshot exists, it recreates from the snapshot using the exact pre-update image digest.

Snapshots are stored at `/var/lib/watchwarden/snapshots`. Mount a named volume to persist them across restarts:

```yaml
volumes:
  - watchwarden_snapshots:/var/lib/watchwarden/snapshots
```

Without this volume, snapshots are lost on agent restart and crash recovery is unavailable.

If using a bind mount instead of a named volume, ensure the host directory is owned by `100:101` (the `warden` user): `sudo chown 100:101 /path/to/snapshots`

### Per-Container Mutex

Every container operation (check, update, rollback) serializes on a per-container lock keyed by canonical name. The lock is released during image pull (which can take minutes) to avoid blocking health monitors and rollbacks.

### TypeScript SDK

The `@watchwarden/types` and `@watchwarden/sdk` packages provide typed API access for external integrations. See [TypeScript SDK](/docs/integrations/sdk).
