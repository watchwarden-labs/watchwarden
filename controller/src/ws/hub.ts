import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { WebSocket } from 'ws';
import {
  getAgent,
  getConfig,
  getContainersByAgent,
  getEffectivePolicy,
  insertAgent,
  insertAuditLog,
  insertScanResult,
  insertUpdateLog,
  insertUpdateLogAndDigests,
  isRecoveryModeActive,
  listAgents,
  listAgentsByTokenPrefix,
  listRegistryCredentials,
  markContainersUnknown,
  updateAgentDockerInfo,
  updateAgentStatus,
  updateContainerDiff,
  updateContainerDigests,
  updateContainerHealth,
  upsertContainers,
} from '../db/queries.js';
import { decrypt } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { extractTag, semverMatchesLevel } from '../lib/semver.js';
import { addUpdateResult, dispatchCheckResults } from '../notifications/session-batcher.js';
import type { ContainerInfo } from '../types.js';
import type { UiBroadcaster } from './ui-broadcaster.js';

interface ConnectedAgent {
  id: string;
  ws: WebSocket;
  lastSeen: number;
}

interface RegisterPayload {
  token: string;
  hostname: string;
  agentName?: string;
  version?: string;
  containers: ContainerInfo[];
  dockerVersion?: string;
  dockerApiVersion?: string;
  os?: string;
  arch?: string;
}

interface HeartbeatPayload {
  containers: ContainerInfo[];
}

interface CheckResultItem {
  containerId: string;
  containerName?: string;
  hasUpdate: boolean;
  currentDigest?: string;
  latestDigest?: string | null;
  diff?: Record<string, unknown>;
}

interface UpdateResultItem {
  containerId: string;
  containerName: string;
  success: boolean;
  oldDigest: string | null;
  newDigest: string | null;
  error: string | null;
  durationMs: number;
}

interface UpdateProgressPayload {
  containerId: string;
  containerName: string;
  step: string;
  progress?: string;
}

