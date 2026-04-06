import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { disableRecoveryMode, getConfig, setConfig } from '../../db/queries.js';
import { buildTestApp, getAuthToken, teardownTestApp } from './helpers.js';

describe('Recovery Mode API', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    await startPostgres();
    app = await buildTestApp();
    authToken = await getAuthToken(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await teardownTestApp();
    await stopPostgres();
  });

  const authHeaders = () => ({ authorization: `Bearer ${authToken}` });

  beforeEach(async () => {
    await disableRecoveryMode();
  });

  // --- GET /api/recovery-mode ---

  describe('GET /api/recovery-mode', () => {
    it('returns disabled when not active', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recovery-mode',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(false);
      expect(body.expiresAt).toBeNull();
      expect(body.remainingSeconds).toBeNull();
    });

    it('returns enabled with countdown when active', async () => {
      // Enable recovery mode for 5 minutes
      await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: { ttlMinutes: 5 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/recovery-mode',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(true);
      expect(body.expiresAt).toBeGreaterThan(Date.now());
      expect(body.remainingSeconds).toBeGreaterThan(0);
      expect(body.remainingSeconds).toBeLessThanOrEqual(300);
    });

    it('returns disabled when TTL has expired', async () => {
      // Set an already-expired timestamp
      await setConfig('recovery_mode_expires_at', String(Date.now() - 1000));

      const res = await app.inject({
        method: 'GET',
        url: '/api/recovery-mode',
        headers: authHeaders(),
      });
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(false);
      expect(body.expiresAt).toBeNull();
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recovery-mode',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- POST /api/recovery-mode ---

  describe('POST /api/recovery-mode', () => {
    it('enables recovery mode with default TTL (15 min)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(true);
      expect(body.remainingSeconds).toBe(900); // 15 * 60

      // Verify in DB
      const val = await getConfig('recovery_mode_expires_at');
      expect(val).toBeDefined();
      expect(Number(val)).toBeGreaterThan(Date.now());
    });

    it('enables recovery mode with custom TTL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: { ttlMinutes: 30 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.remainingSeconds).toBe(1800); // 30 * 60
    });

    it('rejects TTL < 1', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: { ttlMinutes: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects TTL > 60', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: { ttlMinutes: 120 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        payload: { ttlMinutes: 5 },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- DELETE /api/recovery-mode ---

  describe('DELETE /api/recovery-mode', () => {
    it('disables active recovery mode', async () => {
      // Enable first
      await app.inject({
        method: 'POST',
        url: '/api/recovery-mode',
        headers: authHeaders(),
        payload: { ttlMinutes: 15 },
      });

      // Disable
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/recovery-mode',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(false);

      // Verify in DB
      const val = await getConfig('recovery_mode_expires_at');
      expect(val).toBeUndefined();
    });

    it('is idempotent when already disabled', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/recovery-mode',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/recovery-mode',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
