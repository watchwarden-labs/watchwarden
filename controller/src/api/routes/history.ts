import type { FastifyPluginAsync } from 'fastify';
import { getHistory, getHistoryStats } from '../../db/queries.js';
import { requireAuth } from '../middleware/auth.js';

const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get<{
    Querystring: {
      agentId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/history', async (request) => {
    const { agentId, status, limit, offset } = request.query;
    return await getHistory({
      agentId,
      status,
      limit: Math.min(limit ? parseInt(limit, 10) : 50, 200),
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  });

  fastify.get('/api/history/stats', async () => {
    return await getHistoryStats();
  });
};

export default historyRoutes;
