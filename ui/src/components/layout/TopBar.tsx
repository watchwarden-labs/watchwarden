import { LogOut, Menu, Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';

export function TopBar() {
  const wsConnected = useStore((s) => s.wsConnected);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setMobileSidebarOpen = useStore((s) => s.setMobileSidebarOpen);
  const setAuthToken = useStore((s) => s.setAuthToken);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between">
      {/* Mobile: open drawer. Desktop: toggle collapse */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          if (window.innerWidth < 768) {
            setMobileSidebarOpen(true);
          } else {
            toggleSidebar();
          }
        }}
        aria-label="Toggle sidebar"
      >
        <Menu size={18} />
      </Button>

      <div className="flex items-center gap-2 sm:gap-4">
        <Badge
          variant={wsConnected ? 'outline' : 'destructive'}
          className={wsConnected ? 'border-success text-success' : ''}
        >
          {wsConnected ? (
            <Wifi size={12} className="sm:mr-1" />
          ) : (
            <WifiOff size={12} className="sm:mr-1" />
          )}
          <span className="hidden sm:inline">{wsConnected ? 'Connected' : 'Disconnected'}</span>
        </Badge>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
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
