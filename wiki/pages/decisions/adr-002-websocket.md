---
title: ADR-002 — WebSocket for All Real-Time Communication
type: decision
sources: [OVERVIEW.md]
updated: 2026-04-12
---

# ADR-002 — WebSocket for All Real-Time Communication

## Context

Container update events (status changes, pull progress, health check results) need to reach the UI immediately. The question was whether to use WebSocket, Server-Sent Events, or REST polling.

## Decision

WebSocket is used for all real-time communication: both Agent↔Controller and Controller↔UI.

## Rationale

- **Bidirectional**: Controller can push commands (check, update, rollback) to agents; agents push results back. SSE is one-way; polling adds latency and load.
- **Live progress bars**: `UPDATE_PROGRESS` events for every container at every step. Multi-container bulk updates across multiple agents need per-step visibility — only practical with streaming.
- **No polling from UI**: Zero polling eliminates unnecessary DB queries; the UI stays current without any client-initiated requests.
- **Single connection, multiple agents**: `UiBroadcaster` maintains a set of connected UI clients and broadcasts atomically to all of them on every state change.

## Consequences

- **Backpressure required**: During bulk updates, agents send 100s of events/second. Controller throttles `UPDATE_PROGRESS` to 10/s per container; UI batches updates in 100ms windows into a single Zustand `set()`.
- **Message ordering**: Node.js async handlers can interleave at `await` points. Solution: per-agent promise chain (`agentQueues` in `ws/hub.ts`) serializes message processing.
- **Client tracking**: Controller maintains a snapshot of the UI client Set for broadcasting (iterating the live Set during deletion skips clients).
- **Connection lifecycle**: Every Docker operation derives its context from `wsClient.ConnectionCtx()` — operations cancel automatically when the connection drops.

## Related Pages

- [System Design](../architecture/system-design.md)
- [ADR-004: UI Backpressure](adr-004-ui-backpressure.md)
