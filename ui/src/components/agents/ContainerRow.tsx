import {
  ArrowUpCircle,
  Ban,
  Database,
  Loader2,
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
} from '@/api/hooks/useAgents';
import { ContainerLogsDialog } from '@/components/agents/ContainerLogsDialog';
import { DigestBadge } from '@/components/common/DigestBadge';
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
          {container.policy && container.policy !== 'auto' && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span />} className="cursor-default">
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
                </TooltipTrigger>
                <TooltipContent>
                  {container.policy === 'manual'
                    ? 'Updates managed manually — set via com.watchwarden.policy=manual'
                    : 'Notify only — set via com.watchwarden.policy=notify'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
          {container.update_group && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {container.update_group}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
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
      </div>

      {/* Digest */}
      <div className="hidden lg:block shrink-0">
        <DigestBadge digest={container.current_digest} />
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
