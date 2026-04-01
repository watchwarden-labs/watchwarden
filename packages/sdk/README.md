# @watchwarden/sdk

TypeScript SDK for the WatchWarden API.

## Installation

```bash
npm install @watchwarden/sdk
```

## Usage

```typescript
import { WatchWardenClient } from "@watchwarden/sdk";

const client = new WatchWardenClient({
  baseUrl: "http://localhost:3000",
});

// Login
await client.login("admin-password");

// List agents
const agents = await client.listAgents();

// Check all agents for updates
await client.checkAllAgents();

// Get agent details with containers
const agent = await client.getAgent("agent-id");
console.log(agent.containers);

// Update a specific container
await client.updateAgent("agent-id", ["container-id"]);
```

## Types

All types are exported from `@watchwarden/types`:

```typescript
import type { Agent, Container, UpdateLog } from "@watchwarden/sdk";
```
