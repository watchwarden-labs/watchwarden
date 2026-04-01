import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	startPostgres,
	stopPostgres,
	truncateAll,
} from "../../__tests__/pg-setup.js";
import {
	insertAgent,
	setConfig,
	updateAgentStatus,
	upsertContainers,
} from "../../db/queries.js";
import type { ContainerInfo } from "../../types.js";
import { buildTestApp, getAuthToken, teardownTestApp } from "./helpers.js";

describe("agents API", () => {
	let app: FastifyInstance;
	let token: string;

	beforeAll(async () => {
		await startPostgres();
		app = await buildTestApp();
		token = await getAuthToken(app);
	}, 60000);

	afterAll(async () => {
		await app.close();
		await teardownTestApp();
		await stopPostgres();
	});

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	it("POST /api/agents/register returns 201 with agentId and token", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/agents/register",
			headers: authHeaders(),
			payload: { name: "Test Agent", hostname: "server-1" },
		});
		expect(res.statusCode).toBe(201);
		const body = JSON.parse(res.body);
		expect(body).toHaveProperty("agentId");
		expect(body).toHaveProperty("token");
		expect(typeof body.agentId).toBe("string");
		expect(typeof body.token).toBe("string");
	});

	it("GET /api/agents returns array including registered agent", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/agents",
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
	});

	it("GET /api/agents/:id returns agent detail with containers", async () => {
		// Register a new agent
		const regRes = await app.inject({
			method: "POST",
			url: "/api/agents/register",
			headers: authHeaders(),
			payload: { name: "Detail Agent", hostname: "server-2" },
		});
		const { agentId } = JSON.parse(regRes.body);

		const res = await app.inject({
			method: "GET",
			url: `/api/agents/${agentId}`,
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.id).toBe(agentId);
		expect(body).toHaveProperty("containers");
		expect(Array.isArray(body.containers)).toBe(true);
	});

	it("GET /api/agents/:unknown returns 404", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/agents/nonexistent-id",
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(404);
	});

	it("DELETE /api/agents/:id returns 204, subsequent GET returns 404", async () => {
		const regRes = await app.inject({
			method: "POST",
			url: "/api/agents/register",
			headers: authHeaders(),
			payload: { name: "Delete Agent", hostname: "server-3" },
		});
		const { agentId } = JSON.parse(regRes.body);

		const delRes = await app.inject({
			method: "DELETE",
			url: `/api/agents/${agentId}`,
			headers: authHeaders(),
		});
		expect(delRes.statusCode).toBe(204);

		const getRes = await app.inject({
			method: "GET",
			url: `/api/agents/${agentId}`,
			headers: authHeaders(),
		});
		expect(getRes.statusCode).toBe(404);
	});

	it("DELETE cascades to containers", async () => {
		// Directly insert agent + containers for this test
		await insertAgent({
			id: "cascade-test",
			name: "Cascade",
			hostname: "srv",
			token_hash: "$2a$10$unique-hash-cascade",
		});
		const containers: ContainerInfo[] = [
			{
				id: "cc-1",
				docker_id: "d-1",
				name: "nginx",
				image: "nginx:latest",
				current_digest: null,
				status: "running",
			},
		];
		await upsertContainers("cascade-test", containers);

		const delRes = await app.inject({
			method: "DELETE",
			url: "/api/agents/cascade-test",
			headers: authHeaders(),
		});
		expect(delRes.statusCode).toBe(204);

		// Verify containers are also gone
		const getRes = await app.inject({
			method: "GET",
			url: "/api/agents/cascade-test",
			headers: authHeaders(),
		});
		expect(getRes.statusCode).toBe(404);
	});

	it("PUT /api/agents/:id/config updates schedule and auto_update", async () => {
		const regRes = await app.inject({
			method: "POST",
			url: "/api/agents/register",
			headers: authHeaders(),
			payload: { name: "Config Agent", hostname: "server-4" },
		});
		const { agentId } = JSON.parse(regRes.body);

		const putRes = await app.inject({
			method: "PUT",
			url: `/api/agents/${agentId}/config`,
			headers: authHeaders(),
			payload: { scheduleOverride: "0 */6 * * *", autoUpdate: true },
		});
		expect(putRes.statusCode).toBe(200);

		const getRes = await app.inject({
			method: "GET",
			url: `/api/agents/${agentId}`,
			headers: authHeaders(),
		});
		const agent = JSON.parse(getRes.body);
		expect(agent.schedule_override).toBe("0 */6 * * *");
		expect(agent.auto_update).toBe(1);
	});
});

