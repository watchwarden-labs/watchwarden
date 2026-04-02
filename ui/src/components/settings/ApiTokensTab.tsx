import { formatDistanceToNow } from 'date-fns';
import { Check, Copy, Key, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiTokenListItem, CreateTokenResponse } from '@/api/hooks/useApiTokens';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '@/api/hooks/useApiTokens';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useStore } from '@/store/useStore';

const EXPIRATION_OPTIONS = [
  { label: 'Never', days: 0 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
] as const;

export function ApiTokensTab() {
  const { data: tokens = [] } = useApiTokens();
  const createToken = useCreateApiToken();
  const revokeToken = useRevokeApiToken();
  const addToast = useStore((s) => s.addToast);

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [expiresDays, setExpiresDays] = useState(0);
  const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    if (!tokenName.trim()) return;
    createToken.mutate(
      {
        name: tokenName.trim(),
        expires_in_days: expiresDays || undefined,
      },
      {
        onSuccess: (data) => {
          setCreatedToken(data);
          setTokenName('');
        },
        onError: () => {
          addToast({ type: 'error', message: 'Failed to create token' });
        },
      },
    );
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = (token: ApiTokenListItem) => {
    revokeToken.mutate(token.id, {
      onError: () => addToast({ type: 'error', message: 'Failed to revoke token' }),
    });
  };

  const handleCloseCreate = (open: boolean) => {
    if (!open) {
      setCreateOpen(false);
      setCreatedToken(null);
      setTokenName('');
      setExpiresDays(0);
      setCopied(false);
    } else {
      setCreateOpen(true);
    }
  };

  const activeTokens = tokens.filter((t) => !t.revoked_at);
  const revokedTokens = tokens.filter((t) => t.revoked_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">API Tokens</h3>
          <p className="text-sm text-muted-foreground">
            Manage tokens for external integrations like Home Assistant.
          </p>
        </div>
        <Button onClick={() => handleCloseCreate(true)}>
          <Plus size={16} /> Create Token
        </Button>
      </div>

      <Alert>
        <Key size={16} />
        <AlertDescription>
          API tokens grant full access to the integration API. Treat them like passwords — store
          them securely and revoke any tokens you no longer use.
        </AlertDescription>
      </Alert>

      {tokens.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Key size={40} className="text-muted-foreground/40" />
            <p className="text-muted-foreground">No API tokens yet</p>
            <Button variant="outline" size="sm" onClick={() => handleCloseCreate(true)}>
              Create your first token
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeTokens.map((token) => (
                <TokenRow key={token.id} token={token} onRevoke={handleRevoke} />
              ))}
              {revokedTokens.map((token) => (
                <TokenRow key={token.id} token={token} onRevoke={handleRevoke} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create Token Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCloseCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdToken ? 'Token Created' : 'Create API Token'}</DialogTitle>
            <DialogDescription>
              {createdToken
                ? 'Copy this token now. It will not be shown again.'
                : 'Give your token a name to identify its purpose.'}
            </DialogDescription>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <Alert className="border-warning bg-warning/10">
                <ShieldAlert size={16} className="text-warning" />
                <AlertDescription className="text-warning">
                  This token will only be shown once. Copy it now and store it securely.
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={createdToken.token}
                  className="font-mono text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(createdToken.token)}
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  placeholder="e.g. Home Assistant, CI pipeline"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  maxLength={128}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Expiration</Label>
                <div className="flex gap-2">
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <Button
                      key={opt.days}
                      type="button"
                      variant={expiresDays === opt.days ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setExpiresDays(opt.days)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter showCloseButton={!!createdToken}>
            {!createdToken && (
              <>
                <Button variant="outline" onClick={() => handleCloseCreate(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!tokenName.trim() || createToken.isPending}
                >
                  {createToken.isPending ? 'Creating...' : 'Create'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: ApiTokenListItem;
  onRevoke: (token: ApiTokenListItem) => void;
}) {
  const isRevoked = !!token.revoked_at;
  const isExpired = !!token.expires_at && token.expires_at < Date.now();
  const isInactive = isRevoked || isExpired;
  const scopes = (() => {
    try {
      return JSON.parse(token.scopes) as string[];
    } catch {
      return ['full'];
    }
  })();

  return (
    <TableRow className={isInactive ? 'opacity-50' : undefined}>
      <TableCell className="font-medium">{token.name}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          {scopes.map((s) => (
            <Badge key={s} variant="secondary" className="text-xs">
              {s}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {formatDistanceToNow(token.created_at, { addSuffix: true })}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {token.expires_at ? formatDistanceToNow(token.expires_at, { addSuffix: true }) : 'Never'}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {token.last_used_at
          ? formatDistanceToNow(token.last_used_at, { addSuffix: true })
          : 'Never'}
      </TableCell>
      <TableCell>
        {isRevoked ? (
          <Badge variant="destructive" className="text-xs">
            Revoked
          </Badge>
        ) : isExpired ? (
          <Badge variant="outline" className="text-xs text-warning border-warning/30">
            Expired
          </Badge>
        ) : (
          <Badge className="text-xs bg-success/20 text-success border-success/30">Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {!isRevoked && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 size={14} />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke token &quot;{token.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any integration using this token will immediately lose access. This cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => onRevoke(token)}>
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  );
}
