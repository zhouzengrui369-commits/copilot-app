// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KbClient } from '../../../../packages/kb/src/api/crud.js';
import { MdFileStore } from '../../../../packages/kb/src/store/md-file-store.js';
import { SqliteStore } from '../../../../packages/kb/src/store/sqlite-store.js';
import { registerDomainIpc } from '../../src/main/domain-ipc.js';
import {
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../../src/main/local-knowledge-service.js';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js';

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;
const roots: string[] = [];
const NOW = 1_725_000_000_000;
const NOTE_TRASH_ID = '11111111-1111-4111-8111-111111111111';
const TODO_TRASH_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_OWNER_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_OWNER_ID = '44444444-4444-4444-8444-444444444444';

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-trash-ui-r1-'));
  roots.push(root);
  const kb = new KbClient({
    sqlite: new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(root, 'notes') }),
  });
  const hardDelete = vi.spyOn(kb, 'deleteNote');
  const service = new LocalKnowledgeService({
    kb,
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 0 })),
      removeNote: vi.fn(async () => undefined),
    },
    rag: {
      indexNote: vi.fn(async () => ({ chunksInserted: 1, errors: [] })),
      deleteNote: vi.fn(async () => undefined),
      ask: vi.fn(async () => ({ text: '', sources: [] })),
    },
    settings: { get: () => false },
  } as unknown as LocalKnowledgeServiceOptions);
  const handlers = new Map<string, Handler>();
  registerDomainIpc({ handle: (channel, listener) => handlers.set(channel, listener as Handler) }, () => service);
  return { handlers, service, hardDelete };
}

