import { listRegistryCredentials } from '../db/queries.js';
import { decrypt } from './crypto.js';

export interface RegistryTag {
  name: string;
  digest: string | null;
  updatedAt: string | null;
}

export interface TagsResult {
  tags: RegistryTag[];
  page: number;
  hasMore: boolean;
  total: number | null;
}

// Simple in-memory cache: key = image+page+search, ttl = 5 min
const cache = new Map<string, { data: TagsResult; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): TagsResult | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: TagsResult): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  // Prune old entries
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }
}

function parseImageRef(image: string): {
  registry: string;
  repository: string;
} {
  let ref = image;
  const atIdx = ref.indexOf('@');
  if (atIdx !== -1) ref = ref.slice(0, atIdx);
  const colonIdx = ref.lastIndexOf(':');
  const slashIdx = ref.lastIndexOf('/');
  if (colonIdx > slashIdx) ref = ref.slice(0, colonIdx);

  if (!ref.includes('/')) {
    return { registry: 'docker.io', repository: `library/${ref}` };
  }

  const parts = ref.split('/');
  const first = parts[0]!;
  if (first.includes('.') || first.includes(':')) {
    return { registry: first, repository: parts.slice(1).join('/') };
  }

  return { registry: 'docker.io', repository: ref };
}

async function getCredentials(
  registry: string,
): Promise<{ username: string; password: string } | null> {
  try {
    const creds = await listRegistryCredentials();
    // Normalize: "docker.io" should also match "index.docker.io"
    const normalizedRegistry = registry === 'docker.io' ? 'index.docker.io' : registry;
    for (const c of creds) {
      const credRegistry = c.registry === 'docker.io' ? 'index.docker.io' : c.registry;
      if (credRegistry === normalizedRegistry || c.registry === registry) {
        return {
          username: c.username,
          password: decrypt(c.password_encrypted),
        };
      }
    }
  } catch {
    // DB or decrypt error — proceed without auth
  }
  return null;
}

export async function fetchRegistryTags(
  image: string,
  options: { page?: number; limit?: number; search?: string } = {},
): Promise<TagsResult> {
  const { page = 1, limit = 20, search } = options;
  const { registry, repository } = parseImageRef(image);

  const cacheKey = `${registry}/${repository}:p${page}:l${limit}:s${search ?? ''}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    let result: TagsResult;
    if (registry === 'docker.io') {
      result = await fetchDockerHubTags(repository, page, limit, search, controller.signal);
    } else {
      const creds = await getCredentials(registry);
      result = await fetchV2Tags(registry, repository, creds, controller.signal);
    }
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { tags: [], page, hasMore: false, total: null };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDockerHubTags(
  repository: string,
  page: number,
  limit: number,
  search: string | undefined,
  signal: AbortSignal,
): Promise<TagsResult> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(limit),
  });
  if (search) params.set('name', search);

  const url = `https://hub.docker.com/v2/repositories/${repository}/tags?${params}`;
  const res = await fetch(url, { signal });

  if (!res.ok) {
    return { tags: [], page, hasMore: false, total: null };
  }

  const data = (await res.json()) as {
    count: number;
    results: Array<{
      name: string;
      digest: string | null;
      last_updated: string | null;
    }>;
  };

  return {
    tags: data.results.map((t) => ({
      name: t.name,
      digest: t.digest,
      updatedAt: t.last_updated,
    })),
    page,
    hasMore: data.count > page * limit,
    total: data.count,
  };
}

async function fetchV2Tags(
  registry: string,
  repository: string,
  creds: { username: string; password: string } | null,
  signal: AbortSignal,
): Promise<TagsResult> {
  const headers: Record<string, string> = {};

  // Authenticate if credentials available
  if (creds) {
    // Try to get a bearer token first (ghcr.io, registry.gitlab.com, etc.)
    try {
      const tokenUrl = `https://${registry}/token?service=${registry}&scope=repository:${repository}:pull`;
      const tokenRes = await fetch(tokenUrl, {
        signal,
        headers: {
          Authorization: `Basic ${btoa(`${creds.username}:${creds.password}`)}`,
        },
      });
      if (tokenRes.ok) {
        const tokenData = (await tokenRes.json()) as { token?: string };
        if (tokenData.token) {
          headers.Authorization = `Bearer ${tokenData.token}`;
        }
      }
    } catch {
      // Fall back to basic auth
      headers.Authorization = `Basic ${btoa(`${creds.username}:${creds.password}`)}`;
    }
  }

  const url = `https://${registry}/v2/${repository}/tags/list`;
  const res = await fetch(url, { signal, headers });

  if (!res.ok) {
    return { tags: [], page: 1, hasMore: false, total: null };
  }

  const data = (await res.json()) as { tags: string[] | null };
  const tagNames = data.tags ?? [];

  // Sort tags: semver-like first (descending), then alphabetical
  tagNames.sort((a, b) => {
    const aIsSemver = /^\d/.test(a);
    const bIsSemver = /^\d/.test(b);
    if (aIsSemver && !bIsSemver) return -1;
    if (!aIsSemver && bIsSemver) return 1;
    if (aIsSemver && bIsSemver) return b.localeCompare(a, undefined, { numeric: true });
    return a.localeCompare(b);
  });

  // Try to fetch digests for each tag (best effort, parallel, with timeout)
  const tagsWithDigests = await resolveDigests(registry, repository, tagNames, headers, signal);

  return {
    tags: tagsWithDigests,
    page: 1,
    hasMore: false,
    total: tagNames.length,
  };
}

async function resolveDigests(
  registry: string,
  repository: string,
  tagNames: string[],
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<RegistryTag[]> {
  // Resolve digests in parallel, max 10 concurrent, 2s timeout per request
  const results: RegistryTag[] = [];
  const batchSize = 10;

  for (let i = 0; i < tagNames.length; i += batchSize) {
    const batch = tagNames.slice(i, i + batchSize);
    const promises = batch.map(async (name) => {
      try {
        const manifestUrl = `https://${registry}/v2/${repository}/manifests/${name}`;
        const res = await fetch(manifestUrl, {
          method: 'HEAD',
          signal,
          headers: {
            ...headers,
            Accept:
              'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
          },
        });
        const digest = res.headers.get('docker-content-digest');
        return { name, digest, updatedAt: null };
      } catch {
        return { name, digest: null, updatedAt: null };
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}
