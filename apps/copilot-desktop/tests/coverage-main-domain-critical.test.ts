import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DomainServiceError,
  LocalKnowledgeService,
  createProductionKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../src/main/local-knowledge-service.js';
import { registerDomainIpc, toSafeIpcError } from '../src/main/domain-ipc.js';
import {
  ModelCredentialStore,
  type CredentialPersistence,
  type CredentialRecord,
} from '../src/main/model-credential-store.js';
import {
  isAllowedAudioMediaPermission,
  registerAudioMediaPermissionHandlers,
} from '../src/main/media-permission.js';
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js';

class MemoryCredentialPersistence implements CredentialPersistence {
  readonly records = new Map<string, CredentialRecord>();
  read(id: string) { return this.records.get(id) ?? null; }
  write(id: string, record: CredentialRecord) { this.records.set(id, { ...record }); }
  remove(id: string) { this.records.delete(id); }
  clear() { this.records.clear(); }
}

function credentialStore(): ModelCredentialStore {
  return new ModelCredentialStore(new MemoryCredentialPersistence(), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from([...value].reverse().join('')),
    decryptString: (value: Buffer) => [...value.toString()].reverse().join(''),
  });
}

const runtime = vi.hoisted(() => ({
  kbInstances: [] as Array<Record<string, unknown>>,
  kgStores: [] as Array<Record<string, unknown>>,
  vectorStores: [] as Array<Record<string, unknown>>,
  builderBuild: vi.fn(),
  indexOne: vi.fn(),
  deleteIndexed: vi.fn(),
  answerCalls: [] as Array<Record<string, unknown>>,
  llmOptions: [] as Array<Record<string, unknown>>,
  searchNodes: vi.fn(),
  subgraph: vi.fn(),
  fullGraph: vi.fn(),
}));

vi.mock('@copilot/kb', () => {
  class SqliteStore {
    constructor(public readonly options: unknown) {}
  }
  class MdFileStore {
    constructor(public readonly options: unknown) {}
  }
  class KbClient {
    readonly notes = new Map<string, { note: ReturnType<typeof wire>; body: string }>();
    readonly options: unknown;
    closed = false;
    constructor(options: unknown) {
      this.options = options;
      runtime.kbInstances.push(this as unknown as Record<string, unknown>);
    }
    createNote(input: Record<string, unknown>) {
      const note = wire(String(input.path), {
        title: String(input.title),
        type: (input.type ?? 'note') as ReturnType<typeof wire>['type'],
        status: (input.status ?? 'active') as ReturnType<typeof wire>['status'],
        tags: (input.tags ?? []) as string[],
        related: (input.related ?? []) as string[],
      });
      this.notes.set(note.path, { note, body: String(input.body ?? '') });
      return note;
    }
    readNote(notePath: string) { return this.notes.get(notePath) ?? null; }
    updateNote(notePath: string, patch: Record<string, unknown>) {
      const current = this.notes.get(notePath);
      if (!current) return null;
      const note = { ...current.note, ...patch, updated_at: current.note.updated_at + 1 };
      this.notes.set(notePath, {
        note,
        body: typeof patch.body === 'string' ? patch.body : current.body,
      });
      return note;
    }
    deleteNote(notePath: string) { return this.notes.delete(notePath); }
    listNotes() {
      const items = [...this.notes.values()].map(({ note }) => note);
      return { items, total: items.length, limit: 1000, offset: 0 };
    }
    listLinks(notePath: string) {
      return { in: [{ from_path: 'from/note', to_path: notePath, rel: 'mentions' }] };
    }
    setKgStatus() {}
    close() { this.closed = true; }
  }
  return { SqliteStore, MdFileStore, KbClient };
});

vi.mock('@copilot/kg', () => {
  class KgStore {
    removed: string[] = [];
    closed = false;
    constructor(public readonly options: unknown) {
      runtime.kgStores.push(this as unknown as Record<string, unknown>);
    }
    removeNoteGraph(notePath: string) { this.removed.push(notePath); }
    close() { this.closed = true; }
  }
  class KgQuery {
    constructor(public readonly store: unknown) {}
    searchNodes(query: string, options?: unknown) { return runtime.searchNodes(query, options); }
    subgraph(request: unknown) { return runtime.subgraph(request); }
    fullGraph(maxNodes?: number) { return runtime.fullGraph(maxNodes); }
  }
  class KgBuilder {
    constructor(public readonly options: unknown) {}
    buildNote(note: unknown) { return runtime.builderBuild(note); }
  }
  return { KgStore, KgQuery, KgBuilder };
});

vi.mock('@copilot/rag', () => {
  class Embedder {}
  class Indexer {
    constructor(public readonly embedder: unknown, public readonly store: unknown) {}
    indexOneNote(input: unknown) { return runtime.indexOne(input); }
    deleteNote(notePath: string) { return runtime.deleteIndexed(notePath); }
  }
  class Answerer {
    constructor(
      public readonly embedder: unknown,
      public readonly store: unknown,
      public readonly streamFactory: unknown,
      public readonly options: unknown,
    ) {}
    async *answer(question: string, options?: Record<string, unknown>) {
      runtime.answerCalls.push({ question, options, streamFactory: this.streamFactory });
      yield {
        delta: 'factory delta',
        citedSources: ['notes/a'],
        sourceDetails: [{ notePath: 'notes/a', score: 0.8, evidence: ['vector'] }],
      };
      return {
        answer: 'factory answer',
        sources: ['notes/a'],
        sourceDetails: [{ notePath: 'notes/a', score: 0.8, evidence: ['vector'] }],
      };
    }
  }
  return {
    Embedder,
    Indexer,
    Answerer,
    createVectorStore: vi.fn(async (options: unknown) => {
      const store = {
        options,
        closed: false,
        chunks: new Map<string, unknown[]>(),
        async close() { this.closed = true; },
        async deleteNote(notePath: string) { this.chunks.delete(notePath); },
        listChunksForNote(notePath: string) { return this.chunks.get(notePath) ?? []; },
      };
      runtime.vectorStores.push(store as unknown as Record<string, unknown>);
      return store;
    }),
  };
});

