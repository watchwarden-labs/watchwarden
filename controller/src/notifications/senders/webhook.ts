import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { renderImageLink } from '../template-helpers.js';
import type { NotificationEvent } from '../types.js';
import type { FormatOptions } from './telegram.js';

const BLOCKED_URL_PATTERN =
  /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/i;

// Matches private/link-local IP ranges for post-DNS-resolution check (SEC-01).
const BLOCKED_IP_PATTERN =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$|fd[0-9a-f]{2}:)/i;

// SEC-04: only allow header name prefixes that cannot interfere with routing,
// authentication bypass, or connection-level smuggling.
const BLOCKED_HEADER_PATTERN =
  /^(host|content-length|transfer-encoding|connection|upgrade|te|trailer|x-forwarded|forwarded|proxy-)$/i;

function validateCustomHeaders(headers: Record<string, string>): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (BLOCKED_HEADER_PATTERN.test(name.trim())) {
      // Silently drop dangerous headers rather than hard-failing so a
      // misconfigured channel still sends notifications.
      continue;
    }
    validated[name] = value;
  }
  return validated;
}

export async function sendWebhook(
  config: { url: string; method?: string; headers?: Record<string, string> },
  event: NotificationEvent,
  options?: FormatOptions,
): Promise<void> {
  // Fast path: block obvious private URL strings.
  if (BLOCKED_URL_PATTERN.test(config.url)) {
    throw new Error('Webhook URLs pointing to private/internal networks are not allowed');
  }

  let parsed: URL;
  try {
    parsed = new URL(config.url);
  } catch {
    throw new Error('Invalid webhook URL');
  }

  // SEC-01: resolve the hostname and validate the IP *before* opening a socket.
  // We then pass the resolved IP directly to http(s).request so Node.js never
  // performs a second DNS lookup at connection time — eliminating the TOCTOU
  // window that a DNS-rebinding attack exploits.
  let resolvedAddress: string;
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (BLOCKED_IP_PATTERN.test(address)) {
      throw new Error(`Webhook URL resolves to a private/internal IP (${address}) — not allowed`);
    }
    resolvedAddress = address;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      throw new Error(`Webhook hostname not found: ${parsed.hostname}`);
    }
    throw err;
  }

  const isHttps = parsed.protocol === 'https:';
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : isHttps ? 443 : 80;
  const path = parsed.pathname + (parsed.search ?? '');

  // Enrich event with image links when a link template is configured
  let payload: unknown = event;
  const linkTpl = options?.linkTemplate ?? null;
  if (linkTpl) {
    if (event.type === 'update_available') {
      payload = {
        ...event,
        agents: event.agents.map((a) => ({
          ...a,
          containers: a.containers.map((c) => ({
            ...c,
            link: renderImageLink(c.image, linkTpl),
          })),
        })),
      };
    } else if (event.type === 'update_success') {
      payload = {
        ...event,
        agents: event.agents.map((a) => ({
          ...a,
          containers: a.containers.map((c) => ({
            ...c,
            link: renderImageLink(c.image, linkTpl),
          })),
        })),
      };
    } else {
      payload = event;
    }
  }
  const body = JSON.stringify(payload);

  const safeHeaders = validateCustomHeaders(config.headers ?? {});

  // SEC-01: connect to the pre-resolved IP; set Host + servername so virtual
  // hosting and TLS SNI use the original hostname (required for certificate
  // validation and correct routing through CDN/reverse-proxies).
  await new Promise<void>((resolve, reject) => {
    const reqOptions: https.RequestOptions = {
      method: config.method ?? 'POST',
      hostname: resolvedAddress, // IP — no second DNS lookup
      port,
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Host: parsed.host, // original hostname for routing
        ...safeHeaders,
      },
      // TLS-only: original hostname for SNI + cert CN/SAN validation
      ...(isHttps ? { servername: parsed.hostname } : {}),
    };

    // N01: 10-second timeout via socket-level deadline.
    const reqModule = isHttps ? https : http;
    const req = reqModule.request(reqOptions, (res) => {
      // Drain the response body to free the socket
      res.resume();
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      });
    });

    req.setTimeout(10_000, () => {
      req.destroy(new Error('Webhook request timed out after 10s'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
