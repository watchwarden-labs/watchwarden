import { useStore } from '../store/useStore';

export function getAuthToken(): string | null {
  return useStore.getState().authToken;
}

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API Error: ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  // Always include credentials so the httpOnly cookie is forwarded.
  // Also send Authorization: Bearer as fallback for API clients that stored the token.
  const token = useStore.getState().authToken;
  const headers: Record<string, string> = {};
  // Only send Bearer if it looks like a real JWT (not the sentinel "cookie" value)
  if (token && token !== 'cookie') {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    if (res.status === 401) {
      useStore.getState().setAuthToken(null);
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
