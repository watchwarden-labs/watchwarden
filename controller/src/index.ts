import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyWebsocket from "@fastify/websocket";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { registerAuditHook } from "./api/middleware/audit.js";
import agentsRoutes from "./api/routes/agents.js";
import auditRoutes from "./api/routes/audit.js";
import authRoutes from "./api/routes/auth.js";
import configRoutes from "./api/routes/config.js";
import historyRoutes from "./api/routes/history.js";
import notificationRoutes from "./api/routes/notifications.js";
import registriesRoutes from "./api/routes/registries.js";
import { closeSql } from "./db/client.js";
import { getAgent, getConfig, insertAgent, setConfig } from "./db/queries.js";
import { runMigrations } from "./db/schema.js";
import { initCrypto, resetKey } from "./lib/crypto.js";
import { clearPendingTimers } from "./notifications/session-batcher.js";
import { Scheduler } from "./scheduler/engine.js";
import { AgentHub } from "./ws/hub.js";
import { UiBroadcaster } from "./ws/ui-broadcaster.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function start() {
	// 1. Run database migrations
	await runMigrations();

	// 2. Seed admin password if not set
	const adminHash = await getConfig("admin_password_hash");
	if (!adminHash) {
		const password = process.env["ADMIN_PASSWORD"];
		if (!password)
			throw new Error("ADMIN_PASSWORD env var is required on first startup");
		if (password.length < 8)
			throw new Error("ADMIN_PASSWORD must be at least 8 characters");
		const hash = bcrypt.hashSync(password, 10);
		await setConfig("admin_password_hash", hash);
	}

	// 3. Seed JWT secret if not set
	const jwtSecret = await getConfig("jwt_secret");
	if (!jwtSecret) {
		const secret = process.env["JWT_SECRET"];
		if (!secret)
			throw new Error("JWT_SECRET env var is required on first startup");
		if (secret.length < 32)
			throw new Error("JWT_SECRET must be at least 32 characters");
		const weakPatterns = ["changeme", "secret", "your-secret", "jwt-secret", "password"];
		if (weakPatterns.some((w) => secret.toLowerCase().includes(w)))
			throw new Error("JWT_SECRET appears to be a default/weak value — set a random secret (use: openssl rand -base64 32)");
		await setConfig("jwt_secret", secret);
	}

	// 4. Validate ENCRYPTION_KEY and initialise AES-256-GCM key derivation.
	// SEC-02: salt is loaded from DB (or generated fresh on first startup) so every
	// deployment has a unique salt — the old hardcoded "watchwarden-salt" was public.
	const encKey = process.env["ENCRYPTION_KEY"];
	if (!encKey) {
		throw new Error("ENCRYPTION_KEY env var is required");
	}
	if (encKey.length < 16) {
		throw new Error("ENCRYPTION_KEY must be at least 16 characters");
	}
	const KNOWN_DEFAULTS = ["please-change-this-32-char-key!!", "changeme"];
	if (KNOWN_DEFAULTS.includes(encKey)) {
		throw new Error("ENCRYPTION_KEY must not be a known default value");
	}

	let encSalt = await getConfig("encryption_salt");
	if (!encSalt) {
		encSalt = randomBytes(32).toString("hex"); // 64-char hex = 256 bits of entropy
		await setConfig("encryption_salt", encSalt);
	}
	initCrypto(encSalt);

	// 5. Auto-register local agent if LOCAL_AGENT_TOKEN is set
	const localAgentToken = process.env["LOCAL_AGENT_TOKEN"];
	if (localAgentToken) {
		const existingAgent = await getAgent("local-agent");
		if (!existingAgent) {
			const tokenHash = bcrypt.hashSync(localAgentToken, 10);
			await insertAgent({
				id: "local-agent",
				name: "local",
				hostname: "local",
				token_hash: tokenHash,
				token_prefix: localAgentToken.slice(0, 8),
			});
			console.log("Auto-registered local agent");
		}
	}

	// 5. Create Fastify
	const isProd = process.env["NODE_ENV"] === "production";
	const app = Fastify({
		bodyLimit: 2 * 1024 * 1024, // 2MB — covers container logs responses
		logger: isProd
			? true // JSON output in production
			: {
					transport: {
						target: "pino-pretty",
						options: {
							colorize: true,
							translateTime: "HH:MM:ss",
							ignore: "pid,hostname",
						},
					},
				},
	});

	// 6. Plugins
	await app.register(cookie);
	const corsOrigin = process.env["CORS_ORIGIN"];
	if (!corsOrigin && process.env["NODE_ENV"] === "production") {
		throw new Error("CORS_ORIGIN env var is required in production");
	}
	// Support comma-separated multi-origin: CORS_ORIGIN=https://a.com,https://b.com
	const corsOrigins = corsOrigin
		? corsOrigin.includes(",")
			? corsOrigin.split(",").map((o) => o.trim())
			: corsOrigin
		: "http://localhost:8080";
	await app.register(cors, {
		origin: corsOrigins,
		credentials: true,
	});
	await app.register(rateLimit, {
		global: false, // opt-in per route
	});
	// 1MB max WS frame — mirrors agent's conn.SetReadLimit(1 << 20)
	await app.register(fastifyWebsocket, {
		options: { maxPayload: 1024 * 1024 },
	});

	// 7. WebSocket hub + broadcaster
	const broadcaster = new UiBroadcaster();
	const hub = new AgentHub(broadcaster);
	app.decorate("hub", hub);
	app.decorate("broadcaster", broadcaster);

	app.get("/ws/agent", { websocket: true }, (socket) => {
		hub.handleConnection(socket);
	});

	app.get("/ws/ui", { websocket: true }, async (socket, request) => {
		// Accept token from httpOnly cookie only (no query string to avoid log exposure)
		const token = (request.cookies as Record<string, string | undefined>)?.[
			"ww_token"
		];
		const secret = await getConfig("jwt_secret");
		try {
			if (!token || !secret) throw new Error("missing token");
			jwt.verify(token, secret);
		} catch {
			socket.close(4001, "Unauthorized");
			return;
		}
		broadcaster.handleConnection(socket);
	});

	// 8. REST API
	await app.register(authRoutes);
	await app.register(agentsRoutes);
	await app.register(configRoutes);
	await app.register(historyRoutes);
	await app.register(registriesRoutes);
	await app.register(notificationRoutes);
	await app.register(auditRoutes);
	registerAuditHook(app);

	// Health check endpoint (used by Docker HEALTHCHECK)
	app.get("/api/health", async () => ({ status: "ok" }));

	// 9. Error handler — never leak internal details to clients
	app.setErrorHandler(
		(error: Error & { statusCode?: number }, request, reply) => {
			request.log.error(error);
			const code = error.statusCode ?? 500;
			reply.code(code).send({
				error: code >= 500 ? "Internal server error" : error.message,
			});
		},
	);

	// 10. Scheduler
	const scheduler = new Scheduler(hub);
	app.decorate("scheduler", scheduler);
	await scheduler.init();

	// 11. Start
	await app.listen({ port: PORT, host: HOST });

	// 12. Graceful shutdown
	const shutdown = async () => {
		app.log.info("Shutting down...");
		scheduler.stop();
		clearPendingTimers();
		resetKey();
		// Wait briefly for in-flight WS message handlers to complete
		await new Promise((r) => setTimeout(r, 1000));
		hub.dispose();
		await app.close();
		await closeSql();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled promise rejection:", reason);
});

start().catch((err) => {
	console.error("Failed to start:", err);
	process.exit(1);
});
