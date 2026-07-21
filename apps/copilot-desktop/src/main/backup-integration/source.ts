import { createHash } from 'node:crypto';

import type { NoteDocument, NoteList, TodoRecord } from '../../shared/domain-api.js';
import type { SettingsStorage } from '../settings-store.js';
import type { BackupScope, BackupSourceFile, CreateBackupInput } from '../backup/index.js';
import { BackupProtocolError } from '../backup/index.js';
import type {
  BackupIntegrationSource,
  BackupPreparedRestoreImport,
  BackupRestoreImportIntent,
} from './manager.js';

interface KnowledgeSourcePort {
  notes: {
    list(request: { limit: number; offset: number }): Promise<NoteList>;
    get(notePath: string): Promise<NoteDocument | null>;
  };
  todos: { list(): Promise<TodoRecord[]> };
  backupImport: {
    noteExists(path: string): Promise<boolean>;
    todoExists(id: string): Promise<boolean>;
    createNote(request: {
      path: string;
      title: string;
      body: string;
      type: BackupPreparedRestoreImport['notes'][number]['type'];
      status: BackupPreparedRestoreImport['notes'][number]['status'];
      tags: string[];
      related: string[];
      confidence: number | null;
      agent: string | null;
      importMarker: string;
    }): Promise<void>;
    createTodo(todo: BackupPreparedRestoreImport['todos'][number], importNamespace: string): Promise<void>;
    rollback(request: {
      importNamespace: string;
      notePaths: readonly string[];
      todoIds: readonly string[];
    }): Promise<void>;
  };
}

const encoder = new TextEncoder();

export class LocalKnowledgeBackupSource implements BackupIntegrationSource {
  constructor(
    private readonly getService: () => Promise<KnowledgeSourcePort>,
    private readonly settings: Pick<SettingsStorage, 'get'>,
    private readonly appVersion: string,
  ) {}

  async estimate(scopes: readonly BackupScope[]) {
    const gathered = await this.gather(scopes);
    const logicalBytes = gathered.files.reduce((sum, file) => sum + file.data.byteLength, 0);
    return {
      // Conservative envelope/header/chunk/tag allowance; UI labels this estimate.
      estimatedEncryptedBytes: logicalBytes + 4096 + gathered.files.length * 96,
      counts: {
        files: gathered.files.length,
        records: gathered.files.reduce((sum, file) => sum + (file.recordCount ?? 0), 0),
      },
    };
  }

  async gather(scopes: readonly BackupScope[]): Promise<CreateBackupInput> {
    if (scopes.some((scope) => ['kb-logical', 'kb-index-metadata', 'kg-nodes', 'kg-edges'].includes(scope))) {
      // No safe import-as-copy adapter exists for these domains in r1.
      throw new BackupProtocolError('SCOPE_INVALID');
    }
    const files: BackupSourceFile[] = [];
    const sourceRevisions: Record<string, string> = {};
    const service = await this.getService();

    if (scopes.includes('note-markdown') || scopes.includes('note-metadata')) {
      if (!(scopes.includes('note-markdown') && scopes.includes('note-metadata'))) throw new BackupProtocolError('SCOPE_INVALID');
      const documents = await this.readNotes(service);
      const metadata = documents.map(({ note }) => ({
        logicalId: digest(note.path),
        originalLogicalPath: note.path,
        title: note.title,
        type: note.type,
        status: note.status,
        tags: note.tags,
        related: note.related,
        folder: note.folder,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        confidence: note.confidence,
        agent: note.agent,
      }));
      for (const document of documents) {
        files.push({
          logicalPath: `notes/${digest(document.note.path)}.md`,
          scope: 'note-markdown',
          data: encoder.encode(document.body),
          recordCount: 1,
          sourceRevision: String(document.note.updatedAt),
        });
      }
      files.push({ logicalPath: 'notes/metadata.json', scope: 'note-metadata', data: json(metadata), recordCount: metadata.length });
      sourceRevisions.notes = revision(documents.map((item) => item.note.updatedAt));
    }

    if (scopes.includes('todos')) {
      const todos = await service.todos.list();
      files.push({ logicalPath: 'todos/items.json', scope: 'todos', data: json(todos), recordCount: todos.length });
      sourceRevisions.todos = revision(todos.map((item) => item.updated_at));
    }

    if (scopes.includes('preferences')) {
      const selected = {
        theme: this.settings.get('theme'),
        windowBounds: this.settings.get('windowBounds'),
        shortcuts: this.settings.get('shortcuts'),
        schemaVersion: this.settings.get('schemaVersion'),
      };
      files.push({ logicalPath: 'preferences/settings.json', scope: 'preferences', data: json(selected), recordCount: 1 });
      sourceRevisions.preferences = String(selected.schemaVersion);
    }

    return {
      appVersion: this.appVersion,
      logicalSchemaVersion: 'phase1-v1',
      selectedScopes: [...scopes],
      sourceRevisions,
      files,
    };
  }

