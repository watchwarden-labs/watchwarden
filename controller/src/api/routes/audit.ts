import type { FastifyPluginAsync } from 'fastify';
import { listAuditLogs } from '../../db/queries.js';
import { requireAuth } from '../middleware/auth.js';

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get<{
    Querystring: {
      actor?: string;
      action?: string;
      targetType?: string;
      agentId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/audit', async (request) => {
    const { actor, action, targetType, agentId, limit, offset } = request.query;
    return await listAuditLogs({
      actor,
      action,
      targetType,
      agentId,
      limit: Math.min(limit ? parseInt(limit, 10) : 50, 200),
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  });
};

export default auditRoutes;
