import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import jwt from 'jsonwebtoken';
import { getConfig, insertAuditLog, setConfig } from '../../db/queries.js';
import { log } from '../../lib/logger.js';
import { extractToken, requireAuth } from '../middleware/auth.js';

const COOKIE_NAME = 'ww_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 2 * 60 * 60, // 2 hours in seconds
};

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { password?: string } }>(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            error: 'Too many login attempts, try again later',
          }),
        },
      },
    },
    async (request, reply) => {
      const { password } = request.body ?? {};

      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      const storedHash = await getConfig('admin_password_hash');
      if (!storedHash) {
        return reply.code(401).send({ error: 'Admin password not configured' });
      }

      const valid = await bcrypt.compare(password, storedHash);
      if (!valid) {
        // FIX-6.3: audit failed login attempts for forensics/compliance.
        const ip = request.ip;
        insertAuditLog({
          actor: 'anonymous',
          action: 'login_failed',
          targetType: 'auth',
          details: { ip },
        }).catch((err) => log.warn('auth', `audit log for failed login: ${err}`));
        return reply.code(401).send({ error: 'Invalid password' });
      }

      const secret = await getConfig('jwt_secret');
      if (!secret) {
        return reply.code(500).send({ error: 'Internal server error' });
      }

      const token = jwt.sign({ role: 'admin' }, secret, { expiresIn: '2h' });

      // Set httpOnly cookie — token is NOT returned in the body
      // to prevent JavaScript access (XSS protection).
      reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);
      return { ok: true };
    },
  );

  // GET /api/auth/me — returns 200 if the current cookie/token is valid
  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (_request, _reply) => {
    return { authenticated: true };
  });

  // PUT /api/auth/password — change admin password (requires auth)
  fastify.put<{ Body: { password: string } }>(
    '/api/auth/password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { password } = request.body;
      if (!password || password.length < 8) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters' });
      }
      const currentHash = await getConfig('admin_password_hash');
      if (currentHash && (await bcrypt.compare(password, currentHash))) {
        return reply.code(400).send({
          error: 'New password must be different from the current one',
        });
      }
      const hash = bcrypt.hashSync(password, 10);
      await setConfig('admin_password_hash', hash);
      return { ok: true };
    },
  );

  // POST /api/auth/logout — clears the session cookie
  fastify.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // POST /api/auth/refresh — issues a new token given a valid unexpired one
  fastify.post(
    '/api/auth/refresh',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            error: 'Too many refresh attempts, try again later',
          }),
        },
      },
    },
    async (request, reply) => {
      const oldToken = extractToken(request);
      if (!oldToken) {
        return reply.code(401).send({ error: 'Missing or invalid token' });
      }

      const secret = await getConfig('jwt_secret');
      if (!secret) {
        return reply.code(500).send({ error: 'Internal server error' });
      }

      try {
        // FIX-4.4: verify signature AND expiry — reject expired tokens to
        // prevent indefinite token revival from leaked/stolen tokens.
        const decoded = jwt.verify(oldToken, secret) as { role?: string };
        if (decoded.role !== 'admin') {
          return reply.code(401).send({ error: 'Token is invalid or expired' });
        }
      } catch {
        return reply.code(401).send({ error: 'Token is invalid or expired' });
      }

      const token = jwt.sign({ role: 'admin' }, secret, { expiresIn: '2h' });
      reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);
      return { ok: true };
    },
  );
};

export default authRoutes;
