---
sidebar_position: 2
title: Prometheus Metrics
---

# Prometheus Metrics

The controller exposes a `/metrics` endpoint in standard [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/).

## Endpoint

| Property | Value |
|----------|-------|
| Path | `/metrics` |
| Method | `GET` |
| Auth | None (standard for Prometheus scraping) |
| Format | `text/plain; version=0.0.4` |

## Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `watchwarden_agents_total` | gauge | Total number of registered agents |
| `watchwarden_agents_online` | gauge | Currently connected agents |
| `watchwarden_containers_total` | gauge | Total monitored containers across all agents |
| `watchwarden_containers_updates_available` | gauge | Containers with pending updates |
| `watchwarden_containers_excluded` | gauge | Containers excluded from monitoring |
| `watchwarden_updates_total{status="success"}` | counter | Successful updates |
| `watchwarden_updates_total{status="failed"}` | counter | Failed updates |
| `watchwarden_updates_total{status="rolled_back"}` | counter | Rolled-back updates |

## Prometheus Configuration

Add WatchWarden to your Prometheus scrape config:

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: watchwarden
    scrape_interval: 30s
    static_configs:
      - targets: ["controller:3000"]
```

If the controller is behind a reverse proxy:

```yaml
scrape_configs:
  - job_name: watchwarden
    scrape_interval: 30s
    metrics_path: /metrics
    static_configs:
      - targets: ["watchwarden.example.com"]
    scheme: https
```

## Grafana Dashboard

A minimal Grafana dashboard can visualize:

- **Agent status** — `watchwarden_agents_online` / `watchwarden_agents_total`
- **Update activity** — `rate(watchwarden_updates_total[1h])` by status
- **Pending updates** — `watchwarden_containers_updates_available`

Example panel query for update success rate:
```promql
sum(rate(watchwarden_updates_total{status="success"}[24h]))
/
sum(rate(watchwarden_updates_total[24h]))
```

## Label Strategy

WatchWarden uses a **static label set** to avoid Prometheus cardinality issues. The only label dimension is `status` on update counters. Container-level details (names, images, digests) are available via the REST API and WebSocket, not Prometheus metrics.

:::caution Public Exposure
If `/metrics` is accessible publicly, consider putting it behind a reverse proxy with basic auth or IP whitelisting. The endpoint does not require authentication by default.
:::
