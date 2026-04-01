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
