import type { NotificationEvent } from "../types.js";

function formatContainerName(name: string, image?: string): string {
	if (!image || image === name) return name;
	return `${name} (${image})`;
}

export function formatTelegramMessage(event: NotificationEvent): string {
	switch (event.type) {
		case "update_available": {
			if (event.agents.length === 1) {
				const agent = event.agents[0]!;
				const items = agent.containers
					.map((c) => `• ${formatContainerName(c.name, c.image)}`)
					.join("\n");
				return `🔔 Updates Available — ${agent.agentName}\n\n${items}`;
			}
			// Multiple agents
			const totalContainers = event.agents.reduce(
				(sum, a) => sum + a.containers.length,
				0,
			);
			const sections = event.agents
				.map((agent) => {
					const items = agent.containers
						.map((c) => `  • ${formatContainerName(c.name, c.image)}`)
						.join("\n");
					return `📍 ${agent.agentName}\n${items}`;
				})
				.join("\n\n");
			return `🔔 Updates Available — ${event.agents.length} agents, ${totalContainers} containers\n\n${sections}`;
		}
		case "update_success": {
			const items = event.containers
				.map((c) => `• ${c.name} — ${Math.round(c.durationMs / 1000)}s`)
				.join("\n");
			return `✅ Update Complete — ${event.agentName}\n\n${items}`;
		}
		case "update_failed": {
			const items = event.containers
				.map((c) => `• ${c.name} — ${c.error}`)
				.join("\n");
			return `❌ Update Failed — ${event.agentName}\n\n${items}`;
		}
	}
}

export async function sendTelegram(
	config: { botToken: string; chatId: string },
	event: NotificationEvent,
): Promise<void> {
	const text = formatTelegramMessage(event);
	const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
	// N01: 10s timeout prevents a hung Telegram call from blocking the dispatch loop.
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML" }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) {
		throw new Error(`Telegram API returned ${res.status}: ${await res.text()}`);
	}
}
