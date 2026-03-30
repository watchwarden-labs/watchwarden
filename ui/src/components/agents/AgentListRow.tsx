import { formatDistanceToNow } from "date-fns";
import { Clock, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { Agent } from "@/api/hooks/useAgents";
import { StatusDot } from "@/components/common/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

interface AgentListRowProps {
	agent: Agent;
	checking?: boolean;
	onCheck: () => void;
	onUpdate: () => void;
	onDelete?: (e: React.MouseEvent) => void;
}

export function AgentListRow({
	agent,
	checking,
	onCheck,
	onUpdate,
	onDelete,
}: AgentListRowProps) {
	const containerCount = agent.containers?.length ?? 0;
	const updateCount =
		agent.containers?.filter((c) => c.has_update)?.length ?? 0;

	return (
		<TableRow className="group">
			<TableCell>
				<Link
					to={`/agents/${agent.id}`}
					className="flex items-center gap-2 hover:text-primary transition-colors"
				>
					<StatusDot status={agent.status} />
					<span className="font-medium">{agent.name}</span>
				</Link>
			</TableCell>
			<TableCell className="text-muted-foreground">{agent.hostname}</TableCell>
			<TableCell>
				<div className="flex items-center gap-2">
					<span>{containerCount}</span>
					{updateCount > 0 && (
						<Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
							{updateCount} update{updateCount !== 1 ? "s" : ""}
						</Badge>
					)}
				</div>
			</TableCell>
			<TableCell>
				{agent.schedule_override ? (
					<span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
						<Clock size={10} /> {agent.schedule_override}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">Global</span>
				)}
			</TableCell>
			<TableCell className="text-xs text-muted-foreground">
				{agent.last_seen
					? formatDistanceToNow(agent.last_seen, { addSuffix: true })
					: "Never"}
			</TableCell>
			<TableCell>
				<div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
					<Button
						variant="secondary"
						size="sm"
						className="h-7"
						onClick={(e) => {
							e.preventDefault();
							onCheck();
						}}
						disabled={checking}
						aria-label="Check for updates"
					>
						<RefreshCw size={12} className={checking ? "animate-spin" : ""} />
					</Button>
					<Button
						size="sm"
						className="h-7"
						onClick={(e) => {
							e.preventDefault();
							onUpdate();
						}}
					>
						Update
					</Button>
					{agent.status === "offline" && onDelete && (
						<Button
							variant="destructive"
							size="sm"
							className="h-7"
							onClick={onDelete}
						>
							<Trash2 size={12} />
						</Button>
					)}
				</div>
			</TableCell>
		</TableRow>
	);
}
