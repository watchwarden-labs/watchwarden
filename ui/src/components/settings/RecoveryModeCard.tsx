import { Shield, ShieldAlert, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useDisableRecoveryMode,
  useEnableRecoveryMode,
  useRecoveryMode,
} from '@/api/hooks/useSettings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStore } from '@/store/useStore';

const TTL_OPTIONS = [
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
];

export function RecoveryModeCard() {
  const { data: status } = useRecoveryMode();
  const enableMutation = useEnableRecoveryMode();
  const disableMutation = useDisableRecoveryMode();
  const addToast = useStore((s) => s.addToast);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedTtl, setSelectedTtl] = useState(15);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Live countdown
  useEffect(() => {
    if (!status?.enabled || !status.expiresAt) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.round((status.expiresAt! - Date.now()) / 1000));
      setCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status?.enabled, status?.expiresAt]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleEnable = () => {
    enableMutation.mutate(
      { ttlMinutes: selectedTtl },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          addToast({
            type: 'success',
            message: `Recovery mode enabled for ${selectedTtl} minutes`,
          });
        },
        onError: () => addToast({ type: 'error', message: 'Failed to enable recovery mode' }),
      },
    );
  };

  const handleDisable = () => {
    disableMutation.mutate(undefined, {
      onSuccess: () => addToast({ type: 'success', message: 'Recovery mode disabled' }),
      onError: () => addToast({ type: 'error', message: 'Failed to disable recovery mode' }),
    });
  };

  const isActive = status?.enabled && countdown !== null && countdown > 0;

  return (
    <>
      <Card className={isActive ? 'border-orange-500/50' : ''}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2">
                {isActive ? (
                  <ShieldAlert size={18} className="text-orange-500" />
                ) : (
                  <Shield size={18} className="text-muted-foreground" />
                )}
                Recovery Mode
              </CardTitle>
              {isActive && (
                <Badge className="bg-orange-500/15 text-orange-500 border-orange-500/30">
                  ACTIVE — {formatTime(countdown!)}
                </Badge>
              )}
            </div>
            {isActive ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDisable}
                disabled={disableMutation.isPending}
              >
                <ShieldOff size={14} /> Disable
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
                <Shield size={14} /> Enable
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isActive ? (
            <p className="text-sm text-orange-500">
              Agents with valid tokens can auto-register without manual setup. This window will
              close automatically when the timer expires.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enable recovery mode to allow deployed agents to re-register automatically after a
              database reset. Agents must have a valid token configured.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enable Recovery Mode</DialogTitle>
            <DialogDescription>
              During recovery mode, any machine that connects with a valid-format agent token will
              be automatically registered. Only enable this after a database loss to recover
              existing agents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <span className="text-sm font-medium">Duration</span>
            <div className="flex gap-2">
              {TTL_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={selectedTtl === opt.value ? 'default' : 'outline'}
                  onClick={() => setSelectedTtl(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              onClick={handleEnable}
              disabled={enableMutation.isPending}
            >
              {enableMutation.isPending ? 'Enabling...' : 'Enable Recovery Mode'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
