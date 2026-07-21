/**
 * Main-process orchestration for the local-first Copilot domain.
 *
 * Native/package implementations are loaded only by the production factory.
 * The service itself depends on narrow ports, which keeps IPC tests hermetic
 * and lets the still-evolving KG/Todo package exports change independently.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  BacklinkRecord,
  CreateNoteRequest,
  CreateTodoRequest,
  KgEntity,
  KgRelation,
  KgSubgraph,
  KgSubgraphRequest,
  ListNotesRequest,
  ListTodosRequest,
  NoteDocument,
  NoteList,
  NoteRecord,
  RagAnswer,
  RagRetrievalEvidence,
  RagSourceDetail,
  RagStreamChunk,
  ReindexResult,
  TodoId,
  TodoRecord,
  UpdateNoteRequest,
  UpdateTodoRequest,
} from '../shared/domain-api.js';
import type { SettingsStorage } from './settings-store.js';
import {
  ModelCredentialError,
  credentialBinding,
  type ModelCredentialStore,
} from './model-credential-store.js';

type DomainErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'OFFLINE'
  | 'CONFIG_REQUIRED'
  | 'INTERNAL';

export class DomainServiceError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainServiceError';
  }
}

interface KbNoteWire {
  id: number;
  path: string;
  title: string;
  type: NoteRecord['type'];
  status: NoteRecord['status'];
  tags: string[];
  related: string[];
  folder: string;
  created_at: number;
  updated_at: number;
  confidence: number | null;
  agent: string | null;
}

type LocalTrashState =
  | 'prepared'
  | 'cleanup_pending'
  | 'trashed'
  | 'restoring'
  | 'restored'
  | 'purging'
  | 'purged';

export interface LocalTrashEntry {
  trashId: string;
  kind: 'note' | 'todo';
  originalPath: string;
  originalRevision: string;
  trashRevision: string;
  state: LocalTrashState;
  movedAt: number;
  restoredAt: number | null;
  purgedAt: number | null;
  cleanupAttempts: number;
  /** Safe display title parsed in main; never a filesystem path. */
  title: string;
}

interface KbTrashEntryWire extends LocalTrashEntry {
  metadataJson: string;
  contentSha256: string;
  idempotencyKey: string;
  inputSha256: string;
  restoreIdempotencyKey: string | null;
  purgeIdempotencyKey: string | null;
}

interface KbPort {
  createNote(input: Omit<CreateNoteRequest, 'transcript'> & { body: string }): KbNoteWire;
  readNote(path: string): { note: KbNoteWire; body: string } | null;
  updateNote(path: string, patch: UpdateNoteRequest['patch']): KbNoteWire | null;
  deleteNote(path: string): boolean;
  listNotes(filter?: ListNotesRequest): {
    items: KbNoteWire[];
    total: number;
    limit: number;
    offset: number;
  };
  listLinks(path: string): {
    in: Array<{ from_path: string; to_path: string; rel: string | null }>;
  };
  moveNoteToTrash?(request: {
    path: string;
    kind: 'note' | 'todo';
    expectedRevision: string;
    idempotencyKey: string;
  }): KbTrashEntryWire;
  readTrash?(states?: readonly LocalTrashState[]): KbTrashEntryWire[];
  markTrashClean?(trashId: string): KbTrashEntryWire;
  markTrashRestored?(trashId: string): KbTrashEntryWire;
  restoreTrash?(request: {
    trashId: string;
    expectedRevision: string;
    idempotencyKey: string;
  }): KbTrashEntryWire;
  purgeTrash?(request: {
    trashId: string;
    expectedRevision: string;
    idempotencyKey: string;
  }): KbTrashEntryWire;
  setKgStatus?(path: string, status: 'pending' | 'processing' | 'done' | 'failed'): void;
  close?(): void;
}

interface KgPort {
  getSubgraph(request?: KgSubgraphRequest | number): Promise<KgSubgraph>;
  reindexNote(note: NoteDocument): Promise<{
    entitiesAdded: number;
    entitiesLinked: number;
  }>;
  removeNote(notePath: string): Promise<void> | void;
  relatedNotes?(question: string, maxCandidates?: number): Promise<KgNoteCandidate[]> | KgNoteCandidate[];
  close?(): void;
}

interface KgNoteCandidate {
  notePath: string;
  score: number;
  evidence: RagRetrievalEvidence[];
}

interface RagPort {
  indexNote(note: NoteDocument): Promise<{ chunksInserted: number; errors: string[] }>;
  deleteNote(notePath: string): Promise<void>;
  ask(question: string): Promise<RagAnswer>;
  stream?(
    question: string,
    candidates: readonly KgNoteCandidate[],
    signal?: AbortSignal,
  ): AsyncGenerator<RagStreamChunk, RagAnswer>;
  close?(): Promise<void>;
}

export interface CloudBackupPort {
  /** Metadata only: note bodies and credentials must never leave this boundary. */
  enqueue(event: { operation: 'create' | 'update' | 'remove'; path: string }): Promise<void>;
}

export interface LocalKnowledgeServiceOptions {
  kb: KbPort;
  kg: KgPort;
  rag: RagPort;
  settings: Pick<SettingsStorage, 'get'>;
  cloudBackup?: CloudBackupPort;
  clock?: () => number;
  uuid?: () => string;
}

const TODO_TAG = '__copilot_todo__';
const TODO_PATH_PREFIX = 'system/todos/';

export class LocalKnowledgeService {
  private readonly kb: KbPort;
  private readonly kgPort: KgPort;
  private readonly ragPort: RagPort;
  private readonly settings: Pick<SettingsStorage, 'get'>;
  private readonly cloudBackup?: CloudBackupPort;
  private readonly clock: () => number;
  private readonly uuid: () => string;

  constructor(options: LocalKnowledgeServiceOptions) {
    this.kb = options.kb;
    this.kgPort = options.kg;
    this.ragPort = options.rag;
    this.settings = options.settings;
    this.cloudBackup = options.cloudBackup;
    this.clock = options.clock ?? Date.now;
    this.uuid = options.uuid ?? randomUUID;
  }

