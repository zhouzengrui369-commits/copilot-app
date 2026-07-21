import type {
  CreateNoteRequest,
  CreateTodoRequest,
  NoteDocument,
  TodoId,
  TodoRecord,
  UpdateNoteRequest,
  UpdateTodoRequest,
} from '../../shared/domain-api.js';
import type { RemoteCommand } from '../../shared/remote-management.js';
import type { LocalKnowledgeService } from '../local-knowledge-service.js';
import type {
  RemoteLocalAdapter,
  RemoteLocalPreview,
  RemoteLocalResult,
} from './controller.js';

/**
 * Executes only against the existing local-first service. The existing remove
 * methods are intentionally never referenced: they permanently delete, while
 * Remote A allows reversible move-to-trash only.
 */
export class ProductionRemoteLocalAdapter implements RemoteLocalAdapter {
  constructor(private readonly getService: () => LocalKnowledgeService | Promise<LocalKnowledgeService>) {}

  async preview(command: RemoteCommand): Promise<RemoteLocalPreview> {
    const service = await this.getService();
    switch (command.action) {
      case 'note.list':
      case 'todo.list':
      case 'note.create':
      case 'todo.create':
        return { currentRevision: null, proposedFields: cloneRecord(command.input), diff: [] };
      case 'note.read':
      case 'note.update':
      case 'note.move_to_trash': {
        const current = await service.notes.get(requiredId(command));
        return previewNote(command, current);
      }
      case 'todo.read':
      case 'todo.update':
      case 'todo.move_to_trash': {
        const current = await findTodo(service, requiredId(command));
        return previewTodo(command, current);
      }
      case 'command.status':
        return { currentRevision: null, proposedFields: {}, diff: [] };
    }
  }

  async execute(command: RemoteCommand): Promise<RemoteLocalResult> {
    const service = await this.getService();
    try {
      switch (command.action) {
        case 'note.list': {
          const result = await service.notes.list(command.input);
          return success(null, null, result);
        }
        case 'note.read': {
          const result = await service.notes.get(requiredId(command));
          return result
            ? success(noteRevision(result), noteRevision(result), result)
            : failed();
        }
        case 'note.create': {
          const result = await service.notes.create(command.input as unknown as CreateNoteRequest);
          return success(null, `note:${result.updatedAt}`, result);
        }
        case 'note.update': {
          const id = requiredId(command);
          const current = await service.notes.get(id);
          const revision = current ? noteRevision(current) : null;
          if (!current || revision !== command.expectedRevision) return conflict(revision);
          const result = await service.notes.update({
            path: id,
            patch: command.input.patch as UpdateNoteRequest['patch'],
          });
          return result
            ? success(revision, `note:${result.updatedAt}`, result)
            : failed(revision);
        }
        case 'todo.list': {
          const result = await service.todos.list(command.input);
          return success(null, null, result);
        }
        case 'todo.read': {
          const result = await findTodo(service, requiredId(command));
          return result
            ? success(todoRevision(result), todoRevision(result), result)
            : failed();
        }
        case 'todo.create': {
          const result = await service.todos.create(command.input as unknown as CreateTodoRequest);
          return success(null, todoRevision(result), result);
        }
        case 'todo.update': {
          const id = requiredId(command);
          const current = await findTodo(service, id);
          const revision = current ? todoRevision(current) : null;
          if (!current || revision !== command.expectedRevision) return conflict(revision);
          const result = await service.todos.update({
            id: normalizeTodoId(id),
            patch: command.input.patch as UpdateTodoRequest['patch'],
          });
          return result
            ? success(revision, todoRevision(result), result)
            : failed(revision);
        }
        case 'note.move_to_trash': {
          const id = requiredId(command);
          const expectedRevision = requiredExpectedRevision(command);
          const current = await service.notes.get(id);
          const revision = current ? noteRevision(current) : null;
          if (!current || revision !== expectedRevision) return conflict(revision);
          try {
            const result = await service.notes.moveToTrash({
              path: id,
              expectedRevision,
              idempotencyKey: command.idempotencyKey,
            });
            return success(revision, result.trashRevision, result);
          } catch (error) {
            return isTrashConflict(error) ? conflict(revision) : failed(revision);
          }
        }
        case 'todo.move_to_trash': {
          const id = requiredId(command);
          const expectedRevision = requiredExpectedRevision(command);
          const current = await findTodo(service, id);
          const revision = current ? todoRevision(current) : null;
          if (!current || revision !== expectedRevision) return conflict(revision);
          try {
            const result = await service.todos.moveToTrash({
              id: normalizeTodoId(id),
              expectedRevision,
              idempotencyKey: command.idempotencyKey,
            });
            return success(revision, result.trashRevision, result);
          } catch (error) {
            return isTrashConflict(error) ? conflict(revision) : failed(revision);
          }
        }
        case 'command.status':
          return failed();
      }
    } catch {
      return failed();
    }
  }
}

