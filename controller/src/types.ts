// --- Database entities ---

export interface Agent {
	id: string;
	name: string;
	hostname: string;
	token_hash: string;
	token_prefix: string | null;
	status: "online" | "offline" | "updating";
	last_seen: number | null;
	schedule_override: string | null;
	auto_update: number; // 0 or 1 (SQLite boolean)
	docker_version: string | null; // Phase 17D
	docker_api_version: string | null; // Phase 17D
	os: string | null; // Phase 17D
	arch: string | null; // Phase 17D
	created_at: number;
}

export interface NewAgent {
	id: string;
	name: string;
	hostname: string;
	token_hash: string;
	token_prefix?: string; // first 8 chars of raw token for fast auth filtering
}

export interface AgentConfigUpdate {
	schedule_override?: string | null;
	auto_update?: number;
}

export interface Container {
	id: string;
	agent_id: string;
	docker_id: string;
	name: string;
	image: string;
	current_digest: string | null;
	latest_digest: string | null;
	has_update: number; // 0 or 1
	status: string;
	excluded: number; // 0 or 1
	exclude_reason: string | null;
	health_status: string;
	pinned_version: number; // 0 or 1
	update_group: string | null;
	update_priority: number;
	depends_on: string | null; // JSON array
	last_diff: string | null; // JSON ImageDiff
	last_checked: number | null;
	last_updated: number | null;
}

export interface ContainerInfo {
	id: string;
	docker_id: string;
	name: string;
	image: string;
	current_digest: string | null;
	status: string;
	excluded?: boolean;
	exclude_reason?: string;
	pinned_version?: boolean;
	group?: string;
	priority?: number;
	depends_on?: string[];
}

export interface UpdateLog {
	id: number;
	agent_id: string;
	container_id: string;
	container_name: string;
	old_digest: string | null;
	new_digest: string | null;
	status: "success" | "failed" | "rolled_back";
	error: string | null;
	duration_ms: number | null;
	created_at: number;
}

export interface NewUpdateLog {
	agent_id: string;
	container_id: string;
	container_name: string;
	old_digest?: string | null;
	new_digest?: string | null;
	status: "success" | "failed" | "rolled_back";
	error?: string | null;
	duration_ms?: number | null;
}

export interface AuditLogEntry {
	id: number;
	actor: string;
	action: string;
	target_type: string;
	target_id: string | null;
	agent_id: string | null;
	details: string | null;
	ip_address: string | null;
	created_at: number;
}

export interface AuditLogFilters {
	actor?: string;
	action?: string;
	targetType?: string;
	agentId?: string;
	limit?: number;
	offset?: number;
}

export interface HistoryFilters {
	agentId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}

export interface HistoryStats {
	totalUpdates: number;
	successRate: number;
	lastWeek: Array<{
		date: string;
		count: number;
		success: number;
		failed: number;
	}>;
}

// --- WebSocket messages: Agent → Controller ---

export interface RegisterPayload {
	hostname: string;
	version?: string;
	containers: ContainerInfo[];
}

export interface HeartbeatPayload {
	containers: ContainerInfo[];
}

export interface CheckResult {
	containerId: string;
	containerName: string;
	currentDigest: string;
	latestDigest: string;
	hasUpdate: boolean;
	diff?: Record<string, unknown>; // ImageDiff JSON from agent
}

export interface CheckResultPayload {
	results: CheckResult[];
}

export interface UpdateResultPayload {
	containerId: string;
	containerName: string;
	success: boolean;
	oldDigest?: string;
	newDigest?: string;
	error?: string;
	durationMs?: number;
}

export interface HealthStatusPayload {
	containerId: string;
	containerName: string;
	status: "healthy" | "unhealthy" | "starting" | "none";
	failingSince?: number;
}

export type WsAgentMessage =
	| { type: "REGISTER"; payload: RegisterPayload }
	| { type: "HEARTBEAT"; payload: HeartbeatPayload }
	| { type: "CHECK_RESULT"; payload: CheckResultPayload }
	| { type: "UPDATE_RESULT"; payload: UpdateResultPayload }
	| { type: "HEALTH_STATUS"; payload: HealthStatusPayload }
	| {
			type: "SCAN_RESULT";
			payload: {
				containerId: string;
				containerName: string;
				image: string;
				critical: number;
				high: number;
				medium: number;
				low: number;
				details: Array<{
					id: string;
					severity: string;
					package: string;
					fixed: string;
				}>;
			};
	  };

// --- WebSocket messages: Controller → Agent ---

export interface CheckCommandPayload {
	containerIds?: string[];
}

export interface UpdateCommandPayload {
	containerIds?: string[];
	strategy?: string;
}

export interface RollbackCommandPayload {
	containerId: string;
}

export interface ConfigUpdatePayload {
	schedule?: string;
	autoUpdate?: boolean;
}

export interface MonitorHealthPayload {
	containerId: string;
	containerName: string;
	durationSeconds: number;
	rollbackOnFailure: boolean;
	rollbackImage?: string;
}

export interface PruneCommandPayload {
	keepPrevious?: number;
	dryRun?: boolean;
}

export interface PruneResultPayload {
	imagesRemoved: number;
	spaceReclaimed: number;
	details: Array<{ image: string; size: number }>;
	errors: string[];
}

export type WsControllerMessage =
	| { type: "CHECK"; payload: CheckCommandPayload }
	| { type: "UPDATE"; payload: UpdateCommandPayload }
	| { type: "ROLLBACK"; payload: RollbackCommandPayload }
	| { type: "CONFIG_UPDATE"; payload: ConfigUpdatePayload }
	| { type: "PRUNE"; payload: PruneCommandPayload };

// --- WebSocket messages: Controller → UI ---

export type WsUiMessage =
	| {
			type: "AGENT_STATUS_CHANGED";
			payload: { agentId: string; status: string };
	  }
	| {
			type: "CONTAINER_UPDATE";
			payload: { agentId: string; containers: ContainerInfo[] };
	  }
	| {
			type: "UPDATE_PROGRESS";
			payload: {
				agentId: string;
				containerId: string;
				step: string;
				progress: number;
			};
	  }
	| {
			type: "UPDATE_COMPLETE";
			payload: { agentId: string; containerId: string; success: boolean };
	  }
	| {
			type: "NEW_UPDATES_AVAILABLE";
			payload: { agentId: string; count: number };
	  };
