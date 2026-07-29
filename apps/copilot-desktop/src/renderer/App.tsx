import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { useSettingsStore } from './stores/settings.js';
import { resolveCopilotProductApi } from './lib/copilot-api.js';
import { WorkspaceState } from './workspaces/WorkspaceState.js';
import type { StartupView } from './startup-shell.js';
import { RemoteApprovalModal } from './components/RemoteManagement/RemoteApprovalModal.js';
import { GlobalAssistant } from './components/Assistant/GlobalAssistant.js';
import type {
  AssistantDock,
  GlobalAssistantContext,
} from './components/Assistant/types.js';
import './styles/demo-first-prototype.css';
import './styles/demo-source-v4.css';

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

const NAV: ReadonlyArray<{ id: View; label: string; href: string }> = [
  { id: 'schedule', label: '今天', href: '#today' },
  { id: 'knowledge', label: '知识', href: '#knowledge' },
  { id: 'ask', label: '对话', href: '#conversations' },
  { id: 'settings', label: '设置', href: '#settings' },
];

const VIEW_HASH: Readonly<Record<View, string>> = {
  schedule: '#today',
  knowledge: '#knowledge',
  ask: '#conversations',
  voice: '#voice',
  settings: '#settings',
};

function defaultAssistantContext(view: View): GlobalAssistantContext {
  switch (view) {
    case 'schedule':
      return { route: view, subtitle: '今天 · 当前日期', truth: 'NOT_PROBED' };
    case 'knowledge':
      return { route: view, subtitle: '知识 · 当前文件夹', truth: 'NOT_PROBED' };
    case 'ask':
      return { route: view, subtitle: '对话 · 当前会话', truth: 'NOT_PROBED' };
    case 'voice':
      return { route: view, subtitle: '语音 · 本地录入', truth: 'NOT_PROBED' };
    case 'settings':
      return { route: view, subtitle: '设置 · 模型与 AI', truth: 'NOT_PROBED' };
  }
}

function sanitizeAssistantContext(
  context: GlobalAssistantContext,
): GlobalAssistantContext {
  const shared = {
    route: context.route,
    subtitle: context.subtitle,
    truth: context.truth,
  };
  switch (context.route) {
    case 'schedule':
      return {
        ...shared,
        sourceCount: context.sourceCount,
        selectedDate: context.selectedDate,
        todoCount: context.todoCount,
        notePath: context.notePath,
      };
    case 'knowledge':
      return {
        ...shared,
        sourceCount: context.sourceCount,
        folderPath: context.folderPath,
        documentPath: context.documentPath,
        wikiTruth: context.wikiTruth,
      };
    case 'ask':
    case 'voice':
    case 'settings':
      return shared;
  }
}

