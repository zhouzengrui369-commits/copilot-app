import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KbClient } from '../src/api/crud.js';
import { MdFileStore } from '../src/store/md-file-store.js';
import { SqliteStore } from '../src/store/sqlite-store.js';

const NOW = 1_700_000_000_000;
const TRASH_ID = '11111111-1111-4111-8111-111111111111';
const MOVE_KEY = '22222222-2222-4222-8222-222222222222';
const RESTORE_KEY = '33333333-3333-4333-8333-333333333333';
const PURGE_KEY = '44444444-4444-4444-8444-444444444444';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options: { faultAt?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-trash-r1-'));
  roots.push(root);
  const sqlite = new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') });
  const md = new MdFileStore({ rootDir: path.join(root, 'notes') });
  const kb = new KbClient({
    sqlite,
    md,
    clock: () => NOW,
    uuid: () => TRASH_ID,
    trashFault: (point) => {
      if (point === options.faultAt) throw new Error(`CRASH_AT_${point}`);
    },
  });
  return { root, sqlite, md, kb };
}

function move(kb: KbClient, pathValue = 'inbox/private') {
  return kb.moveNoteToTrash({
    kind: 'note',
    path: pathValue,
    expectedRevision: `note:${NOW}`,
    idempotencyKey: MOVE_KEY,
  });
}

