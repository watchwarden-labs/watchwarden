import { describe, expect, it } from 'vitest';
import { extractExplicitTag, extractTag } from '../semver.js';

describe('extractTag', () => {
  it('returns the tag when present', () => {
    expect(extractTag('postgres:15.1')).toBe('15.1');
    expect(extractTag('ghcr.io/org/app:1.2.3')).toBe('1.2.3');
    expect(extractTag('localhost:5000/app:v2')).toBe('v2');
    // A purely numeric tag is still a tag — it must not be mistaken for a port.
    expect(extractTag('postgres:16')).toBe('16');
  });

  it('implies latest for an untagged name (update-check semantics)', () => {
    expect(extractTag('postgres')).toBe('latest');
    expect(extractTag('localhost:5000/app')).toBe('latest');
  });

  it('returns empty for a bare digest', () => {
    expect(extractTag('sha256:abc')).toBe('');
    expect(extractTag('')).toBe('');
  });

  it('ignores the digest suffix of a pinned ref', () => {
    expect(extractTag('nginx:1.25@sha256:abc')).toBe('1.25');
  });
});

describe('extractExplicitTag', () => {
  it('returns the tag when it is written in the ref', () => {
    expect(extractExplicitTag('postgres:15.1')).toBe('15.1');
    expect(extractExplicitTag('ghcr.io/org/app:1.2.3')).toBe('1.2.3');
    expect(extractExplicitTag('localhost:5000/app:v2')).toBe('v2');
    expect(extractExplicitTag('nginx:1.25@sha256:abc')).toBe('1.25');
  });

  it('never invents latest', () => {
    expect(extractExplicitTag('postgres')).toBeNull();
    expect(extractExplicitTag('ghcr.io/org/app')).toBeNull();
    expect(extractExplicitTag('postgres:')).toBeNull();
  });

  it('does not mistake a registry port for a tag', () => {
    expect(extractExplicitTag('localhost:5000/app')).toBeNull();
    expect(extractExplicitTag('registry.example.com:443/team/app')).toBeNull();
    expect(extractExplicitTag('localhost:5000/app:v2')).toBe('v2');
    expect(extractExplicitTag('postgres:16')).toBe('16');
  });

  it('returns null for digest-pinned refs without a tag (issue #80 rollback labels)', () => {
    // A rolled-back container is recreated from exactly this shape of ref. It may
    // be an old release, so labelling it "latest" in Local History was wrong.
    expect(
      extractExplicitTag(
        'portainer/agent@sha256:79e1bc0e10ab296061cd3d5c2f5739371469ece1937483d37a4ff28750cbd711',
      ),
    ).toBeNull();
    expect(extractExplicitTag('sha256:abc')).toBeNull();
    expect(extractExplicitTag('')).toBeNull();
  });
});
