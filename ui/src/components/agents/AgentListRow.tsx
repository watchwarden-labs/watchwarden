import { formatDistanceToNow } from 'date-fns';
import { Clock, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Agent } from '@/api/hooks/useAgents';
import { StatusDot } from '@/components/common/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store/useStore';

interface AgentListRowProps {
  agent: Agent;
  checking?: boolean;
  onCheck: () => void;
  onUpdate: () => void;
  onDelete?: (e: React.MouseEvent) => void;
}

export function AgentListRow({ agent, checking, onCheck, onUpdate, onDelete }: AgentListRowProps) {
  const containerCount = agent.containers?.length ?? 0;
  const updateCount = agent.containers?.filter((c) => c.has_update)?.length ?? 0;

  const allProgress = useStore((s) => s.updateProgress);
  const agentProgress = Object.entries(allProgress).filter(([key]) =>
    key.startsWith(`${agent.id}:`),
  );
  const isUpdating = agentProgress.length > 0;
  const tooltipLines = agentProgress.map(([, p]) => `${p.containerName}: ${p.step}`);

  const statusIcon =
    checking || isUpdating ? (
      <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
    ) : (
      <StatusDot status={agent.status} />
    );

  return (
    <TableRow className="group">
      <TableCell>
        <Link
          to={`/agents/${agent.id}`}
          className="flex items-center gap-2 hover:text-primary transition-colors"
        >
          {isUpdating && tooltipLines.length > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center gap-2" />}>
                  {statusIcon}
                  <span className="font-medium">{agent.name}</span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex flex-col gap-0.5">
                    {tooltipLines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <>
              {statusIcon}
              <span className="font-medium">{agent.name}</span>
            </>
          )}
        </Link>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">{agent.hostname}</TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-2">
          <span>{containerCount}</span>
          {updateCount > 0 && (
            <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
              {updateCount} update{updateCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        {agent.schedule_override ? (
          <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
            <Clock size={10} /> {agent.schedule_override}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Global</span>
        )}
      </TableCell>
      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
        {agent.last_seen ? formatDistanceToNow(agent.last_seen, { addSuffix: true }) : 'Never'}
      </TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.preventDefault();
              onCheck();
            }}
            disabled={checking || isUpdating}
            aria-label="Check for updates"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
          </Button>
          <Button
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.preventDefault();
              onUpdate();
            }}
            disabled={isUpdating}
          >
            {isUpdating ? <Loader2 size={12} className="animate-spin" /> : null}
            Update
          </Button>
          {agent.status === 'offline' && onDelete && (
            <Button variant="destructive" size="sm" className="h-7" onClick={onDelete}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
