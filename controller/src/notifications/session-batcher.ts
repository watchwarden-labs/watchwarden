import { log } from '../lib/logger.js';
import { notifier } from './notifier.js';

interface UpdateResultItem {
  containerId: string;
  containerName: string;
  image?: string;
  success: boolean;
  error: string | null;
  durationMs: number;
}

// Cross-agent update result batch — accumulate results from all agents within
// a sliding window, then dispatch a single consolidated notification.
interface UpdateBatch {
  agents: Map<
    string,
    {
      successes: Array<{ name: string; image: string; durationMs: number }>;
      failures: Array<{ name: string; error: string }>;
    }
  >;
  timer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

let pendingUpdateBatch: UpdateBatch | null = null;
const UPDATE_BATCH_WINDOW_MS = 30_000; // wait 30s after last result
const UPDATE_BATCH_MAX_WAIT_MS = 5 * 60_000; // max 5 minutes

function flushUpdateBatch(): void {
  if (!pendingUpdateBatch) return;
  clearTimeout(pendingUpdateBatch.timer);
  clearTimeout(pendingUpdateBatch.maxTimer);

  const batch = pendingUpdateBatch;
  pendingUpdateBatch = null;

  const succAgents: Array<{
    agentName: string;
    containers: Array<{ name: string; image: string; durationMs: number }>;
  }> = [];
  const failAgents: Array<{
    agentName: string;
    containers: Array<{ name: string; error: string }>;
  }> = [];

  for (const [agentName, data] of batch.agents) {
    if (data.successes.length > 0) {
      succAgents.push({ agentName, containers: data.successes });
    }
    if (data.failures.length > 0) {
      failAgents.push({ agentName, containers: data.failures });
    }
  }

  if (succAgents.length > 0) {
    notifier
      .dispatch({ type: 'update_success', agents: succAgents })
      .catch((err) => log.error('notify', `dispatch failed: ${err}`));
  }
  if (failAgents.length > 0) {
    notifier
      .dispatch({ type: 'update_failed', agents: failAgents })
      .catch((err) => log.error('notify', `dispatch failed: ${err}`));
  }
}

export function addUpdateResult(agentId: string, result: UpdateResultItem): void {
  if (!pendingUpdateBatch) {
    const maxTimer = setTimeout(() => flushUpdateBatch(), UPDATE_BATCH_MAX_WAIT_MS);
    maxTimer.unref?.();
    pendingUpdateBatch = {
      agents: new Map(),
      timer: setTimeout(() => flushUpdateBatch(), UPDATE_BATCH_WINDOW_MS),
      maxTimer,
    };
    pendingUpdateBatch.timer.unref?.();
  } else {
    // Sliding window: reset the timer on each new result
    clearTimeout(pendingUpdateBatch.timer);
    pendingUpdateBatch.timer = setTimeout(() => flushUpdateBatch(), UPDATE_BATCH_WINDOW_MS);
    pendingUpdateBatch.timer.unref?.();
  }

  if (!pendingUpdateBatch.agents.has(agentId)) {
    pendingUpdateBatch.agents.set(agentId, { successes: [], failures: [] });
  }
  // biome-ignore lint/style/noNonNullAssertion: key was just set above
  const agentData = pendingUpdateBatch.agents.get(agentId)!;

  if (result.success) {
    agentData.successes.push({
      name: result.containerName,
      image: result.image ?? '',
      durationMs: result.durationMs,
    });
  } else {
    agentData.failures.push({
      name: result.containerName,
      error: result.error ?? 'unknown',
    });
  }

  log.info(
    'notify',
    `update result for ${agentId}: ${result.success ? 'success' : 'failed'} — ${result.containerName}`,
  );
}

// Deduplicate: track which container updates we already notified about
// Key: "agentId:containerName" → timestamp. Entries expire after 24 hours.
// Image/digest is intentionally excluded so rolling :latest tags don't bypass dedup.
const notifiedUpdates = new Map<string, number>();
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
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

/** Flush pending batches and clear timers (call during shutdown). */
export function clearPendingTimers(): void {
  if (pendingCheckBatch) {
    clearTimeout(pendingCheckBatch.timer);
    flushCheckBatch(); // flush before discarding
  }
  if (pendingUpdateBatch) {
    clearTimeout(pendingUpdateBatch.timer);
    clearTimeout(pendingUpdateBatch.maxTimer);
    flushUpdateBatch();
  }
}

// Batch check results across agents — accumulate before dispatching a single notification.
// When expectedAgents is set (multi-agent check), wait for all agents OR timeout.
// Otherwise use a 90s sliding window so agents with close-but-not-identical schedules
// still batch into a single notification.
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
// 90s sliding window: agents checking within 90s of each other batch into one notification.
// This covers agents on the same schedule with per-agent jitter or slightly offset cron
// expressions (e.g. "0 7 * * *" vs "1 7 * * *").
const CHECK_BATCH_WINDOW_MS = 90_000;
const CHECK_BATCH_MAX_WAIT_MS = 30_000; // max wait when expecting multiple agents via expectCheckResults

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
    const key = `${agentId ?? agentName}:${c.name}`;
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
  } else if (pendingCheckBatch.expectedAgentCount === 0) {
    // Sliding window for unknown-count batches: reset timer on each new agent
    clearTimeout(pendingCheckBatch.timer);
    pendingCheckBatch.timer = setTimeout(flushCheckBatch, CHECK_BATCH_WINDOW_MS);
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
