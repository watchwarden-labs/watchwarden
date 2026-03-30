import type { NotificationEvent } from "../types.js";
import { formatTelegramMessage } from "./telegram.js";

export async function sendSlack(
	config: { webhookUrl: string },
	event: NotificationEvent,
): Promise<void> {
	const text = formatTelegramMessage(event); // Same format works for Slack
	// N01: 10s timeout prevents a hung Slack call from blocking the dispatch loop.
	const res = await fetch(config.webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) {
		throw new Error(
			`Slack webhook returned ${res.status}: ${await res.text()}`,
		);
	}
}
