import type postgres from "postgres";
import type {
	Agent,
	AgentConfigUpdate,
	AuditLogEntry,
	AuditLogFilters,
	Container,
	ContainerInfo,
	HistoryFilters,
	HistoryStats,
	NewAgent,
	NewUpdateLog,
	UpdateLog,
} from "../types.js";
import { sql } from "./client.js";

// TransactionSql loses call signatures via Omit — this helper restores them.
type TxSql = postgres.Sql;

// --- Agents ---

export async function insertAgent(agent: NewAgent): Promise<void> {
	await sql`
    INSERT INTO agents (id, name, hostname, token_hash, token_prefix, status, auto_update, created_at)
    VALUES (${agent.id}, ${agent.name}, ${agent.hostname}, ${agent.token_hash}, ${agent.token_prefix ?? null}, 'offline', false, ${Date.now()})
  `;
}

export async function listAgentsByTokenPrefix(
	prefix: string,
): Promise<Agent[]> {
	const rows = await sql`SELECT * FROM agents WHERE token_prefix = ${prefix}`;
	return rows.map(mapAgent);
}

export async function getAgent(id: string): Promise<Agent | undefined> {
	const [row] = await sql`SELECT * FROM agents WHERE id = ${id}`;
	return row ? mapAgent(row) : undefined;
}

export async function listAgents(): Promise<Agent[]> {
	const rows = await sql`SELECT * FROM agents ORDER BY created_at DESC`;
	return rows.map(mapAgent);
}

export async function updateAgentStatus(
	id: string,
	status: string,
	lastSeen: number,
): Promise<void> {
	await sql`UPDATE agents SET status = ${status}, last_seen = ${lastSeen} WHERE id = ${id}`;
}

export async function updateAgentConfig(
	id: string,
	config: AgentConfigUpdate,
): Promise<void> {
	if (config.schedule_override !== undefined) {
		await sql`UPDATE agents SET schedule_override = ${config.schedule_override} WHERE id = ${id}`;
	}
	if (config.auto_update !== undefined) {
		await sql`UPDATE agents SET auto_update = ${!!config.auto_update} WHERE id = ${id}`;
	}
}

export async function updateAgentDockerInfo(
	id: string,
	info: {
		dockerVersion?: string;
		dockerApiVersion?: string;
		os?: string;
		arch?: string;
	},
): Promise<void> {
	await sql`
    UPDATE agents
    SET docker_version = ${info.dockerVersion ?? null},
        docker_api_version = ${info.dockerApiVersion ?? null},
        os = ${info.os ?? null},
        arch = ${info.arch ?? null}
    WHERE id = ${id}
  `;
}

export async function deleteAgent(id: string): Promise<void> {
	await sql`DELETE FROM agents WHERE id = ${id}`;
}

// --- Containers ---

export async function upsertContainers(
	agentId: string,
	containers: ContainerInfo[],
): Promise<void> {
	const reportedIds = containers.map((c) => c.id);

	// DB-03 + BUG-07: DELETE + UPSERT must be atomic so the UI never sees a
	// transient state where containers vanish between DELETE and INSERT. The
	// entire operation runs in a single PostgreSQL transaction — if any step
	// fails or times out, the whole batch rolls back and the previous container
	// set remains visible. This prevents the "heartbeat flicker" where containers
	// briefly disappear from the dashboard during rapid heartbeats under load.
	await sql.begin(async (txBase) => {
		const tx = txBase as unknown as TxSql;

		// Single DELETE for all stale containers (no N+1)
		if (reportedIds.length === 0) {
			await tx`DELETE FROM containers WHERE agent_id = ${agentId}`;
			return;
		}
		// Lock the rows we're about to modify to prevent concurrent heartbeats
		// from interleaving their DELETE+INSERT within the same transaction window.
		await tx`SELECT 1 FROM containers WHERE agent_id = ${agentId} FOR UPDATE`;
		await tx`DELETE FROM containers WHERE agent_id = ${agentId} AND id != ALL(${reportedIds})`;

		// Bulk upsert — single round-trip for all containers
		const rows = containers.map((c) => ({
			id: c.id,
			agent_id: agentId,
			docker_id: c.docker_id,
			name: c.name,
			image: c.image,
			current_digest: c.current_digest ?? null,
			status: c.status,
			excluded: !!c.excluded,
			exclude_reason: c.exclude_reason ?? null,
			pinned_version: !!c.pinned_version,
			update_group: c.group ?? null,
			update_priority: c.priority ?? 100,
			depends_on: c.depends_on?.length ? JSON.stringify(c.depends_on) : null,
		}));

		// postgres.js sql(rows, col...) generates the column list + VALUES — no separate column list
		await tx`
    INSERT INTO containers
    ${tx(rows, "id", "agent_id", "docker_id", "name", "image", "current_digest", "status", "excluded", "exclude_reason", "pinned_version", "update_group", "update_priority", "depends_on")}
    ON CONFLICT (id) DO UPDATE SET
      docker_id = EXCLUDED.docker_id,
      name = EXCLUDED.name,
      image = EXCLUDED.image,
      current_digest = EXCLUDED.current_digest,
      status = EXCLUDED.status,
      excluded = EXCLUDED.excluded,
      exclude_reason = EXCLUDED.exclude_reason,
      pinned_version = EXCLUDED.pinned_version,
      update_group = EXCLUDED.update_group,
      update_priority = EXCLUDED.update_priority,
      depends_on = EXCLUDED.depends_on
  `;
	}); // end sql.begin — DB-03
}

