---
sidebar_position: 1
title: TypeScript SDK
---

# TypeScript SDK

WatchWarden provides two npm packages for programmatic access:

| Package | Description |
|---------|-------------|
| `@watchwarden/types` | Shared TypeScript type definitions |
| `@watchwarden/sdk` | Typed API client |

## Installation

```bash
npm install @watchwarden/types @watchwarden/sdk
```

## Quick Start

```typescript
import { WatchWardenClient } from "@watchwarden/sdk";

const client = new WatchWardenClient({
  baseUrl: "http://localhost:3000",
});

// Login
await client.login("admin-password");

// List all agents
const agents = await client.listAgents();
console.log(`${agents.length} agents registered`);

// Get agent details with containers
const agent = await client.getAgent(agents[0].id);
for (const container of agent.containers ?? []) {
  console.log(`${container.name}: ${container.has_update ? "UPDATE" : "OK"}`);
}
```

## API Methods

### Auth

| Method | Description |
|--------|-------------|
| `login(password)` | Authenticate and set session cookie |
| `logout()` | Clear session |
| `me()` | Check if authenticated |

### Agents

| Method | Description |
|--------|-------------|
| `listAgents()` | List all registered agents |
| `getAgent(id)` | Get agent details with containers |
| `registerAgent(name, hostname)` | Register a new agent |
| `deleteAgent(id)` | Remove an agent |
| `checkAgent(id, containerIds?)` | Trigger update check |
| `checkAllAgents()` | Check all online agents |
| `updateAgent(id, containerIds?)` | Trigger container update |
| `updateAgentConfig(id, config)` | Update schedule/auto-update settings |

### Containers

| Method | Description |
|--------|-------------|
| `rollbackContainer(agentId, containerId, options?)` | Rollback to a specific tag or digest |

### Config & History

| Method | Description |
|--------|-------------|
| `getConfig()` | Get global configuration |
| `setConfig(key, value)` | Update a config key |
| `getHistory(options?)` | Query update history |
| `getEffectivePolicy(agentId?)` | Get the effective update policy |

### Notifications

| Method | Description |
|--------|-------------|
| `listNotifications()` | List notification channels |
| `createNotification(channel)` | Create a channel |
| `testNotification(id)` | Send a test message |

## Using Types Only

If you only need type definitions (e.g., for a custom integration):

```typescript
import type { Agent, Container, NotificationEvent } from "@watchwarden/types";

function processAgent(agent: Agent) {
  // Full type safety
  console.log(agent.status); // "online" | "offline" | "updating"
}
```

## Error Handling

```typescript
import { WatchWardenClient, ApiError } from "@watchwarden/sdk";

try {
  await client.checkAgent("nonexistent");
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.status); // 404
    console.log(err.body);   // Error response body
  }
}
```

## Monorepo Usage

Inside the WatchWarden repository, packages are linked via npm workspaces:

```json
{
  "dependencies": {
    "@watchwarden/types": "*"
  }
}
```

External consumers install from npm normally.
