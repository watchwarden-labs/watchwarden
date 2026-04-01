---
sidebar_position: 5
title: Design Decisions
---

# Design Decisions

WatchWarden makes several deliberate architectural choices that differ from WUD (What's Up Docker) and other tools. This page explains the reasoning.

## Environment Variables, Not YAML

**WatchWarden uses environment variables exclusively for configuration.** There is no YAML config file.

**Why:**
- **12-factor app** — env vars are the standard for containerized applications. Every orchestrator (Docker Compose, Kubernetes, Nomad) natively supports them.
- **No file mounting** — YAML configs require a volume mount. Env vars work with `docker run -e`, compose files, and Kubernetes ConfigMaps/Secrets without extra setup.
- **No parsing complexity** — env vars are flat key-value pairs. No indentation errors, no schema validation needed.
- **Watchtower compatibility** — Watchtower also uses env vars. WatchWarden's compatibility layer maps all `WATCHTOWER_*` variables automatically.

**Mitigation:** The `examples/` directory provides 5 ready-to-use Docker Compose configurations covering solo mode, multi-host, private registries, reverse proxy, and update groups. See [Examples](/docs/examples).

## Docker API, Not Compose File Mutation

**WatchWarden manages containers directly via the Docker API.** It does not modify `docker-compose.yml` files.

WUD offers a "docker-compose trigger" that edits the image tag in your compose file. WatchWarden intentionally does not implement this.

**Why:**
- **Reliability** — editing a YAML file in-place risks corruption, especially with concurrent access. The Docker API is transactional.
- **Rollback** — WatchWarden snapshots the full container config before any change. If an update fails, it can recreate the original container from the snapshot. File-based approaches can't do this.
- **Universality** — the Docker API works regardless of how containers were created (compose, `docker run`, Portainer, Kubernetes). File mutation only works for compose.
- **Version control** — compose files should be in version control. Automatic in-place edits create git conflicts and break CI pipelines.

**Alternative:** Use WatchWarden's webhook notification to trigger a CI pipeline that updates your compose file in version control and deploys it properly.

## Static Prometheus Labels

WatchWarden's `/metrics` endpoint uses a **static label set** (only `status` on update counters). Container names, images, and labels are not exposed as Prometheus dimensions.

**Why:**
- Dynamic labels from container metadata cause **cardinality explosion** in Prometheus. A host with 50 containers and 5 labels each would generate 250+ unique time series per metric — multiplied by every scrape interval.
- WUD has reported issues with Prometheus labelset changes causing scrape errors.
- Container details are available via the REST API (`/api/agents/:id`) and real-time WebSocket for dashboards that need per-container data.

## Read-Write Docker Socket

The agent requires a **read-write** Docker socket mount. WUD can use a read-only mount because it only monitors containers.

WatchWarden needs write access because it:
- Stops, removes, and creates containers during updates
- Renames containers during blue-green deployments
- Manages container lifecycle (start, stop, delete) from the UI

The agent runs with `no-new-privileges` security option and the `warden` non-root user to minimize risk. For additional isolation, use a [Docker socket proxy](/docs/operations/security#docker-socket-proxy).
