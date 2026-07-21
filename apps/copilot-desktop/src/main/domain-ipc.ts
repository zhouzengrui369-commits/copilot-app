/** Typed IPC registration for the local-first domain bridge. */
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import type {
  DomainIpcChannel,
  DomainIpcRequest,
  DomainIpcResponse,
  RagStreamEvent,
  RagStreamRequest,
  RendererTrashItem,
  TodoId,
  TrashPurgeRequest,
  TrashRestoreRequest,
} from '../shared/domain-api.js';
import {
  DomainServiceError,
  type LocalKnowledgeService,
  type LocalTrashEntry,
} from './local-knowledge-service.js';
import type { NorthStarOperation } from './local-telemetry.js';

export interface IpcMainRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, payload?: unknown) => unknown,
  ): void;
}

export type KnowledgeServiceProvider = () =>
  | LocalKnowledgeService
  | Promise<LocalKnowledgeService>;

export function registerDomainIpc(
  ipc: IpcMainRegistrar,
  getService: KnowledgeServiceProvider,
  recordOperation?: (operation: NorthStarOperation) => void | Promise<void>,
): void {
  const activeRagStreams = new Map<string, AbortController>();
  handle(ipc, IPC_CHANNELS.NOTES_LIST, getService, (service, request) => service.notes.list(request), recordOperation, 'notes.list');
  handle(ipc, IPC_CHANNELS.NOTES_GET, getService, (service, request) => service.notes.get(request), recordOperation, 'notes.get');
  handle(ipc, IPC_CHANNELS.NOTES_CREATE, getService, (service, request) => service.notes.create(request), recordOperation, 'notes.create');
  handle(ipc, IPC_CHANNELS.NOTES_UPDATE, getService, (service, request) => service.notes.update(request), recordOperation, 'notes.update');
  handle(ipc, IPC_CHANNELS.NOTES_REMOVE, getService, (service, request) => service.notes.remove(request), recordOperation, 'notes.remove');
  handle(ipc, IPC_CHANNELS.NOTES_GET_BACKLINKS, getService, (service, request) => service.notes.getBacklinks(request), recordOperation, 'notes.backlinks');
  handle(ipc, IPC_CHANNELS.KG_GET_SUBGRAPH, getService, (service, request) => service.kg.getSubgraph(request), recordOperation, 'kg.view');
  handle(ipc, IPC_CHANNELS.KG_REINDEX_NOTE, getService, (service, request) => service.kg.reindexNote(request), recordOperation, 'kg.reindex');
  handle(ipc, IPC_CHANNELS.RAG_ASK, getService, (service, request) => service.rag.ask(request), recordOperation, 'rag.ask');
  ipc.handle(IPC_CHANNELS.RAG_STREAM_START, async (event, payload) => {
    try {
      const request = assertRagStreamRequest(payload);
      if (activeRagStreams.has(request.requestId)) {
        throw new DomainServiceError('INVALID_ARGUMENT', 'RAG request id is already active');
      }
      const sender = getEventSender(event);
      const controller = new AbortController();
      activeRagStreams.set(request.requestId, controller);
      void runRagStream(getService, request, sender, controller, activeRagStreams);
      await recordProductOperation(recordOperation, 'rag.stream');
      return { requestId: request.requestId, accepted: true as const };
    } catch (error) {
      throw toSafeIpcError(error);
    }
  });
  ipc.handle(IPC_CHANNELS.RAG_STREAM_CANCEL, async (_event, payload) => {
    const requestId = typeof payload === 'string' ? payload.trim() : '';
    if (!requestId) throw toSafeIpcError(
      new DomainServiceError('INVALID_ARGUMENT', 'RAG request id is required'),
    );
    const controller = activeRagStreams.get(requestId);
    controller?.abort();
    return { requestId, cancelled: Boolean(controller) };
  });
  handle(ipc, IPC_CHANNELS.TODOS_LIST, getService, (service, request) => service.todos.list(request), recordOperation, 'todos.list');
  handle(ipc, IPC_CHANNELS.TODOS_CREATE, getService, (service, request) => service.todos.create(request), recordOperation, 'todos.create');
  handle(ipc, IPC_CHANNELS.TODOS_UPDATE, getService, (service, request) => service.todos.update(request), recordOperation, 'todos.update');
  handle(ipc, IPC_CHANNELS.TODOS_REMOVE, getService, (service, request) => service.todos.remove(request), recordOperation, 'todos.remove');
  handle(ipc, IPC_CHANNELS.TODOS_LIST_DUE, getService, (service, request) => service.todos.listDue(request), recordOperation, 'todos.due');
  handle(ipc, IPC_CHANNELS.TODOS_MARK_REMINDER_FIRED, getService, (service, request) => service.todos.markReminderFired(request), recordOperation, 'todos.reminder-fired');
  ipc.handle(IPC_CHANNELS.TRASH_MOVE_NOTE, (_event, payload) => trashOperation(async () => {
    const request = assertMoveNoteRequest(payload);
    const service = await getService();
    const current = await service.notes.get(request.path);
    if (!current) throw new DomainServiceError('NOT_FOUND', 'local item was not found');
    return toRendererTrashItem(await service.notes.moveToTrash({
      path: request.path,
      expectedRevision: `note:${current.note.updatedAt}`,
      idempotencyKey: randomUUID(),
    }));
  }));
  ipc.handle(IPC_CHANNELS.TRASH_MOVE_TODO, (_event, payload) => trashOperation(async () => {
    const request = assertMoveTodoRequest(payload);
    const service = await getService();
    const current = (await service.todos.list()).find((todo) => String(todo.id) === String(request.id));
    if (!current) throw new DomainServiceError('NOT_FOUND', 'local item was not found');
    return toRendererTrashItem(await service.todos.moveToTrash({
      id: request.id,
      expectedRevision: `todo:${current.updated_at}`,
      idempotencyKey: randomUUID(),
    }));
  }));
  ipc.handle(IPC_CHANNELS.TRASH_LIST, (_event, payload) => trashOperation(async () => {
    if (payload !== undefined) throw new DomainServiceError('INVALID_ARGUMENT', 'trash list request is invalid');
    const service = await getService();
    return (await service.trash.list())
      .filter((entry) => entry.state !== 'restored' && entry.state !== 'purged')
      .map(toRendererTrashItem);
  }));
  ipc.handle(IPC_CHANNELS.TRASH_RESTORE, (_event, payload) => trashOperation(async () => {
    const request = assertTrashRestoreRequest(payload);
    const service = await getService();
    await assertEligibleTrashEntry(service, request);
    return toRendererTrashItem(await service.trash.restore({
      trashId: request.trashId,
      expectedRevision: request.revision,
      idempotencyKey: randomUUID(),
    }));
  }));
  ipc.handle(IPC_CHANNELS.TRASH_PURGE, (_event, payload) => trashOperation(async () => {
    const request = assertTrashPurgeRequest(payload);
    const service = await getService();
    await assertEligibleTrashEntry(service, request);
    return toRendererTrashItem(await service.trash.purge({
      trashId: request.trashId,
      expectedRevision: request.revision,
      idempotencyKey: randomUUID(),
    }));
  }));
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

async function trashOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toSafeIpcError(error);
  }
}

