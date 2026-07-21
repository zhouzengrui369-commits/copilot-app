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
const RESTORE_KEY = '33333333-3333-4333-8333-333333333333';
const PURGE_KEY = '44444444-4444-4444-8444-444444444444';
const OTHER_KEY = '55555555-5555-4555-8555-555555555555';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(fault?: (point: string, md: MdFileStore) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-trash-r2-red-'));
  roots.push(root);
  const sqlite = new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') });
  const md = new MdFileStore({ rootDir: path.join(root, 'notes') });
  const kb = new KbClient({
    sqlite,
    md,
    clock: () => NOW,
    uuid: () => TRASH_ID,
    trashFault: (point) => fault?.(point, md),
  });
  return { root, sqlite, md, kb };
}

function move(kb: KbClient, kind: 'note' | 'todo' = 'note', notePath = 'inbox/private') {
  return kb.moveNoteToTrash({
    kind,
    path: notePath,
    expectedRevision: `${kind}:${NOW}`,
    idempotencyKey: MOVE_KEY,
  });
}

describe('reversible trash r2 integrity', () => {
  it('rolls the actual latest bytes back when content changes after intent', () => {
    const { kb } = fixture((point, md) => {
      if (point === 'after_intent') {
        fs.writeFileSync(md.pathFor('inbox/private'), 'latest-after-intent', { mode: 0o600 });
      }
    });
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });

    expect(() => move(kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(kb.readNote('inbox/private')?.body).toBe('latest-after-intent');
    expect(kb.readTrash()).toEqual([]);
    kb.close();
  });

  it('rolls the actual latest bytes back when trash content changes after rename', () => {
    const { kb } = fixture((point, md) => {
      if (point === 'after_rename') {
        fs.writeFileSync(md.trashPathFor(TRASH_ID), 'latest-after-rename', { mode: 0o600 });
      }
    });
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });

    expect(() => move(kb)).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(kb.readNote('inbox/private')?.body).toBe('latest-after-rename');
    expect(kb.readTrash()).toEqual([]);
    kb.close();
  });

  it('rejects non-canonical or injected metadata without writing unrelated links', () => {
    const { sqlite, kb } = fixture();
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'body' });
    kb.createNote({ path: 'victim/from', title: 'From', body: 'from' });
    kb.createNote({ path: 'victim/to', title: 'To', body: 'to' });
    const moved = move(kb);
    kb.markTrashClean(moved.trashId);
    const metadata = JSON.parse(moved.metadataJson) as Record<string, unknown>;
    metadata.absolutePath = '/private/forbidden';
    metadata.note_links = [{ from_path: 'victim/from', to_path: 'victim/to', rel: 'injected' }];
    metadata.links = {
      out: [{ from_path: 'victim/from', to_path: 'victim/to', rel: 'injected' }],
      in: [],
    };
    sqlite.raw.prepare(`UPDATE trash_entries SET metadata_json = ? WHERE trash_id = ?`)
      .run(JSON.stringify(metadata), moved.trashId);

    expect(() => kb.restoreTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: RESTORE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_RECOVERY_REQUIRED' }));
    expect(kb.listLinks('victim/from').out).toEqual([]);
    expect(kb.readNote('inbox/private')).toBeNull();
    kb.close();
  });

  it('does not upgrade an ordinary system-path note into a Todo from caller input', () => {
    const { kb } = fixture();
    kb.createNote({
      path: 'system/todos/not-a-todo',
      title: 'Ordinary note',
      type: 'note',
      tags: [],
      body: 'ordinary',
    });
    expect(() => move(kb, 'todo', 'system/todos/not-a-todo'))
      .toThrowError(expect.objectContaining({ code: 'TRASH_INVALID_ARGUMENT' }));
    expect(kb.readNote('system/todos/not-a-todo')?.body).toBe('ordinary\n');
    kb.close();
  });

  it('normalizes an existing private trash directory to 0700 on POSIX', () => {
    if (process.platform === 'win32') return;
    const { root, md, kb } = fixture();
    const trashRoot = path.join(root, 'notes', '.trash');
    fs.mkdirSync(trashRoot, { mode: 0o777 });
    fs.chmodSync(trashRoot, 0o777);
    md.trashPathFor(TRASH_ID);
    expect(fs.statSync(trashRoot).mode & 0o777).toBe(0o700);
    kb.close();
  });

  it.each([
    ['absolute logical path', (metadata: any) => { metadata.note.path = '/private/forbidden'; }],
    ['control character', (metadata: any) => { metadata.note.title = 'bad\u0000title'; }],
    ['canonical value tamper', (metadata: any) => { metadata.note.title = 'Tampered'; }],
  ])('rejects %s metadata tamper before restore', (_label, mutate) => {
    const { sqlite, kb } = fixture();
    kb.createNote({ path: 'inbox/private', title: 'Private', body: 'body' });
    const moved = move(kb);
    kb.markTrashClean(moved.trashId);
    const metadata = JSON.parse(moved.metadataJson);
    mutate(metadata);
    sqlite.raw.prepare(`UPDATE trash_entries SET metadata_json = ? WHERE trash_id = ?`)
      .run(canonicalJson(metadata), moved.trashId);
    expect(() => kb.restoreTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: RESTORE_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_RECOVERY_REQUIRED' }));
    expect(kb.readNote('inbox/private')).toBeNull();
    kb.close();
  });

  it('rejects an existing trash-root symlink without touching its target', () => {
    const { root, md, kb } = fixture();
    const target = path.join(root, 'outside');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'canary'), 'unchanged');
    fs.symlinkSync(target, path.join(root, 'notes', '.trash'));
    expect(() => md.trashPathFor(TRASH_ID))
      .toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
    expect(fs.readFileSync(path.join(target, 'canary'), 'utf8')).toBe('unchanged');
    kb.close();
  });

  it('does not treat a concurrently observed prepared duplicate as completed', () => {
    let subject: KbClient;
    let duplicateCode = '';
    let attempted = false;
    const x = fixture((point) => {
      if (point !== 'after_intent' || attempted) return;
      attempted = true;
      try {
        move(subject);
      } catch (error) {
        duplicateCode = String((error as { code?: string }).code ?? '');
      }
    });
    subject = x.kb;
    subject.createNote({ path: 'inbox/private', title: 'Private', body: 'body' });
    expect(move(subject)).toMatchObject({ state: 'cleanup_pending' });
    expect(duplicateCode).toBe('TRASH_RECOVERY_REQUIRED');
    expect(subject.readTrash()).toHaveLength(1);
    subject.close();
  });

  it.each([
    'after_restore_intent',
    'before_restore_rename',
    'after_restore_rename',
    'before_restore_finalize',
    'after_restore_finalize',
  ])('reconciles restore crash at %s and keeps indexing completion durable', (faultAt) => {
    const first = fixture();
    first.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'restore me' });
    const moved = move(first.kb);
    first.kb.markTrashClean(moved.trashId);
    first.kb.close();

    const crashing = new KbClient({
      sqlite: new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') }),
      md: new MdFileStore({ rootDir: path.join(first.root, 'notes') }),
      clock: () => NOW,
      uuid: () => TRASH_ID,
      trashFault: (point) => {
        if (point === faultAt) throw new Error(`CRASH_${point}`);
      },
    });
    expect(() => crashing.restoreTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: RESTORE_KEY,
    })).toThrow();
    crashing.close();

    const reopened = new KbClient({
      sqlite: new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') }),
      md: new MdFileStore({ rootDir: path.join(first.root, 'notes') }),
      clock: () => NOW + 60_000,
      uuid: () => TRASH_ID,
    });
    let entry = reopened.readTrash()[0]!;
    if (entry.state === 'trashed') {
      entry = reopened.restoreTrash({
        trashId: moved.trashId,
        expectedRevision: moved.trashRevision,
        idempotencyKey: RESTORE_KEY,
      });
    }
    expect(entry.state).toBe('restoring');
    expect(reopened.readNote('inbox/private')?.body).toBe('restore me\n');
    expect(reopened.markTrashRestored(moved.trashId)).toMatchObject({ state: 'restored' });
    reopened.close();
  });

  it.each([
    'after_purge_intent',
    'before_purge_delete',
    'after_purge_delete',
    'before_purge_finalize',
    'after_purge_finalize',
  ])('reconciles purge crash at %s into a non-revivable tombstone', (faultAt) => {
    const first = fixture();
    first.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'purge me' });
    const moved = move(first.kb);
    first.kb.markTrashClean(moved.trashId);
    first.kb.close();

    const crashing = new KbClient({
      sqlite: new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') }),
      md: new MdFileStore({ rootDir: path.join(first.root, 'notes') }),
      clock: () => NOW,
      uuid: () => TRASH_ID,
      trashFault: (point) => {
        if (point === faultAt) throw new Error(`CRASH_${point}`);
      },
    });
    expect(() => crashing.purgeTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: PURGE_KEY,
    })).toThrow();
    crashing.close();

    const reopened = new KbClient({
      sqlite: new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') }),
      md: new MdFileStore({ rootDir: path.join(first.root, 'notes') }),
      clock: () => NOW + 60_000,
      uuid: () => TRASH_ID,
    });
    const tombstone = reopened.readTrash()[0]!;
    expect(tombstone).toMatchObject({ state: 'purged', metadataJson: '{}' });
    expect(() => reopened.restoreTrash({
      trashId: moved.trashId,
      expectedRevision: moved.trashRevision,
      idempotencyKey: OTHER_KEY,
    })).toThrowError(expect.objectContaining({ code: 'TRASH_RECOVERY_REQUIRED' }));
    reopened.close();
  });

  it('quarantines a tampered trashed body on restart without deleting its bytes', () => {
    const first = fixture();
    first.kb.createNote({ path: 'inbox/private', title: 'Private', body: 'original' });
    const moved = move(first.kb);
    first.kb.markTrashClean(moved.trashId);
    fs.writeFileSync(first.md.trashPathFor(moved.trashId), 'tampered-but-preserved', { mode: 0o600 });
    first.kb.close();

    const sqlite = new SqliteStore({ dbPath: path.join(first.root, 'kb.sqlite') });
    const md = new MdFileStore({ rootDir: path.join(first.root, 'notes') });
    expect(() => new KbClient({ sqlite, md, clock: () => NOW + 60_000 }))
      .toThrowError(expect.objectContaining({ code: 'TRASH_RECOVERY_REQUIRED' }));
    expect(md.readTrashRaw(moved.trashId).toString('utf8')).toBe('tampered-but-preserved');
    sqlite.close();
  });
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
