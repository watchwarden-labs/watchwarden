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

// Batch update results per agent — accumulate for a short window, then dispatch
// a single notification with all containers from the same update operation.
interface ResultBatch {
  agentId: string;
  successes: Array<{ name: string; image: string; durationMs: number }>;
  failures: Array<{ name: string; error: string }>;
  expectedCount: number; // 0 = unknown, flush on timer; >0 = flush when count reached
  timer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

const resultBatches = new Map<string, ResultBatch>();
// Fallback timers in case expectedCount is not set or results are lost
const RESULT_BATCH_WINDOW_MS = 15_000; // wait 15s after last result
const RESULT_BATCH_MAX_WAIT_MS = 5 * 60_000; // max 5 minutes

function flushResultBatch(agentId: string): void {
  const batch = resultBatches.get(agentId);
  if (!batch) return;
  clearTimeout(batch.timer);
  clearTimeout(batch.maxTimer);
  resultBatches.delete(agentId);

  if (batch.successes.length > 0) {
    notifier
      .dispatch({
        type: 'update_success',
        agentName: batch.agentId,
        containers: batch.successes,
      })
      .catch((err) => log.error('notify', `dispatch failed: ${err}`));
  }

  if (batch.failures.length > 0) {
    notifier
      .dispatch({
        type: 'update_failed',
        agentName: batch.agentId,
        containers: batch.failures,
      })
      .catch((err) => log.error('notify', `dispatch failed: ${err}`));
  }
}

/**
 * Tell the batcher how many update results to expect for an agent.
 * When all results arrive, the batch flushes immediately — no timer wait.
 * Call this BEFORE the UPDATE command is sent to the agent.
 */
export function expectUpdateResults(agentId: string, count: number): void {
  let batch = resultBatches.get(agentId);
  if (!batch) {
    const maxTimer = setTimeout(() => flushResultBatch(agentId), RESULT_BATCH_MAX_WAIT_MS);
    maxTimer.unref?.();
    batch = {
      agentId,
      successes: [],
      failures: [],
      expectedCount: count,
      timer: setTimeout(() => flushResultBatch(agentId), RESULT_BATCH_WINDOW_MS),
      maxTimer,
      createdAt: Date.now(),
    };
    batch.timer.unref?.();
    resultBatches.set(agentId, batch);
  } else {
    batch.expectedCount = count;
  }
  log.info('notify', `expecting ${count} update result(s) for agent ${agentId}`);
}

export function addUpdateResult(agentId: string, result: UpdateResultItem): void {
  let batch = resultBatches.get(agentId);
  if (!batch) {
    const maxTimer = setTimeout(() => flushResultBatch(agentId), RESULT_BATCH_MAX_WAIT_MS);
    maxTimer.unref?.();
    batch = {
      agentId,
      successes: [],
      failures: [],
      expectedCount: 0,
      timer: setTimeout(() => flushResultBatch(agentId), RESULT_BATCH_WINDOW_MS),
      maxTimer,
      createdAt: Date.now(),
    };
    batch.timer.unref?.();
    resultBatches.set(agentId, batch);
  } else {
    // Sliding window: reset the timer on each new result
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flushResultBatch(agentId), RESULT_BATCH_WINDOW_MS);
    batch.timer.unref?.();
  }

  if (result.success) {
    batch.successes.push({
      name: result.containerName,
      image: result.image ?? '',
      durationMs: result.durationMs,
    });
  } else {
    batch.failures.push({
      name: result.containerName,
      error: result.error ?? 'unknown',
    });
  }

  // If we know how many results to expect and all have arrived, flush immediately
  const totalReceived = batch.successes.length + batch.failures.length;
  if (batch.expectedCount > 0 && totalReceived >= batch.expectedCount) {
    log.info(
      'notify',
      `all ${totalReceived}/${batch.expectedCount} update results received for ${agentId} — flushing`,
    );
    flushResultBatch(agentId);
  }
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
  // Flush any pending update result batches
  for (const [agentId] of resultBatches) {
    flushResultBatch(agentId);
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
