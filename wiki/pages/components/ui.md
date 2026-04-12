---
title: Component — UI (React/Vite)
type: component
sources: [OVERVIEW.md, CLAUDE.md]
updated: 2026-04-12
---

# Component — UI (React/Vite)

The UI is a static React build served by nginx. No server-side rendering. All real-time state arrives via WebSocket — the UI never polls.

## Stack

- React 19, TypeScript strict, Vite
- TanStack Query v5 (server state)
- Zustand (client/WebSocket state)
- shadcn/ui + Tailwind CSS v4
- MSW (Mock Service Worker) for tests

## Key Directories

| Path | Purpose |
|------|---------|
| `src/api/` | API client + TanStack Query hooks |
| `src/ws/` | WebSocket hook |
| `src/store/` | Zustand store (containers, agents, progress events) |
| `src/pages/` | Route pages (Dashboard, AgentDetail, History, Settings, Notifications) |
| `src/components/` | UI components |
| `src/components/agents/ContainerRow.tsx` | Core container row — badges, diff, policy display |
| `src/components/diff/ImageDiffView.tsx` | Full diff view |

## State Model

- **TanStack Query**: handles REST data (agents list, history, settings)
- **Zustand**: handles WebSocket-pushed state (container statuses, progress events, toast notifications)
- WebSocket updates flush to Zustand in 100ms batched windows to avoid excessive re-renders

## Key UX Patterns

- `StabilityPolicyCard` in `AgentDetail.tsx` — per-agent health/rollback/strategy config
- `CronPicker` — schedule override with validation (client-side validation gap: see [F12](../features/feature-12-schedule-validation.md))
- `NotificationsTab`, `AddChannelModal`, `ChannelCard` — full notification CRUD + test-send
- `DiffBadge` / `ImageDiffView` dialog — inline diff viewing from container row and history

## Testing

- Vitest + React Testing Library
- Mock WebSocket
- Fake timers for debounce/toast tests
- Zustand state reset between tests

## Related Pages

- [ADR: UI Backpressure](../decisions/adr-004-ui-backpressure.md)
- [ADR: Why WebSocket](../decisions/adr-002-websocket.md)
- [Feature 12: Schedule Validation](../features/feature-12-schedule-validation.md)