describe("POST /api/agents/check-all", () => {
	let app: FastifyInstance;
	let token: string;

	async function buildAppWithHub(): Promise<FastifyInstance> {
		const hash = await bcrypt.hash("testpassword", 10);
		await setConfig("admin_password_hash", hash);
		await setConfig("jwt_secret", "test-jwt-secret");

		const fastifyApp = Fastify({ logger: false });

		// Attach a mock hub to the fastify instance
		const mockHub = {
			sendToAgent: vi.fn().mockReturnValue(true),
			getOnlineAgentIds: vi.fn().mockReturnValue([]),
			broadcastToAllAgents: vi.fn(),
			handleConnection: vi.fn(),
			dispose: vi.fn(),
		};
		(fastifyApp as unknown as { hub: typeof mockHub }).hub = mockHub;

		await fastifyApp.register(cookie);
		await fastifyApp.register(rateLimit, { global: false });

		const { default: authRoutes } = await import("../routes/auth.js");
		const { default: agentsRoutes } = await import("../routes/agents.js");
		await fastifyApp.register(authRoutes);
		await fastifyApp.register(agentsRoutes);

		return fastifyApp;
	}

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	beforeAll(async () => {
		// startPostgres already called in the first describe block — reuse it
		await truncateAll();
		app = await buildAppWithHub();
		token = await getAuthToken(app);
	}, 60000);

	afterAll(async () => {
		await app.close();
		await truncateAll();
	});

	it("returns 202 with count of online agents", async () => {
		// Insert 2 agents and mark them online
		await insertAgent({
			id: "check-all-1",
			name: "Agent 1",
			hostname: "srv-1",
			token_hash: "$2a$10$hash-check-all-1",
		});
		await insertAgent({
			id: "check-all-2",
			name: "Agent 2",
			hostname: "srv-2",
			token_hash: "$2a$10$hash-check-all-2",
		});
		await updateAgentStatus("check-all-1", "online", Date.now());
		await updateAgentStatus("check-all-2", "online", Date.now());

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-all",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.count).toBe(2);

		const hub = (
			app as unknown as { hub: { sendToAgent: ReturnType<typeof vi.fn> } }
		).hub;
		expect(hub.sendToAgent).toHaveBeenCalledTimes(2);
	});

	it("returns 200 with count 0 when no agents online", async () => {
		await truncateAll();
		// Re-seed auth config after truncate
		const hash = await bcrypt.hash("testpassword", 10);
		await setConfig("admin_password_hash", hash);
		await setConfig("jwt_secret", "test-jwt-secret");

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-all",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.count).toBe(0);
	});
});

describe("sendToAgent return value guards", () => {
	let app: FastifyInstance;
	let token: string;
	let mockHub: {
		sendToAgent: ReturnType<typeof vi.fn>;
		getOnlineAgentIds: ReturnType<typeof vi.fn>;
		broadcastToAllAgents: ReturnType<typeof vi.fn>;
		handleConnection: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};

	async function buildAppWithHub(): Promise<FastifyInstance> {
		const hash = await bcrypt.hash("testpassword", 10);
		await setConfig("admin_password_hash", hash);
		await setConfig("jwt_secret", "test-jwt-secret");

		const fastifyApp = Fastify({ logger: false });
		mockHub = {
			sendToAgent: vi.fn().mockReturnValue(true),
			getOnlineAgentIds: vi.fn().mockReturnValue([]),
			broadcastToAllAgents: vi.fn(),
			handleConnection: vi.fn(),
			dispose: vi.fn(),
		};
		(fastifyApp as unknown as { hub: typeof mockHub }).hub = mockHub;
		await fastifyApp.register(cookie);
		await fastifyApp.register(rateLimit, { global: false });
		const { default: authRoutes } = await import("../routes/auth.js");
		const { default: agentsRoutes } = await import("../routes/agents.js");
		await fastifyApp.register(authRoutes);
		await fastifyApp.register(agentsRoutes);
		return fastifyApp;
	}

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	beforeAll(async () => {
		await truncateAll();
		app = await buildAppWithHub();
		token = await getAuthToken(app);
	}, 60000);

	afterAll(async () => {
		await app.close();
		await truncateAll();
	});

	it("POST /:id/check returns 409 when agent WS is disconnected", async () => {
		await insertAgent({
			id: "check-disc-1",
			name: "Disconnected",
			hostname: "srv",
			token_hash: "$2a$10$hash-check-disc-1",
		});
		await updateAgentStatus("check-disc-1", "online", Date.now());

		// sendToAgent returns false → agent has DB status "online" but no WS socket
		mockHub.sendToAgent.mockReturnValue(false);

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-disc-1/check",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(409);
		expect(JSON.parse(res.body).error).toContain("not connected");
	});

	it("POST /:id/check returns 202 when agent WS is connected", async () => {
		mockHub.sendToAgent.mockReturnValue(true);

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-disc-1/check",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(202);
	});

	it("POST /check-all only counts agents where sendToAgent succeeded", async () => {
		await insertAgent({
			id: "check-all-a",
			name: "Agent A",
			hostname: "srv-a",
			token_hash: "$2a$10$hash-check-all-a",
		});
		await insertAgent({
			id: "check-all-b",
			name: "Agent B",
			hostname: "srv-b",
			token_hash: "$2a$10$hash-check-all-b",
		});
		await updateAgentStatus("check-all-a", "online", Date.now());
		await updateAgentStatus("check-all-b", "online", Date.now());

		// Agent A is reachable, Agent B is a ghost (DB online, WS gone)
		mockHub.sendToAgent.mockImplementation(
			(id: string) => id === "check-all-a",
		);

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-all",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.count).toBe(1);
	});

	it("POST /:id/check returns 409 when agent status is offline", async () => {
		await updateAgentStatus("check-disc-1", "offline", Date.now());

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/check-disc-1/check",
			headers: authHeaders(),
		});

		expect(res.statusCode).toBe(409);
		expect(JSON.parse(res.body).error).toContain("not online");
	});
});

