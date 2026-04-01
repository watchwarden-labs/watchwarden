import { useQuery } from "@tanstack/react-query";
import type { HistoryStats, UpdateLog } from "@watchwarden/types";
import { apiRequest } from "../client";

export type UpdateLogEntry = UpdateLog;
export type { HistoryStats };

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
