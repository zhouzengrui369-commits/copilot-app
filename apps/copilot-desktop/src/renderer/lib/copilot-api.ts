import type {
  AskConversationSaveRequest,
  AskConversationSnapshot,
  CopilotDomainBridge,
  CreateNoteRequest,
  CreateTodoRequest,
  KnowledgeBuildStatusReceipt,
  KgSubgraph,
  NoteBuildReceipt,
  NoteCommitBuildReceipt,
  NoteRecord,
  NoteStatus,
  NoteType,
  RagSourceDetail,
  RagStreamEvent,
  RendererTrashItem,
  TodoRecord,
  TrashPurgeRequest,
  TrashRestoreRequest,
  UpdateTodoRequest,
  WikiTruthReceipt,
} from '../../shared/domain-api.js';
import type {
  BacklinkRef,
  NoteContent,
  NoteDataSource,
} from '../components/NoteDetail/types.js';
import type { KgDataSource } from '../components/KnowledgeGraph/types.js';

export interface CopilotNoteSummary {
  path: string;
  title: string;
  tags?: string[];
  type?: NoteType | null;
  status?: NoteStatus | null;
  updatedAt?: number;
  updated_at?: number;
  localState?: 'LOCAL_SAVED';
  knowledgeBuild?: KnowledgeBuildStatusReceipt;
}

export interface CopilotNote extends CopilotNoteSummary {
  body: string;
}

export interface CopilotNoteInput {
  path: string;
  title: string;
  body: string;
  tags?: string[];
  type?: NoteType | null;
  status?: NoteStatus | null;
}

export interface CopilotNoteCommitBuildReceipt {
  note: CopilotNote;
  localState: 'LOCAL_SAVED';
  build: NoteBuildReceipt;
}

export interface CopilotBacklink {
  sourceId?: string;
  sourceTitle?: string;
  sourcePath?: string;
  source_id?: string;
  source_title?: string;
  source_path?: string;
  fromPath?: string;
  toPath?: string;
  relation?: string | null;
  excerpt?: string;
}

export interface CopilotRagAnswer {
  text: string;
  sources: string[];
  sourceDetails?: RagSourceDetail[];
}

export interface CopilotRagStreamHandle {
  requestId: string;
  done: Promise<CopilotRagAnswer>;
  cancel(): Promise<void>;
}

export type TodoStatus = 'pending' | 'done' | 'cancelled';

export interface CopilotTodo {
  id: string | number;
  title: string;
  body?: string;
  status: TodoStatus;
  dueAt?: number | null;
  remindAt?: number | null;
  due_at_ms?: number | null;
  remind_at_ms?: number | null;
  linkedNotePaths?: string[];
  note_links?: string[];
}

export interface CopilotTodoInput {
  title: string;
  body?: string;
  dueAt?: number | null;
  remindAt?: number | null;
  linkedNotePaths?: string[];
}

export interface CopilotProductApi {
  notes: {
    list(): Promise<ReadonlyArray<CopilotNoteSummary> | { items: CopilotNoteSummary[] }>;
    get(path: string): Promise<CopilotNote | { note: CopilotNoteSummary; body: string } | null>;
    create(input: CopilotNoteInput): Promise<CopilotNote>;
    createWithBuild?(input: CopilotNoteInput): Promise<CopilotNoteCommitBuildReceipt>;
    update(path: string, input: Partial<CopilotNoteInput>): Promise<CopilotNote | null>;
    updateWithBuild?(
      path: string,
      input: Partial<CopilotNoteInput>,
    ): Promise<CopilotNoteCommitBuildReceipt | null>;
    remove(path: string): Promise<boolean>;
    getBacklinks(path: string): Promise<ReadonlyArray<CopilotBacklink>>;
  };
  wiki?: {
    getForNote(path: string): Promise<WikiTruthReceipt>;
  };
  kg: {
    getSubgraph(maxNodes?: number): Promise<KgSubgraph>;
    reindexNote(path: string): Promise<unknown>;
  };
  rag: {
    ask(question: string): Promise<CopilotRagAnswer>;
    stream?(
      question: string,
      onEvent: (event: RagStreamEvent) => void,
    ): CopilotRagStreamHandle;
  };
  askConversation?: {
    save(request: AskConversationSaveRequest): Promise<AskConversationSnapshot>;
    load(): Promise<AskConversationSnapshot | null>;
    clear(): Promise<void>;
  };
  todos: {
    list(): Promise<ReadonlyArray<CopilotTodo>>;
    create(input: CopilotTodoInput): Promise<CopilotTodo>;
    update(id: string | number, patch: Partial<CopilotTodo>): Promise<CopilotTodo | null>;
    remove(id: string | number): Promise<boolean>;
    listDue(now?: number): Promise<ReadonlyArray<CopilotTodo>>;
    markReminderFired(id: string | number): Promise<CopilotTodo | null>;
  };
  trash?: {
    moveNote(path: string): Promise<RendererTrashItem>;
    moveTodo(id: string | number): Promise<RendererTrashItem>;
    list(): Promise<RendererTrashItem[]>;
    restore(request: TrashRestoreRequest): Promise<RendererTrashItem>;
    purge(request: TrashPurgeRequest): Promise<RendererTrashItem>;
  };
}

