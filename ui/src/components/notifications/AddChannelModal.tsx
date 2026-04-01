import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Hash,
  Loader2,
  MessageCircle,
  Plus,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NotificationChannel } from '@/api/hooks/useNotifications';
import {
  useCreateNotification,
  useNotificationChannel,
  useTestNotification,
  useUpdateNotification,
} from '@/api/hooks/useNotifications';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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

interface AddChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editChannel?: NotificationChannel | null;
}

const TYPES = [
  {
    value: 'telegram',
    label: 'Telegram',
    icon: MessageCircle,
    desc: 'Send to a Telegram chat or group',
  },
  {
    value: 'slack',
    label: 'Slack',
    icon: Hash,
    desc: 'Post to a Slack channel via webhook',
  },
  {
    value: 'webhook',
    label: 'Webhook',
    icon: Webhook,
    desc: 'POST JSON to any HTTP endpoint',
  },
  {
    value: 'ntfy',
    label: 'ntfy',
    icon: Bell,
    desc: 'Push to ntfy.sh or self-hosted ntfy',
  },
] as const;

const EVENTS = [
  {
    value: 'update_available',
    label: 'Updates Available',
    desc: 'A new image version is detected',
  },
  {
    value: 'update_success',
    label: 'Update Succeeded',
    desc: 'All containers updated successfully',
  },
  {
    value: 'update_failed',
    label: 'Update Failed',
    desc: 'One or more containers failed to update',
  },
] as const;

