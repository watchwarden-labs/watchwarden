import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useStore } from '../store/useStore';

export function useSocket() {
  const queryClient = useQueryClient();
  const setWsConnected = useStore((s) => s.setWsConnected);
  const handleWSEvent = useStore((s) => s.handleWSEvent);
  const setInvalidateAgents = useStore((s) => s.setInvalidateAgents);

  useEffect(() => {
    // Wire query invalidation into the store — debounced to batch rapid WS events
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    setInvalidateAgents(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        queryClient.invalidateQueries({ queryKey: ['history'] });
      }, 500);
    });

    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    const MAX_BACKOFF = 30000;

    function connect() {
      if (cancelled) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/ui`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setWsConnected(true);
        backoff = 1000; // reset on successful connect
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        queryClient.invalidateQueries({ queryKey: ['history'] });
      };

      ws.onclose = (event) => {
        setWsConnected(false);
        if (event.code === 4001) {
          useStore.getState().setAuthToken(null);
          return;
        }
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          // FIX-6.4: validate message shape before processing — reject messages
          // without a string `type` field to prevent undefined-access crashes.
          if (typeof msg.type !== 'string') return;
          // HEALTH_STATUS: update container health in-place without a network refetch
          if (msg.type === 'HEALTH_STATUS') {
            const agentId = typeof msg.agentId === 'string' ? msg.agentId : undefined;
            const containerId = typeof msg.containerId === 'string' ? msg.containerId : undefined;
            const status = typeof msg.status === 'string' ? msg.status : undefined;
            if (agentId && containerId && status) {
              queryClient.setQueryData(
                ['agents', agentId],
                (old: Record<string, unknown> | undefined) => {
                  if (!old) return old;
                  const containers = old.containers as Array<Record<string, unknown>> | undefined;
                  if (!containers) return old;
                  return {
                    ...old,
                    containers: containers.map((c) =>
                      (c.docker_id as string)?.startsWith(containerId) ||
                      containerId.startsWith(c.docker_id as string)
                        ? { ...c, health_status: status }
                        : c,
                    ),
                  };
                },
              );
            }
            return;
          }
          handleWSEvent(msg);
        } catch {
          // ignore malformed
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [queryClient, setWsConnected, handleWSEvent, setInvalidateAgents]);
}
