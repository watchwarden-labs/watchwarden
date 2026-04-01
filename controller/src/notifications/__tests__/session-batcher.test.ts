import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the notifier module before importing session-batcher
vi.mock('../notifier.js', () => ({
  notifier: {
    dispatch: vi.fn().mockResolvedValue(undefined),
  },
}));

import { notifier } from '../notifier.js';
import {
  clearPendingTimers,
  dispatchCheckResults,
  expectCheckResults,
} from '../session-batcher.js';

// Each test uses a unique suffix to avoid cross-test dedup collisions
// (the notifiedUpdates Map is module-level and persists across tests).
let testId = 0;
function uid(): string {
  return `t${testId++}`;
}

describe('session-batcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(notifier.dispatch).mockClear();
    // Flush any leftover batch from previous test
    clearPendingTimers();
    vi.mocked(notifier.dispatch).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatchCheckResults batches results within default 5s window', () => {
    const u = uid();

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );

    vi.advanceTimersByTime(3_000);
    expect(notifier.dispatch).not.toHaveBeenCalled();

    dispatchCheckResults(
      `agent-2-${u}`,
      [{ name: `redis-${u}`, image: `redis:${u}` }],
      `agent-2-${u}`,
    );

    // Advance past the 5s window from the first dispatch
    vi.advanceTimersByTime(5_000);

    expect(notifier.dispatch).toHaveBeenCalledTimes(1);
    const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'update_available',
      agents: expect.arrayContaining([
        expect.objectContaining({ agentName: `agent-1-${u}` }),
        expect.objectContaining({ agentName: `agent-2-${u}` }),
      ]),
    });
  });

  it('expectCheckResults waits for all agents before flushing', () => {
    const u = uid();
    expectCheckResults(3);

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );
    vi.advanceTimersByTime(3_000);
    expect(notifier.dispatch).not.toHaveBeenCalled();

    dispatchCheckResults(
      `agent-2-${u}`,
      [{ name: `redis-${u}`, image: `redis:${u}` }],
      `agent-2-${u}`,
    );
    vi.advanceTimersByTime(5_000);
    // Still not flushed — waiting for 3rd agent
    expect(notifier.dispatch).not.toHaveBeenCalled();

    dispatchCheckResults(
      `agent-3-${u}`,
      [{ name: `postgres-${u}`, image: `postgres:${u}` }],
      `agent-3-${u}`,
    );

    // Should flush immediately after 3rd agent
    expect(notifier.dispatch).toHaveBeenCalledTimes(1);
    const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'update_available',
      agents: expect.arrayContaining([
        expect.objectContaining({ agentName: `agent-1-${u}` }),
        expect.objectContaining({ agentName: `agent-2-${u}` }),
        expect.objectContaining({ agentName: `agent-3-${u}` }),
      ]),
    });
  });

  it('expectCheckResults flushes on 30s timeout if not all agents respond', () => {
    const u = uid();
    expectCheckResults(3);

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );
    dispatchCheckResults(
      `agent-2-${u}`,
      [{ name: `redis-${u}`, image: `redis:${u}` }],
      `agent-2-${u}`,
    );

    // Advance past default 5s — should NOT flush because expecting 3 agents
    vi.advanceTimersByTime(6_000);
    expect(notifier.dispatch).not.toHaveBeenCalled();

    // Advance to 30s total — timeout should trigger flush
    vi.advanceTimersByTime(24_000);

    expect(notifier.dispatch).toHaveBeenCalledTimes(1);
    const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'update_available',
      agents: [
        expect.objectContaining({ agentName: `agent-1-${u}` }),
        expect.objectContaining({ agentName: `agent-2-${u}` }),
      ],
    });
  });

  it('dispatchCheckResults deduplicates same container within 1 hour', () => {
    const u = uid();

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );

    // Flush the first batch
    vi.advanceTimersByTime(5_000);
    expect(notifier.dispatch).toHaveBeenCalledTimes(1);

    vi.mocked(notifier.dispatch).mockClear();

    // Dispatch same agent+container again — should be deduped
    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );

    vi.advanceTimersByTime(5_000);
    // The container was deduplicated, so the batch had 0 new containers.
    // flushCheckBatch filters out agents with no containers — no dispatch.
    expect(notifier.dispatch).not.toHaveBeenCalled();
  });

  it('expectCheckResults counts agents with zero updates toward completion', () => {
    const u = uid();
    expectCheckResults(2);

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );

    expect(notifier.dispatch).not.toHaveBeenCalled();

    // agent-2 has no updates (empty containers array)
    dispatchCheckResults(`agent-2-${u}`, [], `agent-2-${u}`);

    // Should flush immediately because both agents have reported
    expect(notifier.dispatch).toHaveBeenCalledTimes(1);
    const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'update_available',
      agents: [expect.objectContaining({ agentName: `agent-1-${u}` })],
    });
  });

  it('clearPendingTimers flushes and clears batch', () => {
    const u = uid();

    dispatchCheckResults(
      `agent-1-${u}`,
      [{ name: `nginx-${u}`, image: `nginx:${u}` }],
      `agent-1-${u}`,
    );

    // Don't wait for timer — clear immediately
    clearPendingTimers();

    expect(notifier.dispatch).toHaveBeenCalledTimes(1);
    const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'update_available',
      agents: [expect.objectContaining({ agentName: `agent-1-${u}` })],
    });

    // Advancing timers should NOT trigger another flush
    vi.mocked(notifier.dispatch).mockClear();
    vi.advanceTimersByTime(10_000);
    expect(notifier.dispatch).not.toHaveBeenCalled();
  });
});
