# Update Groups

Control the order in which containers are updated using labels.

## Labels

| Label | Description |
|-------|-------------|
| `com.watchwarden.group` | Logical group name (e.g., `backend`, `frontend`) |
| `com.watchwarden.priority` | Update order within a group (lower = first) |
| `com.watchwarden.depends_on` | Wait for this container to finish updating first |

## How It Works

1. WatchWarden reads labels from all running containers
2. Containers are sorted by group, then by priority within each group
3. `depends_on` adds an explicit ordering constraint across groups
4. Updates proceed sequentially in the resolved order

## Example

The included `docker-compose.yml` defines this update order:

```
database (priority 10) -> api (priority 20) -> frontend (depends on api)
```

- `database` updates first (lowest priority in `backend` group)
- `api` updates second (higher priority, same group)
- `frontend` updates last (depends on `api`)

## Skipping Containers

To exclude a container from updates entirely:

```yaml
labels:
  - "com.watchwarden.ignore=true"
```
