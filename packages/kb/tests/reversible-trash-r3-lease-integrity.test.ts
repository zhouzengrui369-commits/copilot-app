import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KbClient } from '../src/api/crud.js';
import { MdFileStore } from '../src/store/md-file-store.js';
import { SqliteStore } from '../src/store/sqlite-store.js';

const NOW = 1_700_000_000_000;
const TRASH_ID = '11111111-1111-4111-8111-111111111111';
const MOVE_KEY = '22222222-2222-4222-8222-222222222222';
const PURGE_KEY = '33333333-3333-4333-8333-333333333333';
const RESTORE_KEY = '44444444-4444-4444-8444-444444444444';
const FIRST_OWNER = '55555555-5555-4555-8555-555555555555';
const SECOND_OWNER = '66666666-6666-4666-8666-666666666666';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-trash-r3-red-'));
  roots.push(root);
  return root;
}

function stores(root: string) {
  return {
    sqlite: new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(root, 'notes') }),
  };
}

function move(kb: KbClient) {
  return kb.moveNoteToTrash({
    kind: 'note',
    path: 'inbox/private',
    expectedRevision: `note:${NOW}`,
    idempotencyKey: MOVE_KEY,
  });
}

describe('reversible trash r3 lease and terminal-boundary integrity', () => {
  it('revalidates content after before_move_finalize and rolls back without finalize', () => {
    const root = createRoot();
    const x = stores(root);
    const kb = new KbClient({
      ...x,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      trashFault: (point) => {
        if (point === 'before_move_finalize') {
          fs.writeFileSync(x.md.trashPathFor(TRASH_ID), 'changed-before-finalize', { mode: 0o600 });
        }
      },
    });
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    expect(() => move(kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(kb.readNote('inbox/private')?.body).toBe('changed-before-finalize');
    expect(kb.readTrash()).toEqual([]);
    kb.close();
  });

  it.each(['after_purge_intent', 'before_purge_delete'] as const)(
    'revalidates after %s and preserves changed trash bytes',
    (mutationPoint) => {
    const root = createRoot();
    const x = stores(root);
    const kb = new KbClient({
      ...x,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      trashFault: (point) => {
        if (point === mutationPoint) {
          fs.writeFileSync(x.md.trashPathFor(TRASH_ID), 'changed-before-delete', { mode: 0o600 });
        }
      },
    });
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    const moved = move(kb);
    kb.markTrashClean(moved.trashId);
    expect(() => kb.purgeTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: PURGE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_RECOVERY_REQUIRED' }));
    expect(x.md.readTrashRaw(moved.trashId).toString('utf8')).toBe('changed-before-delete');
    expect(kb.readTrash()).toEqual([expect.objectContaining({ state: 'purging' })]);
    kb.close();
    },
  );

  it('revalidates after before_restore_finalize and rolls changed active bytes back to trash', () => {
    const root = createRoot();
    const x = stores(root);
    const kb = new KbClient({
      ...x,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      trashFault: (point) => {
        if (point === 'before_restore_finalize') {
          fs.writeFileSync(x.md.pathFor('inbox/private'), 'changed-before-restore-finalize', { mode: 0o600 });
        }
      },
    });
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    const moved = kb.markTrashClean(move(kb).trashId);
    expect(() => kb.restoreTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: RESTORE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(kb.readNote('inbox/private')).toBeNull();
    expect(x.md.readTrashRaw(moved.trashId).toString('utf8')).toBe('changed-before-restore-finalize');
    expect(kb.readTrash()).toEqual([expect.objectContaining({ state: 'trashed' })]);
    kb.close();
  });

  it.each([
    ['after_intent', 1],
    ['after_rename', 2],
    ['before_move_finalize', 2],
  ] as const)('does not let a second constructor at %s delete a live prepared owner', (phase, liveVersion) => {
    const root = createRoot();
    const firstStores = stores(root);
    let secondEntries: unknown[] = [];
    let concurrentError: unknown;
    let opened = false;
    const first = new KbClient({
      ...firstStores,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      ownerId: FIRST_OWNER,
      trashFault: (point) => {
        if (point !== phase || opened) return;
        opened = true;
        const secondStores = stores(root);
        const second = new KbClient({ ...secondStores, clock: () => NOW, ownerId: SECOND_OWNER });
        secondEntries = second.readTrash();
        try {
          move(second);
        } catch (error) {
          concurrentError = error;
        }
        second.close();
      },
    });
    first.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    expect(move(first)).toMatchObject({ state: 'cleanup_pending' });
    expect(secondEntries).toEqual([expect.objectContaining({
      state: 'prepared',
      ownerId: FIRST_OWNER,
      leaseUntil: NOW + 30_000,
      journalVersion: liveVersion,
    })]);
    expect(concurrentError).toMatchObject({ code: 'TRASH_RECOVERY_REQUIRED' });
    expect(first.readTrash()).toEqual([expect.objectContaining({
      state: 'cleanup_pending',
      ownerId: FIRST_OWNER,
      journalVersion: 4,
    })]);
    expect(first.readNote('inbox/private')).toBeNull();
    expect(firstStores.md.readTrashRaw(TRASH_ID).toString('utf8')).toContain('original');
    first.close();
  });

  it('claims an expired prepared intent with CAS and preserves the active body', () => {
    const root = createRoot();
    const firstStores = stores(root);
    const first = new KbClient({
      ...firstStores,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      ownerId: FIRST_OWNER,
      trashLeaseMs: 1_000,
      trashFault: (point) => {
        if (point === 'after_intent') throw new Error('simulated crash');
      },
    });
    first.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    expect(() => move(first)).toThrow('simulated crash');
    expect(first.readTrash()).toEqual([expect.objectContaining({
      state: 'prepared', ownerId: FIRST_OWNER, leaseUntil: NOW + 1_000,
    })]);

    // Close only the native handle: graceful KbClient.close deliberately
    // releases its lease, while this fixture models process death.
    firstStores.sqlite.close();
    const secondStores = stores(root);
    const second = new KbClient({
      ...secondStores,
      clock: () => NOW + 1_001,
      ownerId: SECOND_OWNER,
      trashLeaseMs: 1_000,
    });
    expect(second.readTrash()).toEqual([]);
    expect(second.readNote('inbox/private')?.body.trimEnd()).toBe('original');
    expect(secondStores.md.activeEntryExists('inbox/private')).toBe(true);
    expect(secondStores.md.trashExists(TRASH_ID)).toBe(false);
    second.close();
  });

  it('claims an expired post-rename orphan and binds it to the durable journal', () => {
    const root = createRoot();
    const firstStores = stores(root);
    const first = new KbClient({
      ...firstStores,
      clock: () => NOW,
      uuid: () => TRASH_ID,
      ownerId: FIRST_OWNER,
      trashLeaseMs: 1_000,
      trashFault: (point) => {
        if (point === 'after_rename') throw new Error('simulated crash');
      },
    });
    first.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    expect(() => move(first)).toThrow('simulated crash');
    expect(first.readTrash()).toEqual([expect.objectContaining({ state: 'prepared' })]);
    firstStores.sqlite.close();

    const secondStores = stores(root);
    const second = new KbClient({
      ...secondStores,
      clock: () => NOW + 1_001,
      ownerId: SECOND_OWNER,
      trashLeaseMs: 1_000,
    });
    expect(second.readTrash()).toEqual([expect.objectContaining({
      state: 'cleanup_pending',
      ownerId: SECOND_OWNER,
      journalVersion: 4,
    })]);
    expect(second.readNote('inbox/private')).toBeNull();
    expect(secondStores.md.readTrashRaw(TRASH_ID).toString('utf8')).toContain('original');
    second.close();
  });
});
