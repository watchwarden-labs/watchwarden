import { AlertTriangle, ArrowRight, Minus, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface EnvChange {
	key: string;
	oldValue: string;
	newValue: string;
}
interface LabelChange {
	key: string;
	oldValue: string;
	newValue: string;
}
interface StringDiff {
	old: string;
	new: string;
}
interface StringSliceDiff {
	old: string[];
	new: string[];
}

export interface ImageDiff {
	envAdded?: string[];
	envRemoved?: string[];
	envChanged?: EnvChange[];
	portsAdded?: string[];
	portsRemoved?: string[];
	entrypointChanged?: StringSliceDiff | null;
	cmdChanged?: StringSliceDiff | null;
	labelsAdded?: Record<string, string>;
	labelsRemoved?: string[];
	labelsChanged?: LabelChange[];
	workdirChanged?: StringDiff | null;
	userChanged?: StringDiff | null;
	volumesAdded?: string[];
	volumesRemoved?: string[];
	hasBreakingChanges: boolean;
	changeCount: number;
}

interface ImageDiffViewProps {
	diff: ImageDiff;
	compact?: boolean;
}

export function ImageDiffView({ diff, compact }: ImageDiffViewProps) {
	if (diff.changeCount === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No configuration changes detected.
			</p>
		);
	}

	return (
		<div className="space-y-3 text-sm">
			{diff.hasBreakingChanges && (
				<Alert variant="destructive">
					<AlertTriangle size={14} />
					<AlertDescription>
						Breaking changes detected — ports, entrypoint, or volumes changed.
					</AlertDescription>
				</Alert>
			)}

			{!compact && (
				<Badge variant="outline">
					{diff.changeCount} change{diff.changeCount !== 1 ? "s" : ""}
				</Badge>
			)}

			{/* Environment Variables */}
			{diff.envAdded?.length ||
			diff.envRemoved?.length ||
			diff.envChanged?.length ? (
				<DiffSection title="Environment Variables">
					{diff.envAdded?.map((e) => (
						<DiffLine key={e} type="added" text={e} />
					))}
					{diff.envRemoved?.map((e) => (
						<DiffLine key={e} type="removed" text={e} />
					))}
					{diff.envChanged?.map((e) => (
						<DiffLine
							key={e.key}
							type="changed"
							text={`${e.key}: ${e.oldValue} → ${e.newValue}`}
						/>
					))}
				</DiffSection>
			) : null}

			{/* Ports */}
			{diff.portsAdded?.length || diff.portsRemoved?.length ? (
				<DiffSection title="Exposed Ports">
					{diff.portsAdded?.map((p) => (
						<DiffLine key={p} type="added" text={p} />
					))}
					{diff.portsRemoved?.map((p) => (
						<DiffLine key={p} type="removed" text={p} />
					))}
				</DiffSection>
			) : null}

			{/* Entrypoint */}
			{diff.entrypointChanged && (
				<DiffSection title="Entrypoint">
					<DiffLine
						type="removed"
						text={diff.entrypointChanged.old?.join(" ") || "(none)"}
					/>
					<DiffLine
						type="added"
						text={diff.entrypointChanged.new?.join(" ") || "(none)"}
					/>
				</DiffSection>
			)}

			{/* Cmd */}
			{diff.cmdChanged && (
				<DiffSection title="Command">
					<DiffLine
						type="removed"
						text={diff.cmdChanged.old?.join(" ") || "(none)"}
					/>
					<DiffLine
						type="added"
						text={diff.cmdChanged.new?.join(" ") || "(none)"}
					/>
				</DiffSection>
			)}

			{/* Labels (only non-metadata — OCI build labels are filtered by the agent) */}
			{(diff.labelsAdded && Object.keys(diff.labelsAdded).length > 0) ||
			diff.labelsRemoved?.length ||
			diff.labelsChanged?.length ? (
				<DiffSection title="Labels">
					{diff.labelsAdded &&
						Object.entries(diff.labelsAdded).map(([k, v]) => (
							<DiffLine key={k} type="added" text={`${k}=${v}`} />
						))}
					{diff.labelsRemoved?.map((k) => (
						<DiffLine key={k} type="removed" text={k} />
					))}
					{diff.labelsChanged?.map((l) => (
						<DiffLine
							key={l.key}
							type="changed"
							text={`${l.key}: ${l.oldValue} → ${l.newValue}`}
						/>
					))}
				</DiffSection>
			) : null}

			{/* Volumes */}
			{diff.volumesAdded?.length || diff.volumesRemoved?.length ? (
				<DiffSection title="Volumes">
					{diff.volumesAdded?.map((v) => (
						<DiffLine key={v} type="added" text={v} />
					))}
					{diff.volumesRemoved?.map((v) => (
						<DiffLine key={v} type="removed" text={v} />
					))}
				</DiffSection>
			) : null}

			{/* Working Directory */}
			{diff.workdirChanged && (
				<DiffSection title="Working Directory">
					<DiffLine
						type="changed"
						text={`${diff.workdirChanged.old} → ${diff.workdirChanged.new}`}
					/>
				</DiffSection>
			)}

			{/* User */}
			{diff.userChanged && (
				<DiffSection title="User">
					<DiffLine
						type="changed"
						text={`${diff.userChanged.old || "(default)"} → ${diff.userChanged.new || "(default)"}`}
					/>
				</DiffSection>
			)}
		</div>
	);
}

function DiffSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
			<div className="space-y-0.5 font-mono text-xs">{children}</div>
		</div>
	);
}

function DiffLine({
	type,
	text,
}: {
	type: "added" | "removed" | "changed";
	text: string;
}) {
	const icon =
		type === "added" ? (
			<Plus size={12} />
		) : type === "removed" ? (
			<Minus size={12} />
		) : (
			<ArrowRight size={12} />
		);
	const color =
		type === "added"
			? "text-success"
			: type === "removed"
				? "text-destructive"
				: "text-warning";
	const bg =
		type === "added"
			? "bg-success/5"
			: type === "removed"
				? "bg-destructive/5"
				: "bg-warning/5";

	return (
		<div
			className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${bg} ${color}`}
		>
			{icon}
			<span className="break-all">{text}</span>
		</div>
	);
}

/** Compact badge for ContainerRow — shows change count + warning if breaking */
export function DiffBadge({ diff }: { diff: ImageDiff }) {
	if (diff.changeCount === 0) return null;

	return (
		<Badge
			variant="outline"
			className={`text-[10px] gap-1 ${diff.hasBreakingChanges ? "border-destructive/30 text-destructive" : "border-muted-foreground"}`}
		>
			{diff.hasBreakingChanges && <AlertTriangle size={10} />}
			{diff.changeCount} change{diff.changeCount !== 1 ? "s" : ""}
		</Badge>
	);
}
