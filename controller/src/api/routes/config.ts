import type { FastifyPluginAsync } from "fastify";
import cron from "node-cron";
import {
	getAllConfig,
	getEffectivePolicy,
	setConfig,
	upsertUpdatePolicy,
} from "../../db/queries.js";
import { requireAuth } from "../middleware/auth.js";

const CRON_KEYS = new Set(["global_schedule"]);
const ALLOWED_CONFIG_KEYS = new Set(["global_schedule", "auto_update_global"]);

const SENSITIVE_CONFIG_KEYS = new Set(["jwt_secret", "admin_password_hash"]);

const configRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/api/config", async () => {
		const all = await getAllConfig();
		const filtered: Record<string, string> = {};
		for (const [k, v] of Object.entries(all as Record<string, string>)) {
			if (!SENSITIVE_CONFIG_KEYS.has(k)) {
				filtered[k] = v;
			}
		}
		return filtered;
	});

	fastify.put<{ Body: { key: string; value: string } }>(
		"/api/config",
		async (request, reply) => {
			const { key, value } = request.body;

			if (!ALLOWED_CONFIG_KEYS.has(key)) {
				return reply
					.code(400)
					.send({ error: `Config key '${key}' is not allowed` });
			}

			if (CRON_KEYS.has(key) && !cron.validate(value)) {
				return reply.code(400).send({ error: "Invalid cron expression" });
			}

			await setConfig(key, value);

			// Hot-reload the scheduler when global_schedule changes
			if (key === "global_schedule") {
				try {
					const scheduler = (
						fastify as unknown as {
							scheduler?: { updateGlobalSchedule: (expr: string) => void };
						}
					).scheduler;
					scheduler?.updateGlobalSchedule(value);
				} catch {
					// Scheduler not available
				}
			}

			return { message: "Config updated" };
		},
	);
	// Update policies
	fastify.get<{ Querystring: { agentId?: string } }>(
		"/api/update-policies",
		async (request) => {
			return await getEffectivePolicy(request.query.agentId);
		},
	);

	fastify.put<{
		Body: {
			scope: string;
			stabilityWindowSeconds?: number;
			autoRollbackEnabled?: boolean;
			maxUnhealthySeconds?: number;
			strategy?: string;
		};
	}>("/api/update-policies", async (request, reply) => {
		const {
			scope,
			stabilityWindowSeconds,
			autoRollbackEnabled,
			maxUnhealthySeconds,
			strategy,
		} = request.body;
		if (!scope || !/^(global|agent:[a-f0-9-]+)$/.test(scope)) {
			return reply.code(400).send({ error: "Invalid scope format" });
		}
		const existing = await getEffectivePolicy(
			scope === "global" ? undefined : scope.replace(/^agent:/, ""),
		);
		const id = scope === "global" ? "global" : scope;
		await upsertUpdatePolicy({
			id,
			scope,
			stability_window_seconds:
				stabilityWindowSeconds ?? existing.stability_window_seconds,
			auto_rollback_enabled:
				autoRollbackEnabled ?? existing.auto_rollback_enabled,
			max_unhealthy_seconds:
				maxUnhealthySeconds ?? existing.max_unhealthy_seconds,
			strategy: strategy ?? existing.strategy ?? "stop-first",
		});
		return { message: "Policy updated" };
	});
};

export default configRoutes;
