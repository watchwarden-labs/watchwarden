import { interpolateTemplate, renderImageLink } from "../template-helpers.js";
import type { NotificationEvent } from "../types.js";

export interface FormatOptions {
	template?: string | null;
	linkTemplate?: string | null;
}

function formatContainerName(name: string, image?: string): string {
	if (!image || image === name) return name;
	return `${name} (${image})`;
}

function appendLink(
	line: string,
	image: string | undefined,
	linkTemplate: string | null | undefined,
): string {
	if (!linkTemplate || !image) return line;
	const link = renderImageLink(image, linkTemplate);
	if (!link) return line;
	return `${line}\n  ${link}`;
}

export function formatTelegramMessage(
	event: NotificationEvent,
	options?: FormatOptions,
): string {
	// If custom template is provided, interpolate and return
	if (options?.template) {
		const vars: Record<string, string> = { eventType: event.type };
		if (event.type === "update_available") {
			const names = event.agents.flatMap((a) =>
				a.containers.map((c) => c.name),
			);
			vars.containers = names.join(", ");
			vars.agentName = event.agents[0]?.agentName ?? "";
			vars.count = String(names.length);
		} else if (event.type === "update_success") {
			vars.agentName = event.agentName;
			vars.containers = event.containers.map((c) => c.name).join(", ");
			vars.count = String(event.containers.length);
		} else if (event.type === "update_failed") {
			vars.agentName = event.agentName;
			vars.containers = event.containers.map((c) => c.name).join(", ");
			vars.count = String(event.containers.length);
		}
		return interpolateTemplate(options.template, vars);
	}

	const linkTpl = options?.linkTemplate ?? null;

	switch (event.type) {
		case "update_available": {
			if (event.agents.length === 1) {
				const agent = event.agents[0]!;
				const items = agent.containers
					.map((c) =>
						appendLink(
							`\u2022 ${formatContainerName(c.name, c.image)}`,
							c.image,
							linkTpl,
						),
					)
					.join("\n");
				return `\uD83D\uDD14 Updates Available \u2014 ${agent.agentName}\n\n${items}`;
			}
			// Multiple agents
			const totalContainers = event.agents.reduce(
				(sum, a) => sum + a.containers.length,
				0,
			);
			const sections = event.agents
				.map((agent) => {
					const items = agent.containers
						.map((c) =>
							appendLink(
								`  \u2022 ${formatContainerName(c.name, c.image)}`,
								c.image,
								linkTpl,
							),
						)
						.join("\n");
					return `\uD83D\uDCCD ${agent.agentName}\n${items}`;
				})
				.join("\n\n");
			return `\uD83D\uDD14 Updates Available \u2014 ${event.agents.length} agents, ${totalContainers} containers\n\n${sections}`;
		}
		case "update_success": {
			const items = event.containers
				.map((c) =>
					appendLink(
						`\u2022 ${c.name} \u2014 ${Math.round(c.durationMs / 1000)}s`,
						c.image,
						linkTpl,
					),
				)
				.join("\n");
			return `\u2705 Update Complete \u2014 ${event.agentName}\n\n${items}`;
		}
		case "update_failed": {
			const items = event.containers
				.map((c) => `\u2022 ${c.name} \u2014 ${c.error}`)
				.join("\n");
			return `\u274C Update Failed \u2014 ${event.agentName}\n\n${items}`;
		}
	}
}

export async function sendTelegram(
	config: { botToken: string; chatId: string },
	event: NotificationEvent,
	options?: FormatOptions,
): Promise<void> {
	const text = formatTelegramMessage(event, options);
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
