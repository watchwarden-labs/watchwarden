import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCircle, LayoutGrid, List, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { NotificationChannel } from '@/api/hooks/useNotifications';
import { useNotificationLogs, useNotifications } from '@/api/hooks/useNotifications';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AddChannelModal } from './AddChannelModal';
import { ChannelCard } from './ChannelCard';

export function NotificationsTab() {
  const { data: channels = [] } = useNotifications();
  const { data: logs = [] } = useNotificationLogs();
  const [addOpen, setAddOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(
    () => (localStorage.getItem('watchwarden_notif_view') as 'grid' | 'list') ?? 'grid',
  );
  const LOG_PAGE_SIZE = 20;

  const handleViewChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('watchwarden_notif_view', mode);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Notification Channels</h3>
          <p className="text-sm text-muted-foreground">
            Get notified when container updates are available or complete.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => handleViewChange('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => handleViewChange('list')}
              aria-label="List view"
            >
              <List size={14} />
            </Button>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> Add Channel
          </Button>
        </div>
      </div>

      {channels.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Bell size={40} className="text-muted-foreground/40" />
            <p className="text-muted-foreground">No notification channels yet</p>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              Add your first channel
            </Button>
          </CardContent>
        </Card>
      )}

      {channels.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              compact
              onEdit={() => {
                setEditChannel(ch);
                setAddOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {channels.length > 0 && viewMode === 'list' && (
        <div className="space-y-2">
          {channels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              onEdit={() => {
                setEditChannel(ch);
                setAddOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Delivery Logs */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Delivery History</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE).map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm">{log.channel_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {log.event_type.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {log.status === 'success' ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle size={12} /> Sent
                      </span>
                    ) : (
                      <span
                        className="flex items-center gap-1 text-xs text-destructive"
                        title={log.error ?? ''}
                      >
                        <XCircle size={12} /> Failed
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(log.created_at, { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={logPage}
            total={logs.length}
            pageSize={LOG_PAGE_SIZE}
            onPageChange={setLogPage}
            label={`${logs.length} delivery log${logs.length !== 1 ? 's' : ''}`}
          />
        </Card>
      )}

      <AddChannelModal
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setEditChannel(null);
        }}
        editChannel={editChannel}
      />
    </div>
  );
}