  async prepareRestoreImport(input: Parameters<NonNullable<BackupIntegrationSource['prepareRestoreImport']>>[0]): Promise<BackupPreparedRestoreImport> {
    const { plan, files } = input;
    const selectedScopes = canonicalRestoreScopes(plan.manifest.selectedScopes);
    if (!SNAPSHOT_ID.test(plan.snapshotId)) throw new BackupProtocolError('RESTORE_CONFLICT');
    if (plan.manifest.logicalSchemaVersion !== 'phase1-v1'
      || plan.files.length !== files.size
      || plan.files.some((file) => !files.has(file.logicalPath))) {
      throw new BackupProtocolError('RESTORE_CONFLICT');
    }
    const importNamespace = `backup-import-${plan.snapshotId}`;
    const metadataFiles = plan.files.filter((file) => file.scope === 'note-metadata');
    const markdownFiles = plan.files.filter((file) => file.scope === 'note-markdown');
    const todoFiles = plan.files.filter((file) => file.scope === 'todos');
    if (
      metadataFiles.length !== 1
      || metadataFiles[0]?.logicalPath !== 'notes/metadata.json'
      || (selectedScopes.includes('todos') ? todoFiles.length !== 1 || todoFiles[0]?.logicalPath !== 'todos/items.json' : todoFiles.length !== 0)
      || plan.files.some((file) => !['note-markdown', 'note-metadata', 'todos'].includes(file.scope))
    ) throw new BackupProtocolError('RESTORE_CONFLICT');

    const metadata = parseArray(files.get('notes/metadata.json'));
    if (metadata.length !== markdownFiles.length) throw new BackupProtocolError('RESTORE_CONFLICT');
    const notePathMap = new Map<string, string>();
    const notes = metadata.map((value) => {
      const record = exactObject(value, NOTE_METADATA_KEYS);
      const originalLogicalPath = safeOriginalPath(record.originalLogicalPath);
      const logicalId = requireSha256(record.logicalId);
      if (logicalId !== digest(originalLogicalPath)) throw new BackupProtocolError('RESTORE_CONFLICT');
      const logicalPath = `notes/${logicalId}.md`;
      const file = markdownFiles.find((candidate) => candidate.logicalPath === logicalPath);
      const bodyBytes = files.get(logicalPath);
      if (!file || !bodyBytes || file.scope !== 'note-markdown') throw new BackupProtocolError('RESTORE_CONFLICT');
      const path = `${importNamespace}/notes/${logicalId}`;
      if (notePathMap.has(originalLogicalPath) || [...notePathMap.values()].includes(path)) throw new BackupProtocolError('RESTORE_CONFLICT');
      notePathMap.set(originalLogicalPath, path);
      const importMarker = `__backup_import__:${importNamespace}`;
      const originalPathMarker = `__backup_original_path_b64__:${Buffer.from(originalLogicalPath, 'utf8').toString('base64url')}`;
      const createdAt = requiredEpoch(record.createdAt);
      const updatedAt = requiredEpoch(record.updatedAt);
      const folder = boundedText(record.folder, 512);
      if (updatedAt < createdAt) throw new BackupProtocolError('RESTORE_CONFLICT');
      const originalMetadataMarker = `__backup_original_metadata_b64__:${Buffer.from(JSON.stringify({
        originalLogicalPath,
        folder,
        createdAt,
        updatedAt,
      }), 'utf8').toString('base64url')}`;
      const tags = stringArray(record.tags, 'tags');
      if (tags.includes('__copilot_todo__')) throw new BackupProtocolError('RESTORE_CONFLICT');
      return {
        path,
        originalLogicalPath,
        title: requiredText(record.title, 300),
        body: decodeUtf8(bodyBytes),
        type: noteType(record.type),
        status: noteStatus(record.status),
        tags: [...tags, importMarker, originalPathMarker, originalMetadataMarker],
        related: stringArray(record.related, 'related'),
        confidence: nullableFinite(record.confidence),
        agent: nullableText(record.agent, 512),
      };
    });
    if (new Set(markdownFiles.map((file) => file.logicalPath)).size !== notes.length) {
      throw new BackupProtocolError('RESTORE_CONFLICT');
    }

    const todos = selectedScopes.includes('todos')
      ? parseArray(files.get('todos/items.json')).map((value) => {
        const record = exactObject(value, TODO_KEYS);
        const originalId = todoId(record.id);
        const id = `${importNamespace}-todo-${digest(stableId(originalId))}`;
        return {
          id,
          title: requiredText(record.title, 300),
          body: typeof record.body === 'string' ? record.body : failRestore(),
          due_at_ms: nullableEpoch(record.due_at_ms),
          remind_at_ms: nullableEpoch(record.remind_at_ms),
          status: todoStatus(record.status),
          priority: todoPriority(record.priority),
          note_links: stringArray(record.note_links, 'note_links').map((link) => {
            const remapped = notePathMap.get(link);
            if (!remapped) throw new BackupProtocolError('RESTORE_CONFLICT');
            return remapped;
          }),
          reminder_fired: todoReminderFired(record.reminder_fired),
          created_at: requiredEpoch(record.created_at),
          updated_at: requiredEpoch(record.updated_at),
        };
      })
      : [];
    if (new Set(todos.map((todo) => todo.id)).size !== todos.length
      || todos.some((todo) => todo.updated_at < todo.created_at)) {
      throw new BackupProtocolError('RESTORE_CONFLICT');
    }

    const service = await this.getService();
    const conflicts: string[] = [];
    const noteConflicts = await Promise.all(notes.map((note) => service.backupImport.noteExists(note.path)));
    const todoConflicts = await Promise.all(todos.map((todo) => service.backupImport.todoExists(todo.id)));
    noteConflicts.forEach((exists, index) => { if (exists) conflicts.push(`note:${notes[index]!.path}`); });
    todoConflicts.forEach((exists, index) => { if (exists) conflicts.push(`todo:${todos[index]!.id}`); });
    return { importNamespace, notes, todos, conflicts: conflicts.sort() };
  }

