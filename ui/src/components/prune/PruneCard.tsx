import { Loader2, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '@/api/client';
import { usePruneAgent, usePrunePreview } from '@/api/hooks/useAgents';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { describeRemoved, formatBytes } from '@/lib/prune';
import { useStore } from '@/store/useStore';

interface PruneCardProps {
  agentId: string;
  agentName: string;
  online: boolean;
}

/** Parses the "keep previous" field; null when it is not a whole number from 0 to 10. */
export function parseKeep(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= 0 && n <= 10 ? n : null;
}

export function PruneCard({ agentId, agentName, online }: PruneCardProps) {
  const [keepRaw, setKeepRaw] = useState('1');
  const [includeStopped, setIncludeStopped] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);

  const addToast = useStore((s) => s.addToast);
  const progress = useStore((s) => s.pruneProgress[agentId]);
  const completedAt = useStore((s) => s.pruneCompletedAt[agentId]);
  const pruneAgent = usePruneAgent();

  const keep = parseKeep(keepRaw);
  const opts = keep === null ? null : { keepPrevious: keep, includeStopped };
  const preview = usePrunePreview(agentId, opts, online);
  const running = !!progress || pruneAgent.isPending;

  // Totals change after every prune, so refetch when one completes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: completedAt is the trigger
  useEffect(() => {
    if (completedAt) void preview.refetch();
  }, [completedAt]);

  const data = preview.data;
  const nothingToPrune =
    !!data && data.removableImages === 0 && (!includeStopped || data.stoppedContainers === 0);
  const disabled = !online || running || keep === null;

  const startPrune = () => {
    if (keep === null) return;
    setConfirmOpen(false);
    pruneAgent.mutate(
      { id: agentId, keepPrevious: keep, includeStopped },
      {
        onError: (err) =>
          addToast({ type: 'error', message: apiErrorMessage(err, 'Prune failed') }),
      },
    );
  };

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Scissors size={16} /> Image Pruning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Remove old images from this agent, keeping the specified number of previous versions per
          repository. Images in use, and images needed for rollback, are never removed.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm" aria-live="polite">
          {!online ? (
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Agent is offline — usage summary unavailable.
            </p>
          ) : preview.isLoading ? (
            <>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </>
          ) : preview.isError ? (
            <p className="text-xs text-destructive sm:col-span-3">
              Couldn't load usage summary: {apiErrorMessage(preview.error, 'agent did not respond')}
            </p>
          ) : data ? (
            <>
              <Stat
                label="Images"
                value={formatBytes(data.totalImageSize)}
                hint={`${data.totalImages} total`}
              />
              <Stat
                label="Can be removed"
                value={formatBytes(data.removableSize)}
                hint={`${data.removableImages} unused image${data.removableImages === 1 ? '' : 's'}`}
              />
              <Stat
                label="Stopped containers"
                value={String(data.stoppedContainers)}
                hint={
                  includeStopped
                    ? `${formatBytes(data.stoppedSize)} — will be removed`
                    : 'kept (not selected)'
                }
              />
            </>
          ) : null}
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="prune-stopped"
            checked={includeStopped}
            onCheckedChange={(v) => setIncludeStopped(v === true)}
            disabled={running}
          />
          <div className="space-y-0.5">
            <Label htmlFor="prune-stopped" className="text-sm">
              Also remove stopped containers
            </Label>
            <p className="text-xs text-muted-foreground">
              Deletes exited and never-started containers (their volumes are kept), which also frees
              the images they used.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="prune-keep" className="text-xs text-muted-foreground">
              Keep previous versions
            </Label>
            <Input
              id="prune-keep"
              type="number"
              inputMode="numeric"
              min={0}
              max={10}
              value={keepRaw}
              onChange={(e) => setKeepRaw(e.target.value)}
              aria-invalid={keep === null}
              className="w-24"
            />
            {keep === null && (
              <p className="text-xs text-destructive">Enter a whole number from 0 to 10</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setDryRunOpen(true)}
          >
            Dry Run
          </Button>
          <Button
            size="sm"
            disabled={disabled || nothingToPrune}
            onClick={() => setConfirmOpen(true)}
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" data-icon="inline-start" />
            ) : (
              <Scissors size={14} data-icon="inline-start" />
            )}
            {running ? 'Pruning…' : 'Prune Images'}
          </Button>
          {nothingToPrune && !running && (
            <span className="text-xs text-muted-foreground">Nothing to prune</span>
          )}
        </div>

        {running && (
          <div className="space-y-1" aria-live="polite">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
              className="h-2 w-full overflow-hidden rounded bg-secondary"
            >
              <div
                className={`h-full bg-primary transition-all ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {progress && progress.total > 0
                ? `Removing ${progress.phase === 'containers' ? 'container' : 'image'} ${progress.done}/${progress.total}${progress.current ? ` — ${progress.current}` : ''}`
                : 'Starting…'}
            </p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune images on {agentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {data ? (
                <>
                  This will permanently remove{' '}
                  <strong>
                    {describeRemoved(
                      data.removableImages,
                      includeStopped ? data.stoppedContainers : 0,
                    )}
                  </strong>{' '}
                  (about {formatBytes(data.removableSize + (includeStopped ? data.stoppedSize : 0))}
                  ), keeping <strong>{keep}</strong> previous version{keep === 1 ? '' : 's'} per
                  repository.
                </>
              ) : (
                'This will permanently remove old Docker images.'
              )}{' '}
              Images in use and rollback targets are not removed.
              {includeStopped && ' Stopped containers will be deleted too.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={startPrune}>Prune</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dry run — {agentName}</DialogTitle>
            <DialogDescription>
              Nothing is removed. This is what a prune with these settings would delete.
            </DialogDescription>
          </DialogHeader>
          {preview.isFetching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Checking…
            </div>
          ) : data && data.items.length > 0 ? (
            <ul className="max-h-72 overflow-y-auto divide-y divide-border text-sm">
              {data.items.map((item) => (
                <li
                  key={`${item.kind}:${item.image}`}
                  className="flex justify-between gap-3 py-1.5"
                >
                  <span className="truncate">
                    {item.kind === 'container' ? '▢ ' : ''}
                    {item.image}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(item.size)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to prune.</p>
          )}
          {data && data.items.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Total:{' '}
              {describeRemoved(data.removableImages, includeStopped ? data.stoppedContainers : 0)},
              about {formatBytes(data.removableSize + (includeStopped ? data.stoppedSize : 0))}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
