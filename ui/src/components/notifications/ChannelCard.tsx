import {
	Check,
	Hash,
	Loader2,
	MessageCircle,
	Pencil,
	Send,
	Trash2,
	Webhook,
	X,
} from "lucide-react";
import { useState } from "react";
import type { NotificationChannel } from "@/api/hooks/useNotifications";
import {
	useDeleteNotification,
	useTestNotification,
	useUpdateNotification,
} from "@/api/hooks/useNotifications";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/store/useStore";

const typeIcons: Record<string, typeof MessageCircle> = {
	telegram: MessageCircle,
	slack: Hash,
	webhook: Webhook,
};

const eventConfig: Record<string, { label: string; className: string }> = {
	update_available: {
		label: "Available",
		className: "bg-warning/15 text-warning border-warning/30",
	},
	update_success: {
		label: "Success",
		className: "bg-success/15 text-success border-success/30",
	},
	update_failed: {
		label: "Failed",
		className: "bg-destructive/15 text-destructive border-destructive/30",
	},
};

interface ChannelCardProps {
	channel: NotificationChannel;
	onEdit: () => void;
}

export function ChannelCard({ channel, onEdit }: ChannelCardProps) {
	const updateChannel = useUpdateNotification();
	const deleteChannel = useDeleteNotification();
	const testChannel = useTestNotification();
	const addToast = useStore((s) => s.addToast);
	const [testState, setTestState] = useState<
		"idle" | "loading" | "success" | "error" | "cooldown"
	>("idle");

	const Icon = typeIcons[channel.type] ?? Webhook;
	const events = (() => {
		try {
			return JSON.parse(channel.events) as string[];
		} catch {
			return [];
		}
	})();

	const handleTest = () => {
		if (testState === "cooldown") {
			addToast({
				type: "info",
				message: "Please wait before sending another test",
			});
			return;
		}
		setTestState("loading");
		testChannel.mutate(channel.id, {
			onSuccess: () => {
				setTestState("success");
				addToast({ type: "success", message: "Test notification sent" });
				setTimeout(() => setTestState("cooldown"), 1500);
				setTimeout(() => setTestState("idle"), 60_000); // 1 min cooldown
			},
			onError: () => {
				setTestState("error");
				addToast({ type: "error", message: "Test notification failed" });
				setTimeout(() => setTestState("idle"), 2000);
			},
		});
	};

	return (
		<Card>
			<CardContent className="pt-4">
				<div className="flex items-start justify-between mb-3">
					<div className="flex items-center gap-3">
						<div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
							<Icon size={18} className="text-muted-foreground" />
						</div>
						<div>
							<p className="font-medium text-sm">{channel.name}</p>
							<p className="text-xs text-muted-foreground capitalize">
								{channel.type}
							</p>
						</div>
					</div>
					<Switch
						checked={!!channel.enabled}
						onCheckedChange={(checked) =>
							updateChannel.mutate({ id: channel.id, enabled: checked })
						}
					/>
				</div>

				<div className="flex gap-1.5 mb-4">
					{events.map((e) => (
						<Badge
							key={e}
							variant="outline"
							className={eventConfig[e]?.className ?? ""}
						>
							{eventConfig[e]?.label ?? e}
						</Badge>
					))}
				</div>

				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handleTest}
						disabled={testState === "loading"}
						className={
							testState === "success"
								? "border-success text-success"
								: testState === "error"
									? "border-destructive text-destructive"
									: testState === "cooldown"
										? "opacity-60"
										: ""
						}
					>
						{testState === "loading" ? (
							<Loader2 size={14} className="animate-spin" />
						) : testState === "success" ? (
							<Check size={14} />
						) : testState === "error" ? (
							<X size={14} />
						) : (
							<Send size={14} />
						)}
						{testState === "cooldown" ? "Wait..." : "Test"}
					</Button>
					<Button variant="ghost" size="sm" onClick={onEdit}>
						<Pencil size={14} /> Edit
					</Button>
					<AlertDialog>
						<AlertDialogTrigger
							render={
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive"
									aria-label="Delete channel"
								/>
							}
						>
							<Trash2 size={14} />
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									Delete &quot;{channel.name}&quot;?
								</AlertDialogTitle>
								<AlertDialogDescription>
									This notification channel will be permanently removed.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => deleteChannel.mutate(channel.id, { onError: () => addToast({ type: "error", message: "Failed to delete channel" }) })}
								>
									Delete
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</CardContent>
		</Card>
	);
}
