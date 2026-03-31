---
sidebar_position: 2
title: Controller Environment Variables
---

# Controller Configuration

The controller requires a PostgreSQL database and a few secrets configured on first startup.

## Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/watchwarden`) |
| `ADMIN_PASSWORD` | Dashboard login password. Stored as bcrypt hash on first startup. Min 8 characters. |
| `JWT_SECRET` | JWT signing secret. Stored in DB on first startup. Min 32 characters. Rejects weak values. |
| `ENCRYPTION_KEY` | AES-256 key for encrypting registry credentials and notification configs. Required on every startup. Min 16 characters. |

## Recommended Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENCRYPTION_SALT` | auto-generated | Salt for scrypt key derivation. Set a unique value per deployment. Changing this invalidates all encrypted data. |
| `CORS_ORIGIN` | `http://localhost:8080` | Allowed CORS origin. **Required** when `NODE_ENV=production`. |

## Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP/WebSocket server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` for secure cookies and CORS enforcement |
| `LOCAL_AGENT_TOKEN` | — | Auto-register a local agent with this pre-shared token |

## Quick Setup

Generate all required secrets:

```bash
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export ADMIN_PASSWORD=$(openssl rand -base64 16)
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
```

The controller validates all secrets at startup and refuses to start with weak or missing values.
