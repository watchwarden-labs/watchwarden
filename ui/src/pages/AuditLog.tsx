import { ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAgents } from '@/api/hooks/useAgents';
import { useAuditLogs } from '@/api/hooks/useAudit';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, string> = {
  'agent.register': 'Register Agent',
  'agent.delete': 'Delete Agent',
  'agent.check': 'Check Updates',
  'container.update': 'Update Container',
  'container.rollback': 'Rollback Container',
  'config.change': 'Change Config',
  'notification.create': 'Create Channel',
  'notification.update': 'Update Channel',
  'notification.delete': 'Delete Channel',
  'registry.create': 'Add Registry',
  'registry.delete': 'Remove Registry',
  auto_update: 'Auto Update',
  auto_rollback: 'Auto Rollback',
};

const ACTION_COLORS: Record<string, string> = {
  'agent.register': 'bg-success/15 text-success border-success/30',
  'agent.delete': 'bg-destructive/15 text-destructive border-destructive/30',
  'container.update': 'bg-primary/15 text-primary border-primary/30',
  'container.rollback': 'bg-warning/15 text-warning border-warning/30',
  'config.change': 'bg-muted text-muted-foreground',
  auto_update: 'bg-primary/15 text-primary border-primary/30',
  auto_rollback: 'bg-destructive/15 text-destructive border-destructive/30',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDetails(raw: string): Array<{ key: string; value: string }> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj).map(([k, v]) => ({
      key: k,
      value: Array.isArray(v) ? JSON.stringify(v) : String(v),
    }));
  } catch {
    return [{ key: 'raw', value: raw }];
  }
}

export default function AuditLog() {
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data, isLoading } = useAuditLogs({
    action: actionFilter === 'all' ? undefined : actionFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const { data: agents = [] } = useAgents();
  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      map.set(a.id, a.name);
    }
    return map;
  }, [agents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield size={24} /> Audit Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track all actions performed on the system
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Events</CardTitle>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(0);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring w-[200px]"
            >
              <option value="all">All Actions</option>
              <option value="agent.register">Register Agent</option>
              <option value="agent.delete">Delete Agent</option>
              <option value="agent.check">Check Updates</option>
              <option value="container.update">Update Container</option>
              <option value="container.rollback">Rollback</option>
              <option value="config.change">Config Change</option>
              <option value="auto_update">Auto Update</option>
              <option value="auto_rollback">Auto Rollback</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No audit events found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const isExpanded = expandedRows.has(log.id);
                    const hasDetails = !!log.details;
                    return (
                      <>
                        <TableRow
                          key={log.id}
                          className={hasDetails ? 'cursor-pointer hover:bg-muted/50' : ''}
                          onClick={() => hasDetails && toggleRow(log.id)}
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
                            {formatTime(log.created_at)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs ${ACTION_COLORS[log.action] ?? ''}`}
                            >
                              {ACTION_LABELS[log.action] ?? log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{log.actor}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {log.target_type}
                            {log.target_id && (
                              <span className="ml-1 text-xs">
                                {log.target_type === 'agent'
                                  ? (agentNames.get(log.target_id) ?? log.target_id.slice(0, 8))
                                  : log.target_id.slice(0, 8)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground font-mono">
                            {log.ip_address ?? '—'}
                          </TableCell>
                        </TableRow>
                        {isExpanded && hasDetails && (
                          <TableRow key={`${log.id}-details`}>
                            <TableCell />
                            <TableCell colSpan={5} className="bg-muted/30 py-3">
                              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
                                {formatDetails(log.details!).map((item) => (
                                  <>
                                    <span key={`k-${item.key}`} className="text-muted-foreground">
                                      {item.key}
                                    </span>
                                    <span key={`v-${item.key}`} className="break-all">
                                      {item.value}
                                    </span>
                                  </>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>

              <Pagination
                page={page}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                label={`${total} event${total !== 1 ? 's' : ''}`}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
