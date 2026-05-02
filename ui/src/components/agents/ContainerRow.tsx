import {
  ArrowUpCircle,
  Ban,
  ChevronRight,
  Database,
  Info,
  Loader2,
  Lock,
  Pin,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type Container,
  useCheckContainer,
  useContainerDelete,
  useContainerRestart,
  useContainerStart,
  useContainerStop,
  useUpdateContainerOrchestration,
  useUpdateContainerPolicy,
} from '@/api/hooks/useAgents';
import { ContainerLogsDialog } from '@/components/agents/ContainerLogsDialog';
import { DiffBadge, type ImageDiff, ImageDiffView } from '@/components/diff/ImageDiffView';
import { VersionPickerModal } from '@/components/rollback/VersionPickerModal';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store/useStore';

const STEPS = ['pulling', 'stopping', 'removing', 'starting'] as const;

interface ContainerRowProps {
  agentId: string;
  container: Container;
  onUpdate?: () => void;
}

/** Label above a config field — shows a lock + "Docker label" badge when the field is label-sourced. */
function LabelRow({
  label,
  lockedValue,
}: {
  label: string;
  lockedValue: string | null | undefined;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {lockedValue != null && (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-600 bg-amber-400/10">
          <Lock size={9} />
          Docker label
        </span>
      )}
    </div>
  );
}

/** Read-only display shown when a value is controlled by a Docker label. */
function LabelLockNotice({
  value,
  field,
  mono = false,
}: {
  value: string;
  field: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-amber-400/5 border border-amber-400/20 text-sm">
      <span className={mono ? 'font-mono text-foreground' : 'text-foreground'}>{value}</span>
      <span className="text-[11px] text-muted-foreground">
        Set via <code className="font-mono">{field}</code> label — edit your Compose file to change.
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    running: 'bg-success',
    restarting: 'bg-warning animate-pulse',
    paused: 'bg-primary/60',
    created: 'bg-muted-foreground/60',
    dead: 'bg-destructive',
    exited: 'bg-muted-foreground/40',
  };
  const color = colorMap[status] ?? 'bg-muted-foreground/40';
  return <span className={`inline-block size-2.5 rounded-full shrink-0 ${color}`} />;
}

function statusLabel(status: string, pendingAction: string | null, isChecking: boolean) {
  if (pendingAction === 'stop') return 'stopping…';
  if (pendingAction === 'start') return 'starting…';
  if (pendingAction === 'delete') return 'deleting…';
  if (pendingAction === 'restart') return 'restarting…';
  if (isChecking) return 'checking…';
  return status;
}

