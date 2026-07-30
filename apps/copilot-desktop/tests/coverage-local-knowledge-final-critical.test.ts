import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DomainServiceError,
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../src/main/local-knowledge-service.js';
import type {
  CreateNoteRequest,
  KgSubgraph,
  TodoRecord,
  WikiTruthReceipt,
} from '../src/shared/domain-api.js';

const TODO_TAG = '__copilot_todo__';
const IMPORT_NAMESPACE = 'import-a';
const IMPORT_MARKER = `__backup_import__:${IMPORT_NAMESPACE}`;

type Wire = {
  id: number;
  path: string;
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
};

type TrashState =
  | 'prepared'
  | 'cleanup_pending'
  | 'trashed'
  | 'restoring'
  | 'restored'
  | 'purging'
  | 'purged';

type TrashEntry = {
  trashId: string;
  kind: 'note' | 'todo';
  originalPath: string;
  originalRevision: string;
  trashRevision: string;
  state: TrashState;
  movedAt: number;
  restoredAt: number | null;
  purgedAt: number | null;
  cleanupAttempts: number;
  metadataJson: string;
  contentSha256: string;
  idempotencyKey: string;
  inputSha256: string;
  restoreIdempotencyKey: string | null;
  purgeIdempotencyKey: string | null;
};

type PendingEntry = {
  note_path: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  queued_at: number;
};

function wire(
  notePath: string,
  patch: Partial<Wire> = {},
): Wire {
  return {
    id: patch.id ?? 1,
    path: notePath,
    title: patch.title ?? notePath,
    type: patch.type ?? 'note',
    status: patch.status ?? 'active',
    tags: patch.tags ?? [],
    related: patch.related ?? [],
    folder: patch.folder ?? '',
    created_at: patch.created_at ?? 10,
    updated_at: patch.updated_at ?? 20,
    confidence: patch.confidence ?? null,
    agent: patch.agent ?? null,
  };
}

function todo(
  id = `${IMPORT_NAMESPACE}-todo-1`,
  patch: Partial<TodoRecord> = {},
): TodoRecord {
  return {
    id,
    title: patch.title ?? 'Imported Todo',
    body: patch.body ?? 'body',
    due_at_ms: patch.due_at_ms ?? null,
    remind_at_ms: patch.remind_at_ms ?? null,
    status: patch.status ?? 'pending',
    priority: patch.priority ?? 'normal',
    note_links: patch.note_links ?? ['notes/source'],
    reminder_fired: patch.reminder_fired ?? 0,
    created_at: patch.created_at ?? 10,
    updated_at: patch.updated_at ?? 20,
  };
}

function currentWiki(notePath: string): WikiTruthReceipt {
  const digest = 'a'.repeat(64);
  const projection = {
    projectionId: '1',
    notePath,
    status: 'current' as const,
    contentDigest: digest,
    summary: 'summary',
    tags: ['local'],
    entityIds: ['concept:local'],
    relationSignatures: [],
    generatedAt: 10,
    failureStage: null,
    failureReason: null,
    provenance: { provider: 'embedded-local', model: 'local', generatedAt: 10 },
  };
  return {
    notePath,
    expectedContentDigest: digest,
    truth: 'current',
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection.provenance,
  };
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`private ${code} detail`), { code });
}

class MemoryKb {
  readonly documents = new Map<string, { note: Wire; body: string }>();
  readonly trashEntries = new Map<string, TrashEntry>();
  readonly statuses: Array<[string, PendingEntry['status']]> = [];
  pendingRows: PendingEntry[] = [];
  nextNoteId = 1;
  nextTrashId = 1;
  deleteFailurePaths = new Set<string>();
  statusFailurePaths = new Set<string>();
  moveFailure: unknown = null;
  restoreFailure: unknown = null;
  purgeFailure: unknown = null;
  restoreState: TrashState = 'restored';
  closed = false;

