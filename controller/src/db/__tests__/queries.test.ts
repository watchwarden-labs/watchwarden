import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres, truncateAll } from '../../__tests__/pg-setup.js';
import type { ContainerInfo, NewAgent, NewUpdateLog } from '../../types.js';
import { sql } from '../client.js';
import {
  deleteAgent,
  getAgent,
  getAllConfig,
  getConfig,
  getContainersByAgent,
  getHistory,
  getHistoryStats,
  getNotificationChannel,
  insertAgent,
  insertNotificationChannel,
  insertUpdateLog,
  insertUpdateLogAndDigests,
  listAgents,
  setConfig,
  updateAgentConfig,
  updateAgentStatus,
  updateContainerDigests,
  updateNotificationChannel,
  upsertContainers,
} from '../queries.js';

describe('queries', () => {
  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await stopPostgres();
  });

  // --- Agent CRUD ---

  describe('agents', () => {
    const newAgent: NewAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      hostname: 'server-1',
      token_hash: '$2a$10$fakehash',
    };

    it('insertAgent and getAgent', async () => {
      await insertAgent(newAgent);
      const agent = await getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Test Agent');
      expect(agent?.hostname).toBe('server-1');
      expect(agent?.status).toBe('offline');
      expect(agent?.auto_update).toBe(0);
    });

    it('getAgent returns undefined for unknown id', async () => {
      const agent = await getAgent('nonexistent');
      expect(agent).toBeUndefined();
    });

    it('listAgents returns all agents', async () => {
      await insertAgent(newAgent);
      await insertAgent({
        ...newAgent,
        id: 'agent-2',
        name: 'Agent 2',
        token_hash: '$2a$10$hash2',
      });
      const agents = await listAgents();
      expect(agents).toHaveLength(2);
    });

    it('updateAgentStatus changes status and last_seen', async () => {
      await insertAgent(newAgent);
      const now = Date.now();
      await updateAgentStatus('agent-1', 'online', now);
      const agent = await getAgent('agent-1');
      expect(agent?.status).toBe('online');
      expect(agent?.last_seen).toBe(now);
    });

    it('updateAgentConfig updates schedule_override and auto_update', async () => {
      await insertAgent(newAgent);
      await updateAgentConfig('agent-1', {
        schedule_override: '0 */6 * * *',
        auto_update: 1,
      });
      const agent = await getAgent('agent-1');
      expect(agent?.schedule_override).toBe('0 */6 * * *');
      expect(agent?.auto_update).toBe(1);
    });

    it('deleteAgent removes agent', async () => {
      await insertAgent(newAgent);
      await deleteAgent('agent-1');
      expect(await getAgent('agent-1')).toBeUndefined();
    });

    it('deleteAgent cascades to containers', async () => {
      await insertAgent(newAgent);
      const containers: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:abc',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', containers);
      expect(await getContainersByAgent('agent-1')).toHaveLength(1);
      await deleteAgent('agent-1');
      expect(await getContainersByAgent('agent-1')).toHaveLength(0);
    });
  });

  // --- Containers ---

  describe('containers', () => {
    const agentData: NewAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      hostname: 'server-1',
      token_hash: '$2a$10$fakehash',
    };

    beforeEach(async () => {
      await insertAgent(agentData);
    });

    it('upsertContainers inserts new containers', async () => {
      const containers: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:abc',
          status: 'running',
        },
        {
          id: 'c-2',
          docker_id: 'docker-2',
          name: 'redis',
          image: 'redis:7',
          current_digest: 'sha256:def',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', containers);
      const result = await getContainersByAgent('agent-1');
      expect(result).toHaveLength(2);
    });

    it('upsertContainers updates existing containers', async () => {
      const containers: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:abc',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', containers);

      const updated: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:1.25',
          current_digest: 'sha256:xyz',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', updated);

      const result = await getContainersByAgent('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.image).toBe('nginx:1.25');
      expect(result[0]?.current_digest).toBe('sha256:xyz');
    });

    it('upsertContainers removes missing containers', async () => {
      const containers: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:abc',
          status: 'running',
        },
        {
          id: 'c-2',
          docker_id: 'docker-2',
          name: 'redis',
          image: 'redis:7',
          current_digest: 'sha256:def',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', containers);

      // Only nginx reported — redis should be removed
      const updated: ContainerInfo[] = [
        {
          id: 'c-1',
          docker_id: 'docker-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:abc',
          status: 'running',
        },
      ];
      await upsertContainers('agent-1', updated);

      const result = await getContainersByAgent('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('nginx');
    });

    it('upsertContainers stores label_* columns from agent heartbeat', async () => {
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
          policy: 'notify',
          tag_pattern: '^\\d+\\.\\d+\\.\\d+$',
          update_level: 'minor',
          group: 'backend',
          priority: 5,
          depends_on: ['db'],
        },
      ]);
      const result = await getContainersByAgent('agent-1');
      expect(result[0]?.label_policy).toBe('notify');
      expect(result[0]?.label_tag_pattern).toBe('^\\d+\\.\\d+\\.\\d+$');
      expect(result[0]?.label_update_level).toBe('minor');
      expect(result[0]?.label_group).toBe('backend');
      expect(result[0]?.label_priority).toBe(5);
      expect(result[0]?.label_depends_on).toBe('["db"]');
    });

    it('upsertContainers heartbeat never overwrites UI-set policy/tag_pattern/update_level', async () => {
      // First heartbeat — no labels
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);

      // User sets policy/tag_pattern/update_level via UI (direct SQL, simulating updateContainerPolicy)
      await sql`
        UPDATE containers
        SET policy = 'manual', tag_pattern = '^v\\d+$', update_level = 'patch'
        WHERE id = 'c-1'
      `;

      // Second heartbeat — agent sends null for those fields (no labels on container)
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);

      const result = await getContainersByAgent('agent-1');
      expect(result[0]?.policy).toBe('manual');
      expect(result[0]?.tag_pattern).toBe('^v\\d+$');
      expect(result[0]?.update_level).toBe('patch');
    });

    it('upsertContainers heartbeat never overwrites UI-set orchestration fields', async () => {
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);

      // User sets orchestration via UI
      await sql`
        UPDATE containers
        SET update_group = 'frontend', update_priority = 10, depends_on = '["db"]'
        WHERE id = 'c-1'
      `;

      // Heartbeat with no labels
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);

      const result = await getContainersByAgent('agent-1');
      expect(result[0]?.update_group).toBe('frontend');
      expect(result[0]?.update_priority).toBe(10);
      expect(result[0]?.depends_on).toBe('["db"]');
    });

    it('upsertContainers overwrites label_* on every heartbeat', async () => {
      // First heartbeat — label is set
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
          policy: 'notify',
        },
      ]);
      let result = await getContainersByAgent('agent-1');
      expect(result[0]?.label_policy).toBe('notify');

      // Second heartbeat — label removed from container
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);
      result = await getContainersByAgent('agent-1');
      expect(result[0]?.label_policy).toBeNull();
    });

    it('getContainersByAgent returns correct subset', async () => {
      const agent2: NewAgent = {
        id: 'agent-2',
        name: 'Agent 2',
        hostname: 'server-2',
        token_hash: '$2a$10$hash2',
      };
      await insertAgent(agent2);

      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: null,
          status: 'running',
        },
      ]);
      await upsertContainers('agent-2', [
        {
          id: 'c-2',
          docker_id: 'd-2',
          name: 'redis',
          image: 'redis:7',
          current_digest: null,
          status: 'running',
        },
      ]);

      expect(await getContainersByAgent('agent-1')).toHaveLength(1);
      expect(await getContainersByAgent('agent-2')).toHaveLength(1);
      const agent1Containers = await getContainersByAgent('agent-1');
      expect(agent1Containers[0]?.name).toBe('nginx');
    });

    it('updateContainerDigests sets digest fields', async () => {
      await upsertContainers('agent-1', [
        {
          id: 'c-1',
          docker_id: 'd-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:old',
          status: 'running',
        },
      ]);

      await updateContainerDigests('c-1', 'sha256:old', 'sha256:new', true);

      const containers = await getContainersByAgent('agent-1');
      expect(containers[0]?.current_digest).toBe('sha256:old');
      expect(containers[0]?.latest_digest).toBe('sha256:new');
      expect(containers[0]?.has_update).toBe(1);
    });
  });

  // --- Update Log ---

  describe('update_log', () => {
    beforeEach(async () => {
      await insertAgent({
        id: 'agent-1',
        name: 'Agent',
        hostname: 'srv',
        token_hash: '$2a$10$hash',
      });
    });

    it('insertUpdateLog and getHistory returns it', async () => {
      const entry: NewUpdateLog = {
        agent_id: 'agent-1',
        container_id: 'c-1',
        container_name: 'nginx',
        old_digest: 'sha256:old',
        new_digest: 'sha256:new',
        status: 'success',
        duration_ms: 1500,
      };
      await insertUpdateLog(entry);

      const history = await getHistory({});
      expect(history.data).toHaveLength(1);
      expect(history.data[0]?.container_name).toBe('nginx');
      expect(history.data[0]?.status).toBe('success');
      expect(history.total).toBe(1);
    });

    it('getHistory filters by agentId', async () => {
      await insertAgent({
        id: 'agent-2',
        name: 'Agent2',
        hostname: 'srv2',
        token_hash: '$2a$10$hash2',
      });

      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-1',
        container_name: 'nginx',
        status: 'success',
      });
      await insertUpdateLog({
        agent_id: 'agent-2',
        container_id: 'c-2',
        container_name: 'redis',
        status: 'success',
      });

      const result = await getHistory({ agentId: 'agent-1' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.agent_id).toBe('agent-1');
    });

    it('getHistory filters by status', async () => {
      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-1',
        container_name: 'nginx',
        status: 'success',
      });
      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-2',
        container_name: 'redis',
        status: 'failed',
        error: 'pull failed',
      });

      const result = await getHistory({ status: 'failed' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.status).toBe('failed');
    });

    it('getHistory pagination works', async () => {
      for (let i = 0; i < 5; i++) {
        await insertUpdateLog({
          agent_id: 'agent-1',
          container_id: `c-${i}`,
          container_name: `container-${i}`,
          status: 'success',
        });
      }

      const page1 = await getHistory({ limit: 2, offset: 0 });
      expect(page1.data).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await getHistory({ limit: 2, offset: 2 });
      expect(page2.data).toHaveLength(2);

      const page3 = await getHistory({ limit: 2, offset: 4 });
      expect(page3.data).toHaveLength(1);
    });

    it('getHistoryStats returns correct aggregation', async () => {
      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-1',
        container_name: 'nginx',
        status: 'success',
      });
      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-2',
        container_name: 'redis',
        status: 'success',
      });
      await insertUpdateLog({
        agent_id: 'agent-1',
        container_id: 'c-3',
        container_name: 'postgres',
        status: 'failed',
        error: 'timeout',
      });

      const stats = await getHistoryStats();
      expect(stats.totalUpdates).toBe(3);
      expect(stats.successRate).toBeCloseTo(66.67, 0);
      expect(stats.lastWeek).toBeDefined();
      expect(Array.isArray(stats.lastWeek)).toBe(true);
    });
  });

  // --- Config ---

  describe('config', () => {
    it('getConfig returns seeded value', async () => {
      const schedule = await getConfig('global_schedule');
      expect(schedule).toBe('0 4 * * *');
    });

    it('getConfig returns undefined for unknown key', async () => {
      const val = await getConfig('nonexistent');
      expect(val).toBeUndefined();
    });

    it('setConfig creates new key', async () => {
      await setConfig('new_key', 'new_value');
      expect(await getConfig('new_key')).toBe('new_value');
    });

    it('setConfig updates existing key', async () => {
      await setConfig('global_schedule', '0 */2 * * *');
      expect(await getConfig('global_schedule')).toBe('0 */2 * * *');
    });

    it('getAllConfig returns all config entries', async () => {
      const config = await getAllConfig();
      expect(config).toHaveProperty('global_schedule');
      expect(config).toHaveProperty('auto_update_global');
      expect(config).toHaveProperty('admin_password_hash');
    });
  });

  // --- DB-01, DB-02, DB-03 ---

  describe('database hardening', () => {
    it('statement_timeout is configured at 30s (DB-01)', async () => {
      const [row] = await sql`SHOW statement_timeout`;
      expect(row?.statement_timeout).toBe('30s');
    });

    it('insertUpdateLogAndDigests writes both log and digest atomically (DB-02)', async () => {
      await insertAgent({
        id: 'atomic-agent',
        name: 'Atomic Agent',
        hostname: 'srv',
        token_hash: '$2a$10$hash',
      });

      await upsertContainers('atomic-agent', [
        {
          id: 'atomic-c1',
          docker_id: 'docker-atomic-1',
          name: 'nginx',
          image: 'nginx:latest',
          current_digest: 'sha256:old',
          status: 'running',
        },
      ]);

      const logId = await insertUpdateLogAndDigests(
        {
          agent_id: 'atomic-agent',
          container_id: 'atomic-c1',
          container_name: 'nginx',
          old_digest: 'sha256:old',
          new_digest: 'sha256:new',
          status: 'success',
          duration_ms: 500,
        },
        'atomic-c1',
        'sha256:new',
      );

      // Verify log was written
      expect(logId).toBeGreaterThan(0);
      const history = await getHistory({ agentId: 'atomic-agent' });
      expect(history.data.length).toBeGreaterThanOrEqual(1);
      expect(history.data[0]?.new_digest).toBe('sha256:new');

      // Verify container digest was updated
      const containers = await getContainersByAgent('atomic-agent');
      expect(containers[0]?.current_digest).toBe('sha256:new');
      expect(containers[0]?.latest_digest).toBe('sha256:new');
      expect(containers[0]?.has_update).toBe(0);
    });

    it('updateNotificationChannel updates all fields atomically (DB-03)', async () => {
      await insertNotificationChannel({
        id: 'ch-atomic',
        type: 'slack',
        name: 'Old Name',
        config: 'encrypted-config-old',
        enabled: true,
        events: JSON.stringify(['update_success']),
        template: null,
        link_template: null,
      });

      await updateNotificationChannel('ch-atomic', {
        name: 'New Name',
        type: 'webhook',
        config: 'encrypted-config-new',
        enabled: false,
        events: JSON.stringify(['update_failed']),
      });

      const updated = await getNotificationChannel('ch-atomic');
      expect(updated).toBeDefined();
      expect(updated?.name).toBe('New Name');
      expect(updated?.type).toBe('webhook');
      expect(updated?.config).toBe('encrypted-config-new');
      expect(updated?.enabled).toBe(false);
      expect(updated?.events).toBe(JSON.stringify(['update_failed']));
    });
  });

  // --- BUG-07 regression ---

  describe('BUG-07: upsertContainers atomicity under concurrent heartbeats', () => {
    it('containers are never transiently empty between DELETE and INSERT', async () => {
      const agentId = 'flicker-agent';
      await insertAgent({
        id: agentId,
        name: 'Flicker Agent',
        hostname: 'flicker-host',
        token_hash: 'hash',
      });

      const containers = [
        {
          id: 'flicker-c1',
          docker_id: 'fc1',
          name: 'app1',
          image: 'app:latest',
          current_digest: null,
          status: 'running',
          excluded: false,
          exclude_reason: null,
          pinned_version: false,
        },
        {
          id: 'flicker-c2',
          docker_id: 'fc2',
          name: 'app2',
          image: 'app:latest',
          current_digest: null,
          status: 'running',
          excluded: false,
          exclude_reason: null,
          pinned_version: false,
        },
      ];

      // Seed initial containers
      await upsertContainers(
        agentId,
        containers as unknown as Parameters<typeof upsertContainers>[1],
      );

      // Run 10 concurrent upserts (simulating rapid heartbeats)
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          upsertContainers(
            agentId,
            containers as unknown as Parameters<typeof upsertContainers>[1],
          ),
        );
      }

      // While upserts run, continuously check that containers are never empty
      let observedEmpty = false;
      const checker = setInterval(async () => {
        const current = await getContainersByAgent(agentId);
        if (current.length === 0) {
          observedEmpty = true;
        }
      }, 5);

      await Promise.all(promises);
      clearInterval(checker);

      // Final check: containers should still be there
      const final = await getContainersByAgent(agentId);
      expect(final.length).toBe(2);
      expect(observedEmpty).toBe(false);
    });
  });
});
