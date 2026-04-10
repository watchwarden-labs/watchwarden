import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { UpdateLogEntry } from '@/api/hooks/useHistory';
import { DigestBadge } from '@/components/common/DigestBadge';
import { DiffBadge, type ImageDiff, ImageDiffView } from '@/components/diff/ImageDiffView';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function ImageVersionLabel({ image, digest }: { image: string | null; digest: string | null }) {
  if (!image && !digest) return <span className="text-muted-foreground">—</span>;

  const label = image ?? (digest?.includes('@sha256:') ? digest.split('@sha256:')[0] : null);

  if (label) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs">
        {label}
        {digest && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span />} className="cursor-help inline-flex shrink-0">
                <Info size={12} className="text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-none">
                <span className="font-mono break-all">{digest}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    );
  }
  return <DigestBadge digest={digest} />;
}

interface UpdateLogTableProps {
  entries: UpdateLogEntry[];
  emptyMessage?: string;
}

export function UpdateLogTable({
  entries,
  emptyMessage = 'No history entries',
}: UpdateLogTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="hidden sm:table-cell">Time</TableHead>
            <TableHead className="hidden md:table-cell">Agent</TableHead>
            <TableHead>Container</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const isExpanded = expandedRows.has(entry.id);
            const parsedDiff: ImageDiff | null = entry.diff
              ? (() => {
                  try {
                    return JSON.parse(entry.diff) as ImageDiff;
                  } catch {
                    return null;
                  }
                })()
              : null;
            const hasDetails = !!(
              entry.old_digest ||
              entry.new_digest ||
              entry.old_image ||
              entry.new_image ||
              entry.error ||
              parsedDiff
            );

            return (
              <Fragment key={entry.id}>
                <TableRow
                  className={hasDetails ? 'cursor-pointer hover:bg-muted/50' : ''}
                  onClick={() => hasDetails && toggleRow(entry.id)}
                >
                  <TableCell className="w-8 pr-0">
                    {hasDetails &&
                      (isExpanded ? (
                        <ChevronDown size={14} className="text-muted-foreground" />
                      ) : (
                        <ChevronRight size={14} className="text-muted-foreground" />
                      ))}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(entry.created_at, { addSuffix: true })}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {entry.agent_name ?? entry.agent_id}
                  </TableCell>
                  <TableCell className="text-sm">{entry.container_name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.status === 'success' ? 'outline' : 'destructive'}
                      className={
                        entry.status === 'success'
                          ? 'border-success text-success'
                          : entry.status === 'rolled_back'
                            ? 'border-primary/30 text-primary'
                            : ''
                      }
                    >
                      {entry.status === 'rolled_back' ? 'rollback' : entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </TableCell>
                </TableRow>
                {isExpanded && hasDetails && (
                  <TableRow>
                    <TableCell />
                    <TableCell colSpan={5} className="bg-muted/30 py-3">
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs font-mono">
                        {(entry.old_digest || entry.old_image) && (
                          <>
                            <span className="text-muted-foreground">Old version</span>
                            <ImageVersionLabel
                              image={entry.old_image ?? null}
                              digest={entry.old_digest ?? null}
                            />
                          </>
                        )}
                        {(entry.new_digest || entry.new_image) && (
                          <>
                            <span className="text-muted-foreground">New version</span>
                            <ImageVersionLabel
                              image={entry.new_image ?? null}
                              digest={entry.new_digest ?? null}
                            />
                          </>
                        )}
                        {entry.duration_ms && (
                          <>
                            <span className="text-muted-foreground">Duration</span>
                            <span>{(entry.duration_ms / 1000).toFixed(1)}s</span>
                          </>
                        )}
                        {entry.error && (
                          <>
                            <span className="text-muted-foreground">Error</span>
                            <span className="text-destructive break-all">{entry.error}</span>
                          </>
                        )}
                        {parsedDiff && (
                          <>
                            <span className="text-muted-foreground">Image diff</span>
                            <Dialog>
                              <DialogTrigger
                                render={<button type="button" className="w-fit cursor-pointer" />}
                              >
                                <DiffBadge diff={parsedDiff} />
                              </DialogTrigger>
                              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Image changes — {entry.container_name}</DialogTitle>
                                </DialogHeader>
                                <ImageDiffView diff={parsedDiff} />
                              </DialogContent>
                            </Dialog>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
