import { formatDistanceToNow } from 'date-fns';
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
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No history entries
                </TableCell>
              </TableRow>
            )}
            {history?.data.map((entry) => (
              <Fragment key={entry.id}>
                <TableRow
                  key={entry.id}
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <TableCell className="text-sm">
                    {formatDistanceToNow(entry.created_at, { addSuffix: true })}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{entry.agent_id}</TableCell>
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
                    {entry.duration_ms ? `${entry.duration_ms}ms` : '—'}
                  </TableCell>
                </TableRow>
                {expandedId === entry.id && (
                  <TableRow key={`${entry.id}-detail`}>
                    <TableCell colSpan={5} className="bg-secondary text-sm">
                      <div className="space-y-1">
                        <div>
                          Old: <DigestBadge digest={entry.old_digest} />
                        </div>
                        <div>
                          New: <DigestBadge digest={entry.new_digest} />
                        </div>
                        {entry.error && (
                          <div className="text-destructive">Error: {entry.error}</div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
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
