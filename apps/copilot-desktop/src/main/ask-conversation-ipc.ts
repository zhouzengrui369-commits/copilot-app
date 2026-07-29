import { createHash } from 'node:crypto';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import type {
  AskConversationSaveRequest,
  AskConversationSnapshot,
  TodoRecord,
} from '../shared/domain-api.js';
import type { LocalKnowledgeService } from './local-knowledge-service.js';
import {
  type AskConversationPersistence,
  type StoredAskConversationSnapshot,
} from './ask-conversation-store.js';

interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): void;
}

type StoreProvider = () => AskConversationPersistence;
type ServiceProvider = () => LocalKnowledgeService | Promise<LocalKnowledgeService>;

export function registerAskConversationIpc(
  ipc: IpcRegistrar,
  getStore: StoreProvider,
  getService: ServiceProvider,
): void {
  let operationTail: Promise<void> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  ipc.handle(IPC_CHANNELS.ASK_CONVERSATION_SAVE, (_event, payload) =>
    serialize(async () => {
      const request = assertSaveRequest(payload);
      const service = await getService();
      const sourceBindings = [];
      for (const notePath of request.answer.sources) {
        const document = await service.notes.get(notePath);
        if (!document || document.note.path !== notePath) sourceInvalid();
        sourceBindings.push({
          notePath,
          updatedAt: document.note.updatedAt,
          bodyDigest: digest(document.body),
        });
      }
      if (request.todoReceipt) {
        const canonical = (await service.todos.list())
          .find((todo) => String(todo.id) === String(request.todoReceipt?.id));
        if (!canonical || !sameTodo(canonical, request.todoReceipt, request.answer.sources)) {
          throw new Error('ASK_CONVERSATION_TODO_INVALID');
        }
      }
      const stored: StoredAskConversationSnapshot = {
        schemaVersion: 1,
        ...request,
        sourceBindings,
      };
      await getStore().save(stored);
      return toRendererSnapshot(stored, 'current');
    }));

  ipc.handle(IPC_CHANNELS.ASK_CONVERSATION_LOAD, () =>
    serialize(async () => {
      const stored = await getStore().load();
      if (!stored) return null;
      const service = await getService();
      let truth: AskConversationSnapshot['sourceTruth'] = 'current';
      for (const binding of stored.sourceBindings) {
        const document = await service.notes.get(binding.notePath);
        if (!document || document.note.path !== binding.notePath) {
          truth = 'missing';
          break;
        }
        if (
          document.note.updatedAt !== binding.updatedAt
          || digest(document.body) !== binding.bodyDigest
        ) {
          truth = 'stale';
        }
      }
      let todoReceipt = stored.todoReceipt;
      if (todoReceipt) {
        const canonical = (await service.todos.list())
          .find((todo) => String(todo.id) === String(todoReceipt?.id));
        if (!canonical || !sameTodo(canonical, todoReceipt, stored.answer.sources)) {
          todoReceipt = null;
        }
      }
      return toRendererSnapshot({ ...stored, todoReceipt }, truth);
    }));

  ipc.handle(IPC_CHANNELS.ASK_CONVERSATION_CLEAR, () =>
    serialize(async () => {
      await getStore().clear();
    }));
}

function toRendererSnapshot(
  stored: StoredAskConversationSnapshot,
  sourceTruth: AskConversationSnapshot['sourceTruth'],
): AskConversationSnapshot {
  return {
    schemaVersion: 1,
    exchangeId: stored.exchangeId,
    phase: 'completed',
    question: stored.question,
    answer: stored.answer,
    todoReceipt: sourceTruth === 'current' ? stored.todoReceipt : null,
    completedAt: stored.completedAt,
    sourceTruth,
  };
}

function assertSaveRequest(value: unknown): AskConversationSaveRequest {
  if (!isRecord(value) || value.phase !== 'completed') invalid();
  if (typeof value.exchangeId !== 'string' || !value.exchangeId.trim()) invalid();
  if (typeof value.question !== 'string' || !value.question.trim()) invalid();
  if (!isRecord(value.answer) || typeof value.answer.text !== 'string' || !value.answer.text.trim()) invalid();
  if (!Array.isArray(value.answer.sources) || value.answer.sources.length === 0) invalid();
  if (!Array.isArray(value.answer.sourceDetails) || value.answer.sourceDetails.length !== value.answer.sources.length) invalid();
  for (let index = 0; index < value.answer.sources.length; index += 1) {
    const path = value.answer.sources[index];
    const detail = value.answer.sourceDetails[index];
    if (typeof path !== 'string' || !path || !isRecord(detail) || detail.notePath !== path) invalid();
  }
  if (!Number.isSafeInteger(value.completedAt) || (value.completedAt as number) <= 0) invalid();
  if (value.todoReceipt !== null && !isRecord(value.todoReceipt)) invalid();
  return value as unknown as AskConversationSaveRequest;
}

function sameTodo(
  actual: TodoRecord,
  expected: TodoRecord,
  sources: string[],
): boolean {
  return String(actual.id) === String(expected.id)
    && actual.title === expected.title
    && actual.body === expected.body
    && actual.status === expected.status
    && actual.due_at_ms === expected.due_at_ms
    && actual.remind_at_ms === expected.remind_at_ms
    && JSON.stringify(actual.note_links) === JSON.stringify(expected.note_links)
    && JSON.stringify(actual.note_links) === JSON.stringify(sources);
}

function digest(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalid(): never {
  throw new Error('ASK_CONVERSATION_INVALID');
}

function sourceInvalid(): never {
  throw new Error('ASK_CONVERSATION_SOURCE_INVALID');
}
