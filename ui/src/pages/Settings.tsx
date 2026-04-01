import { Bell, Clock, Database, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "@/api/client";
import { useConfig, useUpdateConfig } from "@/api/hooks/useSettings";
import { RegisterAgentModal } from "@/components/agents/RegisterAgentModal";
import { CronPicker } from "@/components/common/CronPicker";
import { NotificationsTab } from "@/components/notifications/NotificationsTab";
import { RegistriesTab } from "@/components/registries/RegistriesTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/store/useStore";

export function Settings() {
	return (
		<div className="p-6 space-y-6">
			<h1 className="text-2xl font-bold">Settings</h1>
			<Tabs defaultValue="general">
				<TabsList>
					<TabsTrigger value="general">
						<Clock size={14} className="mr-1" /> General
					</TabsTrigger>
					<TabsTrigger value="notifications">
						<Bell size={14} className="mr-1" /> Notifications
					</TabsTrigger>
					<TabsTrigger value="registries">
						<Database size={14} className="mr-1" /> Registries
					</TabsTrigger>
				</TabsList>
				<TabsContent value="general" className="mt-4">
					<GeneralTab />
				</TabsContent>
				<TabsContent value="notifications" className="mt-4">
					<NotificationsTab />
				</TabsContent>
				<TabsContent value="registries" className="mt-4">
					<RegistriesTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function GeneralTab() {
	const { data: config } = useConfig();
	const updateConfig = useUpdateConfig();
	const addToast = useStore((s) => s.addToast);
	const [newPassword, setNewPassword] = useState("");
	const [registerOpen, setRegisterOpen] = useState(false);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Global Schedule</CardTitle>
				</CardHeader>
				<CardContent>
					<CronPicker
						value={config?.global_schedule ?? "0 4 * * *"}
						onChange={(val) =>
							updateConfig.mutate(
								{ key: "global_schedule", value: val },
								{
									onError: () =>
										addToast({
											type: "error",
											message: "Failed to update schedule",
										}),
								},
							)
						}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<RefreshCw size={16} /> Startup Behavior
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium">Check on startup</p>
							<p className="text-xs text-muted-foreground">
								Run a catch-up check when the controller starts if the last
								scheduled check was more than 24 hours ago
							</p>
						</div>
						<Switch
							checked={config?.check_on_startup === "true"}
							onCheckedChange={(checked) =>
								updateConfig.mutate(
									{ key: "check_on_startup", value: String(checked) },
									{
										onError: () =>
											addToast({
												type: "error",
												message: "Failed to update setting",
											}),
									},
								)
							}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Admin Password</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-2">
						<div className="flex gap-2">
							<Input
								type="password"
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								placeholder="New password (min 8 characters)"
								minLength={8}
							/>
							<Button
								disabled={newPassword.length < 8}
								onClick={async () => {
									try {
										await apiRequest("/auth/password", {
											method: "PUT",
											body: JSON.stringify({ password: newPassword }),
										});
										setNewPassword("");
										addToast({ type: "success", message: "Password updated" });
									} catch (err) {
										const body = (err as { body?: { error?: string } })?.body;
										const message = body?.error || "Failed to update password";
										addToast({ type: "error", message });
									}
								}}
							>
								Update
							</Button>
						</div>
						{newPassword.length > 0 && newPassword.length < 8 && (
							<p className="text-xs text-destructive">
								Password must be at least 8 characters
							</p>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>Agents</CardTitle>
						<Button size="sm" onClick={() => setRegisterOpen(true)}>
							<Plus size={14} /> Register New Agent
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Register a new agent to connect a remote Docker host. Each agent
						gets a unique token for authentication.
					</p>
				</CardContent>
			</Card>

			<RegisterAgentModal open={registerOpen} onOpenChange={setRegisterOpen} />
		</div>
	);
}
