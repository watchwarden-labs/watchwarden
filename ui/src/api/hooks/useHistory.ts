import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface UpdateLogEntry {
	id: number;
	agent_id: string;
	container_id: string;
	container_name: string;
	old_digest: string | null;
	new_digest: string | null;
	status: string;
	error: string | null;
	duration_ms: number | null;
	created_at: number;
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

export function useHistory(filters?: {
	agentId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}) {
	const params = new URLSearchParams();
	if (filters?.agentId) params.set("agentId", filters.agentId);
	if (filters?.status) params.set("status", filters.status);
	if (filters?.limit) params.set("limit", String(filters.limit));
	if (filters?.offset) params.set("offset", String(filters.offset));

	const queryString = params.toString();
	return useQuery({
		queryKey: ["history", filters],
		queryFn: () =>
			apiRequest<{ data: UpdateLogEntry[]; total: number }>(
				`/history${queryString ? `?${queryString}` : ""}`,
			),
	});
}

export function useHistoryStats() {
	return useQuery({
		queryKey: ["history", "stats"],
		queryFn: () => apiRequest<HistoryStats>("/history/stats"),
	});
}
