import { describe, expect, it } from 'vitest';
import { movingTags, shortDigest } from '../digest';

describe('shortDigest', () => {
  it('drops the repository prefix of a repo digest (issue #80 "portainer/agent@...")', () => {
    expect(
      shortDigest(
        'portainer/agent@sha256:79e1bc0e10ab296061cd3d5c2f5739371469ece1937483d37a4ff28750cbd711',
      ),
    ).toBe('sha256:79e1bc0e1...');
  });

  it('truncates a bare digest', () => {
    expect(shortDigest('sha256:79e1bc0e10ab296061cd')).toBe('sha256:79e1bc0e1...');
  });

  it('leaves short values alone and handles missing digests', () => {
    expect(shortDigest('sha256:abc')).toBe('sha256:abc');
    expect(shortDigest(null)).toBe('—');
    expect(shortDigest(undefined)).toBe('—');
  });
});

describe('movingTags', () => {
  it('flags a tag that labels more than one digest', () => {
    const tags = movingTags([
      { tag: 'latest', digest: 'sha256:2ac5' },
      { tag: 'latest', digest: 'sha256:43c8' },
      { tag: '2.39.7', digest: 'sha256:79e1' },
    ]);
    expect([...tags]).toEqual(['latest']);
  });

  it('does not flag a tag repeated for the same digest or entries without tags', () => {
    const tags = movingTags([
      { tag: 'latest', digest: 'sha256:d63b' },
      { tag: 'latest', digest: 'sha256:d63b' },
      { tag: null, digest: 'sha256:0d5e' },
    ]);
    expect(tags.size).toBe(0);
  });
});
