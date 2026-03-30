import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface NotificationChannel {
	id: string;
	type: string;
	name: string;
	config: string;
	enabled: number;
	events: string;
	created_at: number;
}

export function useNotifications() {
	return useQuery({
		queryKey: ["notifications"],
		queryFn: () => apiRequest<NotificationChannel[]>("/notifications"),
	});
}

export function useCreateNotification() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: {
			type: string;
			name: string;
			config: Record<string, unknown>;
			events: string[];
		}) =>
			apiRequest<{ id: string }>("/notifications", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
	});
}

export function useUpdateNotification() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			name?: string;
			enabled?: boolean;
			config?: Record<string, unknown>;
			events?: string[];
		}) =>
			apiRequest<void>(`/notifications/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
	});
}

export function useDeleteNotification() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			apiRequest<void>(`/notifications/${id}`, { method: "DELETE" }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
	});
}

export function useTestNotification() {
	return useMutation({
		mutationFn: (id: string) =>
			apiRequest<{ success: boolean }>(`/notifications/${id}/test`, {
				method: "POST",
			}),
	});
}

// Fetch single channel with decrypted config (for editing)
export interface NotificationChannelDetail
	extends Omit<NotificationChannel, "config"> {
	config: Record<string, unknown>;
}

export function useNotificationChannel(id: string | null) {
	return useQuery({
		queryKey: ["notifications", id],
		queryFn: () =>
			apiRequest<NotificationChannelDetail>(`/notifications/${id}`),
		enabled: !!id,
	});
}

// Notification delivery logs
export interface NotificationLog {
	id: number;
	channel_id: string;
	channel_name: string;
	event_type: string;
	status: string;
	error: string | null;
	created_at: number;
}

export function useNotificationLogs() {
	return useQuery({
		queryKey: ["notification-logs"],
		queryFn: () => apiRequest<NotificationLog[]>("/notifications/logs"),
	});
}
