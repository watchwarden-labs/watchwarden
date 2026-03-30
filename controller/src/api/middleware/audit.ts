import type { FastifyInstance } from "fastify";
import { insertAuditLog } from "../../db/queries.js";

const AUDIT_ROUTES: Record<string, { action: string; targetType: string }> = {
	// SEC-03/A01: login and logout events must be visible in the audit trail.
	// Only successful logins (2xx) are captured here; failed attempts (4xx) are
	// skipped by the hook's statusCode >= 400 guard — that's intentional since
	// capturing them would require route-level hooks (auth.ts handles brute-force
	// protection via rate limiting, which is a separate concern).
	"POST /api/auth/login": { action: "auth.login", targetType: "config" },
	"POST /api/auth/logout": { action: "auth.logout", targetType: "config" },
	"POST /api/agents/register": {
		action: "agent.register",
		targetType: "agent",
	},
	"DELETE /api/agents/:id": { action: "agent.delete", targetType: "agent" },
	"POST /api/agents/:id/check": { action: "agent.check", targetType: "agent" },
	"POST /api/agents/:id/update": {
		action: "container.update",
		targetType: "agent",
	},
	"POST /api/agents/:id/rollback": {
		action: "container.rollback",
		targetType: "container",
	},
	"PUT /api/agents/:id/config": {
		action: "config.change",
		targetType: "agent",
	},
	"POST /api/notifications": {
		action: "notification.create",
		targetType: "notification",
	},
	"PUT /api/notifications/:id": {
		action: "notification.update",
		targetType: "notification",
	},
	"DELETE /api/notifications/:id": {
		action: "notification.delete",
		targetType: "notification",
	},
	"POST /api/registries": { action: "registry.create", targetType: "registry" },
	"PUT /api/registries/:id": {
		action: "registry.update",
		targetType: "registry",
	},
	"DELETE /api/registries/:id": {
		action: "registry.delete",
		targetType: "registry",
	},
	"PUT /api/config": { action: "config.change", targetType: "config" },
	"PUT /api/auth/password": {
		action: "password.change",
		targetType: "config",
	},
	"PUT /api/update-policies": {
		action: "policy.update",
		targetType: "config",
	},
};

export function registerAuditHook(fastify: FastifyInstance): void {
	fastify.addHook("onResponse", async (request, reply) => {
		if (reply.statusCode >= 400) return;

		const routeKey = `${request.method} ${request.routeOptions?.url ?? request.url}`;
		const match = AUDIT_ROUTES[routeKey];
		if (!match) return;

		const params = request.params as Record<string, string> | undefined;
		const targetId = params?.id ?? null;
		const agentId = match.targetType === "agent" ? targetId : null;

		// Extract meaningful details from the request body.
		// Sensitive fields (passwords, tokens, encrypted config) are redacted.
		const REDACTED_KEYS = new Set([
			"password",
			"token",
			"secret",
			"config",
			"password_encrypted",
			"newPassword",
			"oldPassword",
		]);
		let details: Record<string, unknown> | null = null;
		const body = request.body as Record<string, unknown> | undefined;
		if (body && typeof body === "object") {
			const safe: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(body)) {
				if (REDACTED_KEYS.has(k)) {
					safe[k] = "***";
				} else {
					safe[k] = v;
				}
			}
			if (Object.keys(safe).length > 0) {
				details = safe;
			}
		}

		try {
			await insertAuditLog({
				actor: "admin",
				action: match.action,
				targetType: match.targetType,
				targetId,
				agentId,
				details,
				ipAddress: request.ip,
			});
		} catch {
			// Don't let audit failures break the request
			fastify.log.warn("Failed to write audit log");
		}
	});
}
