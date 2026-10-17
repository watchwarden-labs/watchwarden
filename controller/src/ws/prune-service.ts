import { randomUUID } from 'node:crypto';
import { getAgent, listAgents } from '../db/queries.js';
import { log } from '../lib/logger.js';
import type {
  Agent,
  PruneAgentOutcome,
  PrunePreviewPayload,
  PruneResultPayload,
  PruneRunSummary,
} from '../types.js';
import type { UIEvent } from './ui-broadcaster.js';

export const MAX_KEEP_PREVIOUS = 10;
const PRUNE_TIMEOUT_MS = 5.5 * 60_000; // agent gives up after 5 minutes
const PREVIEW_TIMEOUT_MS = 60_000;

export interface PruneOptions {
  keepPrevious: number;
  dryRun: boolean;
  includeStopped: boolean;
}

/** Error carrying the HTTP status the API should answer with. */
export class PruneError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Validates user-supplied options; anything malformed is a 400, never silently coerced. */
export function parsePruneOptions(input: unknown): PruneOptions {
  const body = (input ?? {}) as Record<string, unknown>;
  const keep = body.keepPrevious === undefined ? 1 : body.keepPrevious;
  if (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 0 || keep > MAX_KEEP_PREVIOUS) {
    throw new PruneError(400, `keepPrevious must be an integer between 0 and ${MAX_KEEP_PREVIOUS}`);
  }
  for (const flag of ['dryRun', 'includeStopped'] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== 'boolean') {
      throw new PruneError(400, `${flag} must be a boolean`);
    }
  }
  return {
    keepPrevious: keep,
    dryRun: body.dryRun === true,
    includeStopped: body.includeStopped === true,
  };
}

export interface PruneHub {
  sendAndWait(
    agentId: string,
    message: { type: string; payload: Record<string, unknown> },
    timeoutMs?: number,
  ): Promise<unknown>;
  setLegacyPrune(agentId: string, requestId: string | null): void;
  getOnlineAgentIds(): string[];
}

export interface PruneBroadcaster {
  broadcast(event: UIEvent): void;
}

interface PruneStore {
  getAgent(id: string): Promise<Agent | undefined>;
  listAgents(): Promise<Agent[]>;
}

/**
 * Coordinates image pruning: per-agent runs, previews, and the sequential
 * "prune all agents" run. Agents report progress through the hub; this
 * service turns the final result into UI events.
 */
export class PruneService {
  private active = new Set<string>();
  private run: PruneRunSummary | null = null;

  constructor(
    private readonly hub: PruneHub,
    private readonly broadcaster: PruneBroadcaster,
    private readonly store: PruneStore = { getAgent, listAgents },
  ) {}

  isPruning(agentId: string): boolean {
    return this.active.has(agentId);
  }

  /** The running prune-all, or the last finished one (null if none since boot). */
  getRun(): PruneRunSummary | null {
    return this.run;
  }

  async preview(
    agentId: string,
    opts: Pick<PruneOptions, 'keepPrevious' | 'includeStopped'>,
  ): Promise<PrunePreviewPayload> {
    const agent = await this.requireOnlineAgent(agentId);
    try {
      const result = (await this.hub.sendAndWait(
        agent.id,
        { type: 'PRUNE_PREVIEW', payload: { ...opts } },
        PREVIEW_TIMEOUT_MS,
      )) as PrunePreviewPayload;
      return result;
    } catch (err) {
      throw new PruneError(504, err instanceof Error ? err.message : 'Agent did not respond');
    }
  }

  /** Validates, marks the agent busy and starts pruning in the background. */
  async startPrune(agentId: string, opts: PruneOptions): Promise<void> {
    const agent = await this.requireOnlineAgent(agentId);
    if (this.active.has(agent.id)) {
      throw new PruneError(409, 'A prune is already running on this agent');
    }
    this.active.add(agent.id); // synchronously, so a second request sees it
    void this.execute(agent, opts);
  }

  /** Starts a sequential prune of every online agent; offline agents are skipped. */
  async startRun(opts: PruneOptions): Promise<PruneRunSummary> {
    if (this.run?.status === 'running') {
      throw new PruneError(409, 'A prune of all agents is already running');
    }
    const agents = await this.store.listAgents();
    const online = new Set(this.hub.getOnlineAgentIds());
    const summary: PruneRunSummary = {
      runId: randomUUID(),
      dryRun: opts.dryRun,
      status: 'running',
      startedAt: Date.now(),
      results: [],
      totals: {
        agents: agents.length,
        imagesRemoved: 0,
        containersRemoved: 0,
        spaceReclaimed: 0,
        failed: 0,
        skipped: 0,
      },
    };
    this.run = summary;
    void this.executeRun(summary, agents, online, opts);
    return summary;
  }

