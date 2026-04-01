import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../useStore';

describe('useStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      wsConnected: false,
      agentStatuses: {},
      updateProgress: {},
      sidebarCollapsed: false,
      authToken: null,
      toasts: [],
    });
  });

  afterEach(() => {
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it('initial state is correct', () => {
    const state = useStore.getState();
    expect(state.wsConnected).toBe(false);
    expect(state.agentStatuses).toEqual({});
    expect(state.updateProgress).toEqual({});
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.toasts).toEqual([]);
  });

  it('setWsConnected updates state', () => {
    useStore.getState().setWsConnected(true);
    expect(useStore.getState().wsConnected).toBe(true);
  });

  it('updateAgentStatus updates specific agent', () => {
    useStore.getState().updateAgentStatus('agent-1', { status: 'online' });
    expect(useStore.getState().agentStatuses['agent-1']).toEqual({
      status: 'online',
    });
  });

  it('setUpdateProgress sets progress for key', () => {
    useStore.getState().setUpdateProgress('agent-1:c-1', {
      step: 'pulling',
      containerName: 'nginx',
      timestamp: 123,
    });
    expect(useStore.getState().updateProgress['agent-1:c-1']?.step).toBe('pulling');
  });

  it('clearUpdateProgress removes entry', () => {
    useStore.getState().setUpdateProgress('agent-1:c-1', {
      step: 'pulling',
      containerName: 'nginx',
      timestamp: 123,
    });
    useStore.getState().clearUpdateProgress('agent-1:c-1');
    expect(useStore.getState().updateProgress['agent-1:c-1']).toBeUndefined();
  });

  it('toggleSidebar flips state', () => {
    expect(useStore.getState().sidebarCollapsed).toBe(false);
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarCollapsed).toBe(true);
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarCollapsed).toBe(false);
  });

  it('addToast adds and auto-limits to 5', () => {
    const { addToast } = useStore.getState();
    addToast({ type: 'success', message: 'test1' });
    addToast({ type: 'info', message: 'test2' });
    expect(useStore.getState().toasts).toHaveLength(2);
    expect(useStore.getState().toasts[0]?.message).toBe('test1');
  });

  it('removeToast removes by id', () => {
    useStore.getState().addToast({ type: 'success', message: 'test' });
    const id = useStore.getState().toasts[0]?.id as string;
    expect(id).toBeDefined();
    useStore.getState().removeToast(id);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('handleWSEvent AGENT_STATUS updates agent status', () => {
    useStore.getState().handleWSEvent({
      type: 'AGENT_STATUS',
      agentId: 'a-1',
      status: 'online',
      lastSeen: 999,
    });
    expect(useStore.getState().agentStatuses['a-1']).toEqual({
      status: 'online',
      lastSeen: 999,
    });
  });

  it('handleWSEvent UPDATE_PROGRESS sets progress', () => {
    useStore.getState().handleWSEvent({
      type: 'UPDATE_PROGRESS',
      agentId: 'a-1',
      containerId: 'c-1',
      containerName: 'nginx',
      step: 'pulling',
    });
    // FIX-5.1: progress updates are now debounced (100ms), flush the timer
    vi.advanceTimersByTime(100);
    expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('pulling');
  });

  it('handleWSEvent UPDATE_COMPLETE clears progress and adds toast', () => {
    useStore.getState().setUpdateProgress('a-1:c-1', {
      step: 'starting',
      containerName: 'nginx',
      timestamp: 123,
    });
    useStore.getState().handleWSEvent({
      type: 'UPDATE_COMPLETE',
      agentId: 'a-1',
      results: [{ containerId: 'c-1', success: true }],
    });
    expect(useStore.getState().updateProgress['a-1:c-1']).toBeUndefined();
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0]?.type).toBe('success');
  });

  describe('Finding 5.1: UPDATE_PROGRESS debounce buffer', () => {
    it('does not apply progress to state before 100ms flush', () => {
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'pulling',
      });
      // Before flush timer fires, state should not have the progress
      expect(useStore.getState().updateProgress['a-1:c-1']).toBeUndefined();
      // After 100ms flush, it should be set
      vi.advanceTimersByTime(100);
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('pulling');
    });

    it('batches multiple rapid events into single setState', () => {
      for (let i = 0; i < 10; i++) {
        useStore.getState().handleWSEvent({
          type: 'UPDATE_PROGRESS',
          agentId: 'a-1',
          containerId: `c-${i}`,
          containerName: `container-${i}`,
          step: 'pulling',
        });
      }
      vi.advanceTimersByTime(100);
      for (let i = 0; i < 10; i++) {
        expect(useStore.getState().updateProgress[`a-1:c-${i}`]?.step).toBe('pulling');
      }
    });

    it('clears buffer after flush, subsequent events start new batch', () => {
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'pulling',
      });
      vi.advanceTimersByTime(100);
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('pulling');

      // Fire another event — should not appear until next flush
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'starting',
      });
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('pulling');
      vi.advanceTimersByTime(100);
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('starting');
    });

    it('last-write-wins for same key within flush window', () => {
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'pulling',
      });
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'starting',
      });
      vi.advanceTimersByTime(100);
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('starting');
    });
  });

  describe('Finding 5.2: Toast timer cleanup', () => {
    it('auto-removes toast after 4000ms', () => {
      useStore.getState().addToast({ type: 'success', message: 'hello' });
      expect(useStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(4000);
      expect(useStore.getState().toasts).toHaveLength(0);
    });

    it('clears timer when toast removed manually before expiry', () => {
      useStore.getState().addToast({ type: 'success', message: 'hello' });
      const id = useStore.getState().toasts[0]?.id as string;
      expect(id).toBeDefined();
      useStore.getState().removeToast(id);
      expect(useStore.getState().toasts).toHaveLength(0);
      // Advancing past auto-remove time should not cause errors
      vi.advanceTimersByTime(4000);
      expect(useStore.getState().toasts).toHaveLength(0);
    });

    it('caps toast queue at 5', () => {
      for (let i = 0; i < 7; i++) {
        useStore.getState().addToast({ type: 'info', message: `toast-${i}` });
      }
      expect(useStore.getState().toasts.length).toBeLessThanOrEqual(5);
    });

    it('does not accumulate timers on rapid add/remove', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      for (let i = 0; i < 20; i++) {
        useStore.getState().addToast({ type: 'info', message: `toast-${i}` });
      }
      const toasts = useStore.getState().toasts;
      for (const t of toasts) {
        useStore.getState().removeToast(t.id);
      }
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('multiple toasts auto-remove independently', () => {
      useStore.getState().addToast({ type: 'success', message: 'A' });
      vi.advanceTimersByTime(2000);
      useStore.getState().addToast({ type: 'info', message: 'B' });
      // At this point A has 2s left, B has 4s left
      expect(useStore.getState().toasts).toHaveLength(2);
      vi.advanceTimersByTime(2000);
      // A should be removed (4s total), B still has 2s
      expect(useStore.getState().toasts).toHaveLength(1);
      expect(useStore.getState().toasts[0]?.message).toBe('B');
      vi.advanceTimersByTime(2000);
      // B should be removed now
      expect(useStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('Finding 5.3: UPDATE_COMPLETE selective clearing', () => {
    it('only clears containers listed in results array', () => {
      useStore.getState().setUpdateProgress('a-1:c-1', {
        step: 'pulling',
        containerName: 'nginx',
        timestamp: 1,
      });
      useStore.getState().setUpdateProgress('a-1:c-2', {
        step: 'pulling',
        containerName: 'redis',
        timestamp: 1,
      });
      useStore.getState().handleWSEvent({
        type: 'UPDATE_COMPLETE',
        agentId: 'a-1',
        results: [{ containerId: 'c-1', success: true }],
      });
      expect(useStore.getState().updateProgress['a-1:c-1']).toBeUndefined();
      expect(useStore.getState().updateProgress['a-1:c-2']?.step).toBe('pulling');
    });

    it('preserves progress from different agent', () => {
      useStore.getState().setUpdateProgress('a-1:c-1', {
        step: 'pulling',
        containerName: 'nginx',
        timestamp: 1,
      });
      useStore.getState().setUpdateProgress('a-2:c-1', {
        step: 'pulling',
        containerName: 'nginx',
        timestamp: 1,
      });
      useStore.getState().handleWSEvent({
        type: 'UPDATE_COMPLETE',
        agentId: 'a-1',
        results: [{ containerId: 'c-1', success: true }],
      });
      expect(useStore.getState().updateProgress['a-1:c-1']).toBeUndefined();
      expect(useStore.getState().updateProgress['a-2:c-1']?.step).toBe('pulling');
    });

    it('clears buffered unflushed progress for completed containers', () => {
      // Fire UPDATE_PROGRESS (stays in buffer, not flushed yet)
      useStore.getState().handleWSEvent({
        type: 'UPDATE_PROGRESS',
        agentId: 'a-1',
        containerId: 'c-1',
        containerName: 'nginx',
        step: 'pulling',
      });
      // Fire UPDATE_COMPLETE before the 100ms flush
      useStore.getState().handleWSEvent({
        type: 'UPDATE_COMPLETE',
        agentId: 'a-1',
        results: [{ containerId: 'c-1', success: true }],
      });
      // Now flush the timer — the buffered entry should have been cleared
      vi.advanceTimersByTime(100);
      expect(useStore.getState().updateProgress['a-1:c-1']).toBeUndefined();
    });

    it('handles empty results array without crashing', () => {
      useStore.getState().setUpdateProgress('a-1:c-1', {
        step: 'pulling',
        containerName: 'nginx',
        timestamp: 1,
      });
      expect(() => {
        useStore.getState().handleWSEvent({
          type: 'UPDATE_COMPLETE',
          agentId: 'a-1',
          results: [],
        });
      }).not.toThrow();
      // Progress should be preserved since no containers were listed
      expect(useStore.getState().updateProgress['a-1:c-1']?.step).toBe('pulling');
    });

    it('handles missing results field gracefully', () => {
      useStore.getState().setUpdateProgress('a-1:c-1', {
        step: 'pulling',
        containerName: 'nginx',
        timestamp: 1,
      });
      expect(() => {
        useStore.getState().handleWSEvent({
          type: 'UPDATE_COMPLETE',
          agentId: 'a-1',
        });
      }).not.toThrow();
    });
  });
});
