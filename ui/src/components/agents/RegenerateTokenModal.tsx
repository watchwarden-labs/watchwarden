import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '@/api/client';
import { useRegenerateAgentToken } from '@/api/hooks/useAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store/useStore';

interface RegenerateTokenModalProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegenerateTokenModal({
  agentId,
  agentName,
  open,
  onOpenChange,
}: RegenerateTokenModalProps) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const regenerateToken = useRegenerateAgentToken();
  const addToast = useStore((s) => s.addToast);

  const handleRegenerate = () => {
    regenerateToken.mutate(agentId, {
      onSuccess: (data) => setToken(data.token),
      onError: (err) =>
        addToast({ type: 'error', message: apiErrorMessage(err, 'Failed to regenerate token') }),
    });
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-HTTPS contexts (e.g. http://192.168.x.x)
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetAndClose = () => {
    setToken(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : resetAndClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {token ? 'Token Regenerated' : `Regenerate Token for ${agentName}`}
          </DialogTitle>
          <DialogDescription>
            {token
              ? 'Save the new token below — it will only be shown once.'
              : 'The current token will stop working immediately. The agent will show offline until AGENT_TOKEN is updated on the target host and the container is restarted.'}
          </DialogDescription>
        </DialogHeader>

        {token && (
          <div className="space-y-4 py-2">
            <Card>
              <CardContent className="pt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">New Agent Token</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => handleCopy(token)}
                  >
                    {copied ? (
                      <>
                        <Check size={12} className="text-success" data-icon="inline-start" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} data-icon="inline-start" /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <code className="block bg-background p-2.5 rounded font-mono text-sm text-primary break-all select-all">
                  {token}
                </code>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Update <code className="font-mono">AGENT_TOKEN</code> in the agent's environment on{' '}
              {agentName} and restart the container to reconnect.
            </p>
          </div>
        )}

        <DialogFooter>
          {!token ? (
            <>
              <Button variant="ghost" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRegenerate}
                disabled={regenerateToken.isPending}
              >
                {regenerateToken.isPending ? 'Regenerating...' : 'Regenerate Token'}
              </Button>
            </>
          ) : (
            <Button onClick={resetAndClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