  async applyRestoreImport(prepared: BackupPreparedRestoreImport): Promise<void> {
    if (prepared.conflicts.length > 0) throw new BackupProtocolError('RESTORE_CONFLICT');
    const service = await this.getService();
    const importMarker = `__backup_import__:${prepared.importNamespace}`;
    for (const note of prepared.notes) {
      await service.backupImport.createNote({ ...note, importMarker });
    }
    for (const todo of prepared.todos) {
      await service.backupImport.createTodo(todo, prepared.importNamespace);
    }
  }

  async rollbackRestoreImport(intent: BackupRestoreImportIntent): Promise<void> {
    const service = await this.getService();
    await service.backupImport.rollback({
      importNamespace: intent.importNamespace,
      notePaths: intent.notePaths,
      todoIds: intent.todoIds,
    });
  }

  private async readNotes(service: KnowledgeSourcePort): Promise<NoteDocument[]> {
    const records = [];
    for (let offset = 0; offset < 10_000; offset += 500) {
      const page = await service.notes.list({ limit: 500, offset });
      records.push(...page.items);
      if (page.items.length < 500) break;
      if (offset === 9_500) throw new BackupProtocolError('SNAPSHOT_TOO_LARGE');
    }
    const documents = await Promise.all(records.map((note) => service.notes.get(note.path)));
    if (documents.some((item) => item === null)) throw new BackupProtocolError('SCOPE_INVALID');
    return documents as NoteDocument[];
  }
}

