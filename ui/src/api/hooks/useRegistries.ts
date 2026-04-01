import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";

export type AuthType = "basic" | "ecr" | "gcr" | "acr";

export interface RegistryCredential {
	id: string;
	registry: string;
	username: string;
	auth_type: AuthType;
	created_at: number;
}

export function useRegistries() {
	return useQuery({
		queryKey: ["registries"],
		queryFn: () => apiRequest<RegistryCredential[]>("/registries"),
	});
}

export function useCreateRegistry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: {
			registry: string;
			username: string;
			password: string;
			auth_type?: AuthType;
		}) =>
			apiRequest<{ id: string }>("/registries", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["registries"] }),
	});
}

export function useUpdateRegistry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			registry?: string;
			username?: string;
			password?: string;
			auth_type?: AuthType;
		}) =>
			apiRequest<void>(`/registries/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["registries"] }),
	});
}

export function useDeleteRegistry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			apiRequest<void>(`/registries/${id}`, { method: "DELETE" }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["registries"] }),
	});
}