  private async requireOnlineAgent(agentId: string): Promise<Agent> {
    const agent = await this.store.getAgent(agentId);
    if (!agent) throw new PruneError(404, 'Agent not found');
    if (agent.status !== 'online' || !this.hub.getOnlineAgentIds().includes(agent.id)) {
      throw new PruneError(409, 'Agent is not online');
    }
    return agent;
  }

  private async executeRun(
    summary: PruneRunSummary,
    agents: Agent[],
    online: Set<string>,
    opts: PruneOptions,
  ): Promise<void> {
    const total = agents.length;
    try {
      for (const [index, agent] of agents.entries()) {
        const progress = { type: 'PRUNE_RUN_PROGRESS', runId: summary.runId, index, total };
        let outcome: PruneAgentOutcome;
        if (!online.has(agent.id)) {
          outcome = this.emptyOutcome(agent, 'skipped', 'Agent is offline');
        } else if (this.active.has(agent.id)) {
          outcome = this.emptyOutcome(agent, 'failed', 'A prune is already running on this agent');
        } else {
          this.broadcaster.broadcast({
            ...progress,
            agentId: agent.id,
            agentName: agent.name,
            state: 'running',
          });
          this.active.add(agent.id);
          outcome = await this.execute(agent, opts);
        }
        summary.results.push(outcome);
        const t = summary.totals;
        t.imagesRemoved += outcome.imagesRemoved;
        t.containersRemoved += outcome.containersRemoved;
        t.spaceReclaimed += outcome.spaceReclaimed;
        if (outcome.status === 'failed') t.failed++;
        if (outcome.status === 'skipped') t.skipped++;
        this.broadcaster.broadcast({
          ...progress,
          agentId: agent.id,
          agentName: agent.name,
          state: outcome.status,
        });
      }
    } catch (err) {
      log.error('prune', 'Prune-all run aborted', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      summary.status = 'complete';
      this.broadcaster.broadcast({ type: 'PRUNE_RUN_COMPLETE', ...summary });
    }
  }

  /** Runs one prune on an agent already marked active; always clears the mark. */
  private async execute(agent: Agent, opts: PruneOptions): Promise<PruneAgentOutcome> {
    const requestId = randomUUID();
    this.broadcaster.broadcast({
      type: 'PRUNE_STARTED',
      agentId: agent.id,
      dryRun: opts.dryRun,
    });
    this.hub.setLegacyPrune(agent.id, requestId);

    let outcome: PruneAgentOutcome;
    let result: PruneResultPayload | null = null;
    try {
      result = (await this.hub.sendAndWait(
        agent.id,
        { type: 'PRUNE', payload: { requestId, ...opts } },
        PRUNE_TIMEOUT_MS,
      )) as PruneResultPayload;
      const errors = result.errors ?? [];
      const removed = (result.imagesRemoved ?? 0) + (result.containersRemoved ?? 0);
      outcome = {
        agentId: agent.id,
        agentName: agent.name,
        status: errors.length === 0 ? 'success' : removed > 0 ? 'partial' : 'failed',
        imagesRemoved: result.imagesRemoved ?? 0,
        containersRemoved: result.containersRemoved ?? 0,
        spaceReclaimed: result.spaceReclaimed ?? 0,
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('prune', `Prune failed on agent ${agent.name}`, { error: message });
      outcome = this.emptyOutcome(agent, 'failed', message);
    } finally {
      this.hub.setLegacyPrune(agent.id, null);
      this.active.delete(agent.id);
    }

    this.broadcaster.broadcast({
      type: 'PRUNE_COMPLETE',
      dryRun: opts.dryRun,
      ...outcome,
      details: result?.details ?? [],
    });
    log.info(
      'prune',
      `${opts.dryRun ? 'Dry-run prune' : 'Prune'} on ${agent.name}: ${outcome.status}`,
      {
        images: outcome.imagesRemoved,
        containers: outcome.containersRemoved,
        bytes: outcome.spaceReclaimed,
      },
    );
    return outcome;
  }

  private emptyOutcome(
    agent: Agent,
    status: 'failed' | 'skipped',
    error: string,
  ): PruneAgentOutcome {
    return {
      agentId: agent.id,
      agentName: agent.name,
      status,
      imagesRemoved: 0,
      containersRemoved: 0,
      spaceReclaimed: 0,
      errors: [],
      error,
    };
  }
}
