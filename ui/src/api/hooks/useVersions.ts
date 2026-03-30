import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface LocalVersion {
	digest: string | null;
	tag: string | null;
	updatedAt: number;
	isCurrent: boolean;
}

export interface RegistryTag {
	name: string;
	digest: string | null;
	updatedAt: string | null;
}

export interface VersionsResponse {
	local: LocalVersion[];
	registry: {
		tags: RegistryTag[];
		page: number;
		hasMore: boolean;
		total: number | null;
	} | null;
}

export function useVersions(
	agentId: string,
	containerId: string,
	enabled: boolean,
) {
	return useQuery({
		queryKey: ["versions", agentId, containerId],
		queryFn: () =>
			apiRequest<VersionsResponse>(
				`/agents/${agentId}/containers/${containerId}/versions`,
			),
		enabled,
	});
}

export function useRegistryTags(
	agentId: string,
	containerId: string,
	options: { page: number; search: string; enabled: boolean },
) {
	return useQuery({
		queryKey: [
			"versions",
			agentId,
			containerId,
			"registry",
			options.page,
			options.search,
		],
		queryFn: () => {
			const params = new URLSearchParams({
				page: String(options.page),
				limit: "20",
			});
			if (options.search) params.set("search", options.search);
			return apiRequest<VersionsResponse>(
				`/agents/${agentId}/containers/${containerId}/versions?${params}`,
			);
		},
		enabled: options.enabled,
	});
}
