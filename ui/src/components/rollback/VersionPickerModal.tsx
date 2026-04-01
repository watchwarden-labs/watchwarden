import { formatDistanceToNow } from "date-fns";
import {
	Clock,
	GitCompare,
	Globe,
	Loader2,
	RotateCcw,
	Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Container } from "@/api/hooks/useAgents";
import { useRollbackContainer } from "@/api/hooks/useAgents";
import type { RegistryTag } from "@/api/hooks/useVersions";
import { useRegistryTags, useVersions } from "@/api/hooks/useVersions";
import { type ImageDiff, ImageDiffView } from "@/components/diff/ImageDiffView";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/store/useStore";

interface VersionPickerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentId: string;
	container: Container;
}

interface SelectedVersion {
	type: "local" | "registry";
	tag?: string;
	digest?: string;
	label: string;
}

export function VersionPickerModal({
	open,
	onOpenChange,
	agentId,
	container,
}: VersionPickerModalProps) {
	const { data: versions, isLoading } = useVersions(
		agentId,
		container.docker_id,
		open,
	);
	const rollback = useRollbackContainer();
	const addToast = useStore((s) => s.addToast);
	const [selected, setSelected] = useState<SelectedVersion | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [registryPage, setRegistryPage] = useState(1);
	const [allTags, setAllTags] = useState<RegistryTag[]>([]);
	const [hasSearched, setHasSearched] = useState(false);

	// Debounce search — don't clear tags, let results replace them
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search);
			setRegistryPage(1);
			if (!search) {
				setHasSearched(false);
				if (versions?.registry?.tags) {
					setAllTags(versions.registry.tags);
				}
			} else {
				setHasSearched(true);
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [search, versions]);

	// Load initial tags from versions response (only when no search active)
	useEffect(() => {
		if (versions?.registry?.tags && !debouncedSearch && !hasSearched) {
			setAllTags(versions.registry.tags);
		}
	}, [versions, debouncedSearch, hasSearched]);

	// Search/pagination query — enabled when searching OR loading more pages
	const needsSearchQuery = (debouncedSearch !== "" || registryPage > 1) && open;
	const { data: searchResult, isFetching: loadingSearch } = useRegistryTags(
		agentId,
		container.docker_id,
		{ page: registryPage, search: debouncedSearch, enabled: needsSearchQuery },
	);

	// Apply search results
	useEffect(() => {
		if (!searchResult?.registry?.tags) return;
		if (registryPage === 1) {
			setAllTags(searchResult.registry.tags);
		} else {
			setAllTags((prev) => [...prev, ...(searchResult.registry?.tags ?? [])]);
		}
	}, [searchResult, registryPage]);

	const registryInfo = needsSearchQuery
		? searchResult?.registry
		: versions?.registry;
	const hasMore = registryInfo?.hasMore ?? false;
	const total = registryInfo?.total ?? versions?.registry?.total ?? null;

	const handleRollback = () => {
		rollback.mutate(
			{
				agentId,
				containerId: container.docker_id,
				...(selected?.tag ? { targetTag: selected.tag } : {}),
				...(selected?.digest ? { targetDigest: selected.digest } : {}),
			},
			{
				onSuccess: () => {
					addToast({
						type: "info",
						message: `Rolling back ${container.name}...`,
					});
					setConfirmOpen(false);
					onOpenChange(false);
					setSelected(null);
				},
				onError: () =>
					addToast({
						type: "error",
						message: `Rollback failed for ${container.name}`,
					}),
			},
		);
	};

	const truncateDigest = (d: string | null) =>
		d ? (d.length > 16 ? `${d.slice(0, 16)}...` : d) : "—";

	// Reset state when modal closes
	useEffect(() => {
		if (!open) {
			setSearch("");
			setDebouncedSearch("");
			setRegistryPage(1);
			setAllTags([]);
			setSelected(null);
			setHasSearched(false);
		}
	}, [open]);

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<RotateCcw size={18} /> Roll Back Container
						</DialogTitle>
						<DialogDescription>
							{container.name} · {container.image}
							<br />
							Current:{" "}
							<code className="text-xs">
								{truncateDigest(container.current_digest)}
							</code>
						</DialogDescription>
					</DialogHeader>

					<Tabs defaultValue="registry" className="mt-2">
						<TabsList>
							<TabsTrigger value="local">
								<Clock size={14} className="mr-1" /> Local History
							</TabsTrigger>
							<TabsTrigger value="registry">
								<Globe size={14} className="mr-1" /> Registry Tags
							</TabsTrigger>
							{container.last_diff && (
								<TabsTrigger value="changes">
									<GitCompare size={14} className="mr-1" /> Changes
								</TabsTrigger>
							)}
						</TabsList>

						{/* Local History Tab */}
						<TabsContent
							value="local"
							className="mt-3 max-h-80 overflow-y-auto"
						>
							{isLoading && (
								<div className="space-y-2">
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
								</div>
							)}
							{!isLoading &&
								(!versions?.local || versions.local.length === 0) && (
									<div className="py-8 text-center text-muted-foreground text-sm">
										No update history yet. Run an update first to enable
										rollback from history.
									</div>
								)}
							{versions?.local.map((v, i) => (
								<button
									type="button"
									key={`${v.digest}-${i}`}
									onClick={() =>
										!v.isCurrent &&
										setSelected({
											type: "local",
											digest: v.digest ?? undefined,
											tag: v.tag ?? undefined,
											label: v.tag ?? truncateDigest(v.digest),
										})
									}
									disabled={v.isCurrent}
									className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
										v.isCurrent
											? "opacity-50 cursor-default"
											: selected?.digest === v.digest &&
													selected?.type === "local"
												? "bg-primary/10 border border-primary/30"
												: "hover:bg-secondary"
									}`}
								>
									<div className="flex items-center gap-3">
										<span
											className={`w-3 h-3 rounded-full border-2 ${selected?.digest === v.digest && selected?.type === "local" ? "border-primary bg-primary" : "border-muted-foreground"}`}
										/>
										<div>
											{v.tag && (
												<span className="text-sm font-medium">{v.tag}</span>
											)}
											{v.digest && (
												<code
													className="text-xs text-muted-foreground ml-2"
													title={v.digest}
												>
													{truncateDigest(v.digest)}
												</code>
											)}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-xs text-muted-foreground">
											{formatDistanceToNow(v.updatedAt, { addSuffix: true })}
										</span>
										{v.isCurrent && (
											<Badge variant="outline" className="text-xs">
												Current
											</Badge>
										)}
									</div>
								</button>
							))}
						</TabsContent>

						{/* Registry Tags Tab */}
						<TabsContent value="registry" className="mt-3">
							<div className="relative mb-3">
								<Search
									size={14}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search tags..."
									className="pl-9"
								/>
							</div>

							{(isLoading || loadingSearch) && allTags.length === 0 && (
								<div className="space-y-2">
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
								</div>
							)}

							{!isLoading &&
								!loadingSearch &&
								versions?.registry === null &&
								allTags.length === 0 && (
									<Alert>
										<Globe size={14} />
										<AlertDescription className="text-xs">
											Could not fetch registry tags. Check credentials in
											Settings → Registries.
										</AlertDescription>
									</Alert>
								)}

							{!isLoading &&
								!loadingSearch &&
								allTags.length === 0 &&
								versions?.registry !== null && (
									<div className="py-8 text-center text-muted-foreground text-sm">
										No tags found{search ? ` matching "${search}"` : ""}.
									</div>
								)}

							<div className="relative max-h-64 overflow-y-auto space-y-0.5">
								{loadingSearch && allTags.length > 0 && (
									<div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-lg">
										<Loader2 size={20} className="animate-spin text-primary" />
									</div>
								)}
								{allTags.map((tag) => (
									<button
										type="button"
										key={tag.name}
										onClick={() =>
											setSelected({
												type: "registry",
												tag: tag.name,
												digest: tag.digest ?? undefined,
												label: tag.name,
											})
										}
										className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
											selected?.tag === tag.name &&
											selected?.type === "registry"
												? "bg-primary/10 border border-primary/30"
												: "hover:bg-secondary"
										}`}
									>
										<div className="flex items-center gap-3">
											<span
												className={`w-3 h-3 rounded-full border-2 ${selected?.tag === tag.name && selected?.type === "registry" ? "border-primary bg-primary" : "border-muted-foreground"}`}
											/>
											<span className="text-sm font-medium">{tag.name}</span>
										</div>
										<div className="flex items-center gap-2">
											{tag.digest && (
												<code
													className="text-xs text-muted-foreground"
													title={tag.digest}
												>
													{truncateDigest(tag.digest)}
												</code>
											)}
											{tag.updatedAt && (
												<span className="text-xs text-muted-foreground">
													{formatDistanceToNow(new Date(tag.updatedAt), {
														addSuffix: true,
													})}
												</span>
											)}
										</div>
									</button>
								))}
							</div>

							{(hasMore || (loadingSearch && allTags.length > 0)) && (
								<div className="mt-3 flex items-center justify-between">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setRegistryPage((p) => p + 1)}
										disabled={loadingSearch}
									>
										{loadingSearch ? (
											<Loader2 size={14} className="animate-spin" />
										) : null}
										{loadingSearch ? "Searching..." : "Load more"}
									</Button>
									{total !== null && (
										<span className="text-xs text-muted-foreground">
											Showing {allTags.length} of {total} tags
										</span>
									)}
								</div>
							)}
						</TabsContent>

						{/* Changes Tab */}
						{container.last_diff && (
							<TabsContent
								value="changes"
								className="mt-3 max-h-80 overflow-y-auto"
							>
								{(() => {
									try {
										const diff = JSON.parse(container.last_diff) as ImageDiff;
										return <ImageDiffView diff={diff} />;
									} catch {
										return (
											<p className="text-sm text-muted-foreground">
												Unable to parse diff data.
											</p>
										);
									}
								})()}
							</TabsContent>
						)}
					</Tabs>

					<DialogFooter>
						<Button variant="ghost" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button disabled={!selected} onClick={() => setConfirmOpen(true)}>
							Roll Back to {selected?.label ?? "..."}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Roll back {container.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This will replace the running container with{" "}
							{selected?.label ?? "the selected version"}. The container will be
							briefly unavailable during the process.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleRollback}>
							Roll Back
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
