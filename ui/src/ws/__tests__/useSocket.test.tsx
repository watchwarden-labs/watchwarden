import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import { useSocket } from '../useSocket';

// --- MockWebSocket ---
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  close() {
    this.readyState = 3;
  }

  send(_data: string) {
    // no-op stub for tests
  }
}

// --- Helpers ---
const OriginalWebSocket = globalThis.WebSocket;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('Finding 6.4: WS message validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    useStore.setState({
      wsConnected: false,
      agentStatuses: {},
      updateProgress: {},
      toasts: [],
    });
  });

  afterEach(() => {
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
  });

  function renderAndConnect() {
    const { unmount } = renderHook(() => useSocket(), {
      wrapper: createWrapper(),
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1] as MockWebSocket;
    ws.simulateOpen();
    return { ws, unmount };
  }

  it('processes valid messages with string type field', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(
      JSON.stringify({
        type: 'AGENT_STATUS',
        agentId: 'a-1',
        status: 'online',
        lastSeen: 100,
      }),
    );
    // Flush any debounce timers
    vi.advanceTimersByTime(200);
    expect(useStore.getState().agentStatuses['a-1']).toEqual({
      status: 'online',
      lastSeen: 100,
    });
    unmount();
  });

  it('ignores messages without type field', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(JSON.stringify({ agentId: 'a-1' }));
    vi.advanceTimersByTime(200);
    expect(useStore.getState().agentStatuses['a-1']).toBeUndefined();
    unmount();
  });

  it('ignores messages where type is not a string (number)', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(JSON.stringify({ type: 42 }));
    vi.advanceTimersByTime(200);
    expect(Object.keys(useStore.getState().agentStatuses)).toHaveLength(0);
    unmount();
  });

  it('ignores messages where type is null', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(JSON.stringify({ type: null }));
    vi.advanceTimersByTime(200);
    expect(Object.keys(useStore.getState().agentStatuses)).toHaveLength(0);
    unmount();
  });

  it('ignores malformed JSON without throwing', () => {
    const { ws, unmount } = renderAndConnect();
    expect(() => {
      ws.simulateMessage('not valid json');
    }).not.toThrow();
    vi.advanceTimersByTime(200);
    expect(Object.keys(useStore.getState().agentStatuses)).toHaveLength(0);
    unmount();
  });

  it('ignores messages where type is an object', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(JSON.stringify({ type: { nested: true } }));
    vi.advanceTimersByTime(200);
    expect(Object.keys(useStore.getState().agentStatuses)).toHaveLength(0);
    unmount();
  });

  it('handles empty string type gracefully', () => {
    const { ws, unmount } = renderAndConnect();
    ws.simulateMessage(JSON.stringify({ type: '' }));
    vi.advanceTimersByTime(200);
    // Empty string is a valid string but won't match any handler, so no state changes
    expect(Object.keys(useStore.getState().agentStatuses)).toHaveLength(0);
    unmount();
  });
});