vi.mock('@copilot/llm-client', () => ({
  LLMClient: class {
    readonly provider: {
      name: string;
      chat: () => Promise<never>;
      chatStream: () => AsyncGenerator<{ delta: string; finishReason: string }>;
      countTokens: () => number;
    };
    constructor(options: Record<string, unknown>) {
      runtime.llmOptions.push(options);
      this.provider = {
        name: 'fake-provider',
        chat: async () => { throw new Error('not used'); },
        chatStream: async function* () { yield { delta: 'llm delta', finishReason: 'stop' }; },
        countTokens: () => 1,
      };
    }
  },
}));

type Wire = ReturnType<typeof wire>;

function wire(notePath: string, patch: Partial<{
  id: number;
  title: string;
  type: 'article' | 'note' | 'meeting' | 'todo' | 'reference' | 'idea' | null;
  status: 'draft' | 'active' | 'archived' | null;
  tags: string[];
  related: string[];
  folder: string;
  created_at: number;
  updated_at: number;
  confidence: number | null;
  agent: string | null;
}> = {}) {
  return {
    id: patch.id ?? 1,
    path: notePath,
    title: patch.title ?? notePath,
    type: patch.type ?? 'note' as const,
    status: patch.status ?? 'active' as const,
    tags: patch.tags ?? [],
    related: patch.related ?? [],
    folder: patch.folder ?? '',
    created_at: patch.created_at ?? 10,
    updated_at: patch.updated_at ?? 20,
    confidence: patch.confidence ?? null,
    agent: patch.agent ?? null,
  };
}

class MemoryKb {
  readonly documents = new Map<string, { note: Wire; body: string }>();
  readonly statuses: Array<[string, string]> = [];
  readonly links = new Map<string, Array<{ from_path: string; to_path: string; rel: string | null }>>();
  closed = false;
  nextId = 1;
  listTotalOverride: number | undefined;

  createNote(input: Record<string, unknown>) {
    const note = wire(String(input.path), {
      id: this.nextId++,
      title: String(input.title),
      type: (input.type ?? 'note') as Wire['type'],
      status: (input.status ?? 'active') as Wire['status'],
      tags: (input.tags ?? []) as string[],
      related: (input.related ?? []) as string[],
    });
    this.documents.set(note.path, { note, body: String(input.body ?? '') });
    return note;
  }
  readNote(notePath: string) { return this.documents.get(notePath) ?? null; }
  updateNote(notePath: string, patch: Record<string, unknown>) {
    const current = this.documents.get(notePath);
    if (!current) return null;
    const note = { ...current.note, ...patch, updated_at: current.note.updated_at + 1 } as Wire;
    this.documents.set(notePath, { note, body: typeof patch.body === 'string' ? patch.body : current.body });
    return note;
  }
  deleteNote(notePath: string) { return this.documents.delete(notePath); }
  listNotes(filter?: Record<string, unknown>) {
    let items = [...this.documents.values()].map(({ note }) => note);
    if (filter?.type) items = items.filter((item) => item.type === filter.type);
    if (Array.isArray(filter?.tags)) {
      const tags = filter.tags as string[];
      items = items.filter((item) => tags.every((tag) => item.tags.includes(tag)));
    }
    return { items, total: this.listTotalOverride ?? items.length, limit: 1000, offset: 0 };
  }
  listLinks(notePath: string) { return { in: this.links.get(notePath) ?? [] }; }
  setKgStatus(notePath: string, status: string) { this.statuses.push([notePath, status]); }
  close() { this.closed = true; }
}

