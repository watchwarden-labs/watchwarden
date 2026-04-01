import type { FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  deleteRegistryCredential,
  getRegistryCredential,
  insertRegistryCredential,
  listRegistryCredentials,
  updateRegistryCredential,
} from '../../db/queries.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import type { AgentHub } from '../../ws/hub.js';
import { requireAuth } from '../middleware/auth.js';

async function syncCredentialsToAgents(hub: AgentHub) {
  const creds = await listRegistryCredentials();
  const decrypted = creds.map((c) => ({
    registry: c.registry,
    username: c.username,
    password: decrypt(c.password_encrypted),
    auth_type: c.auth_type ?? 'basic',
  }));
  hub.broadcastToAllAgents({
    type: 'CREDENTIALS_SYNC',
    payload: { credentials: decrypted },
  });
}

const registriesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  const hub = (fastify as unknown as { hub: AgentHub }).hub;

  fastify.get('/api/registries', async () => {
    const creds = await listRegistryCredentials();
    return creds.map((c) => ({
      id: c.id,
      registry: c.registry,
      username: c.username,
      password: '••••••••',
      auth_type: c.auth_type ?? 'basic',
      created_at: c.created_at,
    }));
  });

  fastify.post<{
    Body: {
      registry: string;
      username: string;
      password: string;
      auth_type?: string;
    };
  }>('/api/registries', async (request, reply) => {
    const { registry, username, password, auth_type } = request.body;
    if (!registry || !username || !password) {
      return reply.code(400).send({ error: 'registry, username, and password are required' });
    }
    const authType = auth_type ?? 'basic';
    const id = uuidv4();
    const passwordEncrypted = encrypt(password);
    await insertRegistryCredential({
      id,
      registry,
      username,
      password_encrypted: passwordEncrypted,
      auth_type: authType,
    });
    await syncCredentialsToAgents(hub);
    return reply.code(201).send({ id, registry, username, auth_type: authType });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      registry?: string;
      username?: string;
      password?: string;
      auth_type?: string;
    };
  }>('/api/registries/:id', async (request, reply) => {
    const existing = await getRegistryCredential(request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: 'Registry credential not found' });
    }
    const { registry, username, password, auth_type } = request.body;
    await updateRegistryCredential(request.params.id, {
      registry,
      username,
      password_encrypted: password ? encrypt(password) : undefined,
      auth_type,
    });
    await syncCredentialsToAgents(hub);
    return { message: 'Updated' };
  });

  fastify.delete<{ Params: { id: string } }>('/api/registries/:id', async (request, reply) => {
    const existing = await getRegistryCredential(request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: 'Registry credential not found' });
    }
    await deleteRegistryCredential(request.params.id);
    await syncCredentialsToAgents(hub);
    return reply.code(204).send();
  });
};

export default registriesRoutes;