export interface ProductApiResolution {
  api: CopilotProductApi | null;
  error: string | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function hasFunctions(value: unknown, names: ReadonlyArray<string>): boolean {
  return isRecord(value) && names.every((name) => typeof value[name] === 'function');
}

/**
 * Resolve the narrow product API injected by Electron preload. No fixture or
 * browser-local fallback is returned: missing IPC is an explicit offline state.
 */
export function resolveCopilotProductApi(
  value: unknown = typeof window === 'undefined' ? undefined : window.copilot,
): ProductApiResolution {
  if (!isRecord(value)) {
    return { api: null, error: '本地服务桥接不可用，请从桌面 App 启动。' };
  }
  const notes = value.notes;
  const wiki = value.wiki;
  const kg = value.kg;
  const rag = value.rag;
  const todos = value.todos;
  const askConversation = value.askConversation;
  const trash = value.trash;
  if (!hasFunctions(notes, ['list', 'get', 'create', 'update', 'remove', 'getBacklinks'])) {
    return { api: null, error: '知识库 IPC 尚未就绪。' };
  }
  if (!hasFunctions(kg, ['getSubgraph', 'reindexNote'])) {
    return { api: null, error: '知识图谱 IPC 尚未就绪。' };
  }
  if (!hasFunctions(rag, ['ask'])) {
    return { api: null, error: '知识问答 IPC 尚未就绪。' };
  }
  if (!hasFunctions(todos, ['list', 'create', 'update', 'remove', 'listDue', 'markReminderFired'])) {
    return { api: null, error: '日程 IPC 尚未就绪。' };
  }
  const bridge = value as unknown as CopilotDomainBridge;
  const hasNoteBuild = hasFunctions(notes, ['createWithBuild', 'updateWithBuild']);
  const hasWiki = hasFunctions(wiki, ['getForNote']);
  const hasRagStream = hasFunctions(rag, ['startStream', 'cancelStream', 'onStreamEvent']);
  const hasTrash = hasFunctions(trash, ['moveNote', 'moveTodo', 'list', 'restore', 'purge']);
  const hasAskConversation = hasFunctions(askConversation, ['save', 'load', 'clear']);
  const askConversationBridge = bridge.askConversation;
  const trashBridge = bridge.trash;
  const api: CopilotProductApi = {
    notes: {
      list: async () => bridge.notes.list(),
      get: async (path) => bridge.notes.get(path),
      create: async (input) => {
        const created = await bridge.notes.create(toCreateNoteRequest(input));
        return noteRecordToNote(created, input.body, true);
      },
      ...(hasNoteBuild ? {
        createWithBuild: async (input: CopilotNoteInput) => {
          const receipt = await bridge.notes.createWithBuild(toCreateNoteRequest(input));
          return noteCommitReceiptToProduct(receipt, input.body);
        },
      } : {}),
      update: async (path, input) => {
        const updated = await bridge.notes.update({
          path,
          patch: {
            title: input.title,
            body: input.body,
            type: input.type,
            status: input.status,
            tags: input.tags,
          },
        });
        if (!updated) return null;
        const current = input.body === undefined ? await bridge.notes.get(updated.path) : null;
        return noteRecordToNote(updated, input.body ?? current?.body ?? '', true);
      },
      ...(hasNoteBuild ? {
        updateWithBuild: async (path: string, input: Partial<CopilotNoteInput>) => {
          const receipt = await bridge.notes.updateWithBuild({
            path,
            patch: {
              title: input.title,
              body: input.body,
              type: input.type,
              status: input.status,
              tags: input.tags,
            },
          });
          if (!receipt) return null;
          const current = input.body === undefined ? await bridge.notes.get(receipt.note.path) : null;
          return noteCommitReceiptToProduct(receipt, input.body ?? current?.body ?? '');
        },
      } : {}),
      remove: (path) => bridge.notes.remove(path),
      getBacklinks: async (path) => {
        const links = await bridge.notes.getBacklinks(path);
        return links.map((link) => ({
          fromPath: link.fromPath,
          toPath: link.toPath,
          relation: link.relation,
          sourceId: link.fromPath,
          sourceTitle: link.fromPath,
          sourcePath: link.fromPath,
          excerpt: link.relation ?? '',
        }));
      },
    },
    ...(hasWiki ? {
      wiki: {
        getForNote: (path: string) => bridge.wiki.getForNote(path),
      },
    } : {}),
    kg: {
      getSubgraph: (maxNodes) => bridge.kg.getSubgraph(maxNodes),
      reindexNote: (path) => bridge.kg.reindexNote(path),
    },
    rag: {
      ask: (question) => bridge.rag.ask(question),
      ...(hasRagStream ? {
        stream: (question: string, onEvent: (event: RagStreamEvent) => void) =>
          startRagStream(bridge, question, onEvent),
      } : {}),
    },
    ...(hasAskConversation && askConversationBridge ? {
      askConversation: {
        save: (request: AskConversationSaveRequest) => askConversationBridge.save(request),
        load: () => askConversationBridge.load(),
        clear: () => askConversationBridge.clear(),
      },
    } : {}),
    todos: {
      list: async () => (await bridge.todos.list()).map(todoRecordToTodo),
      create: async (input) => todoRecordToTodo(await bridge.todos.create(toCreateTodoRequest(input))),
      update: async (id, patch) => {
        const updated = await bridge.todos.update({
          id,
          patch: toUpdateTodoPatch(patch),
        });
        return updated ? todoRecordToTodo(updated) : null;
      },
      remove: (id) => bridge.todos.remove(id),
      listDue: async (now) => (await bridge.todos.listDue(now)).map(todoRecordToTodo),
      markReminderFired: async (id) => {
        const updated = await bridge.todos.markReminderFired(id);
        return updated ? todoRecordToTodo(updated) : null;
      },
    },
    ...(hasTrash && trashBridge ? {
      trash: {
        moveNote: (path: string) => trashBridge.moveNote(path),
        moveTodo: (id: string | number) => trashBridge.moveTodo(id),
        list: () => trashBridge.list(),
        restore: (request: TrashRestoreRequest) => trashBridge.restore(request),
        purge: (request: TrashPurgeRequest) => trashBridge.purge(request),
      },
    } : {}),
  };
  return { api, error: null };
}

let ragRequestSequence = 0;

function startRagStream(
  bridge: CopilotDomainBridge,
  question: string,
  onEvent: (event: RagStreamEvent) => void,
): CopilotRagStreamHandle {
  ragRequestSequence += 1;
  const requestId = globalThis.crypto?.randomUUID?.()
    ?? `rag-${Date.now()}-${ragRequestSequence}`;
  let settled = false;
  let resolveDone!: (answer: CopilotRagAnswer) => void;
  let rejectDone!: (error: Error) => void;
  let unsubscribe: () => void = () => undefined;
  const done = new Promise<CopilotRagAnswer>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const cleanup = () => {
    if (settled) return false;
    settled = true;
    unsubscribe();
    return true;
  };

  unsubscribe = bridge.rag.onStreamEvent((event) => {
    if (event.requestId !== requestId || settled) return;
    try {
      onEvent(event);
    } catch {
      if (cleanup()) rejectDone(new Error('RAG stream listener failed'));
      return;
    }
    if (event.type === 'final' && cleanup()) resolveDone(event.answer);
    if (event.type === 'error' && cleanup()) {
      rejectDone(new Error(`[${event.code}] ${event.message}`));
    }
    if (event.type === 'cancel' && cleanup()) {
      rejectDone(createAbortError());
    }
  });

  void bridge.rag.startStream({ requestId, question }).then((result) => {
    if (result.requestId !== requestId && cleanup()) {
      rejectDone(new Error('RAG stream request mismatch'));
    }
  }).catch((error: unknown) => {
    if (cleanup()) rejectDone(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    requestId,
    done,
    cancel: async () => {
      if (settled) return;
      try {
        await bridge.rag.cancelStream(requestId);
      } finally {
        if (cleanup()) rejectDone(createAbortError());
      }
    },
  };
}

function createAbortError(): Error {
  return new DOMException('RAG request cancelled', 'AbortError');
}

function toCreateNoteRequest(input: CopilotNoteInput): CreateNoteRequest {
  return {
    path: input.path,
    title: input.title,
    body: input.body,
    type: input.type,
    status: input.status,
    tags: input.tags,
  };
}

function noteRecordToNote(
  record: NoteRecord,
  body: string,
  includeRawBuildReceipt = false,
): CopilotNote {
  const rawBuildReceipt = includeRawBuildReceipt
    ? normalizeRawBuildReceipt(record)
    : null;
  return {
    path: record.path,
    title: record.title,
    body,
    tags: [...record.tags],
    type: record.type,
    status: record.status,
    updatedAt: record.updatedAt,
    ...(rawBuildReceipt ?? {}),
  };
}

const KNOWLEDGE_BUILD_STATES = new Set<KnowledgeBuildStatusReceipt['state']>([
  'queued',
  'running',
  'ready',
  'failed',
  'not-ready',
]);
const KNOWLEDGE_BUILD_REVISION = /^note:\d+:[0-9a-f]{64}$/u;

function normalizeRawBuildReceipt(
  record: NoteRecord,
): Pick<CopilotNoteSummary, 'localState' | 'knowledgeBuild'> | null {
  if (record.localState !== 'LOCAL_SAVED' || !isRecord(record.knowledgeBuild)) {
    return null;
  }
  const state = record.knowledgeBuild.state;
  const revision = record.knowledgeBuild.revision;
  if (
    typeof state !== 'string'
    || !KNOWLEDGE_BUILD_STATES.has(state as KnowledgeBuildStatusReceipt['state'])
    || (
      revision !== null
      && (typeof revision !== 'string' || !KNOWLEDGE_BUILD_REVISION.test(revision))
    )
  ) {
    return null;
  }
  return {
    localState: 'LOCAL_SAVED',
    knowledgeBuild: {
      state: state as KnowledgeBuildStatusReceipt['state'],
      revision,
    },
  };
}

function noteCommitReceiptToProduct(
  receipt: NoteCommitBuildReceipt,
  body: string,
): CopilotNoteCommitBuildReceipt {
  return {
    note: noteRecordToNote(receipt.note, body),
    localState: receipt.localState,
    build: receipt.build,
  };
}

function toCreateTodoRequest(input: CopilotTodoInput): CreateTodoRequest {
  return {
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    due_at_ms: input.dueAt,
    remind_at_ms: input.remindAt,
    note_links: input.linkedNotePaths,
  };
}

function toUpdateTodoPatch(patch: Partial<CopilotTodo>): UpdateTodoRequest['patch'] {
  const output: UpdateTodoRequest['patch'] = {};
  if (patch.title !== undefined) output.title = patch.title;
  if (patch.body !== undefined) output.body = patch.body;
  if (patch.status !== undefined) output.status = patch.status;
  const dueAt = patch.dueAt !== undefined ? patch.dueAt : patch.due_at_ms;
  if (dueAt !== undefined) output.due_at_ms = dueAt;
  const remindAt = patch.remindAt !== undefined ? patch.remindAt : patch.remind_at_ms;
  if (remindAt !== undefined) output.remind_at_ms = remindAt;
  const links = patch.linkedNotePaths !== undefined ? patch.linkedNotePaths : patch.note_links;
  if (links !== undefined) output.note_links = links;
  return output;
}

function todoRecordToTodo(record: TodoRecord): CopilotTodo {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    status: record.status,
    due_at_ms: record.due_at_ms,
    remind_at_ms: record.remind_at_ms,
    note_links: [...record.note_links],
  };
}

export function normalizeNoteList(
  value: ReadonlyArray<CopilotNoteSummary> | { items: CopilotNoteSummary[] },
): CopilotNoteSummary[] {
  return 'items' in value ? [...value.items] : [...value];
}

export function normalizeNote(
  value: CopilotNote | { note: CopilotNoteSummary; body: string } | null,
): CopilotNote | null {
  if (!value) return null;
  if ('note' in value) return { ...value.note, body: value.body };
  return value;
}

function noteToContent(note: CopilotNote): NoteContent {
  return {
    id: note.path,
    path: note.path,
    title: note.title,
    body: note.body,
    tags: note.tags ?? [],
    updatedAt: note.updatedAt ?? note.updated_at ?? 0,
  };
}

export function createNoteDataSource(api: CopilotProductApi): NoteDataSource {
  return {
    async getNote(path: string): Promise<NoteContent | null> {
      const note = normalizeNote(await api.notes.get(path));
      return note ? noteToContent(note) : null;
    },
    async getBacklinks(path: string): Promise<ReadonlyArray<BacklinkRef>> {
      const links = await api.notes.getBacklinks(path);
      return links.map((link) => {
        const sourcePath = link.sourcePath ?? link.source_path ?? link.fromPath ?? '';
        return {
          sourceId: link.sourceId ?? link.source_id ?? sourcePath,
          sourceTitle: link.sourceTitle ?? link.source_title ?? sourcePath,
          sourcePath,
          excerpt: link.excerpt ?? '',
        };
      });
    },
  };
}

export function createKgDataSource(api: CopilotProductApi): KgDataSource {
  return {
    getSubgraph: (maxNodes?: number) => api.kg.getSubgraph(maxNodes),
  };
}

export function todoDueAt(todo: CopilotTodo): number | null {
  return todo.dueAt ?? todo.due_at_ms ?? null;
}

export function todoRemindAt(todo: CopilotTodo): number | null {
  return todo.remindAt ?? todo.remind_at_ms ?? null;
}

export function todoNoteLinks(todo: CopilotTodo): string[] {
  return [...(todo.linkedNotePaths ?? todo.note_links ?? [])];
}