  createNote(input: Record<string, unknown>): Wire {
    const note = wire(String(input.path), {
      id: this.nextNoteId++,
      title: String(input.title),
      type: (input.type ?? 'note') as Wire['type'],
      status: (input.status ?? 'active') as Wire['status'],
      tags: [...((input.tags ?? []) as string[])],
      related: [...((input.related ?? []) as string[])],
      created_at: 10,
      updated_at: 20,
      confidence: (input.confidence ?? null) as number | null,
      agent: (input.agent ?? null) as string | null,
    });
    this.documents.set(note.path, { note, body: String(input.body ?? '') });
    return note;
  }

  readNote(notePath: string) {
    return this.documents.get(notePath) ?? null;
  }

  updateNote(notePath: string, patch: Record<string, unknown>): Wire | null {
    const current = this.documents.get(notePath);
    if (!current) return null;
    const note = {
      ...current.note,
      ...patch,
      tags: patch.tags ? [...(patch.tags as string[])] : current.note.tags,
      related: patch.related ? [...(patch.related as string[])] : current.note.related,
      updated_at: current.note.updated_at + 1,
    } as Wire;
    this.documents.set(notePath, {
      note,
      body: typeof patch.body === 'string' ? patch.body : current.body,
    });
    return note;
  }

  deleteNote(notePath: string): boolean {
    if (this.deleteFailurePaths.has(notePath)) return false;
    return this.documents.delete(notePath);
  }

  listNotes(filter?: Record<string, unknown>) {
    let items = [...this.documents.values()].map(({ note }) => note);
    if (filter?.type) items = items.filter((item) => item.type === filter.type);
    if (Array.isArray(filter?.tags)) {
      const tags = filter.tags as string[];
      items = items.filter((item) => tags.every((tag) => item.tags.includes(tag)));
    }
    return { items, total: items.length, limit: 1000, offset: 0 };
  }

  listLinks(_notePath: string) {
    return { in: [] };
  }

  moveNoteToTrash(request: {
    path: string;
    kind: 'note' | 'todo';
    expectedRevision: string;
    idempotencyKey: string;
  }): TrashEntry {
    if (this.moveFailure) throw this.moveFailure;
    const current = this.documents.get(request.path);
    if (!current) throw codedError('TRASH_NOT_FOUND');
    const trashId = `trash-${this.nextTrashId++}`;
    const entry: TrashEntry = {
      trashId,
      kind: request.kind,
      originalPath: request.path,
      originalRevision: request.expectedRevision,
      trashRevision: `trash:${trashId}:${current.note.updated_at}`,
      state: 'cleanup_pending',
      movedAt: current.note.updated_at,
      restoredAt: null,
      purgedAt: null,
      cleanupAttempts: 0,
      metadataJson: JSON.stringify({ note: current.note }),
      contentSha256: 'b'.repeat(64),
      idempotencyKey: request.idempotencyKey,
      inputSha256: 'c'.repeat(64),
      restoreIdempotencyKey: null,
      purgeIdempotencyKey: null,
    };
    this.trashEntries.set(trashId, entry);
    this.documents.delete(request.path);
    return entry;
  }

  readTrash(states?: readonly TrashState[]): TrashEntry[] {
    return [...this.trashEntries.values()].filter(
      (entry) => !states || states.includes(entry.state),
    );
  }

  markTrashClean(trashId: string): TrashEntry {
    const current = this.requireTrash(trashId);
    const clean = {
      ...current,
      state: 'trashed' as const,
      cleanupAttempts: current.cleanupAttempts + 1,
    };
    this.trashEntries.set(trashId, clean);
    return clean;
  }

  markTrashRestored(trashId: string): TrashEntry {
    const current = this.requireTrash(trashId);
    const restored = {
      ...current,
      state: 'restored' as const,
      restoredAt: 30,
    };
    this.trashEntries.set(trashId, restored);
    return restored;
  }

