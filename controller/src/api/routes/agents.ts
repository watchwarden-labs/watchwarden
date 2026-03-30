import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyPluginAsync } from "fastify";
import cron from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { expectCheckResults } from "../../notifications/session-batcher.js";
import {
	deleteAgent,
	getAgent,
	getContainersByAgent,
	getEffectivePolicy,
	getHistory,
	insertAgent,
	listAgents,
	updateAgentConfig,
} from "../../db/queries.js";
import type { AgentHub } from "../../ws/hub.js";
import { requireAuth } from "../middleware/auth.js";

const agentsRoutes: FastifyPluginAsync = async (fastify) => {
	const hub = (fastify as unknown as { hub: AgentHub }).hub;
	fastify.addHook("preHandler", requireAuth);

	fastify.get<{ Querystring: { limit?: string } }>(
		"/api/agents",
		async (request) => {
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
		},
	);

	fastify.get<{ Params: { id: string } }>(
		"/api/agents/:id",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) {
				return reply.code(404).send({ error: "Agent not found" });
			}
			const { token_hash: _, ...safe } = agent;
			const containers = await getContainersByAgent(agent.id);
			return { ...safe, containers };
		},
	);

	fastify.post<{ Body: { name: string; hostname: string } }>(
		"/api/agents/register",
		{
			config: {
				rateLimit: {
					max: 10,
					timeWindow: "1 minute",
				},
			},
		},
		async (request, reply) => {
			const { name, hostname } = request.body;
			if (!name || !hostname) {
				return reply
					.code(400)
					.send({ error: "name and hostname are required" });
			}
			const id = uuidv4();
			const rawToken = randomBytes(32).toString("hex");
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

	fastify.delete<{ Params: { id: string } }>(
		"/api/agents/:id",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) {
				return reply.code(404).send({ error: "Agent not found" });
			}
			await deleteAgent(request.params.id);
			return reply.code(204).send();
		},
	);

	// Check all online agents — batches notifications into a single dispatch.
	// MUST be registered before /:id/check to avoid Fastify matching "check-all" as an :id param.
	fastify.post("/api/agents/check-all", async (_request, reply) => {
		const agents = await listAgents();
		const onlineAgents = agents.filter((a) => a.status === "online");
		if (onlineAgents.length === 0) {
			return reply.code(200).send({ message: "No online agents", count: 0 });
		}
		expectCheckResults(onlineAgents.length);
		for (const agent of onlineAgents) {
			hub.sendToAgent(agent.id, { type: "CHECK", payload: {} });
		}
		return reply.code(202).send({
			message: "Check initiated for all online agents",
			count: onlineAgents.length,
		});
	});

	fastify.post<{ Params: { id: string }; Body: { containerIds?: string[] } }>(
		"/api/agents/:id/check",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) {
				return reply.code(404).send({ error: "Agent not found" });
			}
			if (agent.status !== "online") {
				return reply.code(409).send({ error: "Agent is not online" });
			}
			hub.sendToAgent(request.params.id, {
				type: "CHECK",
				payload: { containerIds: request.body?.containerIds },
			});
			return reply.code(202).send({ message: "Check initiated" });
		},
	);

	fastify.post<{ Params: { id: string }; Body: { containerIds?: string[] } }>(
		"/api/agents/:id/update",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) {
				return reply.code(404).send({ error: "Agent not found" });
			}
			if (agent.status !== "online") {
				return reply.code(409).send({ error: "Agent is not online" });
			}
			// BUG-05 FIX: reject if an update is already in flight for this agent
			// (auto-update from CHECK_RESULT or another manual update). Prevents
			// redundant Docker container recreations that cause unnecessary downtime.
			if (hub.isUpdateInFlight(request.params.id)) {
				return reply
					.code(409)
					.send({ error: "Update already in progress for this agent" });
			}
			hub.setUpdateInFlight(request.params.id, true);
			const policy = await getEffectivePolicy(request.params.id);
			const containerIds = request.body?.containerIds;
			if (containerIds?.length) {
				// Specific containers — use orchestrator for dependency ordering
				const { executeOrchestratedUpdate } = await import(
					"../../scheduler/orchestrator.js"
				);
				await executeOrchestratedUpdate(hub, request.params.id, containerIds, {
					strategy: policy.strategy ?? "stop-first",
				});
			} else {
				// All containers — get list and orchestrate
				const containers = await getContainersByAgent(request.params.id);
				const allIds = containers
					.filter((c) => !c.excluded)
					.map((c) => c.docker_id);
				const { executeOrchestratedUpdate } = await import(
					"../../scheduler/orchestrator.js"
				);
				await executeOrchestratedUpdate(hub, request.params.id, allIds, {
					strategy: policy.strategy ?? "stop-first",
				});
			}
			return reply.code(202).send({ message: "Update initiated" });
		},
	);

	fastify.post<{
		Params: { id: string };
		Body: { containerId: string; targetTag?: string; targetDigest?: string };
	}>("/api/agents/:id/rollback", async (request, reply) => {
		const agent = await getAgent(request.params.id);
		if (!agent) {
			return reply.code(404).send({ error: "Agent not found" });
		}
		if (agent.status !== "online") {
			return reply.code(409).send({ error: "Agent is not online" });
		}
		const { containerId, targetTag, targetDigest } = request.body;

		const container = (await getContainersByAgent(agent.id)).find(
			(c) => c.docker_id === containerId || c.id === containerId,
		);

		// Build target image reference
		let targetImage: string | undefined;
		if (targetTag || targetDigest) {
			if (container) {
				const baseImage = container.image.split(":")[0] ?? container.image;
				if (targetDigest) {
					targetImage = `${baseImage}@${targetDigest}`;
				} else if (targetTag) {
					targetImage = `${baseImage}:${targetTag}`;
				}
			}
		}

		hub.sendToAgent(request.params.id, {
			type: "ROLLBACK",
			payload: {
				containerId,
				containerName: container?.name,
				targetImage,
			},
		});
		return reply.code(202).send({ message: "Rollback initiated" });
	});

	// Container version history (from update_log + registry tags)
	fastify.get<{
		Params: { agentId: string; containerId: string };
		Querystring: { page?: string; limit?: string; search?: string };
	}>(
		"/api/agents/:agentId/containers/:containerId/versions",
		async (request) => {
			const { agentId, containerId } = request.params;
			const { page, limit: limitStr, search } = request.query;
			const container = (await getContainersByAgent(agentId)).find(
				(c) => c.docker_id === containerId || c.id === containerId,
			);

			// Local history from update_log
			const history = await getHistory({ limit: 50 });
			const imageTag = container?.image?.includes(":")
				? container.image.split(":").pop()
				: null;
			const localVersions = history.data
				.filter(
					(e) =>
						e.agent_id === agentId &&
						(e.container_id === containerId ||
							e.container_name === container?.name),
				)
				.map((e) => ({
					digest: e.new_digest ?? e.old_digest,
					tag: imageTag ?? container?.name ?? null,
					status: e.status,
					updatedAt: e.created_at,
					isCurrent: e.new_digest === container?.current_digest,
				}));

			// Fetch registry tags
			let registryResult = null;
			if (container?.image) {
				try {
					const { fetchRegistryTags } = await import(
						"../../lib/registry-client.js"
					);
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
		},
	);

	fastify.post<{
		Params: { id: string };
		Body: { keepPrevious?: number; dryRun?: boolean };
	}>("/api/agents/:id/prune", async (request, reply) => {
		const agent = await getAgent(request.params.id);
		if (!agent) {
			return reply.code(404).send({ error: "Agent not found" });
		}
		if (agent.status !== "online") {
			return reply.code(409).send({ error: "Agent is not online" });
		}
		hub.sendToAgent(request.params.id, {
			type: "PRUNE",
			payload: {
				keepPrevious: request.body?.keepPrevious ?? 1,
				dryRun: request.body?.dryRun ?? false,
			},
		});
		return reply.code(202).send({ message: "Prune initiated" });
	});

	fastify.put<{
		Params: { id: string };
		Body: { scheduleOverride?: string | null; autoUpdate?: boolean };
	}>("/api/agents/:id/config", async (request, reply) => {
		const agent = await getAgent(request.params.id);
		if (!agent) {
			return reply.code(404).send({ error: "Agent not found" });
		}
		const { scheduleOverride, autoUpdate } = request.body;
		if (scheduleOverride && !cron.validate(scheduleOverride)) {
			return reply.code(400).send({ error: "Invalid cron expression" });
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
							setAgentScheduleOverride: (
								id: string,
								expr: string | null,
							) => void;
						};
					}
				).scheduler;
				scheduler?.setAgentScheduleOverride(
					request.params.id,
					scheduleOverride,
				);
			} catch {
				// Scheduler not available
			}
		}

		// Notify the agent via WebSocket
		hub?.sendToAgent(request.params.id, {
			type: "CONFIG_UPDATE",
			payload: {
				schedule: scheduleOverride ?? undefined,
				autoUpdate: autoUpdate ?? undefined,
			},
		});

		return { message: "Config updated" };
	});

	fastify.post<{ Params: { id: string; containerId: string } }>(
		"/api/agents/:id/containers/:containerId/start",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) return reply.code(404).send({ error: "Agent not found" });
			if (agent.status !== "online")
				return reply.code(409).send({ error: "Agent is not online" });
			hub.sendToAgent(request.params.id, {
				type: "CONTAINER_START",
				payload: { containerId: request.params.containerId },
			});
			return reply.code(202).send({ message: "Start initiated" });
		},
	);

	fastify.post<{ Params: { id: string; containerId: string } }>(
		"/api/agents/:id/containers/:containerId/stop",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) return reply.code(404).send({ error: "Agent not found" });
			if (agent.status !== "online")
				return reply.code(409).send({ error: "Agent is not online" });
			hub.sendToAgent(request.params.id, {
				type: "CONTAINER_STOP",
				payload: { containerId: request.params.containerId },
			});
			return reply.code(202).send({ message: "Stop initiated" });
		},
	);

	fastify.delete<{ Params: { id: string; containerId: string } }>(
		"/api/agents/:id/containers/:containerId",
		async (request, reply) => {
			const agent = await getAgent(request.params.id);
			if (!agent) return reply.code(404).send({ error: "Agent not found" });
			if (agent.status !== "online")
				return reply.code(409).send({ error: "Agent is not online" });
			hub.sendToAgent(request.params.id, {
				type: "CONTAINER_DELETE",
				payload: { containerId: request.params.containerId },
			});
			return reply.code(202).send({ message: "Delete initiated" });
		},
	);

	fastify.get<{
		Params: { id: string; containerId: string };
		Querystring: { tail?: string };
	}>("/api/agents/:id/containers/:containerId/logs", async (request, reply) => {
		const agent = await getAgent(request.params.id);
		if (!agent) return reply.code(404).send({ error: "Agent not found" });
		if (agent.status !== "online")
			return reply.code(409).send({ error: "Agent is not online" });

		const tail = Math.min(
			Math.max(Number.parseInt(request.query.tail ?? "100", 10) || 100, 1),
			5000,
		);

		try {
			const result = (await hub.sendAndWait(request.params.id, {
				type: "CONTAINER_LOGS",
				payload: { containerId: request.params.containerId, tail },
			})) as { logs: string; success: boolean; error?: string };

			if (!result.success) {
				return reply
					.code(500)
					.send({ error: result.error ?? "Failed to fetch logs" });
			}
			return {
				logs: result.logs,
				containerId: request.params.containerId,
				tail,
			};
		} catch (err) {
			return reply.code(504).send({
				error: err instanceof Error ? err.message : "Agent request timed out",
			});
		}
	});

	fastify.post<{
		Params: { id: string };
		Body: { containerId: string; containerName?: string; image: string };
	}>("/api/agents/:id/scan", async (request, reply) => {
		const agent = await getAgent(request.params.id);
		if (!agent) return reply.code(404).send({ error: "Agent not found" });
		if (agent.status !== "online")
			return reply.code(409).send({ error: "Agent is not online" });
		hub.sendToAgent(request.params.id, {
			type: "SCAN",
			payload: request.body,
		});
		return reply.code(202).send({ message: "Scan initiated" });
	});
};

export default agentsRoutes;
