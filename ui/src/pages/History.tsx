import { useState } from 'react';
import { useHistory, useHistoryStats } from '@/api/hooks/useHistory';
import { Pagination } from '@/components/common/Pagination';
import { UpdateLogTable } from '@/components/history/UpdateLogTable';
import { Input } from '@/components/ui/input';

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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold">Update History</h1>

      {stats && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            Total: <strong>{stats.totalUpdates}</strong>
          </span>
          <span>
            Success rate: <strong>{stats.successRate.toFixed(1)}%</strong>
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
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

      <UpdateLogTable entries={history?.data ?? []} />

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