  restoreTrash(request: {
    trashId: string;
    expectedRevision: string;
    idempotencyKey: string;
  }): TrashEntry {
    if (this.restoreFailure) throw this.restoreFailure;
    const current = this.requireTrash(request.trashId);
    const restored = {
      ...current,
      state: this.restoreState,
      restoredAt: this.restoreState === 'restored' ? 30 : null,
      restoreIdempotencyKey: request.idempotencyKey,
    };
    this.trashEntries.set(request.trashId, restored);
    return restored;
  }

  purgeTrash(request: {
    trashId: string;
    expectedRevision: string;
    idempotencyKey: string;
  }): TrashEntry {
    if (this.purgeFailure) throw this.purgeFailure;
    const current = this.requireTrash(request.trashId);
    const purged = {
      ...current,
      state: 'purged' as const,
      purgedAt: 40,
      purgeIdempotencyKey: request.idempotencyKey,
    };
    this.trashEntries.set(request.trashId, purged);
    return purged;
  }

  setKgStatus(notePath: string, status: PendingEntry['status']): void {
    if (this.statusFailurePaths.has(notePath)) throw new Error('status unavailable');
    this.statuses.push([notePath, status]);
  }

  listKgPending(): PendingEntry[] {
    return this.pendingRows.map((entry) => ({ ...entry }));
  }

  close(): void {
    this.closed = true;
  }

  private requireTrash(trashId: string): TrashEntry {
    const current = this.trashEntries.get(trashId);
    if (!current) throw codedError('TRASH_NOT_FOUND');
    return current;
  }
}

function entry(
  overrides: Partial<TrashEntry> = {},
): TrashEntry {
  const originalPath = overrides.originalPath ?? 'notes/deleted';
  return {
    trashId: overrides.trashId ?? 'trash-fixture',
    kind: overrides.kind ?? 'note',
    originalPath,
    originalRevision: overrides.originalRevision ?? 'note:20',
    trashRevision: overrides.trashRevision ?? 'trash:fixture:20',
    state: overrides.state ?? 'trashed',
    movedAt: overrides.movedAt ?? 20,
    restoredAt: overrides.restoredAt ?? null,
    purgedAt: overrides.purgedAt ?? null,
    cleanupAttempts: overrides.cleanupAttempts ?? 1,
    metadataJson: overrides.metadataJson ?? JSON.stringify({ note: { title: ' Deleted title ' } }),
    contentSha256: overrides.contentSha256 ?? 'b'.repeat(64),
    idempotencyKey: overrides.idempotencyKey ?? 'move-key',
    inputSha256: overrides.inputSha256 ?? 'c'.repeat(64),
    restoreIdempotencyKey: overrides.restoreIdempotencyKey ?? null,
    purgeIdempotencyKey: overrides.purgeIdempotencyKey ?? null,
  };
}

function createHarness(overrides: {
  kb?: MemoryKb;
  kg?: Record<string, unknown>;
  rag?: Record<string, unknown>;
  settings?: { get(key: string): unknown };
  cloudBackup?: { enqueue(event: { operation: string; path: string }): Promise<void> };
} = {}) {
  const kb = overrides.kb ?? new MemoryKb();
  const kg = {
    getSubgraph: vi.fn(async (): Promise<KgSubgraph> => ({ nodes: [], edges: [], degree: {} })),
    reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 1, status: 'done' as const })),
    wikiForNote: vi.fn(async (document: { note: { path: string } }) => currentWiki(document.note.path)),
    removeNote: vi.fn(async () => undefined),
    relatedNotes: vi.fn(async () => []),
    close: vi.fn(),
    ...overrides.kg,
  };
  const rag = {
    indexNote: vi.fn(async () => ({ chunksInserted: 1, errors: [] as string[] })),
    deleteNote: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ text: '', sources: [] as string[] })),
    close: vi.fn(async () => undefined),
    ...overrides.rag,
  };
  const settings = overrides.settings ?? { get: () => false };
  const service = new LocalKnowledgeService({
    kb,
    kg,
    rag,
    settings,
    cloudBackup: overrides.cloudBackup,
    clock: () => 100,
    uuid: () => 'todo-1',
  } as unknown as LocalKnowledgeServiceOptions);
  return { service, kb, kg, rag, settings };
}

