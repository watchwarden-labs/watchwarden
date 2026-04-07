import { formatDistanceToNow } from 'date-fns';
import { Bug, Download, ExternalLink, Info, Loader2, Server, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import {
  type AgentVersionInfo,
  downloadDiagnosticsBundle,
  useLogging,
  useUpdateLogging,
  useVersionsInfo,
} from '@/api/hooks/useMeta';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useStore } from '@/store/useStore';

export function AboutTab() {
  const { data: versions, isLoading } = useVersionsInfo();
  const { data: logging } = useLogging();
  const updateLogging = useUpdateLogging();
  const addToast = useStore((s) => s.addToast);
  const [downloading, setDownloading] = useState(false);

  const isDebug = logging?.log_level === 'debug';
  const debugUntil = logging?.debug_until;
  const fileLogging = logging?.file_logging_enabled ?? false;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadDiagnosticsBundle();
      addToast({ type: 'success', message: 'Diagnostics bundle downloaded' });
    } catch {
      addToast({ type: 'error', message: 'Failed to download diagnostics bundle' });
    } finally {
      setDownloading(false);
    }
  };

  const handleDebugToggle = (checked: boolean) => {
    updateLogging.mutate(
      checked ? { log_level: 'debug', ttl_minutes: 15 } : { log_level: 'info' },
      {
        onSuccess: () =>
          addToast({
            type: 'info',
            message: checked ? 'Debug logging enabled for 15 minutes' : 'Debug logging disabled',
          }),
      },
    );
  };

  const handleFileLoggingToggle = (checked: boolean) => {
    updateLogging.mutate(
      { file_logging_enabled: checked },
      {
        onSuccess: () =>
          addToast({ type: 'info', message: checked ? 'Log file enabled' : 'Log file disabled' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info size={16} /> Versions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Controller </span>
                <span className="font-mono font-medium">{versions?.controller_version ?? '?'}</span>
              </div>
              {versions?.agents && versions.agents.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Server size={14} /> Agents
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Docker</TableHead>
                        <TableHead>Platform</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.agents.map((agent: AgentVersionInfo) => (
                        <TableRow key={agent.id}>
                          <TableCell className="font-medium">
                            {agent.name}
                            <span className="text-xs text-muted-foreground ml-2">
                              {agent.hostname}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={agent.online ? 'outline' : 'destructive'}
                              className={agent.online ? 'border-success text-success' : ''}
                            >
                              {agent.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{agent.agent_version}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {agent.docker_version ?? '?'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {agent.os && agent.arch ? `${agent.os}/${agent.arch}` : '?'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert size={16} /> Debug Logging
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Enable debug logging</p>
              <p className="text-xs text-muted-foreground">
                Temporarily increases log verbosity for 15 minutes, then reverts to normal.
              </p>
            </div>
            <Switch
              checked={isDebug}
              onCheckedChange={handleDebugToggle}
              disabled={updateLogging.isPending}
              className="shrink-0"
            />
          </div>
          {isDebug && debugUntil && (
            <div className="text-xs text-warning">
              Debug logging active — expires{' '}
              {formatDistanceToNow(new Date(debugUntil), { addSuffix: true })}
            </div>
          )}
          <div className="flex items-start sm:items-center justify-between gap-3 pt-2 border-t border-border">
            <div className="min-w-0">
              <p className="text-sm font-medium">Include controller logs in diagnostics</p>
              <p className="text-xs text-muted-foreground">
                Writes logs to an internal file used only for the diagnostics bundle. Not for
                long-term storage.
              </p>
            </div>
            <Switch
              checked={fileLogging}
              onCheckedChange={handleFileLoggingToggle}
              disabled={updateLogging.isPending}
              className="shrink-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Current level:{' '}
            <code className="bg-muted px-1 rounded">{logging?.log_level ?? 'info'}</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug size={16} /> Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a diagnostics bundle (ZIP) with version info, agent status, container summary,
            and environment details.
            {fileLogging
              ? ' Recent controller logs will be included.'
              : ' Enable "Include controller logs" above to capture logs.'}
          </p>
          <Alert>
            <Info size={14} />
            <AlertDescription className="text-xs">
              The bundle does not contain API tokens or passwords. Review the archive and redact
              hostnames or IPs before sharing publicly.
            </AlertDescription>
          </Alert>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <Loader2 size={14} className="animate-spin mr-1" />
              ) : (
                <Download size={14} className="mr-1" />
              )}
              Download diagnostics bundle
            </Button>
            <a
              href="https://github.com/watchwarden-labs/watchwarden/issues/new?template=bug-report.yml"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline">
                <Bug size={14} className="mr-1" />
                Report a bug
                <ExternalLink size={12} className="ml-1 opacity-50" />
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
