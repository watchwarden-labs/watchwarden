# Multi-Host Setup

Deploy the controller and UI on a central host, then connect agents from remote servers.

## Quick Start

1. Create a `.env` file:

```bash
POSTGRES_PASSWORD=your-secure-password
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key
ENCRYPTION_SALT=your-encryption-salt
```

2. Start the controller:

```bash
docker compose up -d
```

3. Open the UI at `http://<your-host>:8080` and log in with your admin password.

## Adding Remote Agents

On each remote host, run the agent container:

```bash
docker run -d \
  --name watchwarden-agent \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v watchwarden_snapshots:/var/lib/watchwarden/snapshots \
  -e CONTROLLER_URL=ws://<controller-host>:3000/ws/agent \
  -e AGENT_TOKEN=<token-from-ui> \
  -e AGENT_NAME=$(hostname) \
  ghcr.io/watchwarden-labs/watchwarden-agent:latest
```

> **Snapshot volume**: The `watchwarden_snapshots` volume persists rollback snapshots across agent restarts. Without it, crash recovery after restart won't be able to restore containers. If using a bind mount instead of a named volume, ensure the directory is owned by UID `100:101` (the `warden` user inside the container).

Generate the `AGENT_TOKEN` from the UI under **Settings > Agents**.

## Production Notes

- Put the controller behind a reverse proxy with TLS (see `../reverse-proxy/`)
- Use `wss://` instead of `ws://` when TLS is enabled
- Update `CORS_ORIGIN` to match your actual domain
