import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../client';

export interface ApiTokenListItem {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  token: string;
  scopes: string[];
  expires_at: number | null;
  created_at: number;
}

export function useApiTokens() {
  return useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => apiRequest<ApiTokenListItem[]>('/api-tokens'),
  });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; scopes?: string[]; expires_in_days?: number }) =>
      apiRequest<CreateTokenResponse>('/api-tokens', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
}
