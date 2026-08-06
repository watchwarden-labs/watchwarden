import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { apiRequest } from './api/client';
import { Toaster } from './components/common/Toaster';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Button } from './components/ui/button';
import { AgentDetail } from './pages/AgentDetail';
import { Agents } from './pages/Agents';
import AuditLog from './pages/AuditLog';
import { Dashboard } from './pages/Dashboard';
import { HistoryPage } from './pages/History';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { useStore } from './store/useStore';
import { useSocket } from './ws/useSocket';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/agents': 'Agents',
  '/history': 'History',
  '/audit': 'Audit Log',
  '/settings': 'Settings',
};

function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Match /agents/:id as "Agent Detail"
    const title = ROUTE_TITLES[pathname] ?? (pathname.startsWith('/agents/') ? 'Agent Detail' : '');
    document.title = title ? `WatchWarden | ${title}` : 'WatchWarden';
  }, [pathname]);
}

function AuthenticatedApp() {
  useSocket();
  usePageTitle();
  const setMobileSidebarOpen = useStore((s) => s.setMobileSidebarOpen);

  return (
    <div className="flex min-h-screen w-full md:max-w-[1280px] md:mx-auto md:border-x border-border bg-grid">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          mobileNavTrigger={
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={18} />
            </Button>
          }
        />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppContent() {
  const authToken = useStore((s) => s.authToken);
  const setAuthToken = useStore((s) => s.setAuthToken);
  const [checking, setChecking] = useState(() => !!localStorage.getItem('watchwarden_auth'));

  // On mount, verify the httpOnly cookie is still valid
  useEffect(() => {
    if (!checking) return;
    apiRequest('/auth/me')
      .then(() => {
        setAuthToken('cookie');
        setChecking(false);
      })
      .catch(() => {
        setAuthToken(null);
        setChecking(false);
      });
  }, [checking, setAuthToken]);

  if (checking) return null; // brief blank while verifying cookie

  if (!authToken) {
    return <Login />;
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
