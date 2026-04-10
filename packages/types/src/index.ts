// --- Agent & Container Types ---

export interface Agent {
  id: string;
  name: string;
  hostname: string;
  token_hash: string;
  token_prefix: string | null;
  status: 'online' | 'offline' | 'updating';
  last_seen: number | null;
  auto_update: number;
  schedule_override: string | null;
  docker_version: string | null;
  docker_api_version: string | null;
  os: string | null;
  arch: string | null;
  agent_version: string | null;
  created_at: number;
  recovery_registered?: boolean;
  containers?: Container[];
}

export interface Container {
  id: string;
  agent_id: string;
  docker_id: string;
  name: string;
  image: string;
  current_digest: string | null;
  latest_digest: string | null;
  has_update: number;
  status: string;
  excluded: number;
  exclude_reason: string | null;
  health_status: string;
  pinned_version: number;
  update_group: string | null;
  update_priority: number;
  depends_on: string | null;
  last_diff: string | null;
  last_checked: number | null;
  last_updated: number | null;
  policy: string | null;
  tag_pattern: string | null;
  update_level: string | null;
  label_policy: string | null;
  label_tag_pattern: string | null;
  label_update_level: string | null;
  label_group: string | null;
  label_priority: number | null;
  label_depends_on: string | null;
  is_stateful: number;
  update_first_seen: number | null;
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
  policy?: string;
  tag_pattern?: string;
  update_level?: string;
  health_status?: string;
  is_stateful?: boolean;
}

export interface NewAgent {
  id: string;
  name: string;
  hostname: string;
  token_hash: string;
  token_prefix?: string;
}

export interface AgentConfigUpdate {
  schedule_override?: string | null;
  auto_update?: number;
}

// --- Update Types ---

export interface UpdateLog {
  id: number;
  agent_id: string;
  agent_name: string | null;
  container_id: string;
  container_name: string;
  old_digest: string | null;
  new_digest: string | null;
  old_image: string | null;
  new_image: string | null;
  status: 'success' | 'failed' | 'rolled_back';
  error: string | null;
  duration_ms: number | null;
  diff: string | null;
  created_at: number;
}

export interface NewUpdateLog {
  agent_id: string;
  container_id: string;
  container_name: string;
  old_digest?: string | null;
  new_digest?: string | null;
  old_image?: string | null;
  new_image?: string | null;
  status: 'success' | 'failed' | 'rolled_back';
  error?: string | null;
  duration_ms?: number | null;
  diff?: string | null;
}

export interface UpdatePolicy {
  id: string;
  scope: string;
  stability_window_seconds: number;
  auto_rollback_enabled: boolean;
  max_unhealthy_seconds: number;
  strategy: string;
  min_age_hours: number;
  created_at: number;
}

// --- Notification Types ---

export type NotificationEvent =
  | {
      type: 'update_available';
      agents: Array<{
        agentName: string;
        containers: Array<{ name: string; image: string }>;
      }>;
    }
  | {
      type: 'update_success';
      agentName: string;
      containers: Array<{ name: string; image: string; durationMs: number }>;
    }
  | {
      type: 'update_failed';
      agentName: string;
      containers: Array<{ name: string; error: string }>;
    };

export interface NotificationChannel {
  id: string;
  type: string;
  name: string;
  config: string;
  enabled: boolean;
  events: string;
  template: string | null;
  link_template: string | null;
  created_at: number;
}

// --- WebSocket Messages: Agent -> Controller ---

export interface RegisterPayload {
  hostname: string;
  version?: string;
  containers: ContainerInfo[];
  dockerVersion?: string;
  dockerApiVersion?: string;
  os?: string;
  arch?: string;
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
  diff?: Record<string, unknown>;
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

export interface UpdateProgressPayload {
  containerId: string;
  containerName: string;
  step: string;
  progress?: string;
}

export interface HealthStatusPayload {
  containerId: string;
  containerName: string;
  status: 'healthy' | 'unhealthy' | 'starting' | 'none';
  failingSince?: number;
}

export type AgentToControllerMessage =
  | { type: 'REGISTER'; payload: RegisterPayload }
  | { type: 'HEARTBEAT'; payload: HeartbeatPayload }
  | { type: 'CHECK_RESULT'; payload: CheckResultPayload }
  | { type: 'UPDATE_RESULT'; payload: UpdateResultPayload }
  | { type: 'HEALTH_STATUS'; payload: HealthStatusPayload }
  | {
      type: 'SCAN_RESULT';
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

// --- WebSocket Messages: Controller -> Agent ---

export interface CheckCommandPayload {
  containerIds?: string[];
}

export interface UpdateCommandPayload {
  containerIds?: string[];
  strategy?: string;
}

export interface RollbackCommandPayload {
  containerId: string;
  containerName?: string;
  targetImage?: string;
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

export type ControllerToAgentMessage =
  | { type: 'CHECK'; payload: CheckCommandPayload }
  | { type: 'UPDATE'; payload: UpdateCommandPayload }
  | { type: 'ROLLBACK'; payload: RollbackCommandPayload }
  | { type: 'CONFIG_UPDATE'; payload: ConfigUpdatePayload }
  | { type: 'CREDENTIALS_SYNC'; payload: { credentials: RegistryCredential[] } }
  | { type: 'PRUNE'; payload: PruneCommandPayload };

// --- WebSocket Messages: Controller -> UI ---

export type ControllerToUIMessage =
  | {
      type: 'AGENT_STATUS_CHANGED';
      payload: { agentId: string; status: string };
    }
  | {
      type: 'CONTAINER_UPDATE';
      payload: { agentId: string; containers: ContainerInfo[] };
    }
  | {
      type: 'UPDATE_PROGRESS';
      payload: {
        agentId: string;
        containerId: string;
        step: string;
        progress: number;
      };
    }
  | {
      type: 'UPDATE_COMPLETE';
      payload: { agentId: string; containerId: string; success: boolean };
    }
  | {
      type: 'NEW_UPDATES_AVAILABLE';
      payload: { agentId: string; count: number };
    };

// --- Registry ---

export interface RegistryCredential {
  id: string;
  registry: string;
  username: string;
  password_encrypted: string;
  auth_type: string;
  created_at: number;
}

// --- Config ---

export interface GlobalConfig {
  global_schedule?: string;
  auto_update_global?: string;
  check_on_startup?: string;
  [key: string]: string | undefined;
}

// --- History ---

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

// --- Audit ---

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

// --- API Tokens ---

export interface ApiToken {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface NewApiToken {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes?: string;
  expires_at?: number | null;
}

// --- Integration API Types ---

export interface IntegrationSummary {
  containers_total: number;
  containers_with_updates: number;
  unhealthy_containers: number;
  agents_online: number;
  agents_total: number;
  last_check: string | null;
}

export interface IntegrationContainer {
  id: string;
  stable_id: string;
  agent_id: string;
  agent_name: string;
  name: string;
  image: string;
  current_digest: string | null;
  latest_digest: string | null;
  has_update: boolean;
  status: string;
  health_status: string;
  policy: string | null;
  tag_pattern: string | null;
  update_level: string | null;
  last_checked_at: string | null;
  last_updated_at: string | null;
}
