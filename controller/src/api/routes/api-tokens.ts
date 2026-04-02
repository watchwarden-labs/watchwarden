import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  getApiToken,
  insertApiToken,
  insertAuditLog,
  listApiTokens,
  revokeApiToken,
} from '../../db/queries.js';
import { hashApiToken } from '../middleware/api-token-auth.js';
import { requireAuth } from '../middleware/auth.js';

const VALID_SCOPES = ['full', 'read', 'write'];
const MAX_TOKEN_NAME_LENGTH = 128;

const apiTokenRoutes: FastifyPluginAsync = async (fastify) => {
  // All token management routes require UI admin auth (JWT)
  fastify.addHook('preHandler', requireAuth);

  // List all tokens (never returns hashes, prefixes, or plaintext)
  fastify.get('/api/api-tokens', async () => {
    const tokens = await listApiTokens();
    return tokens.map(({ token_hash: _, token_prefix: _p, ...safe }) => safe);
  });

  // Create a new token — returns plaintext ONCE
  fastify.post<{
    Body: { name: string; scopes?: string[]; expires_in_days?: number };
  }>('/api/api-tokens', async (request, reply) => {
    const { name, scopes, expires_in_days } = request.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (name.trim().length > MAX_TOKEN_NAME_LENGTH) {
      return reply
        .code(400)
        .send({ error: `name must be ${MAX_TOKEN_NAME_LENGTH} characters or less` });
    }

    // Validate scopes
    const resolvedScopes = scopes ?? ['full'];
    if (
      !Array.isArray(resolvedScopes) ||
      resolvedScopes.length === 0 ||
      !resolvedScopes.every((s) => VALID_SCOPES.includes(s))
    ) {
      return reply
        .code(400)
        .send({ error: `Invalid scopes. Valid values: ${VALID_SCOPES.join(', ')}` });
    }

    const id = uuidv4();
    const rawToken = `ww_${randomBytes(32).toString('hex')}`;
    const tokenHash = hashApiToken(rawToken);
    const tokenPrefix = rawToken.slice(0, 8);
    const scopeStr = JSON.stringify(resolvedScopes);

    // Compute optional expiration
    let expiresAt: number | null = null;
    if (expires_in_days && typeof expires_in_days === 'number' && expires_in_days > 0) {
      expiresAt = Date.now() + expires_in_days * 24 * 60 * 60 * 1000;
    }

    await insertApiToken({
      id,
      name: name.trim(),
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: scopeStr,
      expires_at: expiresAt,
    });

    // Audit log
    await insertAuditLog({
      actor: 'admin',
      action: 'api_token_created',
      targetType: 'api_token',
      targetId: id,
      details: { name: name.trim(), scopes: resolvedScopes },
      ipAddress: request.ip,
    });

    return reply.code(201).send({
      id,
      name: name.trim(),
      token: rawToken,
      scopes: resolvedScopes,
      expires_at: expiresAt,
      created_at: Date.now(),
    });
  });

  // Revoke a token
  fastify.delete<{ Params: { id: string } }>('/api/api-tokens/:id', async (request, reply) => {
    const token = await getApiToken(request.params.id);
    if (!token) {
      return reply.code(404).send({ error: 'Token not found' });
    }
    if (token.revoked_at) {
      return reply.code(409).send({ error: 'Token already revoked' });
    }
    await revokeApiToken(request.params.id);

    // Audit log
    await insertAuditLog({
      actor: 'admin',
      action: 'api_token_revoked',
      targetType: 'api_token',
      targetId: request.params.id,
      details: { name: token.name },
      ipAddress: request.ip,
    });

    return reply.code(204).send();
  });
};

export default apiTokenRoutes;
