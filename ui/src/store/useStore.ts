import { create } from 'zustand';

export interface AgentRealtimeStatus {
  status: string;
  lastSeen?: number;
}

export interface UpdateProgress {
  step: string;
  containerName: string;
  progress?: string;
  timestamp: number;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface WatchWardenState {
  // Connection
  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;

  // Auth
  authToken: string | null;
  setAuthToken: (token: string | null) => void;

  // Real-time agent status
  agentStatuses: Record<string, AgentRealtimeStatus>;
  updateAgentStatus: (id: string, status: AgentRealtimeStatus) => void;

  // Agents currently being checked (waiting for WS result)
  checkingAgents: Set<string>;
  setAgentChecking: (agentId: string, checking: boolean) => void;

  // Update progress (keyed by "agentId:containerId")
  updateProgress: Record<string, UpdateProgress>;
  setUpdateProgress: (key: string, progress: UpdateProgress) => void;
  clearUpdateProgress: (key: string) => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;

  // Query invalidation callback
  invalidateAgents?: () => void;
  setInvalidateAgents: (fn: () => void) => void;

  // Last CONTAINER_ACTION_RESULT received from the agent — ContainerRow watches
  // this to clear its pending-action spinner regardless of whether the action
  // succeeded or failed.
  lastActionResult: { containerId: string; action: string; success: boolean } | null;

  // WS event handler
  handleWSEvent: (event: Record<string, unknown>) => void;

  // UI state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  agentViewMode: 'grid' | 'list';
  setAgentViewMode: (mode: 'grid' | 'list') => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

let toastCounter = 0;
// FIX-5.2: track toast timer IDs so we can clear them on removal
// and prevent unbounded setTimeout accumulation during bulk operations.
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

// FIX-5.1: debounce UPDATE_PROGRESS state updates to batch rapid events
// into a single React render. Accumulates updates for 100ms before flushing.
let progressBuffer: Record<string, UpdateProgress> = {};
let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<WatchWardenState>((set, get) => ({
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  // Primary auth uses httpOnly cookie set by the server.
  // authToken is a sentinel ("cookie") to track login state in the UI.
  // On fresh load we optimistically assume authenticated — the first
  // API call will 401 and call setAuthToken(null) if the cookie is absent/expired.
  authToken: localStorage.getItem('watchwarden_auth') ? 'cookie' : null,
  setAuthToken: (token) => {
    if (token) {
      localStorage.setItem('watchwarden_auth', '1');
    } else {
      localStorage.removeItem('watchwarden_auth');
    }
    set({ authToken: token ? 'cookie' : null });
  },

  agentStatuses: {},
  updateAgentStatus: (id, status) =>
    set((state) => ({
      agentStatuses: { ...state.agentStatuses, [id]: status },
    })),

  checkingAgents: new Set<string>(),
  setAgentChecking: (agentId, checking) =>
    set((state) => {
      const next = new Set(state.checkingAgents);
      if (checking) next.add(agentId);
      else next.delete(agentId);
      return { checkingAgents: next };
    }),

  updateProgress: {},
  setUpdateProgress: (key, progress) =>
    set((state) => ({
      updateProgress: { ...state.updateProgress, [key]: progress },
    })),
  clearUpdateProgress: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.updateProgress;
      return { updateProgress: rest };
    }),

  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-4), { ...toast, id }],
    }));
    // FIX-5.2: store timer ID so removeToast can clear it, preventing
    // timer accumulation when many toasts are added rapidly.
    const timer = setTimeout(() => get().removeToast(id), 4000);
    toastTimers.set(id, timer);
  },
  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  invalidateAgents: undefined,
  setInvalidateAgents: (fn) => set({ invalidateAgents: fn }),

  lastActionResult: null,

  handleWSEvent: (event) => {
    const type = event.type as string;
    const agentId = event.agentId as string | undefined;

    if (type === 'AGENT_STATUS' && agentId) {
      get().updateAgentStatus(agentId, {
        status: event.status as string,
        lastSeen: event.lastSeen as number,
      });
      get().invalidateAgents?.();
    }

    if (
      type === 'HEARTBEAT_RECEIVED' ||
      type === 'CHECK_COMPLETE' ||
      type === 'CONTAINERS_UPDATED'
    ) {
      get().invalidateAgents?.();
    }

    // On heartbeat, purge stale progress for this agent. A heartbeat means the
    // agent is idle; any progress entry older than 60 s was either completed
    // (UPDATE_COMPLETE missed during a disconnect) or orphaned by a crash.
    if (type === 'HEARTBEAT_RECEIVED' && agentId) {
      const staleThreshold = Date.now() - 60_000;
      const current = get().updateProgress;
      const next: Record<string, UpdateProgress> = {};
      for (const [key, val] of Object.entries(current)) {
        if (key.startsWith(`${agentId}:`) && val.timestamp < staleThreshold) continue;
        next[key] = val;
      }
      if (Object.keys(next).length !== Object.keys(current).length) {
        set({ updateProgress: next });
        for (const key of Object.keys(progressBuffer)) {
          if (key.startsWith(`${agentId}:`)) delete progressBuffer[key];
        }
      }
    }

    if (type === 'CHECK_COMPLETE' && agentId) {
      get().setAgentChecking(agentId, false);
      const updatesAvailable = (event.updatesAvailable as number) ?? 0;
      const failedChecks = (event.failedChecks as number) ?? 0;
      if (failedChecks > 0 && updatesAvailable === 0) {
        // Every reachable container failed — likely a network/DNS outage.
        get().addToast({
          type: 'error',
          message: `Check incomplete: ${failedChecks} container(s) could not be reached`,
        });
      } else if (failedChecks > 0) {
        // Mixed: some succeeded and found updates, some failed.
        get().addToast({
          type: 'info',
          message: `Check complete: ${updatesAvailable} update(s) available, ${failedChecks} check(s) failed`,
        });
      } else if (updatesAvailable > 0) {
        get().addToast({
          type: 'info',
          message: `Check complete: ${updatesAvailable} update(s) available`,
        });
      } else {
        get().addToast({
          type: 'success',
          message: 'Check complete: all containers up to date',
        });
      }
      get().invalidateAgents?.();
    }

    if (type === 'UPDATE_PROGRESS' && agentId) {
      // FIX-5.1: buffer progress updates and flush every 100ms to prevent
      // hundreds of individual Zustand set() calls per second during bulk updates.
      const containerId = event.containerId as string;
      const key = `${agentId}:${containerId}`;
      progressBuffer[key] = {
        step: event.step as string,
        containerName: event.containerName as string,
        progress: event.progress as string | undefined,
        timestamp: Date.now(),
      };
      if (!progressFlushTimer) {
        progressFlushTimer = setTimeout(() => {
          const batch = progressBuffer;
          progressBuffer = {};
          progressFlushTimer = null;
          set((state) => ({
            updateProgress: { ...state.updateProgress, ...batch },
          }));
        }, 100);
      }
    }

    if (type === 'UPDATE_COMPLETE' && agentId) {
      const results = event.results as Array<{
        containerId: string;
        originalContainerId?: string;
        success: boolean;
      }>;
      // FIX-5.3: only clear progress for containers listed in results, not all
      // containers for this agent. This prevents a concurrent update on container B
      // from losing its progress when container A's update completes first.
      // Use originalContainerId when present — UpdateContainer returns the NEW
      // container's Docker ID in containerId (needed for DB), but progress is
      // keyed by the original ID throughout the update lifecycle.
      const completedKeys = new Set(
        (results ?? []).map((r) => `${agentId}:${r.originalContainerId ?? r.containerId}`),
      );
      // Also clear any buffered progress for these containers
      for (const key of completedKeys) {
        delete progressBuffer[key];
      }
      const currentProgress = get().updateProgress;
      const cleared: Record<string, UpdateProgress> = {};
      for (const [key, val] of Object.entries(currentProgress)) {
        if (!completedKeys.has(key)) {
          cleared[key] = val;
        }
      }
      set({ updateProgress: cleared });
      const allSuccess = results?.every((r) => r.success) ?? false;
      get().addToast({
        type: allSuccess ? 'success' : 'error',
        message: `Update ${allSuccess ? 'complete' : 'failed'}: ${results?.length ?? 0} container(s)`,
      });
      get().invalidateAgents?.();
      // Delayed refetch to pick up container data from the post-update heartbeat
      setTimeout(() => get().invalidateAgents?.(), 2000);
      // Fallback: force-clear any remaining progress for this agent after 5 s.
      // The controller prevents concurrent updates per agent, so anything left
      // after the cleanup above is a stale entry (e.g. old agent without
      // originalContainerId) that the targeted clear couldn't match by ID.
      setTimeout(() => {
        const remaining = get().updateProgress;
        const next: Record<string, UpdateProgress> = {};
        for (const [key, val] of Object.entries(remaining)) {
          if (!key.startsWith(`${agentId}:`)) next[key] = val;
        }
        set({ updateProgress: next });
        // Also purge any buffered entries for this agent
        for (const key of Object.keys(progressBuffer)) {
          if (key.startsWith(`${agentId}:`)) delete progressBuffer[key];
        }
      }, 5000);
    }

    if (type === 'CONTAINER_ACTION_RESULT') {
      const containerId = event.containerId as string | undefined;
      const action = event.action as string | undefined;
      const success = event.success as boolean | undefined;
      if (containerId && action) {
        set({ lastActionResult: { containerId, action, success: success ?? false } });
      }
      // Refresh agent data so the container status updates in the UI
      get().invalidateAgents?.();
      setTimeout(() => get().invalidateAgents?.(), 1500);
    }
  },

  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  mobileSidebarOpen: false,
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),

  agentViewMode: (localStorage.getItem('watchwarden_view') as 'grid' | 'list') ?? 'grid',
  setAgentViewMode: (mode) => {
    localStorage.setItem('watchwarden_view', mode);
    set({ agentViewMode: mode });
  },

  theme: (localStorage.getItem('watchwarden_theme') as 'dark' | 'light') ?? 'dark',
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('watchwarden_theme', next);
      document.documentElement.classList.toggle('light', next === 'light');
      return { theme: next };
    }),
}));