function createService(overrides: Partial<LocalKnowledgeServiceOptions> = {}) {
  const kb = new MemoryKb();
  const kg = {
    getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
    reindexNote: vi.fn(async () => ({ entitiesAdded: 2, entitiesLinked: 3 })),
    removeNote: vi.fn(async () => undefined),
    relatedNotes: vi.fn(async () => [{ notePath: 'notes/a', score: 0.7, evidence: ['kg-entity'] }]),
    close: vi.fn(),
  };
  const rag = {
    indexNote: vi.fn(async () => ({ chunksInserted: 4, errors: [] as string[] })),
    deleteNote: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ text: 'fallback', sources: ['notes/a'] })),
    stream: vi.fn(async function* () {
      yield {
        delta: 'hello',
        sourceDetails: [
          { notePath: 'notes/a', score: 0.6, evidence: ['vector'] },
          { notePath: 'notes/a', score: 0.8, evidence: ['kg-entity'] },
          { notePath: '', score: 1, evidence: ['vector'] },
        ],
      };
      return {
        text: 'hello world',
        sources: ['notes/a', 'notes/a'],
        sourceDetails: [
          { notePath: 'notes/a', score: 0.8, evidence: ['kg-entity'] },
          { notePath: 'notes/b', score: 0.9, evidence: ['vector'] },
        ],
      };
    }),
    close: vi.fn(async () => undefined),
  };
  const settings = { get: vi.fn(() => false) };
  const service = new LocalKnowledgeService({
    kb,
    kg,
    rag,
    settings,
    clock: () => 1000,
    uuid: () => 'todo-1',
    ...overrides,
  } as unknown as LocalKnowledgeServiceOptions);
  return { service, kb, kg, rag, settings };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  runtime.kbInstances.length = 0;
  runtime.kgStores.length = 0;
  runtime.vectorStores.length = 0;
  runtime.answerCalls.length = 0;
  runtime.llmOptions.length = 0;
  runtime.builderBuild.mockReset().mockResolvedValue({ entitiesAdded: 2, entitiesTotal: 5 });
  runtime.indexOne.mockReset().mockResolvedValue({ chunksInserted: 3, errors: [] });
  runtime.deleteIndexed.mockReset().mockResolvedValue(undefined);
  runtime.searchNodes.mockReset().mockReturnValue([]);
  runtime.subgraph.mockReset().mockReturnValue({ nodes: [], edges: [], degree: {} });
  runtime.fullGraph.mockReset().mockReturnValue({ nodes: [], edges: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('domain IPC critical behavior', () => {
  it('registers every request handler, maps payloads, and isolates telemetry failures', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const calls: Array<[string, unknown]> = [];
    const method = (name: string) => vi.fn(async (request: unknown) => {
      calls.push([name, request]);
      return { name, request };
    });
    const service = {
      notes: {
        list: method('notes.list'), get: method('notes.get'), create: method('notes.create'),
        update: method('notes.update'), remove: method('notes.remove'), getBacklinks: method('notes.backlinks'),
      },
      kg: { getSubgraph: method('kg.view'), reindexNote: method('kg.reindex') },
      rag: { ask: method('rag.ask'), stream: vi.fn() },
      todos: {
        list: method('todos.list'), create: method('todos.create'), update: method('todos.update'),
        remove: method('todos.remove'), listDue: method('todos.due'),
        markReminderFired: method('todos.reminder-fired'),
      },
    };
    const record = vi.fn(async (operation: string) => {
      if (operation === 'notes.get') throw new Error('telemetry unavailable');
    });
    registerDomainIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as never) },
      async () => service as unknown as LocalKnowledgeService,
      record,
    );

    const mappings = [
      [IPC_CHANNELS.NOTES_LIST, 'notes.list'], [IPC_CHANNELS.NOTES_GET, 'notes.get'],
      [IPC_CHANNELS.NOTES_CREATE, 'notes.create'], [IPC_CHANNELS.NOTES_UPDATE, 'notes.update'],
      [IPC_CHANNELS.NOTES_REMOVE, 'notes.remove'], [IPC_CHANNELS.NOTES_GET_BACKLINKS, 'notes.backlinks'],
      [IPC_CHANNELS.KG_GET_SUBGRAPH, 'kg.view'], [IPC_CHANNELS.KG_REINDEX_NOTE, 'kg.reindex'],
      [IPC_CHANNELS.RAG_ASK, 'rag.ask'], [IPC_CHANNELS.TODOS_LIST, 'todos.list'],
      [IPC_CHANNELS.TODOS_CREATE, 'todos.create'], [IPC_CHANNELS.TODOS_UPDATE, 'todos.update'],
      [IPC_CHANNELS.TODOS_REMOVE, 'todos.remove'], [IPC_CHANNELS.TODOS_LIST_DUE, 'todos.due'],
      [IPC_CHANNELS.TODOS_MARK_REMINDER_FIRED, 'todos.reminder-fired'],
    ] as const;
    for (const [channel, operation] of mappings) {
      const payload = { channel };
      await expect(handlers.get(channel)!({}, payload)).resolves.toEqual({ name: operation, request: payload });
    }
    expect(calls).toHaveLength(mappings.length);
    expect(record).toHaveBeenCalledTimes(mappings.length);

    const noRecordHandlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    registerDomainIpc(
      { handle: (channel, listener) => noRecordHandlers.set(channel, listener as never) },
      () => service as unknown as LocalKnowledgeService,
    );
    await expect(noRecordHandlers.get(IPC_CHANNELS.NOTES_LIST)!({}, undefined)).resolves.toMatchObject({ name: 'notes.list' });
  });

  it('streams delta/final, rejects duplicate and malformed starts, and cancels active work', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const sent: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stream = vi.fn(async function* (_question: string, signal: AbortSignal) {
      yield { delta: 'one', sourceDetails: [{ notePath: 'a', score: 1, evidence: ['vector'] }] };
      await gate;
      if (signal.aborted) throw signal.reason;
      return { text: 'done', sources: ['a'] };
    });
    const service = { rag: { stream } } as unknown as LocalKnowledgeService;
    registerDomainIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as never) },
      () => service,
      vi.fn(),
    );
    const event = { sender: { send: (channel: string, value: unknown) => sent.push({ channel, value }) } };
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!(event, {
      requestId: ' req-1 ', question: ' hello ',
    })).resolves.toEqual({ requestId: 'req-1', accepted: true });
    await settle();
    expect(stream).toHaveBeenCalledWith('hello', expect.any(AbortSignal));
    expect(sent).toContainEqual({
      channel: IPC_CHANNELS.RAG_STREAM_EVENT,
      value: expect.objectContaining({ requestId: 'req-1', type: 'delta', delta: 'one' }),
    });
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!(event, {
      requestId: 'req-1', question: 'duplicate',
    })).rejects.toThrow('[INVALID_ARGUMENT] RAG request id is already active');
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_CANCEL)!({}, ' req-1 ')).resolves.toEqual({
      requestId: 'req-1', cancelled: true,
    });
    release();
    await settle();
    expect(sent).toContainEqual({
      channel: IPC_CHANNELS.RAG_STREAM_EVENT,
      value: { requestId: 'req-1', type: 'cancel' },
    });
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_CANCEL)!({}, 'missing')).resolves.toEqual({
      requestId: 'missing', cancelled: false,
    });
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_CANCEL)!({}, '  ')).rejects.toThrow('[INVALID_ARGUMENT]');

    for (const payload of [null, {}, { requestId: '', question: 'x' }, { requestId: 'x', question: '' }]) {
      await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!(event, payload)).rejects.toThrow('[INVALID_ARGUMENT]');
    }
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!({}, {
      requestId: 'no-sender', question: 'x',
    })).rejects.toThrow('[INTERNAL] RAG event channel is unavailable');
    await expect(handlers.get(IPC_CHANNELS.RAG_STREAM_START)!({ sender: {} }, {
      requestId: 'bad-sender', question: 'x',
    })).rejects.toThrow('[INTERNAL] RAG event channel is unavailable');
  });

  it('emits safe stream failures and curates ordinary IPC errors', async () => {
    const cases: Array<[unknown, string, string]> = [
      [new DomainServiceError('OFFLINE', 'offline safe'), 'OFFLINE', 'offline safe'],
      [new DomainServiceError('NOT_FOUND', 'secret missing'), 'INTERNAL', 'local knowledge request failed'],
      [new Error('private secret'), 'INTERNAL', 'local knowledge request failed'],
    ];
    for (const [failure, code, message] of cases) {
      const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
      const sent: unknown[] = [];
      const service = {
        rag: { stream: async function* () { throw failure; } },
        notes: { get: vi.fn(async () => { throw failure; }) },
      } as unknown as LocalKnowledgeService;
      registerDomainIpc(
        { handle: (channel, listener) => handlers.set(channel, listener as never) },
        () => service,
      );
      await handlers.get(IPC_CHANNELS.RAG_STREAM_START)!({ sender: { send: (_c: string, v: unknown) => sent.push(v) } }, {
        requestId: `failure-${code}-${message}`, question: 'q',
      });
      await settle();
      expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code, message }));
      const ordinary = handlers.get(IPC_CHANNELS.NOTES_GET)!({}, 'x');
      if (failure instanceof DomainServiceError) {
        await expect(ordinary).rejects.toThrow(`[${failure.code}] ${failure.message}`);
      } else {
        await expect(ordinary).rejects.toThrow('[INTERNAL] local knowledge request failed');
      }
    }
    expect(toSafeIpcError(new DomainServiceError('CONFIG_REQUIRED', 'configure model')).message)
      .toBe('[CONFIG_REQUIRED] configure model');
    expect(toSafeIpcError('raw secret').message).toBe('[INTERNAL] local knowledge request failed');
  });
});

