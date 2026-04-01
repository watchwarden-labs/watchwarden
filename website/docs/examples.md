---
sidebar_position: 4
title: Examples
---

# Configuration Examples

Ready-to-use Docker Compose configurations for common deployment scenarios. Each example is self-contained and can be started with `docker compose up -d`.

## Solo Mode

**Directory:** `examples/solo-mode/`

Standalone agent with no controller, database, or UI. Ideal for single-host setups.

```bash
cd examples/solo-mode
docker compose up -d
```

**Demonstrates:** `WW_SCHEDULE`, `WW_AUTO_UPDATE`, notification env vars (Telegram, ntfy, Slack).

## Multi-host

**Directory:** `examples/multi-host/`

Controller + UI + PostgreSQL on the main host. Add remote agents on other Docker hosts.

```bash
cd examples/multi-host
# Set required secrets
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export ADMIN_PASSWORD=$(openssl rand -base64 16)
# ... see the README in the directory
docker compose up -d
```

**Demonstrates:** Controller deployment, agent registration, per-agent schedules.

## Private Registry

**Directory:** `examples/private-registry/`

Agent configured with authentication for Docker Hub, GHCR, and custom registries.

**Demonstrates:** `WW_DOCKER_USERNAME/PASSWORD`, `WW_REGISTRY_AUTH` JSON array for multiple registries.

## Reverse Proxy

**Directory:** `examples/reverse-proxy/`

Full WatchWarden stack behind Traefik with automatic Let's Encrypt TLS.

**Demonstrates:** Traefik labels, HTTPS, `CORS_ORIGIN` configuration, production deployment.

## Update Groups

**Directory:** `examples/update-groups/`

Containers with dependency ordering: database updates first, then API, then frontend.

**Demonstrates:** `com.watchwarden.group`, `com.watchwarden.priority`, `com.watchwarden.depends_on` labels.

## Running an Example

All examples follow the same pattern:

```bash
cd examples/<name>
cat README.md              # Read the setup instructions
docker compose up -d       # Start the stack
docker compose logs -f     # Watch the logs
docker compose down        # Tear down
```
