## Unreleased

### Features
- feat: persist image diff in update_log and show in Update History UI — breaking-change badges and full diff view now available in history expanded rows

---

## v0.2.1

Released: 2026-04-07

### Features
- feat: add version stamping to package.json and update changelog in release workflow (a50e392)
- feat: fully responsive/mobile UI (a5c8543)

### Bug Fixes
- fix: responsive issues on Settings page (1aa9c8a)
- fix: mark container status as unknown when agent goes offline (9089680)
- fix: handle agent self-update and snapshot permission (6f54da8)

## v0.2.0

Released: 2026-04-06

### Features
- feat: add agent recovery mode for DB loss scenarios (bbae524)
- feat: add stateful container protection to prevent data loss during updates (429d057)
- feat: add snapshot volume checkbox to agent registration snippet (5dded26)

### Bug Fixes
- fix(test): use unique token for dedup recovery test (22feade)
- fix: update pull request trigger branches to include develop (b3fcd54)
- fix: copy button fallback for non-HTTPS contexts (b2ae3fd)
- fix: protect stateful containers from bulk updates (bfcbe5f)

### Other Changes
- test: add recovery mode API and WebSocket tests (0543317)
- docs: add Recovery Mode section to UI guide (7068c2b)

## v0.1.2

Released: 2026-04-06

### Bug Fixes
- fix: disable provenance for Docker builds in release workflow (ef9b3a6)
- fix: update CI badge link in README to point to the correct workflow (3167c5c)

### Other Changes
- chore: update changelog for v0.1.1 (843df0e)
- chore: update changelog for v0.1.1 (61e8ba4)
- chore: update changelog for v0.1.1 (772eea4)
- chore: update changelog for v0.1.1 (5b0402b)

## v0.1.1

Released: 2026-04-04

### Features
- feat: add build step for shared types in workflows (7222e9c)

### Bug Fixes
- fix: add skip message for already published npm packages in release workflow (79c6976)
- fix: update Docker build context and Dockerfile path in workflows (0ad4175)
- fix: add repository field to package.json for sdk and types packages (50a4a7b)
- fix: update Docker build context and Dockerfile path in workflows (48cb41c)
- fix: update GitHub Actions to use latest versions of checkout, setup-node, setup-go, and github-script (5495f72)
- fix: update Trivy action to v0.35.0 for improved security scanning (6ef21ce)
- fix: update GitHub Actions to use specific version tags for checkout and setup-node (82172f6)
- fix: update payload for manual update test to include containerIds (67f8828)
- fix: update cache-dependency-path for npm in workflows (80a1546)

### Other Changes
- chore: update changelog for v0.1.1 (2319d2b)
- chore: update changelog for v0.1.1 (2339272)
- chore: update changelog for v0.1.1 (a182830)
- test: enhance update check logic in TestCheckForUpdates_WithUpdate (939a3a2)
- refactor: update GitHub Actions to use stable version tags and improve test assertions (92cc2af)

## v0.1.1

Released: 2026-04-04

### Features
- feat: add build step for shared types in workflows (7222e9c)

### Bug Fixes
- fix: add repository field to package.json for sdk and types packages (50a4a7b)
- fix: update Docker build context and Dockerfile path in workflows (48cb41c)
- fix: update GitHub Actions to use latest versions of checkout, setup-node, setup-go, and github-script (5495f72)
- fix: update Trivy action to v0.35.0 for improved security scanning (6ef21ce)
- fix: update GitHub Actions to use specific version tags for checkout and setup-node (82172f6)
- fix: update payload for manual update test to include containerIds (67f8828)
- fix: update cache-dependency-path for npm in workflows (80a1546)

### Other Changes
- chore: update changelog for v0.1.1 (2339272)
- chore: update changelog for v0.1.1 (a182830)
- test: enhance update check logic in TestCheckForUpdates_WithUpdate (939a3a2)
- refactor: update GitHub Actions to use stable version tags and improve test assertions (92cc2af)

## v0.1.1

Released: 2026-04-04

### Features
- feat: add build step for shared types in workflows (7222e9c)

### Bug Fixes
- fix: update Docker build context and Dockerfile path in workflows (48cb41c)
- fix: update GitHub Actions to use latest versions of checkout, setup-node, setup-go, and github-script (5495f72)
- fix: update Trivy action to v0.35.0 for improved security scanning (6ef21ce)
- fix: update GitHub Actions to use specific version tags for checkout and setup-node (82172f6)
- fix: update payload for manual update test to include containerIds (67f8828)
- fix: update cache-dependency-path for npm in workflows (80a1546)

### Other Changes
- chore: update changelog for v0.1.1 (a182830)
- test: enhance update check logic in TestCheckForUpdates_WithUpdate (939a3a2)
- refactor: update GitHub Actions to use stable version tags and improve test assertions (92cc2af)

# Changelog

## v0.1.1

Released: 2026-04-04

### Features
- feat: add build step for shared types in workflows (7222e9c)

### Bug Fixes
- fix: update Trivy action to v0.35.0 for improved security scanning (6ef21ce)
- fix: update GitHub Actions to use specific version tags for checkout and setup-node (82172f6)
- fix: update payload for manual update test to include containerIds (67f8828)
- fix: update cache-dependency-path for npm in workflows (80a1546)

### Other Changes
- test: enhance update check logic in TestCheckForUpdates_WithUpdate (939a3a2)
- refactor: update GitHub Actions to use stable version tags and improve test assertions (92cc2af)

