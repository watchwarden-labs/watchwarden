import { Hexagon, LayoutGrid, List, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
	useAgents,
	useCheckAgent,
	useDeleteAgent,
	useUpdateAgent,
} from "@/api/hooks/useAgents";
import { AgentCard } from "@/components/agents/AgentCard";
import { AgentListRow } from "@/components/agents/AgentListRow";
import { RegisterAgentModal } from "@/components/agents/RegisterAgentModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/store/useStore";

const FILTERS = ["All", "Online", "Offline", "Updating"] as const;

export function Agents() {
	const { data: unsortedAgents = [], isLoading } = useAgents();
	const agents = [...unsortedAgents].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const [filter, setFilter] = useState<string>("All");
	const [registerOpen, setRegisterOpen] = useState(false);
	const checkAgent = useCheckAgent();
	const updateAgent = useUpdateAgent();
	const deleteAgent = useDeleteAgent();
	const addToast = useStore((s) => s.addToast);
	const checkingAgents = useStore((s) => s.checkingAgents);
	const setAgentChecking = useStore((s) => s.setAgentChecking);
	const viewMode = useStore((s) => s.agentViewMode);
	const setViewMode = useStore((s) => s.setAgentViewMode);

	const filtered =
		filter === "All"
			? agents
			: agents.filter((a) => a.status === filter.toLowerCase());

	const handleCheck = (agentId: string) => {
		if (checkingAgents.has(agentId)) return;
		setAgentChecking(agentId, true);
		checkAgent.mutate(agentId, {
			onError: () => setAgentChecking(agentId, false),
		});
	};

	const handleDelete = (
		e: React.MouseEvent,
		agentId: string,
		agentName: string,
	) => {
		e.preventDefault();
		e.stopPropagation();
		if (
			confirm(
				`Remove agent "${agentName}"? This will delete all history for this agent.`,
			)
		) {
			deleteAgent.mutate(agentId, {
				onSuccess: () =>
					addToast({
						type: "success",
						message: `Agent "${agentName}" removed`,
					}),
				onError: () =>
					addToast({ type: "error", message: "Failed to remove agent" }),
			});
		}
	};

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">Agents</h1>
				<Button onClick={() => setRegisterOpen(true)}>
					<Plus size={16} /> Add Agent
				</Button>
			</div>

			<RegisterAgentModal open={registerOpen} onOpenChange={setRegisterOpen} />

			<div className="flex items-center justify-between">
				<Tabs value={filter} onValueChange={setFilter}>
					<TabsList>
						{FILTERS.map((f) => (
							<TabsTrigger key={f} value={f}>
								{f}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>

				<div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
					<Button
						variant={viewMode === "grid" ? "default" : "ghost"}
						size="icon"
						className="h-7 w-7"
						onClick={() => setViewMode("grid")}
						aria-label="Grid view"
					>
						<LayoutGrid size={14} />
					</Button>
					<Button
						variant={viewMode === "list" ? "default" : "ghost"}
						size="icon"
						className="h-7 w-7"
						onClick={() => setViewMode("list")}
						aria-label="List view"
					>
						<List size={14} />
					</Button>
				</div>
			</div>

			{!isLoading && filtered.length === 0 && (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-24 gap-4">
						<Hexagon size={64} className="text-border" />
						<p className="text-muted-foreground text-lg">
							{filter === "All"
								? "No agents connected"
								: `No ${filter.toLowerCase()} agents`}
						</p>
						{filter === "All" && (
							<>
								<p className="text-muted-foreground text-sm">
									Register a new agent to get started
								</p>
								<Button onClick={() => setRegisterOpen(true)}>
									Add your first agent
								</Button>
							</>
						)}
					</CardContent>
				</Card>
			)}

			{viewMode === "grid" ? (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{filtered.map((agent) => (
						<div key={agent.id} className="relative">
							<Link to={`/agents/${agent.id}`}>
								<AgentCard
									agent={agent}
									checking={checkingAgents.has(agent.id)}
									onCheck={() => handleCheck(agent.id)}
									onUpdate={() =>
										updateAgent.mutate(
											{ id: agent.id },
											{
												onError: () =>
													addToast({ type: "error", message: "Update failed" }),
											},
										)
									}
								/>
							</Link>
							{agent.status === "offline" && (
								<Button
									variant="destructive"
									size="sm"
									className="absolute top-2 right-2 h-7 text-xs"
									onClick={(e) => handleDelete(e, agent.id, agent.name)}
								>
									Remove
								</Button>
							)}
						</div>
					))}
				</div>
			) : (
				<Card>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Agent</TableHead>
								<TableHead>Hostname</TableHead>
								<TableHead>Containers</TableHead>
								<TableHead>Schedule</TableHead>
								<TableHead>Last Seen</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((agent) => (
								<AgentListRow
									key={agent.id}
									agent={agent}
									checking={checkingAgents.has(agent.id)}
									onCheck={() => handleCheck(agent.id)}
									onUpdate={() =>
										updateAgent.mutate(
											{ id: agent.id },
											{
												onError: () =>
													addToast({ type: "error", message: "Update failed" }),
											},
										)
									}
									onDelete={
										agent.status === "offline"
											? (e) => handleDelete(e, agent.id, agent.name)
											: undefined
									}
								/>
							))}
						</TableBody>
					</Table>
				</Card>
			)}
		</div>
	);
}
