---
title: Architecture — System Design
type: architecture
sources: [OVERVIEW.md]
updated: 2026-04-12
---

# Architecture — System Design

## Why Three Components?

The split into Controller + Agent + UI reflects a clean separation of concerns:

**Controller** (Node.js/TypeScript + PostgreSQL):
- Runs where your database is
- Handles scheduling, notifications, audit, and orchestration
- Stateless except for PostgreSQL — can be restarted without losing state
- Broadcasts real-time events to UI clients via `UiBroadcaster`

**Agent** (Go binary):
- One per Docker host
- Does the actual Docker operations: inspect, pull, stop, create, start
- ~4MB static binary, zero dependencies
- Reconnects automatically with full-jitter exponential backoff if controller goes down
- Can run standalone (Solo Mode) with its own local scheduler

**UI** (React/Vite, nginx):
- Static build — no server-side rendering
- Pure WebSocket for real-time updates; never polls
- Can be replaced or disabled without affecting controller/agent behavior

See ADR: [Why Go for the Agent](../decisions/adr-001-go-agent.md), [Why WebSocket over REST Polling](../decisions/adr-002-websocket.md).

## Communication Model

```
Web UI ──WebSocket──► Controller ──WebSocket──► Agent(s)
         (ui_ws)         │                      (agent_ws)
                    PostgreSQL
```

All real-time state flows through WebSocket. REST API is used only for configuration mutations (CRUD) and auth.

**Agent → Controller messages** (9 inbound): `REGISTER`, `HEARTBEAT`, `CHECK_RESULT`, `UPDATE_RESULT`, `ROLLBACK_RESULT`, `HEALTH_STATUS`, `LOG_ENTRY`, `DIAGNOSTICS_RESULT`, `PONG`

**Controller → UI messages** (13 outbound): agent/container state, progress events, audit log entries, notification results.

Per-agent message processing uses a **promise chain** to serialize concurrent WebSocket messages. Two concurrent `HEARTBEAT` messages from the same agent cannot interleave at `await` points. See `ws/hub.ts` `agentQueues` map.

## Data Model (Key Tables)

| Table | Purpose |
|-------|---------|
| `agents` | Registered agents, connection state, schedule override |
| `containers` | Per-container state, policy, diff, group/priority/deps |
| `update_log` | Immutable update history with diff snapshots |
| `update_policies` | Per-agent health/rollback/strategy config |
| `notification_channels` | Configured channels with encrypted payloads |
| `registry_credentials` | Encrypted registry auth per agent |
| `audit_log` | Every REST mutation with actor, body (redacted), IP |
| `config` | Key-value global config (schedule, JWT secret, etc.) |

## Security Model

- **Agent auth**: bcrypt-hashed pre-shared tokens; token-prefix index for fast lookup; constant-time comparison with dummy hash to prevent timing attacks
- **UI auth**: JWT, `role === "admin"`, httpOnly cookies; expired tokens cannot be refreshed
- **Encryption at rest**: AES-256-GCM (NIST SP 800-38D), 12-byte IV, scrypt key derivation with per-deployment salt
- **Webhook SSRF protection**: 5 layers — URL blocklist → DNS pre-resolution → resolved IP validation → direct IP connection → blocked header injection
- **Rate limiting**: per-agent WebSocket (30 msg/s burst 60); login brute-force protection

## Related Pages

- [Update Pipeline](update-pipeline.md)
- [Component: Controller](../components/controller.md)
- [Component: Agent](../components/agent.md)
- [ADR: Why Go for Agent](../decisions/adr-001-go-agent.md)
- [ADR: Why WebSocket](../decisions/adr-002-websocket.md)
