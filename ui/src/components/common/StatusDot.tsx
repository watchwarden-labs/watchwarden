import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatusDotProps {
	status: string;
}

export function StatusDot({ status }: StatusDotProps) {
	const colorClass =
		status === "online"
			? "bg-success animate-pulse-green"
			: status === "updating"
				? "bg-primary animate-spin"
				: "bg-muted-foreground";

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger
					render={<span />}
					data-testid="status-dot"
					data-status={status}
					className={`inline-block w-2.5 h-2.5 rounded-full cursor-default ${colorClass}`}
				/>
				<TooltipContent>
					<p className="capitalize">{status}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
