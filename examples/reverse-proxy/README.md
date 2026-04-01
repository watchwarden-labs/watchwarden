# Reverse Proxy with TLS

Run WatchWarden behind Traefik with automatic Let's Encrypt SSL certificates.

## Quick Start

1. Create a `.env` file:

```bash
DOMAIN=watchwarden.example.com
ACME_EMAIL=you@example.com
POSTGRES_PASSWORD=your-secure-password
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key
ENCRYPTION_SALT=your-encryption-salt
```

2. Ensure your domain points to this server (A record).

3. Start everything:

```bash
docker compose up -d
```

4. Access the UI at `https://your-domain.com`.

## How It Works

- Traefik handles TLS termination and routes traffic by path
- `/api/*` and `/ws/*` requests go to the controller
- All other requests go to the UI
- Certificates are automatically obtained and renewed via Let's Encrypt

## Using nginx Instead

If you prefer nginx, use a config like:

```nginx
server {
    listen 443 ssl;
    server_name watchwarden.example.com;

    location /api/ { proxy_pass http://controller:3000; }
    location /ws/  { proxy_pass http://controller:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
    location /     { proxy_pass http://ui:8080; }
}
```

WebSocket connections require the `Upgrade` and `Connection` headers to be forwarded.