  readonly notes = {
    list: async (request?: ListNotesRequest): Promise<NoteList> => {
      const page = this.kb.listNotes(request);
      const visibleItems = page.items.filter((note) => !isSystemTodoNote(note));
      return {
        ...page,
        total: Math.max(0, page.total - (page.items.length - visibleItems.length)),
        items: visibleItems.map(toNoteRecord),
      };
    },

    get: async (notePath: string): Promise<NoteDocument | null> => {
      assertNonEmpty(notePath, 'note path');
      assertPublicNotePath(notePath);
      const result = this.kb.readNote(notePath);
      return result ? { note: toNoteRecord(result.note), body: result.body } : null;
    },

    create: async (request: CreateNoteRequest): Promise<NoteRecord> => {
      assertNoteCreate(request);
      assertPublicNotePath(request.path);
      if (request.tags?.includes(TODO_TAG)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'reserved system Todo tag is not allowed');
      }
      const body = request.body ?? request.transcript ?? '';
      const created = this.kb.createNote({ ...request, body });
      await this.maybeQueueBackup('create', created.path);
      return toNoteRecord(created);
    },

    update: async (request: UpdateNoteRequest): Promise<NoteRecord | null> => {
      assertNonEmpty(request?.path, 'note path');
      assertPublicNotePath(request.path);
      if (!request.patch || typeof request.patch !== 'object') {
        throw new DomainServiceError('INVALID_ARGUMENT', 'note patch is required');
      }
      if (request.patch.tags?.includes(TODO_TAG)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'reserved system Todo tag is not allowed');
      }
      const updated = this.kb.updateNote(request.path, request.patch);
      if (updated) await this.maybeQueueBackup('update', updated.path);
      return updated ? toNoteRecord(updated) : null;
    },

    remove: async (notePath: string): Promise<boolean> => {
      assertNonEmpty(notePath, 'note path');
      assertPublicNotePath(notePath);
      const current = this.kb.readNote(notePath);
      if (!current) return false;
      await this.notes.moveToTrash({
        path: notePath,
        expectedRevision: `note:${current.note.updated_at}`,
        idempotencyKey: randomUUID(),
      });
      return true;
    },

    moveToTrash: async (request: {
      path: string;
      expectedRevision: string;
      idempotencyKey: string;
    }): Promise<LocalTrashEntry> => {
      assertNonEmpty(request?.path, 'note path');
      assertNonEmpty(request?.expectedRevision, 'expected revision');
      assertNonEmpty(request?.idempotencyKey, 'idempotency key');
      assertPublicNotePath(request.path);
      const moved = this.moveToTrash({ ...request, kind: 'note' });
      const completed = await this.finishTrashCleanup(moved);
      await this.maybeQueueBackup('remove', request.path);
      return completed;
    },

    getBacklinks: async (notePath: string): Promise<BacklinkRecord[]> => {
      assertNonEmpty(notePath, 'note path');
      assertPublicNotePath(notePath);
      return this.kb.listLinks(notePath).in.map((link) => ({
        fromPath: link.from_path,
        toPath: link.to_path,
        relation: link.rel,
      }));
    },
  };

  readonly kg = {
    getSubgraph: (request?: KgSubgraphRequest | number): Promise<KgSubgraph> =>
      this.kgPort.getSubgraph(request),

    reindexNote: async (notePath: string): Promise<ReindexResult> => {
      assertNonEmpty(notePath, 'note path');
      const document = await this.notes.get(notePath);
      if (!document) throw new DomainServiceError('NOT_FOUND', 'note was not found');
      this.kb.setKgStatus?.(notePath, 'processing');
      try {
        const kg = await this.kgPort.reindexNote(document);
        const rag = await this.ragPort.indexNote(document);
        this.kb.setKgStatus?.(notePath, rag.errors.length ? 'failed' : 'done');
        return {
          notePath,
          entitiesAdded: kg.entitiesAdded,
          entitiesLinked: kg.entitiesLinked,
          ragChunksInserted: rag.chunksInserted,
          errors: rag.errors,
        };
      } catch (error) {
        this.kb.setKgStatus?.(notePath, 'failed');
        throw normalizeExternalError(error);
      }
    },
  };

  readonly rag = {
    ask: async (question: string): Promise<RagAnswer> => {
      assertNonEmpty(question, 'question');
      try {
        const iterator = this.streamRag(question.trim());
        let item = await iterator.next();
        while (!item.done) item = await iterator.next();
        return normalizeRagAnswer(item.value);
      } catch (error) {
        throw normalizeExternalError(error);
      }
    },

    stream: (question: string, signal?: AbortSignal): AsyncGenerator<RagStreamChunk, RagAnswer> => {
      assertNonEmpty(question, 'question');
      return this.streamRag(question.trim(), signal);
    },
  };

  readonly todos = {
    list: async (request?: ListTodosRequest): Promise<TodoRecord[]> => {
      const records = this.readAllTodos();
      return records.filter((todo) => {
        if (request?.status && todo.status !== request.status) return false;
        if (request?.fromMs !== undefined && (todo.due_at_ms ?? Number.NEGATIVE_INFINITY) < request.fromMs) return false;
        if (request?.toMs !== undefined && (todo.due_at_ms ?? Number.POSITIVE_INFINITY) > request.toMs) return false;
        return true;
      });
    },

    create: async (request: CreateTodoRequest): Promise<TodoRecord> => {
      const todo = createTodoRecord(request, this.uuid(), this.clock());
      this.kb.createNote({
        path: todoPath(todo.id),
        title: todo.title,
        type: 'todo',
        status: 'active',
        tags: [TODO_TAG],
        related: todo.note_links,
        body: serializeTodo(todo),
      });
      return todo;
    },

    update: async (request: UpdateTodoRequest): Promise<TodoRecord | null> => {
      if (request?.id === undefined) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'todo id is required');
      }
      const current = this.readTodo(request.id);
      if (!current) return null;
      const next = updateTodoRecord(current, request.patch, this.clock());
      this.kb.updateNote(todoPath(request.id), {
        title: next.title,
        status: next.status === 'cancelled' ? 'archived' : 'active',
        related: next.note_links,
        body: serializeTodo(next),
      });
      return next;
    },

    remove: async (id: TodoId): Promise<boolean> => {
      assertTodoId(id);
      const current = this.readTodo(id);
      if (!current) return false;
      await this.todos.moveToTrash({
        id,
        expectedRevision: `todo:${current.updated_at}`,
        idempotencyKey: randomUUID(),
      });
      return true;
    },

    moveToTrash: async (request: {
      id: TodoId;
      expectedRevision: string;
      idempotencyKey: string;
    }): Promise<LocalTrashEntry> => {
      assertTodoId(request?.id);
      assertNonEmpty(request?.expectedRevision, 'expected revision');
      assertNonEmpty(request?.idempotencyKey, 'idempotency key');
      const current = this.readTodo(request.id);
      if (!current || String(current.id) !== String(request.id)) {
        throw new DomainServiceError('NOT_FOUND', 'Todo was not found');
      }
      const moved = this.moveToTrash({
        path: todoPath(request.id),
        kind: 'todo',
        expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey,
      });
      return this.finishTrashCleanup(moved);
    },

    listDue: async (now = this.clock()): Promise<TodoRecord[]> => {
      if (!Number.isFinite(now)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'now must be a finite epoch milliseconds value');
      }
      return this.readAllTodos().filter(
        (todo) =>
          todo.status === 'pending' &&
          todo.reminder_fired === 0 &&
          todo.remind_at_ms !== null &&
          todo.remind_at_ms <= now,
      );
    },

    markReminderFired: async (id: TodoId): Promise<TodoRecord | null> => {
      assertTodoId(id);
      return this.todos.update({ id, patch: { reminder_fired: 1 } });
    },
  };

  /**
   * Main-only restore importer. It deliberately bypasses Trash and cloud
   * enqueueing so rollback can remove only objects owned by one durable import
   * intent without leaving user-visible Trash residue.
   */
  readonly backupImport = {
    noteExists: async (notePath: string): Promise<boolean> => {
      assertNonEmpty(notePath, 'backup import note path');
      assertPublicNotePath(notePath);
      return this.kb.readNote(notePath) !== null;
    },

    todoExists: async (id: string): Promise<boolean> => {
      assertNonEmpty(id, 'backup import Todo id');
      return this.readTodo(id) !== null;
    },

    createNote: async (request: CreateNoteRequest & { importMarker: string }): Promise<void> => {
      assertNoteCreate(request);
      assertPublicNotePath(request.path);
      assertNonEmpty(request.importMarker, 'backup import marker');
      if (!request.tags?.includes(request.importMarker)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import marker is required');
      }
      if (request.tags.includes(TODO_TAG)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import note cannot impersonate a system Todo');
      }
      if (this.kb.readNote(request.path)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import note path already exists');
      }
      this.kb.createNote({ ...request, body: request.body ?? '' });
    },

    createTodo: async (todo: TodoRecord, importNamespace: string): Promise<void> => {
      assertNonEmpty(importNamespace, 'backup import namespace');
      const importMarker = `__backup_import__:${importNamespace}`;
      if (typeof todo.id !== 'string' || !todo.id.startsWith(`${importNamespace}-todo-`)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import Todo id is outside its namespace');
      }
      assertNonEmpty(todo.title, 'todo title');
      validateTodoStatus(todo.status);
      validateTodoPriority(todo.priority);
      validateOptionalEpoch(todo.due_at_ms, 'due_at_ms');
      validateOptionalEpoch(todo.remind_at_ms, 'remind_at_ms');
      if ((todo.reminder_fired !== 0 && todo.reminder_fired !== 1)
        || !Number.isSafeInteger(todo.created_at) || todo.created_at < 0
        || !Number.isSafeInteger(todo.updated_at) || todo.updated_at < todo.created_at) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import Todo metadata is invalid');
      }
      if (this.kb.readNote(todoPath(todo.id))) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'backup import Todo id already exists');
      }
      this.kb.createNote({
        path: todoPath(todo.id),
        title: todo.title,
        type: 'todo',
        status: todo.status === 'cancelled' ? 'archived' : 'active',
        tags: [TODO_TAG, importMarker],
        related: [...todo.note_links],
        body: serializeTodo({ ...todo, note_links: [...todo.note_links] }),
      });
    },

    rollback: async (request: {
      importNamespace: string;
      notePaths: readonly string[];
      todoIds: readonly string[];
    }): Promise<void> => {
      const marker = `__backup_import__:${request.importNamespace}`;
      for (const id of [...request.todoIds].reverse()) {
        if (typeof id !== 'string' || !id.startsWith(`${request.importNamespace}-todo-`)) {
          throw new DomainServiceError('INVALID_ARGUMENT', 'backup import Todo rollback escaped its namespace');
        }
        const underlying = this.kb.readNote(todoPath(id));
        if (underlying && !underlying.note.tags.includes(marker)) {
          throw new DomainServiceError('INTERNAL', 'backup import rollback found non-owned Todo');
        }
        if (underlying && !this.kb.deleteNote(todoPath(id))) {
          throw new DomainServiceError('INTERNAL', 'backup import Todo rollback failed');
        }
      }
      for (const notePath of [...request.notePaths].reverse()) {
        if (typeof notePath !== 'string' || !notePath.startsWith(`${request.importNamespace}/notes/`)) {
          throw new DomainServiceError('INVALID_ARGUMENT', 'backup import note rollback escaped its namespace');
        }
        const existing = this.kb.readNote(notePath);
        if (existing && !existing.note.tags.includes(marker)) {
          throw new DomainServiceError('INTERNAL', 'backup import rollback found non-owned note');
        }
        if (existing && !this.kb.deleteNote(notePath)) {
          throw new DomainServiceError('INTERNAL', 'backup import note rollback failed');
        }
        await this.kgPort.removeNote(notePath);
        await this.ragPort.deleteNote(notePath);
      }
    },
  };

  /** Local-owner-only lifecycle. Remote schemas intentionally expose none of these operations. */
  readonly trash = {
    list: async (): Promise<LocalTrashEntry[]> =>
      this.requireTrashPort('readTrash')().map(toLocalTrashEntry),

    restore: async (request: {
      trashId: string;
      expectedRevision: string;
      idempotencyKey: string;
    }): Promise<LocalTrashEntry> => {
      assertNonEmpty(request?.trashId, 'trash id');
      assertNonEmpty(request?.expectedRevision, 'expected revision');
      assertNonEmpty(request?.idempotencyKey, 'idempotency key');
      let restored: KbTrashEntryWire;
      try {
        restored = this.requireTrashPort('restoreTrash')(request);
      } catch (error) {
        throw normalizeTrashError(error);
      }
      if (restored.state === 'restoring') return this.finishRestoreIndex(restored);
      return toLocalTrashEntry(restored);
    },

    purge: async (request: {
      trashId: string;
      expectedRevision: string;
      idempotencyKey: string;
    }): Promise<LocalTrashEntry> => {
      assertNonEmpty(request?.trashId, 'trash id');
      assertNonEmpty(request?.expectedRevision, 'expected revision');
      assertNonEmpty(request?.idempotencyKey, 'idempotency key');
      try {
        return toLocalTrashEntry(this.requireTrashPort('purgeTrash')(request));
      } catch (error) {
        throw normalizeTrashError(error);
      }
    },
  };

  /** Completes idempotent KG/RAG cleanup left durable by a prior crash. */
  async reconcileTrashStartup(): Promise<void> {
    const readTrash = this.kb.readTrash;
    if (!readTrash) return;
    for (const entry of readTrash.call(this.kb, ['cleanup_pending'])) {
      await this.finishTrashCleanup(entry);
    }
    for (const entry of readTrash.call(this.kb, ['restoring'])) {
      // KbClient startup reconciliation leaves only an active, atomically
      // reinserted row in this state. Rebuild both indexes before completion.
      await this.finishRestoreIndex(entry);
    }
  }

  async close(): Promise<void> {
    await this.ragPort.close?.();
    this.kgPort.close?.();
    this.kb.close?.();
  }

  private async *streamRag(
    question: string,
    signal?: AbortSignal,
  ): AsyncGenerator<RagStreamChunk, RagAnswer> {
    try {
      const candidates = await this.kgPort.relatedNotes?.(question, 10) ?? [];
      if (!this.ragPort.stream) {
        const answer = normalizeRagAnswer(await this.ragPort.ask(question));
        if (answer.text) {
          yield {
            delta: answer.text,
            sourceDetails: answer.sourceDetails ?? answer.sources.map((notePath) => ({
              notePath,
              evidence: ['vector'],
              score: 0,
            })),
          };
        }
        return answer;
      }

      const iterator = this.ragPort.stream(question, candidates, signal);
      let item = await iterator.next();
      while (!item.done) {
        yield {
          delta: item.value.delta,
          sourceDetails: normalizeSourceDetails(item.value.sourceDetails),
        };
        item = await iterator.next();
      }
      return normalizeRagAnswer(item.value);
    } catch (error) {
      throw normalizeExternalError(error);
    }
  }

  private readTodo(id: TodoId): TodoRecord | null {
    assertTodoId(id);
    const document = this.kb.readNote(todoPath(id));
    return document ? parseTodo(document.body) : null;
  }

  private readAllTodos(): TodoRecord[] {
    const notes = this.kb.listNotes({ type: 'todo', tags: [TODO_TAG], limit: 1000 }).items;
    const out: TodoRecord[] = [];
    for (const note of notes) {
      const parsed = this.kb.readNote(note.path);
      const todo = parsed ? parseTodo(parsed.body) : null;
      if (todo) out.push(todo);
    }
    return out.sort((a, b) => a.created_at - b.created_at);
  }

  private async maybeQueueBackup(
    operation: 'create' | 'update' | 'remove',
    notePath: string,
  ): Promise<void> {
    // OFF is a deliberate hard no-op: no network adapter is even invoked.
    if (!this.settings.get('cloudBackupEnabled') || !this.cloudBackup) return;
    try {
      await this.cloudBackup.enqueue({ operation, path: notePath });
    } catch {
      // Local mutation remains authoritative; cloud backup is best-effort.
    }
  }

  private moveToTrash(request: {
    path: string;
    kind: 'note' | 'todo';
    expectedRevision: string;
    idempotencyKey: string;
  }): KbTrashEntryWire {
    try {
      return this.requireTrashPort('moveNoteToTrash')(request);
    } catch (error) {
      throw normalizeTrashError(error);
    }
  }

  private async finishTrashCleanup(entry: KbTrashEntryWire): Promise<LocalTrashEntry> {
    if (entry.state === 'trashed') return toLocalTrashEntry(entry);
    if (entry.state !== 'cleanup_pending') {
      throw new DomainServiceError('INTERNAL', `trash entry requires recovery: ${entry.state}`);
    }
    try {
      await Promise.all([
        this.kgPort.removeNote(entry.originalPath),
        this.ragPort.deleteNote(entry.originalPath),
      ]);
      const clean = this.requireTrashPort('markTrashClean')(entry.trashId);
      return toLocalTrashEntry(clean);
    } catch (error) {
      throw normalizeExternalError(error);
    }
  }

  private async finishRestoreIndex(entry: KbTrashEntryWire): Promise<LocalTrashEntry> {
    await this.reindexRestoredItem(entry.originalPath);
    const completed = this.requireTrashPort('markTrashRestored')(entry.trashId);
    return toLocalTrashEntry(completed);
  }

  private async reindexRestoredItem(notePath: string): Promise<void> {
    const raw = this.kb.readNote(notePath);
    if (!raw) throw new DomainServiceError('INTERNAL', 'restored note metadata is unavailable');
    const document = { note: toNoteRecord(raw.note), body: raw.body };
    this.kb.setKgStatus?.(notePath, 'processing');
    try {
      const kg = await this.kgPort.reindexNote(document);
      const rag = await this.ragPort.indexNote(document);
      void kg;
      this.kb.setKgStatus?.(notePath, rag.errors.length ? 'failed' : 'done');
      if (rag.errors.length) {
        throw new DomainServiceError('INTERNAL', 'restored note RAG indexing failed');
      }
    } catch (error) {
      this.kb.setKgStatus?.(notePath, 'failed');
      throw normalizeExternalError(error);
    }
  }

  private requireTrashPort<T extends keyof Pick<
    KbPort,
    'moveNoteToTrash' | 'readTrash' | 'markTrashClean' | 'markTrashRestored' | 'restoreTrash' | 'purgeTrash'
  >>(name: T): NonNullable<KbPort[T]> {
    const operation = this.kb[name];
    if (!operation) throw new DomainServiceError('INTERNAL', 'reversible trash is unavailable');
    return operation.bind(this.kb) as NonNullable<KbPort[T]>;
  }
}

