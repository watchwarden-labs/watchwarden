import {
  ArrowUpCircle,
  Ban,
  Database,
  Info,
  Loader2,
  Pencil,
  Pin,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type Container,
  useCheckContainer,
  useContainerDelete,
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store/useStore';

const STEPS = ['pulling', 'stopping', 'removing', 'starting'] as const;

interface ContainerRowProps {
  agentId: string;
  container: Container;
  onUpdate?: () => void;
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
  if (isChecking) return 'checking…';
  return status;
}

export function ContainerRow({ agentId, container, onUpdate }: ContainerRowProps) {
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editPolicy, setEditPolicy] = useState<string>(container.policy ?? 'auto');
  const [orchOpen, setOrchOpen] = useState(false);
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
  const [editLevel, setEditLevel] = useState<string>(container.update_level ?? '');
  const [editTagPattern, setEditTagPattern] = useState<string>(container.tag_pattern ?? '');
  const [pendingAction, setPendingAction] = useState<'start' | 'stop' | 'delete' | 'check' | null>(
    null,
  );
  const progressKey = `${agentId}:${container.docker_id}`;
  const progress = useStore((s) => s.updateProgress[progressKey]);
  const addToast = useStore((s) => s.addToast);
  const checkingAgents = useStore((s) => s.checkingAgents);
  const checkContainer = useCheckContainer();
  const startContainer = useContainerStart();
  const stopContainer = useContainerStop();
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

  // Clear pending action when container data changes (status, check result, etc.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally watching specific container fields
  useEffect(() => {
    setPendingAction(null);
  }, [container.status, container.has_update, container.last_checked]);

  // Safety timeout: clear stale check state after 30s (e.g. if check fails silently)
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

  const isActionPending = pendingAction !== null;

  return (
    <div
      className={`group flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0 transition-colors hover:bg-secondary/30 ${
        hasUpdate && !isExcluded ? 'bg-primary/5' : ''
      } ${isExcluded ? 'opacity-50' : ''}`}
    >
      {/* Status dot with tooltip */}
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

      {/* Name + Image (stacked) */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{container.name}</span>
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
          {/* Policy / update-level — click pencil to edit */}
          <Dialog
            open={policyOpen}
            onOpenChange={(open) => {
              setPolicyOpen(open);
              if (open) {
                setEditPolicy(container.policy ?? 'auto');
                setEditLevel(container.update_level ?? '');
                setEditTagPattern(container.tag_pattern ?? '');
              }
            }}
          >
            <div className="flex items-center gap-1">
              {container.policy && container.policy !== 'auto' && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    container.policy === 'manual'
                      ? 'border-muted-foreground text-muted-foreground'
                      : 'border-primary/30 text-primary'
                  }`}
                >
                  {container.policy === 'manual' ? 'MANUAL' : 'NOTIFY'}
                </Badge>
              )}
              {container.update_level && container.update_level !== 'all' && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-violet-400/40 text-violet-500"
                >
                  {container.update_level.toUpperCase()}
                </Badge>
              )}
              {container.tag_pattern && (
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
                    <TooltipContent>Tag pattern: {container.tag_pattern}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                    aria-label="Edit policy"
                  />
                }
              >
                <Pencil size={11} className="text-muted-foreground" />
              </DialogTrigger>
            </div>

            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Update policy — {container.name}</DialogTitle>
                <DialogDescription>
                  Override how this container is treated during auto-updates.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Policy</p>
                  <div className="flex flex-col gap-1.5">
                    {(['auto', 'notify', 'manual'] as const).map((p) => (
                      <label
                        key={p}
                        htmlFor={`policy-${p}`}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <input
                          id={`policy-${p}`}
                          type="radio"
                          name="policy"
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-update-level">Max update level</Label>
                  <select
                    id="edit-update-level"
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value)}
                    disabled={editPolicy === 'manual'}
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Default (inherit global)</option>
                    <option value="all">All versions</option>
                    <option value="major">Major+minor+patch</option>
                    <option value="minor">Minor+patch only</option>
                    <option value="patch">Patch only</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Only applies to semver-tagged images (e.g. 1.2.3).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-tag-pattern">Tag pattern</Label>
                  <div className="flex flex-wrap gap-1 mb-1">
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
                    id="edit-tag-pattern"
                    type="text"
                    value={editTagPattern}
                    onChange={(e) => setEditTagPattern(e.target.value)}
                    placeholder="Regex, e.g. ^\d+\.\d+\.\d+$"
                    disabled={editPolicy === 'manual'}
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Filter which tags are considered for updates. Leave empty to allow any tag.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button
                  disabled={updatePolicy.isPending}
                  onClick={() => {
                    updatePolicy.mutate(
                      {
                        agentId,
                        containerId: container.id,
                        policy: editPolicy === 'auto' ? null : editPolicy,
                        updateLevel: editLevel || null,
                        tagPattern: editTagPattern || null,
                      },
                      {
                        onSuccess: () => setPolicyOpen(false),
                        onError: (err) =>
                          addToast({
                            type: 'error',
                            message: `Failed to save policy: ${err instanceof Error ? err.message : String(err)}`,
                          }),
                      },
                    );
                  }}
                >
                  {updatePolicy.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          <Dialog
            open={orchOpen}
            onOpenChange={(open) => {
              setOrchOpen(open);
              if (open) {
                setEditGroup(container.update_group ?? '');
                setEditPriority(String(container.update_priority ?? 100));
                setEditDependsOn(() => {
                  try {
                    return container.depends_on
                      ? (JSON.parse(container.depends_on) as string[]).join(', ')
                      : '';
                  } catch {
                    return '';
                  }
                });
              }
            }}
          >
            <div className="flex items-center gap-1">
              {container.update_group && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {container.update_group}
                </Badge>
              )}
              {container.update_priority !== null &&
                container.update_priority !== undefined &&
                container.update_priority !== 100 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-orange-400/30 text-orange-500"
                  >
                    p{container.update_priority}
                  </Badge>
                )}
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                    aria-label="Edit orchestration"
                  />
                }
              >
                <Pencil size={11} className="text-muted-foreground" />
              </DialogTrigger>
            </div>

            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Update orchestration — {container.name}</DialogTitle>
                <DialogDescription>
                  Control how this container is ordered within grouped updates.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-group">Update group</Label>
                  <input
                    id="edit-group"
                    type="text"
                    value={editGroup}
                    onChange={(e) => setEditGroup(e.target.value)}
                    placeholder="e.g. backend, frontend"
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Containers in the same group are updated together as a batch.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-priority">Priority</Label>
                  <input
                    id="edit-priority"
                    type="number"
                    min={1}
                    max={999}
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower number = updated first within the group (default: 100).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-depends-on">Depends on</Label>
                  <input
                    id="edit-depends-on"
                    type="text"
                    value={editDependsOn}
                    onChange={(e) => setEditDependsOn(e.target.value)}
                    placeholder="e.g. postgres, redis"
                    className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated container names that must update before this one.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button
                  disabled={updateOrch.isPending}
                  onClick={() => {
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
                        onSuccess: () => setOrchOpen(false),
                        onError: (err) =>
                          addToast({
                            type: 'error',
                            message: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
                          }),
                      },
                    );
                  }}
                >
                  {updateOrch.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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

      {/* Actions */}
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