export async function getContainersByAgent(
	agentId: string,
): Promise<Container[]> {
	const rows = await sql`SELECT * FROM containers WHERE agent_id = ${agentId}`;
	return rows.map(mapContainer);
}

export async function updateContainerDigests(
	containerId: string,
	currentDigest: string,
	latestDigest: string,
	hasUpdate: boolean,
): Promise<void> {
	await sql`
    UPDATE containers SET current_digest = ${currentDigest}, latest_digest = ${latestDigest},
      has_update = ${hasUpdate}, last_checked = ${Date.now()}
    WHERE id = ${containerId} OR docker_id = ${containerId}
  `;
}

// --- Update Log ---

export async function insertUpdateLog(entry: NewUpdateLog): Promise<number> {
	const [row] = await sql`
    INSERT INTO update_log (agent_id, container_id, container_name, old_digest, new_digest, status, error, duration_ms, created_at)
    VALUES (${entry.agent_id}, ${entry.container_id}, ${entry.container_name},
      ${entry.old_digest ?? null}, ${entry.new_digest ?? null}, ${entry.status},
      ${entry.error ?? null}, ${entry.duration_ms ?? null}, ${Date.now()})
    RETURNING id
  `;
	return Number(row?.id ?? 0);
}

/**
 * DB-02: Atomically insert the update log entry AND update the container digests
 * in a single transaction so audit log and container state never diverge.
 */
export async function insertUpdateLogAndDigests(
	entry: NewUpdateLog,
	containerId: string,
	newDigest: string,
): Promise<number> {
	let logId = 0;
	await sql.begin(async (txBase) => {
		const tx = txBase as unknown as TxSql;
		const [row] = await tx`
      INSERT INTO update_log (agent_id, container_id, container_name, old_digest, new_digest, status, error, duration_ms, created_at)
      VALUES (${entry.agent_id}, ${entry.container_id}, ${entry.container_name},
        ${entry.old_digest ?? null}, ${entry.new_digest ?? null}, ${entry.status},
        ${entry.error ?? null}, ${entry.duration_ms ?? null}, ${Date.now()})
      RETURNING id
    `;
		logId = Number(row?.id ?? 0);
		await tx`
      UPDATE containers SET current_digest = ${newDigest}, latest_digest = ${newDigest},
        has_update = false, last_checked = ${Date.now()}
      WHERE id = ${containerId} OR docker_id = ${containerId}
    `;
	});
	return logId;
}

export async function getHistory(
	filters: HistoryFilters,
): Promise<{ data: UpdateLog[]; total: number }> {
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;

	// Build WHERE fragment using postgres.js tagged template fragments (no sql.unsafe)
	const agentFilter = filters.agentId
		? sql`AND agent_id = ${filters.agentId}`
		: sql``;
	const statusFilter = filters.status
		? sql`AND status = ${filters.status}`
		: sql``;

	const [totalRow] = await sql`
		SELECT COUNT(*) as count FROM update_log WHERE TRUE ${agentFilter} ${statusFilter}
	`;
	const total = Number(totalRow?.count ?? 0);

	const data = await sql`
		SELECT * FROM update_log WHERE TRUE ${agentFilter} ${statusFilter}
		ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
	`;

	return { data: data.map(mapUpdateLog), total };
}