export function ContainerRow({ agentId, container, onUpdate }: ContainerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  // Policy form state
  const [editPolicy, setEditPolicy] = useState<string>(container.policy ?? 'auto');
  const [editLevel, setEditLevel] = useState<string>(container.update_level ?? '');
  const [editTagPattern, setEditTagPattern] = useState<string>(container.tag_pattern ?? '');

  // Orchestration form state
  const [editGroup, setEditGroup] = useState<string>(container.update_group ?? '');
  const [editPriority, setEditPriority] = useState<string>(
    String(container.update_priority ?? 100),
  );
  const [editDependsOn, setEditDependsOn] = useState<string>(() => {
    try {
      return container.depends_on ? (JSON.parse(container.depends_on) as string[]).join(', ') : '';
    } catch {
      return '';
    }
  });

  const [pendingAction, setPendingAction] = useState<
    'start' | 'stop' | 'delete' | 'check' | 'restart' | null
  >(null);

  const progressKey = `${agentId}:${container.docker_id}`;
  const progress = useStore((s) => s.updateProgress[progressKey]);
  const addToast = useStore((s) => s.addToast);
  const checkingAgents = useStore((s) => s.checkingAgents);
  const checkContainer = useCheckContainer();
  const startContainer = useContainerStart();
  const stopContainer = useContainerStop();
  const restartContainer = useContainerRestart();
  const deleteContainer = useContainerDelete();
  const updatePolicy = useUpdateContainerPolicy();
  const updateOrch = useUpdateContainerOrchestration();

  const hasUpdate = container.has_update === 1;
  const isExcluded = container.excluded === 1;
  const isPinned = container.pinned_version === 1;
  const isStateful = container.is_stateful === 1;
  const isRunning = container.status === 'running';
  const isAgentChecking = checkingAgents.has(agentId);
  const isChecking = pendingAction === 'check' || isAgentChecking;

  // Reset form values when expanding to pick up any remote changes
  useEffect(() => {
    if (!expanded) return;
    setEditPolicy(container.policy ?? 'auto');
    setEditLevel(container.update_level ?? '');
    setEditTagPattern(container.tag_pattern ?? '');
    setEditGroup(container.update_group ?? '');
    setEditPriority(String(container.update_priority ?? 100));
    try {
      setEditDependsOn(
        container.depends_on ? (JSON.parse(container.depends_on) as string[]).join(', ') : '',
      );
    } catch {
      setEditDependsOn('');
    }
  }, [expanded, container]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally watching specific container fields
  useEffect(() => {
    setPendingAction(null);
  }, [container.status, container.has_update, container.last_checked]);

  useEffect(() => {
    if (pendingAction !== 'check') return;
    const timer = setTimeout(() => setPendingAction(null), 30000);
    return () => clearTimeout(timer);
  }, [pendingAction]);

  function handleStart() {
    setPendingAction('start');
    startContainer.mutate(
      { agentId, containerId: container.docker_id },
      {
        onError: (err) => {
          setPendingAction(null);
          addToast({
            type: 'error',
            message: `Start failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
    );
  }

  function handleStop() {
    setPendingAction('stop');
    stopContainer.mutate(
      { agentId, containerId: container.docker_id },
      {
        onError: (err) => {
          setPendingAction(null);
          addToast({
            type: 'error',
            message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
    );
  }

  function handleDelete() {
    setPendingAction('delete');
    deleteContainer.mutate(
      { agentId, containerId: container.docker_id },
      {
        onError: (err) => {
          setPendingAction(null);
          addToast({
            type: 'error',
            message: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
    );
  }

  function handleRestart() {
    setPendingAction('restart');
    restartContainer.mutate(
      { agentId, containerId: container.docker_id },
      {
        onError: (err) => {
          setPendingAction(null);
          addToast({
            type: 'error',
            message: `Restart failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
    );
  }

  function handleCheck() {
    setPendingAction('check');
    checkContainer.mutate(
      { agentId, containerIds: [container.docker_id] },
      {
        onSuccess: () => addToast({ type: 'info', message: `Checking ${container.name}...` }),
        onError: (err) => {
          setPendingAction(null);
          addToast({
            type: 'error',
            message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
    );
  }

  function handleSavePolicy() {
    updatePolicy.mutate(
      {
        agentId,
        containerId: container.id,
        policy: editPolicy === 'auto' ? null : editPolicy,
        updateLevel: editLevel || null,
        tagPattern: editTagPattern || null,
      },
      {
        onSuccess: () => addToast({ type: 'success', message: 'Policy saved' }),
        onError: (err) =>
          addToast({
            type: 'error',
            message: `Failed to save policy: ${err instanceof Error ? err.message : String(err)}`,
          }),
      },
    );
  }

  function handleSaveOrch() {
    const priority = Number(editPriority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 999) {
      addToast({ type: 'error', message: 'Priority must be between 1 and 999' });
      return;
    }
    const dependsOn = editDependsOn
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    updateOrch.mutate(
      {
        agentId,
        containerId: container.id,
        group: editGroup.trim() || null,
        priority,
        dependsOn,
      },
      {
        onSuccess: () => addToast({ type: 'success', message: 'Orchestration saved' }),
        onError: (err) =>
          addToast({
            type: 'error',
            message: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
          }),
      },
    );
  }

  const isActionPending = pendingAction !== null;

  return (
    <div className={`border-b border-border last:border-b-0 ${isExcluded ? 'opacity-50' : ''}`}>
      {/* ── Main row ── */}
      <div
        className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/30 ${
          hasUpdate && !isExcluded ? 'bg-primary/5' : ''
        }`}
      >
        {/* Expand toggle */}
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
        >
          <ChevronRight
            size={14}
            className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>

        {/* Status dot */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span />} className="cursor-default">
              {isChecking ? (
                <RefreshCw size={10} className="animate-spin text-primary" />
              ) : (
                <StatusDot status={isActionPending ? 'restarting' : container.status} />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {statusLabel(container.status, pendingAction, isChecking)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Name + badges + image */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">{container.name}</span>

            {/* Status icons */}
            {isExcluded && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span />} className="cursor-default">
                    <Ban size={12} className="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {container.exclude_reason ?? 'Excluded from monitoring'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isPinned && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span />} className="cursor-default">
                    <Pin size={12} className="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Version pinned — auto-updates blocked</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isStateful && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span />} className="cursor-default">
                    <Database size={12} className="text-orange-500" />
                  </TooltipTrigger>
                  <TooltipContent>Stateful service — excluded from bulk updates</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Policy badges — effective = label ?? ui */}
            {(() => {
              const effectivePolicy = container.label_policy ?? container.policy;
              if (!effectivePolicy || effectivePolicy === 'auto') return null;
              return (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    effectivePolicy === 'manual'
                      ? 'border-muted-foreground text-muted-foreground'
                      : 'border-primary/30 text-primary'
                  }`}
                >
                  {effectivePolicy === 'manual' ? 'MANUAL' : 'NOTIFY'}
                </Badge>
              );
            })()}
            {(() => {
              const effectiveLevel = container.label_update_level ?? container.update_level;
              if (!effectiveLevel || effectiveLevel === 'all') return null;
              return (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-violet-400/40 text-violet-500"
                >
                  {effectiveLevel.toUpperCase()}
                </Badge>
              );
            })()}
            {(() => {
              const effectivePattern = container.label_tag_pattern ?? container.tag_pattern;
              if (!effectivePattern) return null;
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span />} className="cursor-default">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-blue-400/30 text-blue-500"
                      >
                        TAG
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Tag pattern: {effectivePattern}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}

            {/* Orchestration badges — effective = label ?? ui */}
            {(() => {
              const effectiveGroup = container.label_group ?? container.update_group;
              if (!effectiveGroup) return null;
              return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {effectiveGroup}
                </Badge>
              );
            })()}
            {(() => {
              const effectivePriority = container.label_priority ?? container.update_priority;
              if (effectivePriority == null || effectivePriority === 100) return null;
              return (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-orange-400/30 text-orange-500"
                >
                  p{effectivePriority}
                </Badge>
              );
            })()}

            {/* Health status badge */}
            {container.health_status === 'unhealthy' && (
              <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] px-1.5 py-0">
                UNHEALTHY
              </Badge>
            )}
            {container.health_status === 'starting' && (
              <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px] px-1.5 py-0">
                STARTING
              </Badge>
            )}

            {/* Update / diff badges */}
            {hasUpdate && !isExcluded && !isPinned && (
              <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px] px-1.5 py-0">
                UPDATE
              </Badge>
            )}
            {hasUpdate &&
              container.last_diff &&
              (() => {
                try {
                  const diff = JSON.parse(container.last_diff) as ImageDiff;
                  if (diff.changeCount === 0) return null;
                  return (
                    <Dialog>
                      <DialogTrigger render={<button type="button" className="cursor-pointer" />}>
                        <DiffBadge diff={diff} />
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Image Diff — {container.name}</DialogTitle>
                          <DialogDescription>
                            Changes between current and latest image
                          </DialogDescription>
                        </DialogHeader>
                        <ImageDiffView diff={diff} />
                      </DialogContent>
                    </Dialog>
                  );
                } catch {
                  return null;
                }
              })()}
          </div>

          {/* Image + digest */}
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {container.image}
              {container.depends_on &&
                (() => {
                  try {
                    const deps = JSON.parse(container.depends_on) as string[];
                    if (deps.length > 0)
                      return (
                        <span className="ml-2 text-muted-foreground/60">
                          depends on: {deps.join(', ')}
                        </span>
                      );
                  } catch {
                    /* ignore */
                  }
                  return null;
                })()}
            </p>
            {container.current_digest && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span />} className="cursor-help shrink-0">
                    <Info size={12} className="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-none">
                    <span className="font-mono break-all">{container.current_digest}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0">
          {progress ? (
            <div className="flex items-center gap-1">
              {STEPS.map((s) => (
                <span
                  key={s}
                  className={`w-1.5 h-1.5 rounded-full ${
                    s === progress.step
                      ? 'bg-primary animate-pulse'
                      : STEPS.indexOf(s) < STEPS.indexOf(progress.step as (typeof STEPS)[number])
                        ? 'bg-success'
                        : 'bg-border'
                  }`}
                />
              ))}
              <span className="text-[10px] text-primary ml-1">{progress.step}</span>
            </div>
          ) : (
            <TooltipProvider>
              <div className="flex items-center gap-0.5">
                {!isExcluded && (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Check for updates"
                        variant="ghost"
                        size="icon-sm"
                        disabled={isChecking || isActionPending}
                        onClick={handleCheck}
                      >
                        {isChecking ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Check for updates</TooltipContent>
                  </Tooltip>
                )}

                {hasUpdate && !isPinned && !isExcluded && (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Update"
                        variant="ghost"
                        size="icon-sm"
                        className="text-primary hover:text-primary hover:bg-primary/10"
                        onClick={onUpdate}
                      >
                        <ArrowUpCircle size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Update to latest</TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <Button
                      aria-label="View logs"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setLogsOpen(true)}
                    >
                      <ScrollText size={15} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View logs</TooltipContent>
                </Tooltip>

                {!isPinned && (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Rollback"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setRollbackOpen(true)}
                      >
                        <RotateCcw size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Rollback</TooltipContent>
                  </Tooltip>
                )}

                {(isRunning || container.health_status === 'unhealthy') && (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Restart"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={isActionPending}
                        onClick={handleRestart}
                      >
                        {pendingAction === 'restart' ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <RotateCw size={15} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Restart container</TooltipContent>
                  </Tooltip>
                )}

                {isRunning ? (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Stop"
                        variant="ghost"
                        size="icon-sm"
                        className="text-warning hover:text-warning hover:bg-warning/10"
                        disabled={isActionPending}
                        onClick={handleStop}
                      >
                        {pendingAction === 'stop' ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Square size={15} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop container</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span />}>
                      <Button
                        aria-label="Start"
                        variant="ghost"
                        size="icon-sm"
                        className="text-success hover:text-success hover:bg-success/10"
                        disabled={isActionPending}
                        onClick={handleStart}
                      >
                        {pendingAction === 'start' ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Play size={15} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Start container</TooltipContent>
                  </Tooltip>
                )}

                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <Tooltip>
                    <AlertDialogTrigger
                      render={
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={isActionPending}
                              aria-label="Delete container"
                            />
                          }
                        />
                      }
                    >
                      {pendingAction === 'delete' ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </AlertDialogTrigger>
                    <TooltipContent>Delete container</TooltipContent>
                  </Tooltip>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete container?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will force-remove <strong>{container.name}</strong>. The container will
                        be stopped and permanently deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          setDeleteOpen(false);
                          handleDelete();
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* ── Expanded config panel ── */}
      {expanded && (
        <div className="px-8 pb-4 pt-3 bg-secondary/20 border-t border-border/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Update Policy */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Update Policy
              </p>

              {/* Policy radio */}
              <div className="space-y-1.5">
                <LabelRow label="Policy" lockedValue={container.label_policy} />
                {container.label_policy ? (
                  <LabelLockNotice value={container.label_policy} field="com.watchwarden.policy" />
                ) : (
                  <div className="space-y-1">
                    {(['auto', 'notify', 'manual'] as const).map((p) => (
                      <label
                        key={p}
                        htmlFor={`policy-${container.id}-${p}`}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <input
                          id={`policy-${container.id}-${p}`}
                          type="radio"
                          name={`policy-${container.id}`}
                          value={p}
                          checked={editPolicy === p}
                          onChange={() => setEditPolicy(p)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <span>
                          {p === 'auto' && 'Auto — follow agent / global setting'}
                          {p === 'notify' && 'Notify only — never auto-update'}
                          {p === 'manual' && 'Manual — skip checks entirely'}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Max update level */}
              <div className="space-y-1.5">
                <LabelRow label="Max update level" lockedValue={container.label_update_level} />
                {container.label_update_level ? (
                  <LabelLockNotice
                    value={container.label_update_level}
                    field="com.watchwarden.update_level"
                  />
                ) : (
                  <select
                    id={`level-${container.id}`}
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value)}
                    disabled={editPolicy === 'manual'}
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Default (inherit global)</option>
                    <option value="all">All versions</option>
                    <option value="major">Major + minor + patch</option>
                    <option value="minor">Minor + patch only</option>
                    <option value="patch">Patch only</option>
                  </select>
                )}
              </div>

              {/* Tag pattern */}
              <div className="space-y-1.5">
                <LabelRow label="Tag pattern" lockedValue={container.label_tag_pattern} />
                {container.label_tag_pattern ? (
                  <LabelLockNotice
                    value={container.label_tag_pattern}
                    field="com.watchwarden.tag_pattern"
                    mono
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: 'semver', value: '^\\d+\\.\\d+\\.\\d+$' },
                        { label: 'v-semver', value: '^v\\d+\\.\\d+\\.\\d+$' },
                        { label: 'date', value: '^\\d{4}\\.\\d{2}\\.\\d{2}$' },
                        { label: 'numeric', value: '^\\d+$' },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setEditTagPattern(preset.value)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            editTagPattern === preset.value
                              ? 'bg-primary/10 border-primary/40 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/30'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                      {editTagPattern && (
                        <button
                          type="button"
                          onClick={() => setEditTagPattern('')}
                          className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors cursor-pointer"
                        >
                          clear
                        </button>
                      )}
                    </div>
                    <input
                      id={`tagpattern-${container.id}`}
                      type="text"
                      value={editTagPattern}
                      onChange={(e) => setEditTagPattern(e.target.value)}
                      placeholder={String.raw`Regex, e.g. ^\d+\.\d+\.\d+$`}
                      disabled={editPolicy === 'manual'}
                      className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                    />
                  </>
                )}
              </div>

              {/* Save policy — hidden when all three fields are label-controlled */}
              {!(
                container.label_policy &&
                container.label_update_level &&
                container.label_tag_pattern
              ) && (
                <Button size="sm" disabled={updatePolicy.isPending} onClick={handleSavePolicy}>
                  {updatePolicy.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    'Save policy'
                  )}
                </Button>
              )}
            </div>

            {/* Orchestration */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Orchestration
              </p>

              {/* Group */}
              <div className="space-y-1.5">
                <LabelRow label="Update group" lockedValue={container.label_group} />
                {container.label_group ? (
                  <LabelLockNotice value={container.label_group} field="com.watchwarden.group" />
                ) : (
                  <>
                    <input
                      id={`group-${container.id}`}
                      type="text"
                      value={editGroup}
                      onChange={(e) => setEditGroup(e.target.value)}
                      placeholder="e.g. backend, frontend"
                      className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Containers in the same group are updated together.
                    </p>
                  </>
                )}
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <LabelRow
                  label="Priority"
                  lockedValue={
                    container.label_priority != null ? String(container.label_priority) : null
                  }
                />
                {container.label_priority != null ? (
                  <LabelLockNotice
                    value={String(container.label_priority)}
                    field="com.watchwarden.priority"
                  />
                ) : (
                  <>
                    <input
                      id={`priority-${container.id}`}
                      type="number"
                      min={1}
                      max={999}
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Lower = updated first within the group (default: 100).
                    </p>
                  </>
                )}
              </div>

              {/* Depends on */}
              <div className="space-y-1.5">
                <LabelRow label="Depends on" lockedValue={container.label_depends_on} />
                {container.label_depends_on ? (
                  <LabelLockNotice
                    value={(() => {
                      try {
                        return (JSON.parse(container.label_depends_on) as string[]).join(', ');
                      } catch {
                        return container.label_depends_on;
                      }
                    })()}
                    field="com.watchwarden.depends_on"
                  />
                ) : (
                  <>
                    <input
                      id={`depson-${container.id}`}
                      type="text"
                      value={editDependsOn}
                      onChange={(e) => setEditDependsOn(e.target.value)}
                      placeholder="e.g. postgres, redis"
                      className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Comma-separated container names that must update first.
                    </p>
                  </>
                )}
              </div>

              {/* Save orchestration — hidden when all three fields are label-controlled */}
              {!(
                container.label_group &&
                container.label_priority != null &&
                container.label_depends_on
              ) && (
                <Button size="sm" disabled={updateOrch.isPending} onClick={handleSaveOrch}>
                  {updateOrch.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    'Save orchestration'
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <VersionPickerModal
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        agentId={agentId}
        container={container}
      />
      <ContainerLogsDialog
        open={logsOpen}
        onOpenChange={setLogsOpen}
        agentId={agentId}
        container={container}
      />
    </div>
  );
}