function assertMoveNoteRequest(payload: unknown): { path: string } {
  const request = exactRecord(payload, ['path'], 'trash note request');
  if (typeof request.path !== 'string' || !request.path.trim() || request.path.length > 500 || CONTROL_CHARACTER.test(request.path)) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'trash note request is invalid');
  }
  return { path: request.path.trim() };
}

function assertMoveTodoRequest(payload: unknown): { id: TodoId } {
  const request = exactRecord(payload, ['id'], 'trash Todo request');
  if (
    (typeof request.id !== 'string' && typeof request.id !== 'number')
    || (typeof request.id === 'string' && (!request.id.trim() || request.id.length > 160 || CONTROL_CHARACTER.test(request.id)))
    || (typeof request.id === 'number' && !Number.isSafeInteger(request.id))
  ) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'trash Todo request is invalid');
  }
  return { id: typeof request.id === 'string' ? request.id.trim() : request.id };
}

function assertTrashRestoreRequest(payload: unknown): TrashRestoreRequest {
  const request = exactRecord(payload, ['revision', 'trashId'], 'trash restore request');
  return assertTrashIdentity(request, 'trash restore request');
}

function assertTrashPurgeRequest(payload: unknown): TrashPurgeRequest {
  const request = exactRecord(payload, ['confirmed', 'revision', 'trashId'], 'trash purge request');
  if (request.confirmed !== true) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'explicit purge confirmation is required');
  }
  return { ...assertTrashIdentity(request, 'trash purge request'), confirmed: true };
}

function assertTrashIdentity(request: Record<string, unknown>, label: string): TrashRestoreRequest {
  if (typeof request.trashId !== 'string' || !UUID_V4.test(request.trashId)) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} is invalid`);
  }
  if (
    typeof request.revision !== 'string'
    || !request.revision.startsWith('trash:')
    || request.revision.length > 200
    || CONTROL_CHARACTER.test(request.revision)
  ) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} is invalid`);
  }
  return { trashId: request.trashId, revision: request.revision };
}