const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const NOTE_METADATA_KEYS = [
  'agent', 'confidence', 'createdAt', 'folder', 'logicalId', 'originalLogicalPath',
  'related', 'status', 'tags', 'title', 'type', 'updatedAt',
] as const;
const TODO_KEYS = [
  'body', 'created_at', 'due_at_ms', 'id', 'note_links', 'priority',
  'remind_at_ms', 'reminder_fired', 'status', 'title', 'updated_at',
] as const;

function canonicalRestoreScopes(scopes: readonly BackupScope[]): BackupScope[] {
  if (!Array.isArray(scopes) || new Set(scopes).size !== scopes.length) failRestore();
  const actual = new Set(scopes);
  if (!actual.has('note-markdown') || !actual.has('note-metadata')
    || [...actual].some((scope) => !['note-markdown', 'note-metadata', 'todos'].includes(scope))) failRestore();
  return ['note-markdown', 'note-metadata', ...(actual.has('todos') ? ['todos' as const] : [])];
}

function parseArray(bytes: Uint8Array | undefined): unknown[] {
  if (!bytes) failRestore();
  try {
    const parsed = JSON.parse(decodeUtf8(bytes));
    if (!Array.isArray(parsed)) failRestore();
    return parsed;
  } catch (error) {
    if (error instanceof BackupProtocolError) throw error;
    return failRestore();
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return failRestore(); }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) failRestore();
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) failRestore();
  return value as Record<string, unknown>;
}

function safeOriginalPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || /[\\\u0000-\u001f\u007f]/u.test(value) || value.startsWith('/')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || value.startsWith('system/todos/')) failRestore();
  return value;
}

function requireSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return failRestore();
  return value;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return failRestore();
  return value.trim();
}

function nullableText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return failRestore();
  return value;
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return failRestore();
  return value;
}

function stringArray(value: unknown, _field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 1024 || /[\u0000-\u001f\u007f]/u.test(item))) return failRestore();
  return [...value];
}

function noteType(value: unknown): BackupPreparedRestoreImport['notes'][number]['type'] {
  if (value === null || ['article', 'note', 'meeting', 'todo', 'reference', 'idea'].includes(String(value))) return value as BackupPreparedRestoreImport['notes'][number]['type'];
  return failRestore();
}

function noteStatus(value: unknown): BackupPreparedRestoreImport['notes'][number]['status'] {
  if (value === null || ['draft', 'active', 'archived'].includes(String(value))) return value as BackupPreparedRestoreImport['notes'][number]['status'];
  return failRestore();
}

function nullableFinite(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return failRestore();
  return value;
}

function requiredEpoch(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return failRestore();
  return Number(value);
}

function nullableEpoch(value: unknown): number | null {
  return value === null ? null : requiredEpoch(value);
}

function todoId(value: unknown): string | number {
  if ((typeof value !== 'string' || value.length === 0 || value.length > 256)
    && (!Number.isSafeInteger(value) || Number(value) < 0)) return failRestore();
  return value as string | number;
}

function stableId(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function todoStatus(value: unknown): 'pending' | 'done' | 'cancelled' {
  if (value === 'pending' || value === 'done' || value === 'cancelled') return value;
  return failRestore();
}

function todoPriority(value: unknown): 'low' | 'normal' | 'high' {
  if (value === 'low' || value === 'normal' || value === 'high') return value;
  return failRestore();
}

function todoReminderFired(value: unknown): 0 | 1 {
  if (value === 0 || value === 1) return value;
  return failRestore();
}

function failRestore(): never {
  throw new BackupProtocolError('RESTORE_CONFLICT');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function revision(values: number[]): string {
  return String(values.length ? Math.max(...values) : 0);
}
