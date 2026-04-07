import {
  Bell,
  Check,
  Hash,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { NotificationChannel } from '@/api/hooks/useNotifications';
import {
  useDeleteNotification,
  useTestNotification,
  useUpdateNotification,
} from '@/api/hooks/useNotifications';
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
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useStore } from '@/store/useStore';

const typeIcons: Record<string, typeof MessageCircle> = {
  telegram: MessageCircle,
  slack: Hash,
  webhook: Webhook,
  ntfy: Bell,
};

const typeColors: Record<string, string> = {
  telegram: 'text-primary',
  slack: 'text-warning',
  webhook: 'text-muted-foreground',
  ntfy: 'text-success',
};

const eventConfig: Record<string, { label: string; className: string }> = {
  update_available: {
    label: 'Available',
    className: 'bg-warning/15 text-warning border-warning/30',
  },
  update_success: {
    label: 'Success',
    className: 'bg-success/15 text-success border-success/30',
  },
  update_failed: {
    label: 'Failed',
    className: 'bg-destructive/15 text-destructive border-destructive/30',
  },
};

interface ChannelCardProps {
  channel: NotificationChannel;
  onEdit: () => void;
  compact?: boolean;
}

export function ChannelCard({ channel, onEdit, compact }: ChannelCardProps) {
  const updateChannel = useUpdateNotification();
  const deleteChannel = useDeleteNotification();
  const testChannel = useTestNotification();
  const addToast = useStore((s) => s.addToast);
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error' | 'cooldown'>(
    'idle',
  );

  const Icon = typeIcons[channel.type] ?? Webhook;
  const iconColor = typeColors[channel.type] ?? 'text-muted-foreground';
  const events = (() => {
    try {
      return JSON.parse(channel.events) as string[];
    } catch {
      return [];
    }
  })();

  const handleTest = () => {
    if (testState === 'cooldown') {
      addToast({
        type: 'info',
        message: 'Please wait before sending another test',
      });
      return;
    }
    setTestState('loading');
    testChannel.mutate(channel.id, {
      onSuccess: () => {
        setTestState('success');
        addToast({ type: 'success', message: 'Test notification sent' });
        setTimeout(() => setTestState('cooldown'), 1500);
        setTimeout(() => setTestState('idle'), 60_000);
      },
      onError: () => {
        setTestState('error');
        addToast({ type: 'error', message: 'Test notification failed' });
        setTimeout(() => setTestState('idle'), 2000);
      },
    });
  };

  if (compact) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="pt-0 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                <Icon size={16} className={iconColor} />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{channel.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{channel.type}</p>
              </div>
            </div>
            <Switch
              size="sm"
              checked={!!channel.enabled}
              onCheckedChange={(checked) =>
                updateChannel.mutate({ id: channel.id, enabled: checked })
              }
            />
          </div>

          <div className="flex flex-wrap gap-1 mb-3">
            {events.map((e) => (
              <Badge
                key={e}
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${eventConfig[e]?.className ?? ''}`}
              >
                {eventConfig[e]?.label ?? e}
              </Badge>
            ))}
          </div>

          <div className="flex gap-1.5 mt-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleTest}
              disabled={testState === 'loading'}
            >
              {testState === 'loading' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : testState === 'success' ? (
                <Check size={12} className="text-success" />
              ) : testState === 'error' ? (
                <X size={12} className="text-destructive" />
              ) : (
                <Send size={12} />
              )}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
              <Pencil size={12} />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive"
                    aria-label="Delete channel"
                  />
                }
              >
                <Trash2 size={12} />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{channel.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This notification channel will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      deleteChannel.mutate(channel.id, {
                        onError: () =>
                          addToast({
                            type: 'error',
                            message: 'Failed to delete channel',
                          }),
                      })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    );
  }

  // List/row view (original full-width)
  return (
    <Card>
      <CardContent className="pt-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
              <Icon size={18} className={iconColor} />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm">{channel.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{channel.type}</p>
            </div>
            <div className="hidden sm:flex gap-1.5 ml-4">
              {events.map((e) => (
                <Badge
                  key={e}
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${eventConfig[e]?.className ?? ''}`}
                >
                  {eventConfig[e]?.label ?? e}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={handleTest}
              disabled={testState === 'loading'}
            >
              {testState === 'loading' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : testState === 'success' ? (
                <Check size={12} className="text-success" />
              ) : testState === 'error' ? (
                <X size={12} className="text-destructive" />
              ) : (
                <Send size={12} />
              )}
              {testState === 'cooldown' ? 'Wait...' : 'Test'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={onEdit}>
              <Pencil size={12} />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-destructive"
                    aria-label="Delete channel"
                  />
                }
              >
                <Trash2 size={12} />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{channel.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This notification channel will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      deleteChannel.mutate(channel.id, {
                        onError: () =>
                          addToast({
                            type: 'error',
                            message: 'Failed to delete channel',
                          }),
                      })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Switch
              checked={!!channel.enabled}
              onCheckedChange={(checked) =>
                updateChannel.mutate({ id: channel.id, enabled: checked })
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
