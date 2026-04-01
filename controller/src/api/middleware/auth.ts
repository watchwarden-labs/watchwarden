import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { getConfig } from '../../db/queries.js';

// extractToken reads from httpOnly cookie first, then falls back to
// Authorization: Bearer header (kept for API clients / backward compat).
export function extractToken(request: FastifyRequest): string | null {
  const cookie = (request.cookies as Record<string, string | undefined>)?.ww_token;
  if (cookie) return cookie;
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    reply.code(401).send({ error: 'Missing token' });
    return;
  }

  try {
    const secret = await getConfig('jwt_secret');
    if (!secret) {
      reply.code(500).send({ error: 'Internal server error' });
      return;
    }
    // FIX-4.3: validate claims, not just signature — ensures tokens without
    // the correct role claim are rejected even if the signature is valid.
    const decoded = jwt.verify(token, secret) as { role?: string };
    if (decoded.role !== 'admin') {
      reply.code(401).send({ error: 'Invalid token' });
      return;
    }
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
  }
}