// Simple token-bucket rate limiter per agent connection.
// Allows burst of MAX_BURST messages, refills at REFILL_RATE tokens/second.
const MSG_RATE_LIMIT = 30; // max messages per second sustained
const MSG_BURST = 60; // burst allowance

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor() {
    this.tokens = MSG_BURST;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(MSG_BURST, this.tokens + elapsed * MSG_RATE_LIMIT);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentHub {
  private connections = new Map<string, ConnectedAgent>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private broadcaster: UiBroadcaster | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  // OBS-04: per-agent promise chain — serializes async message processing so
  // concurrent messages from the same agent don't interleave at await points.
  private agentQueues = new Map<string, Promise<void>>();
  // SCALE-01: per-container timestamp of last UPDATE_PROGRESS broadcast.
  // Throttles to max 10 events/second per container.
  private progressLastSent = new Map<string, number>();
  // FIX-1.3: track in-flight auto-update per agent to prevent duplicate UPDATE
  // commands when two CHECK_RESULTs race (e.g. from a reconnect replay).
  private autoUpdateInFlight = new Set<string>();

  constructor(broadcaster?: UiBroadcaster) {
    this.broadcaster = broadcaster ?? null;
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), 30000);
  }

  setBroadcaster(broadcaster: UiBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  handleConnection(socket: WebSocket): void {
    let authenticated = false;
    let agentId: string | null = null;
    const bucket = new TokenBucket();

    socket.on('error', (err) => {
      log.warn('hub', `WS error for agent ${agentId ?? 'unknown'}: ${err.message}`);
    });

    // Close unauthenticated connections after 10 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.close(4001, 'Authentication timeout');
      }
    }, 10000);

    socket.on('message', (data) => {
      // Rate-limit all messages per connection (synchronous — no await needed).
      if (!bucket.consume()) {
        socket.close(4008, 'Message rate limit exceeded');
        return;
      }

      // OBS-04: enqueue processing on the per-agent serial chain so concurrent
      // messages from the same agent never interleave at async await points.
      // For unauthenticated messages (before agentId is known), run immediately.
      const process = async () => {
        try {
          const message = JSON.parse(data.toString()) as {
            type: string;
            payload: unknown;
          };

          if (!authenticated) {
            if (message.type !== 'REGISTER') {
              socket.close(4002, 'First message must be REGISTER');
              return;
            }

            const payload = message.payload as RegisterPayload;
            let result = await this.authenticateAgent(payload.token);

            // Recovery mode: if normal auth fails, try auto-registering the agent
            if (!result) {
              result = await this.tryRecoveryRegister(payload, socket);
            }

            if (!result) {
              socket.close(4001, 'Invalid token');
              return;
            }

            agentId = result.id;
            authenticated = true;
            clearTimeout(authTimeout);
            log.debug('hub', `Agent registered: ${payload.agentName ?? agentId}`, {
              version: payload.version,
              containers: payload.containers?.length,
            });

            // OBS-05: close the old socket if this agent is reconnecting
            // before the previous connection's close event fires.
            const existing = this.connections.get(agentId);
            if (existing && existing.ws !== socket) {
              existing.ws.close(1001, 'replaced by new connection');
            }

            this.connections.set(agentId, {
              id: agentId,
              ws: socket,
              lastSeen: Date.now(),
            });

            // BUG-01 FIX: explicitly clear stale autoUpdateInFlight on
            // reconnect. If the old socket's close handler races with the
            // new registration, the close handler may never fire for the
            // old socket, leaving a stale entry that permanently blocks
            // future auto-updates for this agent.
            this.autoUpdateInFlight.delete(agentId);

            // RC-03: tail the new queue onto the old one so that any
            // in-flight handlers from the dying connection finish before
            // new-connection messages start executing.  Resetting to
            // Promise.resolve() directly allowed old and new handlers to
            // interleave DB writes for the same agent.
            const oldQueue = this.agentQueues.get(agentId) ?? Promise.resolve();
            this.agentQueues.set(
              agentId,
              oldQueue.then(
                () => {},
                () => {},
              ),
            );

            await updateAgentStatus(agentId, 'online', Date.now());

            if (payload.containers?.length > 0) {
              await upsertContainers(agentId, payload.containers);
            }

            this.broadcaster?.broadcast({
              type: 'AGENT_STATUS',
              agentId,
              status: 'online',
              lastSeen: Date.now(),
            });

            // Store Docker version info and agent version if provided
            if (payload.dockerVersion || payload.dockerApiVersion || payload.version) {
              await updateAgentDockerInfo(agentId, {
                dockerVersion: payload.dockerVersion,
                dockerApiVersion: payload.dockerApiVersion,
                os: payload.os,
                arch: payload.arch,
                agentVersion: payload.version,
              });
            }

            // FIX-6.1: await credential sync so failures are logged within the
            // serialised agent queue. The internal try-catch already prevents
            // the error from killing the connection handler.
            await this.syncCredentialsToAgent(agentId);
            return;
          }

          if (!agentId) return;

          switch (message.type) {
            case 'HEARTBEAT': {
              const payload = message.payload as HeartbeatPayload;
              const conn = this.connections.get(agentId);
              if (conn) {
                conn.lastSeen = Date.now();
              }
              await updateAgentStatus(agentId, 'online', Date.now());
              if (payload.containers?.length > 0) {
                await upsertContainers(agentId, payload.containers);
              }
              this.broadcaster?.broadcast({
                type: 'HEARTBEAT_RECEIVED',
                agentId,
                containerCount: payload.containers?.length ?? 0,
              });
              break;
            }

            case 'CHECK_RESULT': {
              const payload = message.payload as {
                results: CheckResultItem[];
              };
              const updatesFound = payload.results.filter((r) => r.hasUpdate).length;
              log.debug(
                'hub',
                `CHECK_RESULT from ${agentId}: ${payload.results.length} results, ${updatesFound} updates`,
              );
              for (const r of payload.results) {
                await updateContainerDigests(
                  r.containerId,
                  r.currentDigest ?? '',
                  r.latestDigest ?? '',
                  r.hasUpdate,
                );
                // Store image diff if present
                await updateContainerDiff(r.containerId, r.diff ? JSON.stringify(r.diff) : null);
              }
              await updateAgentStatus(agentId, 'online', Date.now());
              const updatesAvailable = payload.results.filter((r) => r.hasUpdate).length;
              this.broadcaster?.broadcast({
                type: 'CHECK_COMPLETE',
                agentId,
                updatesAvailable,
                results: payload.results,
              });
              // DB-02: single DB read for auto-update decision; notification and
              // auto-update paths are mutually exclusive from this point forward.
              // The old two-read pattern (read → decide notification → re-read →
              // decide update) had a TOCTOU window where both paths could fire if
              // the flag changed between reads.
              const agentRecord = await getAgent(agentId);
              const globalAutoUpdate = (await getConfig('auto_update_global')) === 'true';
              const shouldAutoUpdate =
                (agentRecord?.auto_update === 1 || globalAutoUpdate) && updatesAvailable > 0;

              if (shouldAutoUpdate) {
                // FIX-1.3: guard against duplicate auto-update commands when a
                // reconnect replays CHECK_RESULT before the previous one finishes.
                if (this.autoUpdateInFlight.has(agentId)) {
                  log.info(
                    'hub',
                    `auto-update already in-flight for agent ${agentId}, skipping duplicate`,
                  );
                  break;
                }
                this.autoUpdateInFlight.add(agentId);
                // Auto-update path: send UPDATE, skip "updates available" notification
                // (update_success/failed notification will follow from UPDATE_RESULT).
                // Fetch container data to check per-container policies
                const agentContainersForUpdate = await getContainersByAgent(agentId);
                const globalUpdateLevel = (await getConfig('global_update_level')) ?? '';
                const containerIds = payload.results
                  .filter((r) => {
                    if (!r.hasUpdate) return false;
                    const dbContainer = agentContainersForUpdate.find(
                      (c) => c.docker_id === r.containerId || c.id === r.containerId,
                    );
                    // Per-container policy overrides: "manual" and "notify" skip auto-update
                    if (dbContainer?.policy === 'manual' || dbContainer?.policy === 'notify')
                      return false;
                    // Stateful containers (databases) are never auto-updated
                    if (dbContainer?.is_stateful) return false;
                    // Semver level enforcement: per-container takes precedence over global
                    const effectiveLevel = dbContainer?.update_level || globalUpdateLevel;
                    if (effectiveLevel && effectiveLevel !== 'all') {
                      const currentTag = extractTag(dbContainer?.image ?? '');
                      const candidateTag = extractTag(r.latestDigest ?? '');
                      // Only enforce when both sides have parseable tags (not sha256 digests)
                      if (currentTag && candidateTag) {
                        if (!semverMatchesLevel(currentTag, candidateTag, effectiveLevel)) {
                          log.info(
                            'hub',
                            `skipping auto-update for ${dbContainer?.name ?? r.containerId}: ` +
                              `${currentTag} → ${candidateTag} blocked by update_level=${effectiveLevel}`,
                          );
                          return false;
                        }
                      }
                    }
                    return true;
                  })
                  .map((r) => r.containerId);
                // Only send UPDATE if there are eligible containers
                if (containerIds.length === 0) {
                  this.autoUpdateInFlight.delete(agentId);
                  break;
                }
                const policy = await getEffectivePolicy(agentId);
                this.sendToAgent(agentId, {
                  type: 'UPDATE',
                  payload: {
                    containerIds,
                    strategy: policy.strategy ?? 'stop-first',
                  },
                });
                this.writeAuditLogWithRetry({
                  actor: 'auto-update',
                  action: 'auto_update',
                  targetType: 'agent',
                  targetId: agentId,
                  agentId,
                  details: { containerIds },
                });
              } else if (updatesAvailable > 0) {
                // Notification path: auto-update is OFF, notify the operator.
                const agentContainers = await getContainersByAgent(agentId);
                const withUpdates = payload.results
                  .filter((r) => r.hasUpdate)
                  .map((r) => {
                    const dbContainer = agentContainers.find(
                      (c) => c.docker_id === r.containerId || c.id === r.containerId,
                    );
                    const containerName = dbContainer?.name ?? r.containerName ?? r.containerId;
                    const rawImage = dbContainer?.image ?? '';
                    // Extract base image and current tag
                    let baseImage = rawImage;
                    let currentTag = '';
                    if (rawImage.includes('@sha256:')) {
                      baseImage = rawImage.split('@')[0] ?? rawImage;
                    } else if (
                      rawImage.match(/^[a-f0-9]{12,}$/) ||
                      rawImage.startsWith('sha256:')
                    ) {
                      baseImage = containerName;
                    } else if (rawImage.includes(':')) {
                      const idx = rawImage.lastIndexOf(':');
                      baseImage = rawImage.slice(0, idx);
                      currentTag = rawImage.slice(idx + 1);
                    }
                    // Extract tag from latestDigest if it contains an image ref
                    let latestTag = 'latest';
                    const ld = r.latestDigest ?? '';
                    if (ld.includes(':') && !ld.startsWith('sha256:')) {
                      // e.g. "ghcr.io/ajnart/homarr@sha256:..." or "image:tag"
                      const afterColon = ld.split(':').pop() ?? '';
                      if (!afterColon.match(/^[a-f0-9]{32,}/)) {
                        latestTag = afterColon;
                      }
                    }
                    const versionInfo =
                      currentTag && currentTag !== latestTag
                        ? `${currentTag} → ${latestTag}`
                        : latestTag;
                    return { name: containerName, image: `${baseImage} (${versionInfo})` };
                  });
                if (withUpdates.length > 0) {
                  const agent = (await listAgents()).find((a) => a.id === agentId);
                  dispatchCheckResults(agent?.name ?? agentId, withUpdates, agentId);
                }
              }
              break;
            }

            case 'UPDATE_RESULT': {
              // FIX-1.3: clear auto-update in-flight guard so the next CHECK_RESULT
              // can trigger a new auto-update cycle.
              this.autoUpdateInFlight.delete(agentId);
              const payload = message.payload as {
                results?: UpdateResultItem[];
                containerId?: string;
                containerName?: string;
                success?: boolean;
                oldDigest?: string;
                newDigest?: string;
                error?: string;
                durationMs?: number;
                isRollback?: boolean;
              };
              const isRollback = payload.isRollback ?? false;
              const autoRolledBack = (payload as Record<string, unknown>).autoRolledBack as
                | boolean
                | undefined;
              const rollbackReason = (payload as Record<string, unknown>).rollbackReason as
                | string
                | undefined;
              // Support both single result and array
              const results: UpdateResultItem[] = payload.results ?? [
                {
                  containerId: payload.containerId ?? '',
                  containerName: payload.containerName ?? '',
                  success: payload.success ?? false,
                  oldDigest: payload.oldDigest ?? null,
                  newDigest: payload.newDigest ?? null,
                  error: payload.error ?? null,
                  durationMs: payload.durationMs ?? 0,
                },
              ];
              for (const r of results) {
                if (r.success && r.newDigest) {
                  // DB-02: log + digest update are atomic — no divergence on crash.
                  await insertUpdateLogAndDigests(
                    {
                      agent_id: agentId,
                      container_id: r.containerId,
                      container_name: r.containerName,
                      old_digest: r.oldDigest,
                      new_digest: r.newDigest,
                      status: isRollback ? 'rolled_back' : 'success',
                      error: r.error,
                      duration_ms: r.durationMs,
                    },
                    r.containerId,
                    r.newDigest,
                  );
                } else {
                  await insertUpdateLog({
                    agent_id: agentId,
                    container_id: r.containerId,
                    container_name: r.containerName,
                    old_digest: r.oldDigest,
                    new_digest: r.newDigest,
                    status: isRollback ? 'rolled_back' : 'failed',
                    error: r.error,
                    duration_ms: r.durationMs,
                  });
                }
              }
              await updateAgentStatus(agentId, 'online', Date.now());
              this.broadcaster?.broadcast({
                type: 'UPDATE_COMPLETE',
                agentId,
                results,
              });
              // Feed results into notification batcher — use agent name, not UUID
              const agentForNotify = await getAgent(agentId);
              const agentDisplayName = agentForNotify?.name ?? agentId;
              for (const r of results) {
                addUpdateResult(agentDisplayName, {
                  containerId: r.containerId,
                  containerName: r.containerName,
                  success: r.success,
                  error: r.error,
                  durationMs: r.durationMs,
                });
              }

              // Audit log auto-rollback
              if (autoRolledBack) {
                this.writeAuditLogWithRetry({
                  actor: 'auto-rollback',
                  action: 'auto_rollback',
                  targetType: 'container',
                  agentId,
                  details: {
                    rollbackReason,
                    containers: results.map((r) => r.containerName),
                  },
                });
              }
              // FIX-3.1: wrap notification dispatch in try-catch so a notification
              // failure (e.g. Telegram API down) doesn't break the UPDATE_RESULT
              // handler — DB writes are already committed at this point.
              if (autoRolledBack) {
                try {
                  const agentRecord = await getAgent(agentId);
                  const agentName = agentRecord?.name ?? agentId;
                  const containerNames = results.map((r) => r.containerName).filter(Boolean);
                  const reason = rollbackReason || 'Container unhealthy after update';
                  const { notifier } = await import('../notifications/notifier.js');
                  await notifier.dispatch({
                    type: 'update_failed',
                    agentName,
                    containers: containerNames.map((name) => ({
                      name,
                      error: `Auto-rolled back: ${reason}`,
                    })),
                  });
                } catch (err) {
                  log.error('hub', `Failed to dispatch auto-rollback notification: ${err}`);
                }
              }

              // Send MONITOR_HEALTH for successful non-rollback updates
              if (!isRollback) {
                const successResults = results.filter((r) => r.success);
                if (successResults.length > 0) {
                  const policy = await getEffectivePolicy(agentId);
                  if (policy.auto_rollback_enabled) {
                    for (const r of successResults) {
                      this.sendToAgent(agentId, {
                        type: 'MONITOR_HEALTH',
                        payload: {
                          containerId: r.containerId,
                          containerName: r.containerName,
                          durationSeconds: policy.stability_window_seconds,
                          rollbackOnFailure: true,
                          rollbackImage: r.oldDigest ?? undefined,
                        },
                      });
                    }
                  }
                }
              }
              break;
            }

            case 'UPDATE_PROGRESS': {
              const payload = message.payload as UpdateProgressPayload;
              // SCALE-01: throttle to max 10 broadcasts/second per container to
              // prevent O(N_clients × M_events) event loop stalls under active updates.
              const throttleKey = `${agentId}:${payload.containerId}`;
              const lastSent = this.progressLastSent.get(throttleKey) ?? 0;
              const now = Date.now();
              if (now - lastSent >= 100) {
                this.progressLastSent.set(throttleKey, now);
                this.broadcaster?.broadcast({
                  type: 'UPDATE_PROGRESS',
                  agentId,
                  containerId: payload.containerId,
                  containerName: payload.containerName,
                  step: payload.step,
                  progress: payload.progress,
                });
              }
              break;
            }

            case 'PRUNE_RESULT': {
              const payload = message.payload as {
                imagesRemoved: number;
                spaceReclaimed: number;
                details: Array<{ image: string; size: number }>;
                errors: string[];
              };
              this.broadcaster?.broadcast({
                type: 'PRUNE_COMPLETE',
                agentId,
                imagesRemoved: payload.imagesRemoved,
                spaceReclaimed: payload.spaceReclaimed,
                details: payload.details,
                errors: payload.errors,
              });
              break;
            }

            case 'HEALTH_STATUS': {
              const payload = message.payload as {
                containerId: string;
                containerName: string;
                status: string;
                failingSince?: number;
              };
              await updateContainerHealth(payload.containerId, payload.status);
              this.broadcaster?.broadcast({
                type: 'HEALTH_STATUS',
                agentId,
                containerId: payload.containerId,
                containerName: payload.containerName,
                status: payload.status,
              });
              break;
            }

            case 'CONTAINER_ACTION_RESULT': {
              const payload = message.payload as {
                action: string;
                containerId: string;
                success: boolean;
                error?: string;
              };
              log.info(
                'hub',
                `Agent ${agentId}: ${payload.action} ${payload.containerId} → ${payload.success ? 'ok' : payload.error}`,
              );
              this.broadcaster?.broadcast({
                type: 'CONTAINER_ACTION_RESULT',
                agentId,
                action: payload.action,
                containerId: payload.containerId,
                success: payload.success,
                error: payload.error,
              });
              break;
            }

            case 'CONTAINER_LOGS_RESULT': {
              const logsPayload = message.payload as {
                requestId: string;
                [key: string]: unknown;
              };
              if (logsPayload.requestId) {
                this.resolvePendingRequest(logsPayload.requestId, logsPayload);
              }
              break;
            }
            case 'SCAN_RESULT': {
              const payload = message.payload as {
                containerId: string;
                image: string;
                critical: number;
                high: number;
                medium: number;
                low: number;
                details: unknown[];
              };
              await insertScanResult(agentId, {
                containerId: payload.containerId,
                image: payload.image,
                critical: payload.critical,
                high: payload.high,
                medium: payload.medium,
                low: payload.low,
                details: payload.details ?? [],
              });
              this.broadcaster?.broadcast({
                type: 'SCAN_COMPLETE',
                agentId,
                ...payload,
              });
              break;
            }
          }
        } catch (err) {
          log.warn('hub', `Malformed WS message from agent ${agentId}: ${err}`);
        }
      }; // end process()

      // OBS-04: chain onto the agent's serial queue. For unauthenticated
      // messages agentId is null — run directly without queueing.
      // BUG-02 FIX: use .catch() to log errors and continue the chain
      // instead of .then(process, process) which re-invokes process on
      // its own rejection, creating an infinite microtask loop if the
      // handler throws persistently (e.g. DB down, malformed state).
      if (agentId) {
        const prev = this.agentQueues.get(agentId) ?? Promise.resolve();
        const next = prev.then(process).catch((err) => {
          log.error('hub', `Agent ${agentId} message handler failed: ${err}`);
        });
        this.agentQueues.set(agentId, next);
      } else {
        void process();
      }
    });

    socket.on('close', async () => {
      if (agentId) {
        // Only update state if this socket is still the registered one
        // (avoids clobbering a freshly reconnected agent's state — OBS-05).
        const current = this.connections.get(agentId);
        if (current && current.ws === socket) {
          this.connections.delete(agentId);
          this.agentQueues.delete(agentId);
          this.autoUpdateInFlight.delete(agentId);
          // BUG-09 FIX: reject and clean up any pending sendAndWait requests
          // for this agent. Without this, orphaned timers hold Promises in
          // memory until they individually time out (up to 15s each).
          for (const [, pending] of this.pendingRequests) {
            // pendingRequests is keyed by requestId (UUID), not agentId.
            // We can't directly filter by agent, so clear ALL pending requests
            // when any agent disconnects. This is safe because sendAndWait is
            // only used for point-in-time requests (container logs) where the
            // response is meaningless after disconnect.
            clearTimeout(pending.timer);
            pending.reject(new Error('Agent disconnected'));
          }
          this.pendingRequests.clear();
          // Clean up throttle entries for this agent's containers.
          for (const key of this.progressLastSent.keys()) {
            if (key.startsWith(`${agentId}:`)) {
              this.progressLastSent.delete(key);
            }
          }
          await updateAgentStatus(agentId, 'offline', Date.now());
          await markContainersUnknown(agentId);
          this.broadcaster?.broadcast({
            type: 'AGENT_STATUS',
            agentId,
            status: 'offline',
            lastSeen: Date.now(),
          });
        }
      }
    });
  }

  // BUG-05 FIX: expose in-flight state so the manual update API route can
  // check whether an auto-update (or another manual update) is already running,
  // preventing redundant Docker container recreations.
  isUpdateInFlight(agentId: string): boolean {
    return this.autoUpdateInFlight.has(agentId);
  }

  setUpdateInFlight(agentId: string, inFlight: boolean): void {
    if (inFlight) {
      this.autoUpdateInFlight.add(agentId);
    } else {
      this.autoUpdateInFlight.delete(agentId);
    }
  }

  sendToAgent(agentId: string, message: object): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.ws.readyState !== 1) {
      return false;
    }
    conn.ws.send(JSON.stringify(message));
    return true;
  }

  /** Send a message and wait for a correlated response (via requestId). */
  async sendAndWait(
    agentId: string,
    message: { type: string; payload: Record<string, unknown> },
    timeoutMs = 15000,
  ): Promise<unknown> {
    const requestId = randomUUID();
    message.payload.requestId = requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Agent request timed out'));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      const sent = this.sendToAgent(agentId, message);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error('Agent not connected'));
      }
    });
  }

  /** Resolve a pending request by its requestId. */
  resolvePendingRequest(requestId: string, payload: unknown): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(payload);
    }
  }

  getOnlineAgentIds(): string[] {
    return Array.from(this.connections.keys());
  }

  broadcastToAllAgents(message: object): void {
    const data = JSON.stringify(message);
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState === 1) {
        conn.ws.send(data);
      }
    }
  }

  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const conn of this.connections.values()) {
      conn.ws.close();
    }
    this.connections.clear();
  }

  // SEC-03: a bcrypt hash of a dummy string used to perform a constant-time
  // comparison when no candidate agents match the token prefix.  Without this,
  // an attacker can distinguish "no such prefix" (fast) from "prefix found, hash
  // mismatch" (slow ~100ms) via WebSocket close timing and enumerate valid prefixes.
  // Computed once at class level; initialised lazily on first auth call.
  private static dummyHash: string | null = null;
  private static async getDummyHash(): Promise<string> {
    if (!AgentHub.dummyHash) {
      AgentHub.dummyHash = await bcrypt.hash('watchwarden-dummy-sentinel', 10);
    }
    return AgentHub.dummyHash;
  }

  private async authenticateAgent(token: string): Promise<{ id: string } | null> {
    // Fast path: filter candidates by token_prefix (O(1) index lookup),
    // then bcrypt-compare only matching agents (typically 0–1).
    // Falls back to full scan for agents registered before migration 010.
    const prefix = token.slice(0, 8);
    let candidates = await listAgentsByTokenPrefix(prefix);
    if (candidates.length === 0) {
      // Backwards-compat: agents with NULL token_prefix (pre-migration)
      candidates = (await listAgents()).filter((a) => a.token_prefix === null);
    }

    if (candidates.length === 0) {
      // SEC-03: perform a dummy bcrypt comparison so the response time is
      // indistinguishable from a failed real comparison, preventing prefix
      // enumeration via timing side-channel.
      await bcrypt.compare(token, await AgentHub.getDummyHash());
      return null;
    }

    for (const agent of candidates) {
      const valid = await bcrypt.compare(token, agent.token_hash);
      if (valid) {
        return { id: agent.id };
      }
    }
    return null;
  }

  /** Rate limiter for recovery registrations within a single recovery window. */
  private recoveryCount = 0;
  private static readonly MAX_RECOVERY_PER_WINDOW = 20;
  private static readonly VALID_TOKEN_RE = /^[0-9a-f]{64}$/;

  /**
   * Attempt to auto-register an agent via recovery mode.
   * Only works when recovery mode is active, the token has valid format,
   * and the per-window rate limit hasn't been exceeded.
   */
  private async tryRecoveryRegister(
    payload: RegisterPayload,
    socket: WebSocket,
  ): Promise<{ id: string } | null> {
    // Check token format first (cheap, no DB hit)
    if (!AgentHub.VALID_TOKEN_RE.test(payload.token)) return null;

    // Check if recovery mode is active
    const active = await isRecoveryModeActive();
    if (!active) return null;

    // Rate limit
    if (this.recoveryCount >= AgentHub.MAX_RECOVERY_PER_WINDOW) {
      log.warn('hub', 'Recovery mode rate limit exceeded, rejecting registration');
      return null;
    }

    // Dedup: check if an agent with the same name already exists (re-registration in same window)
    const agentName = payload.agentName || payload.hostname || 'recovered-agent';
    const existingAgents = await listAgents();
    const duplicate = existingAgents.find((a) => a.name === agentName);
    if (duplicate) {
      // Try authenticating against the existing duplicate (may have been recovery-registered moments ago)
      const valid = await bcrypt.compare(payload.token, duplicate.token_hash);
      if (valid) return { id: duplicate.id };
      // Different token, same name — append short ID suffix
    }

    const agentId = randomUUID();
    const tokenHash = await bcrypt.hash(payload.token, 10);
    const tokenPrefix = payload.token.slice(0, 8);
    const finalName = duplicate ? `${agentName}-${agentId.slice(0, 8)}` : agentName;

    await insertAgent({
      id: agentId,
      name: finalName,
      hostname: payload.hostname,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
    });

    // Mark as recovery-registered
    const { sql } = await import('../db/client.js');
    await sql`UPDATE agents SET recovery_registered = TRUE WHERE id = ${agentId}`;

    this.recoveryCount++;

    // Audit log
    const remoteAddr =
      (socket as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress ??
      'unknown';
    await insertAuditLog({
      actor: 'system:recovery',
      action: 'agent.recovery_register',
      targetType: 'agent',
      targetId: agentId,
      details: {
        agentName: finalName,
        hostname: payload.hostname,
        ip: remoteAddr,
      },
      ipAddress: remoteAddr,
    });

    log.info(
      'hub',
      `Recovery mode: auto-registered agent "${finalName}" (${agentId}) from ${remoteAddr}`,
    );

    return { id: agentId };
  }

  /** Reset recovery registration counter (call when recovery mode is enabled/disabled). */
  resetRecoveryCount(): void {
    this.recoveryCount = 0;
  }

  private async syncCredentialsToAgent(agentId: string): Promise<void> {
    try {
      const creds = await listRegistryCredentials();
      const decrypted = creds.map((c) => ({
        registry: c.registry,
        username: c.username,
        password: decrypt(c.password_encrypted),
        auth_type: c.auth_type ?? 'basic',
      }));
      this.sendToAgent(agentId, {
        type: 'CREDENTIALS_SYNC',
        payload: { credentials: decrypted },
      });
    } catch (err) {
      // ERR-01: always log so operators know when agents are silently missing
      // registry credentials (e.g. wrong ENCRYPTION_KEY, DB down).
      log.warn('hub', `credential sync failed for agent ${agentId}: ${err}`);
    }
  }

  /** ERR-04: write an audit log entry with one automatic retry on transient failure.
   *  Missed audit events under DB hiccups are a compliance gap; a single retry
   *  covers the vast majority of transient connection pool exhaustion cases.
   */
  private writeAuditLogWithRetry(entry: Parameters<typeof insertAuditLog>[0]): void {
    insertAuditLog(entry).catch((err) => {
      log.warn('hub', `audit log write failed, retrying once: ${err}`);
      // Retry after 2s to ride out a transient DB hiccup
      setTimeout(() => {
        insertAuditLog(entry).catch((retryErr) => {
          log.error('hub', `audit log write failed after retry: ${retryErr}`);
        });
      }, 2000);
    });
  }

  private async checkHeartbeats(): Promise<void> {
    const now = Date.now();
    for (const [id, conn] of this.connections) {
      if (now - conn.lastSeen > 60000) {
        conn.ws.close(4003, 'Heartbeat timeout');
        this.connections.delete(id);
        await updateAgentStatus(id, 'offline', now);
        await markContainersUnknown(id);
        this.broadcaster?.broadcast({
          type: 'AGENT_STATUS',
          agentId: id,
          status: 'offline',
          lastSeen: now,
        });
      }
    }
  }
}