function importedNote(path = `${IMPORT_NAMESPACE}/notes/one`): CreateNoteRequest & { importMarker: string } {
  return {
    path,
    title: 'Imported note',
    body: 'local imported body',
    tags: [IMPORT_MARKER, 'local'],
    importMarker: IMPORT_MARKER,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local knowledge synchronous and WIKI boundaries', () => {
  it('rejects reserved synchronous build tags and validates direct Trash moves', async () => {
    const { service } = createHarness();
    await expect(service.notes.createWithBuild({
      path: 'notes/create-reserved',
      title: 'reserved',
      body: 'body',
      tags: [TODO_TAG],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await service.notes.create({ path: 'notes/update-reserved', title: 'note', body: 'body' });
    await expect(service.notes.updateWithBuild({
      path: 'notes/update-reserved',
      patch: { tags: [TODO_TAG] },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    for (const request of [
      null,
      { path: '', expectedRevision: 'note:1', idempotencyKey: 'key' },
      { path: 'notes/a', expectedRevision: '', idempotencyKey: 'key' },
      { path: 'notes/a', expectedRevision: 'note:1', idempotencyKey: '' },
    ]) {
      await expect(service.notes.moveToTrash(request as never))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('returns fail-closed WIKI truth errors without exposing provider details', async () => {
    const missing = createHarness();
    await expect(missing.service.wiki.getForNote('notes/missing'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    const noWiki = createHarness({ kg: { wikiForNote: undefined } });
    noWiki.kb.createNote({ path: 'notes/no-wiki', title: 'No wiki', body: 'body' });
    await expect(noWiki.service.wiki.getForNote('notes/no-wiki'))
      .rejects.toMatchObject({ code: 'INTERNAL', message: 'local WIKI query is unavailable' });

    const offline = createHarness({
      kg: { wikiForNote: vi.fn(async () => { throw codedError('network'); }) },
    });
    offline.kb.createNote({ path: 'notes/offline', title: 'Offline', body: 'body' });
    await expect(offline.service.wiki.getForNote('notes/offline'))
      .rejects.toMatchObject({ code: 'OFFLINE' });
  });
});

describe('backup import ownership and rollback boundary', () => {
  it('creates namespaced notes and Todos and exposes exact existence checks', async () => {
    const { service, kb } = createHarness();
    expect(await service.backupImport.noteExists(`${IMPORT_NAMESPACE}/notes/one`)).toBe(false);
    expect(await service.backupImport.todoExists(`${IMPORT_NAMESPACE}-todo-1`)).toBe(false);

    await service.backupImport.createNote(importedNote());
    await service.backupImport.createTodo(todo(), IMPORT_NAMESPACE);
    expect(await service.backupImport.noteExists(`${IMPORT_NAMESPACE}/notes/one`)).toBe(true);
    expect(await service.backupImport.todoExists(`${IMPORT_NAMESPACE}-todo-1`)).toBe(true);
    expect(kb.readNote(`${IMPORT_NAMESPACE}/notes/one`)?.note.tags).toContain(IMPORT_MARKER);
    expect(kb.readNote(`system/todos/${IMPORT_NAMESPACE}-todo-1`)?.note.tags)
      .toEqual([TODO_TAG, IMPORT_MARKER]);

    await expect(service.backupImport.createNote(importedNote()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('already exists') });
    await expect(service.backupImport.createTodo(todo(), IMPORT_NAMESPACE))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('already exists') });
  });

  it('rejects marker, namespace, impersonation, and metadata violations before mutation', async () => {
    const { service, kb } = createHarness();
    const invalidNotes: Array<CreateNoteRequest & { importMarker: string }> = [
      { ...importedNote('import-a/notes/missing-marker'), tags: ['local'] },
      { ...importedNote('import-a/notes/system'), tags: [IMPORT_MARKER, TODO_TAG] },
      { ...importedNote('import-a/notes/blank-marker'), importMarker: '' },
    ];
    for (const request of invalidNotes) {
      await expect(service.backupImport.createNote(request))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }

    const invalidTodos = [
      [todo('outside-todo-1'), IMPORT_NAMESPACE],
      [todo(`${IMPORT_NAMESPACE}-todo-bad-reminder`, { reminder_fired: 2 as never }), IMPORT_NAMESPACE],
      [todo(`${IMPORT_NAMESPACE}-todo-bad-created`, { created_at: -1 }), IMPORT_NAMESPACE],
      [todo(`${IMPORT_NAMESPACE}-todo-bad-updated`, { created_at: 20, updated_at: 10 }), IMPORT_NAMESPACE],
      [todo(`${IMPORT_NAMESPACE}-todo-bad-title`, { title: '' }), IMPORT_NAMESPACE],
    ] as const;
    for (const [record, namespace] of invalidTodos) {
      await expect(service.backupImport.createTodo(record, namespace))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(kb.documents.size).toBe(0);
  });

  it('rolls back only owned objects in reverse order and cleans both local indexes', async () => {
    const { service, kb, kg, rag } = createHarness();
    const first = `${IMPORT_NAMESPACE}/notes/first`;
    const second = `${IMPORT_NAMESPACE}/notes/second`;
    await service.backupImport.createNote(importedNote(first));
    await service.backupImport.createNote(importedNote(second));
    await service.backupImport.createTodo(todo(`${IMPORT_NAMESPACE}-todo-1`), IMPORT_NAMESPACE);
    await service.backupImport.createTodo(todo(`${IMPORT_NAMESPACE}-todo-2`), IMPORT_NAMESPACE);

    const deletionOrder: string[] = [];
    const originalDelete = kb.deleteNote.bind(kb);
    vi.spyOn(kb, 'deleteNote').mockImplementation((path) => {
      deletionOrder.push(path);
      return originalDelete(path);
    });

    await service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [first, second],
      todoIds: [`${IMPORT_NAMESPACE}-todo-1`, `${IMPORT_NAMESPACE}-todo-2`],
    });

    expect(deletionOrder).toEqual([
      `system/todos/${IMPORT_NAMESPACE}-todo-2`,
      `system/todos/${IMPORT_NAMESPACE}-todo-1`,
      second,
      first,
    ]);
    expect(kg.removeNote).toHaveBeenNthCalledWith(1, second);
    expect(kg.removeNote).toHaveBeenNthCalledWith(2, first);
    expect(rag.deleteNote).toHaveBeenNthCalledWith(1, second);
    expect(rag.deleteNote).toHaveBeenNthCalledWith(2, first);
    expect(kb.documents.size).toBe(0);
  });

  it('blocks rollback namespace escape, non-owned rows, and durable delete failures', async () => {
    const escaped = createHarness();
    await expect(escaped.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: ['outside/notes/a'],
      todoIds: [],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(escaped.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [],
      todoIds: ['outside-todo-1'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    const nonOwned = createHarness();
    nonOwned.kb.createNote({
      path: `${IMPORT_NAMESPACE}/notes/non-owned`,
      title: 'non-owned',
      body: 'body',
      tags: ['local'],
    });
    nonOwned.kb.createNote({
      path: `system/todos/${IMPORT_NAMESPACE}-todo-non-owned`,
      title: 'non-owned Todo',
      type: 'todo',
      body: JSON.stringify(todo(`${IMPORT_NAMESPACE}-todo-non-owned`)),
      tags: [TODO_TAG],
    });
    await expect(nonOwned.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [`${IMPORT_NAMESPACE}/notes/non-owned`],
      todoIds: [],
    })).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('non-owned note') });
    await expect(nonOwned.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [],
      todoIds: [`${IMPORT_NAMESPACE}-todo-non-owned`],
    })).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('non-owned Todo') });

    const failures = createHarness();
    await failures.service.backupImport.createNote(importedNote());
    await failures.service.backupImport.createTodo(todo(), IMPORT_NAMESPACE);
    failures.kb.deleteFailurePaths.add(`${IMPORT_NAMESPACE}/notes/one`);
    await expect(failures.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [`${IMPORT_NAMESPACE}/notes/one`],
      todoIds: [],
    })).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('note rollback failed') });
    failures.kb.deleteFailurePaths.clear();
    failures.kb.deleteFailurePaths.add(`system/todos/${IMPORT_NAMESPACE}-todo-1`);
    await expect(failures.service.backupImport.rollback({
      importNamespace: IMPORT_NAMESPACE,
      notePaths: [],
      todoIds: [`${IMPORT_NAMESPACE}-todo-1`],
    })).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('Todo rollback failed') });
  });
});

