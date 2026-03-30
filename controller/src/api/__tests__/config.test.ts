import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startPostgres, stopPostgres } from "../../__tests__/pg-setup.js";
import { buildTestApp, getAuthToken, teardownTestApp } from "./helpers.js";

describe("config API", () => {
	let app: FastifyInstance;
	let token: string;
	const mockScheduler = {
		updateGlobalSchedule: vi.fn(),
	};

	beforeAll(async () => {
		await startPostgres();
		app = await buildTestApp();
		// Decorate with mock scheduler so config route can hot-reload it
		app.decorate("scheduler", mockScheduler);
		token = await getAuthToken(app);
	}, 60000);

	afterAll(async () => {
		await app.close();
		await teardownTestApp();
		await stopPostgres();
	});

	const authHeaders = () => ({ authorization: `Bearer ${token}` });

	it("GET /api/config returns default values", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/config",
			headers: authHeaders(),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toHaveProperty("global_schedule");
		expect(body).toHaveProperty("auto_update_global");
	});

	it("PUT /api/config updates value", async () => {
		const putRes = await app.inject({
			method: "PUT",
			url: "/api/config",
			headers: authHeaders(),
			payload: { key: "global_schedule", value: "0 */2 * * *" },
		});
		expect(putRes.statusCode).toBe(200);

		const getRes = await app.inject({
			method: "GET",
			url: "/api/config",
			headers: authHeaders(),
		});
		const body = JSON.parse(getRes.body);
		expect(body.global_schedule).toBe("0 */2 * * *");
	});

	it("PUT /api/config with invalid cron returns 400", async () => {
		const res = await app.inject({
			method: "PUT",
			url: "/api/config",
			headers: authHeaders(),
			payload: { key: "global_schedule", value: "not-a-cron" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("PUT /api/config global_schedule hot-reloads the scheduler", async () => {
		mockScheduler.updateGlobalSchedule.mockClear();

		const res = await app.inject({
			method: "PUT",
			url: "/api/config",
			headers: authHeaders(),
			payload: { key: "global_schedule", value: "*/20 * * * *" },
		});
		expect(res.statusCode).toBe(200);
		expect(mockScheduler.updateGlobalSchedule).toHaveBeenCalledWith(
			"*/20 * * * *",
		);
	});

	it("PUT /api/config non-schedule key does not call scheduler", async () => {
		mockScheduler.updateGlobalSchedule.mockClear();

		const res = await app.inject({
			method: "PUT",
			url: "/api/config",
			headers: authHeaders(),
			payload: { key: "auto_update_global", value: "true" },
		});
		expect(res.statusCode).toBe(200);
		expect(mockScheduler.updateGlobalSchedule).not.toHaveBeenCalled();
	});
});
