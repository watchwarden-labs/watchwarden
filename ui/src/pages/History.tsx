import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useHistory, useHistoryStats } from '@/api/hooks/useHistory';
import { DigestBadge } from '@/components/common/DigestBadge';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function HistoryPage() {
  const [agentFilter, setAgentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: history } = useHistory({
    agentId: agentFilter || undefined,
    status: statusFilter || undefined,
    limit,
    offset: page * limit,
  });
  const { data: stats } = useHistoryStats();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Update History</h1>

      {stats && (
        <div className="flex gap-4 text-sm">
          <span>
            Total: <strong>{stats.totalUpdates}</strong>
          </span>
          <span>
            Success rate: <strong>{stats.successRate.toFixed(1)}%</strong>
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <Input
          placeholder="Filter by agent ID..."
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2 rounded-md bg-card border border-border text-sm text-foreground"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="rolled_back">Rolled back</option>
        </select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Time</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Container</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!history || history.data.length === 0) && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No history entries
                </TableCell>
              </TableRow>
            )}
            {history?.data.map((entry) => {
              const isExpanded = expandedRows.has(entry.id);
              const hasDetails = !!(entry.old_digest || entry.new_digest || entry.error);
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
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(entry.created_at, { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.agent_id}
                    </TableCell>
                    <TableCell className="text-sm">{entry.container_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.status === 'success' ? 'outline' : 'destructive'}
                        className={entry.status === 'success' ? 'border-success text-success' : ''}
                      >
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                  </TableRow>
                  {isExpanded && hasDetails && (
                    <TableRow>
                      <TableCell />
                      <TableCell colSpan={5} className="bg-muted/30 py-3">
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs font-mono">
                          {entry.old_digest && (
                            <>
                              <span className="text-muted-foreground">Old digest</span>
                              <DigestBadge digest={entry.old_digest} />
                            </>
                          )}
                          {entry.new_digest && (
                            <>
                              <span className="text-muted-foreground">New digest</span>
                              <DigestBadge digest={entry.new_digest} />
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

      {history && (
        <Pagination
          page={page}
          total={history.total}
          pageSize={limit}
          onPageChange={setPage}
          label={`${history.total} entry${history.total !== 1 ? 's' : ''}`}
        />
      )}
    </div>
  );
}
