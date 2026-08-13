import {
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import './styles/demo-first-prototype.css';

export type StartupView = 'knowledge' | 'studio' | 'ask' | 'voice' | 'schedule' | 'settings';

const STARTUP_NAV: ReadonlyArray<{ id: StartupView; label: string }> = [
  { id: 'schedule', label: '今天' },
  { id: 'knowledge', label: '知识' },
  { id: 'ask', label: '对话' },
  { id: 'settings', label: '设置' },
];

interface StartupShellProps {
  selectedView: StartupView;
  onSelect(view: StartupView): void;
}

export function StartupShell({ selectedView, onSelect }: StartupShellProps) {
  return (
    <div className="app demo-first-app" data-testid="app-root" aria-busy="true">
      <header className="app__titlebar">
        <div className="app__brandline">
          <h1>Copilot</h1>
          <span className="app__subtitle">v6.2 · local-first personal copilot</span>
        </div>
        <span className="truth-chip truth-chip--unknown">本地优先 · 正在启动</span>
      </header>
      <nav className="app__nav" aria-label="Primary">
        {STARTUP_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app__nav-item${selectedView === item.id ? ' is-active' : ''}`}
            aria-current={selectedView === item.id ? 'page' : undefined}
            data-testid={`startup-nav-${item.id}`}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelect(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <section className="app__runtime-strip" aria-label="运行状态">
        <div><strong>正在读取本地工作区</strong><span>加载完成前不声明健康状态</span></div>
        <span className="truth-chip truth-chip--checking">CHECKING</span>
      </section>
      <main className="app__main" data-testid={`startup-view-${selectedView}`}>
        <section data-testid="workspace-loading" role="status" aria-live="polite">
          正在加载工作区…
        </section>
      </main>
      <footer className="app__statusbar">
        <span>本地优先</span>
        <span>正在读取持久化设置…</span>
      </footer>
    </div>
  );
}

type AppComponent = ComponentType<{ initialView?: StartupView }>;

export function StartupAppBoundary({
  loadApp,
}: {
  loadApp: () => Promise<{ default: AppComponent }>;
}) {
  const [selectedView, setSelectedView] = useState<StartupView>('schedule');
  const LazyApp = useMemo(() => lazy(loadApp), [loadApp]);
  return (
    <Suspense fallback={(
      <StartupShell selectedView={selectedView} onSelect={setSelectedView} />
    )}>
      <LazyApp initialView={selectedView} />
    </Suspense>
  );
}
