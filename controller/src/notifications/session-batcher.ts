import { log } from '../lib/logger.js';
import { notifier } from './notifier.js';
import type { NotificationEvent } from './types.js';

interface UpdateResultItem {
  containerId: string;
  containerName: string;
  image?: string;
  success: boolean;
  error: string | null;
  durationMs: number;
}

export function addUpdateResult(agentId: string, result: UpdateResultItem): void {
  const event: NotificationEvent = result.success
    ? {
        type: 'update_success',
        agentName: agentId,
        containers: [
          {
            name: result.containerName,
            image: result.image ?? '',
            durationMs: result.durationMs,
          },
        ],
      }
    : {
        type: 'update_failed',
        agentName: agentId,
        containers: [{ name: result.containerName, error: result.error ?? 'unknown' }],
      };
  notifier.dispatch(event).catch((err) => log.error('notify', `dispatch failed: ${err}`));
}

// Deduplicate: track which container updates we already notified about
// Key: "agentId:containerName:image" → timestamp. Entries expire after 1 hour.
const notifiedUpdates = new Map<string, number>();
const DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_DEDUP_ENTRIES = 10000;

function pruneNotified(): void {
  const now = Date.now();
  for (const [key, ts] of notifiedUpdates) {
    if (now - ts > DEDUP_TTL_MS) notifiedUpdates.delete(key);
  }
  // Hard cap: if still too large, drop oldest entries
  if (notifiedUpdates.size > MAX_DEDUP_ENTRIES) {
    const excess = notifiedUpdates.size - MAX_DEDUP_ENTRIES;
    let removed = 0;
    for (const key of notifiedUpdates.keys()) {
      if (removed >= excess) break;
      notifiedUpdates.delete(key);
      removed++;
    }
  }
}

// Periodic pruning of stale dedup entries (runs every 10 minutes)
setInterval(pruneNotified, 10 * 60 * 1000).unref();

/** Flush pending batch and clear timer (call during shutdown). */
export function clearPendingTimers(): void {
  if (pendingCheckBatch) {
    clearTimeout(pendingCheckBatch.timer);
    flushCheckBatch(); // flush before discarding
  }
}

// Batch check results across agents — accumulate before dispatching a single notification.
// When expectedAgents is set (multi-agent check), wait for all agents OR timeout.
// Otherwise use a default window so isolated single-agent checks still batch reasonably.
interface CheckBatch {
  agents: Array<{
    agentName: string;
    containers: Array<{ name: string; image: string }>;
  }>;
  receivedAgentIds: Set<string>;
  expectedAgentCount: number;
  timer: ReturnType<typeof setTimeout>;
}

let pendingCheckBatch: CheckBatch | null = null;
const CHECK_BATCH_WINDOW_MS = 5_000; // default window for single-agent checks
const CHECK_BATCH_MAX_WAIT_MS = 30_000; // max wait when expecting multiple agents

function flushCheckBatch(): void {
  if (!pendingCheckBatch || pendingCheckBatch.agents.length === 0) {
    log.info(
      'notify',
      `flush: no pending results (received ${pendingCheckBatch?.receivedAgentIds.size ?? 0}/${pendingCheckBatch?.expectedAgentCount ?? 0} agents)`,
    );
    pendingCheckBatch = null;
    return;
  }
  // Filter out agents with no containers after dedup
  const agents = pendingCheckBatch.agents.filter((a) => a.containers.length > 0);
  const received = pendingCheckBatch.receivedAgentIds.size;
  const expected = pendingCheckBatch.expectedAgentCount;
  if (agents.length === 0) {
    log.info('notify', `flush: all updates deduped (received ${received}/${expected} agents)`);
    pendingCheckBatch = null;
    return;
  }
  log.info(
    'notify',
    `flush: dispatching update_available for ${agents.length} agent(s) (received ${received}/${expected} expected)`,
  );
  notifier
    .dispatch({
      type: 'update_available',
      agents,
    })
    .catch((err) => log.error('notify', `dispatch failed: ${err}`));
  pendingCheckBatch = null;
}

/**
 * Signal that a multi-agent check was initiated for `count` agents.
 * The batcher will wait for all agents to report (or timeout) before flushing.
 * Call this BEFORE sending CHECK commands to agents.
 */
export function expectCheckResults(count: number): void {
  if (pendingCheckBatch) {
    clearTimeout(pendingCheckBatch.timer);
  }
  log.info(
    'notify',
    `expecting check results from ${count} agent(s), batch window ${CHECK_BATCH_MAX_WAIT_MS / 1000}s`,
  );
  pendingCheckBatch = {
    agents: [],
    receivedAgentIds: new Set(),
    expectedAgentCount: count,
    timer: setTimeout(flushCheckBatch, CHECK_BATCH_MAX_WAIT_MS),
  };
}

export function dispatchCheckResults(
  agentName: string,
  containers: Array<{ name: string; image: string }>,
  agentId?: string,
): void {
  if (containers.length === 0) {
    // Even with no updates, count this agent as responded for batch completion
    if (pendingCheckBatch && agentId) {
      pendingCheckBatch.receivedAgentIds.add(agentId);
      if (
        pendingCheckBatch.expectedAgentCount > 0 &&
        pendingCheckBatch.receivedAgentIds.size >= pendingCheckBatch.expectedAgentCount
      ) {
        clearTimeout(pendingCheckBatch.timer);
        flushCheckBatch();
      }
    }
    return;
  }

  // Deduplicate: only include containers we haven't notified about yet
  pruneNotified();
  const newContainers = containers.filter((c) => {
    const key = `${agentId ?? agentName}:${c.name}:${c.image}`;
    if (notifiedUpdates.has(key)) return false;
    notifiedUpdates.set(key, Date.now());
    return true;
  });

  if (!pendingCheckBatch) {
    pendingCheckBatch = {
      agents: [],
      receivedAgentIds: new Set(),
      expectedAgentCount: 0,
      timer: setTimeout(flushCheckBatch, CHECK_BATCH_WINDOW_MS),
    };
  }

  if (agentId) {
    pendingCheckBatch.receivedAgentIds.add(agentId);
  }

  if (newContainers.length > 0) {
    pendingCheckBatch.agents.push({ agentName, containers: newContainers });
  }

  log.info(
    'notify',
    `agent ${agentName} reported ${newContainers.length} new update(s) (${pendingCheckBatch.receivedAgentIds.size}/${pendingCheckBatch.expectedAgentCount} agents received)`,
  );

  // If we've heard from all expected agents, flush immediately
  if (
    pendingCheckBatch.expectedAgentCount > 0 &&
    pendingCheckBatch.receivedAgentIds.size >= pendingCheckBatch.expectedAgentCount
  ) {
    clearTimeout(pendingCheckBatch.timer);
    flushCheckBatch();
  }
}
