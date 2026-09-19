/**
 * Semver-level update filtering — TypeScript port of SemverMatchesLevel from agent/registry.go.
 *
 * Levels:
 *   "patch" — same major+minor, higher patch only
 *   "minor" — same major, any minor/patch increase
 *   "major" / "all" / "" — any version increase
 */

function extractVersionParts(tag: string): number[] {
  // Strip v/V prefix and common suffixes like "-alpine", "-slim"
  const stripped = tag.replace(/^[vV]/, '');
  const parts: number[] = [];
  for (const seg of stripped.split(/[.\-_]/)) {
    const n = Number.parseInt(seg, 10);
    if (!Number.isNaN(n)) {
      parts.push(n);
    } else if (parts.length > 0) {
      break; // stop at first non-numeric segment after we have some numbers
    }
  }
  return parts;
}

/**
 * Returns true if `candidate` is a valid update for `current` under the given `level` constraint.
 * When versions cannot be parsed, any change is allowed (safe fallback).
 */
export function semverMatchesLevel(current: string, candidate: string, level: string): boolean {
  const cur = extractVersionParts(current);
  const can = extractVersionParts(candidate);

  if (cur.length === 0 || can.length === 0) {
    return candidate !== current;
  }

  while (cur.length < 3) cur.push(0);
  while (can.length < 3) can.push(0);

  switch (level) {
    case 'patch':
      return can[0] === cur[0] && can[1] === cur[1] && (can[2] ?? 0) > (cur[2] ?? 0);
    case 'minor':
      if (can[0] !== cur[0]) return false;
      if ((can[1] ?? 0) > (cur[1] ?? 0)) return true;
      return (can[1] ?? 0) === (cur[1] ?? 0) && (can[2] ?? 0) > (cur[2] ?? 0);
    case 'major':
    case 'all':
    default:
      for (let i = 0; i < 3; i++) {
        if ((can[i] ?? 0) > (cur[i] ?? 0)) return true;
        if ((can[i] ?? 0) < (cur[i] ?? 0)) return false;
      }
      return false;
  }
}

/**
 * Extracts the tag portion from an image reference.
 * "postgres:15.1"          -> "15.1"
 * "ghcr.io/org/app:1.2.3"  -> "1.2.3"
 * "postgres"               -> "latest"
 * "sha256:abc..."          -> "" (digest — not a tag)
 */
export function extractTag(imageRef: string): string {
  return extractExplicitTag(imageRef) ?? (isDigestOnly(imageRef) ? '' : 'latest');
}

/**
 * Like extractTag, but only returns a tag that is actually written in the
 * reference — never the implied "latest" default. Use this when the tag will
 * be shown to a user as the name of a specific version: a digest-pinned ref
 * such as "portainer/agent@sha256:..." carries no tag at all, and labelling it
 * "latest" is simply wrong (the digest may well be an older release).
 * "postgres:15.1"                  -> "15.1"
 * "postgres"                       -> null
 * "portainer/agent@sha256:abc..."  -> null
 * "localhost:5000/app"             -> null (":5000" is a port, not a tag)
 */
export function extractExplicitTag(imageRef: string): string | null {
  if (!imageRef || isDigestOnly(imageRef)) return null;
  // Strip digest portion (image@sha256:...)
  const withoutDigest = imageRef.split('@')[0] ?? imageRef;
  const colonIdx = withoutDigest.lastIndexOf(':');
  if (colonIdx === -1) return null;
  const tag = withoutDigest.slice(colonIdx + 1);
  // If what follows the colon looks like a port (pure integer), it's part of the host
  if (tag === '' || /^\d+$/.test(tag)) return null;
  return tag;
}

function isDigestOnly(imageRef: string): boolean {
  return imageRef.startsWith('sha256:');
}
