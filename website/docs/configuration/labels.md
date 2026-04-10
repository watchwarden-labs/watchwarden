---
sidebar_position: 3
title: Container Labels
---

# Docker Container Labels

Control WatchWarden's behavior per-container using Docker labels.

## Monitoring Labels

| Label | Values | Description |
|-------|--------|-------------|
| `com.watchwarden.enable` | `true` / `false` | Include or exclude a container from monitoring. When `WATCHWARDEN_LABEL_ENABLE_ONLY=true`, only containers with `enable=true` are monitored. |

### Opt-out mode (default)

All containers are monitored. Exclude specific ones:

```yaml
services:
  database:
    image: postgres:18
    labels:
      - "com.watchwarden.enable=false"
```

### Opt-in mode

Set `WATCHWARDEN_LABEL_ENABLE_ONLY=true` on the agent. Only labeled containers are monitored:

```yaml
services:
  app:
    image: myapp:latest
    labels:
      - "com.watchwarden.enable=true"

  database:
    image: postgres:18
    # Not labeled → not monitored
```

## Stateful Container Protection

WatchWarden auto-detects 30+ known database and stateful images (postgres, mysql, mongo, redis, elasticsearch, kafka, rabbitmq, etc.) and marks them with an `is_stateful` flag. Stateful containers are **automatically skipped** during "Update All" and auto-update operations to prevent data loss. Individual explicit updates still work.

| Label | Values | Description |
|-------|--------|-------------|
| `com.watchwarden.stateful` | `true` / `false` | Override the auto-detection. `true` marks a container as stateful (skipped in bulk updates), `false` treats it as non-stateful even if the image matches a known database. |

The label takes priority over auto-detection.

### Example

```yaml
services:
  # Auto-detected as stateful — skipped by "Update All"
  database:
    image: postgres:18

  # Not a known stateful image, but you want to protect it from bulk updates
  custom-store:
    image: mycompany/data-service:latest
    labels:
      - "com.watchwarden.stateful=true"

  # Redis used as a disposable cache — safe to bulk-update
  cache:
    image: redis:7-alpine
    labels:
      - "com.watchwarden.stateful=false"
```

### Auto-detected stateful images

The agent recognizes these base image names (and variants with `-` suffixes like `postgres-alpine`):

`postgres`, `postgresql`, `mysql`, `mariadb`, `mongo`, `mongodb`, `redis`, `valkey`, `memcached`, `elasticsearch`, `opensearch`, `meilisearch`, `influxdb`, `clickhouse`, `cockroach`, `timescaledb`, `cassandra`, `neo4j`, `couchdb`, `couchbase`, `mssql`, `oracle`, `etcd`, `consul`, `vault`, `zookeeper`, `kafka`, `rabbitmq`, `nats`, `minio`, `rqlite`, `surrealdb`, `arangodb`, `dgraph`, `foundationdb`, `vitess`

## Label vs UI Precedence

Six labels — `policy`, `tag_pattern`, `update_level`, `group`, `priority`, and `depends_on` — can also be configured from the WatchWarden dashboard UI. Expand any container row in the agent detail page to see the **Update Policy** and **Orchestration** panels.

**Labels always take precedence over UI settings.** When a label is present the dashboard:
- Shows the label value as read-only with an amber **"Docker label"** lock badge next to the field name
- Hides the edit input and shows a notice pointing to the exact label key to modify
- Hides the Save button for that panel if every field in it is label-controlled

To hand control back to the UI, remove the label from your Compose file and let the container restart (or trigger a heartbeat). UI-set values are stored in separate database columns and are never overwritten by agent heartbeats — both sources are always visible.

## Update Group Labels

