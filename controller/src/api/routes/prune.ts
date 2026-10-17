import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { PruneError, type PruneService, parsePruneOptions } from '../../ws/prune-service.js';
import { requireAuth } from '../middleware/auth.js';

const pruneRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  const service = (fastify as unknown as { pruneService: PruneService }).pruneService;
  fastify.addHook('preHandler', requireAuth);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof PruneError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    throw error;
  });

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/agents/:id/prune',
    async (request, reply) => {
      const opts = parsePruneOptions(request.body);
      await service.startPrune(request.params.id, opts);
      return reply.code(202).send({ message: opts.dryRun ? 'Dry run started' : 'Prune started' });
    },
  );

  fastify.get<{
    Params: { id: string };
    Querystring: { keepPrevious?: string; includeStopped?: string };
  }>('/api/agents/:id/prune/preview', async (request) => {
    const { keepPrevious, includeStopped } = request.query;
    const opts = parsePruneOptions({
      keepPrevious: keepPrevious === undefined ? undefined : Number(keepPrevious),
      includeStopped: includeStopped === undefined ? undefined : includeStopped === 'true',
    });
    return service.preview(request.params.id, opts);
  });

  fastify.post<{ Body: unknown }>('/api/prune', async (request, reply) => {
    const opts = parsePruneOptions(request.body);
    const run = await service.startRun(opts);
    return reply.code(202).send(run);
  });

  fastify.get('/api/prune/current', async () => ({ run: service.getRun() }));
};

export default pruneRoutes;
