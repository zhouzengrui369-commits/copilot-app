/**
 * Stable renderer <-> Electron-main contract for the local-first Copilot domain.
 *
 * Keep this file dependency-free: renderer code may import these types without
 * pulling native SQLite, Electron, or provider SDKs into the browser bundle.
 * Secrets and filesystem paths are deliberately absent from every response.
 */
import { IPC_CHANNELS } from './ipc-channels.js';

export type NoteType = 'article' | 'note' | 'meeting' | 'todo' | 'reference' | 'idea';
export type NoteStatus = 'draft' | 'active' | 'archived';
export type KnowledgeBuildState = 'queued' | 'running' | 'ready' | 'failed' | 'not-ready';

/**
 * Renderer-safe local build truth. `revision` binds the state to local note
 * bytes without exposing those bytes or provider details.
 */
export interface KnowledgeBuildStatusReceipt {
  state: KnowledgeBuildState;
  revision: string | null;
}

export interface NoteRecord {
  id: number;
  path: string;
  title: string;
  type: NoteType | null;
  status: NoteStatus | null;
  tags: string[];
  related: string[];
  folder: string;
  createdAt: number;
  updatedAt: number;
  confidence: number | null;
  agent: string | null;
  /** Present on raw create/update receipts after the local commit succeeds. */
  localState?: 'LOCAL_SAVED';
  /** Present on raw create/update receipts and WIKI truth queries. */
  knowledgeBuild?: KnowledgeBuildStatusReceipt;
}

export interface NoteDocument {
  note: NoteRecord;
  body: string;
}

export interface CreateNoteRequest {
  path: string;
  title: string;
  /** Markdown body for typed/manual capture. */
  body?: string;
  /** Voice transcription; used as body when body is omitted. */
  transcript?: string;
  type?: NoteType | null;
  status?: NoteStatus | null;
  tags?: string[];
  related?: string[];
  confidence?: number | null;
  agent?: string | null;
}

export interface UpdateNoteRequest {
  path: string;
  patch: {
    title?: string;
    body?: string;
    type?: NoteType | null;
    status?: NoteStatus | null;
    tags?: string[];
    related?: string[];
    confidence?: number | null;
    agent?: string | null;
  };
}

export interface ListNotesRequest {
  type?: NoteType;
  status?: NoteStatus;
  folder?: string;
  tags?: string[];
  query?: string;
  limit?: number;
  offset?: number;
}