export function App({
  routeLoader = defaultRouteLoader,
  initialView = 'schedule',
}: {
  routeLoader?: RouteLoader;
  initialView?: View;
}) {
  const prototypeRuntime = typeof window === 'undefined'
    ? undefined
    : window.__COPILOT_BROWSER_PROTOTYPE__;
  const prototypeView = (() => {
    if (!prototypeRuntime || typeof window === 'undefined') return initialView;
    switch (window.location.hash) {
      case '#knowledge':
        return 'knowledge';
      case '#conversations':
        return 'ask';
      case '#settings':
        return 'settings';
      default:
        return 'schedule';
    }
  })();
  const [view, setView] = useState<View>(prototypeView);
  const activeViewRef = useRef<View>(prototypeView);
  const [requestedNotePath, setRequestedNotePath] = useState<string | null>(null);
  const [captureDraft, setCaptureDraft] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDock, setAssistantDock] = useState<AssistantDock>('right');
  const [assistantContext, setAssistantContext] = useState<GlobalAssistantContext>(
    () => defaultAssistantContext(prototypeView),
  );
  const hydrate = useSettingsStore((state) => state.hydrate);
  const theme = useSettingsStore((state) => state.theme);
  const product = useMemo(
    () => prototypeRuntime
      ? { api: prototypeRuntime.api, error: null }
      : resolveCopilotProductApi(),
    [prototypeRuntime],
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const meta = typeof window !== 'undefined' ? window.copilot?.meta : undefined;

  const navigateTo = useCallback((nextView: View) => {
    if (prototypeRuntime && typeof window !== 'undefined') {
      window.history.replaceState(null, '', VIEW_HASH[nextView]);
    }
    activeViewRef.current = nextView;
    setAssistantContext(defaultAssistantContext(nextView));
    setView(nextView);
  }, [prototypeRuntime]);

  const handleAssistantContextChange = useCallback(
    (nextContext: GlobalAssistantContext) => {
      if (nextContext.route !== activeViewRef.current) return;
      setAssistantContext(sanitizeAssistantContext(nextContext));
    },
    [],
  );

  const openNote = (path: string) => {
    setRequestedNotePath(path);
    navigateTo('knowledge');
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
        return {
          api: product.api,
          requestedPath: requestedNotePath,
          onOpenAsk: () => navigateTo('ask'),
          onAssistantContextChange: handleAssistantContextChange,
        };
      case 'ask':
        return { api: product.api, onOpenSource: openNote };
      case 'voice':
        return { api: product.api };
      case 'schedule':
        return {
          api: product.api,
          onOpenNote: openNote,
          onOpenKnowledge: () => navigateTo('knowledge'),
          onOpenAsk: () => navigateTo('ask'),
          captureDraft,
          onCaptureDraftChange: setCaptureDraft,
          onAssistantContextChange: handleAssistantContextChange,
        };
      case 'settings':
        return {};
    }
  }, [
    captureDraft,
    handleAssistantContextChange,
    navigateTo,
    product.api,
    requestedNotePath,
    view,
  ]);
  const canRenderRoute = view === 'settings' || product.api !== null;

  return (
    <div
      className="demo-first-app demo-source-shell shell"
      data-testid="app-root"
      data-theme={theme}
      data-active-view={view}
      data-assistant-open={assistantOpen}
      data-assistant-dock={assistantDock}
      aria-label="Copilot App MVP"
    >
      <RemoteApprovalModal />
      <header className="titlebar">
        <span className="traffic" aria-hidden="true"><i /><i /><i /></span>
        <span className="brand">Copilot</span>
        <span className="subtitle">v6.2 · local-first personal copilot</span>
        <span className="spacer" />
        <div className="candidate-identity" data-testid="current-candidate-identity">
          <span className="badge unknown">CURRENT SOURCE PREVIEW</span>
          <span className="candidate-meta">
            {prototypeRuntime
              ? `browser fixture · ${prototypeRuntime.scenario}`
              : `${meta?.productName ?? 'product-unavailable'} · ${meta?.appVersion ?? 'version-unavailable'} · ${meta?.platform ?? 'platform-unavailable'}`}
          </span>
          <span className="badge unknown" data-testid="current-candidate-state">MVP_NOT_COMPLETE</span>
        </div>
      </header>

      <nav className="nav" aria-label="主导航">
        {NAV.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={view === item.id ? 'page' : undefined}
            data-testid={'nav-' + item.id}
            onClick={(event) => {
              event.preventDefault();
              navigateTo(item.id);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <section className="decision-strip" aria-label="运行状态" data-testid="runtime-truth-strip">
        <div className="decision-main">
          <span className="badge unknown">{prototypeRuntime ? 'PROTOTYPE' : 'NOT_PROBED'}</span>
          <div>
            <strong>{prototypeRuntime ? '浏览器 Fixture 验收环境' : '今天是默认工作台'}</strong><br />
            <span>{prototypeRuntime
              ? '同源 renderer；数据仅在页面内存中，用于交互验收。'
              : '先看日程与当天知识，再记录、检索和应用知识。'}</span>
          </div>
        </div>
        <div className="decision-risk" data-testid="prototype-truth-label">
          <strong>状态：</strong>{prototypeRuntime
            ? `NOT_RUNTIME_PROOF · ${prototypeRuntime.scenario.toUpperCase()} FIXTURE`
            : '未接通的能力会明确标示'}
        </div>
        <span className="badge unknown">{prototypeRuntime ? 'NOT_PROBED' : 'MVP_NOT_COMPLETE'}</span>
      </section>

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

      <footer className="statusbar source-drawer">
        <span data-testid="status-product-api">
          {prototypeRuntime
            ? 'Fixture adapter: PROTOTYPE · NOT_RUNTIME_PROOF'
            : `Local API: ${product.api ? 'PRESENT · HEALTH NOT_PROBED' : 'OFFLINE'}`}
        </span>
        <span>ASR: APP-EMBEDDED / NOT_READY</span>
        <span data-testid="status-cloud-backup">Cloud backup: OFF / POST-MVP</span>
        <span data-testid="status-theme">Theme: {theme}</span>
        <span>Platform: {meta?.platform ?? 'browser'}</span>
      </footer>
      <GlobalAssistant
        context={assistantContext}
        onOpenAsk={() => navigateTo('ask')}
        onOpenChange={setAssistantOpen}
        onDockChange={setAssistantDock}
      />
    </div>
  );
}