Control the order in which containers are updated within a group. These can also be set per-container from the dashboard UI (see [Label vs UI Precedence](#label-vs-ui-precedence) above).

| Label | Example | Description |
|-------|---------|-------------|
| `com.watchwarden.group` | `backend` | Assign to an update group |
| `com.watchwarden.priority` | `10` | Update priority within group (lower = first) |
| `com.watchwarden.depends_on` | `db,cache` | Wait for these containers to update first |

### Example: Ordered updates

```yaml
services:
  database:
    image: postgres:18
    labels:
      - "com.watchwarden.group=backend"
      - "com.watchwarden.priority=1"

  cache:
    image: redis:7
    labels:
      - "com.watchwarden.group=backend"
      - "com.watchwarden.priority=2"
      - "com.watchwarden.depends_on=database"

  app:
    image: myapp:latest
    labels:
      - "com.watchwarden.group=backend"
      - "com.watchwarden.priority=3"
      - "com.watchwarden.depends_on=database,cache"
```

Update order: `database` → `cache` → `app`. Each waits for the previous to complete successfully.

## Watchtower Label Compatibility

WatchWarden also reads Watchtower's label:

| Watchtower Label | WatchWarden Equivalent |
|---|---|
| `com.centurylinklabs.watchtower.enable` | `com.watchwarden.enable` |

Both labels are checked — WatchWarden's label takes precedence if both are set.

## Policy Labels

Control per-container update behavior — auto-update, notify-only, or manual. Can also be set from the dashboard UI (see [Label vs UI Precedence](#label-vs-ui-precedence)).

| Label | Values | Description |
|-------|--------|-------------|
| `com.watchwarden.policy` | `auto`, `notify`, `manual` | Update policy for this container |

- **`auto`** (default if unset) — container follows the agent/global auto-update setting
- **`notify`** — check for updates and notify, but never auto-update
- **`manual`** — skip update checks entirely; only update via explicit UI/API action

### Example

```yaml
services:
  database:
    image: postgres:18-alpine
    labels:
      - "com.watchwarden.policy=manual"      # Never auto-update the database

  api:
    image: myapp/api:latest
    labels:
      - "com.watchwarden.policy=notify"      # Notify about updates, don't auto-apply

  cache:
    image: redis:7-alpine
    labels:
      - "com.watchwarden.policy=auto"        # Auto-update (default behavior)
```

## Tag Pattern Labels

Filter which registry tags are considered for updates using regex patterns. Can also be set from the dashboard UI policy panel — includes built-in presets for common patterns (see [Label vs UI Precedence](#label-vs-ui-precedence)).

| Label | Format | Description |
|-------|--------|-------------|
| `com.watchwarden.tag_pattern` | regex string | Only consider tags matching this pattern |

When set, WatchWarden queries the registry for all available tags, filters them by the regex pattern, and selects the latest semver match. This is useful for:
- Pinning to a major version: `^v3\.\d+\.\d+$`
- Excluding pre-release tags: `^\d+\.\d+\.\d+$` (no alpha/beta/rc)
- Tracking a specific variant: `^\d+\.\d+-alpine$`

### Example

```yaml
services:
  app:
    image: myapp:v2.1.0
    labels:
      - "com.watchwarden.tag_pattern=^v2\\.\\d+\\.\\d+$"  # Stay on v2.x.x
```

## Semver Level Filtering

Control which semver level changes trigger an update. Requires `com.watchwarden.tag_pattern` to be set.

| Label | Values | Description |
|-------|--------|-------------|
| `com.watchwarden.update_level` | `major`, `minor`, `patch`, `all` | Only report updates at the specified semver level |

- **`all`** (default if unset) — any version increase triggers an update
- **`major`** — same as `all` (any increase)
- **`minor`** — only updates within the same major version (e.g., 1.2.3 → 1.3.0, but not → 2.0.0)
- **`patch`** — only patch updates within the same major.minor (e.g., 1.2.3 → 1.2.4, but not → 1.3.0)

### Example

```yaml
services:
  database:
    image: postgres:16.2
    labels:
      - "com.watchwarden.tag_pattern=^16\\.\\d+$"
      - "com.watchwarden.update_level=patch"     # Only patch updates (16.2 → 16.3, not → 17.0)

  api:
    image: myapp:v2.1.0
    labels:
      - "com.watchwarden.tag_pattern=^v\\d+\\.\\d+\\.\\d+$"
      - "com.watchwarden.update_level=minor"     # Minor+patch updates (v2.1.0 → v2.2.0, not → v3.0.0)
```
