import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KbClient, MdFileStore, SqliteStore } from '@copilot/kb';
import {
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../../src/main/local-knowledge-service';
import { ProductionRemoteLocalAdapter } from '../../src/main/remote/local-adapter';
import type { RemoteCommand } from '../../src/shared/remote-management';

const NOW = 1_700_000_000_000;
const NOTE_TRASH_ID = '11111111-1111-4111-8111-111111111111';
const TODO_TRASH_ID = '22222222-2222-4222-8222-222222222222';
const STARTUP_TRASH_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_MOVE_KEY = '44444444-4444-4444-8444-444444444444';
const NOTE_RESTORE_KEY = '55555555-5555-4555-8555-555555555555';
const TODO_MOVE_KEY = '66666666-6666-4666-8666-666666666666';
const TODO_PURGE_KEY = '77777777-7777-4777-8777-777777777777';
const STARTUP_MOVE_KEY = '88888888-8888-4888-8888-888888888888';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-trash-r1-'));
  roots.push(root);
  const ids = [NOTE_TRASH_ID, TODO_TRASH_ID, STARTUP_TRASH_ID];
  const kb = new KbClient({
    sqlite: new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(root, 'notes') }),
    clock: () => NOW,
    uuid: () => ids.shift() ?? STARTUP_TRASH_ID,
  });
  const kg = {
    getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
    reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 1 })),
    removeNote: vi.fn(async () => undefined),
  };
  const rag = {
    indexNote: vi.fn(async () => ({ chunksInserted: 1, errors: [] as string[] })),
    deleteNote: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ text: '', sources: [] })),
  };
  const service = new LocalKnowledgeService({
    kb,
    kg,
    rag,
    settings: { get: () => false },
    clock: () => NOW,
    uuid: () => 'todo-1',
  } as unknown as LocalKnowledgeServiceOptions);
  return { root, kb, kg, rag, service };
}

function command(input: Partial<RemoteCommand>): RemoteCommand {
  return {
    action: 'note.move_to_trash',
    initiatedBy: 'user',
    reason: 'owner requested reversible local trash',
    resource: { type: 'note', id: 'notes/private' },
    expectedRevision: `note:${NOW}`,
    idempotencyKey: NOTE_MOVE_KEY,
    input: {},
    ...input,
  } as RemoteCommand;
}

