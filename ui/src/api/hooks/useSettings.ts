import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../client';

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => apiRequest<Record<string, string>>('/config'),
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; value: string }) =>
      apiRequest<void>('/config', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });
}

// --- Recovery Mode ---

interface RecoveryModeStatus {
  enabled: boolean;
  expiresAt: number | null;
  remainingSeconds: number | null;
}

export function useRecoveryMode() {
  return useQuery({
    queryKey: ['recovery-mode'],
    queryFn: () => apiRequest<RecoveryModeStatus>('/recovery-mode'),
    refetchInterval: 10_000,
  });
}

export function useEnableRecoveryMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ttlMinutes?: number }) =>
      apiRequest<RecoveryModeStatus>('/recovery-mode', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recovery-mode'] }),
  });
}

export function useDisableRecoveryMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ enabled: false }>('/recovery-mode', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recovery-mode'] }),
  });
}
