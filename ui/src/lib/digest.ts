/**
 * Shortens an image digest for display.
 *
 * Accepts a bare digest ("sha256:79e1bc0e10ab...") or a full repo digest
 * ("portainer/agent@sha256:79e1bc0e10ab..."). The repository prefix is dropped
 * first: truncating the full reference used to leave only "portainer/agent@...",
 * which says nothing about which version is running.
 */
export function shortDigest(d: string | null | undefined, length = 16): string {
  if (!d) return '—';
  const bare = d.includes('@') ? d.slice(d.indexOf('@') + 1) : d;
  return bare.length > length ? `${bare.slice(0, length)}...` : bare;
}

/**
 * Returns the tags that label more than one distinct digest in a version list.
 * A moving tag such as "latest" points at different images over time, so two
 * history entries can both have been "latest" when they were recorded.
 */
export function movingTags(versions: { tag: string | null; digest: string | null }[]): Set<string> {
  const digestsByTag = new Map<string, Set<string>>();
  for (const v of versions) {
    if (!v.tag || !v.digest) continue;
    const set = digestsByTag.get(v.tag) ?? new Set<string>();
    set.add(v.digest);
    digestsByTag.set(v.tag, set);
  }
  const result = new Set<string>();
  for (const [tag, digests] of digestsByTag) {
    if (digests.size > 1) result.add(tag);
  }
  return result;
}
