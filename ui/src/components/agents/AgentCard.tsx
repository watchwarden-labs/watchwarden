import { ArrowUpCircle, Clock, Loader2, RefreshCw } from 'lucide-react';
import type { Agent } from '@/api/hooks/useAgents';
import { StatusDot } from '@/components/common/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface AgentCardProps {
  agent: Agent;
  checking?: boolean;
  onCheck?: () => void;
  onUpdate?: () => void;
}

export function AgentCard({ agent, checking, onCheck, onUpdate }: AgentCardProps) {
  const containerCount = agent.containers?.length ?? 0;
  const updateCount = agent.containers?.filter((c) => c.has_update)?.length ?? 0;

  return (
    <Card className="card-hover h-full flex flex-col relative overflow-hidden">
      {checking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px] rounded-xl">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
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
            disabled={checking}
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
          >
            <ArrowUpCircle size={14} />
            Update All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
