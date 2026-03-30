import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface UpdatePolicy {
	id: string;
	scope: string;
	stability_window_seconds: number;
	auto_rollback_enabled: boolean;
	max_unhealthy_seconds: number;
	strategy: string;
	created_at: number;
}

export function useUpdatePolicy(agentId?: string) {
	const params = agentId ? `?agentId=${agentId}` : "";
	return useQuery({
		queryKey: ["update-policies", agentId],
		queryFn: () => apiRequest<UpdatePolicy>(`/update-policies${params}`),
	});
}

export function useUpdatePolicyMutation() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: {
			scope: string;
			stabilityWindowSeconds?: number;
			autoRollbackEnabled?: boolean;
			maxUnhealthySeconds?: number;
			strategy?: string;
		}) =>
			apiRequest<void>("/update-policies", {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["update-policies"] }),
	});
}