/** Production composition. Package imports remain out of the renderer bundle. */
export async function createProductionKnowledgeService(options: {
  userDataPath: string;
  settings: SettingsStorage;
  credentials: ModelCredentialStore;
}): Promise<LocalKnowledgeService> {
  // Variable dynamic imports intentionally form a narrow adapter boundary:
  // package workspace links are installed at runtime, while desktop typecheck
  // does not need to pull native package sources into its compilation unit.
  const [kbModule, kgModule, ragModule, llmModule] = await Promise.all([
    loadPackage<KbRuntimeModule>('@copilot/kb'),
    loadPackage<KgRuntimeModule>('@copilot/kg'),
    loadPackage<RagRuntimeModule>('@copilot/rag'),
    loadPackage<LlmRuntimeModule>('@copilot/llm-client'),
  ]);
  const { KbClient, SqliteStore, MdFileStore } = kbModule;

  const dataRoot = path.join(options.userDataPath, 'local-first');
  const sqlite = new SqliteStore({ dbPath: path.join(dataRoot, 'kb.sqlite') });
  const kb = new KbClient({
    sqlite,
    md: new MdFileStore({ rootDir: path.join(dataRoot, 'notes') }),
  }) as unknown as KbPort;
  const kgStore = new kgModule.KgStore({ dbPath: path.join(dataRoot, 'kg.sqlite') });
  const vectorStore = await ragModule.createVectorStore({
    dbPath: path.join(dataRoot, 'rag.sqlite'),
    dimensions: 1024,
  });
  const embedder = new ragModule.Embedder();

  const makeLlmClient = () => createConfiguredLlmClient({
    settings: options.settings,
    credentials: options.credentials,
    llmModule,
  });

  const packageKgStore = kgStore as unknown as PackageKgStore;
  const kg = new PackageKgAdapter(
    packageKgStore,
    new kgModule.KgQuery(packageKgStore),
    () => {
      const settings = options.settings.get('modelApi');
      return new kgModule.KgBuilder({
        store: packageKgStore,
        provider: makeLlmClient().middlewareProvider,
        defaultModel: settings.model,
      });
    },
  );

  const indexer = new ragModule.Indexer(embedder, vectorStore);
  const createRagStream = async function* (
    question: string,
    candidates: readonly KgNoteCandidate[],
    signal?: AbortSignal,
  ): AsyncGenerator<RagStreamChunk, RagAnswer> {
    const settings = options.settings.get('modelApi');
    const runtime = makeLlmClient();
    const answerer = new ragModule.Answerer(
      embedder,
      vectorStore,
      async (
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        request: { model: string; signal?: AbortSignal },
      ) => mapLlmStream(runtime.middlewareProvider.chatStream({
        model: request.model,
        messages,
        stream: true,
        signal: request.signal,
      })),
      { model: settings.model },
    );
    const supplementalHits = candidates.flatMap((candidate) => {
      const chunk = vectorStore.listChunksForNote(candidate.notePath)[0];
      return chunk ? [{ chunk, score: candidate.score, evidence: candidate.evidence }] : [];
    });
    const iterator = answerer.answer(question, { supplementalHits, signal });
    let item = await iterator.next();
    while (!item.done) {
      yield {
        delta: item.value.delta,
        sourceDetails: item.value.sourceDetails ?? [],
      };
      item = await iterator.next();
    }
    return {
      text: item.value.answer,
      sources: item.value.sources,
      sourceDetails: item.value.sourceDetails,
    };
  };

  const rag: RagPort = {
    async indexNote(note) {
      const report = await indexer.indexOneNote({
        path: note.note.path,
        title: note.note.title,
        body: note.body,
      });
      return {
        chunksInserted: report.chunksInserted,
        errors: report.errors.map((entry: { reason: string }) => entry.reason),
      };
    },
    deleteNote: (notePath) => indexer.deleteNote(notePath),
    async ask(question) {
      const iterator = createRagStream(question, []);
      let item = await iterator.next();
      while (!item.done) item = await iterator.next();
      return item.value;
    },
    stream: createRagStream,
    close: () => vectorStore.close(),
  };

  const service = new LocalKnowledgeService({ kb, kg, rag, settings: options.settings });
  await service.reconcileTrashStartup();
  return service;
}

