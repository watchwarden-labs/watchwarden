import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@/api/hooks/useAgents';
import { AgentCard } from '../agents/AgentCard';

const mockAgent: Agent = {
  id: 'agent-1',
  name: 'Test Agent',
  hostname: 'server-1.example.com',
  status: 'online',
  last_seen: Date.now(),
  schedule_override: null,
  auto_update: 0,
  docker_version: null,
  docker_api_version: null,
  agent_version: null,
  os: null,
  arch: null,
  created_at: Date.now(),
  containers: [
    {
      id: 'c-1',
      agent_id: 'agent-1',
      docker_id: 'd-1',
      name: 'nginx',
      image: 'nginx:latest',
      current_digest: 'sha256:abc',
      latest_digest: 'sha256:def',
      has_update: 1,
      status: 'running',
      health_status: 'healthy',
      pinned_version: 0,
      excluded: 0,
      exclude_reason: null,
      update_group: null,
      update_priority: 100,
      depends_on: null,
      last_diff: null,
      last_checked: null,
      last_updated: null,
      policy: null,
      tag_pattern: null,
      update_level: null,
      label_policy: null,
      label_tag_pattern: null,
      label_update_level: null,
      label_group: null,
      label_priority: null,
      label_depends_on: null,
      is_stateful: 0,
      update_first_seen: null,
    },
    {
      id: 'c-2',
      agent_id: 'agent-1',
      docker_id: 'd-2',
      name: 'redis',
      image: 'redis:7',
      current_digest: null,
      latest_digest: null,
      has_update: 0,
      status: 'running',
      health_status: 'healthy',
      pinned_version: 0,
      excluded: 0,
      exclude_reason: null,
      update_group: null,
      update_priority: 100,
      depends_on: null,
      last_diff: null,
      last_checked: null,
      last_updated: null,
      policy: null,
      tag_pattern: null,
      update_level: null,
      label_policy: null,
      label_tag_pattern: null,
      label_update_level: null,
      label_group: null,
      label_priority: null,
      label_depends_on: null,
      is_stateful: 0,
      update_first_seen: null,
    },
  ],
};

describe('AgentCard', () => {
  it('renders agent name and hostname', () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByText('server-1.example.com')).toBeInTheDocument();
  });

  it('shows container count', () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText('2 containers')).toBeInTheDocument();
  });

  it('shows update badge when updates available', () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByTestId('update-badge')).toHaveTextContent('1 update');
  });

  it('does not show update badge when no updates', () => {
    const noUpdates = {
      ...mockAgent,
      containers: mockAgent.containers?.map((c) => ({ ...c, has_update: 0 })),
    };
    render(<AgentCard agent={noUpdates} />);
    expect(screen.queryByTestId('update-badge')).not.toBeInTheDocument();
  });

  it('click Check calls onCheck', () => {
    const onCheck = vi.fn();
    render(<AgentCard agent={mockAgent} onCheck={onCheck} />);
    fireEvent.click(screen.getByText('Check'));
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it('click Update All calls onUpdate', () => {
    const onUpdate = vi.fn();
    render(<AgentCard agent={mockAgent} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('Update All'));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('shows unhealthy badge for restarting containers', () => {
    const [c0] = mockAgent.containers ?? [];
    const agentWithRestarting = {
      ...mockAgent,
      containers: [
        {
          ...c0,
          status: 'restarting',
          health_status: 'none',
        },
      ],
    };
    render(<AgentCard agent={agentWithRestarting} />);
    expect(screen.getByText('1 unhealthy')).toBeInTheDocument();
  });

  it('counts both unhealthy and restarting in unhealthy badge', () => {
    const [c0, c1] = mockAgent.containers ?? [];
    const agentWithMixed = {
      ...mockAgent,
      containers: [
        {
          ...c0,
          has_update: 0,
          status: 'running',
          health_status: 'unhealthy',
        },
        {
          ...c1,
          has_update: 0,
          status: 'restarting',
          health_status: 'none',
        },
      ],
    };
    render(<AgentCard agent={agentWithMixed} />);
    expect(screen.getByText('2 unhealthy')).toBeInTheDocument();
  });

  // Issue #80 round 4 — the Remove button for offline agents used to be an
  // absolutely positioned overlay that covered the header's update badge.
  describe('offline agent', () => {
    const offlineAgent = { ...mockAgent, status: 'offline' as const };

    it('renders Remove in the button row and calls onRemove', () => {
      const onRemove = vi.fn();
      render(<AgentCard agent={offlineAgent} onRemove={onRemove} />);
      const remove = screen.getByRole('button', { name: /remove/i });
      const checkButton = screen.getByRole('button', { name: /check/i });
      expect(remove.parentElement).toBe(checkButton.parentElement);
      fireEvent.click(remove);
      expect(onRemove).toHaveBeenCalledOnce();
    });

    it('keeps the update badge visible alongside Remove', () => {
      render(<AgentCard agent={offlineAgent} onRemove={vi.fn()} />);
      expect(screen.getByTestId('update-badge')).toBeInTheDocument();
    });

    it('disables Check and Update All while offline', () => {
      const onCheck = vi.fn();
      const onUpdate = vi.fn();
      render(<AgentCard agent={offlineAgent} onCheck={onCheck} onUpdate={onUpdate} />);
      expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /update all/i })).toBeDisabled();
    });

    it('does not render Remove for an online agent', () => {
      render(<AgentCard agent={mockAgent} onRemove={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });
  });
});
