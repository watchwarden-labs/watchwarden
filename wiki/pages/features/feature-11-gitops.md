---
title: Feature 11 — GitOps / PR-Based Updates
type: feature
sources: [reference-feature-audit.md, WW-roadmap-for-claude.md]
updated: 2026-04-12
---

# Feature 11 — GitOps / PR-Based Updates

> **Status**: Not implemented. No Git integration anywhere.

## What It Would Do

Instead of live container updates, GitOps mode would propose changes via Git: commit a tag bump to a `docker-compose.yml` or Kubernetes manifest, and optionally open a PR.

## Minimal Design (if/when built)

- Config key `gitops_mode` + `gitops_repos: [{path, type: "compose"|"manifest", agentId}]`
- New `controller/src/gitops/` module — intercepts `CHECK_RESULT` update decisions and emits Git changes instead of WebSocket update commands
- Initial providers: GitHub, GitLab (extension points for others)

## Recommended Approach

Start with read-only "generate patch" mode before full auto-PR mode. Most WatchWarden users prefer live updates; this is an advanced opt-in.

## Risks

- Error handling: failed pushes, merge conflicts
- Security: Git tokens, secret management
- Significant scope — Phase 4, after all partial features are completed

## Related Pages

- [Roadmap Phase 4](../roadmap.md#phase-4)
