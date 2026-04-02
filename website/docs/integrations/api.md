---
sidebar_position: 2
title: Integration API
---

# Integration API

WatchWarden exposes a stable HTTP API designed for external integrations such as [Home Assistant](./home-assistant.md), CI pipelines, and custom monitoring tools. This page is the canonical reference for the API contract.

**Contract version:** 1.1  
**Base path:** `<controller_url>/api/integrations/watchwarden`

:::info Stability guarantee
All endpoints listed here are considered stable. Breaking changes (removed fields, changed types, renamed paths) will be announced in release notes and accompanied by a contract version bump.
:::

---

## Authentication

All integration endpoints require an **API token**. Tokens are created in the WatchWarden UI under **Settings &rarr; API Tokens**.

Pass the token in one of these headers:

```http
Authorization: Bearer ww_a1b2c3d4...
```

Fallback header (useful when `Authorization` is reserved by a reverse proxy):

```http
X-WW-Token: ww_a1b2c3d4...
```

Token format: `ww_` followed by 64 hex characters (e.g. `ww_a1b2c3d4e5f6...`).

### Scopes

Each token is created with one or more scopes that limit what it can do:

| Scope | Access |
|-------|--------|
| `full` | All endpoints (read + write). **Default.** |
| `read` | GET endpoints only (summary, containers) |
| `write` | POST endpoints only (check, update, rollback) |

### Rate Limiting

Integration endpoints are rate-limited to **60 requests per minute** per IP address.

### Error Responses

All errors follow a consistent shape:

```json
{
  "error": "Human-readable error message"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Invalid request body |
| `401` | Missing, invalid, revoked, or expired API token |
| `403` | Token lacks required scope |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Endpoints

### `GET /summary`

Returns a high-level overview of the WatchWarden deployment.

**Required scope:** `read` or `full`

<details>
<summary>Example request</summary>

```bash
curl -s -H "Authorization: Bearer $WW_TOKEN" \
  https://watchwarden.local/api/integrations/watchwarden/summary
