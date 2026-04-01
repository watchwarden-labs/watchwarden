import type { FastifyPluginAsync } from "fastify";
import { sql } from "../../db/client.js";
import { getContainersByAgent, listAgents } from "../../db/queries.js";

const metricsRoutes: FastifyPluginAsync = async (fastify) => {
	// No auth required — standard for Prometheus scraping
	fastify.get("/metrics", async (_request, reply) => {
		const agents = await listAgents();
		const onlineAgents = agents.filter((a) => a.status === "online").length;

		let totalContainers = 0;
		let updatesAvailable = 0;
		let excludedContainers = 0;

		for (const agent of agents) {
			const containers = await getContainersByAgent(agent.id);
			totalContainers += containers.length;
			updatesAvailable += containers.filter((c) => c.has_update === 1).length;
			excludedContainers += containers.filter((c) => c.excluded === 1).length;
		}

		// Query update counts from DB
		const successCount =
			await sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'success'`;
		const failedCount =
			await sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'failed'`;
		const rolledBackCount =
			await sql`SELECT COUNT(*) as count FROM update_log WHERE status = 'rolled_back'`;

		const lines = [
			"# HELP watchwarden_agents_total Total number of registered agents",
			"# TYPE watchwarden_agents_total gauge",
			`watchwarden_agents_total ${agents.length}`,
			"",
			"# HELP watchwarden_agents_online Number of currently online agents",
			"# TYPE watchwarden_agents_online gauge",
			`watchwarden_agents_online ${onlineAgents}`,
			"",
			"# HELP watchwarden_containers_total Total monitored containers across all agents",
			"# TYPE watchwarden_containers_total gauge",
			`watchwarden_containers_total ${totalContainers}`,
			"",
			"# HELP watchwarden_containers_updates_available Containers with pending updates",
			"# TYPE watchwarden_containers_updates_available gauge",
			`watchwarden_containers_updates_available ${updatesAvailable}`,
			"",
			"# HELP watchwarden_containers_excluded Excluded containers",
			"# TYPE watchwarden_containers_excluded gauge",
			`watchwarden_containers_excluded ${excludedContainers}`,
			"",
			"# HELP watchwarden_updates_total Total updates by status",
			"# TYPE watchwarden_updates_total counter",
			`watchwarden_updates_total{status="success"} ${Number(successCount[0]?.count ?? 0)}`,
			`watchwarden_updates_total{status="failed"} ${Number(failedCount[0]?.count ?? 0)}`,
			`watchwarden_updates_total{status="rolled_back"} ${Number(rolledBackCount[0]?.count ?? 0)}`,
			"",
		];

		reply
			.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
			.send(lines.join("\n"));
	});
};

export default metricsRoutes;
