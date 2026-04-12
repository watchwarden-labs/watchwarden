---
title: ADR-001 — Go for the Agent
type: decision
sources: [OVERVIEW.md]
updated: 2026-04-12
---

# ADR-001 — Go for the Agent

## Context

The agent runs on every Docker host being managed. In multi-host Managed Mode, this could mean many separate deployments. The agent needs to be lightweight, easy to install, and fast to start.

## Decision

The agent is written in Go and compiled to a single static binary.

## Rationale

- Single static binary (~15MB after upx compression, ~4MB cited), zero runtime dependencies
- Instant startup — no JVM warmup, no Node.js module loading
- Excellent concurrency primitives (goroutines, channels) for handling Docker operations in parallel across many containers
- First-class Docker SDK (`docker/client`) maintained by Docker Inc.
- Cross-compiles easily for `linux/amd64`, `linux/arm64`, `linux/arm/v7`

## Consequences

- Two languages in the project (Go agent + TypeScript controller). Context switches required.
- Test tooling is separate (Go `testing` + testify vs. Vitest).
- Agent features must be implemented in Go; no code sharing with the controller.
- Watchtower compatibility layer (`agent/compat.go`) needed to handle Watchtower env var conventions.

## Related Pages

- [System Design](../architecture/system-design.md)
- [Component: Agent](../components/agent.md)