export async function getHistoryStats(): Promise<HistoryStats> {
	// DB-04: run all three queries inside a single transaction so the counts are
	// snapshot-consistent — without this, rows inserted between queries make
	// successRate momentarily exceed 100% or the weekly chart totals disagree.
	let result!: HistoryStats;
	await sql.begin(async (txBase) => {
		const tx = txBase as unknown as TxSql;

		const [totalRow] = await tx`SELECT COUNT(*) as count FROM update_log`;
		const totalUpdates = Number(totalRow?.count ?? 0);

		const [successRow] =
			await tx`SELECT COUNT(*) as count FROM update_log WHERE status = 'success'`;
		const successRate =
			totalUpdates > 0
				? (Number(successRow?.count ?? 0) / totalUpdates) * 100
				: 0;

		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const rows = await tx`
    SELECT
      TO_CHAR(TO_TIMESTAMP(created_at / 1000), 'YYYY-MM-DD') as date,
      COUNT(*)::int as count,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int as failed
    FROM update_log
    WHERE created_at >= ${sevenDaysAgo}
    GROUP BY TO_CHAR(TO_TIMESTAMP(created_at / 1000), 'YYYY-MM-DD')
    ORDER BY date
  `;

		result = {
			totalUpdates,
			successRate: Math.round(successRate * 100) / 100,
			lastWeek: rows.map((r) => ({
				date: r.date as string,
				count: Number(r.count),
				success: Number(r.success),
				failed: Number(r.failed),
			})),
		};
	});
	return result;
}

// --- Config ---

export async function getConfig(key: string): Promise<string | undefined> {
	const [row] = await sql`SELECT value FROM config WHERE key = ${key}`;
	return row?.value as string | undefined;
}