describe('reversible Trash public surface and error normalization', () => {
  it('lists safe titles and generic fallbacks while hiding private metadata', async () => {
    const { service, kb } = createHarness();
    kb.trashEntries.set('valid', entry({ trashId: 'valid' }));
    kb.trashEntries.set('bad-note', entry({
      trashId: 'bad-note',
      metadataJson: '{private-corrupt',
    }));
    kb.trashEntries.set('bad-todo', entry({
      trashId: 'bad-todo',
      kind: 'todo',
      metadataJson: JSON.stringify({ note: { title: 'bad\u0000title' } }),
    }));

    await expect(service.trash.list()).resolves.toEqual([
      expect.objectContaining({ trashId: 'valid', title: 'Deleted title' }),
      expect.objectContaining({ trashId: 'bad-note', title: '已删除笔记' }),
      expect.objectContaining({ trashId: 'bad-todo', title: '已删除待办' }),
    ]);
  });

  it('rejects missing Trash fields and missing optional storage ports', async () => {
    const { service, kb } = createHarness();
    for (const request of [
      null,
      { trashId: '', expectedRevision: 'trash:1', idempotencyKey: 'key' },
      { trashId: 'trash-1', expectedRevision: '', idempotencyKey: 'key' },
      { trashId: 'trash-1', expectedRevision: 'trash:1', idempotencyKey: '' },
    ]) {
      await expect(service.trash.restore(request as never))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(service.trash.purge(request as never))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }

    (kb as unknown as { readTrash?: unknown }).readTrash = undefined;
    await expect(service.trash.list())
      .rejects.toMatchObject({ code: 'INTERNAL', message: 'reversible trash is unavailable' });
  });

  it.each([
    ['TRASH_NOT_FOUND', 'NOT_FOUND', 'local item was not found'],
    ['TRASH_INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'trash request is invalid'],
    ['TRASH_REVISION_CONFLICT', 'INVALID_ARGUMENT', 'trash item changed; refresh and retry'],
    ['TRASH_IDEMPOTENCY_CONFLICT', 'INVALID_ARGUMENT', 'trash item changed; refresh and retry'],
    ['TRASH_RESTORE_CONFLICT', 'INVALID_ARGUMENT', 'restore destination already exists'],
    ['TRASH_RECOVERY_REQUIRED', 'INTERNAL', 'trash recovery is required'],
    ['TRASH_FILE_UNSAFE', 'INTERNAL', 'trash recovery is required'],
    ['UNKNOWN_PRIVATE', 'INTERNAL', 'reversible trash operation failed'],
  ])('maps %s without leaking raw storage errors', async (raw, code, message) => {
    const { service, kb } = createHarness();
    kb.trashEntries.set('trash-1', entry({ trashId: 'trash-1' }));
    kb.restoreFailure = codedError(raw);
    await expect(service.trash.restore({
      trashId: 'trash-1',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'restore-key',
    })).rejects.toMatchObject({ code, message });

    kb.restoreFailure = null;
    kb.purgeFailure = codedError(raw);
    await expect(service.trash.purge({
      trashId: 'trash-1',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'purge-key',
    })).rejects.toMatchObject({ code, message });
  });

  it('normalizes direct move failures and rejects recovery-only move states', async () => {
    const { service, kb } = createHarness();
    kb.createNote({ path: 'notes/move', title: 'Move', body: 'body' });
    kb.moveFailure = codedError('TRASH_REVISION_CONFLICT');
    await expect(service.notes.moveToTrash({
      path: 'notes/move',
      expectedRevision: 'note:20',
      idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    kb.moveFailure = null;
    const original = kb.moveNoteToTrash.bind(kb);
    vi.spyOn(kb, 'moveNoteToTrash').mockImplementation((request) => ({
      ...original(request),
      state: 'prepared',
    }));
    kb.createNote({ path: 'notes/prepared', title: 'Prepared', body: 'body' });
    await expect(service.notes.moveToTrash({
      path: 'notes/prepared',
      expectedRevision: 'note:20',
      idempotencyKey: 'key-2',
    })).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('trash entry requires recovery'),
    });
  });

  it('returns direct restore/purge receipts and rebuilds an item left in restoring state', async () => {
    const direct = createHarness();
    direct.kb.trashEntries.set('direct', entry({ trashId: 'direct' }));
    await expect(direct.service.trash.restore({
      trashId: 'direct',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'restore-key',
    })).resolves.toMatchObject({ state: 'restored', title: 'Deleted title' });
    await expect(direct.service.trash.purge({
      trashId: 'direct',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'purge-key',
    })).resolves.toMatchObject({ state: 'purged' });

    const recovering = createHarness();
    recovering.kb.restoreState = 'restoring';
    recovering.kb.documents.set('notes/restored', {
      note: wire('notes/restored', { title: 'Restored' }),
      body: 'restored body',
    });
    recovering.kb.trashEntries.set('recovering', entry({
      trashId: 'recovering',
      originalPath: 'notes/restored',
      state: 'trashed',
    }));
    await expect(recovering.service.trash.restore({
      trashId: 'recovering',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'restore-recovering',
    })).resolves.toMatchObject({ state: 'restored' });
    expect(recovering.kg.reindexNote).toHaveBeenCalled();
    expect(recovering.rag.indexNote).toHaveBeenCalled();
  });

  it('fails closed when restored metadata or rebuilt indexes are unavailable', async () => {
    const missing = createHarness();
    missing.kb.restoreState = 'restoring';
    missing.kb.trashEntries.set('missing', entry({
      trashId: 'missing',
      originalPath: 'notes/missing-restored',
    }));
    await expect(missing.service.trash.restore({
      trashId: 'missing',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'restore-missing',
    })).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'restored note metadata is unavailable',
    });

    const failed = createHarness({
      kg: { reindexNote: vi.fn(async () => { throw new Error('private build failure'); }) },
    });
    failed.kb.restoreState = 'restoring';
    failed.kb.documents.set('notes/failed-restore', {
      note: wire('notes/failed-restore'),
      body: 'body',
    });
    failed.kb.trashEntries.set('failed', entry({
      trashId: 'failed',
      originalPath: 'notes/failed-restore',
    }));
    await expect(failed.service.trash.restore({
      trashId: 'failed',
      expectedRevision: 'trash:fixture:20',
      idempotencyKey: 'restore-failed',
    })).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('restored note build failed'),
    });
  });
});

