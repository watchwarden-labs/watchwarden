---
sidebar_position: 1
title: Security & Deployment
---

# Security & Deployment

## Container Hardening

WatchWarden's production compose file includes security directives for all services:

### Controller & UI

```yaml
services:
  controller:
    read_only: true
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp

  ui:
    read_only: true
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
```

Both services run with read-only filesystems and cannot escalate privileges.

### Agent

```yaml
services:
  agent:
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

The agent **cannot** use `read_only: true` because it writes snapshot files to `/var/lib/watchwarden/snapshots` for crash recovery. The Docker socket **must** remain read-write because WatchWarden actively manages containers (stop, remove, create, start).

:::info Why not read-only socket?
WUD (What's Up Docker) can use a read-only Docker socket because it only *monitors* containers. WatchWarden *manages* them — it needs write access for updates, rollbacks, and blue-green deployments. This is an inherent architectural difference, not a missing feature.
:::

## Rootless Docker & Podman

WatchWarden supports rootless Docker and Podman out of the box via the `DOCKER_HOST` environment variable.

**Rootless Docker:**
```bash
docker run -d \
  --name watchwarden-agent \
  -v $XDG_RUNTIME_DIR/docker.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://controller:3000 \
  -e AGENT_TOKEN=your-token \
  alexneo/watchwarden-agent:latest
```

**Podman:**
```bash
podman run -d \
  --name watchwarden-agent \
  -v $XDG_RUNTIME_DIR/podman/podman.sock:/var/run/docker.sock \
  -e CONTROLLER_URL=ws://controller:3000 \
  -e AGENT_TOKEN=your-token \
  alexneo/watchwarden-agent:latest
```

**Docker Compose (rootless):**

Set `DOCKER_SOCKET` in your environment:
```bash
DOCKER_SOCKET=/run/user/1000/docker.sock docker compose up -d
```

## Docker Socket Proxy

For additional isolation, use a [Docker socket proxy](https://github.com/Tecnativa/docker-socket-proxy) to restrict API access:

```yaml
services:
  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      POST: 1

  agent:
    image: alexneo/watchwarden-agent:latest
    environment:
      DOCKER_HOST: tcp://socket-proxy:2375
    depends_on:
      - socket-proxy
```

## Secret Management

All secrets are validated at startup. The controller refuses to start with weak or missing values:

| Secret | Requirement |
|--------|-------------|
| `ADMIN_PASSWORD` | Min 8 characters |
| `JWT_SECRET` | Min 32 characters, rejects known defaults |
| `ENCRYPTION_KEY` | Min 16 characters, rejects known defaults |

Registry credentials are encrypted at rest using AES-256-GCM with a scrypt-derived key. The encryption key itself is never stored — it must be provided via environment variable on every startup.

## API Token Security

WatchWarden supports token-based authentication for external integrations (Home Assistant, CI pipelines, custom scripts) via the [Integration API](/docs/integrations/api).

### How tokens work

1. An admin creates a token in **Settings &rarr; API Tokens** in the web UI
2. The token (`ww_<64-hex-chars>`) is shown **once** and must be stored securely
3. External clients pass the token in the `Authorization: Bearer <token>` header
4. The controller validates the token, checks scopes and expiration, then processes the request

### Storage & hashing

- Tokens are hashed with **SHA-256** before storage — the plaintext is never persisted
- SHA-256 is appropriate here because API tokens are high-entropy random strings (256 bits), unlike user passwords
- Hash comparison uses `crypto.timingSafeEqual` to prevent timing attacks
- A token prefix is stored for fast DB lookup but is **never exposed** via the API

### Scopes

Each token has one or more scopes that restrict access:

| Scope | Access |
|-------|--------|
| `full` | All endpoints (default) |
| `read` | GET endpoints only (summary, container list) |
| `write` | POST endpoints only (check, update, rollback) |

**Best practice:** Use the narrowest scope possible. A monitoring dashboard only needs `read`; only grant `write` or `full` to tools that trigger updates.

### Expiration & rotation

- Tokens can be created with an optional expiration (30 days, 90 days, 1 year, or never)
- Expired tokens are immediately rejected
- Revoked tokens are immediately rejected
- **Recommendation:** Set an expiration and rotate tokens periodically

### Rate limiting

Integration endpoints are rate-limited to **60 requests per minute** per IP to prevent brute-force attacks.

### Audit trail

All token create and revoke operations are recorded in the [audit log](/docs/operations/security#secret-management), including the admin actor and IP address.

## Network Separation

The production compose file uses separate networks:

- **backend** — PostgreSQL ↔ controller ↔ agent (internal only)
- **frontend** — controller ↔ UI (exposed to users)

Remote agents connect to the controller's WebSocket endpoint from outside.

## Reverse Proxy

See the [reverse proxy example](/docs/examples#reverse-proxy) for Traefik with automatic TLS.
