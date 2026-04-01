import type { FastifyPluginAsync } from "fastify";
import { v4 as uuidv4 } from "uuid";
import {
	deleteNotificationChannel,
	getNotificationChannel,
	getNotificationLogs,
	insertNotificationChannel,
	listNotificationChannels,
	updateNotificationChannel,
} from "../../db/queries.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { notifier } from "../../notifications/notifier.js";
import { requireAuth } from "../middleware/auth.js";

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.addHook("preHandler", requireAuth);

	fastify.get("/api/notifications", async () => {
		return (await listNotificationChannels()).map((ch) => ({
			...ch,
			config: "••••••••", // Never expose encrypted config
		}));
	});

	// Single channel with partially masked config (for edit modal)
	fastify.get<{ Params: { id: string } }>(
		"/api/notifications/:id",
		async (request, reply) => {
			const ch = await getNotificationChannel(request.params.id);
			if (!ch) return reply.code(404).send({ error: "Channel not found" });
			try {
				const decryptedConfig = JSON.parse(decrypt(ch.config)) as Record<
					string,
					unknown
				>;
				// Mask sensitive values — show only last 4 chars
				const masked: Record<string, unknown> = {};
				const sensitiveKeys = new Set([
					"botToken",
					"webhookUrl",
					"password",
					"apiKey",
					"secret",
				]);
				for (const [k, v] of Object.entries(decryptedConfig)) {
					if (sensitiveKeys.has(k) && typeof v === "string" && v.length > 4) {
						masked[k] = "••••" + v.slice(-4);
					} else {
						masked[k] = v;
					}
				}
				return { ...ch, config: masked };
			} catch (err) {
				request.log.error(
					err,
					`Failed to decrypt notification channel ${ch.id}`,
				);
				return { ...ch, config: {} };
			}
		},
	);

	fastify.post<{
		Body: {
			type: string;
			name: string;
			config: Record<string, unknown>;
			events: string[];
			enabled?: boolean;
			template?: string | null;
			link_template?: string | null;
		};
	}>("/api/notifications", async (request, reply) => {
		const { type, name, config, events, enabled, template, link_template } =
			request.body;
		if (!type || !name || !config || !events) {
			return reply
				.code(400)
				.send({ error: "type, name, config, and events are required" });
		}
		const id = uuidv4();
		await insertNotificationChannel({
			id,
			type,
			name,
			config: encrypt(JSON.stringify(config)),
			enabled: enabled !== false,
			events: JSON.stringify(events),
			template: template ?? null,
			link_template: link_template ?? null,
		});
		return reply.code(201).send({ id, type, name, events });
	});

	fastify.put<{
		Params: { id: string };
		Body: {
			name?: string;
			config?: Record<string, unknown>;
			events?: string[];
			enabled?: boolean;
			template?: string | null;
			link_template?: string | null;
		};
	}>("/api/notifications/:id", async (request, reply) => {
		const existing = await getNotificationChannel(request.params.id);
		if (!existing) {
			return reply.code(404).send({ error: "Channel not found" });
		}
		const { name, config, events, enabled, template, link_template } =
			request.body;
		await updateNotificationChannel(request.params.id, {
			...(name !== undefined ? { name } : {}),
			...(config !== undefined
				? { config: encrypt(JSON.stringify(config)) }
				: {}),
			...(events !== undefined ? { events: JSON.stringify(events) } : {}),
			...(enabled !== undefined ? { enabled: !!enabled } : {}),
			...(template !== undefined ? { template } : {}),
			...(link_template !== undefined ? { link_template } : {}),
		});
		return { message: "Updated" };
	});

	fastify.delete<{ Params: { id: string } }>(
		"/api/notifications/:id",
		async (request, reply) => {
			const existing = await getNotificationChannel(request.params.id);
			if (!existing) {
				return reply.code(404).send({ error: "Channel not found" });
			}
			await deleteNotificationChannel(request.params.id);
			return reply.code(204).send();
		},
	);

	fastify.post<{ Params: { id: string } }>(
		"/api/notifications/:id/test",
		async (request, reply) => {
			const existing = await getNotificationChannel(request.params.id);
			if (!existing) {
				return reply.code(404).send({ error: "Channel not found" });
			}
			try {
				await notifier.sendToSingleChannel(
					{
						type: existing.type,
						config: existing.config,
						id: existing.id,
						name: existing.name,
					},
					{
						type: "update_success",
						agentName: "test-agent",
						containers: [
							{ name: "nginx", image: "nginx:latest", durationMs: 12000 },
							{ name: "redis", image: "redis:alpine", durationMs: 8000 },
						],
					},
				);
				return { success: true };
			} catch (err) {
				request.log.error(err, "Notification test failed");
				return reply.code(500).send({ error: "Test notification failed" });
			}
		},
	);
	fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
		"/api/notifications/logs",
		async (request) => {
			const limit = Math.min(
				request.query.limit ? Number.parseInt(request.query.limit, 10) : 50,
				200,
			);
			const offset = Math.max(
				request.query.offset ? Number.parseInt(request.query.offset, 10) : 0,
				0,
			);
			return await getNotificationLogs(limit, offset);
		},
	);
};

export default notificationRoutes;
