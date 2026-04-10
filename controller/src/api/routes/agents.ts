import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import {
  deleteAgent,
  getAgent,
  getContainersByAgent,
  getEffectivePolicy,
  getHistory,
  insertAgent,
  listAgents,
  updateAgentConfig,
  updateContainerPolicy,
} from '../../db/queries.js';
import { expectCheckResults } from '../../notifications/session-batcher.js';
import type { AgentHub } from '../../ws/hub.js';
import { requireAuth } from '../middleware/auth.js';

const agentsRoutes: FastifyPluginAsync = async (fastify) => {
  const hub = (fastify as unknown as { hub: AgentHub }).hub;
  fastify.addHook('preHandler', requireAuth);

  fastify.get<{ Querystring: { limit?: string } }>('/api/agents', async (request) => {
    const limit = Math.min(
      request.query.limit ? Number.parseInt(request.query.limit, 10) : 200,
      200,
    );
    const agents = await listAgents();
    const result = [];
    for (const agent of agents.slice(0, limit)) {
      const { token_hash: _, ...safe } = agent;
      result.push({
        ...safe,
        containers: await getContainersByAgent(agent.id),
      });
    }
    return result;
  });

  fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    const { token_hash: _, ...safe } = agent;
    const containers = await getContainersByAgent(agent.id);
    return { ...safe, containers };
  });

  fastify.post<{ Body: { name: string; hostname: string } }>(
    '/api/agents/register',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { name, hostname } = request.body;
      if (!name || !hostname) {
        return reply.code(400).send({ error: 'name and hostname are required' });
      }
      const id = uuidv4();
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const tokenPrefix = rawToken.slice(0, 8);

      await insertAgent({
        id,
        name,
        hostname,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
      });

      return reply.code(201).send({ agentId: id, token: rawToken });
    },
  );

  fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    await deleteAgent(request.params.id);
    return reply.code(204).send();
  });

  // Check all online agents — batches notifications into a single dispatch.
  // MUST be registered before /:id/check to avoid Fastify matching "check-all" as an :id param.
  fastify.post('/api/agents/check-all', async (_request, reply) => {
    const agents = await listAgents();
    const onlineAgents = agents.filter((a) => a.status === 'online');
    if (onlineAgents.length === 0) {
      return reply.code(200).send({ message: 'No online agents', count: 0 });
    }
    // Only count agents we actually reached — DB status may be stale
    let sent = 0;
    for (const agent of onlineAgents) {
      if (hub.sendToAgent(agent.id, { type: 'CHECK', payload: {} })) {
        sent++;
      }
    }
    if (sent > 0) {
      expectCheckResults(sent);
    }
    return reply.code(202).send({
      message: `Check initiated for ${sent} online agent(s)`,
      count: sent,
    });
  });

  fastify.post<{ Params: { id: string }; Body: { containerIds?: string[] } }>(
    '/api/agents/:id/check',
    async (request, reply) => {
      const agent = await getAgent(request.params.id);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return reply.code(409).send({ error: 'Agent is not online' });
      }
      const sent = hub.sendToAgent(request.params.id, {
        type: 'CHECK',
        payload: { containerIds: request.body?.containerIds },
      });
      if (!sent) {
        return reply.code(409).send({ error: 'Agent is not connected' });
      }
      return reply.code(202).send({ message: 'Check initiated' });
    },
  );

  fastify.post<{ Params: { id: string }; Body: { containerIds?: string[] } }>(
    '/api/agents/:id/update',
    async (request, reply) => {
      const agent = await getAgent(request.params.id);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return reply.code(409).send({ error: 'Agent is not online' });
      }
      // BUG-05 FIX: reject if an update is already in flight for this agent
      // (auto-update from CHECK_RESULT or another manual update). Prevents
      // redundant Docker container recreations that cause unnecessary downtime.
      if (hub.isUpdateInFlight(request.params.id)) {
        return reply.code(409).send({ error: 'Update already in progress for this agent' });
      }
      hub.setUpdateInFlight(request.params.id, true);
      const policy = await getEffectivePolicy(request.params.id);
      const containerIds = request.body?.containerIds;
      if (containerIds?.length) {
        // Specific containers — use orchestrator for dependency ordering
        const { executeOrchestratedUpdate } = await import('../../scheduler/orchestrator.js');
        await executeOrchestratedUpdate(hub, request.params.id, containerIds, {
          strategy: policy.strategy ?? 'stop-first',
        });
      } else {
        // All containers with updates — filter to only those that actually need updating
        // Stateful containers (databases, caches) are excluded from bulk updates to prevent data loss
        const containers = await getContainersByAgent(request.params.id);
        const skippedStateful = containers
          .filter((c) => !c.excluded && c.has_update && c.is_stateful)
          .map((c) => c.name);
        const allIds = containers
          .filter((c) => !c.excluded && c.has_update && !c.is_stateful)
          .map((c) => c.docker_id);
        if (allIds.length === 0) {
          hub.setUpdateInFlight(request.params.id, false);
          const msg = skippedStateful.length
            ? `No stateless containers to update (skipped stateful: ${skippedStateful.join(', ')})`
            : 'No containers have updates';
          return reply.code(200).send({ message: msg });
        }
        const { executeOrchestratedUpdate } = await import('../../scheduler/orchestrator.js');
        await executeOrchestratedUpdate(hub, request.params.id, allIds, {
          strategy: policy.strategy ?? 'stop-first',
        });
      }
      const msg = 'Update initiated';
      return reply.code(202).send({ message: msg });
    },
  );

  fastify.post<{
    Params: { id: string };
    Body: { containerId: string; targetTag?: string; targetDigest?: string };
  }>('/api/agents/:id/rollback', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    if (agent.status !== 'online') {
      return reply.code(409).send({ error: 'Agent is not online' });
    }
    const { containerId, targetTag, targetDigest } = request.body;

    const container = (await getContainersByAgent(agent.id)).find(
      (c) => c.docker_id === containerId || c.id === containerId,
    );

    // Build target image reference
    let targetImage: string | undefined;
    if (targetTag || targetDigest) {
      if (container) {
        const baseImage = container.image.split(':')[0]?.split('@')[0] ?? container.image;
        if (targetDigest) {
          // Strip image prefix if digest contains full ref (e.g. "registry/repo@sha256:...")
          const bareDigest = targetDigest.includes('@')
            ? targetDigest.slice(targetDigest.indexOf('@') + 1)
            : targetDigest.startsWith('sha256:')
              ? targetDigest
              : `sha256:${targetDigest}`;
          targetImage = `${baseImage}@${bareDigest}`;
        } else if (targetTag) {
          targetImage = `${baseImage}:${targetTag}`;
        }
      }
    }

    hub.sendToAgent(request.params.id, {
      type: 'ROLLBACK',
      payload: {
        containerId,
        containerName: container?.name,
        targetImage,
      },
    });
    return reply.code(202).send({ message: 'Rollback initiated' });
  });

  // Container version history (from update_log + registry tags)
  fastify.get<{
    Params: { agentId: string; containerId: string };
    Querystring: { page?: string; limit?: string; search?: string };
  }>('/api/agents/:agentId/containers/:containerId/versions', async (request) => {
    const { agentId, containerId } = request.params;
    const { page, limit: limitStr, search } = request.query;
    const container = (await getContainersByAgent(agentId)).find(
      (c) => c.docker_id === containerId || c.id === containerId,
    );

    // Local history from update_log — deduplicate by digest, skip entries with no digest
    const history = await getHistory({ limit: 50 });
    const seenDigests = new Set<string>();
    const localVersions = history.data
      .filter(
        (e) =>
          e.agent_id === agentId &&
          (e.container_id === containerId || e.container_name === container?.name),
      )
      .map((e) => {
        const rawDigest = e.new_digest ?? e.old_digest;
        // Extract bare sha256 digest from full image ref
        const digest = rawDigest?.includes('@')
          ? rawDigest.slice(rawDigest.indexOf('@') + 1)
          : rawDigest;
        const shortDigest = digest ? digest.replace('sha256:', '').slice(0, 12) : null;
        return {
          digest,
          tag: shortDigest,
          status: e.status,
          updatedAt: e.created_at,
          isCurrent: digest
            ? digest === container?.current_digest || rawDigest === container?.current_digest
            : false,
        };
      })
      .filter((v) => {
        // Skip entries with no digest — they can't be used for rollback
        if (!v.digest) return false;
        // Deduplicate by digest — keep only the most recent entry per digest
        if (seenDigests.has(v.digest)) return false;
        seenDigests.add(v.digest);
        return true;
      });

    // Fetch registry tags
    let registryResult = null;
    if (container?.image) {
      try {
        const { fetchRegistryTags } = await import('../../lib/registry-client.js');
        registryResult = await fetchRegistryTags(container.image, {
          page: page ? Number.parseInt(page, 10) : 1,
          limit: Math.min(limitStr ? Number.parseInt(limitStr, 10) : 20, 200),
          search: search || undefined,
        });
      } catch {
        // Registry fetch failed — return null, UI shows fallback
      }
    }

    return {
      local: localVersions,
      registry: registryResult,
    };
  });

  fastify.post<{
    Params: { id: string };
    Body: { keepPrevious?: number; dryRun?: boolean };
  }>('/api/agents/:id/prune', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    if (agent.status !== 'online') {
      return reply.code(409).send({ error: 'Agent is not online' });
    }
    hub.sendToAgent(request.params.id, {
      type: 'PRUNE',
      payload: {
        keepPrevious: request.body?.keepPrevious ?? 1,
        dryRun: request.body?.dryRun ?? false,
      },
    });
    return reply.code(202).send({ message: 'Prune initiated' });
  });

  fastify.put<{
    Params: { id: string };
    Body: { scheduleOverride?: string | null; autoUpdate?: boolean };
  }>('/api/agents/:id/config', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    const { scheduleOverride, autoUpdate } = request.body;
    if (scheduleOverride && !cron.validate(scheduleOverride)) {
      return reply.code(400).send({ error: 'Invalid cron expression' });
    }
    await updateAgentConfig(request.params.id, {
      schedule_override: scheduleOverride,
      auto_update: autoUpdate !== undefined ? (autoUpdate ? 1 : 0) : undefined,
    });

    // Update the controller's scheduler (may not exist in tests)
    if (scheduleOverride !== undefined) {
      try {
        const scheduler = (
          fastify as unknown as {
            scheduler?: {
              setAgentScheduleOverride: (id: string, expr: string | null) => void;
            };
          }
        ).scheduler;
        scheduler?.setAgentScheduleOverride(request.params.id, scheduleOverride);
      } catch {
        // Scheduler not available
      }
    }

    // Notify the agent via WebSocket
    hub?.sendToAgent(request.params.id, {
      type: 'CONFIG_UPDATE',
      payload: {
        schedule: scheduleOverride ?? undefined,
        autoUpdate: autoUpdate ?? undefined,
      },
    });

    return { message: 'Config updated' };
  });

  fastify.post<{ Params: { id: string; containerId: string } }>(
    '/api/agents/:id/containers/:containerId/start',
    async (request, reply) => {
      const agent = await getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (agent.status !== 'online') return reply.code(409).send({ error: 'Agent is not online' });
      hub.sendToAgent(request.params.id, {
        type: 'CONTAINER_START',
        payload: { containerId: request.params.containerId },
      });
      return reply.code(202).send({ message: 'Start initiated' });
    },
  );

  fastify.post<{ Params: { id: string; containerId: string } }>(
    '/api/agents/:id/containers/:containerId/stop',
    async (request, reply) => {
      const agent = await getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (agent.status !== 'online') return reply.code(409).send({ error: 'Agent is not online' });
      hub.sendToAgent(request.params.id, {
        type: 'CONTAINER_STOP',
        payload: { containerId: request.params.containerId },
      });
      return reply.code(202).send({ message: 'Stop initiated' });
    },
  );

  fastify.delete<{ Params: { id: string; containerId: string } }>(
    '/api/agents/:id/containers/:containerId',
    async (request, reply) => {
      const agent = await getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (agent.status !== 'online') return reply.code(409).send({ error: 'Agent is not online' });
      hub.sendToAgent(request.params.id, {
        type: 'CONTAINER_DELETE',
        payload: { containerId: request.params.containerId },
      });
      return reply.code(202).send({ message: 'Delete initiated' });
    },
  );

  fastify.get<{
    Params: { id: string; containerId: string };
    Querystring: { tail?: string };
  }>('/api/agents/:id/containers/:containerId/logs', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.status !== 'online') return reply.code(409).send({ error: 'Agent is not online' });

    const tail = Math.min(
      Math.max(Number.parseInt(request.query.tail ?? '100', 10) || 100, 1),
      5000,
    );

    try {
      const result = (await hub.sendAndWait(request.params.id, {
        type: 'CONTAINER_LOGS',
        payload: { containerId: request.params.containerId, tail },
      })) as { logs: string; success: boolean; error?: string };

      if (!result.success) {
        return reply.code(500).send({ error: result.error ?? 'Failed to fetch logs' });
      }
      return {
        logs: result.logs,
        containerId: request.params.containerId,
        tail,
      };
    } catch (err) {
      return reply.code(504).send({
        error: err instanceof Error ? err.message : 'Agent request timed out',
      });
    }
  });

  fastify.patch<{
    Params: { agentId: string; containerId: string };
    Body: { policy: string | null; update_level: string | null; tag_pattern?: string | null };
  }>('/api/agents/:agentId/containers/:containerId', async (request, reply) => {
    const { agentId, containerId } = request.params;
    const { policy, update_level, tag_pattern } = request.body;

    const agent = await getAgent(agentId);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const validPolicies = new Set([null, 'auto', 'notify', 'manual']);
    if (!validPolicies.has(policy)) {
      return reply
        .code(400)
        .send({ error: 'Invalid policy. Must be one of: auto, notify, manual' });
    }
    const validLevels = new Set([null, '', 'all', 'major', 'minor', 'patch']);
    if (!validLevels.has(update_level)) {
      return reply.code(400).send({
        error: 'Invalid update_level. Must be one of: all, major, minor, patch',
      });
    }
    if (tag_pattern !== undefined && tag_pattern !== null) {
      try {
        new RegExp(tag_pattern);
      } catch {
        return reply
          .code(400)
          .send({ error: 'Invalid tag_pattern: not a valid regular expression' });
      }
    }

    await updateContainerPolicy(containerId, { policy, update_level, tag_pattern });
    return reply.code(200).send({ message: 'Container policy updated' });
  });

  fastify.post<{
    Params: { id: string };
    Body: { containerId: string; containerName?: string; image: string };
  }>('/api/agents/:id/scan', async (request, reply) => {
    const agent = await getAgent(request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.status !== 'online') return reply.code(409).send({ error: 'Agent is not online' });
    hub.sendToAgent(request.params.id, {
      type: 'SCAN',
      payload: request.body,
    });
    return reply.code(202).send({ message: 'Scan initiated' });
  });
};

export default agentsRoutes;
