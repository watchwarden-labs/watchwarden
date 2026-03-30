import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useContainerLogs } from "@/api/hooks/useAgents";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ContainerLogsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentId: string;
	container: { docker_id: string; name: string };
}

const TAIL_OPTIONS = [100, 500, 1000, 5000];
const AUTO_REFRESH_INTERVAL = 5000;

export function ContainerLogsDialog({
	open,
	onOpenChange,
	agentId,
	container,
}: ContainerLogsDialogProps) {
	const [tail, setTail] = useState(100);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [wrapLines, setWrapLines] = useState(false);
	const preRef = useRef<HTMLPreElement>(null);

	const { data, isLoading, error, refetch, isFetching } = useContainerLogs(
		agentId,
		container.docker_id,
		tail,
		open,
	);

	// Auto-refresh
	useEffect(() => {
		if (!open || !autoRefresh) return;
		const id = setInterval(() => {
			refetch();
		}, AUTO_REFRESH_INTERVAL);
		return () => clearInterval(id);
	}, [open, autoRefresh, refetch]);

	// Auto-scroll to bottom when logs update
	useEffect(() => {
		if (preRef.current && data?.logs) {
			preRef.current.scrollTop = preRef.current.scrollHeight;
		}
	}, [data?.logs]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-3">
				<DialogHeader>
					<DialogTitle className="font-mono text-sm">
						{container.name}
					</DialogTitle>
					<DialogDescription>Last {tail} lines</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-3">
						{/* Tail selector */}
						<div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
							{TAIL_OPTIONS.map((n) => (
								<Button
									key={n}
									variant={tail === n ? "default" : "ghost"}
									size="sm"
									className="h-6 text-xs px-2"
									onClick={() => setTail(n)}
								>
									{n}
								</Button>
							))}
						</div>

						<Button
							variant="outline"
							size="sm"
							className="h-6 text-xs"
							onClick={() => refetch()}
							disabled={isLoading}
							aria-label="Refresh logs"
						>
							<RefreshCw
								size={12}
								className={isFetching ? "animate-spin" : ""}
							/>
							Refresh
						</Button>
					</div>

					<div className="flex items-center gap-4">
						{/* Auto-refresh toggle */}
						<div className="flex items-center gap-1.5">
							<Switch
								checked={autoRefresh}
								onCheckedChange={setAutoRefresh}
							/>
							<Label className="text-xs text-muted-foreground">
								Auto-refresh
							</Label>
						</div>

						{/* Wrap lines toggle */}
						<div className="flex items-center gap-1.5">
							<Switch checked={wrapLines} onCheckedChange={setWrapLines} />
							<Label className="text-xs text-muted-foreground">
								Wrap lines
							</Label>
						</div>
					</div>
				</div>

				<pre
					ref={preRef}
					className={`flex-1 overflow-auto rounded-lg bg-zinc-950 text-zinc-300 p-4 text-xs font-mono max-h-[60vh] min-h-[300px] leading-relaxed ${
						wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre"
					}`}
				>
					{isLoading && !data ? (
						<span className="flex items-center gap-2 text-muted-foreground">
							<Loader2 size={14} className="animate-spin" />
							Loading logs...
						</span>
					) : error ? (
						<span className="text-destructive">
							Failed to fetch logs:{" "}
							{(error as { body?: { error?: string } })?.body?.error ??
								"Unknown error"}
						</span>
					) : data?.logs ? (
						data.logs
					) : (
						<span className="text-muted-foreground">No logs available</span>
					)}
				</pre>

				{autoRefresh && (
					<p className="text-[10px] text-muted-foreground text-right">
						Auto-refreshing every {AUTO_REFRESH_INTERVAL / 1000}s
						{isFetching && " — fetching..."}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
