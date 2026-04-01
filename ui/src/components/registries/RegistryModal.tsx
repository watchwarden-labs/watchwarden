import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthType, RegistryCredential } from "@/api/hooks/useRegistries";
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

const AUTH_TYPE_OPTIONS: { value: AuthType; label: string }[] = [
	{ value: "basic", label: "Basic (Username / Password)" },
	{ value: "ecr", label: "AWS ECR" },
	{ value: "gcr", label: "Google GCR" },
	{ value: "acr", label: "Azure ACR" },
];

const AUTH_TYPE_HINTS: Record<AuthType, string> = {
	basic: "",
	ecr: "Requires AWS CLI installed on the agent. Tokens refresh automatically every 10 hours.",
	gcr: "Use _json_key as username and paste the service account JSON key as password.",
	acr: "Use the ACR service principal client ID as username and client secret as password.",
};

const REGISTRY_PREFILLS: Record<AuthType, string> = {
	basic: "",
	ecr: ".dkr.ecr..amazonaws.com",
	gcr: "gcr.io",
	acr: ".azurecr.io",
};

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
	const [authType, setAuthType] = useState<AuthType>(
		editRegistry?.auth_type ?? "basic",
	);
	const [registry, setRegistry] = useState(editRegistry?.registry ?? "");
	const [username, setUsername] = useState(editRegistry?.username ?? "");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const addToast = useStore((s) => s.addToast);
	const createRegistry = useCreateRegistry();
	const updateRegistry = useUpdateRegistry();
	const isEdit = !!editRegistry;

	// When auth type changes, prefill registry URL and username for cloud providers
	useEffect(() => {
		if (isEdit) return;
		const prefill = REGISTRY_PREFILLS[authType];
		if (prefill && !registry) {
			setRegistry(prefill);
		}
		if (authType === "gcr") {
			setUsername("_json_key");
		} else if (authType === "ecr") {
			setUsername("AWS");
		}
	}, [authType, isEdit, registry]);

	const handleSave = () => {
		if (isEdit) {
			updateRegistry.mutate(
				{
					id: editRegistry.id,
					registry,
					username,
					auth_type: authType,
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
				{ registry, username, password, auth_type: authType },
				{
					onSuccess: () => {
						addToast({ type: "success", message: "Registry added" });
						onOpenChange(false);
						setRegistry("");
						setUsername("");
						setPassword("");
						setAuthType("basic");
					},
					onError: () =>
						addToast({ type: "error", message: "Failed to add registry" }),
				},
			);
		}
	};

	const canSave =
		registry.trim() && username.trim() && (isEdit || password.trim());

	const hint = AUTH_TYPE_HINTS[authType];

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
						<Label>Auth Type</Label>
						<select
							value={authType}
							onChange={(e) => setAuthType(e.target.value as AuthType)}
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							{AUTH_TYPE_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
						{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
					</div>
					<div className="space-y-1.5">
						<Label>Registry URL</Label>
						<Input
							value={registry}
							onChange={(e) => setRegistry(e.target.value)}
							placeholder={
								authType === "ecr"
									? "123456789.dkr.ecr.us-east-1.amazonaws.com"
									: authType === "gcr"
										? "gcr.io"
										: authType === "acr"
											? "myregistry.azurecr.io"
											: "docker.io"
							}
							list="registry-suggestions"
						/>
						{authType === "basic" && (
							<>
								<datalist id="registry-suggestions">
									<option value="docker.io" />
									<option value="ghcr.io" />
									<option value="registry.gitlab.com" />
								</datalist>
								<p className="text-xs text-muted-foreground">
									Examples: docker.io, ghcr.io, registry.example.com
								</p>
							</>
						)}
					</div>
					<div className="space-y-1.5">
						<Label>{authType === "acr" ? "Client ID" : "Username"}</Label>
						<Input
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							disabled={authType === "gcr" || authType === "ecr"}
							placeholder={
								authType === "gcr"
									? "_json_key (auto-set)"
									: authType === "ecr"
										? "AWS (auto-set)"
										: undefined
							}
						/>
					</div>
					<div className="space-y-1.5">
						<Label>
							{authType === "gcr"
								? "Service Account JSON Key"
								: authType === "acr"
									? "Client Secret"
									: authType === "ecr"
										? "ECR Password (auto-refreshed by agent)"
										: "Password"}
						</Label>
						<div className="flex gap-2">
							{authType === "gcr" ? (
								<textarea
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={
										isEdit
											? "Leave blank to keep current"
											: '{"type": "service_account", ...}'
									}
									rows={4}
									className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
								/>
							) : (
								<>
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
										aria-label={
											showPassword ? "Hide password" : "Show password"
										}
									>
										{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
									</Button>
								</>
							)}
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
