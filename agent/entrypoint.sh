#!/bin/sh
set -e

# Detect the actual GID of the Docker socket at runtime.
# This handles macOS Docker Desktop / Colima where the socket GID inside
# the container differs from what `stat` reports on the host.
if [ -S /var/run/docker.sock ]; then
    SOCK_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock 2>/dev/null)
    if [ -z "$SOCK_GID" ]; then
        echo "WARNING: could not determine docker.sock GID — agent may lack socket access"
    elif [ "$SOCK_GID" = "0" ]; then
        # Docker Desktop (macOS/Windows WSL2): socket owned by root group.
        # On Windows with Docker Desktop, the Unix socket is exposed inside
        # the Linux VM (WSL2), so this path is reached. On Windows without WSL2,
        # Docker uses named pipes and this container would not be applicable.
        adduser warden root 2>/dev/null || true
    else
        existing=$(getent group "$SOCK_GID" 2>/dev/null | cut -d: -f1)
        if [ -n "$existing" ]; then
            adduser warden "$existing" 2>/dev/null || true
        else
            addgroup -g "$SOCK_GID" dockersock 2>/dev/null || true
            adduser warden dockersock 2>/dev/null || true
        fi
    fi
fi

exec su-exec warden watchwarden-agent
