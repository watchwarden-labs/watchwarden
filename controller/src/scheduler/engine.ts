import cron from 'node-cron';
import { getConfig, listAgents, setConfig } from '../db/queries.js';
import { log } from '../lib/logger.js';
import { expectCheckResults } from '../notifications/session-batcher.js';
import type { AgentHub } from '../ws/hub.js';

export class Scheduler {
  private hub: AgentHub;
  private globalTask: cron.ScheduledTask | null = null;
  private agentTasks = new Map<string, cron.ScheduledTask>();
  private cleanupTask: cron.ScheduledTask | null = null;
  private running = false;

  constructor(hub: AgentHub) {
    this.hub = hub;
  }

  async init(): Promise<void> {
    // L2 FIX: optionally run a catch-up check if the last scheduled run was
    // missed (e.g., controller restarted just before the cron fired).
    // Guarded by the "check_on_startup" config flag — disabled by default so
    // operators aren't surprised by Docker pulls on every restart.
    const checkOnStartup = (await getConfig('check_on_startup')) === 'true';
    if (checkOnStartup) {
      const lastRun = await getConfig('scheduler_last_run');
      if (lastRun) {
        const elapsed = Date.now() - Number(lastRun);
        // If the last run was more than 24h ago, trigger a staggered catch-up
        if (elapsed > 24 * 60 * 60 * 1000) {
          log.info(
            'scheduler',
            `Last check was ${Math.round(elapsed / 3600000)}h ago — triggering catch-up`,
          );
          setTimeout(() => this.runGlobalCheckStaggered(), 10000);
        }
      }
    }

    const schedule = (await getConfig('global_schedule')) ?? '0 4 * * *';
    if (!cron.validate(schedule)) {
      log.warn(
        'scheduler',
        `[scheduler] Invalid global_schedule from DB: "${schedule}", using default`,
      );
      this.createGlobalTask('0 4 * * *');
    } else {
      this.createGlobalTask(schedule);
    }
    this.running = true;
    log.info('scheduler', `Scheduler initialized with global schedule: "${schedule}"`);

    // Load per-agent overrides
    const agents = await listAgents();
    for (const agent of agents) {
      if (agent.schedule_override) {
        this.createAgentTask(agent.id, agent.schedule_override);
      }
    }

    // Daily cleanup: prune log tables older than 90 days
    this.cleanupTask = cron.schedule('0 3 * * *', () => {
      this.runLogRetention().catch((err) =>
        log.error('scheduler', 'Log retention failed', { error: String(err) }),
      );
    });
  }

  private async runLogRetention(): Promise<void> {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const { sql } = await import('../db/client.js');
    await sql`DELETE FROM update_log WHERE created_at < ${cutoff}`;
    await sql`DELETE FROM notification_logs WHERE created_at < ${cutoff}`;
    await sql`DELETE FROM audit_log WHERE created_at < ${cutoff}`;
    await sql`DELETE FROM scan_results WHERE scanned_at < ${cutoff}`;
    log.info('scheduler', 'Log retention completed — pruned entries older than 90 days');
  }

  updateGlobalSchedule(expression: string): void {
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
    if (this.globalTask) {
      this.globalTask.stop();
    }
    this.createGlobalTask(expression);
    log.info('scheduler', `Global schedule updated to: "${expression}"`);
  }

  setAgentScheduleOverride(agentId: string, expression: string | null): void {
    const existing = this.agentTasks.get(agentId);
    if (existing) {
      existing.stop();
      this.agentTasks.delete(agentId);
    }

    if (expression) {
      if (!cron.validate(expression)) {
        throw new Error(`Invalid cron expression: ${expression}`);
      }
      this.createAgentTask(agentId, expression);
    }
  }

  stop(): void {
    if (this.globalTask) {
      this.globalTask.stop();
      this.globalTask = null;
    }
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }
    for (const task of this.agentTasks.values()) {
      task.stop();
    }
    this.agentTasks.clear();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private createGlobalTask(expression: string): void {
    this.globalTask = cron.schedule(expression, () => {
      this.runGlobalCheck();
    });
  }

  private createAgentTask(agentId: string, expression: string): void {
    // FIX-3.2: add a random jitter (0-5s) to agent-level tasks so agents
    // sharing the same cron expression (e.g. "0 4 * * *") don't fire
    // simultaneously, avoiding a thundering-herd on the Docker registry.
    const task = cron.schedule(expression, () => {
      const jitterMs = Math.floor(Math.random() * 5000);
      setTimeout(() => this.hub.sendToAgent(agentId, { type: 'CHECK', payload: {} }), jitterMs);
    });
    this.agentTasks.set(agentId, task);
  }

  private runGlobalCheck(): void {
    log.info('scheduler', 'Global check triggered');
    // OBS-03: log DB errors so a transient write failure is visible in logs.
    setConfig('scheduler_last_run', String(Date.now())).catch((err) =>
      log.warn('scheduler', `Failed to persist scheduler_last_run: ${err}`),
    );
    // SCALE-02: stagger CHECK commands 2s apart to avoid a simultaneous docker-pull
    // storm across all agents when the global schedule fires.
    this.runGlobalCheckStaggered();
  }

  /** Sends CHECK to all online agents with a 2-second stagger between each — SCALE-02. */
  private runGlobalCheckStaggered(): void {
    const onlineIds = this.hub.getOnlineAgentIds();
    const overrideIds = new Set(this.agentTasks.keys());
    const targetIds = onlineIds.filter((id) => !overrideIds.has(id));

    // Tell the batcher how many agents to expect so it waits for all
    // results before dispatching a single batched notification.
    if (targetIds.length > 0) {
      expectCheckResults(targetIds.length);
    }

    let delay = 0;
    for (const agentId of targetIds) {
      setTimeout(() => this.hub.sendToAgent(agentId, { type: 'CHECK', payload: {} }), delay);
      delay += 2000; // 2s per agent
    }
  }
}
