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

## Update Group Labels

Control the order in which containers are updated within a group.

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
