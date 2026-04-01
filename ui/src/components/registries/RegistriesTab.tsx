import { formatDistanceToNow } from "date-fns";
import { Lock, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AuthType, RegistryCredential } from "@/api/hooks/useRegistries";
import { useDeleteRegistry, useRegistries } from "@/api/hooks/useRegistries";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useStore } from "@/store/useStore";
import { RegistryModal } from "./RegistryModal";

const AUTH_TYPE_LABELS: Record<AuthType, string> = {
	basic: "Basic",
	ecr: "AWS ECR",
	gcr: "GCR",
	acr: "ACR",
};

export function RegistriesTab() {
	const { data: registries = [] } = useRegistries();
	const deleteRegistry = useDeleteRegistry();
	const addToast = useStore((s) => s.addToast);
	const [addOpen, setAddOpen] = useState(false);
	const [editRegistry, setEditRegistry] = useState<RegistryCredential | null>(
		null,
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold">Private Registries</h3>
					<p className="text-sm text-muted-foreground">
						Credentials for pulling from private Docker registries.
					</p>
				</div>
				<Button onClick={() => setAddOpen(true)}>
					<Plus size={16} /> Add Registry
				</Button>
			</div>

			<Alert>
				<Lock size={16} />
				<AlertDescription>
					Credentials are encrypted at rest. Agents receive them securely over
					WebSocket.
				</AlertDescription>
			</Alert>

			{registries.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center justify-center py-12 gap-3">
						<Lock size={40} className="text-muted-foreground/40" />
						<p className="text-muted-foreground">
							No registry credentials configured
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setAddOpen(true)}
						>
							Add your first registry
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Registry</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Username</TableHead>
								<TableHead>Added</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{registries.map((reg) => (
								<TableRow key={reg.id}>
									<TableCell>
										<div className="flex items-center gap-2">
											<Server size={14} className="text-muted-foreground" />
											<span className="font-mono text-sm">{reg.registry}</span>
										</div>
									</TableCell>
									<TableCell>
										<Badge
											variant={
												reg.auth_type === "basic" ? "secondary" : "outline"
											}
										>
											{AUTH_TYPE_LABELS[reg.auth_type] ?? "Basic"}
										</Badge>
									</TableCell>
									<TableCell className="text-sm">{reg.username}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{formatDistanceToNow(reg.created_at, { addSuffix: true })}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex gap-1 justify-end">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setEditRegistry(reg);
													setAddOpen(true);
												}}
												aria-label="Edit registry"
											>
												<Pencil size={14} />
											</Button>
											<AlertDialog>
												<AlertDialogTrigger
													render={
														<Button
															variant="ghost"
															size="sm"
															className="text-destructive"
															aria-label="Delete registry"
														/>
													}
												>
													<Trash2 size={14} />
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>
															Remove credentials for {reg.registry}?
														</AlertDialogTitle>
														<AlertDialogDescription>
															Agents will no longer be able to pull private
															images from this registry.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															onClick={() =>
																deleteRegistry.mutate(reg.id, {
																	onError: () =>
																		addToast({
																			type: "error",
																			message: "Failed to delete registry",
																		}),
																})
															}
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			<RegistryModal
				open={addOpen}
				onOpenChange={(open) => {
					setAddOpen(open);
					if (!open) setEditRegistry(null);
				}}
				editRegistry={editRegistry}
			/>
		</div>
	);
}
