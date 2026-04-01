import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";
import { truncateAll } from "../../__tests__/pg-setup.js";
import { setConfig } from "../../db/queries.js";

export async function buildTestApp(): Promise<FastifyInstance> {
	// Seed admin password
	const hash = await bcrypt.hash("testpassword", 10);
	await setConfig("admin_password_hash", hash);
	await setConfig("jwt_secret", "test-jwt-secret");

	const app = Fastify({ logger: false });

	// Register plugins required by routes
	await app.register(cookie);
	await app.register(rateLimit, { global: false });

	// Import and register routes dynamically
	const { default: authRoutes } = await import("../routes/auth.js");
	const { default: agentsRoutes } = await import("../routes/agents.js");
	const { default: configRoutes } = await import("../routes/config.js");
	const { default: historyRoutes } = await import("../routes/history.js");

	await app.register(authRoutes);
	await app.register(agentsRoutes);
	await app.register(configRoutes);
	await app.register(historyRoutes);

	const { default: metricsRoutes } = await import("../routes/metrics.js");
	await app.register(metricsRoutes);

	// Register the audit hook so audit log tests work
	const { registerAuditHook } = await import("../middleware/audit.js");
	registerAuditHook(app);

	return app;
}

export async function getAuthToken(app: FastifyInstance): Promise<string> {
	const res = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		payload: { password: "testpassword" },
	});
	// Token is now only in httpOnly cookie, not in the response body
	const setCookie = res.headers["set-cookie"] as string | undefined;
	const match = setCookie?.match(/ww_token=([^;]+)/);
	if (!match?.[1]) throw new Error("Auth cookie not found in login response");
	return match[1];
}

export async function teardownTestApp(): Promise<void> {
	await truncateAll();
}
