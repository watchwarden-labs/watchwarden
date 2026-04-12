---
title: ADR-004 — UI Backpressure & Progress Debouncing
type: decision
sources: [OVERVIEW.md]
updated: 2026-04-12
---

# ADR-004 — UI Backpressure & Progress Debouncing

## Context

During bulk updates, agents send `UPDATE_PROGRESS` events for every container at every step. Without protection, this causes two problems:
1. Controller floods all UI clients (potentially 100s of events/sec per container)
2. UI triggers 100s of React re-renders per second, making the browser unresponsive

## Decision

Two-layer backpressure: throttling at the controller, debouncing at the UI.

**Controller-side** (`ws/hub.ts`):
- Throttles `UPDATE_PROGRESS` broadcasts to 10/sec per container
- Skips clients with >1MB buffered write data (slow/stalled connections)
- Iterates a **snapshot** of the client Set — avoids skipping clients that are removed from the Set during iteration

**UI-side** (Zustand store):
- Buffers progress updates for 100ms before flushing to state in a single `set()` call
- Toast notifications track timer IDs and clear them on removal — prevents memory leaks during bulk operations

## Rationale

- 10/sec is sufficient for smooth progress bars in the UI; human perception doesn't benefit from higher rates
- Buffering at the UI reduces React reconciliation work by batching many small updates into one state transition
- Skipping stalled connections prevents a slow client from blocking the broadcast loop

## Consequences

- Progress granularity is limited to 10 events/sec per container at the controller
- UI state lags up to 100ms behind reality (acceptable for progress visualization)
- The 1MB buffer threshold means very slow connections will miss some progress events but will still see the final state

## Related Pages

- [ADR-002: WebSocket](adr-002-websocket.md)
- [Component: UI](../components/ui.md)
