import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Container } from '@/api/hooks/useAgents';
import { useStore } from '@/store/useStore';
import { ContainerRow } from '../agents/ContainerRow';

const baseContainer: Container = {
  id: 'c-1',
  agent_id: 'agent-1',
  docker_id: 'd-1',
  name: 'nginx',
  image: 'nginx:latest',
  current_digest: 'sha256:abc123def456',
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
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderInTable(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Helper: expand the row by clicking the chevron
function expandRow() {
  fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
}

describe('ContainerRow', () => {
  it('renders container name and image', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.getByText('nginx')).toBeInTheDocument();
    expect(screen.getByText('nginx:latest')).toBeInTheDocument();
  });

  it('shows Update button when hasUpdate is true', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, has_update: 1 }} />,
    );
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('hides Update button when hasUpdate is false', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  });

  it('shows Rollback button for non-pinned container', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.getByRole('button', { name: 'Rollback' })).toBeInTheDocument();
  });

  it('hides Rollback button for pinned container but shows Stop', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, pinned_version: 1 }} />,
    );
    expect(screen.queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows Stop button for running container', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows Start button for exited container', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, status: 'exited' }} />,
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('shows step indicator when updateProgress exists', () => {
    useStore.setState({
      updateProgress: {
        'agent-1:d-1': {
          step: 'pulling',
          containerName: 'nginx',
          timestamp: Date.now(),
        },
      },
    });
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.getByText('pulling')).toBeInTheDocument();
    useStore.setState({ updateProgress: {} });
  });

  it('click Update calls onUpdate', () => {
    const onUpdate = vi.fn();
    renderInTable(
      <ContainerRow
        agentId="agent-1"
        container={{ ...baseContainer, has_update: 1 }}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  // ── Expandable row ──────────────────────────────────────────────────────────

  it('row is collapsed by default — config panel not visible', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expect(screen.queryByText('Update Policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Orchestration')).not.toBeInTheDocument();
  });

  it('clicking chevron expands the config panel', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expandRow();
    expect(screen.getByText('Update Policy')).toBeInTheDocument();
    expect(screen.getByText('Orchestration')).toBeInTheDocument();
  });

  it('clicking chevron again collapses the panel', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expandRow();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('Update Policy')).not.toBeInTheDocument();
  });

  // ── Collapsed row badges ────────────────────────────────────────────────────

  it('shows NOTIFY badge when ui policy=notify', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, policy: 'notify' }} />,
    );
    expect(screen.getByText('NOTIFY')).toBeInTheDocument();
  });

  it('shows NOTIFY badge from label_policy even when ui policy is null', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_policy: 'notify' }} />,
    );
    expect(screen.getByText('NOTIFY')).toBeInTheDocument();
  });

  it('label_policy takes precedence over ui policy in badge', () => {
    renderInTable(
      <ContainerRow
        agentId="agent-1"
        container={{ ...baseContainer, label_policy: 'manual', policy: 'notify' }}
      />,
    );
    expect(screen.getByText('MANUAL')).toBeInTheDocument();
    expect(screen.queryByText('NOTIFY')).not.toBeInTheDocument();
  });

  it('shows group badge from label_group when ui update_group is null', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_group: 'backend' }} />,
    );
    expect(screen.getByText('backend')).toBeInTheDocument();
  });

  it('shows priority badge from label_priority when ui update_priority is default', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_priority: 5 }} />,
    );
    expect(screen.getByText('p5')).toBeInTheDocument();
  });

  it('does not show priority badge when label_priority is 100 (default)', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_priority: 100 }} />,
    );
    expect(screen.queryByText('p100')).not.toBeInTheDocument();
  });

  // ── Docker label lock in expanded panel ────────────────────────────────────

  it('shows editable policy form when no label_policy set', () => {
    renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
    expandRow();
    expect(screen.getByLabelText(/Auto — follow agent/)).toBeInTheDocument();
  });

  it('shows lock notice and hides radio inputs when label_policy is set', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_policy: 'notify' }} />,
    );
    expandRow();
    expect(screen.queryByLabelText(/Auto — follow agent/)).not.toBeInTheDocument();
    expect(screen.getByText(/com\.watchwarden\.policy/)).toBeInTheDocument();
  });

  it('shows lock notice and hides group input when label_group is set', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_group: 'backend' }} />,
    );
    expandRow();
    expect(screen.queryByPlaceholderText(/e\.g\. backend/)).not.toBeInTheDocument();
    expect(screen.getByText(/com\.watchwarden\.group/)).toBeInTheDocument();
  });

  it('shows lock notice and hides priority input when label_priority is set', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_priority: 10 }} />,
    );
    expandRow();
    expect(screen.getByText(/com\.watchwarden\.priority/)).toBeInTheDocument();
  });

  it('hides Save policy button when all policy fields are label-controlled', () => {
    renderInTable(
      <ContainerRow
        agentId="agent-1"
        container={{
          ...baseContainer,
          label_policy: 'notify',
          label_update_level: 'minor',
          label_tag_pattern: '^v\\d+$',
        }}
      />,
    );
    expandRow();
    expect(screen.queryByRole('button', { name: /Save policy/i })).not.toBeInTheDocument();
  });

  it('shows Save policy button when at least one policy field is not label-controlled', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, label_policy: 'notify' }} />,
    );
    expandRow();
    expect(screen.getByRole('button', { name: /Save policy/i })).toBeInTheDocument();
  });

  // ── Status badges ───────────────────────────────────────────────────────────

  it('shows UNHEALTHY badge for container with status restarting', () => {
    renderInTable(
      <ContainerRow agentId="agent-1" container={{ ...baseContainer, status: 'restarting' }} />,
    );
    expect(screen.getByText('UNHEALTHY')).toBeInTheDocument();
  });

  it('lastActionResult clears restart spinner', () => {
    const container = { ...baseContainer, docker_id: 'd-restart-1' };
    useStore.setState({ lastActionResult: null });
    renderInTable(<ContainerRow agentId="agent-1" container={container} />);

    // Click Restart button — pendingAction becomes 'restart', spinner appears
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    // The Restart button renders a Loader2 spinner when pendingAction === 'restart'
    // The button is still present (just with spinner icon), so it should be in the DOM
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();

    // Now simulate the agent reporting the action is done
    act(() => {
      useStore.setState({
        lastActionResult: { containerId: container.docker_id, action: 'restart', success: true },
      });
    });

    // pendingAction should be cleared — spinner gone, button still present but no Loader2
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    // No Loader2 animate-spin inside the Restart button after clear
    const restartBtn = screen.getByRole('button', { name: 'Restart' });
    expect(restartBtn.querySelector('.animate-spin')).toBeNull();

    useStore.setState({ lastActionResult: null });
  });
});
