import { formatDistanceToNow } from 'date-fns';
import { Box, Info, RefreshCw, Scissors, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useAgent,
  useCheckAgent,
  useDeleteAgent,
  usePruneAgent,
  useUpdateAgent,
  useUpdateAgentConfig,
} from '@/api/hooks/useAgents';
import { useUpdatePolicy, useUpdatePolicyMutation } from '@/api/hooks/usePolicies';
import { ContainerRow } from '@/components/agents/ContainerRow';
import { CronPicker } from '@/components/common/CronPicker';
import { Pagination } from '@/components/common/Pagination';
import { StatusDot } from '@/components/common/StatusDot';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/store/useStore';

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(id ?? '');
  const checkAgent = useCheckAgent();
  const updateAgent = useUpdateAgent();
  const updateConfig = useUpdateAgentConfig();
  const deleteAgent = useDeleteAgent();
  const pruneAgent = usePruneAgent();
  const addToast = useStore((s) => s.addToast);
  const checkingAgents = useStore((s) => s.checkingAgents);
  const setAgentChecking = useStore((s) => s.setAgentChecking);
  const isChecking = agent ? checkingAgents.has(agent.id) : false;
  const [pruneKeep, setPruneKeep] = useState(1);
  const [pruneConfirmOpen, setPruneConfirmOpen] = useState(false);
  const [showStopped, setShowStopped] = useState(
    () => localStorage.getItem('showStopped') === 'true',
  );
  const [containerPage, setContainerPage] = useState(0);
  const CONTAINER_PAGE_SIZE = 15;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <Card className="m-6">
        <CardContent className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-muted-foreground text-lg">Agent not found</p>
          <Button onClick={() => navigate('/agents')}>Back to Agents</Button>
        </CardContent>
      </Card>
    );
  }

  const handleDelete = () => {
    if (confirm(`Remove agent "${agent.name}"? This will delete all history.`)) {
      deleteAgent.mutate(agent.id, {
        onSuccess: () => {
          addToast({
            type: 'success',
            message: `Agent "${agent.name}" removed`,
          });
          navigate('/agents');
        },
        onError: () => addToast({ type: 'error', message: 'Failed to remove agent' }),
      });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <StatusDot status={agent.status} />
          <div>
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.hostname} · Last seen{' '}
              {agent.last_seen
                ? formatDistanceToNow(agent.last_seen, { addSuffix: true })
                : 'never'}
            </p>
            {agent.docker_version && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Docker {agent.docker_version} · API {agent.docker_api_version}
                {agent.os && agent.arch && ` · ${agent.os}/${agent.arch}`}
              </p>
            )}
          </div>
        </div>
        {agent.status === 'offline' && (
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 size={14} /> Remove Agent
          </Button>
        )}
      </div>

      <Tabs defaultValue="containers">
        <TabsList>
          <TabsTrigger value="containers">
            <Box size={14} /> Containers
          </TabsTrigger>
          <TabsTrigger value="configuration">
            <Shield size={14} /> Configuration
          </TabsTrigger>
        </TabsList>

        {/* Containers Tab */}
        <TabsContent value="containers" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={showStopped}
                  onCheckedChange={(v) => {
                    setShowStopped(v);
                    localStorage.setItem('showStopped', String(v));
                    setContainerPage(0);
                  }}
                />
                <Label
                  className="text-xs text-muted-foreground cursor-pointer"
                  onClick={() => {
                    setShowStopped((v) => {
                      const next = !v;
                      localStorage.setItem('showStopped', String(next));
                      return next;
                    });
                    setContainerPage(0);
                  }}
                >
                  Show stopped
                </Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAgentChecking(agent.id, true);
                  checkAgent.mutate(agent.id, {
                    onSuccess: () =>
                      addToast({
                        type: 'info',
                        message: 'Checking for updates...',
                      }),
                    onError: () => {
                      setAgentChecking(agent.id, false);
                      addToast({ type: 'error', message: 'Check failed' });
                    },
                  });
                }}
                disabled={isChecking}
              >
                <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
                {isChecking ? 'Checking...' : 'Check All'}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  updateAgent.mutate(
                    { id: agent.id },
                    {
                      onError: () => addToast({ type: 'error', message: 'Update failed' }),
                    },
                  )
                }
              >
                Update All
              </Button>
            </div>
          </div>

          {!agent.containers || agent.containers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                <Box size={40} className="text-border" />
                <p className="text-muted-foreground text-sm">No containers found on this agent</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {(() => {
                const filtered = [...agent.containers]
                  .filter((c) => showStopped || c.status === 'running')
                  .sort((a, b) => a.name.localeCompare(b.name));
                const page = filtered.slice(
                  containerPage * CONTAINER_PAGE_SIZE,
                  (containerPage + 1) * CONTAINER_PAGE_SIZE,
                );
                return (
                  <>
                    <div>
                      {page.map((ct) => (
                        <ContainerRow
                          key={ct.id}
                          agentId={agent.id}
                          container={ct}
                          onUpdate={() =>
                            updateAgent.mutate(
                              {
                                id: agent.id,
                                containerIds: [ct.docker_id],
                              },
                              {
                                onError: () =>
                                  addToast({
                                    type: 'error',
                                    message: 'Update failed',
                                  }),
                              },
                            )
                          }
                        />
                      ))}
                    </div>
                    <Pagination
                      page={containerPage}
                      total={filtered.length}
                      pageSize={CONTAINER_PAGE_SIZE}
                      onPageChange={setContainerPage}
                      label={`${filtered.length} container${filtered.length !== 1 ? 's' : ''}`}
                    />
                  </>
                );
              })()}
            </Card>
          )}

          <Card className="bg-secondary">
            <CardContent className="pt-4 text-sm text-muted-foreground flex gap-2">
              <Info size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="mb-1">To exclude a container from monitoring, add this label:</p>
                <code className="block bg-background px-3 py-2 rounded font-mono text-xs text-foreground">
                  labels:
                  <br />
                  {'  '}- &quot;com.watchwarden.enable=false&quot;
                </code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="configuration" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Schedule Override</CardTitle>
                  {agent.schedule_override && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={() =>
                        updateConfig.mutate({
                          id: agent.id,
                          config: { scheduleOverride: null },
                        })
                      }
                    >
                      Use Global Schedule
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {agent.schedule_override ? (
                  <CronPicker
                    value={agent.schedule_override}
                    onChange={(val) =>
                      updateConfig.mutate({
                        id: agent.id,
                        config: { scheduleOverride: val },
                      })
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Using global schedule</p>
                    <CronPicker
                      value="0 4 * * *"
                      onChange={(val) =>
                        updateConfig.mutate({
                          id: agent.id,
                          config: { scheduleOverride: val },
                        })
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Auto-Update</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={agent.auto_update === 1}
                    onCheckedChange={(checked) =>
                      updateConfig.mutate({
                        id: agent.id,
                        config: { autoUpdate: checked },
                      })
                    }
                  />
                  <Label>Automatically update containers</Label>
                </div>
              </CardContent>
            </Card>
          </div>

          <StabilityPolicyCard agentId={agent.id} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Scissors size={16} /> Image Pruning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Remove old images from this agent, keeping the specified number of previous versions
                per container for rollback capability.
              </p>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Keep previous versions</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={pruneKeep}
                    onChange={(e) => setPruneKeep(Number(e.target.value))}
                    className="w-24"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={agent.status !== 'online' || pruneAgent.isPending}
                  onClick={() =>
                    pruneAgent.mutate(
                      { id: agent.id, keepPrevious: pruneKeep, dryRun: true },
                      {
                        onSuccess: () =>
                          addToast({
                            type: 'info',
                            message: 'Dry-run prune initiated — check agent logs for details',
                          }),
                      },
                    )
                  }
                >
                  Dry Run
                </Button>
                <AlertDialog open={pruneConfirmOpen} onOpenChange={setPruneConfirmOpen}>
                  <AlertDialogTrigger
                    disabled={agent.status !== 'online' || pruneAgent.isPending}
                    render={
                      <Button
                        size="sm"
                        disabled={agent.status !== 'online' || pruneAgent.isPending}
                      >
                        <Scissors size={14} /> Prune Images
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Prune images on {agent.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove old Docker images, keeping{' '}
                        <strong>
                          {pruneKeep} previous version
                          {pruneKeep !== 1 ? 's' : ''}
                        </strong>{' '}
                        per container for rollback. Images currently in use will not be removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setPruneConfirmOpen(false);
                          pruneAgent.mutate(
                            { id: agent.id, keepPrevious: pruneKeep },
                            {
                              onSuccess: () =>
                                addToast({
                                  type: 'success',
                                  message: 'Prune initiated — old images will be removed',
                                }),
                              onError: () =>
                                addToast({
                                  type: 'error',
                                  message: 'Prune failed',
                                }),
                            },
                          );
                        }}
                      >
                        Prune Images
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StabilityPolicyCard({ agentId }: { agentId: string }) {
  const { data: policy } = useUpdatePolicy(agentId);
  const updatePolicy = useUpdatePolicyMutation();
  const addToast = useStore((s) => s.addToast);

  if (!policy) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield size={16} /> Stability & Auto-Rollback
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={policy.auto_rollback_enabled}
            onCheckedChange={(checked) =>
              updatePolicy.mutate(
                { scope: `agent:${agentId}`, autoRollbackEnabled: checked },
                {
                  onSuccess: () => addToast({ type: 'success', message: 'Policy updated' }),
                },
              )
            }
          />
          <Label>Auto-rollback on unhealthy</Label>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Stability window (seconds)</Label>
            <Input
              type="number"
              defaultValue={policy.stability_window_seconds}
              onBlur={(e) =>
                updatePolicy.mutate({
                  scope: `agent:${agentId}`,
                  stabilityWindowSeconds: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Max unhealthy (seconds)</Label>
            <Input
              type="number"
              defaultValue={policy.max_unhealthy_seconds}
              onBlur={(e) =>
                updatePolicy.mutate({
                  scope: `agent:${agentId}`,
                  maxUnhealthySeconds: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Update strategy</Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={policy.strategy === 'stop-first' || !policy.strategy ? 'default' : 'outline'}
              onClick={() =>
                updatePolicy.mutate({
                  scope: `agent:${agentId}`,
                  strategy: 'stop-first',
                })
              }
            >
              Stop-first
            </Button>
            <Button
              size="sm"
              variant={policy.strategy === 'start-first' ? 'default' : 'outline'}
              onClick={() =>
                updatePolicy.mutate({
                  scope: `agent:${agentId}`,
                  strategy: 'start-first',
                })
              }
            >
              Blue-green
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stop-first: stop old → start new. Blue-green: start new → verify health → stop old.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          After each update, the container is monitored for the stability window. If unhealthy for
          longer than the max unhealthy threshold, it will be automatically rolled back.
        </p>
      </CardContent>
    </Card>
  );
}
