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

/**
 * Check if a non-Docker Hub registry image also exists on Docker Hub,
 * which has better search, pagination, and date metadata.
 * Currently: lscr.io images are LinuxServer — always published to Docker Hub too.
 */
function canUseDockerHub(registry: string, _repository: string): boolean {
  const lower = registry.toLowerCase();
  return lower === 'lscr.io';
}

function extractTag(image: string): string | undefined {
  // Strip digest
  let ref = image;
  const atIdx = ref.indexOf('@');
  if (atIdx !== -1) ref = ref.slice(0, atIdx);
  const colonIdx = ref.lastIndexOf(':');
  const slashIdx = ref.lastIndexOf('/');
  if (colonIdx > slashIdx) return ref.slice(colonIdx + 1);
  return undefined;
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

  // Extract the tag from the image (e.g. "latest" from "lscr.io/linuxserver/sonarr:latest")
  const imageTag = extractTag(image);

  const cacheKey = `${registry}/${repository}:p${page}:l${limit}:s${search ?? ''}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let result: TagsResult;
    if (registry === 'docker.io') {
      result = await fetchDockerHubTags(repository, page, limit, search, controller.signal);
    } else if (canUseDockerHub(registry, repository)) {
      // lscr.io and some GHCR-backed registries also publish to Docker Hub
      // with better search, pagination, and date metadata
      result = await fetchDockerHubTags(repository, page, limit, search, controller.signal);
    } else {
      const creds = await getCredentials(registry);
      result = await fetchV2Tags(
        registry,
        repository,
        creds,
        page,
        limit,
        search,
        controller.signal,
        imageTag,
      );
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
  page: number,
  limit: number,
  search: string | undefined,
  signal: AbortSignal,
  imageTag?: string,
): Promise<TagsResult> {
  const headers: Record<string, string> = {};

  // Step 1: probe the tags endpoint to discover the auth scheme
  const tagsUrl = `https://${registry}/v2/${repository}/tags/list`;
  const probe = await fetch(tagsUrl, { signal, redirect: 'follow' }).catch(() => null);

  if (probe && probe.status === 401) {
    // Drain the body to free the connection
    await probe.text().catch(() => {});
    // Parse the WWW-Authenticate header to discover the token endpoint
    const wwwAuth = probe.headers.get('www-authenticate') ?? '';
    const token = await fetchBearerToken(wwwAuth, repository, creds, signal);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (creds) {
      headers.Authorization = `Basic ${btoa(`${creds.username}:${creds.password}`)}`;
    }
  } else if (probe && !probe.ok) {
    await probe.text().catch(() => {});
    if (creds) {
      headers.Authorization = `Basic ${btoa(`${creds.username}:${creds.password}`)}`;
    }
  }

  // Step 2: fetch tags using V2 pagination (RFC 5988 Link header).
  // V2 returns tags in lexicographic order. We fetch from the start (catches "latest",
  // "alpine", "beta" etc.) and also from the image's own tag as cursor (catches
  // version-numbered tags that sort after it: "4.x", "5.x", etc.).
  if (probe?.ok) await probe.text().catch(() => {}); // drain unused probe body

  const fetchBatch = async (cursor?: string): Promise<string[]> => {
    const u = new URL(tagsUrl);
    u.searchParams.set('n', '500');
    if (cursor) u.searchParams.set('last', cursor);
    const r = await fetch(u.toString(), { signal, headers });
    if (!r.ok) return [];
    const d = (await r.json()) as { tags: string[] | null };
    return d.tags ?? [];
  };

  // Use the image's current tag (e.g. "latest") as a cursor to skip past old tags
  const cursor = imageTag ?? 'latest';
  const [batch1, batch2] = await Promise.all([fetchBatch(), fetchBatch(cursor)]);
  const tagSet = new Set([...batch1, ...batch2]);
  let tagNames = [...tagSet];

  // Filter out platform-specific, internal, and build-info tags
  const noisePrefixes = [
    'amd64-',
    'arm64v8-',
    'arm32v7-',
    'arm64-',
    'arm-',
    'i386-',
    '386-',
    'version-',
    'sha-',
    'unstable-',
    'develop-',
  ];
  tagNames = tagNames.filter((t) => {
    const lower = t.toLowerCase();
    if (noisePrefixes.some((p) => lower.startsWith(p))) return false;
    // Filter out LinuxServer-style build tags (contain long build IDs + distro names)
    if (/ubuntu|debian|alpine\d/.test(lower) && lower.length > 30) return false;
    return true;
  });

  // Filter by search term (V2 API doesn't support server-side search)
  let filtered = tagNames;
  if (search) {
    const q = search.toLowerCase();
    filtered = tagNames.filter((t) => t.toLowerCase().includes(q));
  }

  // Sort: "latest" first, then version-like tags descending (newest first),
  // then remaining tags alphabetically descending.
  const isVersion = (t: string) => /^v?\d/.test(t);
  filtered.sort((a, b) => {
    if (a === 'latest') return -1;
    if (b === 'latest') return 1;
    const aVer = isVersion(a);
    const bVer = isVersion(b);
    if (aVer && !bVer) return -1;
    if (!aVer && bVer) return 1;
    // Both version-like: descending numeric sort (v3.3.16 before v3.0.3)
    if (aVer && bVer) return b.localeCompare(a, undefined, { numeric: true });
    // Both non-version: descending alphabetical
    return b.localeCompare(a);
  });

  // Paginate — only resolve digests for the requested page
  const totalCount = filtered.length;
  const start = (page - 1) * limit;
  const pageNames = filtered.slice(start, start + limit);

  const tagsWithDigests = await resolveDigests(registry, repository, pageNames, headers, signal);

  return {
    tags: tagsWithDigests,
    page,
    hasMore: start + limit < totalCount,
    total: totalCount,
  };
}

/**
 * Parse a WWW-Authenticate header and fetch a bearer token.
 * Format: Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"
 */
async function fetchBearerToken(
  wwwAuth: string,
  repository: string,
  creds: { username: string; password: string } | null,
  signal: AbortSignal,
): Promise<string | null> {
  const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
  if (!realmMatch) return null;

  const realm = realmMatch[1];
  const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
  const scopeMatch = wwwAuth.match(/scope="([^"]+)"/);

  const params = new URLSearchParams();
  if (serviceMatch) params.set('service', serviceMatch[1]!);
  params.set('scope', scopeMatch?.[1] ?? `repository:${repository}:pull`);

  const tokenUrl = `${realm}?${params}`;
  const fetchHeaders: Record<string, string> = {};
  if (creds) {
    fetchHeaders.Authorization = `Basic ${btoa(`${creds.username}:${creds.password}`)}`;
  }

  try {
    const res = await fetch(tokenUrl, { signal, headers: fetchHeaders });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string; access_token?: string };
    return data.token ?? data.access_token ?? null;
  } catch {
    return null;
  }
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
