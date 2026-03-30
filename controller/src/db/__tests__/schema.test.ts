import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	startPostgres,
	stopPostgres,
	truncateAll,
} from "../../__tests__/pg-setup.js";
import { sql } from "../client.js";

describe("schema", () => {
	beforeAll(async () => {
		await startPostgres();
	}, 60000);

	beforeEach(async () => {
		await truncateAll();
	});

	afterAll(async () => {
		await stopPostgres();
	});

	it("creates agents table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agents'`;
		expect(rows).toHaveLength(1);
	});

	it("creates containers table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers'`;
		expect(rows).toHaveLength(1);
	});

	it("creates update_log table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'update_log'`;
		expect(rows).toHaveLength(1);
	});

	it("creates config table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'config'`;
		expect(rows).toHaveLength(1);
	});

	it("creates registry_credentials table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registry_credentials'`;
		expect(rows).toHaveLength(1);
	});

	it("creates notification_channels table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notification_channels'`;
		expect(rows).toHaveLength(1);
	});

	it("creates notification_logs table", async () => {
		const rows =
			await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notification_logs'`;
		expect(rows).toHaveLength(1);
	});

	it("seeds default global_schedule config", async () => {
		const [row] =
			await sql`SELECT value FROM config WHERE key = 'global_schedule'`;
		expect(row).toBeDefined();
		expect(row?.value).toBe("0 4 * * *");
	});

	it("seeds default auto_update_global config", async () => {
		const [row] =
			await sql`SELECT value FROM config WHERE key = 'auto_update_global'`;
		expect(row).toBeDefined();
		expect(row?.value).toBe("false");
	});

	it("seeds default admin_password_hash config", async () => {
		const [row] =
			await sql`SELECT value FROM config WHERE key = 'admin_password_hash'`;
		expect(row).toBeDefined();
		expect(row?.value).toBe("");
	});
});