function exactRecord(payload: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} is invalid`);
  }
  const actual = Object.keys(payload).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DomainServiceError('INVALID_ARGUMENT', `${label} is invalid`);
  }
  return payload as Record<string, unknown>;
}

async function assertEligibleTrashEntry(
  service: LocalKnowledgeService,
  request: TrashRestoreRequest,
): Promise<LocalTrashEntry> {
  const entry = (await service.trash.list()).find((candidate) => candidate.trashId === request.trashId);
  if (!entry) throw new DomainServiceError('NOT_FOUND', 'local trash item was not found');
  if (entry.trashRevision !== request.revision) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'trash item changed; refresh and retry');
  }
  if (entry.state !== 'trashed') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'trash item is not eligible while recovery is pending');
  }
  return entry;
}

function toRendererTrashItem(entry: LocalTrashEntry): RendererTrashItem {
  const title = typeof entry.title === 'string'
    && entry.title.trim()
    && entry.title.length <= 300
    && !CONTROL_CHARACTER.test(entry.title)
    ? entry.title.trim()
    : entry.kind === 'todo' ? '已删除待办' : '已删除笔记';
  return {
    trashId: entry.trashId,
    kind: entry.kind,
    title,
    revision: entry.trashRevision,
    state: entry.state,
    movedAt: entry.movedAt,
    recoveryRequired: entry.state !== 'trashed' && entry.state !== 'restored' && entry.state !== 'purged',
  };
}

interface RagStreamSender {
  send(channel: string, event: RagStreamEvent): void;
}

function assertRagStreamRequest(payload: unknown): RagStreamRequest {
  if (!payload || typeof payload !== 'object') {
    throw new DomainServiceError('INVALID_ARGUMENT', 'RAG stream request is required');
  }
  const request = payload as Partial<RagStreamRequest>;
  if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'RAG request id is required');
  }
  if (typeof request.question !== 'string' || !request.question.trim()) {
    throw new DomainServiceError('INVALID_ARGUMENT', 'question is required');
  }
  return { requestId: request.requestId.trim(), question: request.question.trim() };
}

function getEventSender(event: unknown): RagStreamSender {
  const sender = (event as { sender?: Partial<RagStreamSender> } | null)?.sender;
  if (!sender || typeof sender.send !== 'function') {
    throw new DomainServiceError('INTERNAL', 'RAG event channel is unavailable');
  }
  return sender as RagStreamSender;
}

async function runRagStream(
  getService: KnowledgeServiceProvider,
  request: RagStreamRequest,
  sender: RagStreamSender,
  controller: AbortController,
  active: Map<string, AbortController>,
): Promise<void> {
  try {
    const service = await getService();
    const iterator = service.rag.stream(request.question, controller.signal);
    let item = await iterator.next();
    while (!item.done) {
      throwIfRagStreamCancelled(controller.signal);
      sender.send(IPC_CHANNELS.RAG_STREAM_EVENT, {
        requestId: request.requestId,
        type: 'delta',
        delta: item.value.delta,
        sources: item.value.sourceDetails,
      });
      item = await iterator.next();
    }
    // The provider is expected to observe AbortSignal, but the transport must
    // still make cancellation terminal if a provider resolves one last chunk
    // or final result concurrently with the cancel IPC.
    throwIfRagStreamCancelled(controller.signal);
    sender.send(IPC_CHANNELS.RAG_STREAM_EVENT, {
      requestId: request.requestId,
      type: 'final',
      answer: item.value,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      sender.send(IPC_CHANNELS.RAG_STREAM_EVENT, {
        requestId: request.requestId,
        type: 'cancel',
      });
    } else {
      const safe = toSafeRagStreamError(error);
      sender.send(IPC_CHANNELS.RAG_STREAM_EVENT, {
        requestId: request.requestId,
        type: 'error',
        ...safe,
      });
    }
  } finally {
    if (active.get(request.requestId) === controller) active.delete(request.requestId);
  }
}

function throwIfRagStreamCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('RAG request cancelled', 'AbortError');
}

function toSafeRagStreamError(error: unknown): Pick<Extract<RagStreamEvent, { type: 'error' }>, 'code' | 'message'> {
  if (error instanceof DomainServiceError) {
    return {
      code: error.code === 'NOT_FOUND' ? 'INTERNAL' : error.code,
      message: error.code === 'NOT_FOUND' ? 'local knowledge request failed' : error.message,
    };
  }
  return { code: 'INTERNAL', message: 'local knowledge request failed' };
}

function handle<C extends DomainIpcChannel>(
  ipc: IpcMainRegistrar,
  channel: C,
  getService: KnowledgeServiceProvider,
  operation: (
    service: LocalKnowledgeService,
    request: DomainIpcRequest<C>,
  ) => Promise<DomainIpcResponse<C>>,
  recordOperation: ((operation: NorthStarOperation) => void | Promise<void>) | undefined,
  operationId: NorthStarOperation,
): void {
  ipc.handle(channel, async (_event, payload) => {
    try {
      const service = await getService();
      const result = await operation(service, payload as DomainIpcRequest<C>);
      await recordProductOperation(recordOperation, operationId);
      return result;
    } catch (error) {
      throw toSafeIpcError(error);
    }
  });
}

async function recordProductOperation(
  recorder: ((operation: NorthStarOperation) => void | Promise<void>) | undefined,
  operation: NorthStarOperation,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder(operation);
  } catch {
    // Local evidence must never change the product operation outcome.
  }
}

/**
 * Electron transports Error.message to the renderer. Only allow our curated
 * domain messages through; unknown errors may contain note text or secrets.
 */
export function toSafeIpcError(error: unknown): Error {
  if (error instanceof DomainServiceError) {
    return new Error(`[${error.code}] ${error.message}`);
  }
  return new Error('[INTERNAL] local knowledge request failed');
}
