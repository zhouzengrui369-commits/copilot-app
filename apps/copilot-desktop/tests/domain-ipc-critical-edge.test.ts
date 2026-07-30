import { describe, expect, it, vi } from 'vitest';
import { registerDomainIpc } from '../src/main/domain-ipc.js';
import { DomainServiceError, type LocalKnowledgeService } from '../src/main/local-knowledge-service.js';
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js';

const TRASH_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_TRASH_ID = '223e4567-e89b-42d3-a456-426614174000';
const REVISION = 'trash:fixture:1';

type Handler = (event: unknown, payload?: unknown) => Promise<unknown> | unknown;

function entry(overrides: Record<string, unknown> = {}) {
  return {
    trashId: TRASH_ID,
    kind: 'note',
    title: ' Deleted note ',
    originalPath: 'notes/a',
    originalRevision: 'note:4',
    trashRevision: REVISION,
    state: 'trashed',
    movedAt: 10,
    restoredAt: null,
    purgedAt: null,
    cleanupAttempts: 1,
    ...overrides,
  };
}

function makeService() {
  const operation = (name: string) => vi.fn(async (request?: unknown) => ({ name, request }));
  const trashed = entry();
  const service = {
    notes: {
      list: operation('notes.list'),
      get: vi.fn(async (notePath: string) => notePath === 'notes/a'
        ? { note: { updatedAt: 4 }, body: 'body' }
        : null),
      create: operation('notes.create'),
      createWithBuild: operation('notes.createWithBuild'),
      update: operation('notes.update'),
      updateWithBuild: operation('notes.updateWithBuild'),
      remove: operation('notes.remove'),
      getBacklinks: operation('notes.getBacklinks'),
      moveToTrash: vi.fn(async () => trashed),
    },
    wiki: { getForNote: operation('wiki.getForNote') },
    kg: {
      getSubgraph: operation('kg.getSubgraph'),
      reindexNote: operation('kg.reindexNote'),
    },
    rag: {
      ask: operation('rag.ask'),
      stream: vi.fn(async function* () {
        yield {
          delta: 'delta',
          sourceDetails: [{ notePath: 'notes/a', score: 1, evidence: ['vector'] }],
        };
        return { text: 'answer', sources: ['notes/a'] };
      }),
    },
    todos: {
      list: vi.fn(async () => [
        { id: 'todo-1', updated_at: 9 },
        { id: 7, updated_at: 11 },
      ]),
      create: operation('todos.create'),
      update: operation('todos.update'),
      remove: operation('todos.remove'),
      listDue: operation('todos.listDue'),
      markReminderFired: operation('todos.markReminderFired'),
      moveToTrash: vi.fn(async ({ id }: { id: string | number }) => entry({
        kind: 'todo',
        title: id === 7 ? undefined : ' Todo ',
        originalPath: `system/todos/${id}`,
        trashId: id === 7 ? OTHER_TRASH_ID : TRASH_ID,
        trashRevision: id === 7 ? 'trash:fixture:2' : REVISION,
      })),
    },
    trash: {
      list: vi.fn(async () => [
        trashed,
        entry({
          trashId: OTHER_TRASH_ID,
          kind: 'todo',
          title: 'bad\u0000title',
          trashRevision: 'trash:fixture:2',
          state: 'cleanup_pending',
        }),
        entry({ trashId: '323e4567-e89b-42d3-a456-426614174000', state: 'restored' }),
        entry({ trashId: '423e4567-e89b-42d3-a456-426614174000', state: 'purged' }),
      ]),
      restore: vi.fn(async () => entry({ state: 'restored', restoredAt: 20 })),
      purge: vi.fn(async () => entry({ state: 'purged', purgedAt: 20 })),
    },
  };
  return service;
}