export interface NoteList {
  items: NoteRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface BacklinkRecord {
  fromPath: string;
  toPath: string;
  relation: string | null;
}

export type EntityType =
  | 'person'
  | 'org'
  | 'concept'
  | 'event'
  | 'place'
  | 'product'
  | 'document'
  | 'topic'
  | 'other';

export interface KgEntity {
  id: number;
  entity_id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  summary: string | null;
  confidence: number | null;
  source_notes: string[];
  created_at: number;
  updated_at: number;
}

export interface KgRelation {
  id: number;
  from_entity_id: string;
  to_entity_id: string;
  rel: string;
  weight: number | null;
  evidence: string[];
  created_at: number;
}

export interface KgSubgraphRequest {
  center?: string;
  hops?: number;
  types?: EntityType[];
  maxNodes?: number;
}

export interface KgSubgraph {
  nodes: KgEntity[];
  edges: KgRelation[];
  degree: Record<string, number>;
}

export interface ReindexResult {
  notePath: string;
  entitiesAdded: number;
  entitiesLinked: number;
  ragChunksInserted: number;
  errors: string[];
}

export type WikiTruthState = 'current' | 'stale' | 'failed' | 'missing';
export type WikiProjectionStatus = 'current' | 'stale' | 'failed';
export type WikiFailureStage = 'provider' | 'parse' | 'persist';

/** Renderer-safe WIKI projection. No prompt, note body, endpoint, key or raw provider error. */
export interface WikiProjectionReceipt {
  projectionId: string;
  notePath: string;
  status: WikiProjectionStatus;
  contentDigest: string;
  summary: string | null;
  tags: string[];
  entityIds: string[];
  relationSignatures: string[];
  generatedAt: number | null;
  failureStage: WikiFailureStage | null;
  failureReason: string | null;
  provenance: WikiProvenanceReceipt | null;
}

export interface WikiProvenanceReceipt {
  provider: string;
  model: string;
  generatedAt: number;
}

/**
 * Digest-bound WIKI truth calculated in Electron main through the canonical
 * package query. Renderer code must display, not derive, this result.
 */
export interface WikiTruthReceipt {
  notePath: string;
  expectedContentDigest: string | null;
  truth: WikiTruthState;
  projection: WikiProjectionReceipt | null;
  current: WikiProjectionReceipt | null;
  latest: WikiProjectionReceipt | null;
  stale: WikiProjectionReceipt[];
  failed: WikiProjectionReceipt[];
  provenance: WikiProvenanceReceipt | null;
  /** Durable kg_pending state reconciled with digest-bound WIKI truth. */
  knowledgeBuild?: KnowledgeBuildStatusReceipt;
}

export type NoteBuildFailureStage = 'kg' | 'wiki' | 'rag';

export interface NoteBuildReceipt {
  state: 'BUILT' | 'BUILD_FAILED';
  kg: {
    state: 'ready' | 'failed';
    entitiesAdded: number;
    entitiesLinked: number;
    reason: string | null;
  };
  wiki: WikiTruthReceipt;
  rag: {
    state: 'ready' | 'failed';
    chunksInserted: number;
    reason: string | null;
  };
  failureStage: NoteBuildFailureStage | null;
  failureReason: string | null;
}

/** Local commit is authoritative even when the separate build receipt fails. */
export interface NoteCommitBuildReceipt {
  note: NoteRecord;
  localState: 'LOCAL_SAVED';
  build: NoteBuildReceipt;
}

export interface RagAnswer {
  text: string;
  sources: string[];
  sourceDetails?: RagSourceDetail[];
}

export type RagRetrievalEvidence = 'vector' | 'kg-entity' | 'kg-neighbor';

export interface RagSourceDetail {
  notePath: string;
  evidence: RagRetrievalEvidence[];
  score: number;
}

export interface AskSourceOrigin {
  exchangeId: string;
  intent: 'full-reader';
  notePath: string;
}

export interface AskConversationSaveRequest {
  exchangeId: string;
  phase: 'completed';
  question: string;
  answer: RagAnswer;
  todoReceipt: TodoRecord | null;
  completedAt: number;
}

export type AskConversationSourceTruth = 'current' | 'stale' | 'missing';

/** Main-process validated latest completed exchange. */
export interface AskConversationSnapshot extends AskConversationSaveRequest {
  schemaVersion: 1;
  sourceTruth: AskConversationSourceTruth;
}

export interface RagStreamChunk {
  delta: string;
  sourceDetails: RagSourceDetail[];
}

export interface RagStreamRequest {
  requestId: string;
  question: string;
}

export interface RagStreamStartResult {
  requestId: string;
  accepted: true;
}

export interface RagStreamCancelResult {
  requestId: string;
  cancelled: boolean;
}

export type RagStreamEvent =
  | {
      requestId: string;
      type: 'delta';
      delta: string;
      sources: RagSourceDetail[];
    }
  | {
      requestId: string;
      type: 'final';
      answer: RagAnswer;
    }
  | {
      requestId: string;
      type: 'error';
      code: 'INVALID_ARGUMENT' | 'OFFLINE' | 'CONFIG_REQUIRED' | 'INTERNAL';
      message: string;
    }
  | {
      requestId: string;
      type: 'cancel';
    };

export type TodoStatus = 'pending' | 'done' | 'cancelled';
export type TodoPriority = 'low' | 'normal' | 'high';
export type TodoId = string | number;

export interface TodoRecord {
  id: TodoId;
  title: string;
  body: string;
  due_at_ms: number | null;
  remind_at_ms: number | null;
  status: TodoStatus;
  priority: TodoPriority;
  note_links: string[];
  reminder_fired: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface CreateTodoRequest {
  title: string;
  body?: string;
  due_at_ms?: number | null;
  remind_at_ms?: number | null;
  status?: TodoStatus;
  priority?: TodoPriority;
  note_links?: string[];
}

export interface UpdateTodoRequest {
  id: TodoId;
  patch: Partial<Omit<CreateTodoRequest, 'title'>> & { title?: string; reminder_fired?: 0 | 1 };
}

export interface ListTodosRequest {
  status?: TodoStatus;
  fromMs?: number;
  toMs?: number;
}

export type RendererTrashState =
  | 'prepared'
  | 'cleanup_pending'
  | 'trashed'
  | 'restoring'
  | 'restored'
  | 'purging'
  | 'purged';

/** Renderer-safe Trash metadata. No filesystem path, journal owner, lease, or content is exposed. */
export interface RendererTrashItem {
  trashId: string;
  kind: 'note' | 'todo';
  title: string;
  revision: string;
  state: RendererTrashState;
  movedAt: number;
  recoveryRequired: boolean;
}

export interface TrashRestoreRequest {
  trashId: string;
  revision: string;
}

export interface TrashPurgeRequest extends TrashRestoreRequest {
  confirmed: true;
}

export interface DomainIpcContract {
  [IPC_CHANNELS.NOTES_LIST]: { request: ListNotesRequest | undefined; response: NoteList };
  [IPC_CHANNELS.NOTES_GET]: { request: string; response: NoteDocument | null };
  [IPC_CHANNELS.NOTES_CREATE]: { request: CreateNoteRequest; response: NoteRecord };
  [IPC_CHANNELS.NOTES_CREATE_WITH_BUILD]: {
    request: CreateNoteRequest;
    response: NoteCommitBuildReceipt;
  };
  [IPC_CHANNELS.NOTES_UPDATE]: { request: UpdateNoteRequest; response: NoteRecord | null };
  [IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD]: {
    request: UpdateNoteRequest;
    response: NoteCommitBuildReceipt | null;
  };
  [IPC_CHANNELS.NOTES_REMOVE]: { request: string; response: boolean };
  [IPC_CHANNELS.NOTES_GET_BACKLINKS]: { request: string; response: BacklinkRecord[] };
  [IPC_CHANNELS.WIKI_GET_FOR_NOTE]: { request: string; response: WikiTruthReceipt };
  [IPC_CHANNELS.KG_GET_SUBGRAPH]: {
    request: KgSubgraphRequest | number | undefined;
    response: KgSubgraph;
  };
  [IPC_CHANNELS.KG_REINDEX_NOTE]: { request: string; response: ReindexResult };
  [IPC_CHANNELS.RAG_ASK]: { request: string; response: RagAnswer };
  [IPC_CHANNELS.RAG_STREAM_START]: { request: RagStreamRequest; response: RagStreamStartResult };
  [IPC_CHANNELS.RAG_STREAM_CANCEL]: { request: string; response: RagStreamCancelResult };
  [IPC_CHANNELS.ASK_CONVERSATION_SAVE]: {
    request: AskConversationSaveRequest;
    response: AskConversationSnapshot;
  };
  [IPC_CHANNELS.ASK_CONVERSATION_LOAD]: {
    request: undefined;
    response: AskConversationSnapshot | null;
  };
  [IPC_CHANNELS.ASK_CONVERSATION_CLEAR]: { request: undefined; response: void };
  [IPC_CHANNELS.TODOS_LIST]: { request: ListTodosRequest | undefined; response: TodoRecord[] };
  [IPC_CHANNELS.TODOS_CREATE]: { request: CreateTodoRequest; response: TodoRecord };
  [IPC_CHANNELS.TODOS_UPDATE]: { request: UpdateTodoRequest; response: TodoRecord | null };
  [IPC_CHANNELS.TODOS_REMOVE]: { request: TodoId; response: boolean };
  [IPC_CHANNELS.TODOS_LIST_DUE]: { request: number | undefined; response: TodoRecord[] };
  [IPC_CHANNELS.TODOS_MARK_REMINDER_FIRED]: { request: TodoId; response: TodoRecord | null };
  [IPC_CHANNELS.TRASH_MOVE_NOTE]: { request: { path: string }; response: RendererTrashItem };
  [IPC_CHANNELS.TRASH_MOVE_TODO]: { request: { id: TodoId }; response: RendererTrashItem };
  [IPC_CHANNELS.TRASH_LIST]: { request: undefined; response: RendererTrashItem[] };
  [IPC_CHANNELS.TRASH_RESTORE]: { request: TrashRestoreRequest; response: RendererTrashItem };
  [IPC_CHANNELS.TRASH_PURGE]: { request: TrashPurgeRequest; response: RendererTrashItem };
}

export type DomainIpcChannel = keyof DomainIpcContract;
export type DomainIpcRequest<C extends DomainIpcChannel> = DomainIpcContract[C]['request'];
export type DomainIpcResponse<C extends DomainIpcChannel> = DomainIpcContract[C]['response'];

export interface CopilotDomainBridge {
  notes: {
    list(request?: ListNotesRequest): Promise<NoteList>;
    get(path: string): Promise<NoteDocument | null>;
    create(request: CreateNoteRequest): Promise<NoteRecord>;
    createWithBuild(request: CreateNoteRequest): Promise<NoteCommitBuildReceipt>;
    update(request: UpdateNoteRequest): Promise<NoteRecord | null>;
    updateWithBuild(request: UpdateNoteRequest): Promise<NoteCommitBuildReceipt | null>;
    remove(path: string): Promise<boolean>;
    getBacklinks(path: string): Promise<BacklinkRecord[]>;
  };
  wiki: {
    getForNote(path: string): Promise<WikiTruthReceipt>;
  };
  kg: {
    getSubgraph(request?: KgSubgraphRequest | number): Promise<KgSubgraph>;
    reindexNote(path: string): Promise<ReindexResult>;
  };
  rag: {
    ask(question: string): Promise<RagAnswer>;
    startStream(request: RagStreamRequest): Promise<RagStreamStartResult>;
    cancelStream(requestId: string): Promise<RagStreamCancelResult>;
    onStreamEvent(listener: (event: RagStreamEvent) => void): () => void;
  };
  askConversation?: {
    save(request: AskConversationSaveRequest): Promise<AskConversationSnapshot>;
    load(): Promise<AskConversationSnapshot | null>;
    clear(): Promise<void>;
  };
  todos: {
    list(request?: ListTodosRequest): Promise<TodoRecord[]>;
    create(request: CreateTodoRequest): Promise<TodoRecord>;
    update(request: UpdateTodoRequest): Promise<TodoRecord | null>;
    remove(id: TodoId): Promise<boolean>;
    listDue(now?: number): Promise<TodoRecord[]>;
    markReminderFired(id: TodoId): Promise<TodoRecord | null>;
  };
  trash?: {
    moveNote(path: string): Promise<RendererTrashItem>;
    moveTodo(id: TodoId): Promise<RendererTrashItem>;
    list(): Promise<RendererTrashItem[]>;
    restore(request: TrashRestoreRequest): Promise<RendererTrashItem>;
    purge(request: TrashPurgeRequest): Promise<RendererTrashItem>;
  };
}
