import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendNtfy } from '../senders/ntfy.js';
import type { NotificationEvent } from '../types.js';

describe('ntfy sender', () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = vi.fn();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends POST to server/topic with title header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const event: NotificationEvent = {
      type: 'update_available',
      agents: [
        {
          agentName: 'local',
          containers: [{ name: 'nginx', image: 'nginx:latest' }],
        },
      ],
    };

    await sendNtfy({ topic: 'watchwarden' }, event);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    const [url, opts] = call;
    expect(url).toBe('https://ntfy.sh/watchwarden');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Title).toContain('Updates Available');
    expect(opts.body).toContain('nginx');
  });

  it('uses custom server URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    await sendNtfy(
      { server: 'https://ntfy.example.com', topic: 'alerts' },
      {
        type: 'update_success',
        agentName: 'prod',
        containers: [{ name: 'app', image: 'app:latest', durationMs: 5000 }],
      },
    );

    expect((mockFetch.mock.calls[0] as [string])[0]).toBe('https://ntfy.example.com/alerts');
  });

  it('sets priority header when not default', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    await sendNtfy(
      { topic: 'test', priority: 'high' },
      {
        type: 'update_success',
        agentName: 'local',
        containers: [{ name: 'app', image: 'app:latest', durationMs: 100 }],
      },
    );

    const opts = mockFetch.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(opts.headers.Priority).toBe('high');
  });

  it('sets auth header when token provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    await sendNtfy(
      { topic: 'test', token: 'tk_secret' },
      {
        type: 'update_success',
        agentName: 'local',
        containers: [{ name: 'app', image: 'app:latest', durationMs: 100 }],
      },
    );

    const opts = mockFetch.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(opts.headers.Authorization).toBe('Bearer tk_secret');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(
      sendNtfy(
        { topic: 'test' },
        {
          type: 'update_success',
          agentName: 'local',
          containers: [{ name: 'app', image: 'app:latest', durationMs: 100 }],
        },
      ),
    ).rejects.toThrow('429');
  });
});
