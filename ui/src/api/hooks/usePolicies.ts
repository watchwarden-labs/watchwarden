import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdatePolicy } from '@watchwarden/types';
import { apiRequest } from '../client';

export type { UpdatePolicy };

export function useUpdatePolicy(agentId?: string) {
  const params = agentId ? `?agentId=${agentId}` : '';
  return useQuery({
    queryKey: ['update-policies', agentId],
    queryFn: () => apiRequest<UpdatePolicy>(`/update-policies${params}`),
  });
}

export function useUpdatePolicyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      scope: string;
      stabilityWindowSeconds?: number;
      autoRollbackEnabled?: boolean;
      maxUnhealthySeconds?: number;
      strategy?: string;
      minAgeHours?: number;
    }) =>
      apiRequest<void>('/update-policies', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['update-policies'] }),
  });
}