interface KbRuntimeModule {
  SqliteStore: new (options: { dbPath: string }) => unknown;
  MdFileStore: new (options: { rootDir: string }) => unknown;
  KbClient: new (options: { sqlite: unknown; md: unknown }) => KbPort;
}

interface KgRuntimeModule {
  KgStore: new (options: { dbPath: string }) => PackageKgStore;
  KgBuilder: new (options: {
    store: PackageKgStore;
    provider: LlmProviderWire;
    defaultModel: string;
  }) => PackageKgBuilder;
  KgQuery: new (store: PackageKgStore) => PackageKgQuery;
}

interface RagRuntimeModule {
  createVectorStore(options: { dbPath: string; dimensions: number }): Promise<RagVectorStoreWire>;
  Embedder: new () => unknown;
  Indexer: new (embedder: unknown, store: RagVectorStoreWire) => {
    indexOneNote(input: { path: string; title: string; body: string }): Promise<{
      chunksInserted: number;
      errors: Array<{ reason: string }>;
    }>;
    deleteNote(notePath: string): Promise<void>;
  };
  Answerer: new (
    embedder: unknown,
    store: RagVectorStoreWire,
    streamFactory: (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      request: { model: string; signal?: AbortSignal },
    ) => Promise<AsyncIterable<{ content: string; finishReason?: string }>>,
    options: { model: string },
  ) => {
    answer(question: string, options?: {
      supplementalHits?: Array<{
        chunk: RagChunkWire;
        score: number;
        evidence: RagRetrievalEvidence[];
      }>;
      signal?: AbortSignal;
    }): AsyncGenerator<
      { delta: string; citedSources: string[]; sourceDetails?: RagSourceDetail[] },
      { answer: string; sources: string[]; sourceDetails?: RagSourceDetail[] }
    >;
  };
}

