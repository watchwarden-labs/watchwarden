import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres, truncateAll } from '../../__tests__/pg-setup.js';
import { sql } from '../../db/client.js';
import { setConfig } from '../../db/queries.js';
import { buildTestApp, getAuthToken, teardownTestApp } from './helpers.js';

describe('API Tokens', () => {
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

  beforeEach(async () => {
    await sql`DELETE FROM api_tokens`;
    // Re-seed config that may have been cleared
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('testpassword', 10);
    await setConfig('admin_password_hash', hash);
    await setConfig('jwt_secret', 'test-jwt-secret');
  });

  const authHeaders = () => ({ authorization: `Bearer ${authToken}` });

  // ── Token CRUD ────────────────────────────────────────────

  describe('POST /api/api-tokens', () => {
    it('creates a token and returns plaintext once', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Test Token' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Token');
      expect(body.token).toMatch(/^ww_[0-9a-f]{64}$/);
      expect(body.scopes).toEqual(['full']);
      expect(body.created_at).toBeGreaterThan(0);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when name is empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: '   ' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when name exceeds 128 chars', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'A'.repeat(200) },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('128');
    });

    it('returns 400 for invalid scopes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Bad Scopes', scopes: ['admin', 'superuser'] },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid scopes');
    });

    it('accepts valid scopes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Read-only', scopes: ['read'] },
      });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).scopes).toEqual(['read']);
    });

    it('sets expiration when expires_in_days provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Expiring', expires_in_days: 30 },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.expires_at).toBeGreaterThan(Date.now());
      // Should be roughly 30 days from now (within 1 minute)
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(body.expires_at).toBeGreaterThan(Date.now() + thirtyDaysMs - 60000);
    });

    it('expires_at is null when expires_in_days not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'No Expiry' },
      });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).expires_at).toBeNull();
    });

    it('stores hash in DB, not plaintext', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Hash Test' },
      });
      const body = JSON.parse(res.body);
      const [row] = await sql`SELECT token_hash FROM api_tokens WHERE id = ${body.id}`;
      expect(row?.token_hash).toBeDefined();
      expect(row?.token_hash).not.toBe(body.token);
      expect(row?.token_hash).toHaveLength(64); // SHA-256 hex
    });

    it('creates audit log entry', async () => {
      await sql`DELETE FROM audit_log`;
      await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Audit Test' },
      });
      const rows = await sql`SELECT * FROM audit_log WHERE action = 'api_token_created'`;
      expect(rows.length).toBe(1);
      expect(rows[0]?.target_type).toBe('api_token');
    });

    it('requires JWT auth, not API token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        payload: { name: 'No Auth' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/api-tokens', () => {
    it('lists tokens without hash or prefix', async () => {
      // Create a token first
      await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Listed Token' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/api-tokens',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Listed Token');
      // Security: must NOT expose hash or prefix
      expect(body[0].token_hash).toBeUndefined();
      expect(body[0].token_prefix).toBeUndefined();
      expect(body[0].token).toBeUndefined();
    });

    it('returns empty array when no tokens exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/api-tokens',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });
  });

  describe('DELETE /api/api-tokens/:id', () => {
    it('revokes an active token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'To Revoke' },
      });
      const { id } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/api-tokens/${id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(204);

      // Verify it's revoked in DB
      const [row] = await sql`SELECT revoked_at FROM api_tokens WHERE id = ${id}`;
      expect(row?.revoked_at).toBeTruthy();
    });

    it('returns 404 for non-existent token', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/api-tokens/non-existent-id',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 when revoking already revoked token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Double Revoke' },
      });
      const { id } = JSON.parse(createRes.body);

      await app.inject({
        method: 'DELETE',
        url: `/api/api-tokens/${id}`,
        headers: authHeaders(),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/api-tokens/${id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(409);
    });

    it('creates audit log entry on revoke', async () => {
      await sql`DELETE FROM audit_log`;
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Audit Revoke' },
      });
      const { id } = JSON.parse(createRes.body);

      await app.inject({
        method: 'DELETE',
        url: `/api/api-tokens/${id}`,
        headers: authHeaders(),
      });

      const rows = await sql`SELECT * FROM audit_log WHERE action = 'api_token_revoked'`;
      expect(rows.length).toBe(1);
    });
  });

  // ── Token Auth Middleware ──────────────────────────────────

  describe('API Token Authentication', () => {
    it('valid token grants access to integration endpoints', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Integration Token' },
      });
      const { token } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('containers_total');
      expect(body).toHaveProperty('agents_online');
    });

    it('X-WW-Token header works as fallback', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'X-WW Token' },
      });
      const { token } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { 'x-ww-token': token },
      });
      expect(res.statusCode).toBe(200);
    });

    it('missing token returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('API token required');
    });

    it('invalid token returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: {
          authorization:
            'Bearer ww_0000000000000000000000000000000000000000000000000000000000000000000',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Invalid API token');
    });

    it('short token returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: 'Bearer short' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('revoked token returns 401', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Will Revoke' },
      });
      const { id, token } = JSON.parse(createRes.body);

      // Revoke it
      await app.inject({
        method: 'DELETE',
        url: `/api/api-tokens/${id}`,
        headers: authHeaders(),
      });

      // Try to use it
      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('expired token returns 401', async () => {
      // Create token then manually set expires_at to the past
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Expired Token' },
      });
      const { id, token } = JSON.parse(createRes.body);

      await sql`UPDATE api_tokens SET expires_at = ${Date.now() - 60000} WHERE id = ${id}`;

      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('updates last_used_at on successful auth', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Usage Track' },
      });
      const { id, token } = JSON.parse(createRes.body);

      // Verify last_used_at is null initially
      const [before] = await sql`SELECT last_used_at FROM api_tokens WHERE id = ${id}`;
      expect(before?.last_used_at).toBeNull();

      await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });

      // Give the background update a moment
      await new Promise((r) => setTimeout(r, 100));

      const [after] = await sql`SELECT last_used_at FROM api_tokens WHERE id = ${id}`;
      expect(Number(after?.last_used_at)).toBeGreaterThan(0);
    });
  });

  // ── Scope Enforcement ─────────────────────────────────────

  describe('Scope Enforcement', () => {
    it('read-only token can access GET endpoints', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Read Only', scopes: ['read'] },
      });
      const { token } = JSON.parse(createRes.body);

      const summaryRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(summaryRes.statusCode).toBe(200);

      const containersRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/containers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(containersRes.statusCode).toBe(200);
    });

    it('read-only token cannot access POST endpoints', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Read Only Blocked', scopes: ['read'] },
      });
      const { token } = JSON.parse(createRes.body);

      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/integrations/watchwarden/containers/check',
        headers: { authorization: `Bearer ${token}` },
        payload: { all: true },
      });
      expect(checkRes.statusCode).toBe(403);
      expect(JSON.parse(checkRes.body).error).toBe('Insufficient scope');
    });

    it('full scope grants access to everything', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Full Access' },
      });
      const { token } = JSON.parse(createRes.body);

      const summaryRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(summaryRes.statusCode).toBe(200);

      // POST should work with full scope (even if no agents are online)
      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/integrations/watchwarden/containers/check',
        headers: { authorization: `Bearer ${token}` },
        payload: { all: true },
      });
      expect(checkRes.statusCode).toBe(202);
    });

    it('write-only token cannot access GET endpoints', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Write Only', scopes: ['write'] },
      });
      const { token } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'GET',
        url: '/api/integrations/watchwarden/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Integration Endpoints ─────────────────────────────────

  describe('Integration API', () => {
    let apiToken: string;

    beforeEach(async () => {
      // Re-seed JWT config for getAuthToken
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('testpassword', 10);
      await setConfig('admin_password_hash', hash);
      await setConfig('jwt_secret', 'test-jwt-secret');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/api-tokens',
        headers: authHeaders(),
        payload: { name: 'Integration Test' },
      });
      apiToken = JSON.parse(createRes.body).token;
    });

    const apiHeaders = () => ({ authorization: `Bearer ${apiToken}` });

    describe('GET /api/integrations/watchwarden/summary', () => {
      it('returns summary with correct shape', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/integrations/watchwarden/summary',
          headers: apiHeaders(),
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body.containers_total).toBe('number');
        expect(typeof body.containers_with_updates).toBe('number');
        expect(typeof body.unhealthy_containers).toBe('number');
        expect(typeof body.agents_online).toBe('number');
        expect(typeof body.agents_total).toBe('number');
        expect(body.last_check === null || typeof body.last_check === 'string').toBe(true);
      });
    });

    describe('GET /api/integrations/watchwarden/containers', () => {
      it('returns empty array when no containers', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/integrations/watchwarden/containers',
          headers: apiHeaders(),
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
      });

      it('returns empty for non-existent agent_id filter', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/integrations/watchwarden/containers?agent_id=nonexistent',
          headers: apiHeaders(),
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
      });
    });

    describe('POST /api/integrations/watchwarden/containers/check', () => {
      it('check all returns 202', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/check',
          headers: apiHeaders(),
          payload: { all: true },
        });
        expect(res.statusCode).toBe(202);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('agents_checked');
        expect(body.agents_checked).toBe(0); // No online agents in test
      });

      it('check with empty body checks all', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/check',
          headers: apiHeaders(),
          payload: {},
        });
        expect(res.statusCode).toBe(202);
      });

      it('check with container_ids returns 202', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/check',
          headers: apiHeaders(),
          payload: { container_ids: ['nonexistent-container'] },
        });
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body).agents_checked).toBe(0);
      });
    });

    describe('POST /api/integrations/watchwarden/containers/update', () => {
      it('returns 400 without container_ids', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/update',
          headers: apiHeaders(),
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 202 with container_ids', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/update',
          headers: apiHeaders(),
          payload: { container_ids: ['some-container'] },
        });
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body).agents_updated).toBe(0);
      });
    });

    describe('POST /api/integrations/watchwarden/containers/rollback', () => {
      it('returns 400 without container_ids', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/rollback',
          headers: apiHeaders(),
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 202 with container_ids', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/integrations/watchwarden/containers/rollback',
          headers: apiHeaders(),
          payload: { container_ids: ['some-container'] },
        });
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body).containers_queued).toBe(0);
      });
    });

    describe('JWT auth does NOT work on integration routes', () => {
      it('JWT token on integration endpoint returns 401', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/integrations/watchwarden/summary',
          headers: authHeaders(), // JWT, not API token
        });
        // JWT is too short to pass the length check, or hash won't match
        expect(res.statusCode).toBe(401);
      });
    });
  });
});
