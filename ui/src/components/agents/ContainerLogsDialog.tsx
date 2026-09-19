import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useContainerLogs } from '@/api/hooks/useAgents';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface ContainerLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  container: { docker_id: string; name: string };
}

const TAIL_OPTIONS = [100, 500, 1000, 5000];
const AUTO_REFRESH_INTERVAL = 5000;

// Many containerized processes (e.g. the Portainer agent) colorize their own
// stdout with ANSI escape codes. Docker passes those through raw, and we have
// no terminal to interpret them, so strip them rather than showing garbage
// escape sequences in a plain <pre> block. Built via String.fromCharCode to
// keep the source file free of literal control bytes.
const ESC = String.fromCharCode(0x1b);
const CSI_TERMINATOR = String.fromCharCode(0x07);
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?${CSI_TERMINATOR})` +
    `|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))`,
  'g',
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function ContainerLogsDialog({
  open,
  onOpenChange,
  agentId,
  container,
}: ContainerLogsDialogProps) {
  const [tail, setTail] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const { data, isLoading, error, refetch, isFetching } = useContainerLogs(
    agentId,
    container.docker_id,
    tail,
    open,
  );

  const cleanLogs = useMemo(() => (data?.logs ? stripAnsi(data.logs) : ''), [data?.logs]);

  // Auto-refresh
  useEffect(() => {
    if (!open || !autoRefresh) return;
    const id = setInterval(() => {
      refetch();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [open, autoRefresh, refetch]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (preRef.current && cleanLogs) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [cleanLogs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{container.name}</DialogTitle>
          <DialogDescription>Last {tail} lines</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {/* Tail selector */}
            <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
              {TAIL_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={tail === n ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => setTail(n)}
                >
                  {n}
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label="Refresh logs"
            >
              <RefreshCw
                size={12}
                data-icon="inline-start"
                className={isFetching ? 'animate-spin' : ''}
              />
              Refresh
            </Button>
          </div>

          <div className="flex items-center gap-4">
            {/* Auto-refresh toggle */}
            <div className="flex items-center gap-1.5">
              <Switch
                id="auto-refresh-toggle"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <Label htmlFor="auto-refresh-toggle" className="text-xs text-muted-foreground">
                Auto-refresh
              </Label>
            </div>

            {/* Wrap lines toggle */}
            <div className="flex items-center gap-1.5">
              <Switch id="wrap-lines-toggle" checked={wrapLines} onCheckedChange={setWrapLines} />
              <Label htmlFor="wrap-lines-toggle" className="text-xs text-muted-foreground">
                Wrap lines
              </Label>
            </div>
          </div>
        </div>

        <pre
          ref={preRef}
          className={`flex-1 overflow-auto rounded-lg bg-zinc-950 text-zinc-300 p-4 text-xs font-mono max-h-[60vh] min-h-[300px] leading-relaxed ${
            wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
          }`}
        >
          {isLoading && !data ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading logs...
            </span>
          ) : error ? (
            <span className="text-destructive">
              Failed to fetch logs:{' '}
              {(error as { body?: { error?: string } })?.body?.error ?? 'Unknown error'}
            </span>
          ) : cleanLogs ? (
            cleanLogs
          ) : (
            <span className="text-muted-foreground">No logs available</span>
          )}
        </pre>

        {autoRefresh && (
          <p className="text-[10px] text-muted-foreground text-right">
            Auto-refreshing every {AUTO_REFRESH_INTERVAL / 1000}s{isFetching && ' — fetching...'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
