import type { FastifyPluginAsync } from 'fastify';
import { sql } from '../../db/client.js';
import { listAgents, listAllContainersWithAgent } from '../../db/queries.js';

/** Escape a label value per the Prometheus text exposition format. */
function escapeLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  // No auth required — standard for Prometheus scraping
  fastify.get('/metrics', async (_request, reply) => {
    const [agents, allContainers] = await Promise.all([listAgents(), listAllContainersWithAgent()]);

    const onlineAgents = agents.filter((a) => a.status === 'online').length;
    const totalContainers = allContainers.length;
    const updatesAvailable = allContainers.filter((c) => c.has_update === 1).length;
    const excludedContainers = allContainers.filter((c) => c.excluded === 1).length;

    // Query update counts from DB
    const [successCount, failedCount, rolledBackCount] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'success'`,
      sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'failed'`,
      sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'rolled_back'`,
    ]);

    const containerInfoLines = allContainers.map(
      (c) =>
        `watchwarden_container_info{agent="${escapeLabel(c.agent_name)}",container="${escapeLabel(c.name)}",image="${escapeLabel(c.image)}"} 1`,
    );

    const containerUpdateLines = allContainers.map(
      (c) =>
        `watchwarden_container_has_update{agent="${escapeLabel(c.agent_name)}",container="${escapeLabel(c.name)}"} ${c.has_update === 1 ? 1 : 0}`,
    );

    const containerLastUpdatedLines = allContainers.map(
      (c) =>
        `watchwarden_container_last_updated_ms{agent="${escapeLabel(c.agent_name)}",container="${escapeLabel(c.name)}"} ${c.last_updated ?? 0}`,
    );

    const lines = [
      '# HELP watchwarden_agents_total Total number of registered agents',
      '# TYPE watchwarden_agents_total gauge',
      `watchwarden_agents_total ${agents.length}`,
      '',
      '# HELP watchwarden_agents_online Number of currently online agents',
      '# TYPE watchwarden_agents_online gauge',
      `watchwarden_agents_online ${onlineAgents}`,
      '',
      '# HELP watchwarden_containers_total Total monitored containers across all agents',
      '# TYPE watchwarden_containers_total gauge',
      `watchwarden_containers_total ${totalContainers}`,
      '',
      '# HELP watchwarden_containers_updates_available Containers with pending updates',
      '# TYPE watchwarden_containers_updates_available gauge',
      `watchwarden_containers_updates_available ${updatesAvailable}`,
      '',
      '# HELP watchwarden_containers_excluded Excluded containers',
      '# TYPE watchwarden_containers_excluded gauge',
      `watchwarden_containers_excluded ${excludedContainers}`,
      '',
      '# HELP watchwarden_updates_total Total updates by status',
      '# TYPE watchwarden_updates_total counter',
      `watchwarden_updates_total{status="success"} ${Number(successCount[0]?.count ?? 0)}`,
      `watchwarden_updates_total{status="failed"} ${Number(failedCount[0]?.count ?? 0)}`,
      `watchwarden_updates_total{status="rolled_back"} ${Number(rolledBackCount[0]?.count ?? 0)}`,
      '',
      '# HELP watchwarden_container_info Static info per container (agent, name, image)',
      '# TYPE watchwarden_container_info gauge',
      ...containerInfoLines,
      '',
      '# HELP watchwarden_container_has_update Whether the container has a pending update (0 or 1)',
      '# TYPE watchwarden_container_has_update gauge',
      ...containerUpdateLines,
      '',
      '# HELP watchwarden_container_last_updated_ms Unix timestamp (ms) of last successful update, 0 if never',
      '# TYPE watchwarden_container_last_updated_ms gauge',
      ...containerLastUpdatedLines,
      '',
    ];

    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n'));
  });
};

export default metricsRoutes;
