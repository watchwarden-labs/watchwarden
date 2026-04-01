import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useRegisterAgent } from '@/api/hooks/useAgents';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store/useStore';

interface RegisterAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterAgentModal({ open, onOpenChange }: RegisterAgentModalProps) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [result, setResult] = useState<{
    agentId: string;
    token: string;
  } | null>(null);
  const [copied, setCopied] = useState<'token' | 'compose' | null>(null);
  const registerAgent = useRegisterAgent();
  const addToast = useStore((s) => s.addToast);

  const handleRegister = () => {
    registerAgent.mutate(
      { name, hostname },
      {
        onSuccess: (data) => {
          setResult(data);
          addToast({ type: 'success', message: `Agent "${name}" registered` });
        },
        onError: () => addToast({ type: 'error', message: 'Failed to register agent' }),
      },
    );
  };

  const handleCopy = (text: string, type: 'token' | 'compose') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const resetAndClose = () => {
    setName('');
    setHostname('');
    setResult(null);
    setCopied(null);
    onOpenChange(false);
  };

  const controllerWsUrl = (() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:3000`;
  })();

  const composeSnippet = result
    ? `services:
  watchwarden-agent:
    image: alexneo/watchwarden-agent:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTROLLER_URL: "${controllerWsUrl}"
      AGENT_TOKEN: "${result.token}"
      AGENT_NAME: "${name || 'my-server'}"
    restart: unless-stopped`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? 'Agent Registered' : 'Register New Agent'}</DialogTitle>
          <DialogDescription>
            {result
              ? 'Save the token below — it will only be shown once.'
              : 'Create a new agent token to connect a remote Docker host.'}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Agent Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. production-server"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this agent in the dashboard.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Hostname</Label>
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="e.g. srv-01.example.com"
              />
              <p className="text-xs text-muted-foreground">
                The server hostname where the agent will run.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-success/15 text-success border-success/30">Registered</Badge>
              <span className="text-sm text-muted-foreground">
                ID: {result.agentId.slice(0, 8)}...
              </span>
            </div>

            <Card>
              <CardContent className="pt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Agent Token</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => handleCopy(result.token, 'token')}
                  >
                    {copied === 'token' ? (
                      <>
                        <Check size={12} className="text-success" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <code className="block bg-background p-2.5 rounded font-mono text-sm text-primary break-all select-all">
                  {result.token}
                </code>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Docker Compose Snippet</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => handleCopy(composeSnippet, 'compose')}
                  >
                    {copied === 'compose' ? (
                      <>
                        <Check size={12} className="text-success" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <pre className="bg-background p-3 rounded text-xs font-mono text-foreground overflow-x-auto select-all">
                  {composeSnippet}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="ghost" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                onClick={handleRegister}
                disabled={!name.trim() || !hostname.trim() || registerAgent.isPending}
              >
                {registerAgent.isPending ? 'Registering...' : 'Register Agent'}
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
