import { ArrowUpCircle, Clock, Loader2, RefreshCw } from 'lucide-react';
import type { Agent } from '@/api/hooks/useAgents';
import { StatusDot } from '@/components/common/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store/useStore';

interface AgentCardProps {
  agent: Agent;
  checking?: boolean;
  onCheck?: () => void;
  onUpdate?: () => void;
}

export function AgentCard({ agent, checking, onCheck, onUpdate }: AgentCardProps) {
  const containerCount = agent.containers?.length ?? 0;
  const updateCount = agent.containers?.filter((c) => c.has_update)?.length ?? 0;

  const allProgress = useStore((s) => s.updateProgress);
  const agentProgress = Object.entries(allProgress).filter(([key]) =>
    key.startsWith(`${agent.id}:`),
  );
  const isUpdating = agentProgress.length > 0;

  const overlayActive = checking || isUpdating;
  const overlayLabel = checking ? 'Checking...' : 'Updating...';

  const tooltipLines = agentProgress.map(([, p]) => `${p.containerName}: ${p.step}`);

  return (
    <Card className="card-hover h-full flex flex-col relative overflow-hidden">
      {overlayActive && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-background/60 backdrop-blur-[1px] rounded-xl cursor-default" />
              }
            >
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs text-primary font-medium">{overlayLabel}</span>
            </TooltipTrigger>
            {isUpdating && tooltipLines.length > 0 && (
              <TooltipContent side="bottom">
                <div className="flex flex-col gap-0.5">
                  {tooltipLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={agent.status} />
            <h3 className="font-semibold">{agent.name}</h3>
            {agent.recovery_registered && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-orange-400/30 text-orange-500"
              >
                Recovery
              </Badge>
            )}
          </div>
          {updateCount > 0 && (
            <Badge
              data-testid="update-badge"
              className="bg-primary/15 text-primary border-primary/30"
            >
              {updateCount} update{updateCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        <p className="text-sm text-muted-foreground mb-1">{agent.hostname}</p>
        {agent.docker_version && (
          <p className="text-xs text-muted-foreground mb-1 font-mono">
            Docker {agent.docker_version}
            {agent.os && agent.arch && ` · ${agent.os}/${agent.arch}`}
          </p>
        )}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
          <span>
            {containerCount} container{containerCount !== 1 ? 's' : ''}
          </span>
          {agent.schedule_override && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              <code className="text-xs">{agent.schedule_override}</code>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCheck?.();
            }}
            disabled={checking || isUpdating}
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking...' : 'Check'}
          </Button>
          <Button
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onUpdate?.();
            }}
            disabled={isUpdating}
          >
            <ArrowUpCircle size={14} />
            Update All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