describe('renderer-reachable reversible Trash main boundary', () => {
  it('keeps legacy note/Todo removal boolean-compatible while never hard-deleting', async () => {
    const { handlers, service, hardDelete } = harness();
    await handlers.get(IPC_CHANNELS.NOTES_CREATE)!({}, {
      path: 'inbox/private-plan', title: 'Private plan', body: 'never expose this body',
    });
    await expect(handlers.get(IPC_CHANNELS.NOTES_REMOVE)!({}, 'inbox/private-plan')).resolves.toBe(true);
    await expect(handlers.get(IPC_CHANNELS.NOTES_GET)!({}, 'inbox/private-plan')).resolves.toBeNull();

    const todo = await handlers.get(IPC_CHANNELS.TODOS_CREATE)!({}, { title: 'Private Todo' }) as { id: string | number };
    await expect(handlers.get(IPC_CHANNELS.TODOS_REMOVE)!({}, todo.id)).resolves.toBe(true);
    expect(hardDelete).not.toHaveBeenCalled();

    const items = await handlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.kind).sort()).toEqual(['note', 'todo']);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'kind', 'movedAt', 'recoveryRequired', 'revision', 'state', 'title', 'trashId',
      ]);
    }
    expect(JSON.stringify(items)).not.toMatch(/inbox\/private-plan|originalPath|owner|lease|metadata|never expose/iu);
    await service.close();
  });

  it('validates exact IPC schemas and fails restore collision/purge eligibility closed', async () => {
    const { handlers, service } = harness();
    await handlers.get(IPC_CHANNELS.NOTES_CREATE)!({}, {
      path: 'inbox/collision', title: 'Collision source', body: 'source',
    });
    const moved = await handlers.get(IPC_CHANNELS.TRASH_MOVE_NOTE)!({}, { path: 'inbox/collision' }) as {
      trashId: string; revision: string;
    };

    await expect(handlers.get(IPC_CHANNELS.TRASH_MOVE_NOTE)!({}, { path: '../escape', ownerId: 'forged' }))
      .rejects.toThrow('[INVALID_ARGUMENT]');
    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
      trashId: moved.trashId, revision: moved.revision, ownerId: 'forged',
    })).rejects.toThrow('[INVALID_ARGUMENT]');
    await expect(handlers.get(IPC_CHANNELS.TRASH_PURGE)!({}, {
      trashId: moved.trashId, revision: moved.revision, confirmed: false,
    })).rejects.toThrow('explicit purge confirmation is required');

    await handlers.get(IPC_CHANNELS.NOTES_CREATE)!({}, {
      path: 'inbox/collision', title: 'New active note', body: 'new active body',
    });
    await expect(handlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, moved))
      .rejects.toThrow('restore destination already exists');
    await expect(handlers.get(IPC_CHANNELS.TRASH_PURGE)!({}, { ...moved, confirmed: true }))
      .resolves.toMatchObject({ state: 'purged', recoveryRequired: false });
    await service.close();
  });

  it('projects a synthetic recovery row to the exact renderer-safe schema', async () => {
    const handlers = new Map<string, Handler>();
    const service = {
      trash: {
        list: vi.fn(async () => [{
          trashId: '11111111-1111-4111-8111-111111111111',
          kind: 'note',
          originalPath: 'private/recovery/path',
          originalRevision: 'note:1',
          trashRevision: 'trash:11111111-1111-4111-8111-111111111111:2',
          state: 'cleanup_pending',
          movedAt: 2,
          restoredAt: null,
          purgedAt: null,
          cleanupAttempts: 1,
          title: 'Recovering note',
        }]),
      },
    } as unknown as LocalKnowledgeService;
    registerDomainIpc({ handle: (channel, listener) => handlers.set(channel, listener as Handler) }, () => service);
    const result = await handlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined);
    expect(result).toEqual([expect.objectContaining({
      title: 'Recovering note', state: 'cleanup_pending', recoveryRequired: true,
    })]);
    expect(JSON.stringify(result)).not.toMatch(/private\/recovery|originalPath|owner|lease|cleanupAttempts/iu);
  });

  it('closes and reopens real Desktop storage, reconciles note/Todo partial moves, and restores without data loss', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-trash-ui-r2-restart-'));
    roots.push(root);
    const dbPath = path.join(root, 'kb.sqlite');
    const notesRoot = path.join(root, 'notes');
    const trashIds = [NOTE_TRASH_ID, TODO_TRASH_ID];
    let crashesRemaining = 2;
    const firstKb = new KbClient({
      sqlite: new SqliteStore({ dbPath }),
      md: new MdFileStore({ rootDir: notesRoot }),
      clock: () => NOW,
      uuid: () => trashIds.shift() ?? TODO_TRASH_ID,
      ownerId: FIRST_OWNER_ID,
      trashLeaseMs: 1_000,
      trashFault: (point) => {
        if (point === 'after_rename' && crashesRemaining > 0) {
          crashesRemaining -= 1;
          throw new Error('simulated desktop close after durable rename');
        }
      },
    });
    const firstHardDelete = vi.spyOn(firstKb, 'deleteNote');
    const firstService = new LocalKnowledgeService({
      kb: firstKb,
      kg: {
        getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
        reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 0 })),
        removeNote: vi.fn(async () => undefined),
      },
      rag: {
        indexNote: vi.fn(async () => ({ chunksInserted: 1, errors: [] })),
        deleteNote: vi.fn(async () => undefined),
        ask: vi.fn(async () => ({ text: '', sources: [] })),
      },
      settings: { get: () => false },
      clock: () => NOW,
      uuid: () => 'restart-todo-id',
    } as unknown as LocalKnowledgeServiceOptions);
    const firstHandlers = new Map<string, Handler>();
    registerDomainIpc(
      { handle: (channel, listener) => firstHandlers.set(channel, listener as Handler) },
      () => firstService,
    );

    await firstHandlers.get(IPC_CHANNELS.NOTES_CREATE)!({}, {
      path: 'inbox/restart-note',
      title: 'Restart note',
      body: 'note body survives restart',
    });
    const todo = await firstHandlers.get(IPC_CHANNELS.TODOS_CREATE)!({}, {
      title: 'Restart Todo',
    }) as { id: string | number };

    await expect(firstHandlers.get(IPC_CHANNELS.TRASH_MOVE_NOTE)!({}, {
      path: 'inbox/restart-note',
    })).rejects.toThrow('[INTERNAL]');
    await expect(firstHandlers.get(IPC_CHANNELS.TRASH_MOVE_TODO)!({}, {
      id: todo.id,
    })).rejects.toThrow('[INTERNAL]');
    const prepared = firstKb.readTrash();
    expect(prepared).toHaveLength(2);
    expect(prepared).toEqual(expect.arrayContaining([
      expect.objectContaining({ trashId: NOTE_TRASH_ID, kind: 'note', state: 'prepared' }),
      expect.objectContaining({ trashId: TODO_TRASH_ID, kind: 'todo', state: 'prepared' }),
    ]));
    expect(firstHardDelete).not.toHaveBeenCalled();

    // A real Desktop close expires this owner's leases and closes SQLite.
    await firstService.close();

    const reopenedMd = new MdFileStore({ rootDir: notesRoot });
    const reopenedKb = new KbClient({
      sqlite: new SqliteStore({ dbPath }),
      md: reopenedMd,
      clock: () => NOW + 1,
      ownerId: SECOND_OWNER_ID,
      trashLeaseMs: 1_000,
    });
    const reopenedHardDelete = vi.spyOn(reopenedKb, 'deleteNote');
    const reopenedKg = {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 0 })),
      removeNote: vi.fn(async () => undefined),
    };
    const reopenedRag = {
      indexNote: vi.fn(async () => ({ chunksInserted: 1, errors: [] as string[] })),
      deleteNote: vi.fn(async () => undefined),
      ask: vi.fn(async () => ({ text: '', sources: [] as string[] })),
    };
    const reopenedService = new LocalKnowledgeService({
      kb: reopenedKb,
      kg: reopenedKg,
      rag: reopenedRag,
      settings: { get: () => false },
      clock: () => NOW + 1,
    } as unknown as LocalKnowledgeServiceOptions);
    const reopenedHandlers = new Map<string, Handler>();
    registerDomainIpc(
      { handle: (channel, listener) => reopenedHandlers.set(channel, listener as Handler) },
      () => reopenedService,
    );

    try {
      // KbClient constructor performed the real durable prepared -> cleanup_pending
      // reconciliation. Desktop startup cleanup has intentionally not run yet.
      const reconciled = reopenedKb.readTrash();
      expect(reconciled).toHaveLength(2);
      expect(reconciled).toEqual(expect.arrayContaining([
        expect.objectContaining({ trashId: NOTE_TRASH_ID, kind: 'note', state: 'cleanup_pending' }),
        expect.objectContaining({ trashId: TODO_TRASH_ID, kind: 'todo', state: 'cleanup_pending' }),
      ]));
      expect(reopenedMd.readTrashRaw(NOTE_TRASH_ID).toString('utf8')).toContain('note body survives restart');
      expect(reopenedMd.readTrashRaw(TODO_TRASH_ID).toString('utf8')).toContain('Restart Todo');

      const pending = await reopenedHandlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined) as Array<Record<string, unknown>>;
      expect(pending).toHaveLength(2);
      for (const item of pending) {
        expect(Object.keys(item).sort()).toEqual([
          'kind', 'movedAt', 'recoveryRequired', 'revision', 'state', 'title', 'trashId',
        ]);
        expect(item).toMatchObject({ state: 'cleanup_pending', recoveryRequired: true });
        await expect(reopenedHandlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
          trashId: item.trashId,
          revision: item.revision,
        })).rejects.toThrow('not eligible while recovery is pending');
        await expect(reopenedHandlers.get(IPC_CHANNELS.TRASH_PURGE)!({}, {
          trashId: item.trashId,
          revision: item.revision,
          confirmed: true,
        })).rejects.toThrow('not eligible while recovery is pending');
      }
      const pendingJson = JSON.stringify(pending);
      expect(pendingJson).not.toMatch(
        /inbox\/restart-note|system\/todos|note body survives|originalPath|owner|lease|metadata|journal|cleanupAttempts/iu,
      );

      await reopenedService.reconcileTrashStartup();
      const eligible = await reopenedHandlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined) as Array<Record<string, unknown>>;
      expect(eligible).toHaveLength(2);
      expect(eligible.map((item) => item.kind).sort()).toEqual(['note', 'todo']);
      for (const item of eligible) {
        expect(Object.keys(item).sort()).toEqual([
          'kind', 'movedAt', 'recoveryRequired', 'revision', 'state', 'title', 'trashId',
        ]);
        expect(item).toMatchObject({ state: 'trashed', recoveryRequired: false });
        await expect(reopenedHandlers.get(IPC_CHANNELS.TRASH_RESTORE)!({}, {
          trashId: item.trashId,
          revision: item.revision,
        })).resolves.toMatchObject({ kind: item.kind, state: 'restored', recoveryRequired: false });
      }

      await expect(reopenedHandlers.get(IPC_CHANNELS.NOTES_GET)!({}, 'inbox/restart-note'))
        .resolves.toMatchObject({ body: 'note body survives restart\n' });
      await expect(reopenedHandlers.get(IPC_CHANNELS.TODOS_LIST)!({}, undefined))
        .resolves.toEqual([expect.objectContaining({ id: todo.id, title: 'Restart Todo' })]);
      await expect(reopenedHandlers.get(IPC_CHANNELS.TRASH_LIST)!({}, undefined)).resolves.toEqual([]);
      expect(reopenedHardDelete).not.toHaveBeenCalled();
      expect(reopenedKg.removeNote).toHaveBeenCalledTimes(2);
      expect(reopenedRag.deleteNote).toHaveBeenCalledTimes(2);
      expect(reopenedKg.reindexNote).toHaveBeenCalledTimes(2);
      expect(reopenedRag.indexNote).toHaveBeenCalledTimes(2);
    } finally {
      await reopenedService.close();
    }
  });
});