describe('reversible trash source r1 desktop integration', () => {
  it('moves and restores a note locally, with KG/RAG cleanup and no hard-delete mapping', async () => {
    const { kb, kg, rag, service } = fixture();
    await service.notes.create({ path: 'notes/private', title: 'Private', body: 'local only' });
    const hardDelete = vi.spyOn(kb, 'deleteNote');
    const adapter = new ProductionRemoteLocalAdapter(() => service);

    await expect(adapter.execute(command({}))).resolves.toMatchObject({
      code: 'EXECUTED',
      preRevision: `note:${NOW}`,
      postRevision: `trash:${NOTE_TRASH_ID}:${NOW}`,
      result: { state: 'trashed', originalPath: 'notes/private' },
    });
    await expect(service.notes.get('notes/private')).resolves.toBeNull();
    await expect(service.notes.list({ query: 'local only' })).resolves.toMatchObject({ items: [] });
    expect(kg.removeNote).toHaveBeenCalledWith('notes/private');
    expect(rag.deleteNote).toHaveBeenCalledWith('notes/private');
    expect(hardDelete).not.toHaveBeenCalled();

    await expect(service.trash.restore({
      trashId: NOTE_TRASH_ID,
      expectedRevision: `trash:${NOTE_TRASH_ID}:${NOW}`,
      idempotencyKey: NOTE_RESTORE_KEY,
    })).resolves.toMatchObject({ state: 'restored', originalPath: 'notes/private' });
    await expect(service.notes.get('notes/private')).resolves.toMatchObject({ body: 'local only\n' });
    expect(kg.reindexNote).toHaveBeenCalledOnce();
    expect(rag.indexNote).toHaveBeenCalledOnce();
    kb.close();
  });

  it('maps Todo move_to_trash but keeps purge local-owner-only', async () => {
    const { root, kb, service } = fixture();
    await service.todos.create({ title: 'Private todo' });
    const hardDelete = vi.spyOn(kb, 'deleteNote');
    const adapter = new ProductionRemoteLocalAdapter(() => service);

    const result = await adapter.execute(command({
      action: 'todo.move_to_trash',
      resource: { type: 'todo', id: 'todo-1' },
      expectedRevision: `todo:${NOW}`,
      idempotencyKey: TODO_MOVE_KEY,
    }));
    expect(result).toMatchObject({
      code: 'EXECUTED',
      postRevision: `trash:${NOTE_TRASH_ID}:${NOW}`,
      result: { kind: 'todo', state: 'trashed' },
    });
    await expect(service.todos.list()).resolves.toEqual([]);
    expect(hardDelete).not.toHaveBeenCalled();

    const trashId = (result.result as { trashId: string }).trashId;
    await expect(service.trash.purge({
      trashId,
      expectedRevision: String(result.postRevision),
      idempotencyKey: TODO_PURGE_KEY,
    })).resolves.toMatchObject({ state: 'purged', kind: 'todo' });
    expect(fs.existsSync(path.join(root, 'notes', '.trash', `${trashId}.md`))).toBe(false);
    kb.close();
  });

  it('rechecks stale revisions and finishes durable cleanup_pending work at startup', async () => {
    const { kb, kg, rag, service } = fixture();
    await service.notes.create({ path: 'notes/stale', title: 'Stale', body: 'unchanged' });
    const adapter = new ProductionRemoteLocalAdapter(() => service);
    await expect(adapter.execute(command({
      resource: { type: 'note', id: 'notes/stale' },
      expectedRevision: 'note:stale',
    }))).resolves.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(service.notes.get('notes/stale')).resolves.toMatchObject({ body: 'unchanged\n' });

    const pending = kb.moveNoteToTrash({
      path: 'notes/stale',
      kind: 'note',
      expectedRevision: `note:${NOW}`,
      idempotencyKey: STARTUP_MOVE_KEY,
    });
    expect(pending.state).toBe('cleanup_pending');
    await service.reconcileTrashStartup();
    expect(kb.readTrash(['trashed'])).toEqual([expect.objectContaining({ trashId: NOTE_TRASH_ID })]);
    expect(kg.removeNote).toHaveBeenCalledWith('notes/stale');
    expect(rag.deleteNote).toHaveBeenCalledWith('notes/stale');
    kb.close();
  });

  it('restores a real system Todo only after the same durable KG/RAG re-index as notes', async () => {
    const { kb, kg, rag, service } = fixture();
    await service.todos.create({ title: 'Restore Todo' });
    const moved = await service.todos.moveToTrash({
      id: 'todo-1',
      expectedRevision: `todo:${NOW}`,
      idempotencyKey: TODO_MOVE_KEY,
    });
    await expect(service.trash.restore({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: NOTE_RESTORE_KEY,
    })).resolves.toMatchObject({ kind: 'todo', state: 'restored' });
    await expect(service.todos.list()).resolves.toEqual([
      expect.objectContaining({ id: 'todo-1', title: 'Restore Todo' }),
    ]);
    expect(kg.reindexNote).toHaveBeenCalledOnce();
    expect(rag.indexNote).toHaveBeenCalledOnce();
    expect(kb.readTrash(['restoring'])).toEqual([]);
    kb.close();
  });

  it('keeps failed restore indexing durable and completes it on startup retry', async () => {
    const { kb, rag, service } = fixture();
    await service.notes.create({ path: 'notes/retry', title: 'Retry', body: 'durable' });
    const moved = await service.notes.moveToTrash({
      path: 'notes/retry',
      expectedRevision: `note:${NOW}`,
      idempotencyKey: NOTE_MOVE_KEY,
    });
    rag.indexNote.mockRejectedValueOnce(new Error('index unavailable'));
    await expect(service.trash.restore({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: NOTE_RESTORE_KEY,
    })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(kb.readTrash(['restoring'])).toEqual([
      expect.objectContaining({ trashId: moved.trashId, state: 'restoring' }),
    ]);
    await service.reconcileTrashStartup();
    expect(kb.readTrash(['restored'])).toEqual([
      expect.objectContaining({ trashId: moved.trashId, state: 'restored' }),
    ]);
    await expect(service.notes.get('notes/retry')).resolves.toMatchObject({ body: 'durable\n' });
    kb.close();
  });

  it('requires a parseable Todo record with the exact logical id before trashing', async () => {
    const { kb, service } = fixture();
    kb.createNote({
      path: 'system/todos/not-real',
      title: 'Forged marker',
      type: 'todo',
      tags: ['__copilot_todo__'],
      body: '{"id":"different"}',
    });
    await expect(service.todos.moveToTrash({
      id: 'not-real',
      expectedRevision: `todo:${NOW}`,
      idempotencyKey: TODO_MOVE_KEY,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(kb.readNote('system/todos/not-real')).not.toBeNull();
    expect(kb.readTrash()).toEqual([]);
    kb.close();
  });
});