interface RagVectorStoreWire {
  close(): Promise<void>;
  deleteNote(notePath: string): Promise<void>;
  listChunksForNote(notePath: string): RagChunkWire[];
}

interface RagChunkWire {
  id: string;
  notePath: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  charRange: [number, number];
}

interface LlmProviderWire {
  readonly name: string;
  chat(request: unknown): Promise<unknown>;
  chatStream(request: unknown): AsyncIterable<{ delta: string; finishReason?: string }>;
  countTokens(messages: unknown[]): number;
}

interface LlmRuntimeModule {
  createProvider(config: {
    id: 'minimax' | 'openai' | 'claude' | 'custom';
    apiKey: string;
    baseUrl: string;
    model: string;
  }): LlmProviderWire;
  LLMClient: new (options: {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    logger: () => void;
    providerFactory: (options: { apiKey: string; baseUrl: string }) => LlmProviderWire;
  }) => {
    provider: LlmProviderWire;
    chat(request: unknown): Promise<unknown>;
    chatStream(request: {
      model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      stream: true;
      signal?: AbortSignal;
    }): AsyncIterable<{ delta: string; finishReason?: string }>;
    countTokens(messages: unknown[]): number;
    projectError(error: unknown): {
      category: 'auth' | 'rate_limit' | 'provider' | 'offline' | 'timeout' | 'cancelled' | 'configuration' | 'internal';
      message: string;
    };
  };
}

