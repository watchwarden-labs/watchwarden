import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/queries.js', () => ({ getAgent: vi.fn(), listAgents: vi.fn() }));

import type { Agent, PruneResultPayload } from '../../types.js';
import { PruneService, parsePruneOptions } from '../prune-service.js';

const agent = (id: string, status: Agent['status'] = 'online'): Agent =>
  ({ id, name: `agent-${id}`, status }) as Agent;

function setup(agents: Agent[], online: string[] = agents.map((a) => a.id)) {
  const events: Array<Record<string, unknown>> = [];
  const hub = {
    sendAndWait: vi.fn(),
    setLegacyPrune: vi.fn(),
    getOnlineAgentIds: () => online,
  };
  const store = {
    getAgent: async (id: string) => agents.find((a) => a.id === id),
    listAgents: async () => agents,
  };
  const service = new PruneService(hub, { broadcast: (e) => events.push(e) }, store);
  return { service, hub, events };
}

const result = (over: Partial<PruneResultPayload> = {}): PruneResultPayload => ({
  imagesRemoved: 2,
  containersRemoved: 1,
  spaceReclaimed: 1000,
  details: [{ image: 'app:1', size: 1000, kind: 'image' }],
  errors: [],
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const opts = { keepPrevious: 1, dryRun: false, includeStopped: false };

describe('parsePruneOptions', () => {
  it('defaults to keep 1, real run, images only', () => {
    expect(parsePruneOptions(undefined)).toEqual(opts);
    expect(parsePruneOptions({})).toEqual(opts);
  });

  it.each([-1, 11, 1.5, '2', null, Number.NaN])('rejects keepPrevious %s', (bad) => {
    expect(() => parsePruneOptions({ keepPrevious: bad })).toThrow(/keepPrevious/);
  });

  it('rejects non-boolean flags', () => {
    expect(() => parsePruneOptions({ includeStopped: 'yes' })).toThrow(/includeStopped/);
    expect(() => parsePruneOptions({ dryRun: 1 })).toThrow(/dryRun/);
  });

  it('accepts 0 (keep nothing) and the opt-in flags', () => {
    expect(parsePruneOptions({ keepPrevious: 0, dryRun: true, includeStopped: true })).toEqual({
      keepPrevious: 0,
      dryRun: true,
      includeStopped: true,
    });
  });
});

describe('PruneService.startPrune', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup([agent('a1')]);
  });

  it('404s for unknown agents and 409s for offline ones', async () => {
    await expect(ctx.service.startPrune('nope', opts)).rejects.toMatchObject({ statusCode: 404 });
    const offline = setup([agent('a1', 'offline')], []);
    await expect(offline.service.startPrune('a1', opts)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('sends PRUNE with the options and broadcasts the outcome', async () => {
    ctx.hub.sendAndWait.mockResolvedValue(result());
    await ctx.service.startPrune('a1', { ...opts, includeStopped: true });
    await flush();

    const [agentId, message] = ctx.hub.sendAndWait.mock.calls[0] ?? [];
    expect(agentId).toBe('a1');
    expect(message).toMatchObject({
      type: 'PRUNE',
      payload: { keepPrevious: 1, dryRun: false, includeStopped: true },
    });
    expect(ctx.events.map((e) => e.type)).toEqual(['PRUNE_STARTED', 'PRUNE_COMPLETE']);
    expect(ctx.events[1]).toMatchObject({
      agentId: 'a1',
      status: 'success',
      imagesRemoved: 2,
      containersRemoved: 1,
      spaceReclaimed: 1000,
    });
    expect(ctx.service.isPruning('a1')).toBe(false);
  });

  it('rejects a second prune while one is running', async () => {
    let finish: (r: PruneResultPayload) => void = () => {};
    ctx.hub.sendAndWait.mockReturnValue(new Promise((r) => (finish = r)));
    await ctx.service.startPrune('a1', opts);
    await expect(ctx.service.startPrune('a1', opts)).rejects.toMatchObject({ statusCode: 409 });
    finish(result());
    await flush();
    await expect(ctx.service.startPrune('a1', opts)).resolves.toBeUndefined();
  });

  it('reports a timeout / disconnect as a failed outcome, not a hang', async () => {
    ctx.hub.sendAndWait.mockRejectedValue(new Error('Agent request timed out'));
    await ctx.service.startPrune('a1', opts);
    await flush();
    expect(ctx.events[1]).toMatchObject({
      type: 'PRUNE_COMPLETE',
      status: 'failed',
      error: 'Agent request timed out',
    });
    expect(ctx.service.isPruning('a1')).toBe(false);
    expect(ctx.hub.setLegacyPrune).toHaveBeenLastCalledWith('a1', null);
  });

  it('marks partial success when some removals failed', async () => {
    ctx.hub.sendAndWait.mockResolvedValue(result({ errors: ['failed to remove x'] }));
    await ctx.service.startPrune('a1', opts);
    await flush();
    expect(ctx.events[1]).toMatchObject({ status: 'partial', errors: ['failed to remove x'] });
  });

  it('marks failed when nothing was removed and errors were reported', async () => {
    ctx.hub.sendAndWait.mockResolvedValue(
      result({ imagesRemoved: 0, containersRemoved: 0, errors: ['failed to list images'] }),
    );
    await ctx.service.startPrune('a1', opts);
    await flush();
    expect(ctx.events[1]).toMatchObject({ status: 'failed' });
  });
});

describe('PruneService.preview', () => {
  it('asks the agent for a preview with the chosen options', async () => {
    const { service, hub } = setup([agent('a1')]);
    const preview = { totalImages: 3, removableImages: 1 };
    hub.sendAndWait.mockResolvedValue(preview);
    await expect(service.preview('a1', { keepPrevious: 2, includeStopped: true })).resolves.toBe(
      preview,
    );
    expect(hub.sendAndWait.mock.calls[0]?.[1]).toMatchObject({
      type: 'PRUNE_PREVIEW',
      payload: { keepPrevious: 2, includeStopped: true },
    });
  });

  it('answers 504 when the agent does not reply', async () => {
    const { service, hub } = setup([agent('a1')]);
    hub.sendAndWait.mockRejectedValue(new Error('Agent request timed out'));
    await expect(
      service.preview('a1', { keepPrevious: 1, includeStopped: false }),
    ).rejects.toMatchObject({ statusCode: 504 });
  });
});

describe('PruneService.startRun (prune all agents)', () => {
  it('prunes online agents one at a time, skips offline ones, and totals the result', async () => {
    const agents = [agent('a1'), agent('a2', 'offline'), agent('a3'), agent('a4')];
    const { service, hub, events } = setup(agents, ['a1', 'a3', 'a4']);

    let inFlight = 0;
    let maxInFlight = 0;
    hub.sendAndWait.mockImplementation(async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      if (id === 'a4') throw new Error('Agent disconnected');
      return result();
    });

    await service.startRun(opts);
    while (service.getRun()?.status === 'running') await flush();

    expect(maxInFlight).toBe(1);
    const run = service.getRun();
    expect(run?.results.map((r) => [r.agentId, r.status])).toEqual([
      ['a1', 'success'],
      ['a2', 'skipped'],
      ['a3', 'success'],
      ['a4', 'failed'],
    ]);
    expect(run?.totals).toMatchObject({
      agents: 4,
      imagesRemoved: 4,
      containersRemoved: 2,
      spaceReclaimed: 2000,
      failed: 1,
      skipped: 1,
    });
    const complete = events.find((e) => e.type === 'PRUNE_RUN_COMPLETE');
    expect(complete).toMatchObject({ runId: run?.runId, status: 'complete' });
    expect(events.filter((e) => e.type === 'PRUNE_RUN_PROGRESS').length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a second run while one is in progress', async () => {
    const { service, hub } = setup([agent('a1')]);
    let finish: (r: PruneResultPayload) => void = () => {};
    hub.sendAndWait.mockReturnValue(new Promise((r) => (finish = r)));
    await service.startRun(opts);
    await expect(service.startRun(opts)).rejects.toMatchObject({ statusCode: 409 });
    finish(result());
    while (service.getRun()?.status === 'running') await flush();
    await expect(service.startRun(opts)).resolves.toBeDefined();
  });

  it('does not double-prune an agent that is already busy', async () => {
    const { service, hub } = setup([agent('a1')]);
    let finish: (r: PruneResultPayload) => void = () => {};
    hub.sendAndWait.mockReturnValue(new Promise((r) => (finish = r)));
    await service.startPrune('a1', opts);
    await service.startRun(opts);
    while (service.getRun()?.status === 'running') await flush();
    expect(service.getRun()?.results[0]).toMatchObject({ status: 'failed' });
    expect(hub.sendAndWait).toHaveBeenCalledTimes(1);
    finish(result());
  });
});
