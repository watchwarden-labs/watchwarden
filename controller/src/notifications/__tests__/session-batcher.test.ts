import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the notifier module before importing session-batcher
vi.mock('../notifier.js', () => ({
  notifier: {
    dispatch: vi.fn().mockResolvedValue(undefined),
  },
}));

import { notifier } from '../notifier.js';
import {
  addUpdateResult,
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

  describe('check result batching', () => {
    it('batches check results within 90s sliding window', () => {
      const u = uid();

      dispatchCheckResults(
        `agent-1-${u}`,
        [{ name: `nginx-${u}`, image: `nginx:${u}` }],
        `agent-1-${u}`,
      );

      vi.advanceTimersByTime(30_000);
      expect(notifier.dispatch).not.toHaveBeenCalled();

      dispatchCheckResults(
        `agent-2-${u}`,
        [{ name: `redis-${u}`, image: `redis:${u}` }],
        `agent-2-${u}`,
      );

      // Advance past the 90s window from the second dispatch
      vi.advanceTimersByTime(90_000);

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

      // Advance past default window — should NOT flush because expecting 3 agents
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

    it('deduplicates same container within 24 hours', () => {
      const u = uid();

      dispatchCheckResults(
        `agent-1-${u}`,
        [{ name: `nginx-${u}`, image: `nginx:${u}` }],
        `agent-1-${u}`,
      );

      // Flush the first batch
      vi.advanceTimersByTime(90_000);
      expect(notifier.dispatch).toHaveBeenCalledTimes(1);

      vi.mocked(notifier.dispatch).mockClear();

      // Dispatch same agent+container again — should be deduped
      dispatchCheckResults(
        `agent-1-${u}`,
        [{ name: `nginx-${u}`, image: `nginx:${u}` }],
        `agent-1-${u}`,
      );

      vi.advanceTimersByTime(90_000);
      // The container was deduplicated, so the batch had 0 new containers — no dispatch.
      expect(notifier.dispatch).not.toHaveBeenCalled();
    });

    it('deduplicates same container even when image changes (rolling :latest)', () => {
      const u = uid();

      dispatchCheckResults(
        `agent-1-${u}`,
        [{ name: `nginx-${u}`, image: 'nginx:latest' }],
        `agent-1-${u}`,
      );

      vi.advanceTimersByTime(90_000);
      expect(notifier.dispatch).toHaveBeenCalledTimes(1);

      vi.mocked(notifier.dispatch).mockClear();

      // Same container, different image digest / tag — should still be deduped by name
      dispatchCheckResults(
        `agent-1-${u}`,
        [{ name: `nginx-${u}`, image: 'nginx:latest' }],
        `agent-1-${u}`,
      );

      vi.advanceTimersByTime(90_000);
      expect(notifier.dispatch).not.toHaveBeenCalled();
    });

    it('counts agents with zero updates toward completion', () => {
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

    it('clearPendingTimers flushes check batch and clears timer', () => {
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
      vi.advanceTimersByTime(90_000);
      expect(notifier.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('update result batching', () => {
    it('consolidates update results from multiple agents into one notification', () => {
      const u = uid();

      addUpdateResult(`plex-${u}`, {
        containerId: `c1-${u}`,
        containerName: `plex-${u}`,
        image: `plex:latest`,
        success: true,
        error: null,
        durationMs: 5000,
      });

      addUpdateResult(`servarr-${u}`, {
        containerId: `c2-${u}`,
        containerName: `radarr-${u}`,
        image: `radarr:latest`,
        success: true,
        error: null,
        durationMs: 3000,
      });

      // Neither should have fired yet
      expect(notifier.dispatch).not.toHaveBeenCalled();

      // Advance past 30s sliding window
      vi.advanceTimersByTime(30_000);

      expect(notifier.dispatch).toHaveBeenCalledTimes(1);
      const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
      expect(event).toMatchObject({
        type: 'update_success',
        agents: expect.arrayContaining([
          expect.objectContaining({ agentName: `plex-${u}` }),
          expect.objectContaining({ agentName: `servarr-${u}` }),
        ]),
      });
    });

    it('separates successes and failures into distinct dispatches', () => {
      const u = uid();

      addUpdateResult(`agent-a-${u}`, {
        containerId: `c1-${u}`,
        containerName: `nginx-${u}`,
        image: 'nginx:latest',
        success: true,
        error: null,
        durationMs: 2000,
      });

      addUpdateResult(`agent-b-${u}`, {
        containerId: `c2-${u}`,
        containerName: `redis-${u}`,
        image: 'redis:latest',
        success: false,
        error: 'image pull failed',
        durationMs: 0,
      });

      vi.advanceTimersByTime(30_000);

      expect(notifier.dispatch).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(notifier.dispatch).mock.calls.map((c) => c[0]);
      expect(calls.find((e) => e.type === 'update_success')).toMatchObject({
        type: 'update_success',
        agents: [expect.objectContaining({ agentName: `agent-a-${u}` })],
      });
      expect(calls.find((e) => e.type === 'update_failed')).toMatchObject({
        type: 'update_failed',
        agents: [expect.objectContaining({ agentName: `agent-b-${u}` })],
      });
    });

    it('sliding window resets on each new result', () => {
      const u = uid();

      addUpdateResult(`agent-${u}`, {
        containerId: `c1-${u}`,
        containerName: `nginx-${u}`,
        image: 'nginx:latest',
        success: true,
        error: null,
        durationMs: 1000,
      });

      vi.advanceTimersByTime(20_000); // within window
      expect(notifier.dispatch).not.toHaveBeenCalled();

      addUpdateResult(`agent-${u}`, {
        containerId: `c2-${u}`,
        containerName: `redis-${u}`,
        image: 'redis:latest',
        success: true,
        error: null,
        durationMs: 1000,
      });

      vi.advanceTimersByTime(20_000); // within new window
      expect(notifier.dispatch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000); // now past 30s from last result

      expect(notifier.dispatch).toHaveBeenCalledTimes(1);
      const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
      expect(event).toMatchObject({
        type: 'update_success',
        agents: [
          expect.objectContaining({
            agentName: `agent-${u}`,
            containers: expect.arrayContaining([
              expect.objectContaining({ name: `nginx-${u}` }),
              expect.objectContaining({ name: `redis-${u}` }),
            ]),
          }),
        ],
      });
    });

    it('clearPendingTimers flushes update batch', () => {
      const u = uid();

      addUpdateResult(`agent-${u}`, {
        containerId: `c1-${u}`,
        containerName: `nginx-${u}`,
        image: 'nginx:latest',
        success: true,
        error: null,
        durationMs: 1000,
      });

      clearPendingTimers();

      expect(notifier.dispatch).toHaveBeenCalledTimes(1);
      const event = vi.mocked(notifier.dispatch).mock.calls[0]?.[0];
      expect(event).toMatchObject({ type: 'update_success' });
    });
  });
});
