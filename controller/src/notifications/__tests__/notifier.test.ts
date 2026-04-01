import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	startPostgres,
	stopPostgres,
	truncateAll,
} from "../../__tests__/pg-setup.js";
import { encrypt, initCrypto, resetKey } from "../../lib/crypto.js";
import { insertNotificationChannel } from "../../db/queries.js";
import type { NotificationEvent } from "../types.js";

// Mock the senders so we don't make real network calls
vi.mock("../senders/slack.js", () => ({
	sendSlack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../senders/telegram.js", () => ({
	sendTelegram: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../senders/webhook.js", () => ({
	sendWebhook: vi.fn().mockResolvedValue(undefined),
}));

import { sendSlack } from "../senders/slack.js";

describe("notifier (Finding 6.2)", () => {
	beforeAll(async () => {
		await startPostgres();
		process.env.ENCRYPTION_KEY = "notifier-test-secret-key-1234";
		initCrypto("notifier-test-salt-16chars");
	}, 60000);

	beforeEach(async () => {
		await truncateAll();
		vi.clearAllMocks();
	});

	afterAll(async () => {
		resetKey();
		delete process.env.ENCRYPTION_KEY;
		await stopPostgres();
	});

	it("dispatch continues when one channel has corrupt encrypted config", async () => {
		// Channel 1: corrupt config (not a valid encrypted string)
		await insertNotificationChannel({
			id: "ch-bad",
			type: "slack",
			name: "Bad Channel",
			config: "this-is-not-encrypted-at-all",
			enabled: true,
			events: JSON.stringify(["update_success"]),
			template: null,
			link_template: null,
		});

		// Channel 2: valid encrypted config
		const validConfig = encrypt(
			JSON.stringify({ url: "https://hooks.slack.com/test" }),
		);
		await insertNotificationChannel({
			id: "ch-good",
			type: "slack",
			name: "Good Channel",
			config: validConfig,
			enabled: true,
			events: JSON.stringify(["update_success"]),
			template: null,
			link_template: null,
		});

		const event: NotificationEvent = {
			type: "update_success",
			agentName: "agent-1",
			containers: [{ name: "nginx", image: "nginx:latest", durationMs: 100 }],
		};

		// Re-import notifier to get fresh instance with mocked senders
		const { notifier } = await import("../notifier.js");

		// dispatch should NOT throw even though channel 1 has corrupt config
		await notifier.dispatch(event);

		// The good channel's sender should have been called
		expect(sendSlack).toHaveBeenCalledTimes(1);
	});
});
