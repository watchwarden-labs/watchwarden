import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "../types.js";

// Mock dns.promises before importing the module under test
vi.mock("node:dns/promises", () => ({
	default: {
		lookup: vi.fn(),
	},
}));

// Mock http and https to prevent real network calls
vi.mock("node:http", () => {
	const mockRequest = vi.fn();
	return {
		default: { request: mockRequest },
	};
});

vi.mock("node:https", () => {
	const mockRequest = vi.fn();
	return {
		default: { request: mockRequest },
	};
});

import dns from "node:dns/promises";
import https from "node:https";
import { sendWebhook } from "../senders/webhook.js";

const testEvent: NotificationEvent = {
	type: "update_success",
	agentName: "test-agent",
	containers: [{ name: "nginx", image: "nginx:latest", durationMs: 500 }],
};

describe("webhook SSRF protection (SEC-02)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("blocks webhook to localhost", async () => {
		await expect(
			sendWebhook({ url: "http://localhost:8080/hook" }, testEvent),
		).rejects.toThrow(/private\/internal/);
	});

	it("blocks webhook to 127.0.0.1", async () => {
		await expect(
			sendWebhook({ url: "http://127.0.0.1:8080/hook" }, testEvent),
		).rejects.toThrow(/private\/internal/);
	});

	it("blocks webhook to 10.x.x.x private IP", async () => {
		await expect(
			sendWebhook({ url: "http://10.0.0.1/hook" }, testEvent),
		).rejects.toThrow(/private\/internal/);
	});

	it("blocks webhook to 169.254.x.x link-local", async () => {
		await expect(
			sendWebhook(
				{ url: "http://169.254.169.254/latest/meta-data" },
				testEvent,
			),
		).rejects.toThrow(/private\/internal/);
	});

	it("blocks domain resolving to private IP (DNS rebinding)", async () => {
		(dns.lookup as Mock).mockResolvedValue({
			address: "127.0.0.1",
			family: 4,
		});

		await expect(
			sendWebhook({ url: "https://evil.example.com/hook" }, testEvent),
		).rejects.toThrow(/private\/internal IP/);
	});

	it("allows webhook to valid public IP", async () => {
		(dns.lookup as Mock).mockResolvedValue({
			address: "93.184.216.34",
			family: 4,
		});

		// Mock https.request to simulate a successful response
		const mockReq = {
			setTimeout: vi.fn(),
			on: vi.fn(),
			write: vi.fn(),
			end: vi.fn(),
			destroy: vi.fn(),
		};
		(https.request as Mock).mockImplementation(
			(_options: unknown, callback: (res: unknown) => void) => {
				// Simulate a successful response asynchronously
				const res = {
					statusCode: 200,
					resume: vi.fn(),
					on: vi.fn((event: string, handler: () => void) => {
						if (event === "end") {
							// Call end handler asynchronously
							setTimeout(handler, 0);
						}
					}),
				};
				setTimeout(() => callback(res), 0);
				return mockReq;
			},
		);

		await expect(
			sendWebhook({ url: "https://example.com/hook" }, testEvent),
		).resolves.toBeUndefined();
	});
});
