import postgres from "postgres";
import { initSql } from "../db/client.js";

let testSql: ReturnType<typeof postgres>;

export async function startPostgres(): Promise<string> {
	// The PostgreSQL container is started once in global-setup.ts and its
	// connection URI is passed via TEST_DATABASE_URL env var.
	const connectionUri = process.env["TEST_DATABASE_URL"];
	if (!connectionUri) {
		throw new Error(
			"TEST_DATABASE_URL not set — global-setup.ts did not run. Check vitest.config.ts globalSetup.",
		);
	}
	process.env["DATABASE_URL"] = connectionUri;

	if (!testSql) {
		testSql = postgres(connectionUri);
	}

	// Initialize the lazy sql client with the test connection URI
	initSql(connectionUri);

	// Clean slate for this test file
	await truncateAll();

	return connectionUri;
}

export async function truncateAll(): Promise<void> {
	await testSql`
    TRUNCATE TABLE notification_logs, notification_channels, registry_credentials,
      update_log, containers, agents, config RESTART IDENTITY CASCADE
  `;
	// Re-seed default config
	await testSql`
    INSERT INTO config (key, value) VALUES
      ('global_schedule', '0 4 * * *'),
      ('auto_update_global', 'false'),
      ('admin_password_hash', '')
    ON CONFLICT (key) DO NOTHING
  `;
}

export async function stopPostgres(): Promise<void> {
	const { closeSql } = await import("../db/client.js");
	await closeSql();
	// Don't stop the container — global-setup.ts teardown handles that.
}