export async function setConfig(key: string, value: string): Promise<void> {
	await sql`
    INSERT INTO config (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getAllConfig(): Promise<Record<string, string>> {
	const rows = await sql`SELECT key, value FROM config`;
	const config: Record<string, string> = {};
	for (const row of rows) {
		config[row.key as string] = row.value as string;
	}
	return config;
}

// --- Registry Credentials ---

export interface RegistryCredential {
	id: string;
	registry: string;
	username: string;
	password_encrypted: string;
	created_at: number;
}

export async function insertRegistryCredential(
	cred: Omit<RegistryCredential, "created_at">,
): Promise<void> {
	await sql`
    INSERT INTO registry_credentials (id, registry, username, password_encrypted, created_at)
    VALUES (${cred.id}, ${cred.registry}, ${cred.username}, ${cred.password_encrypted}, ${Date.now()})
  `;
}

export async function listRegistryCredentials(): Promise<RegistryCredential[]> {
	const rows =
		await sql`SELECT * FROM registry_credentials ORDER BY created_at DESC`;
	return rows.map(mapRegistryCredential);
}

export async function getRegistryCredential(
	id: string,
): Promise<RegistryCredential | undefined> {
	const [row] = await sql`SELECT * FROM registry_credentials WHERE id = ${id}`;
	return row ? mapRegistryCredential(row) : undefined;
}

export async function updateRegistryCredential(
	id: string,
	data: { registry?: string; username?: string; password_encrypted?: string },
): Promise<void> {
	// DB-01: wrap in a transaction so a crash between statements never leaves
	// credentials in a partially-updated state (e.g. new password + old username).
	await sql.begin(async (txBase) => {
		const tx = txBase as unknown as TxSql;
		if (data.registry !== undefined)
			await tx`UPDATE registry_credentials SET registry = ${data.registry} WHERE id = ${id}`;
		if (data.username !== undefined)
			await tx`UPDATE registry_credentials SET username = ${data.username} WHERE id = ${id}`;
		if (data.password_encrypted !== undefined)
			await tx`UPDATE registry_credentials SET password_encrypted = ${data.password_encrypted} WHERE id = ${id}`;
	});
}

export async function deleteRegistryCredential(id: string): Promise<void> {
	await sql`DELETE FROM registry_credentials WHERE id = ${id}`;
}

// --- Notification Channels ---

export interface NotificationChannel {
	id: string;
	type: string;
	name: string;
	config: string;
	enabled: boolean;
	events: string;
	created_at: number;
}

export async function insertNotificationChannel(
	ch: Omit<NotificationChannel, "created_at">,
): Promise<void> {
	await sql`
    INSERT INTO notification_channels (id, type, name, config, enabled, events, created_at)
    VALUES (${ch.id}, ${ch.type}, ${ch.name}, ${ch.config}, ${!!ch.enabled}, ${ch.events}, ${Date.now()})
  `;
}

export async function listNotificationChannels(): Promise<
	NotificationChannel[]
> {
	const rows =
		await sql`SELECT * FROM notification_channels ORDER BY created_at DESC`;
	return rows.map(mapNotificationChannel);
}

export async function getNotificationChannel(
	id: string,
): Promise<NotificationChannel | undefined> {
	const [row] = await sql`SELECT * FROM notification_channels WHERE id = ${id}`;
	return row ? mapNotificationChannel(row) : undefined;
}

export async function updateNotificationChannel(
	id: string,
	data: Partial<Omit<NotificationChannel, "id" | "created_at">>,
): Promise<void> {
	// DB-01: all field updates run inside a single transaction to prevent
	// partial-update state if the process crashes between statements.
	await sql.begin(async (txBase) => {
		const tx = txBase as unknown as TxSql;
		if (data.name !== undefined)
			await tx`UPDATE notification_channels SET name = ${data.name} WHERE id = ${id}`;
		if (data.type !== undefined)
			await tx`UPDATE notification_channels SET type = ${data.type} WHERE id = ${id}`;
		if (data.config !== undefined)
			await tx`UPDATE notification_channels SET config = ${data.config} WHERE id = ${id}`;
		if (data.enabled !== undefined)
			await tx`UPDATE notification_channels SET enabled = ${!!data.enabled} WHERE id = ${id}`;
		if (data.events !== undefined)
			await tx`UPDATE notification_channels SET events = ${data.events} WHERE id = ${id}`;
	});
}

export async function deleteNotificationChannel(id: string): Promise<void> {
	await sql`DELETE FROM notification_channels WHERE id = ${id}`;
}

// --- Notification Logs ---

export interface NotificationLog {
	id: number;
	channel_id: string;
	channel_name: string;
	event_type: string;
	status: string;
	error: string | null;
	created_at: number;
}

export async function insertNotificationLog(
	log: Omit<NotificationLog, "id" | "created_at">,
): Promise<void> {
	await sql`
    INSERT INTO notification_logs (channel_id, channel_name, event_type, status, error, created_at)
    VALUES (${log.channel_id}, ${log.channel_name}, ${log.event_type}, ${log.status}, ${log.error}, ${Date.now()})
  `;
}

export async function getNotificationLogs(
	limit = 50,
	offset = 0,
): Promise<NotificationLog[]> {
	const rows =
		await sql`SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
	return rows.map(mapNotificationLog);
}

// --- Update Policies ---

export interface UpdatePolicy {
	id: string;
	scope: string;
	stability_window_seconds: number;
	auto_rollback_enabled: boolean;
	max_unhealthy_seconds: number;
	strategy: string;
	created_at: number;
}

export async function getUpdatePolicy(
	scope: string,
): Promise<UpdatePolicy | undefined> {
	const [row] = await sql`SELECT * FROM update_policies WHERE scope = ${scope}`;
	if (!row) return undefined;
	return {
		id: row.id as string,
		scope: row.scope as string,
		stability_window_seconds: Number(row.stability_window_seconds),
		auto_rollback_enabled: !!row.auto_rollback_enabled,
		max_unhealthy_seconds: Number(row.max_unhealthy_seconds),
		strategy: (row.strategy as string) ?? "stop-first",
		created_at: Number(row.created_at),
	};
}

export async function getEffectivePolicy(
	agentId?: string,
): Promise<UpdatePolicy> {
	if (agentId) {
		const agentPolicy = await getUpdatePolicy(`agent:${agentId}`);
		if (agentPolicy) return agentPolicy;
	}
	const global = await getUpdatePolicy("global");
	return (
		global ?? {
			id: "default",
			scope: "global",
			stability_window_seconds: 120,
			auto_rollback_enabled: true,
			max_unhealthy_seconds: 30,
			strategy: "stop-first",
			created_at: 0,
		}
	);
}

