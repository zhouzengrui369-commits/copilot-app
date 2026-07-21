import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    expose: vi.fn(),
    invoke: vi.fn(() => Promise.resolve({ ok: true })),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
    }),
    removeListener: vi.fn(),
    send: vi.fn(),
    listeners,
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
  },
}));

type AsyncMethod = (...args: unknown[]) => Promise<unknown>;
type MethodGroup = Record<string, AsyncMethod>;

interface ExposedBridge {
  settings: MethodGroup;
  window: MethodGroup;
  startup: {
    getMilestones: AsyncMethod;
    appRootVisible(): void;
    isComplete(): boolean;
  };
  notes: MethodGroup;
  kg: MethodGroup;
  rag: MethodGroup & {
    onStreamEvent(listener: (event: unknown) => void): () => void;
  };
  todos: MethodGroup;
}

describe('preload domain bridge behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    electron.expose.mockClear();
    electron.invoke.mockClear();
    electron.on.mockClear();
    electron.removeListener.mockClear();
    electron.send.mockClear();
    electron.listeners.clear();
  });

  it('routes every public bridge operation and owns listener lifecycle', async () => {
    await import('../src/main/preload.js');
    const bridge = electron.expose.mock.calls[0]?.[1] as ExposedBridge;

    await bridge.settings.get();
    await bridge.settings.setCloudBackup(true);
    await bridge.settings.setTheme('dark');
    await bridge.settings.setWindowBounds({ x: 1, y: 2, width: 800, height: 600 });
    await bridge.settings.setShortcuts([{ id: 'quick-note', accelerator: 'Cmd+N' }]);
    await bridge.settings.setModelApi({ provider: 'minimax', baseUrl: 'http://127.0.0.1', model: 'm', apiKey: '' });
    await bridge.settings.reset();

    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.close();

    await bridge.startup.getMilestones();
    bridge.startup.appRootVisible();
    expect(bridge.startup.isComplete()).toBe(false);
    electron.listeners.get('copilot:startup:complete')?.({});
    expect(bridge.startup.isComplete()).toBe(true);

    await bridge.notes.list({ limit: 2 });
    await bridge.notes.get('notes/a');
    await bridge.notes.create({ path: 'notes/a' });
    await bridge.notes.update({ path: 'notes/a', patch: { title: 'A' } });
    await bridge.notes.remove('notes/a');
    await bridge.notes.getBacklinks('notes/a');
    await bridge.kg.getSubgraph({ center: 'person:a' });
    await bridge.kg.reindexNote('notes/a');
    await bridge.rag.ask('question');
    await bridge.rag.startStream({ question: 'question', requestId: 'r1' });
    await bridge.rag.cancelStream('r1');

    const streamListener = vi.fn();
    const unsubscribe = bridge.rag.onStreamEvent(streamListener);
    const streamWrapper = electron.listeners.get('copilot:rag:stream-event');
    streamWrapper?.({}, { type: 'delta', requestId: 'r1', delta: 'x' });
    expect(streamListener).toHaveBeenCalledWith({ type: 'delta', requestId: 'r1', delta: 'x' });
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith('copilot:rag:stream-event', streamWrapper);

    await bridge.todos.list({ status: 'pending' });
    await bridge.todos.create({ title: 'Todo' });
    await bridge.todos.update({ id: 't1', patch: { status: 'done' } });
    await bridge.todos.remove('t1');
    await bridge.todos.listDue(123);
    await bridge.todos.markReminderFired('t1');

    expect(electron.invoke).toHaveBeenCalledTimes(28);
    expect(electron.invoke).toHaveBeenCalledWith('copilot:settings:set-window-bounds', {
      x: 1, y: 2, width: 800, height: 600,
    });
    expect(electron.invoke).toHaveBeenCalledWith('copilot:notes:get', 'notes/a');
    expect(electron.invoke).toHaveBeenCalledWith('copilot:kg:reindex-note', 'notes/a');
    expect(electron.invoke).toHaveBeenCalledWith('copilot:todos:list-due', 123);
    expect(electron.send).toHaveBeenCalledWith('copilot:startup:app-root-visible');
  });
});