describe('startup reconciliation and optional lifecycle', () => {
  it('completes cleanup-pending and restoring Trash entries during startup', async () => {
    const { service, kb, kg, rag } = createHarness();
    kb.documents.set('notes/restoring', {
      note: wire('notes/restoring'),
      body: 'restoring body',
    });
    kb.trashEntries.set('cleanup', entry({
      trashId: 'cleanup',
      originalPath: 'notes/cleanup',
      state: 'cleanup_pending',
      cleanupAttempts: 0,
    }));
    kb.trashEntries.set('restoring', entry({
      trashId: 'restoring',
      originalPath: 'notes/restoring',
      state: 'restoring',
    }));

    await service.reconcileTrashStartup();
    expect(kb.trashEntries.get('cleanup')?.state).toBe('trashed');
    expect(kb.trashEntries.get('restoring')?.state).toBe('restored');
    expect(kg.removeNote).toHaveBeenCalledWith('notes/cleanup');
    expect(rag.deleteNote).toHaveBeenCalledWith('notes/cleanup');
  });

  it('requeues durable knowledge work, skips unsafe processing rows, and closes every port', async () => {
    const { service, kb, kg, rag } = createHarness();
    kb.pendingRows = [
      { note_path: 'notes/pending-missing', status: 'pending', queued_at: 1 },
      { note_path: 'notes/processing-missing', status: 'processing', queued_at: 2 },
      { note_path: 'notes/done', status: 'done', queued_at: 3 },
    ];
    kb.statusFailurePaths.add('notes/processing-missing');
    service.reconcileKnowledgeBuildStartup();
    await service.close();

    expect(kb.closed).toBe(true);
    expect(kg.close).toHaveBeenCalledTimes(1);
    expect(rag.close).toHaveBeenCalledTimes(1);
    expect(kb.statuses).not.toContainEqual(['notes/done', 'pending']);
  });

  it('is a no-op when optional reconciliation ports are absent', async () => {
    const { service, kb } = createHarness();
    (kb as unknown as { readTrash?: unknown }).readTrash = undefined;
    (kb as unknown as { listKgPending?: unknown }).listKgPending = undefined;
    await expect(service.reconcileTrashStartup()).resolves.toBeUndefined();
    expect(() => service.reconcileKnowledgeBuildStartup()).not.toThrow();
  });
});

