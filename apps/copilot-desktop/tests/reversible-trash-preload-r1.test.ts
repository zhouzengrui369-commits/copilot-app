import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true })),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
  },
}));

describe('reversible Trash preload bridge r1', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exposes only the exact intent API and routes exact schemas', async () => {
    await import('../src/main/preload.js');
    const bridge = electron.expose.mock.calls[0]?.[1] as {
      trash: Record<string, (...args: any[]) => Promise<unknown>>;
    };
    expect(Object.keys(bridge.trash).sort()).toEqual(['list', 'moveNote', 'moveTodo', 'purge', 'restore']);

    await bridge.trash.moveNote('inbox/a');
    await bridge.trash.moveTodo('todo-1');
    await bridge.trash.list();
    await bridge.trash.restore({ trashId: 'id', revision: 'trash:id:1' });
    await bridge.trash.purge({ trashId: 'id', revision: 'trash:id:1', confirmed: true });

    expect(electron.invoke.mock.calls).toEqual(expect.arrayContaining([
      ['copilot:trash:move-note', { path: 'inbox/a' }],
      ['copilot:trash:move-todo', { id: 'todo-1' }],
      ['copilot:trash:list', undefined],
      ['copilot:trash:restore', { trashId: 'id', revision: 'trash:id:1' }],
      ['copilot:trash:purge', { trashId: 'id', revision: 'trash:id:1', confirmed: true }],
    ]));
  });
});