export async function upsertUpdatePolicy(
	policy: Omit<UpdatePolicy, "created_at">,
): Promise<void> {
	await sql`
    INSERT INTO update_policies (id, scope, stability_window_seconds, auto_rollback_enabled, max_unhealthy_seconds, strategy, created_at)
    VALUES (${policy.id}, ${policy.scope}, ${policy.stability_window_seconds}, ${policy.auto_rollback_enabled}, ${policy.max_unhealthy_seconds}, ${policy.strategy}, ${Date.now()})
    ON CONFLICT (id) DO UPDATE SET
      stability_window_seconds = EXCLUDED.stability_window_seconds,
      auto_rollback_enabled = EXCLUDED.auto_rollback_enabled,
      max_unhealthy_seconds = EXCLUDED.max_unhealthy_seconds,
      strategy = EXCLUDED.strategy
  `;
}

export async function updateContainerHealth(
	containerId: string,
	healthStatus: string,
): Promise<void> {
	await sql`
    UPDATE containers SET health_status = ${healthStatus}
    WHERE id = ${containerId} OR docker_id = ${containerId}
  `;
}

export async function updateContainerDiff(
	containerId: string,
	diff: string | null,
): Promise<void> {
	await sql`
    UPDATE containers SET last_diff = ${diff}
    WHERE id = ${containerId} OR docker_id = ${containerId}
  `;
}

// --- Scan Results ---

export async function insertScanResult(
	agentId: string,
	result: {
		containerId: string;
		image: string;
		critical: number;
		high: number;
		medium: number;
		low: number;
		details: unknown[];
	},
): Promise<void> {
	await sql`
      INSERT INTO scan_results (container_id, agent_id, image, critical, high, medium, low, details, scanned_at)
      VALUES (${result.containerId}, ${agentId}, ${result.image}, ${result.critical}, ${result.high},
              ${result.medium}, ${result.low}, ${JSON.stringify(result.details)}, ${Date.now()})
    `;
}

export async function getLatestScanResult(containerId: string): Promise<
	| {
			critical: number;
			high: number;
			medium: number;
			low: number;
			details: unknown[];
			scanned_at: number;
	  }
	| undefined
> {
	const [row] = await sql`
      SELECT * FROM scan_results
      WHERE container_id = ${containerId}
      ORDER BY scanned_at DESC LIMIT 1
    `;
	if (!row) return undefined;
	return {
		critical: Number(row.critical),
		high: Number(row.high),
		medium: Number(row.medium),
		low: Number(row.low),
		details: row.details
			? (() => {
					try {
						return JSON.parse(row.details as string);
					} catch {
						return [];
					}
				})()
			: [],
		scanned_at: Number(row.scanned_at),
	};
}

// --- Row mappers ---

function mapAgent(row: Record<string, unknown>): Agent {
	return {
		id: row.id as string,
		name: row.name as string,
		hostname: row.hostname as string,
		token_hash: row.token_hash as string,
		token_prefix: (row.token_prefix as string | null) ?? null,
		status: row.status as "online" | "offline" | "updating",
		last_seen: row.last_seen ? Number(row.last_seen) : null,
		schedule_override: row.schedule_override as string | null,
		auto_update: row.auto_update ? 1 : 0,
		docker_version: (row.docker_version as string | null) ?? null,
		docker_api_version: (row.docker_api_version as string | null) ?? null,
		os: (row.os as string | null) ?? null,
		arch: (row.arch as string | null) ?? null,
		created_at: Number(row.created_at),
	};
}

function mapContainer(row: Record<string, unknown>): Container {
	return {
		id: row.id as string,
		agent_id: row.agent_id as string,
		docker_id: row.docker_id as string,
		name: row.name as string,
		image: row.image as string,
		current_digest: row.current_digest as string | null,
		latest_digest: row.latest_digest as string | null,
		has_update: row.has_update ? 1 : 0,
		status: row.status as string,
		excluded: row.excluded ? 1 : 0,
		exclude_reason: row.exclude_reason as string | null,
		health_status: (row.health_status as string) ?? "unknown",
		pinned_version: row.pinned_version ? 1 : 0,
		update_group: row.update_group as string | null,
		update_priority: Number(row.update_priority ?? 100),
		depends_on: row.depends_on as string | null,
		last_diff: row.last_diff as string | null,
		last_checked: row.last_checked ? Number(row.last_checked) : null,
		last_updated: row.last_updated ? Number(row.last_updated) : null,
	};
}

