import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Container,
  PrunePreviewPayload,
  PruneResultPayload,
  PruneRunSummary,
  Agent as SharedAgent,
} from '@watchwarden/types';
import { apiRequest } from '../client';

export type Agent = Omit<SharedAgent, 'token_hash' | 'token_prefix'>;
export type { Container };

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => apiRequest<Agent[]>('/agents'),
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => apiRequest<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useRegisterAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; hostname: string }) =>
      apiRequest<{ agentId: string; token: string }>('/agents/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useRegenerateAgentToken() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ agentId: string; token: string }>(`/agents/${id}/regenerate-token`, {
        method: 'POST',
      }),
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useCheckAgent() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/agents/${id}/check`, { method: 'POST', body: '{}' }),
  });
}

export function useCheckContainer() {
  return useMutation({
    mutationFn: ({ agentId, containerIds }: { agentId: string; containerIds: string[] }) =>
      apiRequest<void>(`/agents/${agentId}/check`, {
        method: 'POST',
        body: JSON.stringify({ containerIds }),
      }),
  });
}

export function useCheckAllAgents() {
  return useMutation({
    mutationFn: () => apiRequest<{ count: number }>('/agents/check-all', { method: 'POST' }),
  });
}

export function useUpdateAgent() {
  return useMutation({
    mutationFn: ({ id, containerIds }: { id: string; containerIds?: string[] }) =>
      apiRequest<void>(`/agents/${id}/update`, {
        method: 'POST',
        body: JSON.stringify({ containerIds }),
      }),
  });
}

export function useRollbackContainer() {
  return useMutation({
    mutationFn: ({
      agentId,
      containerId,
      targetTag,
      targetDigest,
    }: {
      agentId: string;
      containerId: string;
      targetTag?: string;
      targetDigest?: string;
    }) =>
      apiRequest<void>(`/agents/${agentId}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ containerId, targetTag, targetDigest }),
      }),
  });
}

export type PruneResult = PruneResultPayload;

export interface PruneOptions {
  keepPrevious: number;
  includeStopped: boolean;
  dryRun?: boolean;
}

export function usePruneAgent() {
  return useMutation({
    mutationFn: ({
      id,
      keepPrevious,
      includeStopped,
      dryRun = false,
    }: PruneOptions & { id: string }) =>
      apiRequest<{ message: string }>(`/agents/${id}/prune`, {
        method: 'POST',
        body: JSON.stringify({ keepPrevious, includeStopped, dryRun }),
      }),
  });
}

/** Disk-usage summary and prune candidates. Fetched on demand; refetched after each prune. */
export function usePrunePreview(
  id: string,
  opts: { keepPrevious: number; includeStopped: boolean } | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['prune-preview', id, opts?.keepPrevious, opts?.includeStopped],
    queryFn: async () => {
      const qs = new URLSearchParams({
        keepPrevious: String(opts?.keepPrevious),
        includeStopped: String(opts?.includeStopped),
      });
      const preview = await apiRequest<PrunePreviewPayload>(
        `/agents/${id}/prune/preview?${qs.toString()}`,
      );
      if (preview.error) throw new Error(preview.error);
      return preview;
    },
    enabled: enabled && !!id && opts !== null,
    staleTime: 30_000,
    retry: false,
  });
}

/** Starts a sequential prune of every online agent; progress arrives over WebSocket. */
export function usePruneAll() {
  return useMutation({
    mutationFn: (opts: PruneOptions) =>
      apiRequest<PruneRunSummary>('/prune', {
        method: 'POST',
        body: JSON.stringify(opts),
      }),
  });
}

/** The running (or last finished) prune-all run; used to restore state after a reload. */
export function useCurrentPruneRun(enabled: boolean) {
  return useQuery({
    queryKey: ['prune-current'],
    queryFn: () => apiRequest<{ run: PruneRunSummary | null }>('/prune/current'),
    enabled,
    staleTime: 0,
  });
}

export function useScanContainer() {
  return useMutation({
    mutationFn: ({
      agentId,
      containerId,
      containerName,
      image,
    }: {
      agentId: string;
      containerId: string;
      containerName: string;
      image: string;
    }) =>
      apiRequest<{ message: string }>(`/agents/${agentId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ containerId, containerName, image }),
      }),
  });
}

export function useContainerStart() {
  return useMutation({
    mutationFn: ({ agentId, containerId }: { agentId: string; containerId: string }) =>
      apiRequest<{ message: string }>(`/agents/${agentId}/containers/${containerId}/start`, {
        method: 'POST',
      }),
  });
}

export function useContainerStop() {
  return useMutation({
    mutationFn: ({ agentId, containerId }: { agentId: string; containerId: string }) =>
      apiRequest<{ message: string }>(`/agents/${agentId}/containers/${containerId}/stop`, {
        method: 'POST',
      }),
  });
}

export function useContainerDelete() {
  return useMutation({
    mutationFn: ({ agentId, containerId }: { agentId: string; containerId: string }) =>
      apiRequest<{ message: string }>(`/agents/${agentId}/containers/${containerId}`, {
        method: 'DELETE',
      }),
  });
}

export function useContainerLogs(
  agentId: string,
  containerId: string,
  tail = 100,
  enabled = false,
) {
  return useQuery({
    queryKey: ['containerLogs', agentId, containerId, tail],
    queryFn: () =>
      apiRequest<{ logs: string; containerId: string; tail: number }>(
        `/agents/${agentId}/containers/${containerId}/logs?tail=${tail}`,
      ),
    enabled,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

export function useUpdateContainerPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      containerId,
      policy,
      updateLevel,
      tagPattern,
    }: {
      agentId: string;
      containerId: string;
      policy: string | null;
      updateLevel: string | null;
      tagPattern?: string | null;
    }) =>
      apiRequest<void>(`/agents/${agentId}/containers/${containerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ policy, update_level: updateLevel, tag_pattern: tagPattern }),
      }),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId] });
    },
  });
}

export function useUpdateContainerOrchestration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      containerId,
      group,
      priority,
      dependsOn,
    }: {
      agentId: string;
      containerId: string;
      group: string | null;
      priority: number;
      dependsOn: string[];
    }) =>
      apiRequest<void>(`/agents/${agentId}/containers/${containerId}/orchestration`, {
        method: 'PATCH',
        body: JSON.stringify({ group, priority, dependsOn }),
      }),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', agentId] });
    },
  });
}

export function useContainerRestart() {
  return useMutation({
    mutationFn: ({ agentId, containerId }: { agentId: string; containerId: string }) =>
      apiRequest<{ message: string }>(`/agents/${agentId}/containers/${containerId}/restart`, {
        method: 'POST',
      }),
  });
}

export function useRestartUnhealthy() {
  return useMutation({
    mutationFn: (agentId: string) =>
      apiRequest<{ message: string; containerIds?: string[] }>(
        `/agents/${agentId}/restart-unhealthy`,
        {
          method: 'POST',
        },
      ),
  });
}

export function useUpdateAgentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      config,
    }: {
      id: string;
      config: { scheduleOverride?: string | null; autoUpdate?: boolean };
    }) =>
      apiRequest<void>(`/agents/${id}/config`, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    onSuccess: (_, { id }) => queryClient.invalidateQueries({ queryKey: ['agents', id] }),
  });
}