describe('stable external error categories', () => {
  it.each([
    ['auth', 'CONFIG_REQUIRED', '[MODEL_AUTH]'],
    ['rate_limit', 'OFFLINE', '[MODEL_RATE_LIMIT]'],
    ['token_limit_local', 'OFFLINE', '[MODEL_RATE_LIMIT]'],
    ['server', 'OFFLINE', '[MODEL_PROVIDER]'],
    ['network', 'OFFLINE', '[MODEL_OFFLINE]'],
    ['timeout', 'OFFLINE', '[MODEL_TIMEOUT]'],
    ['abort', 'OFFLINE', '[MODEL_CANCELLED]'],
    ['config', 'CONFIG_REQUIRED', '[MODEL_CONFIGURATION]'],
    ['bad_request', 'CONFIG_REQUIRED', '[MODEL_CONFIGURATION]'],
  ])('projects %s from RAG without leaking raw detail', async (raw, code, prefix) => {
    const { service } = createHarness({
      rag: { ask: vi.fn(async () => { throw codedError(raw); }), stream: undefined },
    });
    await expect(service.rag.ask('question')).rejects.toMatchObject({
      code,
      message: expect.stringContaining(prefix),
    });
  });

  it('preserves curated domain failures and normalizes unknown provider errors', async () => {
    const curated = createHarness({
      rag: {
        ask: vi.fn(async () => { throw new DomainServiceError('CONFIG_REQUIRED', 'safe reason'); }),
        stream: undefined,
      },
    });
    await expect(curated.service.rag.ask('question'))
      .rejects.toMatchObject({ code: 'CONFIG_REQUIRED', message: 'safe reason' });

    const unknown = createHarness({
      rag: { ask: vi.fn(async () => { throw new Error('private database detail'); }), stream: undefined },
    });
    await expect(unknown.service.rag.ask('question'))
      .rejects.toMatchObject({ code: 'INTERNAL', message: 'local knowledge operation failed' });
  });
});
