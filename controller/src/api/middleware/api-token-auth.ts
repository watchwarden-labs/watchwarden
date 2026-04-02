import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { listApiTokensByPrefix, touchApiTokenLastUsed } from '../../db/queries.js';
import type { ApiToken } from '../../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiToken?: ApiToken;
  }
}

/**
 * Hash a raw API token with SHA-256 for comparison against stored hashes.
 * We use SHA-256 (not bcrypt) because API tokens are high-entropy random
 * strings — no need for slow hashing. The prefix speeds up lookup so we
 * don't hash-compare every token row.
 */
export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time comparison of two hex-encoded hashes. */
function safeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Middleware that authenticates requests via API token.
 *
 * Looks for:
 *   1. Authorization: Bearer <token>
 *   2. X-WW-Token: <token>
 *
 * Does NOT interfere with existing JWT-based UI auth.
 */
export async function requireApiToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = extractApiToken(request);
  if (!raw) {
    reply.code(401).send({ error: 'API token required' });
    return;
  }

  if (raw.length < 32) {
    reply.code(401).send({ error: 'Invalid API token' });
    return;
  }

  const prefix = raw.slice(0, 8);
  const candidates = await listApiTokensByPrefix(prefix);
  if (candidates.length === 0) {
    reply.code(401).send({ error: 'Invalid API token' });
    return;
  }

  const hash = hashApiToken(raw);
  const match = candidates.find((t) => safeHashEqual(t.token_hash, hash));
  if (!match) {
    reply.code(401).send({ error: 'Invalid API token' });
    return;
  }

  // Double-check revocation (belt-and-suspenders against race conditions)
  if (match.revoked_at) {
    reply.code(401).send({ error: 'Invalid API token' });
    return;
  }

  // Check expiration
  if (match.expires_at && match.expires_at < Date.now()) {
    reply.code(401).send({ error: 'Invalid API token' });
    return;
  }

  request.apiToken = match;

  // Update last_used_at in background — don't block the request
  touchApiTokenLastUsed(match.id).catch(() => {});
}

/**
 * Scope-checking middleware factory.
 * Usage: fastify.addHook('preHandler', requireScope('read'));
 */
export function requireScope(
  ...required: string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const token = request.apiToken;
    if (!token) {
      reply.code(401).send({ error: 'API token required' });
      return;
    }
    const scopes: string[] = JSON.parse(token.scopes);
    // 'full' scope grants everything
    if (scopes.includes('full')) return;
    const hasRequired = required.some((s) => scopes.includes(s));
    if (!hasRequired) {
      reply.code(403).send({ error: 'Insufficient scope' });
    }
  };
}

function extractApiToken(request: FastifyRequest): string | null {
  // 1. Authorization: Bearer <token>
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  // 2. X-WW-Token header
  const wwToken = request.headers['x-ww-token'];
  if (typeof wwToken === 'string' && wwToken.length > 0) {
    return wwToken;
  }
  return null;
}
