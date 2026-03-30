import {
	History,
	LayoutDashboard,
	Server,
	Settings,
	Shield,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useStore } from "@/store/useStore";

const navItems = [
	{ path: "/", label: "Dashboard", icon: LayoutDashboard },
	{ path: "/agents", label: "Agents", icon: Server },
	{ path: "/history", label: "History", icon: History },
	{ path: "/audit", label: "Audit Log", icon: Shield },
	{ path: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
	const location = useLocation();
	const collapsed = useStore((s) => s.sidebarCollapsed);

	return (
		<aside
			className={`bg-card border-r border-border h-screen sticky top-0 transition-all duration-200 ${collapsed ? "w-16" : "w-56"}`}
		>
			<div className="p-4">
				<h1
					className={`font-bold text-primary ${collapsed ? "text-center text-sm" : "text-lg"}`}
				>
					{collapsed ? "WW" : "WatchWarden"}
				</h1>
			</div>
			<Separator />
			<nav className="p-2 space-y-1">
				{navItems.map(({ path, label, icon: Icon }) => {
					const active = location.pathname === path;
					return (
						<Link
							key={path}
							to={path}
							className={cn(
								buttonVariants({ variant: active ? "secondary" : "ghost" }),
								"w-full justify-start gap-3",
								active ? "text-primary" : "text-muted-foreground",
							)}
						>
							<Icon size={18} />
							{!collapsed && <span>{label}</span>}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
