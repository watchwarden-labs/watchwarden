# Private Registry Authentication

Configure WatchWarden to pull and check updates from private container registries.

## Docker Hub

Set credentials via environment variables or a `.env` file:

```bash
DOCKER_USERNAME=your-username
DOCKER_PASSWORD=your-access-token
```

Use a [Docker Hub access token](https://hub.docker.com/settings/security) instead of your password.

## GitHub Container Registry (GHCR)

Uncomment `WW_REGISTRY_AUTH` in `docker-compose.yml` and add your GHCR credentials:

```json
[{"registry": "ghcr.io", "username": "your-github-user", "password": "ghp_your-token"}]
```

Create a [personal access token](https://github.com/settings/tokens) with `read:packages` scope.

## Multiple Registries

`WW_REGISTRY_AUTH` accepts a JSON array. Combine as many registries as needed:

```json
[
  {"registry": "ghcr.io", "username": "user", "password": "ghp_xxx"},
  {"registry": "registry.example.com", "username": "admin", "password": "secret"}
]
```

When both `WW_DOCKER_USERNAME` and `WW_REGISTRY_AUTH` are set, Docker Hub credentials
are used for Docker Hub images and `WW_REGISTRY_AUTH` entries for their respective registries.

## Quick Start

```bash
cp .env.example .env   # edit with your credentials
docker compose up -d
```
