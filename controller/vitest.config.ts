import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/__tests__/**/*.test.ts"],
		testTimeout: 60000,
		hookTimeout: 120000,
		// One PostgreSQL container for ALL test files — started in globalSetup, stopped in teardown.
		// Files run sequentially to avoid shared DB conflicts.
		fileParallelism: false,
		globalSetup: ["src/__tests__/global-setup.ts"],
		env: {
			DOCKER_HOST: `unix://${process.env["HOME"]}/.colima/default/docker.sock`,
			TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: "/var/run/docker.sock",
		},
	},
});
