import fastifyWebsocket from '@fastify/websocket';
import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { getAgent, insertAgent, setConfig } from '../../db/queries.js';
import { AgentHub } from '../hub.js';

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.on('close', (code) => resolve({ code }));
  });
}

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

describe('AgentHub', () => {
  let app: FastifyInstance;
  let hub: AgentHub;
  let port: number;
  let agentToken: string;

  beforeAll(async () => {
    await startPostgres();

    agentToken = 'test-agent-token-123';
    const tokenHash = await bcrypt.hash(agentToken, 10);

    await insertAgent({
      id: 'hub-agent-1',
      name: 'Hub Agent',
      hostname: 'server-1',
      token_hash: tokenHash,
    });

    await setConfig('jwt_secret', 'test-jwt-secret');

    hub = new AgentHub();

    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);

    app.get('/ws/agent', { websocket: true }, (socket) => {
      hub.handleConnection(socket);
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(address).port, 10);
  }, 60000);

  afterAll(async () => {
    hub.dispose();
    await app.close();
    await stopPostgres();
  });

  function connectAgent(): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
  }

  it('agent REGISTER with valid token sets status to online', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: {
          token: agentToken,
          hostname: 'server-1',
          containers: [],
        },
      }),
    );

    // Wait a bit for the hub to process
    await new Promise((r) => setTimeout(r, 200));

    const agent = await getAgent('hub-agent-1');
    expect(agent?.status).toBe('online');

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('agent REGISTER with invalid token closes socket with code 4001', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    const closePromise = waitForClose(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: {
          token: 'wrong-token',
          hostname: 'server-1',
          containers: [],
        },
      }),
    );

    const { code } = await closePromise;
    expect(code).toBe(4001);
  });

  it('agent sends non-REGISTER first message closes socket', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    const closePromise = waitForClose(ws);

    ws.send(JSON.stringify({ type: 'HEARTBEAT', payload: { containers: [] } }));

    const { code } = await closePromise;
    expect(code).toBe(4002);
  });

  it('registered agent HEARTBEAT updates last_seen', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const before = (await getAgent('hub-agent-1'))?.last_seen ?? 0;

    await new Promise((r) => setTimeout(r, 50));

    ws.send(
      JSON.stringify({
        type: 'HEARTBEAT',
        payload: {
          containers: [
            {
              id: 'c-hb-1',
              docker_id: 'd-1',
              name: 'nginx',
              image: 'nginx:latest',
              current_digest: null,
              status: 'running',
            },
          ],
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const after = (await getAgent('hub-agent-1'))?.last_seen ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('agent disconnect sets status to offline', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    ws.close();
    await new Promise((r) => setTimeout(r, 200));

    const agent = await getAgent('hub-agent-1');
    expect(agent?.status).toBe('offline');
  });

  it('sendToAgent delivers message to connected agent', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const msgPromise = waitForMessage(ws);
    const sent = hub.sendToAgent('hub-agent-1', { type: 'CHECK', payload: {} });
    expect(sent).toBe(true);

    const msg = await msgPromise;
    expect(msg.type).toBe('CHECK');

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('sendToAgent for offline agent returns false', () => {
    const result = hub.sendToAgent('nonexistent-agent', {
      type: 'CHECK',
      payload: {},
    });
    expect(result).toBe(false);
  });

  // BUG-01 regression: reconnect clears stale autoUpdateInFlight
  it('reconnect clears stale autoUpdateInFlight entry', async () => {
    // Connect first socket
    const ws1 = connectAgent();
    await waitForOpen(ws1);
    ws1.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (hub.getOnlineAgentIds().length > 0) break;
    }

    // Simulate autoUpdateInFlight being set (as if CHECK_RESULT triggered auto-update)
    // Access private field for testing — this is a regression test, not a unit test
    (hub as unknown as { autoUpdateInFlight: Set<string> }).autoUpdateInFlight.add('hub-agent-1');

    // Reconnect with a second socket (simulates agent crash + reconnect)
    const ws2 = connectAgent();
    await waitForOpen(ws2);
    ws2.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    // Wait for registration to complete
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (hub.getOnlineAgentIds().length > 0) break;
    }

    // Verify the stale entry was cleared on reconnect
    const inFlight = (hub as unknown as { autoUpdateInFlight: Set<string> }).autoUpdateInFlight;
    expect(inFlight.has('hub-agent-1')).toBe(false);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  // BUG-02 regression: handler error does not create infinite microtask loop
  it('message handler error does not crash the queue chain', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (hub.getOnlineAgentIds().length > 0) break;
    }

    // Send a message with a type that will cause the handler to throw
    // (invalid payload for a known type triggers an error deep in processing)
    ws.send(
      JSON.stringify({
        type: 'CHECK_RESULT',
        payload: null, // null payload will cause "Cannot read properties of null"
      }),
    );

    // Wait briefly — if BUG-02 exists, the event loop would be dead by now
    await new Promise((r) => setTimeout(r, 500));

    // Send a valid heartbeat — if the queue is working, this should succeed
    ws.send(
      JSON.stringify({
        type: 'HEARTBEAT',
        payload: { containers: [] },
      }),
    );

    // Wait for processing
    await new Promise((r) => setTimeout(r, 500));

    // Agent should still be online (queue recovered from the error)
    const agent = await getAgent('hub-agent-1');
    expect(agent?.status).toBe('online');

    ws.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('getOnlineAgentIds returns connected agents', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    // Wait with retry — registration involves async DB writes that can
    // take longer under parallel test load.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (hub.getOnlineAgentIds().length > 0) break;
    }

    const ids = hub.getOnlineAgentIds();
    expect(ids).toContain('hub-agent-1');

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  // BUG-09 regression: pendingRequests cleaned on disconnect
  it('disconnect clears pending sendAndWait requests', async () => {
    const ws = connectAgent();
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: { token: agentToken, hostname: 'server-1', containers: [] },
      }),
    );
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (hub.getOnlineAgentIds().length > 0) break;
    }

    // Create a pending request (will time out after 15s normally)
    const pendingPromise = hub
      .sendAndWait('hub-agent-1', {
        type: 'CONTAINER_LOGS',
        payload: { containerId: 'test-c', tail: 100 },
      })
      .catch((err: Error) => err.message);

    // Verify a request is pending
    const pendingMap = (hub as unknown as { pendingRequests: Map<string, unknown> })
      .pendingRequests;
    expect(pendingMap.size).toBeGreaterThan(0);

    // Disconnect — should immediately reject and clear pendingRequests
    ws.close();
    const result = await pendingPromise;
    expect(result).toContain('disconnected');

    // Map should be empty after disconnect cleanup
    await new Promise((r) => setTimeout(r, 300));
    expect(pendingMap.size).toBe(0);
  });
});
