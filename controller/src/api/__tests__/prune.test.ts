import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Auth and DB are covered elsewhere; these tests exercise routing + validation.
vi.mock('../middleware/auth.js', () => ({ requireAuth: async () => {} }));
vi.mock('../../db/queries.js', () => ({ getAgent: vi.fn(), listAgents: vi.fn() }));

import { PruneError } from '../../ws/prune-service.js';
import pruneRoutes from '../routes/prune.js';

const service = {
  startPrune: vi.fn(),
  preview: vi.fn(),
  startRun: vi.fn(),
  getRun: vi.fn(),
};

describe('prune routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify({ logger: false });
    app.decorate('pruneService', service);
    await app.register(pruneRoutes);
  });
  afterEach(() => app.close());

  it('POST /api/agents/:id/prune starts a prune and answers 202', async () => {
    service.startPrune.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/a1/prune',
      payload: { keepPrevious: 2, includeStopped: true },
    });
    expect(res.statusCode).toBe(202);
    expect(service.startPrune).toHaveBeenCalledWith('a1', {
      keepPrevious: 2,
      dryRun: false,
      includeStopped: true,
    });
  });

  it('rejects invalid keepPrevious with 400 and never starts a prune', async () => {
    for (const keepPrevious of [-1, 11, 'abc', 1.5]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agents/a1/prune',
        payload: { keepPrevious },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/keepPrevious/);
    }
    expect(service.startPrune).not.toHaveBeenCalled();
  });

  it('maps service errors to their status codes', async () => {
    service.startPrune.mockRejectedValue(new PruneError(409, 'A prune is already running'));
    const res = await app.inject({ method: 'POST', url: '/api/agents/a1/prune', payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'A prune is already running' });
  });

  it('GET preview parses query options', async () => {
    service.preview.mockResolvedValue({ removableImages: 3 });
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/a1/prune/preview?keepPrevious=0&includeStopped=true',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removableImages: 3 });
    expect(service.preview).toHaveBeenCalledWith('a1', {
      keepPrevious: 0,
      dryRun: false,
      includeStopped: true,
    });
  });

  it('GET preview rejects a non-numeric keepPrevious', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/a1/prune/preview?keepPrevious=abc',
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/prune starts a global run', async () => {
    service.startRun.mockResolvedValue({ runId: 'r1', status: 'running' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/prune',
      payload: { dryRun: true },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runId: 'r1' });
    expect(service.startRun).toHaveBeenCalledWith({
      keepPrevious: 1,
      dryRun: true,
      includeStopped: false,
    });
  });

  it('GET /api/prune/current returns the run or null', async () => {
    service.getRun.mockReturnValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/prune/current' });
    expect(res.json()).toEqual({ run: null });
  });
});