interface SafeModelErrorWire {
  category: 'auth' | 'rate_limit' | 'provider' | 'offline' | 'timeout' | 'cancelled' | 'configuration' | 'internal';
  message: string;
}

export function createConfiguredLlmClient(options: {
  settings: SettingsStorage;
  credentials: ModelCredentialStore;
  llmModule: LlmRuntimeModule;
}): {
  model: string;
  middlewareProvider: LlmProviderWire;
} {
  const config = options.settings.get('modelApi');
  if (
    typeof config.model !== 'string'
    || config.model.length === 0
    || config.model !== config.model.trim()
    || /[\u0000-\u001f\u007f]/u.test(config.model)
  ) {
    throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CONFIGURATION] The model id is invalid.');
  }
  let bindingResult: ReturnType<typeof credentialBinding>;
  try {
    bindingResult = credentialBinding(config.provider, config.baseUrl);
  } catch {
    throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CONFIGURATION] The model endpoint is invalid.');
  }

  const legacy = options.settings.readLegacyModelApiCredential?.() ?? null;
  if (legacy) {
    const clearLegacy = options.settings.clearLegacyModelApiCredentialExact;
    if (!clearLegacy) {
      throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_MIGRATION_REQUIRED] Re-save the model credential in Settings.');
    }
    try {
      options.credentials.migrateLegacy(
        bindingResult.binding,
        legacy,
        () => undefined,
        (expected) => clearLegacy.call(options.settings, expected),
      );
    } catch {
      throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_MIGRATION_REQUIRED] Re-save the model credential in Settings.');
    }
  }

  let apiKey: string | null;
  try {
    apiKey = options.credentials.read(bindingResult.binding);
  } catch (error) {
    if (error instanceof ModelCredentialError) {
      throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CREDENTIAL_LOCKED] Model credential protection is unavailable.');
    }
    throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CREDENTIAL_LOCKED] Model credential protection is unavailable.');
  }
  if (!apiKey) {
    throw new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CREDENTIAL_REQUIRED] Configure a credential for this provider and origin.');
  }

  const client = new options.llmModule.LLMClient({
    apiKey,
    baseUrl: bindingResult.endpoint.endpoint,
    defaultModel: config.model,
    logger: () => undefined,
    providerFactory: ({ apiKey: boundKey, baseUrl }) => options.llmModule.createProvider({
      id: config.provider,
      apiKey: boundKey,
      baseUrl,
      model: config.model,
    }),
  });

  const middlewareProvider: LlmProviderWire = {
    name: config.provider,
    async chat(request) {
      try {
        return await client.chat(request);
      } catch (error) {
        throw projectDomainModelError(client.projectError(error));
      }
    },
    async *chatStream(request) {
      try {
        yield* client.chatStream(request as {
          model: string;
          messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
          stream: true;
          signal?: AbortSignal;
        });
      } catch (error) {
        throw projectDomainModelError(client.projectError(error));
      }
    },
    countTokens(messages) {
      return client.countTokens(messages);
    },
  };
  return { model: config.model, middlewareProvider };
}

function projectDomainModelError(error: SafeModelErrorWire): DomainServiceError {
  switch (error.category) {
    case 'auth': return new DomainServiceError('CONFIG_REQUIRED', `[MODEL_AUTH] ${error.message}`);
    case 'rate_limit': return new DomainServiceError('OFFLINE', `[MODEL_RATE_LIMIT] ${error.message}`);
    case 'provider': return new DomainServiceError('OFFLINE', `[MODEL_PROVIDER] ${error.message}`);
    case 'offline': return new DomainServiceError('OFFLINE', `[MODEL_OFFLINE] ${error.message}`);
    case 'timeout': return new DomainServiceError('OFFLINE', `[MODEL_TIMEOUT] ${error.message}`);
    case 'cancelled': return new DomainServiceError('OFFLINE', `[MODEL_CANCELLED] ${error.message}`);
    case 'configuration': return new DomainServiceError('CONFIG_REQUIRED', `[MODEL_CONFIGURATION] ${error.message}`);
    case 'internal': return new DomainServiceError('INTERNAL', `[MODEL_INTERNAL] ${error.message}`);
  }
}

interface PackageKgStore {
  removeNoteGraph(notePath: string, now?: number): void;
  close(): void;
}

