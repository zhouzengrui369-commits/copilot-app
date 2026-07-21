import {
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
} from 'react';

export type StartupView = 'knowledge' | 'ask' | 'voice' | 'schedule' | 'settings';

const STARTUP_NAV: ReadonlyArray<{ id: StartupView; label: string }> = [
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'ask', label: 'Ask' },
  { id: 'voice', label: 'Voice' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

interface StartupShellProps {
  selectedView: StartupView;
  onSelect(view: StartupView): void;
}

export function StartupShell({ selectedView, onSelect }: StartupShellProps) {
  return (
    <div className="app" data-testid="app-root" aria-busy="true">
      <header className="app__titlebar">
        <h1>njx-copilot-v6</h1>
        <span className="app__subtitle">v6.2 · local-first personal copilot</span>
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
      <main className="app__main" data-testid={`startup-view-${selectedView}`}>
        <section data-testid="workspace-loading" role="status" aria-live="polite">
          正在加载工作区…
        </section>
      </main>
      <footer className="app__statusbar">
        <span>Local-first shell</span>
        <span>Loading persisted settings…</span>
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
  const [selectedView, setSelectedView] = useState<StartupView>('knowledge');
  const LazyApp = useMemo(() => lazy(loadApp), [loadApp]);
  return (
    <Suspense fallback={(
      <StartupShell selectedView={selectedView} onSelect={setSelectedView} />
    )}>
      <LazyApp initialView={selectedView} />
    </Suspense>
  );
}