describe("BUG-05: Manual update rejects when update already in flight", () => {
	let app: FastifyInstance;
	let token: string;

	async function buildAppWithMockHub(): Promise<FastifyInstance> {
		const hash = await bcrypt.hash("testpassword", 10);
		await setConfig("admin_password_hash", hash);
		await setConfig("jwt_secret", "test-jwt-secret");

		const fastifyApp = Fastify({ logger: false });
		const mockHub = {
			sendToAgent: vi.fn().mockReturnValue(true),
			getOnlineAgentIds: vi.fn().mockReturnValue([]),
			isUpdateInFlight: vi.fn().mockReturnValue(false),
			setUpdateInFlight: vi.fn(),
			handleConnection: vi.fn(),
			dispose: vi.fn(),
		};
		(fastifyApp as unknown as { hub: typeof mockHub }).hub = mockHub;
		await fastifyApp.register(cookie);
		await fastifyApp.register(rateLimit, { global: false });
		const { default: authRoutes } = await import("../routes/auth.js");
		const { default: agentsRoutes } = await import("../routes/agents.js");
		await fastifyApp.register(authRoutes);
		await fastifyApp.register(agentsRoutes);
		return fastifyApp;
	}

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	beforeAll(async () => {
		await truncateAll();
		app = await buildAppWithMockHub();
		token = await getAuthToken(app);
	}, 60000);

	afterAll(async () => {
		await app.close();
		await truncateAll();
	});

	it("rejects manual update when auto-update is already in flight", async () => {
		await insertAgent({
			id: "bug05-agent",
			name: "Bug05 Agent",
			hostname: "srv-bug05",
			token_hash: "$2a$10$hash-bug05",
		});
		await updateAgentStatus("bug05-agent", "online", Date.now());

		// Simulate auto-update already in flight
		const hub = (
			app as unknown as {
				hub: { isUpdateInFlight: ReturnType<typeof vi.fn> };
			}
		).hub;
		hub.isUpdateInFlight.mockReturnValue(true);

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/bug05-agent/update",
			headers: authHeaders(),
			payload: {},
		});

		expect(res.statusCode).toBe(409);
		expect(JSON.parse(res.body).error).toContain("already in progress");
	});

	it("allows manual update when no update is in flight", async () => {
		const hub = (
			app as unknown as {
				hub: {
					isUpdateInFlight: ReturnType<typeof vi.fn>;
					setUpdateInFlight: ReturnType<typeof vi.fn>;
				};
			}
		).hub;
		hub.isUpdateInFlight.mockReturnValue(false);

		const res = await app.inject({
			method: "POST",
			url: "/api/agents/bug05-agent/update",
			headers: authHeaders(),
			payload: {},
		});

		expect(res.statusCode).toBe(202);
		expect(hub.setUpdateInFlight).toHaveBeenCalledWith("bug05-agent", true);
	});
});