interface PackageKgBuilder {
  buildNote(note: {
    path: string;
    title: string;
    body: string;
    tags?: string[];
    related?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{
    entitiesAdded: number;
    entitiesTotal: number;
  }>;
}

interface PackageKgQuery {
  searchNodes(query: string, options?: { limit?: number }): KgEntity[];
  subgraph(request: {
    center: string;
    hops?: number;
    types?: KgSubgraphRequest['types'];
    maxNodes?: number;
  }): KgSubgraph;
  fullGraph(maxNodes?: number): { nodes: KgEntity[]; edges: KgRelation[] };
}

class PackageKgAdapter implements KgPort {
  constructor(
    private readonly store: PackageKgStore,
    private readonly query: PackageKgQuery,
    private readonly createBuilder: () => PackageKgBuilder,
  ) {}

  async getSubgraph(request?: KgSubgraphRequest | number): Promise<KgSubgraph> {
    const normalized = typeof request === 'number' ? { maxNodes: request } : (request ?? {});
    const maxNodes = clampInteger(normalized.maxNodes ?? 1000, 1, 5000);
    if (normalized.center) {
      return this.query.subgraph({
        center: normalized.center,
        hops: clampInteger(normalized.hops ?? 1, 0, 3),
        types: normalized.types,
        maxNodes,
      });
    }
    const graph = this.query.fullGraph(5000);
    const allNodes = graph.nodes.filter(
      (node) => !normalized.types?.length || normalized.types.includes(node.type),
    );
    const nodes = allNodes.slice(0, maxNodes);
    const nodeIds = new Set(nodes.map((node) => node.entity_id));
    const edges = graph.edges.filter(
      (edge) => nodeIds.has(edge.from_entity_id) && nodeIds.has(edge.to_entity_id),
    );
    return { nodes, edges, degree: buildDegree(nodes, edges) };
  }

  relatedNotes(question: string, maxCandidates = 10): KgNoteCandidate[] {
    const matches = new Map<string, KgEntity>();
    for (const term of tokenizeKgQuestion(question)) {
      for (const node of this.query.searchNodes(term, { limit: maxCandidates })) {
        matches.set(node.entity_id, node);
      }
    }

    const rankedNodes = [...matches.values()].sort((a, b) =>
      a.entity_id.localeCompare(b.entity_id),
    );
    const candidates = new Map<string, KgNoteCandidate>();
    rankedNodes.forEach((node, nodeIndex) => {
      addKgNotes(candidates, node.source_notes, 0.9 - nodeIndex * 0.01, 'kg-entity');
      const neighborhood = this.query.subgraph({ center: node.entity_id, hops: 1, maxNodes: 50 });
      for (const neighbor of neighborhood.nodes) {
        if (neighbor.entity_id !== node.entity_id) {
          addKgNotes(candidates, neighbor.source_notes, 0.72 - nodeIndex * 0.01, 'kg-neighbor');
        }
      }
      for (const edge of neighborhood.edges) {
        addKgNotes(candidates, edge.evidence, 0.7 - nodeIndex * 0.01, 'kg-neighbor');
      }
    });

    return [...candidates.values()]
      .sort((a, b) => b.score - a.score || a.notePath.localeCompare(b.notePath))
      .slice(0, clampInteger(maxCandidates, 1, 50));
  }

  async reindexNote(note: NoteDocument): Promise<{ entitiesAdded: number; entitiesLinked: number }> {
    const result = await this.createBuilder().buildNote({
      path: note.note.path,
      title: note.note.title,
      body: note.body,
      tags: note.note.tags,
      related: note.note.related,
      metadata: { type: note.note.type, status: note.note.status },
    });
    return { entitiesAdded: result.entitiesAdded, entitiesLinked: result.entitiesTotal };
  }

  removeNote(notePath: string): void {
    this.store.removeNoteGraph(notePath);
  }

  close(): void {
    this.store.close();
  }
}

async function* mapLlmStream(
  stream: AsyncIterable<{ delta: string; finishReason?: string }>,
): AsyncIterable<{ content: string; finishReason?: string }> {
  for await (const item of stream) {
    yield { content: item.delta, finishReason: item.finishReason };
  }
}

function tokenizeKgQuestion(question: string): string[] {
  const terms = question.match(/[\p{Script=Han}]{2,}|[\p{Letter}\p{Number}_-]{2,}/gu) ?? [];
  return dedupeStrings(terms.map((term) => term.toLocaleLowerCase())).sort();
}

function addKgNotes(
  candidates: Map<string, KgNoteCandidate>,
  notePaths: readonly string[],
  score: number,
  evidence: Extract<RagRetrievalEvidence, 'kg-entity' | 'kg-neighbor'>,
): void {
  for (const notePath of dedupeStrings(notePaths).sort()) {
    const current = candidates.get(notePath);
    const evidenceSet = new Set<RagRetrievalEvidence>(current?.evidence ?? []);
    evidenceSet.add(evidence);
    candidates.set(notePath, {
      notePath,
      score: Math.max(score, current?.score ?? Number.NEGATIVE_INFINITY),
      evidence: (['kg-entity', 'kg-neighbor'] as const).filter((item) => evidenceSet.has(item)),
    });
  }
}

function normalizeRagAnswer(answer: RagAnswer): RagAnswer {
  const sourceDetails = normalizeSourceDetails(answer.sourceDetails ?? []);
  const sources = dedupeStrings([
    ...answer.sources,
    ...sourceDetails.map((detail) => detail.notePath),
  ]);
  return {
    text: answer.text,
    sources,
    ...(sourceDetails.length ? { sourceDetails } : {}),
  };
}

function normalizeSourceDetails(details: readonly RagSourceDetail[]): RagSourceDetail[] {
  const byPath = new Map<string, RagSourceDetail>();
  for (const detail of details) {
    if (!detail?.notePath) continue;
    const current = byPath.get(detail.notePath);
    const evidence = new Set<RagRetrievalEvidence>([
      ...(current?.evidence ?? []),
      ...detail.evidence,
    ]);
    byPath.set(detail.notePath, {
      notePath: detail.notePath,
      score: Math.max(detail.score, current?.score ?? Number.NEGATIVE_INFINITY),
      evidence: (['vector', 'kg-entity', 'kg-neighbor'] as const).filter((item) => evidence.has(item)),
    });
  }
  return [...byPath.values()].sort(
    (a, b) => b.score - a.score || a.notePath.localeCompare(b.notePath),
  );
}

function buildDegree(nodes: KgEntity[], edges: KgRelation[]): Record<string, number> {
  const degree: Record<string, number> = Object.fromEntries(nodes.map((node) => [node.entity_id, 0]));
  for (const edge of edges) {
    degree[edge.from_entity_id] = (degree[edge.from_entity_id] ?? 0) + 1;
    degree[edge.to_entity_id] = (degree[edge.to_entity_id] ?? 0) + 1;
  }
  return degree;
}

function toNoteRecord(note: KbNoteWire): NoteRecord {
  return {
    id: note.id,
    path: note.path,
    title: note.title,
    type: note.type,
    status: note.status,
    tags: [...note.tags],
    related: [...note.related],
    folder: note.folder,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    confidence: note.confidence,
    agent: note.agent,
  };
}

function toLocalTrashEntry(entry: KbTrashEntryWire): LocalTrashEntry {
  return {
    trashId: entry.trashId,
    kind: entry.kind,
    originalPath: entry.originalPath,
    originalRevision: entry.originalRevision,
    trashRevision: entry.trashRevision,
    state: entry.state,
    movedAt: entry.movedAt,
    restoredAt: entry.restoredAt,
    purgedAt: entry.purgedAt,
    cleanupAttempts: entry.cleanupAttempts,
    title: trashDisplayTitle(entry),
  };
}

function trashDisplayTitle(entry: KbTrashEntryWire): string {
  try {
    const metadata = JSON.parse(entry.metadataJson) as { note?: { title?: unknown } };
    const title = metadata?.note?.title;
    if (typeof title === 'string' && title.trim() && title.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(title)) {
      return title.trim();
    }
  } catch {
    // Corrupt/private metadata stays main-owned; renderer receives a generic label.
  }
  return entry.kind === 'todo' ? '已删除待办' : '已删除笔记';
}

function createTodoRecord(request: CreateTodoRequest, id: string, now: number): TodoRecord {
  assertNonEmpty(request?.title, 'todo title');
  validateTodoStatus(request.status);
  validateTodoPriority(request.priority);
  validateOptionalEpoch(request.due_at_ms, 'due_at_ms');
  validateOptionalEpoch(request.remind_at_ms, 'remind_at_ms');
  return {
    id,
    title: request.title.trim(),
    body: request.body ?? '',
    due_at_ms: request.due_at_ms ?? null,
    remind_at_ms: request.remind_at_ms ?? null,
    status: request.status ?? 'pending',
    priority: request.priority ?? 'normal',
    note_links: dedupeStrings(request.note_links ?? []),
    reminder_fired: 0,
    created_at: now,
    updated_at: now,
  };
}

function updateTodoRecord(
  current: TodoRecord,
  patch: UpdateTodoRequest['patch'],
  now: number,
): TodoRecord {
  if (!patch || typeof patch !== 'object') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'todo patch is required');
  }
  if (patch.title !== undefined) assertNonEmpty(patch.title, 'todo title');
  validateTodoStatus(patch.status);
  validateTodoPriority(patch.priority);
  validateOptionalEpoch(patch.due_at_ms, 'due_at_ms');
  validateOptionalEpoch(patch.remind_at_ms, 'remind_at_ms');
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as UpdateTodoRequest['patch'];
  return {
    ...current,
    ...definedPatch,
    title: patch.title?.trim() ?? current.title,
    note_links: patch.note_links !== undefined ? dedupeStrings(patch.note_links) : current.note_links,
    updated_at: now,
  };
}

