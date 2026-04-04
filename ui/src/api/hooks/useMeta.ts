import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../client';

export interface AgentVersionInfo {
  id: string;
  name: string;
  hostname: string;
  online: boolean;
  status: string;
  agent_version: string;
  docker_version: string | null;
  os: string | null;
  arch: string | null;
}

export interface VersionsResponse {
  controller_version: string;
  agents: AgentVersionInfo[];
}

export interface LoggingResponse {
  log_level: string;
  debug_until: string | null;
  file_logging_enabled: boolean;
}

export function useVersionsInfo() {
  return useQuery({
    queryKey: ['meta-versions'],
    queryFn: () => apiRequest<VersionsResponse>('/meta/versions'),
  });
}

export function useLogging() {
  return useQuery({
    queryKey: ['meta-logging'],
    queryFn: () => apiRequest<LoggingResponse>('/meta/logging'),
    refetchInterval: 10_000,
  });
}

export function useUpdateLogging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      log_level?: string;
      ttl_minutes?: number;
      file_logging_enabled?: boolean;
    }) =>
      apiRequest<LoggingResponse>('/meta/logging', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-logging'] }),
  });
}

export async function downloadDiagnosticsBundle(): Promise<void> {
  const res = await fetch('/api/meta/diagnostics-bundle', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ??
    'watchwarden-diagnostics.zip';
  a.click();
  URL.revokeObjectURL(url);
}
