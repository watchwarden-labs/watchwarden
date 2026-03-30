import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { RegistryCredential } from "@/api/hooks/useRegistries";
import {
	useCreateRegistry,
	useUpdateRegistry,
} from "@/api/hooks/useRegistries";
import { Button } from "@/components/ui/button";
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

interface RegistryModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editRegistry?: RegistryCredential | null;
}

export function RegistryModal({
	open,
	onOpenChange,
	editRegistry,
}: RegistryModalProps) {
	const [registry, setRegistry] = useState(editRegistry?.registry ?? "");
	const [username, setUsername] = useState(editRegistry?.username ?? "");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const addToast = useStore((s) => s.addToast);
	const createRegistry = useCreateRegistry();
	const updateRegistry = useUpdateRegistry();
	const isEdit = !!editRegistry;

	const handleSave = () => {
		if (isEdit) {
			updateRegistry.mutate(
				{
					id: editRegistry.id,
					registry,
					username,
					...(password ? { password } : {}),
				},
				{
					onSuccess: () => {
						addToast({ type: "success", message: "Registry updated" });
						onOpenChange(false);
					},
					onError: () =>
						addToast({ type: "error", message: "Failed to update registry" }),
				},
			);
		} else {
			createRegistry.mutate(
				{ registry, username, password },
				{
					onSuccess: () => {
						addToast({ type: "success", message: "Registry added" });
						onOpenChange(false);
						setRegistry("");
						setUsername("");
						setPassword("");
					},
					onError: () =>
						addToast({ type: "error", message: "Failed to add registry" }),
				},
			);
		}
	};

	const canSave =
		registry.trim() && username.trim() && (isEdit || password.trim());

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? "Edit" : "Add"} Registry Credentials
					</DialogTitle>
					<DialogDescription>
						Credentials are encrypted at rest and synced securely to agents.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-1.5">
						<Label>Registry URL</Label>
						<Input
							value={registry}
							onChange={(e) => setRegistry(e.target.value)}
							placeholder="docker.io"
							list="registry-suggestions"
						/>
						<datalist id="registry-suggestions">
							<option value="docker.io" />
							<option value="ghcr.io" />
							<option value="registry.gitlab.com" />
						</datalist>
						<p className="text-xs text-muted-foreground">
							Examples: docker.io, ghcr.io, registry.example.com
						</p>
					</div>
					<div className="space-y-1.5">
						<Label>Username</Label>
						<Input
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label>Password</Label>
						<div className="flex gap-2">
							<Input
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={isEdit ? "Leave blank to keep current" : ""}
							/>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowPassword(!showPassword)}
								aria-label={showPassword ? "Hide password" : "Show password"}
							>
								{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
							</Button>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!canSave}>
						Save Credentials
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
