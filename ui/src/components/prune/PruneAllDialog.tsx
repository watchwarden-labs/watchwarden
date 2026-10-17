import { Loader2, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '@/api/client';
import { useCurrentPruneRun, usePruneAll } from '@/api/hooks/useAgents';
import { parseKeep } from '@/components/prune/PruneCard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeRemoved, formatBytes } from '@/lib/prune';
import { useStore } from '@/store/useStore';

const STATUS_LABEL = {
  success: 'Done',
  partial: 'Done with errors',
  failed: 'Failed',
  skipped: 'Skipped',
} as const;

interface PruneAllButtonProps {
  disabled?: boolean;
}

/** "Prune all agents" button and its dialog: options, live progress, then a per-agent summary. */
export function PruneAllButton({ disabled }: PruneAllButtonProps) {
  const [open, setOpen] = useState(false);
  const [keepRaw, setKeepRaw] = useState('1');
  const [includeStopped, setIncludeStopped] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const pruneAll = usePruneAll();
  const addToast = useStore((s) => s.addToast);
  const run = useStore((s) => s.pruneRun);
  const setPruneRun = useStore((s) => s.setPruneRun);
  const current = useCurrentPruneRun(open && run === null);

  // Restore a run started before this page loaded (or from another tab).
  useEffect(() => {
    const existing = current.data?.run;
    if (existing && useStore.getState().pruneRun === null) setPruneRun(existing);
  }, [current.data, setPruneRun]);

  const keep = parseKeep(keepRaw);
  const running = run?.status === 'running';
  const start = () => {
    if (keep === null) return;
    pruneAll.mutate(
      { keepPrevious: keep, includeStopped, dryRun },
      {
        onSuccess: (summary) => setPruneRun(summary),
        onError: (err) =>
          addToast({ type: 'error', message: apiErrorMessage(err, 'Could not start prune') }),
      },
    );
  };

  const done = run?.status === 'complete';
  const totalAgents = run?.totals.agents ?? 0;

  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        {running ? (
          <Loader2 size={16} className="animate-spin" data-icon="inline-start" />
        ) : (
          <Scissors size={16} data-icon="inline-start" />
        )}
        {running ? 'Pruning…' : 'Prune all'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prune all agents</DialogTitle>
            <DialogDescription>
              Prunes each online agent one after another, then shows a summary. Offline agents are
              skipped.
            </DialogDescription>
          </DialogHeader>

          {!running && !done && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="prune-all-keep" className="text-xs text-muted-foreground">
                  Keep previous versions
                </Label>
                <Input
                  id="prune-all-keep"
                  type="number"
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
              <div className="flex items-center gap-2">
                <Checkbox
                  id="prune-all-stopped"
                  checked={includeStopped}
                  onCheckedChange={(v) => setIncludeStopped(v === true)}
                />
                <Label htmlFor="prune-all-stopped">Also remove stopped containers</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="prune-all-dry"
                  checked={dryRun}
                  onCheckedChange={(v) => setDryRun(v === true)}
                />
                <Label htmlFor="prune-all-dry">Dry run (report only, remove nothing)</Label>
              </div>
            </div>
          )}

          {running && run && (
            <div className="space-y-2" aria-live="polite">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalAgents}
                aria-valuenow={run.results.length}
                className="h-2 w-full overflow-hidden rounded bg-secondary"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${totalAgents ? Math.round((run.results.length / totalAgents) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {run.currentAgent
                  ? `Pruning ${run.currentAgent} (${Math.min(run.index + 1, totalAgents)} of ${totalAgents})…`
                  : `${run.results.length} of ${totalAgents} agents done…`}
              </p>
            </div>
          )}

          {run && (running || done) && run.results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto divide-y divide-border text-sm">
              {run.results.map((r) => (
                <li key={r.agentId} className="py-1.5 flex justify-between gap-3">
                  <span className="truncate">{r.agentName}</span>
                  <span
                    className={`shrink-0 text-right ${r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
                    title={r.error ?? r.errors[0]}
                  >
                    {r.status === 'skipped' || r.status === 'failed'
                      ? `${STATUS_LABEL[r.status]}${r.error ? ` — ${r.error}` : ''}`
                      : `${run.dryRun ? 'Would remove' : 'Removed'} ${describeRemoved(r.imagesRemoved, r.containersRemoved)} · ${formatBytes(r.spaceReclaimed)}${r.status === 'partial' ? ` · ${r.errors.length} failed` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {done && run && (
            <p className="text-sm font-medium">
              {run.dryRun ? 'Dry run: would remove' : 'Total: removed'}{' '}
              {describeRemoved(run.totals.imagesRemoved, run.totals.containersRemoved)} (~
              {formatBytes(run.totals.spaceReclaimed)}) across {totalAgents - run.totals.skipped}{' '}
              agent{totalAgents - run.totals.skipped === 1 ? '' : 's'}
              {run.totals.failed > 0 && `, ${run.totals.failed} failed`}
              {run.totals.skipped > 0 && `, ${run.totals.skipped} skipped`}.
            </p>
          )}

          <DialogFooter>
            {done ? (
              <>
                <Button variant="outline" onClick={() => setPruneRun(null)}>
                  New run
                </Button>
                <Button onClick={() => setOpen(false)}>Close</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {running ? 'Hide' : 'Cancel'}
                </Button>
                {!running && (
                  <Button disabled={keep === null || pruneAll.isPending} onClick={start}>
                    {pruneAll.isPending ? 'Starting…' : dryRun ? 'Run dry run' : 'Prune all agents'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
