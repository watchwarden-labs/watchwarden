import { ArrowUpCircle, Hexagon, LayoutGrid, List, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAgents, useCheckAgent, useCheckAllAgents, useUpdateAgent } from '@/api/hooks/useAgents';
import { useHistory } from '@/api/hooks/useHistory';
import { useConfig } from '@/api/hooks/useSettings';
import { AgentCard } from '@/components/agents/AgentCard';
import { AgentListRow } from '@/components/agents/AgentListRow';
import { UpdateLogTable } from '@/components/history/UpdateLogTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '@/store/useStore';

function AgentCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: unsortedAgents = [], isLoading } = useAgents();
  const agents = [...unsortedAgents].sort((a, b) => a.name.localeCompare(b.name));
  const { data: config } = useConfig();
  const { data: history } = useHistory({ limit: 10 });
  const checkAgent = useCheckAgent();
  const checkAllAgents = useCheckAllAgents();
  const updateAgent = useUpdateAgent();
  const navigate = useNavigate();
  const addToast = useStore((s) => s.addToast);
  const checkingAgents = useStore((s) => s.checkingAgents);
  const setAgentChecking = useStore((s) => s.setAgentChecking);
  const viewMode = useStore((s) => s.agentViewMode);
  const setViewMode = useStore((s) => s.setAgentViewMode);

  const onlineCount = agents.filter((a) => a.status === 'online').length;
  const updateCount = agents.reduce(
    (sum, a) => sum + (a.containers?.filter((c) => c.has_update)?.length ?? 0),
    0,
  );
  const isCheckingAll = checkingAgents.size > 0;

  const handleCheck = (agentId: string) => {
    if (checkingAgents.has(agentId)) return;
    setAgentChecking(agentId, true);
    checkAgent.mutate(agentId, {
      onSuccess: () => addToast({ type: 'info', message: 'Checking for updates...' }),
      onError: () => setAgentChecking(agentId, false),
    });
    // Button stays disabled until CHECK_COMPLETE WS event clears it
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" data-testid="stats-strip">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Agents</p>
            <p className="text-2xl font-bold">{agents.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Online</p>
            <p className="text-2xl font-bold text-success">{onlineCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Updates Available</p>
            <p className="text-2xl font-bold text-primary">{updateCount}</p>
          </CardContent>
        </Card>
        <Link to="/settings">
          <Card className="card-hover cursor-pointer">
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Global Schedule</p>
              <p className="text-sm font-mono">{config?.global_schedule ?? '—'}</p>
              <p className="text-xs text-primary mt-1">Click to edit</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Actions */}
      {agents.length > 0 && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              agents
                .filter((a) => a.status === 'online')
                .forEach((a) => {
                  setAgentChecking(a.id, true);
                });
              checkAllAgents.mutate(undefined, {
                onSuccess: () =>
                  addToast({
                    type: 'info',
                    message: 'Checking all agents for updates...',
                  }),
                onError: () => {
                  agents.forEach((a) => {
                    setAgentChecking(a.id, false);
                  });
                  addToast({
                    type: 'error',
                    message: 'Failed to initiate check',
                  });
                },
              });
            }}
            disabled={isCheckingAll}
          >
            <RefreshCw size={16} className={isCheckingAll ? 'animate-spin' : ''} />
            {isCheckingAll ? 'Checking...' : 'Check All'}
          </Button>
          <Button
            onClick={() => {
              agents.forEach((a) => {
                updateAgent.mutate(
                  { id: a.id },
                  {
                    onError: () => addToast({ type: 'error', message: 'Update failed' }),
                  },
                );
              });
            }}
          >
            <ArrowUpCircle size={16} /> Update All
          </Button>
        </div>
      )}

      {/* Agent List */}
      <div data-testid="agent-grid">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Agents</h2>
          <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <List size={14} />
            </Button>
          </div>
        </div>

        {isLoading && viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AgentCardSkeleton />
            <AgentCardSkeleton />
            <AgentCardSkeleton />
          </div>
        )}

        {!isLoading && agents.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-24 gap-4">
              <Hexagon size={64} className="text-border" />
              <p className="text-muted-foreground text-lg">No agents connected</p>
              <p className="text-muted-foreground text-sm">
                Go to Settings to add your first agent
              </p>
              <Button onClick={() => navigate('/settings')}>Add your first agent</Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && agents.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <Link key={agent.id} to={`/agents/${agent.id}`}>
                <AgentCard
                  agent={agent}
                  checking={checkingAgents.has(agent.id)}
                  onCheck={() => handleCheck(agent.id)}
                  onUpdate={() => updateAgent.mutate({ id: agent.id })}
                />
              </Link>
            ))}
          </div>
        )}

        {!isLoading && agents.length > 0 && viewMode === 'list' && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="hidden md:table-cell">Hostname</TableHead>
                  <TableHead className="hidden sm:table-cell">Containers</TableHead>
                  <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Seen</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <AgentListRow
                    key={agent.id}
                    agent={agent}
                    checking={checkingAgents.has(agent.id)}
                    onCheck={() => handleCheck(agent.id)}
                    onUpdate={() => updateAgent.mutate({ id: agent.id })}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Activity Feed */}
      <div data-testid="activity-feed">
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        <UpdateLogTable entries={history?.data ?? []} emptyMessage="No recent activity" />
      </div>
    </div>
  );
}