function previewNote(command: RemoteCommand, current: NoteDocument | null): RemoteLocalPreview {
  const proposedFields = proposed(command);
  return {
    currentRevision: current ? noteRevision(current) : null,
    proposedFields,
    diff: command.action === 'note.update' && current
      ? diffFields({ ...current.note, body: current.body }, proposedFields)
      : command.action === 'note.move_to_trash'
        ? [{ field: 'location', before: 'active local note', after: 'reversible local trash' }]
        : [],
  };
}

function previewTodo(command: RemoteCommand, current: TodoRecord | null): RemoteLocalPreview {
  const proposedFields = proposed(command);
  return {
    currentRevision: current ? todoRevision(current) : null,
    proposedFields,
    diff: command.action === 'todo.update' && current
      ? diffFields(current as unknown as Record<string, unknown>, proposedFields)
      : command.action === 'todo.move_to_trash'
        ? [{ field: 'location', before: 'active local todo', after: 'reversible local trash' }]
        : [],
  };
}

function proposed(command: RemoteCommand): Record<string, unknown> {
  const source = command.action.endsWith('.update')
    ? command.input.patch
    : command.input;
  return cloneRecord(source);
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return structuredClone(value as Record<string, unknown>);
}

function diffFields(current: Record<string, unknown>, proposedFields: Record<string, unknown>) {
  return Object.entries(proposedFields).map(([field, after]) => ({
    field,
    before: current[field] ?? null,
    after,
  }));
}

async function findTodo(service: LocalKnowledgeService, id: string): Promise<TodoRecord | null> {
  const todos = await service.todos.list();
  return todos.find((todo) => String(todo.id) === id) ?? null;
}

function noteRevision(note: NoteDocument): string {
  return `note:${note.note.updatedAt}`;
}

function todoRevision(todo: TodoRecord): string {
  return `todo:${todo.updated_at}`;
}

function normalizeTodoId(id: string): TodoId {
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && String(numeric) === id ? numeric : id;
}

function requiredId(command: RemoteCommand): string {
  if (!command.resource.id) throw new Error('resource id is required');
  return command.resource.id;
}

function requiredExpectedRevision(command: RemoteCommand): string {
  if (!command.expectedRevision) throw new Error('expected revision is required');
  return command.expectedRevision;
}

function success(
  preRevision: string | null,
  postRevision: string | null,
  result: unknown,
): RemoteLocalResult {
  return { code: 'EXECUTED', preRevision, postRevision, result };
}

function conflict(preRevision: string | null): RemoteLocalResult {
  return { code: 'REVISION_CONFLICT', preRevision, postRevision: null };
}

function failed(preRevision: string | null = null): RemoteLocalResult {
  return { code: 'LOCAL_EXECUTION_FAILED', preRevision, postRevision: null };
}

function isTrashConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('TRASH_REVISION_CONFLICT');
}