export function AddChannelModal({ open, onOpenChange, editChannel }: AddChannelModalProps) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<string>(editChannel?.type ?? 'telegram');
  const [name, setName] = useState(editChannel?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<string[]>(
    editChannel
      ? (() => {
          try {
            return JSON.parse(editChannel.events);
          } catch {
            return ['update_available', 'update_success', 'update_failed'];
          }
        })()
      : ['update_available', 'update_success', 'update_failed'],
  );
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [customTemplate, setCustomTemplate] = useState(editChannel?.template ?? '');
  const [linkTemplate, setLinkTemplate] = useState(editChannel?.link_template ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const createChannel = useCreateNotification();
  const updateChannel = useUpdateNotification();
  const testChannel = useTestNotification();
  const { data: channelDetail } = useNotificationChannel(editChannel?.id ?? null);
  const addToast = useStore((s) => s.addToast);

  // Pre-fill config when editing
  useEffect(() => {
    if (channelDetail && editChannel) {
      setType(channelDetail.type);
      setName(channelDetail.name);
      if (typeof channelDetail.config === 'object' && channelDetail.config !== null) {
        const c: Record<string, string> = {};
        for (const [k, v] of Object.entries(channelDetail.config)) {
          c[k] = String(v);
        }
        setConfig(c);
      }
      try {
        const evts =
          typeof channelDetail.events === 'string'
            ? JSON.parse(channelDetail.events)
            : channelDetail.events;
        setEvents(evts);
      } catch {
        /* keep default */
      }
      if (channelDetail.template) setCustomTemplate(channelDetail.template);
      if (channelDetail.link_template) setLinkTemplate(channelDetail.link_template);
      if (channelDetail.template || channelDetail.link_template) setShowAdvanced(true);
      setStep(2); // Skip type selection on edit
    }
  }, [channelDetail, editChannel]);

  const resetAndClose = () => {
    setStep(1);
    setName('');
    setConfig({});
    setEvents(['update_available', 'update_success', 'update_failed']);
    setHeaders([]);
    setCustomTemplate('');
    setLinkTemplate('');
    setShowAdvanced(false);
    setSaveState('idle');
    setErrorMsg('');
    onOpenChange(false);
  };

  const toggleEvent = (event: string) => {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const setConfigField = (key: string, value: string) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const buildConfigPayload = (): Record<string, unknown> => {
    const base = { ...config };
    if (type === 'webhook' && headers.length > 0) {
      const h: Record<string, string> = {};
      for (const { key, value } of headers) {
        if (key) h[key] = value;
      }
      return { ...base, headers: h };
    }
    return base;
  };

  const canProceedStep2 = () => {
    if (!name.trim()) return false;
    if (type === 'telegram') return !!config.botToken && !!config.chatId;
    if (type === 'slack') return !!config.webhookUrl;
    if (type === 'webhook') return !!config.url;
    if (type === 'ntfy') return !!config.topic;
    return false;
  };

  const [savedChannelId, setSavedChannelId] = useState<string | null>(null);

  const handleSave = () => {
    setSaveState('saving');
    const payload = {
      type,
      name,
      config: buildConfigPayload(),
      events,
      template: customTemplate || null,
      link_template: linkTemplate || null,
    };
    const onError = (err: Error) => {
      setSaveState('error');
      setErrorMsg(err.message ?? 'Failed to save');
    };

    if (editChannel) {
      updateChannel.mutate(
        { id: editChannel.id, ...payload },
        {
          onSuccess: () => {
            setSaveState('success');
            setSavedChannelId(editChannel.id);
            setTimeout(resetAndClose, 1500);
          },
          onError,
        },
      );
    } else {
      createChannel.mutate(payload, {
        onSuccess: (data) => {
          const id = (data as { id: string }).id;
          setSaveState('success');
          setSavedChannelId(id);
          setTimeout(resetAndClose, 1500);
        },
        onError,
      });
    }
  };

  const handleTest = () => {
    const channelId = savedChannelId ?? editChannel?.id;
    if (!channelId) return;
    testChannel.mutate(channelId, {
      onSuccess: () => addToast({ type: 'success', message: 'Test notification sent' }),
      onError: () => addToast({ type: 'error', message: 'Test notification failed' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editChannel ? 'Edit' : 'Add'} Notification Channel</DialogTitle>
          <DialogDescription>
            <span className="flex gap-2 mt-2">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-secondary'}`}
                />
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Type */}
        {step === 1 && (
          <div className="grid grid-cols-3 gap-3 py-2">
            {TYPES.map((t) => (
              <Card
                key={t.value}
                className={`cursor-pointer transition-all ${type === t.value ? 'border-primary shadow-glow-accent' : 'hover:border-muted-foreground/30'}`}
                onClick={() => setType(t.value)}
              >
                <CardContent className="pt-4 text-center space-y-2">
                  <t.icon
                    size={24}
                    className={
                      type === t.value ? 'text-primary mx-auto' : 'text-muted-foreground mx-auto'
                    }
                  />
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Step 2: Config */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Team Updates"
              />
            </div>

            {type === 'telegram' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Bot Token</Label>
                    <a
                      href="https://core.telegram.org/bots#botfather"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      How to get <ExternalLink size={10} />
                    </a>
                  </div>
                  <Input
                    value={config.botToken ?? ''}
                    onChange={(e) => setConfigField('botToken', e.target.value)}
                    placeholder="123456:ABC-DEF..."
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Chat ID</Label>
                    <a
                      href="https://t.me/userinfobot"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      How to get <ExternalLink size={10} />
                    </a>
                  </div>
                  <Input
                    value={config.chatId ?? ''}
                    onChange={(e) => setConfigField('chatId', e.target.value)}
                    placeholder="-1001234567890"
                  />
                </div>
              </>
            )}

            {type === 'slack' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Webhook URL</Label>
                  <a
                    href="https://api.slack.com/messaging/webhooks"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary flex items-center gap-1"
                  >
                    Slack docs <ExternalLink size={10} />
                  </a>
                </div>
                <Input
                  value={config.webhookUrl ?? ''}
                  onChange={(e) => setConfigField('webhookUrl', e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>
            )}

            {type === 'webhook' && (
              <>
                <div className="space-y-1.5">
                  <Label>URL</Label>
                  <Input
                    value={config.url ?? ''}
                    onChange={(e) => setConfigField('url', e.target.value)}
                    placeholder="https://example.com/webhook"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Headers</Label>
                  {headers.map((h, i) => (
                    <div key={`header-${h.key || i}`} className="flex gap-2">
                      <Input
                        placeholder="Key"
                        value={h.key}
                        onChange={(e) => {
                          const n = [...headers];
                          n[i] = { ...h, key: e.target.value };
                          setHeaders(n);
                        }}
                      />
                      <Input
                        placeholder="Value"
                        value={h.value}
                        onChange={(e) => {
                          const n = [...headers];
                          n[i] = { ...h, value: e.target.value };
                          setHeaders(n);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                        aria-label="Remove header"
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHeaders([...headers, { key: '', value: '' }])}
                  >
                    <Plus size={14} /> Add header
                  </Button>
                </div>
              </>
            )}

            {type === 'ntfy' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Server</Label>
                    <a
                      href="https://ntfy.sh"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      ntfy.sh <ExternalLink size={10} />
                    </a>
                  </div>
                  <Input
                    value={config.server ?? 'https://ntfy.sh'}
                    onChange={(e) => setConfigField('server', e.target.value)}
                    placeholder="https://ntfy.sh"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Topic</Label>
                  <Input
                    value={config.topic ?? ''}
                    onChange={(e) => setConfigField('topic', e.target.value)}
                    placeholder="watchwarden"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority (optional)</Label>
                  <Input
                    value={config.priority ?? ''}
                    onChange={(e) => setConfigField('priority', e.target.value)}
                    placeholder="default, low, high, urgent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Access Token (optional)</Label>
                  <Input
                    value={config.token ?? ''}
                    onChange={(e) => setConfigField('token', e.target.value)}
                    placeholder="tk_..."
                    type="password"
                  />
                </div>
              </>
            )}

            {/* Advanced: Template & Link Template */}
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors pt-2"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced
            </button>
            {showAdvanced && (
              <div className="space-y-3 pl-1 border-l-2 border-secondary ml-1">
                <div className="space-y-1.5 pl-3">
                  <Label>Custom Template</Label>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={customTemplate}
                    onChange={(e) => setCustomTemplate(e.target.value)}
                    placeholder={
                      'Available: {{eventType}}, {{agentName}}, {{containers}}, {{count}}'
                    }
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {'{{variable}}'} placeholders. Leave empty for default formatting.
                  </p>
                </div>
                <div className="space-y-1.5 pl-3">
                  <Label>Link Template</Label>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {[
                      { label: 'None', value: '' },
                      { label: 'Auto', value: 'auto' },
                      {
                        label: 'Docker Hub',
                        value: 'https://hub.docker.com/r/{{repository}}/tags?name={{tag}}',
                      },
                      {
                        label: 'GHCR',
                        value: 'https://github.com/{{owner}}/{{name}}/pkgs/container/{{name}}',
                      },
                      {
                        label: 'Quay.io',
                        value: 'https://quay.io/repository/{{repository}}?tab=tags',
                      },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                          linkTemplate === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-secondary hover:border-muted-foreground/30'
                        }`}
                        onClick={() => setLinkTemplate(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={linkTemplate}
                    onChange={(e) => setLinkTemplate(e.target.value)}
                    placeholder="Custom: https://example.com/{{repository}}/{{tag}}"
                  />
                  <p className="text-xs text-muted-foreground">
                    Appends image links to notifications. Available: {'{{registry}}'},{' '}
                    {'{{repository}}'}, {'{{tag}}'}, {'{{owner}}'}, {'{{name}}'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Events */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Notify me when:</p>
            {EVENTS.map((e) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: label wraps Checkbox
              <label
                key={e.value}
                className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-secondary"
              >
                <Checkbox
                  checked={events.includes(e.value)}
                  onCheckedChange={() => toggleEvent(e.value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">{e.label}</p>
                  <p className="text-xs text-muted-foreground">{e.desc}</p>
                </div>
              </label>
            ))}

            {saveState === 'success' && (
              <Alert className="border-success">
                <Check size={16} className="text-success" />
                <AlertDescription className="text-success">
                  Channel created and test sent successfully!
                </AlertDescription>
              </Alert>
            )}
            {saveState === 'error' && (
              <Alert variant="destructive">
                <X size={16} />
                <AlertDescription>{errorMsg || 'Failed to save channel'}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={resetAndClose}>
            Cancel
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 2 && !canProceedStep2()}>
              Next
            </Button>
          ) : (
            <>
              {(savedChannelId || editChannel) && (
                <Button variant="outline" onClick={handleTest} disabled={testChannel.isPending}>
                  {testChannel.isPending ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
                  Test
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={events.length === 0 || saveState === 'saving' || saveState === 'success'}
              >
                {saveState === 'saving' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving...
                  </>
                ) : saveState === 'success' ? (
                  <>
                    <Check size={14} /> Saved
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
