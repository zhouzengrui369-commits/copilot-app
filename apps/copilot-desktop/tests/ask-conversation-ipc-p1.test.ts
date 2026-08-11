import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TodoRecord } from '../src/shared/domain-api.js';
import { registerAskConversationIpc } from '../src/main/ask-conversation-ipc.js';
import type { StoredAskConversationSnapshot } from '../src/main/ask-conversation-store.js';

function note(body = 'source bytes', updatedAt = 10) {
  return {
    note: {
      id: 1,
      path: 'notes/source.md',
      title: 'Source',
      type: 'note' as const,
      status: 'active' as const,
      tags: [],
      related: [],
      folder: 'notes',
      createdAt: 1,
      updatedAt,
      confidence: null,
      agent: null,
    },
    body,
  };
}

function todo(): TodoRecord {
  return {
    id: 'todo-1',
    title: 'Todo',
    body: '本地回答',
    due_at_ms: null,
    remind_at_ms: null,
    status: 'pending',
    priority: 'normal',
    note_links: ['notes/source.md'],
    reminder_fired: 0,
    created_at: 30,
    updated_at: 30,
  };
}

function request(todoReceipt: TodoRecord | null = null) {
  return {
    exchangeId: 'exchange-1',
    phase: 'completed' as const,
    question: '本地问题',
    answer: {
      text: '本地回答',
      sources: ['notes/source.md'],
      sourceDetails: [{
        notePath: 'notes/source.md',
        evidence: ['vector' as const],
        score: 0.9,
      }],
    },
    todoReceipt,
    completedAt: 20,
  };
}

describe('ask conversation IPC', () => {
  it('binds sources and canonical Todo in main, then downgrades changed sources on load', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    let saved: StoredAskConversationSnapshot | null = null;
    const store = {
      save: vi.fn(async (value: StoredAskConversationSnapshot) => { saved = value; }),
      load: vi.fn(async () => saved),
      clear: vi.fn(async () => undefined),
    };
    let current = note();
    let canonicalTodos = [todo()];
    const service = {
      notes: { get: vi.fn(async () => current) },
      todos: { list: vi.fn(async () => canonicalTodos) },
    };
    registerAskConversationIpc(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      () => store,
      async () => service as never,
    );

    const save = handlers.get('copilot:ask-conversation:save');
    const load = handlers.get('copilot:ask-conversation:load');
    expect(save).toBeTypeOf('function');
    expect(load).toBeTypeOf('function');

    const savedReceipt = await save?.({}, request(todo()));
    expect(savedReceipt).toMatchObject({
      exchangeId: 'exchange-1',
      sourceTruth: 'current',
      todoReceipt: { id: 'todo-1' },
    });
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      sourceBindings: [{
        notePath: 'notes/source.md',
        updatedAt: 10,
        bodyDigest: createHash('sha256').update('source bytes').digest('hex'),
      }],
    }));

    current = note('changed bytes', 11);
    await expect(load?.({})).resolves.toMatchObject({
      exchangeId: 'exchange-1',
      sourceTruth: 'stale',
      todoReceipt: null,
    });

    current = note();
    canonicalTodos = [];
    await expect(load?.({})).resolves.toMatchObject({
      exchangeId: 'exchange-1',
      sourceTruth: 'current',
      todoReceipt: null,
    });
  });

  it('rejects streaming, zero-source, missing source, and mismatched Todo without persisting', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const store = { save: vi.fn(), load: vi.fn(), clear: vi.fn() };
    const service = {
      notes: { get: vi.fn(async () => null) },
      todos: { list: vi.fn(async () => []) },
    };
    registerAskConversationIpc(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      () => store,
      async () => service as never,
    );
    const save = handlers.get('copilot:ask-conversation:save');

    await expect(save?.({}, { ...request(), phase: 'streaming' })).rejects.toThrow('ASK_CONVERSATION_INVALID');
    await expect(save?.({}, {
      ...request(),
      answer: { text: 'x', sources: [], sourceDetails: [] },
    })).rejects.toThrow('ASK_CONVERSATION_INVALID');
    await expect(save?.({}, request())).rejects.toThrow('ASK_CONVERSATION_SOURCE_INVALID');
    await expect(save?.({}, request(todo()))).rejects.toThrow();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('serializes old save, clear, new save, and load strictly by invocation order', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const oldSave = deferred<void>();
    const oldSaveStarted = deferred<void>();
    const order: string[] = [];
    let stored: StoredAskConversationSnapshot | null = null;
    const store = {
      save: vi.fn(async (value: StoredAskConversationSnapshot) => {
        order.push(`save:${value.exchangeId}:start`);
        if (value.exchangeId === 'old') {
          oldSaveStarted.resolve(undefined);
          await oldSave.promise;
        }
        stored = value;
        order.push(`save:${value.exchangeId}:end`);
      }),
      load: vi.fn(async () => {
        order.push('load');
        return stored;
      }),
      clear: vi.fn(async () => {
        order.push('clear');
        stored = null;
      }),
    };
    const service = {
      notes: { get: vi.fn(async () => note()) },
      todos: { list: vi.fn(async () => []) },
    };
    registerAskConversationIpc(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      () => store,
      async () => service as never,
    );
    const save = handlers.get('copilot:ask-conversation:save')!;
    const clear = handlers.get('copilot:ask-conversation:clear')!;
    const load = handlers.get('copilot:ask-conversation:load')!;

    const oldResult = Promise.resolve(save({}, { ...request(), exchangeId: 'old' }));
    const clearResult = Promise.resolve(clear({}));
    const newResult = Promise.resolve(save({}, { ...request(), exchangeId: 'new' }));
    const loadResult = Promise.resolve(load({}));

    await oldSaveStarted.promise;
    expect(order).toEqual(['save:old:start']);

    oldSave.resolve(undefined);
    const [, , , loaded] = await Promise.all([
      oldResult,
      clearResult,
      newResult,
      loadResult,
    ]);
    expect(order).toEqual([
      'save:old:start',
      'save:old:end',
      'clear',
      'save:new:start',
      'save:new:end',
      'load',
    ]);
    expect(loaded).toMatchObject({
      exchangeId: 'new',
      sourceTruth: 'current',
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
