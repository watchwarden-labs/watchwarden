import type {
	Agent,
	Container,
	GlobalConfig,
	HistoryStats,
	NotificationChannel,
	UpdateLog,
	UpdatePolicy,
} from "@watchwarden/types";

export interface WatchWardenClientOptions {
	baseUrl: string;
	token?: string;
	fetch?: typeof globalThis.fetch;
}

export class WatchWardenClient {
	private baseUrl: string;
	private token: string | null;
	private fetch: typeof globalThis.fetch;

	constructor(options: WatchWardenClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.token = options.token ?? null;
		this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	}

	setToken(token: string | null): void {
		this.token = token;
	}

	// --- Auth ---

	async login(password: string): Promise<{ ok: boolean }> {
		return this.post<{ ok: boolean }>("/auth/login", { password });
	}

	async logout(): Promise<void> {
		await this.post("/auth/logout", {});
	}

	async me(): Promise<{ authenticated: boolean }> {
		return this.get("/auth/me");
	}

	// --- Agents ---

	async listAgents(): Promise<Agent[]> {
		return this.get("/agents");
	}

	async getAgent(id: string): Promise<Agent & { containers: Container[] }> {
		return this.get(`/agents/${id}`);
	}

	async registerAgent(
		name: string,
		hostname: string,
	): Promise<{ agentId: string; token: string }> {
		return this.post("/agents/register", { name, hostname });
	}

	async deleteAgent(id: string): Promise<void> {
		await this.del(`/agents/${id}`);
	}

	async checkAgent(
		id: string,
		containerIds?: string[],
	): Promise<{ message: string }> {
		return this.post(`/agents/${id}/check`, { containerIds });
	}

	async checkAllAgents(): Promise<{ message: string; count: number }> {
		return this.post("/agents/check-all", {});
	}

	async updateAgent(
		id: string,
		containerIds?: string[],
	): Promise<{ message: string }> {
		return this.post(`/agents/${id}/update`, { containerIds });
	}

	async rollbackContainer(
		agentId: string,
		containerId: string,
		options?: { targetTag?: string; targetDigest?: string },
	): Promise<{ message: string }> {
		return this.post(`/agents/${agentId}/rollback`, {
			containerId,
			...options,
		});
	}

	async updateAgentConfig(
		id: string,
		config: { scheduleOverride?: string; autoUpdate?: boolean },
	): Promise<{ message: string }> {
		return this.put(`/agents/${id}/config`, config);
	}

	// --- Config ---

	async getConfig(): Promise<GlobalConfig> {
		return this.get("/config");
	}

	async setConfig(key: string, value: string): Promise<void> {
		await this.put("/config", { key, value });
	}

	// --- History ---

	async getHistory(options?: {
		limit?: number;
		offset?: number;
		agentId?: string;
		status?: string;
	}): Promise<{ logs: UpdateLog[]; total: number }> {
		const params = new URLSearchParams();
		if (options?.limit) params.set("limit", String(options.limit));
		if (options?.offset) params.set("offset", String(options.offset));
		if (options?.agentId) params.set("agentId", options.agentId);
		if (options?.status) params.set("status", options.status);
		const qs = params.toString();
		return this.get(`/history${qs ? `?${qs}` : ""}`);
	}

	async getHistoryStats(): Promise<HistoryStats> {
		return this.get("/history/stats");
	}

	// --- Notifications ---

	async listNotifications(): Promise<NotificationChannel[]> {
		return this.get("/notifications");
	}

	async createNotification(channel: {
		type: string;
		name: string;
		config: Record<string, unknown>;
		events: string[];
		template?: string;
		link_template?: string;
	}): Promise<{ id: string }> {
		return this.post("/notifications", channel);
	}

	async testNotification(id: string): Promise<{ success: boolean }> {
		return this.post(`/notifications/${id}/test`, {});
	}

	// --- Update Policies ---

	async getEffectivePolicy(agentId?: string): Promise<UpdatePolicy> {
		const params = agentId ? `?agentId=${agentId}` : "";
		return this.get(`/update-policies${params}`);
	}

	// --- Registries ---

	async listRegistries(): Promise<
		Array<{ id: string; registry: string; username: string; created_at: number }>
	> {
		return this.get("/registries");
	}

	// --- Internal ---

	private async get<T>(path: string): Promise<T> {
		const res = await this.fetch(`${this.baseUrl}/api${path}`, {
			headers: this.headers(),
			credentials: "include",
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	private async post<T>(path: string, body: unknown): Promise<T> {
		const res = await this.fetch(`${this.baseUrl}/api${path}`, {
			method: "POST",
			headers: { ...this.headers(), "Content-Type": "application/json" },
			body: JSON.stringify(body),
			credentials: "include",
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		if (res.status === 204) return undefined as T;
		return res.json() as Promise<T>;
	}

	private async put<T>(path: string, body: unknown): Promise<T> {
		const res = await this.fetch(`${this.baseUrl}/api${path}`, {
			method: "PUT",
			headers: { ...this.headers(), "Content-Type": "application/json" },
			body: JSON.stringify(body),
			credentials: "include",
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		if (res.status === 204) return undefined as T;
		return res.json() as Promise<T>;
	}

	private async del(path: string): Promise<void> {
		const res = await this.fetch(`${this.baseUrl}/api${path}`, {
			method: "DELETE",
			headers: this.headers(),
			credentials: "include",
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {};
		if (this.token) h.Authorization = `Bearer ${this.token}`;
		return h;
	}
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public body: string,
	) {
		super(`API error ${status}: ${body}`);
		this.name = "ApiError";
	}
}
