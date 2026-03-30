import {
	Check,
	ExternalLink,
	Hash,
	Loader2,
	MessageCircle,
	Plus,
	Webhook,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { NotificationChannel } from "@/api/hooks/useNotifications";
import {
	useCreateNotification,
	useNotificationChannel,
	useTestNotification,
	useUpdateNotification,
} from "@/api/hooks/useNotifications";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/store/useStore";

interface AddChannelModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editChannel?: NotificationChannel | null;
}

const TYPES = [
	{
		value: "telegram",
		label: "Telegram",
		icon: MessageCircle,
		desc: "Send to a Telegram chat or group",
	},
	{
		value: "slack",
		label: "Slack",
		icon: Hash,
		desc: "Post to a Slack channel via webhook",
	},
	{
		value: "webhook",
		label: "Webhook",
		icon: Webhook,
		desc: "POST JSON to any HTTP endpoint",
	},
] as const;

const EVENTS = [
	{
		value: "update_available",
		label: "Updates Available",
		desc: "A new image version is detected",
	},
	{
		value: "update_success",
		label: "Update Succeeded",
		desc: "All containers updated successfully",
	},
	{
		value: "update_failed",
		label: "Update Failed",
		desc: "One or more containers failed to update",
	},
] as const;

export function AddChannelModal({
	open,
	onOpenChange,
	editChannel,
}: AddChannelModalProps) {
	const [step, setStep] = useState(1);
	const [type, setType] = useState<string>(editChannel?.type ?? "telegram");
	const [name, setName] = useState(editChannel?.name ?? "");
	const [config, setConfig] = useState<Record<string, string>>({});
	const [events, setEvents] = useState<string[]>(
		editChannel
			? (() => {
					try {
						return JSON.parse(editChannel.events);
					} catch {
						return ["update_available", "update_success", "update_failed"];
					}
				})()
			: ["update_available", "update_success", "update_failed"],
	);
	const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(
		[],
	);
	const [saveState, setSaveState] = useState<
		"idle" | "saving" | "success" | "error"
	>("idle");
	const [errorMsg, setErrorMsg] = useState("");

	const createChannel = useCreateNotification();
	const updateChannel = useUpdateNotification();
	const testChannel = useTestNotification();
	const { data: channelDetail } = useNotificationChannel(
		editChannel?.id ?? null,
	);
	const addToast = useStore((s) => s.addToast);

	// Pre-fill config when editing
	useEffect(() => {
		if (channelDetail && editChannel) {
			setType(channelDetail.type);
			setName(channelDetail.name);
			if (
				typeof channelDetail.config === "object" &&
				channelDetail.config !== null
			) {
				const c: Record<string, string> = {};
				for (const [k, v] of Object.entries(channelDetail.config)) {
					c[k] = String(v);
				}
				setConfig(c);
			}
			try {
				const evts =
					typeof channelDetail.events === "string"
						? JSON.parse(channelDetail.events)
						: channelDetail.events;
				setEvents(evts);
			} catch {
				/* keep default */
			}
			setStep(2); // Skip type selection on edit
		}
	}, [channelDetail, editChannel]);

	const resetAndClose = () => {
		setStep(1);
		setName("");
		setConfig({});
		setEvents(["update_available", "update_success", "update_failed"]);
		setHeaders([]);
		setSaveState("idle");
		setErrorMsg("");
		onOpenChange(false);
	};

	const toggleEvent = (event: string) => {
		setEvents((prev) =>
			prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
		);
	};

	const setConfigField = (key: string, value: string) =>
		setConfig((prev) => ({ ...prev, [key]: value }));

	const buildConfigPayload = (): Record<string, unknown> => {
		const base = { ...config };
		if (type === "webhook" && headers.length > 0) {
			const h: Record<string, string> = {};
			for (const { key, value } of headers) {
				if (key) h[key] = value;
			}
			return { ...base, headers: h };
		}
		return base;
	};

	const canProceedStep2 = () => {
		if (!name.trim()) return false;
		if (type === "telegram") return !!config.botToken && !!config.chatId;
		if (type === "slack") return !!config.webhookUrl;
		if (type === "webhook") return !!config.url;
		return false;
	};

	const [savedChannelId, setSavedChannelId] = useState<string | null>(null);

	const handleSave = () => {
		setSaveState("saving");
		const payload = { type, name, config: buildConfigPayload(), events };
		const onError = (err: Error) => {
			setSaveState("error");
			setErrorMsg(err.message ?? "Failed to save");
		};

		if (editChannel) {
			updateChannel.mutate(
				{ id: editChannel.id, ...payload },
				{
					onSuccess: () => {
						setSaveState("success");
						setSavedChannelId(editChannel.id);
						setTimeout(resetAndClose, 1500);
					},
					onError,
				},
			);
		} else {
			createChannel.mutate(payload, {
				onSuccess: (data) => {
					const id = (data as { id: string }).id;
					setSaveState("success");
					setSavedChannelId(id);
					setTimeout(resetAndClose, 1500);
				},
				onError,
			});
		}
	};

	const handleTest = () => {
		const channelId = savedChannelId ?? editChannel?.id;
		if (!channelId) return;
		testChannel.mutate(channelId, {
			onSuccess: () =>
				addToast({ type: "success", message: "Test notification sent" }),
			onError: () =>
				addToast({ type: "error", message: "Test notification failed" }),
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{editChannel ? "Edit" : "Add"} Notification Channel
					</DialogTitle>
					<DialogDescription>
						<span className="flex gap-2 mt-2">
							{[1, 2, 3].map((s) => (
								<span
									key={s}
									className={`h-1 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-secondary"}`}
								/>
							))}
						</span>
					</DialogDescription>
				</DialogHeader>

				{/* Step 1: Type */}
				{step === 1 && (
					<div className="grid grid-cols-3 gap-3 py-2">
						{TYPES.map((t) => (
							<Card
								key={t.value}
								className={`cursor-pointer transition-all ${type === t.value ? "border-primary shadow-glow-accent" : "hover:border-muted-foreground/30"}`}
								onClick={() => setType(t.value)}
							>
								<CardContent className="pt-4 text-center space-y-2">
									<t.icon
										size={24}
										className={
											type === t.value
												? "text-primary mx-auto"
												: "text-muted-foreground mx-auto"
										}
									/>
									<p className="text-sm font-medium">{t.label}</p>
									<p className="text-xs text-muted-foreground">{t.desc}</p>
								</CardContent>
							</Card>
						))}
					</div>
				)}

				{/* Step 2: Config */}
				{step === 2 && (
					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<Label>Name</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Team Updates"
							/>
						</div>

						{type === "telegram" && (
							<>
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<Label>Bot Token</Label>
										<a
											href="https://core.telegram.org/bots#botfather"
											target="_blank"
											rel="noreferrer"
											className="text-xs text-primary flex items-center gap-1"
										>
											How to get <ExternalLink size={10} />
										</a>
									</div>
									<Input
										value={config.botToken ?? ""}
										onChange={(e) => setConfigField("botToken", e.target.value)}
										placeholder="123456:ABC-DEF..."
									/>
								</div>
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<Label>Chat ID</Label>
										<a
											href="https://t.me/userinfobot"
											target="_blank"
											rel="noreferrer"
											className="text-xs text-primary flex items-center gap-1"
										>
											How to get <ExternalLink size={10} />
										</a>
									</div>
									<Input
										value={config.chatId ?? ""}
										onChange={(e) => setConfigField("chatId", e.target.value)}
										placeholder="-1001234567890"
									/>
								</div>
							</>
						)}

						{type === "slack" && (
							<div className="space-y-1.5">
								<div className="flex items-center justify-between">
									<Label>Webhook URL</Label>
									<a
										href="https://api.slack.com/messaging/webhooks"
										target="_blank"
										rel="noreferrer"
										className="text-xs text-primary flex items-center gap-1"
									>
										Slack docs <ExternalLink size={10} />
									</a>
								</div>
								<Input
									value={config.webhookUrl ?? ""}
									onChange={(e) => setConfigField("webhookUrl", e.target.value)}
									placeholder="https://hooks.slack.com/services/..."
								/>
							</div>
						)}

						{type === "webhook" && (
							<>
								<div className="space-y-1.5">
									<Label>URL</Label>
									<Input
										value={config.url ?? ""}
										onChange={(e) => setConfigField("url", e.target.value)}
										placeholder="https://example.com/webhook"
									/>
								</div>
								<div className="space-y-1.5">
									<Label>Headers</Label>
									{headers.map((h, i) => (
										<div key={`header-${h.key || i}`} className="flex gap-2">
											<Input
												placeholder="Key"
												value={h.key}
												onChange={(e) => {
													const n = [...headers];
													n[i] = { ...h, key: e.target.value };
													setHeaders(n);
												}}
											/>
											<Input
												placeholder="Value"
												value={h.value}
												onChange={(e) => {
													const n = [...headers];
													n[i] = { ...h, value: e.target.value };
													setHeaders(n);
												}}
											/>
											<Button
												variant="ghost"
												size="icon"
												onClick={() =>
													setHeaders(headers.filter((_, j) => j !== i))
												}
												aria-label="Remove header"
											>
												<X size={14} />
											</Button>
										</div>
									))}
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											setHeaders([...headers, { key: "", value: "" }])
										}
									>
										<Plus size={14} /> Add header
									</Button>
								</div>
							</>
						)}
					</div>
				)}

				{/* Step 3: Events */}
				{step === 3 && (
					<div className="space-y-4 py-2">
						<p className="text-sm text-muted-foreground">Notify me when:</p>
						{EVENTS.map((e) => (
							<label
								key={e.value}
								className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-secondary"
							>
								<Checkbox
									checked={events.includes(e.value)}
									onCheckedChange={() => toggleEvent(e.value)}
									className="mt-0.5"
								/>
								<div>
									<p className="text-sm font-medium">{e.label}</p>
									<p className="text-xs text-muted-foreground">{e.desc}</p>
								</div>
							</label>
						))}

						{saveState === "success" && (
							<Alert className="border-success">
								<Check size={16} className="text-success" />
								<AlertDescription className="text-success">
									Channel created and test sent successfully!
								</AlertDescription>
							</Alert>
						)}
						{saveState === "error" && (
							<Alert variant="destructive">
								<X size={16} />
								<AlertDescription>
									{errorMsg || "Failed to save channel"}
								</AlertDescription>
							</Alert>
						)}
					</div>
				)}

				<DialogFooter>
					{step > 1 && (
						<Button variant="outline" onClick={() => setStep(step - 1)}>
							Back
						</Button>
					)}
					<Button variant="ghost" onClick={resetAndClose}>
						Cancel
					</Button>
					{step < 3 ? (
						<Button
							onClick={() => setStep(step + 1)}
							disabled={step === 2 && !canProceedStep2()}
						>
							Next
						</Button>
					) : (
						<>
							{(savedChannelId || editChannel) && (
								<Button
									variant="outline"
									onClick={handleTest}
									disabled={testChannel.isPending}
								>
									{testChannel.isPending ? (
										<Loader2 size={14} className="animate-spin" />
									) : null}{" "}
									Test
								</Button>
							)}
							<Button
								onClick={handleSave}
								disabled={
									events.length === 0 ||
									saveState === "saving" ||
									saveState === "success"
								}
							>
								{saveState === "saving" ? (
									<>
										<Loader2 size={14} className="animate-spin" /> Saving...
									</>
								) : saveState === "success" ? (
									<>
										<Check size={14} /> Saved
									</>
								) : (
									"Save"
								)}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
