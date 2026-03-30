import { LogOut, Menu, Wifi, WifiOff } from "lucide-react";
import { apiRequest } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/store/useStore";

export function TopBar() {
	const wsConnected = useStore((s) => s.wsConnected);
	const toggleSidebar = useStore((s) => s.toggleSidebar);
	const setAuthToken = useStore((s) => s.setAuthToken);

	return (
		<header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between">
			<Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
				<Menu size={18} />
			</Button>

			<div className="flex items-center gap-4">
				<Badge
					variant={wsConnected ? "outline" : "destructive"}
					className={wsConnected ? "border-success text-success" : ""}
				>
					{wsConnected ? (
						<Wifi size={12} className="mr-1" />
					) : (
						<WifiOff size={12} className="mr-1" />
					)}
					{wsConnected ? "Connected" : "Disconnected"}
				</Badge>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => {
						apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
						setAuthToken(null);
					}}
					aria-label="Logout"
				>
					<LogOut size={16} />
				</Button>
			</div>
		</header>
	);
}
