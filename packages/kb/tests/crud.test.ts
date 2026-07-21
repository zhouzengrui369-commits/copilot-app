import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbClient } from '../src/api/crud.js';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { MdFileStore } from '../src/store/md-file-store.js';

function setup(): {
  kb: KbClient;
  cleanup: () => void;
  rootDir: string;
  dbPath: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-crud-'));
  const dbPath = path.join(dir, 'kb.sqlite');
  const rootDir = path.join(dir, 'notes');
  const sqlite = new SqliteStore({ dbPath });
  const md = new MdFileStore({ rootDir });
  const kb = new KbClient({ sqlite, md });
  return {
    kb,
    cleanup: () => {
      kb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    rootDir,
    dbPath,
  };
}

describe('KbClient CRUD', () => {
  let kb: KbClient;
  let cleanup: () => void;

  beforeEach(() => {
    ({ kb, cleanup } = setup());
  });
  afterEach(() => cleanup());

  it('creates a note in both stores', () => {
    const note = kb.createNote({
      path: 'inbox/hello',
      title: 'Hello',
      tags: ['greeting'],
      body: '# Hi\n',
    });
    expect(note.path).toBe('inbox/hello');
    expect(note.id).toBeGreaterThan(0);
    const onDisk = path.join(kb['md'].rootDir, 'inbox/hello.md');
    expect(fs.existsSync(onDisk)).toBe(true);
  });

  it('rejects duplicate path', () => {
    kb.createNote({ path: 'a/b', title: 'A', body: '' });
    expect(() =>
      kb.createNote({ path: 'a/b', title: 'A2', body: '' }),
    ).toThrow(/already exists/);
  });

  it('rejects bad compound path (backslash)', () => {
    expect(() =>
      kb.createNote({ path: 'a\\b', title: 'A', body: '' }),
    ).toThrow();
  });

  it('reads body + metadata', () => {
    kb.createNote({
      path: 'r/x',
      title: 'X',
      body: 'body content',
      tags: ['t1'],
    });
    const r = kb.readNote('r/x');
    expect(r?.body?.trim()).toBe('body content');
    expect(r?.note.title).toBe('X');
  });

  it('updates body + tags', () => {
    kb.createNote({ path: 'u/x', title: 'X', body: 'old', tags: [] });
    const updated = kb.updateNote('u/x', { body: 'new', tags: ['t'] });
    expect(updated?.tags).toEqual(['t']);
    expect(kb.readNote('u/x')?.body?.trim()).toBe('new');
  });

  it('returns null when updating a missing note', () => {
    expect(kb.updateNote('missing/x', { body: 'noop' })).toBeNull();
  });

  it('deletes a note from both stores', () => {
    kb.createNote({ path: 'd/x', title: 'X', body: 'x' });
    expect(kb.deleteNote('d/x')).toBe(true);
    expect(kb.readNote('d/x')).toBeNull();
    expect(fs.existsSync(path.join(kb['md'].rootDir, 'd/x.md'))).toBe(false);
  });

  it('rolls back md file when sqlite insert fails', () => {
    const real = kb.createNote.bind(kb);
    // Force a sqlite failure by inserting a row directly then asking for duplicate.
    real({ path: 'rb/seed', title: 'seed', body: '' });
    expect(() =>
      kb.createNote({ path: 'rb/seed', title: 'dup', body: '' }),
    ).toThrow();
    // The second attempt should not have left an md file orphan.
    const onDisk = path.join(kb['md'].rootDir, 'rb/seed.md');
    expect(fs.existsSync(onDisk)).toBe(true);
  });

  it('compound path calendar/2026-07-08 works (v5 W27 regression guard)', () => {
    const note = kb.createNote({
      path: 'calendar/2026-07-08',
      title: '2026-07-08',
      body: '# Standup',
    });
    expect(note.path).toBe('calendar/2026-07-08');
    expect(note.folder).toBe('calendar');
  });

  it('auto-queues KG processing on create + update', () => {
    kb.createNote({ path: 'kg/x', title: 'X', body: '' });
    expect(kb.listKgPending('pending').map((e) => e.note_path)).toContain('kg/x');
    kb.updateNote('kg/x', { body: 'changed' });
    const pending = kb.listKgPending('pending');
    expect(pending.some((e) => e.note_path === 'kg/x')).toBe(true);
  });

  it('manages links', () => {
    kb.createNote({ path: 'l/a', title: 'A', body: '' });
    kb.createNote({ path: 'l/b', title: 'B', body: '' });
    kb.addLink({ from_path: 'l/a', to_path: 'l/b', rel: 'related' });
    const links = kb.listLinks('l/a');
    expect(links.out).toHaveLength(1);
    expect(links.out[0]?.to_path).toBe('l/b');
    kb.removeLink('l/a', 'l/b');
    expect(kb.listLinks('l/a').out).toHaveLength(0);
  });

  it('reconcile() aligns sqlite with disk after restore', () => {
    kb.createNote({ path: 'rc/x', title: 'X', body: 'x' });
    // Drop the sqlite row (simulating a backup-restore that only had files).
    kb['sqlite'].deleteNoteByPath('rc/x');
    const out = kb.reconcile();
    expect(out.added.some((n) => n.path === 'rc/x')).toBe(true);
    expect(kb.readNote('rc/x')).not.toBeNull();
  });
});

describe('KbClient listNotes filters', () => {
  let kb: KbClient;
  let cleanup: () => void;

  beforeEach(() => {
    ({ kb, cleanup } = setup());
  });
  afterEach(() => cleanup());

  it('filters by type / status / tags / folder / query / time', () => {
    kb.createNote({
      path: 'inbox/a',
      title: 'A',
      body: 'a',
      type: 'note',
      status: 'active',
      tags: ['t1'],
    });
    kb.createNote({
      path: 'inbox/b',
      title: 'B',
      body: 'b',
      type: 'todo',
      status: 'draft',
      tags: ['t1', 't2'],
    });
    kb.createNote({
      path: 'archive/c',
      title: 'C',
      body: 'c',
      type: 'note',
      status: 'archived',
      tags: ['t3'],
    });
    const byType = kb.listNotes({ type: 'note' });
    expect(byType.items.map((n) => n.path).sort()).toEqual([
      'archive/c',
      'inbox/a',
    ]);

    const byStatus = kb.listNotes({ status: 'draft' });
    expect(byStatus.items.map((n) => n.path)).toEqual(['inbox/b']);

    const byTag = kb.listNotes({ tags: ['t2'] });
    expect(byTag.items.map((n) => n.path)).toEqual(['inbox/b']);

    const byFolder = kb.listNotes({ folder: 'archive' });
    expect(byFolder.items.map((n) => n.path)).toEqual(['archive/c']);

    const byQuery = kb.listNotes({ query: 'standup' });
    expect(byQuery.items).toHaveLength(0);
    kb.createNote({
      path: 'calendar/2026-07-08/standup',
      title: 'standup notes',
      body: '',
    });
    const byQuery2 = kb.listNotes({ query: 'standup' });
    expect(byQuery2.items.map((n) => n.path)).toContain(
      'calendar/2026-07-08/standup',
    );

    const t = Date.now();
    kb.updateNote('inbox/a', { body: 'a2' });
    const recent = kb.listNotes({ updatedAfter: t - 1000 });
    expect(recent.items.map((n) => n.path)).toContain('inbox/a');
  });

  it('searches note bodies when the query is absent from title and path', () => {
    kb.createNote({
      path: 'inbox/body-search-target',
      title: 'Search contract fixture',
      body: 'body-only-token-7f3c2a remains searchable after local persistence',
      tags: ['search-contract'],
    });
    kb.createNote({
      path: 'inbox/body-search-control',
      title: 'Control fixture',
      body: 'unrelated local content',
      tags: ['search-contract'],
    });

    const result = kb.searchNotes('body-only-token-7f3c2a', { limit: 100 });
    expect(result.total).toBe(1);
    expect(result.items.map((note) => note.path)).toEqual(['inbox/body-search-target']);
  });

  it('paginates with limit + offset', () => {
    for (let i = 0; i < 25; i++) {
      kb.createNote({ path: `p/n${i}`, title: `n${i}`, body: '' });
    }
    const p1 = kb.listNotes({ limit: 10, offset: 0 });
    expect(p1.items).toHaveLength(10);
    expect(p1.total).toBe(25);
    const p2 = kb.listNotes({ limit: 10, offset: 10 });
    expect(p2.items).toHaveLength(10);
    const p3 = kb.listNotes({ limit: 10, offset: 20 });
    expect(p3.items).toHaveLength(5);
  });
});
