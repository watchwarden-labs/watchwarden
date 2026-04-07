import { History, LayoutDashboard, Server, Settings, Shield, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/agents', label: 'Agents', icon: Server },
  { path: '/history', label: 'History', icon: History },
  { path: '/audit', label: 'Audit Log', icon: Shield },
  { path: '/settings', label: 'Settings', icon: Settings },
];

function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <nav className="p-2 space-y-1">
      {navItems.map(({ path, label, icon: Icon }) => {
        const active = location.pathname === path;
        return (
          <Link
            key={path}
            to={path}
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: active ? 'secondary' : 'ghost' }),
              'w-full justify-start gap-3',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const mobileOpen = useStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useStore((s) => s.setMobileSidebarOpen);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'bg-card border-r border-border h-screen sticky top-0 transition-all duration-200 hidden md:block',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div className="p-4">
          <h1 className={`font-bold text-primary ${collapsed ? 'text-center text-sm' : 'text-lg'}`}>
            {collapsed ? 'WW' : 'WatchWarden'}
          </h1>
        </div>
        <Separator />
        <NavLinks collapsed={collapsed} />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          {/* Drawer */}
          <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r border-border shadow-xl animate-in slide-in-from-left duration-200">
            <div className="p-4 flex items-center justify-between">
              <h1 className="font-bold text-primary text-lg">WatchWarden</h1>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={20} />
              </button>
            </div>
            <Separator />
            <NavLinks collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