function serializeTodo(todo: TodoRecord): string {
  return JSON.stringify({ schema: 1, ...todo });
}

function parseTodo(body: string): TodoRecord | null {
  try {
    const value = JSON.parse(body) as Partial<TodoRecord>;
    if (value.id === undefined || typeof value.title !== 'string') return null;
    if (value.status !== 'pending' && value.status !== 'done' && value.status !== 'cancelled') return null;
    if (value.priority !== 'low' && value.priority !== 'normal' && value.priority !== 'high') return null;
    return {
      id: value.id,
      title: value.title,
      body: typeof value.body === 'string' ? value.body : '',
      due_at_ms: typeof value.due_at_ms === 'number' ? value.due_at_ms : null,
      remind_at_ms: typeof value.remind_at_ms === 'number' ? value.remind_at_ms : null,
      status: value.status,
      priority: value.priority,
      note_links: Array.isArray(value.note_links) ? dedupeStrings(value.note_links) : [],
      reminder_fired: value.reminder_fired === 1 ? 1 : 0,
      created_at: typeof value.created_at === 'number' ? value.created_at : 0,
      updated_at: typeof value.updated_at === 'number' ? value.updated_at : 0,
    };
  } catch {
    return null;
  }
}

function todoPath(id: TodoId): string {
  assertTodoId(id);
  return `${TODO_PATH_PREFIX}${String(id)}`;
}

function assertTodoId(id: TodoId): void {
  if ((typeof id !== 'string' && typeof id !== 'number') || String(id).trim().length === 0) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'todo id is required');
  }
}

function assertNoteCreate(request: CreateNoteRequest): void {
  if (!request || typeof request !== 'object') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'note request is required');
  }
  assertNonEmpty(request.path, 'note path');
  assertNonEmpty(request.title, 'note title');
  if (typeof request.body !== 'string' && typeof request.transcript !== 'string') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'note body or transcript is required');
  }
}

function isSystemTodoPath(notePath: string): boolean {
  return notePath === TODO_PATH_PREFIX.slice(0, -1) || notePath.startsWith(TODO_PATH_PREFIX);
}

function isSystemTodoNote(note: KbNoteWire): boolean {
  return isSystemTodoPath(note.path) || note.tags.includes(TODO_TAG);
}

function assertPublicNotePath(notePath: string): void {
  if (isSystemTodoPath(notePath)) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'system Todo notes are not available through Notes CRUD');
  }
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} is required`);
  }
}

function validateTodoStatus(value: unknown): void {
  if (value !== undefined && value !== 'pending' && value !== 'done' && value !== 'cancelled') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'todo status is invalid');
  }
}

function validateTodoPriority(value: unknown): void {
  if (value !== undefined && value !== 'low' && value !== 'normal' && value !== 'high') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'todo priority is invalid');
  }
}

function validateOptionalEpoch(value: unknown, label: string): void {
  if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} must be finite epoch milliseconds`);
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : min)));
}

function normalizeExternalError(error: unknown): DomainServiceError {
  if (error instanceof DomainServiceError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  if (code === 'auth') return new DomainServiceError('CONFIG_REQUIRED', '[MODEL_AUTH] Model credentials were rejected.');
  if (code === 'rate_limit' || code === 'token_limit_local') return new DomainServiceError('OFFLINE', '[MODEL_RATE_LIMIT] The model is temporarily rate limited.');
  if (code === 'server') return new DomainServiceError('OFFLINE', '[MODEL_PROVIDER] The model service is temporarily unavailable.');
  if (code === 'network') return new DomainServiceError('OFFLINE', '[MODEL_OFFLINE] The model service could not be reached.');
  if (code === 'timeout') return new DomainServiceError('OFFLINE', '[MODEL_TIMEOUT] The model request timed out.');
  if (code === 'abort') return new DomainServiceError('OFFLINE', '[MODEL_CANCELLED] The model request was cancelled.');
  if (code === 'config' || code === 'bad_request') return new DomainServiceError('CONFIG_REQUIRED', '[MODEL_CONFIGURATION] The model configuration is invalid.');
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('ollama') ||
    message.includes('timeout') ||
    message.includes('aborted')
  ) {
    return new DomainServiceError('OFFLINE', 'local AI service is unavailable');
  }
  return new DomainServiceError('INTERNAL', 'local knowledge operation failed');
}

function normalizeTrashError(error: unknown): DomainServiceError {
  if (error instanceof DomainServiceError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  if (code === 'TRASH_NOT_FOUND') {
    return new DomainServiceError('NOT_FOUND', 'local item was not found');
  }
  if (code === 'TRASH_INVALID_ARGUMENT') {
    return new DomainServiceError('INVALID_ARGUMENT', 'trash request is invalid');
  }
  if (
    code === 'TRASH_REVISION_CONFLICT' ||
    code === 'TRASH_IDEMPOTENCY_CONFLICT'
  ) {
    return new DomainServiceError('INVALID_ARGUMENT', 'trash item changed; refresh and retry');
  }
  if (code === 'TRASH_RESTORE_CONFLICT') {
    return new DomainServiceError('INVALID_ARGUMENT', 'restore destination already exists');
  }
  if (code === 'TRASH_RECOVERY_REQUIRED' || code === 'TRASH_FILE_UNSAFE') {
    return new DomainServiceError('INTERNAL', 'trash recovery is required');
  }
  return new DomainServiceError('INTERNAL', 'reversible trash operation failed');
}

async function loadPackage<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}
