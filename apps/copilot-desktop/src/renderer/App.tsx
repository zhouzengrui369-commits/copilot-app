import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { useSettingsStore } from './stores/settings.js';
import { resolveCopilotProductApi } from './lib/copilot-api.js';
import { WorkspaceState } from './workspaces/WorkspaceState.js';
import { CLOUD_BACKUP_CAPABILITY } from '../shared/product-capabilities.js';
import type { StartupView } from './startup-shell.js';
import { RemoteApprovalModal } from './components/RemoteManagement/RemoteApprovalModal.js';

type View = StartupView;
type RouteModule = { default: ComponentType<Record<string, unknown>> };
export type RouteLoader = (route: View) => Promise<RouteModule>;

export const defaultRouteLoader: RouteLoader = (route) => {
  switch (route) {
    case 'knowledge':
      return import('./workspaces/KnowledgeWorkspace.js').then((module) => ({
        default: module.KnowledgeWorkspace as unknown as ComponentType<Record<string, unknown>>,
      }));
    case 'ask':
      return import('./workspaces/AskWorkspace.js').then((module) => ({
        default: module.AskWorkspace as unknown as ComponentType<Record<string, unknown>>,
      }));
    case 'voice':
      return import('./workspaces/VoiceWorkspace.js').then((module) => ({
        default: module.VoiceWorkspace as unknown as ComponentType<Record<string, unknown>>,
      }));
    case 'schedule':
      return import('./workspaces/ScheduleWorkspace.js').then((module) => ({
        default: module.ScheduleWorkspace as unknown as ComponentType<Record<string, unknown>>,
      }));
    case 'settings':
      return import('./components/SettingsPanel.js').then((module) => ({
        default: module.SettingsPanel as ComponentType<Record<string, unknown>>,
      }));
  }
};

const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'ask', label: 'Ask' },
  { id: 'voice', label: 'Voice' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

export function App({
  routeLoader = defaultRouteLoader,
  initialView = 'knowledge',
}: {
  routeLoader?: RouteLoader;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [requestedNotePath, setRequestedNotePath] = useState<string | null>(null);
  const hydrate = useSettingsStore((state) => state.hydrate);
  const theme = useSettingsStore((state) => state.theme);
  const product = useMemo(() => resolveCopilotProductApi(), []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const meta = typeof window !== 'undefined' ? window.copilot?.meta : undefined;

  const openNote = (path: string) => {
    setRequestedNotePath(path);
    setView('knowledge');
  };

  const unavailable = product.api === null ? (
    <WorkspaceState
      kind="offline"
      title="本地能力暂不可用"
      detail={product.error ?? '请重启桌面 App 后重试。'}
    />
  ) : null;
  const ActiveRoute = useMemo(
    () => lazy(() => routeLoader(view)),
    [routeLoader, view],
  );
  const routeProps = useMemo<Record<string, unknown>>(() => {
    switch (view) {
      case 'knowledge':
        return { api: product.api, requestedPath: requestedNotePath };
      case 'ask':
        return { api: product.api, onOpenSource: openNote };
      case 'voice':
        return { api: product.api };
      case 'schedule':
        return { api: product.api, onOpenNote: openNote };
      case 'settings':
        return {};
    }
  }, [product.api, requestedNotePath, view]);
  const canRenderRoute = view === 'settings' || product.api !== null;

  return (
    <div className="app" data-testid="app-root" data-theme={theme}>
      <RemoteApprovalModal />
      <header className="app__titlebar">
        <h1>njx-copilot-v6</h1>
        <span className="app__subtitle">v6.2 · local-first personal copilot</span>
      </header>

      <nav className="app__nav" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app__nav-item${view === item.id ? ' is-active' : ''}`}
            aria-current={view === item.id ? 'page' : undefined}
            data-testid={`nav-${item.id}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="app__main" data-testid={`view-${view}`}>
        {view !== 'settings' && unavailable}
        {canRenderRoute ? (
          <Suspense fallback={(
            <section
              className="workspace-state workspace-state--loading"
              data-testid="workspace-loading"
              role="status"
              aria-live="polite"
              aria-label="Loading workspace"
            >
              <strong>正在加载工作区…</strong>
            </section>
          )}>
            <ActiveRoute {...routeProps} />
          </Suspense>
        ) : null}
      </main>

      <footer className="app__statusbar">
        <span data-testid="status-cloud-backup">
          Cloud backup: {CLOUD_BACKUP_CAPABILITY.available
            ? 'AVAILABLE'
            : `UNAVAILABLE (${CLOUD_BACKUP_CAPABILITY.mode})`}
        </span>
        <span data-testid="status-theme">Theme: {theme}</span>
        <span>Platform: {meta?.platform ?? 'browser'}</span>
        <span data-testid="status-product-api">Local API: {product.api ? 'connected' : 'offline'}</span>
      </footer>
    </div>
  );
}
