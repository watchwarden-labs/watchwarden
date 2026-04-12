---
title: Feature 10 — Registry-Aware Behavior & Rate Limits
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 10 — Registry-Aware Behavior & Rate Limits

> **Status**: Partially implemented. Credentials + ECR done; caching and rate-limit handling absent.

## What's Implemented

- `agent/registry.go` — Docker Hub (`docker.io`/`""`) uses V1 API; others use V2 API.
- `agent/credstore.go` — `RegistryCredential{Registry, Username, Password, AuthType}`. ECR refresh every 10h via `aws ecr get-login-password`. DB table `registry_credentials` (migration 014).
- Controller syncs credentials to agents.

## What's Missing

- No ETag/`If-None-Match` caching — every poll is a fresh fetch.
- No 429/503 backoff on registry calls.
- No UI warning for anonymous Docker Hub usage.
- No registry section in diagnostics bundle.

## Remaining Work (Phase 3)

- `agent/registry.go` — in-memory `map[string]string` ETag cache; `If-None-Match` header; handle HTTP 304.
- Exponential backoff on 429/503 (reuse pattern from `agent/ws.go`).
- Diagnostics bundle: add `registries` section listing configured registries + anonymous flag.
- UI warning for Docker Hub anonymous usage (rate limited at 100 pulls/6h).

## Related Pages

- [Roadmap Phase 3](../roadmap.md#phase-3)
- [Architecture: System Design](../architecture/system-design.md)