describe('KB schema v1 reversible trash', () => {
  it('migrates v0, moves a note with intent/rename/finalize, hides it, and restores it exactly', () => {
    const { root, sqlite, kb } = fixture();
    expect(sqlite.schemaVersion).toBe(2);
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'local body', tags: ['local'] });
    kb.createNote({ path: 'links/source', title: 'Source', body: 'source' });
    kb.addLink({ from_path: 'links/source', to_path: 'inbox/private', rel: 'mentions' });

    const trashed = move(kb);
    expect(trashed).toMatchObject({
      trashId: TRASH_ID,
      kind: 'note',
      originalPath: 'inbox/private',
      originalRevision: `note:${NOW}`,
      trashRevision: `trash:${TRASH_ID}:${NOW}`,
      state: 'cleanup_pending',
      idempotencyKey: MOVE_KEY,
    });
    expect(kb.readNote('inbox/private')).toBeNull();
    expect(kb.listNotes({ query: 'local body' }).items).toEqual([]);
    expect(fs.existsSync(path.join(root, 'notes', 'inbox', 'private.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes', '.trash', `${TRASH_ID}.md`))).toBe(true);
    expect(trashed.metadataJson).not.toContain(root);
    expect(trashed.metadataJson).not.toContain('local body');
    expect(trashed.contentSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(move(kb)).toMatchObject({ trashId: TRASH_ID, state: 'cleanup_pending' });
    expect(() => kb.moveNoteToTrash({
      kind: 'note', path: 'other/path', expectedRevision: `note:${NOW}`, idempotencyKey: MOVE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_IDEMPOTENCY_CONFLICT' }));

    expect(kb.markTrashClean(TRASH_ID)).toMatchObject({ state: 'trashed' });
    const restorePending = kb.restoreTrash({
      trashId: TRASH_ID,
      expectedRevision: `trash:${TRASH_ID}:${NOW}`,
      idempotencyKey: RESTORE_KEY,
    });
    expect(restorePending).toMatchObject({ state: 'restoring', restoreIdempotencyKey: RESTORE_KEY });
    expect(kb.readNote('inbox/private')).toMatchObject({ body: 'local body\n' });
    // Journal metadata is never trusted to recreate links. Production KG/RAG
    // re-index owns relationship reconstruction before completion is marked.
    expect(kb.listLinks('inbox/private').in).toEqual([]);
    expect(kb.markTrashRestored(TRASH_ID)).toMatchObject({ state: 'restored' });
    expect(kb.restoreTrash({
      trashId: TRASH_ID,
      expectedRevision: `trash:${TRASH_ID}:${NOW}`,
      idempotencyKey: RESTORE_KEY,
    })).toMatchObject({ state: 'restored' });
    kb.close();
  });

  it('purges only a trashed file and leaves a content-free idempotent tombstone', () => {
    const { root, kb } = fixture();
    kb.createNote({ path: 'inbox/purge', title: 'Purge me', body: 'sensitive body' });
    const moved = kb.moveNoteToTrash({
      kind: 'note', path: 'inbox/purge', expectedRevision: `note:${NOW}`, idempotencyKey: MOVE_KEY,
    });
    kb.markTrashClean(moved.trashId);
    const purged = kb.purgeTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: PURGE_KEY,
    });
    expect(purged).toMatchObject({ state: 'purged', metadataJson: '{}', purgeIdempotencyKey: PURGE_KEY });
    expect(fs.existsSync(path.join(root, 'notes', '.trash', `${TRASH_ID}.md`))).toBe(false);
    expect(kb.purgeTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: PURGE_KEY,
    })).toMatchObject({ state: 'purged' });
    kb.close();
  });

  it('fails closed on stale revisions, restore collisions, symlinks and nonregular files', () => {
    const first = fixture();
    first.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    expect(() => first.kb.moveNoteToTrash({
      kind: 'note', path: 'inbox/private', expectedRevision: 'note:stale', idempotencyKey: MOVE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_REVISION_CONFLICT' }));

    const external = path.join(first.root, 'external.md');
    fs.writeFileSync(external, 'external unchanged');
    const active = path.join(first.root, 'notes', 'inbox', 'private.md');
    fs.unlinkSync(active);
    fs.symlinkSync(external, active);
    expect(() => move(first.kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(fs.readFileSync(external, 'utf8')).toBe('external unchanged');
    expect(first.kb.readTrash()).toEqual([]);
    first.kb.close();

    const hardlink = fixture();
    hardlink.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    const externalHardlink = path.join(hardlink.root, 'external-hardlink.md');
    fs.writeFileSync(externalHardlink, 'hardlink external unchanged');
    const hardlinkActive = path.join(hardlink.root, 'notes', 'inbox', 'private.md');
    fs.unlinkSync(hardlinkActive);
    fs.linkSync(externalHardlink, hardlinkActive);
    expect(() => move(hardlink.kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(fs.readFileSync(externalHardlink, 'utf8')).toBe('hardlink external unchanged');
    expect(hardlink.kb.readTrash()).toEqual([]);
    hardlink.kb.close();

    const nonregular = fixture();
    nonregular.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    const nonregularActive = path.join(nonregular.root, 'notes', 'inbox', 'private.md');
    fs.unlinkSync(nonregularActive);
    fs.mkdirSync(nonregularActive);
    expect(() => move(nonregular.kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(nonregular.kb.readTrash()).toEqual([]);
    nonregular.kb.close();

    const second = fixture();
    second.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'body' });
    const moved = move(second.kb);
    second.kb.markTrashClean(moved.trashId);
    second.kb.createNote({ path: 'inbox/private', title: 'Collision', body: 'new truth' });
    expect(() => second.kb.restoreTrash({
      trashId: moved.trashId, expectedRevision: moved.trashRevision, idempotencyKey: RESTORE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_RESTORE_CONFLICT' }));
    expect(second.kb.readNote('inbox/private')?.body).toBe('new truth\n');
    second.kb.close();
  });

  it.each(['after_intent', 'after_rename', 'after_finalize'])(
    'reconciles a simulated crash at %s without data loss or duplicate execution',
    (faultAt) => {
      const first = fixture({ faultAt });
      first.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'recoverable' });
      expect(() => move(first.kb)).toThrow(`CRASH_AT_${faultAt}`);
      first.kb.close();

      const reopened = new KbClient({
        sqlite: new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') }),
        md: new MdFileStore({ rootDir: path.join(first.root, 'notes') }),
        clock: () => NOW + 60_000,
        uuid: () => TRASH_ID,
      });
      const entry = reopened.readTrash().find((item) => item.trashId === TRASH_ID);
      if (faultAt === 'after_intent') {
        expect(entry).toBeUndefined();
        expect(reopened.readNote('inbox/private')?.body).toBe('recoverable\n');
      } else {
        expect(entry).toMatchObject({ state: 'cleanup_pending' });
        expect(reopened.readNote('inbox/private')).toBeNull();
        expect(reopened.moveNoteToTrash({
          kind: 'note', path: 'inbox/private', expectedRevision: `note:${NOW}`, idempotencyKey: MOVE_KEY,
        })).toMatchObject({ trashId: TRASH_ID, state: 'cleanup_pending' });
      }
      reopened.close();
    },
  );

  it('stores content and input digests deterministically without an absolute path', () => {
    const { root, kb } = fixture();
    kb.createNote({
      path: 'system/todos/todo-1',
      title: 'Todo',
      type: 'todo',
      tags: ['__copilot_todo__'],
      body: '{"local":true}',
    });
    const entry = kb.moveNoteToTrash({
      kind: 'todo',
      path: 'system/todos/todo-1',
      expectedRevision: `todo:${NOW}`,
      idempotencyKey: MOVE_KEY,
    });
    expect(entry.kind).toBe('todo');
    const metadataSha256 = createHash('sha256').update(entry.metadataJson).digest('hex');
    expect(entry.inputSha256).toBe(createHash('sha256').update(JSON.stringify({
      expectedRevision: `todo:${NOW}`,
      idempotencyKey: MOVE_KEY,
      kind: 'todo',
      metadataSha256,
      path: 'system/todos/todo-1',
    })).digest('hex'));
    expect(JSON.stringify(entry)).not.toContain(root);
    kb.close();
  });
});