function mapUpdateLog(row: Record<string, unknown>): UpdateLog {
	return {
		id: Number(row.id),
		agent_id: row.agent_id as string,
		container_id: row.container_id as string,
		container_name: row.container_name as string,
		old_digest: row.old_digest as string | null,
		new_digest: row.new_digest as string | null,
		status: row.status as "success" | "failed" | "rolled_back",
		error: row.error as string | null,
		duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
		created_at: Number(row.created_at),
	};
}

function mapRegistryCredential(
	row: Record<string, unknown>,
): RegistryCredential {
	return {
		id: row.id as string,
		registry: row.registry as string,
		username: row.username as string,
		password_encrypted: row.password_encrypted as string,
		created_at: Number(row.created_at),
	};
}

function mapNotificationChannel(
	row: Record<string, unknown>,
): NotificationChannel {
	return {
		id: row.id as string,
		type: row.type as string,
		name: row.name as string,
		config: row.config as string,
		enabled: !!row.enabled,
		events: row.events as string,
		created_at: Number(row.created_at),
	};
}

function mapNotificationLog(row: Record<string, unknown>): NotificationLog {
	return {
		id: Number(row.id),
		channel_id: row.channel_id as string,
		channel_name: row.channel_name as string,
		event_type: row.event_type as string,
		status: row.status as string,
		error: row.error as string | null,
		created_at: Number(row.created_at),
	};
}

// --- Audit Log ---

export async function insertAuditLog(entry: {
	actor: string;
	action: string;
	targetType: string;
	targetId?: string | null;
	agentId?: string | null;
	details?: Record<string, unknown> | null;
	ipAddress?: string | null;
}): Promise<void> {
	await sql`
		INSERT INTO audit_log (actor, action, target_type, target_id, agent_id, details, ip_address, created_at)
		VALUES (
			${entry.actor},
			${entry.action},
			${entry.targetType},
			${entry.targetId ?? null},
			${entry.agentId ?? null},
			${entry.details ? JSON.stringify(entry.details) : null},
			${entry.ipAddress ?? null},
			${Date.now()}
		)
	`;
}

export async function listAuditLogs(
	filters: AuditLogFilters = {},
): Promise<{ logs: AuditLogEntry[]; total: number }> {
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;

	const countResult = await sql`
		SELECT COUNT(*) as count FROM audit_log
		WHERE (${filters.actor ?? null}::text IS NULL OR actor = ${filters.actor ?? null})
		  AND (${filters.action ?? null}::text IS NULL OR action = ${filters.action ?? null})
		  AND (${filters.targetType ?? null}::text IS NULL OR target_type = ${filters.targetType ?? null})
		  AND (${filters.agentId ?? null}::text IS NULL OR agent_id = ${filters.agentId ?? null})
	`;
	const total = Number(countResult[0]?.count ?? 0);

	const rows = await sql`
		SELECT * FROM audit_log
		WHERE (${filters.actor ?? null}::text IS NULL OR actor = ${filters.actor ?? null})
		  AND (${filters.action ?? null}::text IS NULL OR action = ${filters.action ?? null})
		  AND (${filters.targetType ?? null}::text IS NULL OR target_type = ${filters.targetType ?? null})
		  AND (${filters.agentId ?? null}::text IS NULL OR agent_id = ${filters.agentId ?? null})
		ORDER BY created_at DESC
		LIMIT ${limit} OFFSET ${offset}
	`;

	return { logs: rows.map(mapAuditLog), total };
}

function mapAuditLog(row: Record<string, unknown>): AuditLogEntry {
	return {
		id: Number(row.id),
		actor: row.actor as string,
		action: row.action as string,
		target_type: row.target_type as string,
		target_id: row.target_id as string | null,
		agent_id: row.agent_id as string | null,
		details: row.details as string | null,
		ip_address: row.ip_address as string | null,
		created_at: Number(row.created_at),
	};
}