```

</details>

**Response** `200 OK`

```json
{
  "containers_total": 42,
  "containers_with_updates": 5,
  "unhealthy_containers": 1,
  "agents_online": 3,
  "agents_total": 4,
  "last_check": "2026-04-01T19:35:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `containers_total` | `int` | Total monitored containers |
| `containers_with_updates` | `int` | Containers with available updates |
| `unhealthy_containers` | `int` | Containers with non-healthy status |
| `agents_online` | `int` | Connected agents |
| `agents_total` | `int` | All registered agents |
| `last_check` | `string \| null` | ISO 8601 timestamp of most recent check |

---

### `GET /containers`

Returns all monitored containers with their current state.

**Required scope:** `read` or `full`

**Query parameters**

| Param | Type | Description |
|-------|------|-------------|
| `agent_id` | `string` | Optional. Filter by agent ID. |

<details>
<summary>Example request</summary>

```bash
# All containers
curl -s -H "Authorization: Bearer $WW_TOKEN" \
  https://watchwarden.local/api/integrations/watchwarden/containers

# Filtered by agent
curl -s -H "Authorization: Bearer $WW_TOKEN" \
  "https://watchwarden.local/api/integrations/watchwarden/containers?agent_id=<uuid>"
```

</details>

**Response** `200 OK`

```json
[
  {
    "id": "abc123def456",
    "agent_id": "uuid-of-agent",
    "agent_name": "prod-host-1",
    "name": "traefik",
    "image": "traefik:v3.1",
    "current_digest": "sha256:aaa...",
    "latest_digest": "sha256:bbb...",
    "has_update": true,
    "status": "running",
    "health_status": "healthy",
    "policy": "auto",
    "tag_pattern": "^v3\\.1\\.\\d+$",
    "update_level": "minor",
    "last_checked_at": "2026-04-01T19:35:00.000Z",
    "last_updated_at": "2026-04-01T18:10:00.000Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Docker container ID — use this for check/update/rollback |
| `agent_id` | `string` | Agent UUID |
| `agent_name` | `string` | Human-readable agent name |
| `name` | `string` | Container name |
| `image` | `string` | Full image reference (name:tag) |
| `current_digest` | `string \| null` | Running image digest |
| `latest_digest` | `string \| null` | Latest available digest |
| `has_update` | `boolean` | Whether an update is available |
| `status` | `string` | Docker status (`running`, `exited`, etc.) |
| `health_status` | `string` | `healthy`, `unhealthy`, `starting`, `none`, `unknown` |
| `policy` | `string \| null` | `auto`, `notify`, `manual`, or `null` (global default) |
| `tag_pattern` | `string \| null` | Regex filter for valid tags |
| `update_level` | `string \| null` | `major`, `minor`, `patch`, `all` |
| `last_checked_at` | `string \| null` | ISO 8601 timestamp |
| `last_updated_at` | `string \| null` | ISO 8601 timestamp |

---

### `POST /containers/check`

Trigger update checks for containers.

**Required scope:** `write` or `full`

**Request body**

```json
{ "container_ids": ["abc123", "def456"] }
```

Or check everything:

```json
{ "all": true }
```

An empty body `{}` also checks all containers.

<details>
<summary>Example request</summary>

```bash
# Check all
curl -s -X POST -H "Authorization: Bearer $WW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"all": true}' \
  https://watchwarden.local/api/integrations/watchwarden/containers/check

# Check specific containers
curl -s -X POST -H "Authorization: Bearer $WW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"container_ids": ["abc123def456"]}' \
  https://watchwarden.local/api/integrations/watchwarden/containers/check
```

</details>

**Response** `202 Accepted`

```json
{
  "message": "Check initiated for 3 agent(s)",
  "agents_checked": 3
}
```

---

### `POST /containers/update`

Trigger updates for specific containers.

**Required scope:** `write` or `full`

**Request body**

```json
{ "container_ids": ["abc123", "def456"] }
```

:::caution
Updates are **destructive** — containers are recreated with the new image. Use with care in production. Updates respect dependency ordering and update groups.
:::

<details>
<summary>Example request</summary>

```bash
curl -s -X POST -H "Authorization: Bearer $WW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"container_ids": ["abc123def456"]}' \
  https://watchwarden.local/api/integrations/watchwarden/containers/update
```

</details>

**Response** `202 Accepted`

```json
{
  "message": "Update initiated for 2 container(s)",
  "agents_updated": 1
}
```

---

### `POST /containers/rollback`

Trigger rollback for specific containers to their previous version.

**Required scope:** `write` or `full`

**Request body**

```json
{ "container_ids": ["abc123"] }
```

<details>
<summary>Example request</summary>

```bash
curl -s -X POST -H "Authorization: Bearer $WW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"container_ids": ["abc123def456"]}' \
  https://watchwarden.local/api/integrations/watchwarden/containers/rollback
```

</details>

**Response** `202 Accepted`

```json
{
  "message": "Rollback initiated for 1 container(s)",
  "containers_queued": 1
}
```

---

## Token Management API

These endpoints are used by the WatchWarden web UI to manage API tokens. They require **JWT authentication** (the admin login), not API token auth.

### `POST /api/api-tokens`

Create a new API token.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Label for the token (max 128 chars) |
| `scopes` | `string[]` | No | Default: `["full"]`. Options: `full`, `read`, `write` |
| `expires_in_days` | `number` | No | Token lifetime in days. Omit for no expiration. |

**Response** `201 Created`

```json
{
  "id": "uuid",
  "name": "Home Assistant",
  "token": "ww_a1b2c3d4...",
  "scopes": ["full"],
  "expires_at": 1727827200000,
  "created_at": 1720051200000
}
```

:::warning
The `token` field is returned **only in this response**. Store it securely — it cannot be retrieved again.
:::

### `GET /api/api-tokens`

List all tokens. Hashes and prefixes are never exposed.

### `DELETE /api/api-tokens/:id`

Revoke a token immediately. Returns `204 No Content`.

---

## Security

- Token hashed with SHA-256 before storage (high-entropy random input)
- Hash comparison uses `crypto.timingSafeEqual` (constant-time)
- Token prefixes stored for fast DB lookup, never exposed to API consumers
- All create/revoke operations are audit-logged
- Rate-limited at 60 req/min per IP
- Scope enforcement on every endpoint
- Optional expiration with `expires_in_days`

{/* Future: when an openapi.yaml is added, render it here with @docusaurus/plugin-redoc or similar. The contract above would become the generated output instead of hand-written Markdown. */}
