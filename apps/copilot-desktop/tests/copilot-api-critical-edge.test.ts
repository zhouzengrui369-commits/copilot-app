import { describe, expect, it, vi } from 'vitest';
import { resolveCopilotProductApi } from '../src/renderer/lib/copilot-api.js';

function todo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'todo-1',
    title: 'Todo',
    body: '',
    due_at_ms: null,
    remind_at_ms: null,
    status: 'pending',
    priority: 'normal',
    note_links: [],
    reminder_fired: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function bridge() {
  const trashItem = {
    trashId: '123e4567-e89b-42d3-a456-426614174000',
    kind: 'note',
    title: 'Deleted',
    revision: 'trash:1',
    state: 'trashed',
    movedAt: 1,
    recoveryRequired: false,
  };
  return {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async () => ({ path: 'notes/a', title: 'A', tags: [], related: [], updatedAt: 1 })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({})),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => todo()),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => todo({ reminder_fired: 1 })),
    },
    trash: {
      moveNote: vi.fn(async () => trashItem),
      moveTodo: vi.fn(async () => ({ ...trashItem, kind: 'todo' })),
      list: vi.fn(async () => [trashItem]),
      restore: vi.fn(async () => ({ ...trashItem, state: 'restored' })),
      purge: vi.fn(async () => ({ ...trashItem, state: 'purged' })),
    },
  };
}

describe('Copilot product API remaining critical wrappers', () => {
  it('maps reminder success and null receipts without leaking persistence fields', async () => {
    const source = bridge();
    const resolution = resolveCopilotProductApi(source);
    expect(resolution.error).toBeNull();
    const api = resolution.api!;

    await expect(api.todos.markReminderFired('todo-1')).resolves.toMatchObject({
      id: 'todo-1',
      title: 'Todo',
      status: 'pending',
    });
    expect(source.todos.markReminderFired).toHaveBeenCalledWith('todo-1');

    source.todos.markReminderFired.mockResolvedValueOnce(null as never);
    await expect(api.todos.markReminderFired('missing')).resolves.toBeNull();
  });

  it('forwards every reversible Trash operation through the narrow optional bridge', async () => {
    const source = bridge();
    const api = resolveCopilotProductApi(source).api!;
    expect(api.trash).toBeDefined();

    await expect(api.trash!.moveNote('notes/a')).resolves.toMatchObject({ kind: 'note' });
    await expect(api.trash!.moveTodo(7)).resolves.toMatchObject({ kind: 'todo' });
    await expect(api.trash!.list()).resolves.toHaveLength(1);
    await expect(api.trash!.restore({ trashId: 't', revision: 'r' }))
      .resolves.toMatchObject({ state: 'restored' });
    await expect(api.trash!.purge({ trashId: 't', revision: 'r', confirmed: true }))
      .resolves.toMatchObject({ state: 'purged' });

    expect(source.trash.moveNote).toHaveBeenCalledWith('notes/a');
    expect(source.trash.moveTodo).toHaveBeenCalledWith(7);
    expect(source.trash.list).toHaveBeenCalledWith();
    expect(source.trash.restore).toHaveBeenCalledWith({ trashId: 't', revision: 'r' });
    expect(source.trash.purge).toHaveBeenCalledWith({
      trashId: 't',
      revision: 'r',
      confirmed: true,
    });
  });
});
