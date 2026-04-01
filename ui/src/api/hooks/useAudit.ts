import { useQuery } from "@tanstack/react-query";
import type { AuditLogEntry } from "@watchwarden/types";
import { apiRequest } from "../client";

export type { AuditLogEntry };

interface AuditResponse {
	logs: AuditLogEntry[];
	total: number;
}

export function useAuditLogs(
	filters: {
		actor?: string;
		action?: string;
		targetType?: string;
		agentId?: string;
		limit?: number;
		offset?: number;
	} = {},
) {
	const params = new URLSearchParams();
	if (filters.actor) params.set("actor", filters.actor);
	if (filters.action) params.set("action", filters.action);
	if (filters.targetType) params.set("targetType", filters.targetType);
	if (filters.agentId) params.set("agentId", filters.agentId);
	if (filters.limit) params.set("limit", String(filters.limit));
	if (filters.offset) params.set("offset", String(filters.offset));

	const qs = params.toString();
	return useQuery({
		queryKey: ["audit", filters],
		queryFn: () => apiRequest<AuditResponse>(`/audit${qs ? `?${qs}` : ""}`),
	});
}
