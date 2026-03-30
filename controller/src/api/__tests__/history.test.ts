import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, stopPostgres } from "../../__tests__/pg-setup.js";
import { insertAgent, insertUpdateLog } from "../../db/queries.js";
import { buildTestApp, getAuthToken, teardownTestApp } from "./helpers.js";

describe("history API", () => {
	let app: FastifyInstance;
	let token: string;

	beforeAll(async () => {
		await startPostgres();
		app = await buildTestApp();
		token = await getAuthToken(app);

		// Seed test data
		await insertAgent({
			id: "hist-agent-1",
			name: "Agent 1",
			hostname: "srv1",
			token_hash: "$2a$10$hist-hash-1",
		});
		await insertAgent({
			id: "hist-agent-2",
			name: "Agent 2",
			hostname: "srv2",
			token_hash: "$2a$10$hist-hash-2",
		});

		await insertUpdateLog({
			agent_id: "hist-agent-1",
			container_id: "c-1",
			container_name: "nginx",
			status: "success",
			duration_ms: 1000,
		});
		await insertUpdateLog({
			agent_id: "hist-agent-1",
			container_id: "c-2",
			container_name: "redis",
			status: "failed",
			error: "pull failed",
		});
		await insertUpdateLog({
			agent_id: "hist-agent-2",
			container_id: "c-3",
			container_name: "postgres",
			status: "success",
			duration_ms: 2000,
		});
		await insertUpdateLog({
			agent_id: "hist-agent-1",
			container_id: "c-4",
			container_name: "mongo",
			status: "success",
			duration_ms: 1500,
		});
		await insertUpdateLog({
			agent_id: "hist-agent-2",
			container_id: "c-5",
			container_name: "mysql",
			status: "success",
			duration_ms: 800,
		});
	}, 60000);

	afterAll(async () => {
		await app.close();
		await teardownTestApp();
		await stopPostgres();
	});

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	it("GET /api/history returns all entries", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/history",
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toHaveProperty("data");
		expect(body).toHaveProperty("total");
		expect(body.total).toBe(5);
		expect(body.data).toHaveLength(5);
	});

	it("GET /api/history?agentId=X filters by agent", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/history?agentId=hist-agent-1",
			headers: authHeaders(),
		});
		const body = JSON.parse(res.body);
		expect(body.total).toBe(3);
		expect(body.data).toHaveLength(3);
		for (const entry of body.data) {
			expect(entry.agent_id).toBe("hist-agent-1");
		}
	});

	it("GET /api/history?status=failed filters by status", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/history?status=failed",
			headers: authHeaders(),
		});
		const body = JSON.parse(res.body);
		expect(body.total).toBe(1);
		expect(body.data[0].status).toBe("failed");
	});

	it("GET /api/history with pagination", async () => {
		const res1 = await app.inject({
			method: "GET",
			url: "/api/history?limit=2&offset=0",
			headers: authHeaders(),
		});
		const body1 = JSON.parse(res1.body);
		expect(body1.data).toHaveLength(2);
		expect(body1.total).toBe(5);

		const res2 = await app.inject({
			method: "GET",
			url: "/api/history?limit=2&offset=2",
			headers: authHeaders(),
		});
		const body2 = JSON.parse(res2.body);
		expect(body2.data).toHaveLength(2);

		const res3 = await app.inject({
			method: "GET",
			url: "/api/history?limit=2&offset=4",
			headers: authHeaders(),
		});
		const body3 = JSON.parse(res3.body);
		expect(body3.data).toHaveLength(1);
	});

	it("GET /api/history/stats returns aggregation", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/history/stats",
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toHaveProperty("totalUpdates");
		expect(body).toHaveProperty("successRate");
		expect(body).toHaveProperty("lastWeek");
		expect(body.totalUpdates).toBe(5);
		expect(body.successRate).toBeGreaterThan(0);
		expect(Array.isArray(body.lastWeek)).toBe(true);
	});
});