describe('local knowledge service critical behavior', () => {
  it('implements note CRUD, backlinks, cleanup, and metadata-only backup boundaries', async () => {
    const backup = { enqueue: vi.fn(async () => undefined) };
    const settings = { get: vi.fn(() => true) };
    const { service, kb, kg, rag } = createService({ settings: settings as never, cloudBackup: backup });
    kb.documents.set('system/todos/hidden', { note: wire('system/todos/hidden'), body: '{}' });
    kb.documents.set('tag-hidden', { note: wire('tag-hidden', { tags: ['__copilot_todo__'] }), body: '{}' });
    kb.documents.set('notes/a', { note: wire('notes/a', { tags: ['x'], related: ['notes/b'] }), body: 'A' });
    kb.links.set('notes/a', [{ from_path: 'notes/b', to_path: 'notes/a', rel: 'mentions' }]);

    await expect(service.notes.list()).resolves.toMatchObject({
      total: 1,
      items: [{ path: 'notes/a', tags: ['x'], related: ['notes/b'] }],
    });
    kb.listTotalOverride = 0;
    await expect(service.notes.list()).resolves.toMatchObject({ total: 0 });
    await expect(service.notes.get('notes/a')).resolves.toMatchObject({ body: 'A', note: { path: 'notes/a' } });
    await expect(service.notes.get('notes/missing')).resolves.toBeNull();
    await expect(service.notes.getBacklinks('notes/a')).resolves.toEqual([
      { fromPath: 'notes/b', toPath: 'notes/a', relation: 'mentions' },
    ]);

    await expect(service.notes.create({ path: 'notes/body', title: 'Body', body: 'local-secret' }))
      .resolves.toMatchObject({ path: 'notes/body' });
    await expect(service.notes.create({ path: 'notes/voice', title: 'Voice', transcript: 'spoken' }))
      .resolves.toMatchObject({ path: 'notes/voice' });
    expect(kb.readNote('notes/voice')?.body).toBe('spoken');
    expect(backup.enqueue).toHaveBeenCalledWith({ operation: 'create', path: 'notes/body' });
    expect(JSON.stringify(backup.enqueue.mock.calls)).not.toContain('local-secret');

    await expect(service.notes.update({ path: 'notes/body', patch: { title: 'Updated', body: 'new' } }))
      .resolves.toMatchObject({ title: 'Updated' });
    await expect(service.notes.update({ path: 'missing', patch: { title: 'No' } })).resolves.toBeNull();
    await expect(service.notes.remove('notes/body')).resolves.toBe(true);
    await expect(service.notes.remove('notes/body')).resolves.toBe(false);
    expect(kg.removeNote).toHaveBeenCalledTimes(2);
    expect(rag.deleteNote).toHaveBeenCalledTimes(2);
    expect(backup.enqueue).toHaveBeenCalledWith({ operation: 'update', path: 'notes/body' });
    expect(backup.enqueue).toHaveBeenCalledWith({ operation: 'remove', path: 'notes/body' });

    backup.enqueue.mockRejectedValueOnce(new Error('cloud down'));
    await expect(service.notes.create({ path: 'notes/offline-backup', title: 'Still local', body: 'x' }))
      .resolves.toMatchObject({ path: 'notes/offline-backup' });
    settings.get.mockReturnValue(false);
    await service.notes.create({ path: 'notes/no-backup', title: 'No backup', body: 'x' });
    expect(backup.enqueue).toHaveBeenCalledTimes(5);

    const noCloud = createService();
    noCloud.settings.get.mockReturnValue(true);
    await expect(noCloud.service.notes.create({ path: 'notes/no-port', title: 'No port', body: 'x' }))
      .resolves.toMatchObject({ path: 'notes/no-port' });
  });

  it('validates note boundaries and normalizes cleanup failures', async () => {
    const { service, kg, rag } = createService();
    const invalidCreates = [
      null,
      { path: '', title: 'x', body: 'x' },
      { path: 'x', title: '', body: 'x' },
      { path: 'x', title: 'x' },
      { path: 'system/todos/x', title: 'x', body: 'x' },
      { path: 'x', title: 'x', body: 'x', tags: ['__copilot_todo__'] },
    ];
    for (const request of invalidCreates) {
      await expect(service.notes.create(request as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    for (const notePath of ['', 'system/todos/x']) {
      await expect(service.notes.get(notePath)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(service.notes.getBacklinks(notePath)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(service.notes.remove(notePath)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(service.notes.update({ path: '', patch: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.notes.update({ path: 'system/todos/x', patch: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.notes.update({ path: 'x', patch: null as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.notes.update({ path: 'x', patch: { tags: ['__copilot_todo__'] } }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    kg.removeNote.mockRejectedValueOnce(new Error('network timeout private'));
    await expect(service.notes.remove('notes/missing')).rejects.toMatchObject({
      code: 'OFFLINE', message: 'local AI service is unavailable',
    });
    rag.deleteNote.mockRejectedValueOnce(new Error('private database detail'));
    await expect(service.notes.remove('notes/missing')).rejects.toMatchObject({
      code: 'INTERNAL', message: 'local knowledge operation failed',
    });
    kg.removeNote.mockRejectedValueOnce(new DomainServiceError('CONFIG_REQUIRED', 'safe config'));
    await expect(service.notes.remove('notes/missing')).rejects.toMatchObject({
      code: 'CONFIG_REQUIRED', message: 'safe config',
    });
  });

  it('reindexes KG/RAG transactionally and exposes normalized RAG streams and sources', async () => {
    const { service, kb, kg, rag } = createService();
    kb.documents.set('notes/a', { note: wire('notes/a'), body: 'local body' });
    await expect(service.kg.getSubgraph({ center: 'entity' })).resolves.toEqual({ nodes: [], edges: [], degree: {} });
    expect(kg.getSubgraph).toHaveBeenCalledWith({ center: 'entity' });
    await expect(service.kg.reindexNote('notes/a')).resolves.toEqual({
      notePath: 'notes/a', entitiesAdded: 2, entitiesLinked: 3, ragChunksInserted: 4, errors: [],
    });
    expect(kb.statuses).toEqual([['notes/a', 'processing'], ['notes/a', 'done']]);
    rag.indexNote.mockResolvedValueOnce({ chunksInserted: 0, errors: ['chunk failed'] });
    await expect(service.kg.reindexNote('notes/a')).resolves.toMatchObject({ errors: ['chunk failed'] });
    expect(kb.statuses.at(-1)).toEqual(['notes/a', 'failed']);
    await expect(service.kg.reindexNote('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.kg.reindexNote('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    kg.reindexNote.mockRejectedValueOnce(new Error('ECONNREFUSED private'));
    await expect(service.kg.reindexNote('notes/a')).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(kb.statuses.at(-1)).toEqual(['notes/a', 'failed']);

    const iterator = service.rag.stream('  question  ');
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        delta: 'hello',
        sourceDetails: [{ notePath: 'notes/a', score: 0.8, evidence: ['vector', 'kg-entity'] }],
      },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: true,
      value: {
        text: 'hello world',
        sources: ['notes/a', 'notes/b'],
        sourceDetails: [
          { notePath: 'notes/b', score: 0.9, evidence: ['vector'] },
          { notePath: 'notes/a', score: 0.8, evidence: ['kg-entity'] },
        ],
      },
    });
    await expect(service.rag.ask(' ask ')).resolves.toMatchObject({ text: 'hello world', sources: ['notes/a', 'notes/b'] });
    expect(kg.relatedNotes).toHaveBeenCalledWith('question', 10);
    await expect(service.rag.ask('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(() => service.rag.stream(' ')).toThrow(DomainServiceError);

    rag.stream.mockImplementationOnce(async function* () { throw new Error('fetch failed private'); });
    await expect(service.rag.ask('offline')).rejects.toMatchObject({ code: 'OFFLINE' });
    rag.stream.mockImplementationOnce(async function* () { throw 'raw'; });
    await expect(service.rag.ask('internal')).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('supports non-stream RAG fallback with and without answer text or explicit sources', async () => {
    const first = createService();
    delete (first.rag as { stream?: unknown }).stream;
    first.rag.ask.mockResolvedValueOnce({ text: 'fallback text', sources: ['a', 'a'] });
    const iterator = first.service.rag.stream('q');
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { delta: 'fallback text', sourceDetails: [{ notePath: 'a', evidence: ['vector'], score: 0 }] },
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true, value: { sources: ['a'] } });

    first.rag.ask.mockResolvedValueOnce({ text: '', sources: [], sourceDetails: [] } as never);
    const empty = first.service.rag.stream('q2');
    await expect(empty.next()).resolves.toMatchObject({ done: true, value: { text: '', sources: [] } });

    const noRelated = createService();
    delete (noRelated.kg as { relatedNotes?: unknown }).relatedNotes;
    await expect(noRelated.service.rag.ask('no related')).resolves.toMatchObject({ text: 'hello world' });
  });

  it('persists, filters, updates, reminds, and deletes todos while rejecting invalid records', async () => {
    const { service, kb } = createService();
    await expect(service.todos.create({ title: '  Todo A  ', note_links: [' notes/a ', 'notes/a', ''] }))
      .resolves.toMatchObject({
        id: 'todo-1', title: 'Todo A', body: '', due_at_ms: null, remind_at_ms: null,
        status: 'pending', priority: 'normal', note_links: ['notes/a'], reminder_fired: 0,
        created_at: 1000, updated_at: 1000,
      });
    await expect(service.todos.create({
      title: 'Todo B', body: 'b', due_at_ms: 1500, remind_at_ms: 900,
      status: 'done', priority: 'high', note_links: ['notes/b'],
    })).resolves.toMatchObject({ status: 'done', priority: 'high' });
    const ids = [...kb.documents.keys()].filter((key) => key.startsWith('system/todos/'));
    expect(ids).toHaveLength(1);

    await expect(service.todos.update({ id: 'todo-1', patch: {
      title: ' Updated ', status: 'cancelled', priority: 'low', due_at_ms: 2000,
      remind_at_ms: null, note_links: ['notes/c', 'notes/c'],
    } })).resolves.toMatchObject({
      title: 'Updated', status: 'cancelled', priority: 'low', note_links: ['notes/c'], updated_at: 1000,
    });
    expect(kb.readNote('system/todos/todo-1')?.note.status).toBe('archived');
    await expect(service.todos.update({ id: 'missing', patch: { title: 'x' } })).resolves.toBeNull();
    await expect(service.todos.markReminderFired('todo-1')).resolves.toMatchObject({ reminder_fired: 1 });
    await expect(service.todos.remove('todo-1')).resolves.toBe(true);
    await expect(service.todos.remove('todo-1')).resolves.toBe(false);

    const records = [
      { id: 'early', title: 'Early', due_at_ms: 100, remind_at_ms: 500, status: 'pending', priority: 'normal', reminder_fired: 0, created_at: 1, updated_at: 1 },
      { id: 'late', title: 'Late', due_at_ms: 300, remind_at_ms: 1500, status: 'pending', priority: 'normal', reminder_fired: 0, created_at: 3, updated_at: 3 },
      { id: 'done', title: 'Done', due_at_ms: 200, remind_at_ms: 500, status: 'done', priority: 'normal', reminder_fired: 0, created_at: 2, updated_at: 2 },
      { id: 'fired', title: 'Fired', due_at_ms: null, remind_at_ms: 500, status: 'pending', priority: 'high', reminder_fired: 1, created_at: 4, updated_at: 4 },
      { id: 'none', title: 'None', due_at_ms: null, remind_at_ms: null, status: 'pending', priority: 'low', reminder_fired: 0, created_at: 5, updated_at: 5 },
    ];
    for (const item of records) {
      const notePath = `system/todos/${item.id}`;
      kb.documents.set(notePath, {
        note: wire(notePath, { type: 'todo', tags: ['__copilot_todo__'] }),
        body: JSON.stringify({ schema: 1, body: '', note_links: [], ...item }),
      });
    }
    kb.documents.set('system/todos/bad-json', { note: wire('system/todos/bad-json', { type: 'todo', tags: ['__copilot_todo__'] }), body: '{' });
    kb.documents.set('system/todos/bad-shape', { note: wire('system/todos/bad-shape', { type: 'todo', tags: ['__copilot_todo__'] }), body: JSON.stringify({ id: 'x', title: 'x', status: 'bad', priority: 'bad' }) });
    kb.documents.set('system/todos/missing-body', { note: wire('system/todos/missing-body', { type: 'todo', tags: ['__copilot_todo__'] }), body: JSON.stringify({ id: 'minimal', title: 'Minimal', status: 'pending', priority: 'normal' }) });

    await expect(service.todos.list()).resolves.toSatisfy((value: unknown) => (
      (value as Array<{ id: unknown }>).map((todo) => todo.id).includes('minimal')
    ));
    await expect(service.todos.list({ status: 'pending' })).resolves.toSatisfy((value: unknown) => (
      (value as Array<{ status: string }>).every((todo) => todo.status === 'pending')
    ));
    await expect(service.todos.list({ fromMs: 150, toMs: 250 })).resolves.toEqual([
      expect.objectContaining({ id: 'done' }),
    ]);
    await expect(service.todos.listDue(1000)).resolves.toEqual([
      expect.objectContaining({ id: 'early' }),
    ]);
    await expect(service.todos.listDue()).resolves.toEqual([
      expect.objectContaining({ id: 'early' }),
    ]);
    await expect(service.todos.listDue(Number.NaN)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects every invalid todo mutation and closes optional ports safely', async () => {
    const { service } = createService();
    const invalidCreates = [
      { title: '' }, { title: 'x', status: 'bad' }, { title: 'x', priority: 'bad' },
      { title: 'x', due_at_ms: Number.NaN }, { title: 'x', remind_at_ms: 'soon' },
    ];
    for (const request of invalidCreates) {
      await expect(service.todos.create(request as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(service.todos.update({} as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await service.todos.create({ title: 'valid' });
    for (const patch of [null, { title: '' }, { status: 'bad' }, { priority: 'bad' }, { due_at_ms: Infinity }, { remind_at_ms: {} }]) {
      await expect(service.todos.update({ id: 'todo-1', patch: patch as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    for (const id of ['', null, {}, []]) {
      await expect(service.todos.remove(id as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(service.todos.markReminderFired(id as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(service.close()).resolves.toBeUndefined();

    const bareKb = new MemoryKb();
    const bare = new LocalKnowledgeService({
      kb: bareKb,
      kg: { getSubgraph: async () => ({ nodes: [], edges: [], degree: {} }), reindexNote: async () => ({ entitiesAdded: 0, entitiesLinked: 0 }), removeNote: () => undefined },
      rag: { indexNote: async () => ({ chunksInserted: 0, errors: [] }), deleteNote: async () => undefined, ask: async () => ({ text: '', sources: [] }) },
      settings: { get: () => false },
    } as unknown as LocalKnowledgeServiceOptions);
    await expect(bare.close()).resolves.toBeUndefined();
  });
});

describe('production local-first composition ports', () => {
  const modelApi = { provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local', apiKey: '' };
  const settings = { get: vi.fn((key: string) => key === 'modelApi' ? modelApi : false) };

  it('composes local stores and exercises KG query, replacement, RAG sources, deletion and close', async () => {
    const alpha = {
      id: 1, entity_id: 'alpha', type: 'concept', name: 'Alpha', aliases: [], summary: null,
      confidence: 1, source_notes: ['notes/a', 'notes/a'], created_at: 1, updated_at: 1,
    };
    const beta = { ...alpha, id: 2, entity_id: 'beta', name: 'Beta', source_notes: ['notes/b'] };
    const edge = { id: 1, from_entity_id: 'alpha', to_entity_id: 'beta', rel: 'related', weight: 1, evidence: ['notes/c'], created_at: 1 };
    runtime.fullGraph.mockReturnValue({ nodes: [alpha, beta], edges: [edge] });
    runtime.searchNodes.mockImplementation((term: string) => term === 'alpha' ? [alpha] : term === 'beta' ? [alpha, beta] : []);
    runtime.subgraph.mockImplementation((request: { center: string }) => request.center === 'alpha'
      ? { nodes: [alpha, beta], edges: [edge], degree: { alpha: 1, beta: 1 } }
      : { nodes: [], edges: [], degree: {} });

    const service = await createProductionKnowledgeService({ userDataPath: '/tmp/copilot-user', settings: settings as never, credentials: credentialStore() });
    expect(runtime.kbInstances).toHaveLength(1);
    expect(runtime.kgStores).toHaveLength(1);
    expect(runtime.vectorStores).toHaveLength(1);
    expect((runtime.kgStores[0].options as { dbPath: string }).dbPath).toContain('/tmp/copilot-user/local-first/kg.sqlite');

    await service.notes.create({ path: 'notes/a', title: 'A', body: 'Alpha body', tags: ['tag'] });
    await expect(service.kg.getSubgraph(1)).resolves.toMatchObject({ nodes: [{ entity_id: 'alpha' }], edges: [] });
    await expect(service.kg.getSubgraph({ types: ['concept'], maxNodes: Number.POSITIVE_INFINITY })).resolves.toMatchObject({
      nodes: [{ entity_id: 'alpha' }], degree: { alpha: 0 },
    });
    await expect(service.kg.getSubgraph({ center: 'alpha', hops: 99, maxNodes: 0 })).resolves.toEqual({
      nodes: [alpha, beta], edges: [edge], degree: { alpha: 1, beta: 1 },
    });
    expect(runtime.subgraph).toHaveBeenCalledWith({ center: 'alpha', hops: 3, types: undefined, maxNodes: 1 });

    await expect(service.kg.reindexNote('notes/a')).resolves.toMatchObject({
      entitiesAdded: 2, entitiesLinked: 5, ragChunksInserted: 3,
    });
    expect(runtime.builderBuild).toHaveBeenCalledWith(expect.objectContaining({
      path: 'notes/a', title: 'A', body: 'Alpha body', tags: ['tag'], metadata: { type: 'note', status: 'active' },
    }));
    const vector = runtime.vectorStores[0] as unknown as { chunks: Map<string, unknown[]> };
    vector.chunks.set('notes/a', [{ id: 'c', notePath: 'notes/a', ordinal: 0, text: 'A', tokenCount: 1, charRange: [0, 1] }]);
    vector.chunks.set('notes/b', [{ id: 'd', notePath: 'notes/b', ordinal: 0, text: 'B', tokenCount: 1, charRange: [0, 1] }]);
    vector.chunks.set('notes/c', [{ id: 'e', notePath: 'notes/c', ordinal: 0, text: 'C', tokenCount: 1, charRange: [0, 1] }]);

    const stream = service.rag.stream('Alpha beta!');
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { delta: 'factory delta' } });
    await expect(stream.next()).resolves.toMatchObject({ done: true, value: { text: 'factory answer', sources: ['notes/a'] } });
    expect(runtime.answerCalls.at(-1)?.options).toMatchObject({
      supplementalHits: expect.arrayContaining([
        expect.objectContaining({ score: expect.any(Number), evidence: expect.any(Array) }),
      ]),
    });
    await expect(service.rag.ask('Alpha beta')).resolves.toMatchObject({ text: 'factory answer' });
    await expect(service.notes.remove('notes/a')).resolves.toBe(true);
    expect(runtime.deleteIndexed).toHaveBeenCalledWith('notes/a');
    expect((runtime.kgStores[0].removed as string[])).toContain('notes/a');
    await expect(service.close()).resolves.toBeUndefined();
    expect(runtime.kgStores[0].closed).toBe(true);
    expect(runtime.vectorStores[0].closed).toBe(true);
  });

  it('fails closed for remote models without credentials and accepts explicit credentials', async () => {
    const remoteSettings = {
      get: vi.fn((key: string) => key === 'modelApi'
        ? { provider: 'custom', baseUrl: 'https://models.example/v1', model: 'remote', apiKey: '' }
        : false),
    };
    const remote = await createProductionKnowledgeService({ userDataPath: '/tmp/remote', settings: remoteSettings as never, credentials: credentialStore() });
    await remote.notes.create({ path: 'notes/remote', title: 'Remote', body: 'x' });
    await expect(remote.kg.reindexNote('notes/remote')).rejects.toMatchObject({
      code: 'CONFIG_REQUIRED', message: 'an API key is required for the selected remote model',
    });

    const keyedSettings = {
      get: vi.fn((key: string) => key === 'modelApi'
        ? { provider: 'custom', baseUrl: 'not a url', model: 'remote', apiKey: 'key' }
        : false),
    };
    const keyed = await createProductionKnowledgeService({ userDataPath: '/tmp/keyed', settings: keyedSettings as never, credentials: credentialStore() });
    await keyed.notes.create({ path: 'notes/keyed', title: 'Keyed', body: 'x' });
    await expect(keyed.kg.reindexNote('notes/keyed')).resolves.toMatchObject({ entitiesAdded: 2 });
    expect(runtime.llmOptions.at(-1)).toMatchObject({ apiKey: 'key', baseUrl: 'not a url', defaultModel: 'remote' });

    for (const baseUrl of ['http://localhost:1']) {
      const loopbackSettings = {
        get: (key: string) => key === 'modelApi'
          ? { provider: 'custom', baseUrl, model: 'local', apiKey: '' }
          : false,
      };
      const local = await createProductionKnowledgeService({ userDataPath: `/tmp/${encodeURIComponent(baseUrl)}`, settings: loopbackSettings as never, credentials: credentialStore() });
      await local.notes.create({ path: 'notes/local', title: 'Local', body: 'x' });
      await expect(local.kg.reindexNote('notes/local')).resolves.toMatchObject({ entitiesAdded: 2 });
    }
  });
});

describe('audio media permission fail-closed policy', () => {
  const trusted = { id: 7 };
  const base = {
    trustedWebContents: trusted,
    requestingWebContents: trusted,
    trustedRendererUrl: 'file:///Applications/Copilot/index.html',
    permission: 'media',
    requestingUrl: 'file:///Applications/Copilot/index.html?x=1#voice',
    isMainFrame: true,
    mediaTypes: ['audio'] as string[],
  };

  it('allows only the exact renderer identity, main frame, location, and audio media type', () => {
    expect(isAllowedAudioMediaPermission(base)).toBe(true);
    expect(isAllowedAudioMediaPermission({ ...base, permission: 'camera' })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingWebContents: { id: 7 } })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingWebContents: null })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, isMainFrame: false })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingUrl: undefined })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingUrl: 'not a url' })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingUrl: 'https://example.test/index.html' })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, requestingUrl: 'file://host/Applications/Copilot/index.html' })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, mediaTypes: [] })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, mediaTypes: undefined, mediaType: 'audio' })).toBe(true);
    expect(isAllowedAudioMediaPermission({ ...base, mediaTypes: undefined, mediaType: 'video' })).toBe(false);
    expect(isAllowedAudioMediaPermission({
      ...base,
      trustedRendererUrl: 'https://app.example.test/index.html',
      requestingUrl: 'https://app.example.test/other?x=1',
    })).toBe(true);
    expect(isAllowedAudioMediaPermission({
      ...base,
      trustedRendererUrl: 'https://app.example.test',
      requestingUrl: 'https://evil.example.test',
    })).toBe(false);
    expect(isAllowedAudioMediaPermission({ ...base, trustedRendererUrl: 'custom://renderer' })).toBe(false);
  });

  it('registers request and check handlers and forwards Electron detail variants', () => {
    let requestHandler!: (...args: any[]) => void;
    let checkHandler!: (...args: any[]) => boolean;
    const session = {
      setPermissionRequestHandler: vi.fn((handler) => { requestHandler = handler; }),
      setPermissionCheckHandler: vi.fn((handler) => { checkHandler = handler; }),
    };
    registerAudioMediaPermissionHandlers(session as never, trusted as never, 'https://app.example.test/index.html');
    expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce();

    const callback = vi.fn();
    requestHandler(trusted, 'media', callback, {
      requestingUrl: 'https://app.example.test/voice', isMainFrame: true, mediaTypes: ['audio'],
    });
    expect(callback).toHaveBeenLastCalledWith(true);
    requestHandler(trusted, 'media', callback, {
      requestingUrl: 'https://app.example.test/voice', isMainFrame: true,
    });
    expect(callback).toHaveBeenLastCalledWith(false);
    expect(checkHandler(trusted, 'media', 'https://fallback.example', {
      requestingUrl: 'https://app.example.test/voice', securityOrigin: 'https://security.example',
      isMainFrame: true, mediaType: 'audio',
    })).toBe(true);
    expect(checkHandler(trusted, 'media', 'https://app.example.test', {
      requestingUrl: '', securityOrigin: 'https://app.example.test', isMainFrame: true, mediaType: 'audio',
    })).toBe(false);
    expect(checkHandler(trusted, 'media', 'https://app.example.test', {
      isMainFrame: true, mediaType: 'audio',
    })).toBe(true);
    expect(checkHandler(null, 'media', 'https://app.example.test', {
      isMainFrame: true, mediaType: 'audio',
    })).toBe(false);
  });
});
