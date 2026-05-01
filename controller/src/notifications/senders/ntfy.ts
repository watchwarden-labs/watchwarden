import { renderImageLink } from '../template-helpers.js';
import type { NotificationEvent } from '../types.js';
import type { FormatOptions } from './telegram.js';

interface NtfyConfig {
  server?: string;
  topic: string;
  priority?: string;
  token?: string;
}

export async function sendNtfy(
  config: NtfyConfig,
  event: NotificationEvent,
  options?: FormatOptions,
): Promise<void> {
  const server = config.server?.replace(/\/+$/, '') || 'https://ntfy.sh';
  const url = `${server}/${config.topic}`;

  const title = formatTitle(event);
  const body = formatBody(event, options?.linkTemplate ?? null);

  const headers: Record<string, string> = {
    Title: title,
  };
  if (config.priority && config.priority !== 'default') {
    headers.Priority = config.priority;
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`ntfy returned ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function formatTitle(event: NotificationEvent): string {
  switch (event.type) {
    case 'update_available': {
      if (event.agents.length === 1) {
        return `Updates Available — ${event.agents[0]?.agentName ?? 'WatchWarden'}`;
      }
      return `Updates Available — ${event.agents.length} agents`;
    }
    case 'update_success': {
      if (event.agents.length === 1) {
        return `Update Complete — ${event.agents[0]?.agentName ?? 'WatchWarden'}`;
      }
      return `Update Complete — ${event.agents.length} agents`;
    }
    case 'update_failed': {
      if (event.agents.length === 1) {
        return `Update Failed — ${event.agents[0]?.agentName ?? 'WatchWarden'}`;
      }
      return `Update Failed — ${event.agents.length} agents`;
    }
    default:
      return 'WatchWarden Notification';
  }
}

function formatBody(event: NotificationEvent, linkTemplate: string | null): string {
  if (event.type === 'update_available') {
    const lines: string[] = [];
    for (const agent of event.agents) {
      for (const c of agent.containers) {
        let line = `${c.name} (${c.image})`;
        const link = linkTemplate ? renderImageLink(c.image, linkTemplate) : '';
        if (link) line += `\n  ${link}`;
        lines.push(line);
      }
    }
    return lines.join('\n') || 'Updates available';
  }
  if (event.type === 'update_success') {
    const lines: string[] = [];
    for (const agent of event.agents) {
      for (const c of agent.containers) {
        let line = `✓ ${c.name} (${Math.round(c.durationMs / 1000)}s)`;
        const link = linkTemplate ? renderImageLink(c.image, linkTemplate) : '';
        if (link) line += `\n  ${link}`;
        lines.push(line);
      }
    }
    return lines.join('\n');
  }
  if (event.type === 'update_failed') {
    const lines: string[] = [];
    for (const agent of event.agents) {
      for (const c of agent.containers) {
        lines.push(`✗ ${c.name}: ${c.error}`);
      }
    }
    return lines.join('\n');
  }
  return '';
}
