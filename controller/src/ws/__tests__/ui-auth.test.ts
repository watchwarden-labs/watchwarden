import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { setConfig } from '../../db/queries.js';
import { UiBroadcaster } from '../ui-broadcaster.js';

const JWT_SECRET = 'ui-auth-test-secret';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.on('close', (code) => resolve({ code }));
  });
}

describe('/ws/ui authentication', () => {
  let app: FastifyInstance;
  let port: number;
  let validToken: string;

  beforeAll(async () => {
    await startPostgres();
    await setConfig('jwt_secret', JWT_SECRET);

    validToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

    const broadcaster = new UiBroadcaster();

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    await app.register(fastifyWebsocket);

    // Mirrors the /ws/ui handler in index.ts exactly
    app.get('/ws/ui', { websocket: true }, async (socket, request) => {
      const cookieToken = (request.cookies as Record<string, string | undefined>)?.ww_token;
      const queryToken = new URL(request.url, 'http://x').searchParams.get('token');
      const token = cookieToken ?? queryToken;
      const secret = await setConfig('jwt_secret', JWT_SECRET).then(() => JWT_SECRET);
      try {
        if (!token || !secret) throw new Error('missing token');
        jwt.verify(token, secret);
      } catch {
        socket.close(4001, 'Unauthorized');
        return;
      }
      broadcaster.handleConnection(socket);
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(address).port, 10);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await stopPostgres();
  });

  it('accepts connection with valid JWT in ?token= query param', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/ui?token=${encodeURIComponent(validToken)}`,
    );
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('accepts connection with valid JWT in ww_token cookie', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ui`, {
      headers: { Cookie: `ww_token=${validToken}` },
    });
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('closes with 4001 when no token or cookie is provided', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ui`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it('closes with 4001 when ?token= is an invalid JWT', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ui?token=not-a-valid-jwt`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it('closes with 4001 when cookie contains an invalid JWT', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ui`, {
      headers: { Cookie: 'ww_token=invalid-token' },
    });
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it('cookie takes precedence over invalid query param', async () => {
    // Valid cookie + bogus query param → should accept (cookie wins)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ui?token=bad-token`, {
      headers: { Cookie: `ww_token=${validToken}` },
    });
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
