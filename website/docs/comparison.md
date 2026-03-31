---
sidebar_position: 2
title: WatchWarden vs Watchtower
---

# WatchWarden vs Watchtower

WatchWarden is a modern alternative to [Watchtower](https://github.com/containrrr/watchtower). Use it as a drop-in replacement (Solo Mode) or scale to multi-host with the Controller + UI.

## Feature Comparison

| Feature | WatchWarden | Watchtower |
|---------|:-----------:|:----------:|
| **Standalone Mode** | ✅ Solo + Managed | ✅ Standalone only |
| **Watchtower Env Var Compat** | ✅ Drop-in replacement | — |
| **Web Dashboard** | ✅ Real-time UI | ❌ CLI only |
| **Multi-host Management** | ✅ Central controller + agents | ❌ Single host |
| **Blue-green Updates** | ✅ Zero-downtime, health-verified | ❌ None |
| **Rollback** | ✅ Any version + snapshot restore | ❌ None |
| **Health-based Auto-Rollback** | ✅ Stability window + crash-loop | ❌ None |
| **Crash-loop Detection** | ✅ Auto-detects and rolls back | ❌ None |
| **Update Groups / Dependencies** | ✅ Label-based ordering | ❌ None |
| **Image Diff Preview** | ✅ Before update | ❌ None |
| **Pinned Version Detection** | ✅ Blocks explicit tags | ❌ None |
| **Vulnerability Scanning** | ✅ Trivy-based CVE scanning | ❌ None |
| **Image Signing (Cosign)** | ✅ Verify before pull | ❌ None |
| **Audit Log** | ✅ Full trail with details | ❌ None |
| **REST API** | ✅ Full CRUD | ❌ None |
| **HTTP Status API** | ✅ `/health`, `/api/containers` | ✅ `/v1/update` |
| **Notifications** | ✅ Telegram, Slack, Webhook | ✅ Email, Slack, etc. |
| **Container Exclusion** | ✅ Labels | ✅ Labels |
| **Update Scheduling** | ✅ Global + per-agent cron | ✅ Cron schedule |
| **Auto-update** | ✅ Per-agent or global | ✅ Global |
| **Image Pruning** | ✅ Keeps N-1 for rollback | ✅ Cleanup flag |
| **Private Registry Auth** | ✅ Encrypted + env vars | ✅ Config file |
| **Database** | ✅ PostgreSQL (Managed) | ❌ Stateless |
| **License** | BSL 1.1 | Apache 2.0 |

## Migration from Watchtower

WatchWarden reads all standard `WATCHTOWER_*` environment variables automatically. Just swap the image:

```bash
# Before (Watchtower)
docker run -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_POLL_INTERVAL=3600 \
  -e WATCHTOWER_CLEANUP=true \
  containrrr/watchtower

# After (WatchWarden) — same env vars work
docker run -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_POLL_INTERVAL=3600 \
  -e WATCHTOWER_CLEANUP=true \
  alexneo/watchwarden-agent:latest
```

All Watchtower environment variables are automatically mapped to their WatchWarden equivalents at startup. The agent logs which mappings were applied:

```
[compat] WATCHTOWER_POLL_INTERVAL=3600 → WW_SCHEDULE=@every 3600s
[compat] WATCHTOWER_CLEANUP=true → WW_PRUNE
```

See [Agent Configuration](/docs/configuration/agent-env#watchtower-compatibility) for the full mapping table.
