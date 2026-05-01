import { getContainersByAgent } from '../db/queries.js';
import type { Container } from '../types.js';
import type { AgentHub } from '../ws/hub.js';

interface UpdateBatch {
  containerIds: string[];
  containerNames: string[];
  priority: number;
  waitForHealthy: boolean;
}

/**
 * Resolves update order based on container labels (group, priority, depends_on).
 * Returns batches sorted by priority — each batch can update in parallel,
 * batches execute sequentially.
 */
export async function resolveUpdateBatches(
  agentId: string,
  containerIds: string[],
): Promise<UpdateBatch[]> {
  const allContainers = await getContainersByAgent(agentId);
  const toUpdate = allContainers.filter(
    (c) => containerIds.includes(c.docker_id) || containerIds.includes(c.id),
  );

  if (toUpdate.length === 0) return [];

  // Check if any containers have priority/depends_on labels
  const hasLabels = toUpdate.some((c) => c.update_priority !== 100 || c.depends_on);

  // No labels → single batch (all parallel, backward compatible)
  if (!hasLabels) {
    return [
      {
        containerIds: toUpdate.map((c) => c.docker_id),
        containerNames: toUpdate.map((c) => c.name),
        priority: 100,
        waitForHealthy: false,
      },
    ];
  }

  // Build dependency-aware order using topological sort
  const sorted = topologicalSort(toUpdate, allContainers);

  // Group into batches by priority
  const batchMap = new Map<number, Container[]>();
  for (const c of sorted) {
    const priority = c.update_priority;
    if (!batchMap.has(priority)) {
      batchMap.set(priority, []);
    }
    batchMap.get(priority)?.push(c);
  }

  // Sort batches by priority (ascending — lower first)
  const batches: UpdateBatch[] = Array.from(batchMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([priority, containers]) => ({
      containerIds: containers.map((c) => c.docker_id),
      containerNames: containers.map((c) => c.name),
      priority,
      waitForHealthy: true, // wait for health before next batch
    }));

  // Last batch doesn't need to wait (nothing after it)
  if (batches.length > 0) {
    batches[batches.length - 1]!.waitForHealthy = false;
  }

  return batches;
}

/**
 * Topological sort respecting depends_on relationships.
 * Containers with dependencies come after their dependencies.
 */
function topologicalSort(toUpdate: Container[], allContainers: Container[]): Container[] {
  const nameMap = new Map<string, Container>();
  for (const c of allContainers) {
    nameMap.set(c.name, c);
  }

  const toUpdateSet = new Set(toUpdate.map((c) => c.id));
  const visited = new Set<string>();
  const result: Container[] = [];

  function visit(container: Container) {
    if (visited.has(container.id)) return;
    visited.add(container.id);

    // Visit dependencies first
    if (container.depends_on) {
      try {
        const deps = JSON.parse(container.depends_on) as string[];
        for (const depName of deps) {
          const dep = nameMap.get(depName);
          if (dep && toUpdateSet.has(dep.id)) {
            visit(dep);
          }
        }
      } catch {
        // Invalid JSON — ignore
      }
    }

    result.push(container);
  }

  // Sort by priority first, then visit
  const sorted = [...toUpdate].sort((a, b) => a.update_priority - b.update_priority);
  for (const c of sorted) {
    visit(c);
  }

  return result;
}

/**
 * Execute an orchestrated update: resolve batches, send UPDATE_SEQUENTIAL to agent.
 * Falls back to regular UPDATE if no labels present.
 */
export async function executeOrchestratedUpdate(
  hub: AgentHub,
  agentId: string,
  containerIds: string[],
  options?: { strategy?: string },
): Promise<void> {
  const batches = await resolveUpdateBatches(agentId, containerIds);
  const strategy = options?.strategy ?? 'stop-first';

  if (batches.length <= 1) {
    // Single batch or no labels — use regular UPDATE
    hub.sendToAgent(agentId, {
      type: 'UPDATE',
      payload: {
        containerIds: batches[0]?.containerIds ?? containerIds,
        strategy,
      },
    });
    return;
  }

  // Multiple batches — send UPDATE_SEQUENTIAL
  hub.sendToAgent(agentId, {
    type: 'UPDATE_SEQUENTIAL',
    payload: {
      batches: batches.map((b) => ({
        containerIds: b.containerIds,
        waitForHealthy: b.waitForHealthy,
        healthTimeout: 120, // default stability window
      })),
      strategy,
    },
  });
}
