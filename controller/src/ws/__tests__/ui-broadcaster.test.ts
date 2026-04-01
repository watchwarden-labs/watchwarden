import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startPostgres, stopPostgres } from '../../__tests__/pg-setup.js';
import { UiBroadcaster } from '../ui-broadcaster.js';

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
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

describe('UiBroadcaster', () => {
  let app: FastifyInstance;
  let broadcaster: UiBroadcaster;
  let port: number;

  beforeAll(async () => {
    await startPostgres();

    broadcaster = new UiBroadcaster();

    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);

    app.get('/ws/ui', { websocket: true }, (socket) => {
      broadcaster.handleConnection(socket);
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(address).port, 10);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await stopPostgres();
  });

  function connectUi(): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/ws/ui`);
  }

  it('UI client is accepted on connect (no auth)', async () => {
    const ws = connectUi();
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('broadcast delivers to all connected clients', async () => {
    const ws1 = connectUi();
    const ws2 = connectUi();
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    const msg1Promise = waitForMessage(ws1);
    const msg2Promise = waitForMessage(ws2);

    broadcaster.broadcast({
      type: 'AGENT_STATUS',
      agentId: 'test',
      status: 'online',
    });

    const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);
    expect(msg1.type).toBe('AGENT_STATUS');
    expect(msg2.type).toBe('AGENT_STATUS');

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('disconnected client is removed without errors on broadcast', async () => {
    const ws = connectUi();
    await waitForOpen(ws);

    ws.close();
    await new Promise((r) => setTimeout(r, 200));

    expect(() =>
      broadcaster.broadcast({
        type: 'AGENT_STATUS',
        agentId: 'test',
        status: 'offline',
      }),
    ).not.toThrow();
  });

  it('size reflects connected clients', async () => {
    const before = broadcaster.size;
    const ws = connectUi();
    await waitForOpen(ws);

    expect(broadcaster.size).toBe(before + 1);

    ws.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  // --- SCALE-02 ---

  it('one client throwing on send does not prevent others from receiving', async () => {
    const ws1 = connectUi();
    const ws2 = connectUi();
    const ws3 = connectUi();
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2), waitForOpen(ws3)]);

    // Forcefully terminate ws2's underlying connection to simulate a broken client
    ws2.terminate();
    await new Promise((r) => setTimeout(r, 200));

    // Set up message promises for the two healthy clients
    const msg1Promise = waitForMessage(ws1);
    const msg3Promise = waitForMessage(ws3);

    broadcaster.broadcast({
      type: 'AGENT_STATUS',
      agentId: 'test',
      status: 'offline',
    });

    const [msg1, msg3] = await Promise.all([msg1Promise, msg3Promise]);
    expect(msg1.type).toBe('AGENT_STATUS');
    expect(msg3.type).toBe('AGENT_STATUS');

    ws1.close();
    ws3.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  // --- BUG-04 regression ---

  it('all remaining clients receive events when one is removed mid-broadcast', async () => {
    // Connect 5 clients to increase the chance of a skip bug
    const clients: WebSocket[] = [];
    for (let i = 0; i < 5; i++) {
      clients.push(connectUi());
    }
    await Promise.all(clients.map(waitForOpen));

    // Terminate the middle client (index 2) to trigger deletion during broadcast
    clients[2]?.terminate();
    await new Promise((r) => setTimeout(r, 200));

    // Set up message promises for the 4 remaining healthy clients
    const healthy = [clients[0]!, clients[1]!, clients[3]!, clients[4]!];
    const promises = healthy.map(waitForMessage);

    broadcaster.broadcast({
      type: 'AGENT_STATUS',
      agentId: 'bug04-test',
      status: 'online',
    });

    const results = await Promise.all(promises);
    // BUG-04: before the fix, Array.from snapshot was not used, and deleting
    // the dead client mid-iteration could cause V8 to skip a subsequent client.
    // All 4 remaining clients must receive the event.
    for (const msg of results) {
      expect(msg.type).toBe('AGENT_STATUS');
      expect(msg.agentId).toBe('bug04-test');
    }

    for (const ws of clients) {
      ws.close();
    }
    await new Promise((r) => setTimeout(r, 200));
  });
});
