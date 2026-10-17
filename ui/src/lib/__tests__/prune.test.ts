import { describe, expect, it } from 'vitest';
import { describeRemoved, formatBytes, pruneToast } from '../prune';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [-5, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [10 * 1024 * 1024, '10 MB'],
    [1.2 * 1024 ** 3, '1.2 GB'],
  ])('%s -> %s', (n, out) => expect(formatBytes(n)).toBe(out));
});

describe('describeRemoved', () => {
  it('pluralises and omits zero parts', () => {
    expect(describeRemoved(1, 0)).toBe('1 image');
    expect(describeRemoved(3, 1)).toBe('3 images, 1 container');
    expect(describeRemoved(0, 2)).toBe('2 containers');
    expect(describeRemoved(0, 0)).toBe('nothing');
  });
});

describe('pruneToast', () => {
  const base = {
    agentName: 'web-1',
    status: 'success' as const,
    imagesRemoved: 3,
    containersRemoved: 1,
    spaceReclaimed: 2 * 1024 ** 3,
    errors: [] as string[],
  };

  it('reports how much was pruned', () => {
    expect(pruneToast(base, false)).toEqual({
      type: 'success',
      message: 'Pruned web-1: removed 3 images, 1 container, freed ~2.0 GB',
    });
  });

  it('says so when there was nothing to prune', () => {
    expect(pruneToast({ ...base, imagesRemoved: 0, containersRemoved: 0 }, false).message).toBe(
      'Nothing to prune on web-1',
    );
  });

  it('labels dry runs as such', () => {
    const t = pruneToast(base, true);
    expect(t.type).toBe('info');
    expect(t.message).toContain('would remove 3 images');
  });

  it('surfaces partial failures and total failures as errors', () => {
    expect(pruneToast({ ...base, status: 'partial', errors: ['a', 'b'] }, false)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('2 failed'),
    });
    expect(pruneToast({ ...base, status: 'failed', error: 'Agent disconnected' }, false)).toEqual({
      type: 'error',
      message: 'Prune failed on web-1: Agent disconnected',
    });
  });
});
