---
sidebar_position: 3
title: Home Assistant
---

# Home Assistant Integration

WatchWarden provides a custom integration for [Home Assistant](https://www.home-assistant.io/) that exposes your Docker container update status as sensors and lets you trigger checks, updates, and rollbacks from HA automations.

:::note Work in progress
The Home Assistant custom component (`custom_components/watchwarden`) is under active development. This page documents the intended setup flow — the integration will be published as a HACS repository.
:::

## Prerequisites

- A running WatchWarden controller accessible from your Home Assistant instance
- An API token created in **Settings &rarr; API Tokens** in the WatchWarden UI

## Setup

### 1. Create an API token

In the WatchWarden web UI:

1. Go to **Settings &rarr; API Tokens**
2. Click **Create Token**
3. Name it `Home Assistant`
4. Set expiration as desired (or leave at "Never")
5. Copy the token — it is shown only once

### 2. Install the integration

Once published, the integration will be installable via [HACS](https://hacs.xyz/). Until then, copy the `custom_components/watchwarden/` folder into your HA config directory.

### 3. Configure in Home Assistant

Add via the HA UI:

1. Go to **Settings &rarr; Devices & Services &rarr; Add Integration**
2. Search for "WatchWarden"
3. Enter:
   - **URL**: your controller URL (e.g. `http://192.168.1.100:3000`)
   - **API Token**: the token you copied in step 1

## What the Integration Provides

### Sensors

| Entity | Description |
|--------|-------------|
| `sensor.watchwarden_containers_total` | Total monitored containers |
| `sensor.watchwarden_updates_available` | Containers with pending updates |
| `sensor.watchwarden_unhealthy` | Containers with non-healthy status |
| `sensor.watchwarden_agents_online` | Connected agents |

### Services

| Service | Description |
|---------|-------------|
| `watchwarden.check_all` | Trigger update checks on all agents |
| `watchwarden.check_containers` | Check specific containers by ID |
| `watchwarden.update_containers` | Apply updates to specific containers |
| `watchwarden.rollback_containers` | Rollback specific containers |

### Example Automation

```yaml
automation:
  - alias: "Notify on new Docker updates"
    trigger:
      - platform: state
        entity_id: sensor.watchwarden_updates_available
    condition:
      - condition: numeric_state
        entity_id: sensor.watchwarden_updates_available
        above: 0
    action:
      - service: notify.mobile_app
        data:
          title: "Docker updates available"
          message: >
            {{ states('sensor.watchwarden_updates_available') }}
            container(s) have updates available.
```

## API Reference

The integration communicates with WatchWarden via the [Integration API](./api.md). If you are building a custom integration or script, refer to that page for the full HTTP contract, authentication details, and endpoint documentation.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `401 Unauthorized` | Token is invalid, revoked, or expired. Create a new one in the WatchWarden UI. |
| `403 Forbidden` | Token scope is too narrow. Use `full` scope for HA. |
| Connection refused | Verify the controller URL is reachable from the HA host. Check firewall rules. |
| Sensors not updating | The integration polls every 60 seconds. Check HA logs for errors. |
