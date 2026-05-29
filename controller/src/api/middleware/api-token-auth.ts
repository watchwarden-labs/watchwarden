import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getConfig,
  listApiTokensByPrefix,
  setConfig,
  touchApiTokenLastUsed,
} from '../../db/queries.js';
import type { ApiToken } from '../../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiToken?: ApiToken;
  }
}

/** Current token hash algorithm version stored in api_tokens.hash_version. */
export const CURRENT_HASH_VERSION = 1;

/** Module-level salt — set once at startup via initApiTokenSalt(). */
let apiTokenSalt: string | null = null;

/**
 * Must be called once during startup (after DB migrations) before any
 * request handling begins. Loads or generates the per-deployment PBKDF2
 * salt for API token hashing, eliminating the per-request DB round-trip
 * and the startup race condition.
 */
export async function initApiTokenSalt(): Promise<void> {
  let salt = await getConfig('api_token_salt');
  if (!salt) {
    salt = randomBytes(32).toString('hex');
    await setConfig('api_token_salt', salt);
  }
  apiTokenSalt = salt;
}

/** Returns the initialised salt. Throws if initApiTokenSalt() was not called. */
export function getApiTokenSalt(): string {
  if (!apiTokenSalt) {
    throw new Error('API token salt not initialised — call initApiTokenSalt() during startup');
  }
  return apiTokenSalt;
}

/**
 * Hash a raw API token with PBKDF2 for comparison against stored hashes.
 * PBKDF2 satisfies security scanners requiring computationally hard credential hashing.
 * We use 10,000 iterations and sha256 to produce a secure, 64-character hex hash.
 */
export function hashApiToken(raw: string, salt: string): string {
  return pbkdf2Sync(raw, salt, 10000, 32, 'sha256').toString('hex');
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

  const salt = getApiTokenSalt();
  const hash = hashApiToken(raw, salt);
  const match = candidates.find((t) => {
    // Reject tokens issued before the PBKDF2 migration (hash_version 0).
    // These hashes were computed with a different algorithm and will never match,
    // so we surface a clear actionable error rather than a silent auth failure.
    if (t.hash_version < CURRENT_HASH_VERSION) return false;
    return safeHashEqual(t.token_hash, hash);
  });

  if (!match) {
    // Check whether a candidate exists but has a legacy hash version, so we can
    // return a more helpful error message.
    const hasLegacy = candidates.some((t) => t.hash_version < CURRENT_HASH_VERSION);
    if (hasLegacy) {
      reply.code(401).send({
        error:
          'This API token was issued before a security upgrade and is no longer valid. Please revoke it and create a new one.',
      });
      return;
    }
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
