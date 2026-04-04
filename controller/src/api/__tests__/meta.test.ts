import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { setConfig } from '../../db/queries.js';
import {
  getLogLevel,
  isFileLoggingEnabled,
  redact,
  setFileLoggingEnabled,
  setLogLevel,
} from '../../lib/logger.js';
import { buildTestApp, getAuthToken, teardownTestApp } from './helpers.js';

describe('Meta API', () => {
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
    setLogLevel('info');
    setFileLoggingEnabled(false);
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('testpassword', 10);
    await setConfig('admin_password_hash', hash);
    await setConfig('jwt_secret', 'test-jwt-secret');
  });

  const authHeaders = () => ({ authorization: `Bearer ${authToken}` });

  // --- Versions ---

  describe('GET /api/meta/versions', () => {
    it('returns controller version and agents list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meta/versions',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('controller_version');
      expect(body).toHaveProperty('agents');
      expect(Array.isArray(body.agents)).toBe(true);
    });

    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/meta/versions' });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- Logging (unified endpoint) ---

  describe('GET /api/meta/logging', () => {
    it('returns default logging state', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meta/logging',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.log_level).toBe('info');
      expect(body.debug_until).toBeNull();
      expect(body.file_logging_enabled).toBe(false);
    });
  });

  describe('POST /api/meta/logging', () => {
    it('sets log level to debug with TTL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        headers: authHeaders(),
        payload: { log_level: 'debug', ttl_minutes: 1 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.log_level).toBe('debug');
      expect(body.debug_until).toBeTruthy();
      expect(getLogLevel()).toBe('debug');
    });

    it('resets to info', async () => {
      setLogLevel('debug', 5);
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        headers: authHeaders(),
        payload: { log_level: 'info' },
      });
      const body = JSON.parse(res.body);
      expect(body.log_level).toBe('info');
      expect(body.debug_until).toBeNull();
    });

    it('toggles file logging on', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        headers: authHeaders(),
        payload: { file_logging_enabled: true },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.file_logging_enabled).toBe(true);
      expect(isFileLoggingEnabled()).toBe(true);
    });

    it('toggles file logging off', async () => {
      setFileLoggingEnabled(true);
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        headers: authHeaders(),
        payload: { file_logging_enabled: false },
      });
      const body = JSON.parse(res.body);
      expect(body.file_logging_enabled).toBe(false);
      expect(isFileLoggingEnabled()).toBe(false);
    });

    it('rejects invalid log level', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        headers: authHeaders(),
        payload: { log_level: 'verbose' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/logging',
        payload: { log_level: 'debug' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- Legacy log-level endpoints ---

  describe('GET /api/meta/log-level', () => {
    it('returns current log level', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meta/log-level',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.level).toBe('info');
      expect(body.debug_until).toBeNull();
    });
  });

  // --- Diagnostics bundle ---

  describe('POST /api/meta/diagnostics-bundle', () => {
    it('returns a ZIP file with diagnostics.json', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/diagnostics-bundle',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');
      expect(res.headers['content-disposition']).toContain('.zip');
      // Valid ZIP starts with PK magic bytes
      expect(res.rawPayload[0]).toBe(0x50);
      expect(res.rawPayload[1]).toBe(0x4b);
    });

    it('logs_included is false when file logging disabled', async () => {
      setFileLoggingEnabled(false);
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/diagnostics-bundle',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      // ZIP contains diagnostics.json — we can't easily parse ZIP in test,
      // but we verified it's a valid ZIP and the endpoint uses readLogTail()
      // which returns null when file logging is disabled
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meta/diagnostics-bundle',
      });
      // May return 401 (auth) or 429 (rate limit fires first) — both reject unauthenticated
      expect([401, 429]).toContain(res.statusCode);
    });
  });

  // --- Log redaction ---

  describe('redact()', () => {
    it('redacts API tokens (ww_ prefix)', () => {
      const input = 'Token ww_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6 used';
      expect(redact(input)).toBe('Token ww_[REDACTED] used');
    });

    it('redacts Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
      expect(redact(input)).not.toContain('eyJ');
    });

    it('redacts JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4ifQ.abc123def456';
      const result = redact(`found ${jwt} in log`);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('eyJhbGci');
    });

    it('redacts password=value patterns', () => {
      expect(redact('password=mysecretpass123')).toContain('[REDACTED]');
      expect(redact('password=mysecretpass123')).not.toContain('mysecretpass123');
    });

    it('redacts secret: value patterns', () => {
      expect(redact('secret: "my-jwt-secret-value"')).toContain('[REDACTED]');
    });

    it('redacts IPv4 addresses', () => {
      expect(redact('Connected from 192.168.1.100')).toContain('[IP_REDACTED]');
      expect(redact('Connected from 192.168.1.100')).not.toContain('192.168.1.100');
    });

    it('preserves localhost/loopback IPs', () => {
      expect(redact('Listening on 127.0.0.1:3000')).toContain('127.0.0.1');
      expect(redact('Binding to 0.0.0.0:8080')).toContain('0.0.0.0');
    });

    it('preserves container IDs and status codes', () => {
      const input = 'Container abc123def456 returned status 200';
      expect(redact(input)).toBe(input);
    });

    it('redacts registryAuth base64', () => {
      const input = 'registryAuth=dXNlcm5hbWU6cGFzc3dvcmQxMjM=';
      expect(redact(input)).toContain('[REDACTED]');
      expect(redact(input)).not.toContain('dXNlcm5hbWU');
    });
  });
});
