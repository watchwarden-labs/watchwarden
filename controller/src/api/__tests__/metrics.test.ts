import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { buildTestApp, teardownTestApp } from './helpers.js';

describe('Prometheus metrics', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await startPostgres();
    app = await buildTestApp();
  }, 60000);

  afterAll(async () => {
    await app.close();
    await teardownTestApp();
    await stopPostgres();
  });

  it('GET /metrics returns Prometheus exposition format without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      // No auth headers — Prometheus scrapes without auth
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const body = res.body;
    expect(body).toContain('watchwarden_agents_total');
    expect(body).toContain('watchwarden_agents_online');
    expect(body).toContain('watchwarden_containers_total');
    expect(body).toContain('watchwarden_containers_updates_available');
    expect(body).toContain('watchwarden_updates_total');
    expect(body).toContain('status="success"');
    expect(body).toContain('status="failed"');
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
  });

  it('metrics values are valid numbers', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const lines = res.body.split('\n').filter((l: string) => l && !l.startsWith('#'));

    for (const line of lines) {
      const parts = line.split(' ');
      const value = parts[parts.length - 1];
      expect(Number.isFinite(Number(value))).toBe(true);
    }
  });
});
