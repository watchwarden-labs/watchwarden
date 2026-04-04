import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import type { FastifyPluginAsync } from 'fastify';
import {
  countContainers,
  getLastCheckTime,
  listAgents,
  listAllContainersWithAgent,
} from '../../db/queries.js';
import {
  getDebugUntil,
  getLogLevel,
  isFileLoggingEnabled,
  readLogTail,
  setFileLoggingEnabled,
  setLogLevel,
} from '../../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

// Read controller version from package.json at startup
let controllerVersion = 'unknown';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
  controllerVersion = pkg.version ?? 'unknown';
} catch {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    controllerVersion = pkg.version ?? 'unknown';
  } catch {
    // Give up
  }
}

export { controllerVersion };

const metaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  // --- Versions ---
  fastify.get('/api/meta/versions', async () => {
    const agents = await listAgents();
    return {
      controller_version: controllerVersion,
      agents: agents.map(({ token_hash: _, ...a }) => ({
        id: a.id,
        name: a.name,
        hostname: a.hostname,
        online: a.status === 'online',
        status: a.status,
        agent_version: a.agent_version ?? 'unknown',
        docker_version: a.docker_version,
        os: a.os,
        arch: a.arch,
      })),
    };
  });

  // --- Logging settings (level + file logging) ---
  fastify.get('/api/meta/logging', async () => ({
    log_level: getLogLevel(),
    debug_until: getDebugUntil(),
    file_logging_enabled: isFileLoggingEnabled(),
  }));

  fastify.post<{
    Body: { log_level?: string; ttl_minutes?: number; file_logging_enabled?: boolean };
  }>('/api/meta/logging', async (request, reply) => {
    const { log_level, ttl_minutes, file_logging_enabled } = request.body ?? {};

    if (log_level !== undefined) {
      if (!['error', 'warn', 'info', 'debug'].includes(log_level)) {
        return reply.code(400).send({ error: 'Invalid log_level. Use: error, warn, info, debug' });
      }
      setLogLevel(log_level, ttl_minutes);
    }

    if (file_logging_enabled !== undefined) {
      setFileLoggingEnabled(file_logging_enabled);
    }

    return {
      log_level: getLogLevel(),
      debug_until: getDebugUntil(),
      file_logging_enabled: isFileLoggingEnabled(),
    };
  });

  // Keep old endpoints for backward compat
  fastify.get('/api/meta/log-level', async () => ({
    level: getLogLevel(),
    debug_until: getDebugUntil(),
  }));

  fastify.post<{ Body: { level: string; ttl_minutes?: number } }>(
    '/api/meta/log-level',
    async (request, reply) => {
      const { level, ttl_minutes } = request.body ?? {};
      if (!level || !['error', 'warn', 'info', 'debug'].includes(level)) {
        return reply.code(400).send({ error: 'Invalid level. Use: error, warn, info, debug' });
      }
      setLogLevel(level, ttl_minutes);
      return { level: getLogLevel(), debug_until: getDebugUntil() };
    },
  );

  // --- Diagnostics bundle (ZIP) ---
  fastify.post(
    '/api/meta/diagnostics-bundle',
    {
      config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const [agents, counts, lastCheck, containers] = await Promise.all([
        listAgents(),
        countContainers(),
        getLastCheckTime(),
        listAllContainersWithAgent(),
      ]);

      const logTail = readLogTail();
      const logsIncluded = logTail !== null;
      const notes: string[] = [];

      if (!isFileLoggingEnabled()) {
        notes.push(
          'File logging is disabled. Enable it in Settings → About → "Include controller logs" to capture logs for diagnostics.',
        );
      } else if (!logsIncluded) {
        notes.push('File logging is enabled but no log data has been written yet.');
      }

      const diagnostics = {
        generated_at: new Date().toISOString(),
        controller_version: controllerVersion,
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: Math.floor(process.memoryUsage.rss() / 1024 / 1024),
        log_level: getLogLevel(),
        debug_until: getDebugUntil(),
        file_logging_enabled: isFileLoggingEnabled(),
        logs_included: logsIncluded,
        notes,
        agents: agents.map(({ token_hash: _, ...a }) => ({
          id: a.id,
          name: a.name,
          hostname: a.hostname,
          status: a.status,
          agent_version: a.agent_version,
          docker_version: a.docker_version,
          os: a.os,
          arch: a.arch,
          last_seen: a.last_seen ? new Date(a.last_seen).toISOString() : null,
        })),
        summary: {
          containers_total: counts.total,
          containers_with_updates: counts.withUpdates,
          unhealthy_containers: counts.unhealthy,
          agents_online: agents.filter((a) => a.status === 'online').length,
          agents_total: agents.length,
          last_check: lastCheck ? new Date(lastCheck).toISOString() : null,
        },
        containers: containers.map((c) => ({
          name: c.name,
          agent_name: c.agent_name,
          image: c.image,
          status: c.status,
          health_status: c.health_status,
          has_update: !!c.has_update,
          policy: c.policy,
          excluded: !!c.excluded,
        })),
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const archive = archiver('zip', { zlib: { level: 9 } });
      const passthrough = new PassThrough();
      archive.pipe(passthrough);

      archive.append(JSON.stringify(diagnostics, null, 2), { name: 'diagnostics.json' });
      if (logTail) {
        archive.append(logTail, { name: 'logs/controller.log' });
      }

      await archive.finalize();

      reply
        .type('application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="watchwarden-diagnostics-${timestamp}.zip"`,
        );
      return reply.send(passthrough);
    },
  );
};

export default metaRoutes;