function register(service = makeService()) {
  const handlers = new Map<string, Handler>();
  const record = vi.fn(async () => undefined);
  registerDomainIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Handler) },
    async () => service as unknown as LocalKnowledgeService,
    record,
  );
  return { handlers, record, service };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('complete Domain IPC critical surface', () => {
  it('invokes synchronous build, WIKI and remaining generic handlers', async () => {
    const { handlers, service, record } = register();
    const mappings = [
      [IPC_CHANNELS.NOTES_CREATE_WITH_BUILD, service.notes.createWithBuild, { path: 'notes/a' }],
      [IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD, service.notes.updateWithBuild, { path: 'notes/a' }],
      [IPC_CHANNELS.WIKI_GET_FOR_NOTE, service.wiki.getForNote, 'notes/a'],
    ] as const;

    for (const [channel, method, payload] of mappings) {
      await expect(handlers.get(channel)!({}, payload)).resolves.toEqual({
        name: expect.any(String),
        request: payload,
      });
      expect(method).toHaveBeenCalledWith(payload);
    }
    expect(record).toHaveBeenCalledWith('notes.create');
    expect(record).toHaveBeenCalledWith('notes.update');
    expect(record).toHaveBeenCalledWith('kg.view');
  });

  it('emits the normal RAG delta and final terminal events', async () => {
    const { handlers } = register();
    const sent: Array<{ channel: string; value: unknown }> = [];
    const event = {
      sender: {
        send: (channel: string, value: unknown) => sent.push({ channel, value }),
      },
    };

    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!(event, {
      requestId: 'normal-final',
      question: 'question',
    })).resolves.toEqual({ requestId: 'normal-final', accepted: true });
    await settle();

    expect(sent).toEqual([
      {
        channel: IPC_CHANNELS.RAG_STREAM_EVENT,
        value: expect.objectContaining({ requestId: 'normal-final', type: 'delta', delta: 'delta' }),
      },
      {
        channel: IPC_CHANNELS.RAG_STREAM_EVENT,
        value: {
          requestId: 'normal-final',
          type: 'final',
          answer: { text: 'answer', sources: ['notes/a'] },
        },
      },
    ]);
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_CANCEL)!({}, 'normal-final'))
      .resolves.toEqual({ requestId: 'normal-final', cancelled: false });
  });

  it('moves notes and string/number Todos with canonical private mutations', async () => {
    const { handlers, service } = register();

    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_NOTE)!({}, { path: ' notes/a ' }))
      .resolves.toMatchObject({
        trashId: TRASH_ID,
        kind: 'note',
        title: 'Deleted note',
        revision: REVISION,
        state: 'trashed',
        recoveryRequired: false,
      });
    expect(service.notes.moveToTrash).toHaveBeenCalledWith({
      path: 'notes/a',
      expectedRevision: 'note:4',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });

    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_TODO)!({}, { id: ' todo-1 ' }))
      .resolves.toMatchObject({ kind: 'todo', title: 'Todo' });
    expect(service.todos.moveToTrash).toHaveBeenCalledWith({
      id: 'todo-1',
      expectedRevision: 'todo:9',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });

    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_TODO)!({}, { id: 7 }))
      .resolves.toMatchObject({ kind: 'todo', title: '已删除待办' });
    expect(service.todos.moveToTrash).toHaveBeenLastCalledWith({
      id: 7,
      expectedRevision: 'todo:11',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });

    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_NOTE)!({}, { path: 'missing' }))
      .rejects.toThrow('[NOT_FOUND] local item was not found');
    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_TODO)!({}, { id: 'missing' }))
      .rejects.toThrow('[NOT_FOUND] local item was not found');
  });

  it('lists only live trash and performs eligible restore and purge operations', async () => {
    const { handlers, service } = register();

    await expect(handlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined)).resolves.toEqual([
      expect.objectContaining({
        trashId: TRASH_ID,
        state: 'trashed',
        recoveryRequired: false,
      }),
      expect.objectContaining({
        trashId: OTHER_TRASH_ID,
        title: '已删除待办',
        state: 'cleanup_pending',
        recoveryRequired: true,
      }),
    ]);

    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
      trashId: TRASH_ID,
      revision: REVISION,
    })).resolves.toMatchObject({ state: 'restored' });
    expect(service.trash.restore).toHaveBeenCalledWith({
      trashId: TRASH_ID,
      expectedRevision: REVISION,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });

    await expect(handlers.get(IPC_CHANNELS.TRASH_PURGE)!({}, {
      trashId: TRASH_ID,
      revision: REVISION,
      confirmed: true,
    })).resolves.toMatchObject({ state: 'purged' });
    expect(service.trash.purge).toHaveBeenCalledWith({
      trashId: TRASH_ID,
      expectedRevision: REVISION,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
  });

  it('rejects every malformed trash payload before a destructive port call', async () => {
    const { handlers, service } = register();
    const longPath = 'x'.repeat(501);
    const longTodo = 'x'.repeat(161);
    const longRevision = `trash:${'x'.repeat(195)}`;
    const cases: Array<[string, unknown]> = [
      [IPC_CHANNELS.TRASH_MOVE_NOTE, null],
      [IPC_CHANNELS.TRASH_MOVE_NOTE, []],
      [IPC_CHANNELS.TRASH_MOVE_NOTE, {}],
      [IPC_CHANNELS.TRASH_MOVE_NOTE, { path: '', extra: true }],
      [IPC_CHANNELS.TRASH_MOVE_NOTE, { path: longPath }],
      [IPC_CHANNELS.TRASH_MOVE_NOTE, { path: 'bad\u0000path' }],
      [IPC_CHANNELS.TRASH_MOVE_TODO, { id: '' }],
      [IPC_CHANNELS.TRASH_MOVE_TODO, { id: longTodo }],
      [IPC_CHANNELS.TRASH_MOVE_TODO, { id: 'bad\u0000id' }],
      [IPC_CHANNELS.TRASH_MOVE_TODO, { id: Number.NaN }],
      [IPC_CHANNELS.TRASH_MOVE_TODO, { id: 1.5 }],
      [IPC_CHANNELS.TRASH_LIST, {}],
      [IPC_CHANNELS.TRASH_RESTORE, { trashId: 'not-a-uuid', revision: REVISION }],
      [IPC_CHANNELS.TRASH_RESTORE, { trashId: TRASH_ID, revision: 'note:1' }],
      [IPC_CHANNELS.TRASH_RESTORE, { trashId: TRASH_ID, revision: longRevision }],
      [IPC_CHANNELS.TRASH_RESTORE, { trashId: TRASH_ID, revision: 'trash:x', extra: true }],
      [IPC_CHANNELS.TRASH_PURGE, { trashId: TRASH_ID, revision: REVISION, confirmed: false }],
      [IPC_CHANNELS.TRASH_PURGE, { trashId: TRASH_ID, revision: REVISION }],
    ];

    for (const [channel, payload] of cases) {
      await expect(handlers.get(channel)!({}, payload)).rejects.toThrow('[INVALID_ARGUMENT]');
    }
    expect(service.notes.moveToTrash).not.toHaveBeenCalled();
    expect(service.todos.moveToTrash).not.toHaveBeenCalled();
    expect(service.trash.restore).not.toHaveBeenCalled();
    expect(service.trash.purge).not.toHaveBeenCalled();
  });

  it('fails closed for missing, stale and recovery-pending trash entries', async () => {
    const service = makeService();
    const { handlers } = register(service);

    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
      trashId: '323e4567-e89b-42d3-a456-426614174000',
      revision: 'trash:missing',
    })).rejects.toThrow('[NOT_FOUND] local trash item was not found');

    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
      trashId: TRASH_ID,
      revision: 'trash:stale',
    })).rejects.toThrow('[INVALID_ARGUMENT] trash item changed; refresh and retry');

    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
      trashId: OTHER_TRASH_ID,
      revision: 'trash:fixture:2',
    })).rejects.toThrow('[INVALID_ARGUMENT] trash item is not eligible while recovery is pending');
  });

  it('curates an underlying unknown trash failure without exposing details', async () => {
    const service = makeService();
    service.trash.list.mockRejectedValueOnce(new Error('private sqlite path'));
    const { handlers } = register(service);

    await expect(handlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined))
      .rejects.toThrow('[INTERNAL] local knowledge request failed');
  });
});
