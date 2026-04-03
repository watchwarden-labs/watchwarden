import type { FastifyPluginAsync } from 'fastify';
import {
  countContainers,
  getAgent,
  getContainersByAgent,
  getLastCheckTime,
  listAgents,
  listAllContainersWithAgent,
} from '../../db/queries.js';
import { expectCheckResults } from '../../notifications/session-batcher.js';
import type { IntegrationContainer, IntegrationSummary } from '../../types.js';
import type { AgentHub } from '../../ws/hub.js';
import { requireApiToken, requireScope } from '../middleware/api-token-auth.js';

const integrationRoutes: FastifyPluginAsync = async (fastify) => {
  const hub = (fastify as unknown as { hub: AgentHub }).hub;
  fastify.addHook('preHandler', requireApiToken);

  // Rate limit: 60 requests/min per IP for all integration endpoints
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.config = {
      ...(routeOptions.config as Record<string, unknown>),
      rateLimit: { max: 60, timeWindow: '1 minute' },
    };
  });

  // --- Summary ---
  fastify.get(
    '/api/integrations/watchwarden/summary',
    { preHandler: requireScope('read') },
    async (): Promise<IntegrationSummary> => {
      const [counts, lastCheck, agents] = await Promise.all([
        countContainers(),
        getLastCheckTime(),
        listAgents(),
      ]);
      return {
        containers_total: counts.total,
        containers_with_updates: counts.withUpdates,
        unhealthy_containers: counts.unhealthy,
        agents_online: agents.filter((a) => a.status === 'online').length,
        agents_total: agents.length,
        last_check: lastCheck ? new Date(lastCheck).toISOString() : null,
      };
    },
  );

  // --- List containers ---
  fastify.get<{ Querystring: { agent_id?: string } }>(
    '/api/integrations/watchwarden/containers',
    { preHandler: requireScope('read') },
    async (request): Promise<IntegrationContainer[]> => {
      const agentId = request.query.agent_id;

      if (agentId) {
        const agent = await getAgent(agentId);
        if (!agent) return [];
        const containers = await getContainersByAgent(agentId);
        return containers.map((c) => toIntegrationContainer(c, agent.name));
      }

      const rows = await listAllContainersWithAgent();
      return rows.map((r) => toIntegrationContainer(r, r.agent_name));
    },
  );

  // --- Check containers ---
  fastify.post<{ Body: { container_ids?: string[]; all?: boolean } }>(
    '/api/integrations/watchwarden/containers/check',
    { preHandler: requireScope('write') },
    async (request, reply) => {
      const { container_ids, all } = request.body ?? {};

      // Check all agents
      if (all || !container_ids?.length) {
        const agents = await listAgents();
        const onlineAgents = agents.filter((a) => a.status === 'online');
        let sent = 0;
        for (const agent of onlineAgents) {
          if (hub.sendToAgent(agent.id, { type: 'CHECK', payload: {} })) {
            sent++;
          }
        }
        if (sent > 0) expectCheckResults(sent);
        return reply.code(202).send({
          message: `Check initiated for ${sent} agent(s)`,
          agents_checked: sent,
        });
      }

      // Check specific containers — resolve which agents own them
      const agentMap = await resolveContainerAgents(container_ids);
      let sent = 0;
      for (const [agentId, containerIds] of agentMap) {
        if (hub.sendToAgent(agentId, { type: 'CHECK', payload: { containerIds } })) {
          sent++;
        }
      }
      if (sent > 0) expectCheckResults(sent);
      return reply.code(202).send({
        message: `Check initiated for ${container_ids.length} container(s) across ${sent} agent(s)`,
        agents_checked: sent,
        containers_queued: container_ids.length,
      });
    },
  );

  // --- Update containers ---
  fastify.post<{ Body: { container_ids: string[] } }>(
    '/api/integrations/watchwarden/containers/update',
    { preHandler: requireScope('write') },
    async (request, reply) => {
      const { container_ids } = request.body ?? {};
      if (!container_ids?.length) {
        return reply.code(400).send({ error: 'container_ids is required' });
      }

      const agentMap = await resolveContainerAgents(container_ids);
      let agentsSent = 0;
      for (const [agentId, containerIds] of agentMap) {
        const agent = await getAgent(agentId);
        if (!agent || agent.status !== 'online') continue;
        if (hub.isUpdateInFlight(agentId)) continue;
        hub.setUpdateInFlight(agentId, true);
        const { executeOrchestratedUpdate } = await import('../../scheduler/orchestrator.js');
        await executeOrchestratedUpdate(hub, agentId, containerIds, { strategy: 'stop-first' });
        agentsSent++;
      }
      return reply.code(202).send({
        message: `Update initiated for ${container_ids.length} container(s)`,
        agents_updated: agentsSent,
      });
    },
  );

  // --- Rollback containers ---
  fastify.post<{ Body: { container_ids: string[] } }>(
    '/api/integrations/watchwarden/containers/rollback',
    { preHandler: requireScope('write') },
    async (request, reply) => {
      const { container_ids } = request.body ?? {};
      if (!container_ids?.length) {
        return reply.code(400).send({ error: 'container_ids is required' });
      }

      let sent = 0;
      for (const containerId of container_ids) {
        // Find the container and its agent
        const allContainers = await listAllContainersWithAgent();
        const container = allContainers.find(
          (c) => c.docker_id === containerId || c.id === containerId,
        );
        if (!container) continue;

        const agent = await getAgent(container.agent_id);
        if (!agent || agent.status !== 'online') continue;

        hub.sendToAgent(agent.id, {
          type: 'ROLLBACK',
          payload: { containerId: container.docker_id, containerName: container.name },
        });
        sent++;
      }

      return reply.code(202).send({
        message: `Rollback initiated for ${sent} container(s)`,
        containers_queued: sent,
      });
    },
  );
};

// --- Helpers ---

function toIntegrationContainer(
  c: {
    id: string;
    agent_id: string;
    docker_id: string;
    name: string;
    image: string;
    current_digest: string | null;
    latest_digest: string | null;
    has_update: number;
    status: string;
    health_status: string;
    policy: string | null;
    tag_pattern: string | null;
    update_level: string | null;
    last_checked: number | null;
    last_updated: number | null;
  },
  agentName: string,
): IntegrationContainer {
  return {
    id: c.docker_id,
    stable_id: `${c.agent_id}_${c.name}`,
    agent_id: c.agent_id,
    agent_name: agentName,
    name: c.name,
    image: c.image,
    current_digest: c.current_digest,
    latest_digest: c.latest_digest,
    has_update: c.has_update === 1,
    status: c.status,
    health_status: c.health_status || 'unknown',
    policy: c.policy,
    tag_pattern: c.tag_pattern,
    update_level: c.update_level,
    last_checked_at: c.last_checked ? new Date(c.last_checked).toISOString() : null,
    last_updated_at: c.last_updated ? new Date(c.last_updated).toISOString() : null,
  };
}

/**
 * Given a list of container IDs (docker_id or internal id), resolve which
 * agent owns each and group by agent.
 */
async function resolveContainerAgents(containerIds: string[]): Promise<Map<string, string[]>> {
  const allContainers = await listAllContainersWithAgent();
  const map = new Map<string, string[]>();
  for (const cid of containerIds) {
    const container = allContainers.find((c) => c.docker_id === cid || c.id === cid);
    if (!container) continue;
    const list = map.get(container.agent_id) ?? [];
    list.push(container.docker_id);
    map.set(container.agent_id, list);
  }
  return map;
}

export default integrationRoutes;
