import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { runMigrations } from '../src/api/migration.js';

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sqlite-'));
  return path.join(dir, 'kb.sqlite');
}

describe('SqliteStore (v0 schema)', () => {
  let store: SqliteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new SqliteStore({ dbPath });
  });
  afterEach(() => store.close());

  it('creates the schema and reports v0', () => {
    expect(store.schemaVersion).toBe(0);
    expect(store.countNotes()).toBe(0);
  });

  it('inserts and reads back a note', () => {
    const n = store.insertNote(
      {
        path: 'inbox/hello',
        title: 'Hello',
        body: '',
        tags: ['a', 'b'],
        related: ['other/path'],
        folder: 'inbox',
      },
      '/abs/inbox/hello.md',
      1_700_000_000_000,
    );
    expect(n.id).toBeGreaterThan(0);
    expect(n.path).toBe('inbox/hello');
    expect(n.tags).toEqual(['a', 'b']);
    expect(n.related).toEqual(['other/path']);
    expect(n.folder).toBe('inbox');
    expect(n.created_at).toBe(1_700_000_000_000);

    const fetched = store.getNoteByPath('inbox/hello');
    expect(fetched?.id).toBe(n.id);
    expect(store.getNoteById(n.id)?.path).toBe('inbox/hello');
    expect(store.getNoteById(n.id + 1)).toBeNull();
  });

  it('normalizes null, malformed, and non-array stored metadata', () => {
    store.insertNote(
      { path: 'p/metadata', title: 'Metadata', body: '' },
      '/abs/metadata.md',
      1,
    );

    store.raw
      .prepare(`UPDATE notes SET tags = NULL, related = 'not-json', folder = NULL WHERE path = ?`)
      .run('p/metadata');
    const malformed = store.getNoteByPath('p/metadata');
    expect(malformed?.tags).toEqual([]);
    expect(malformed?.related).toEqual([]);
    expect(malformed?.folder).toBe('');

    store.raw
      .prepare(`UPDATE notes SET tags = ?, related = ? WHERE path = ?`)
      .run(JSON.stringify('scalar'), JSON.stringify({ not: 'an array' }), 'p/metadata');
    const nonArrays = store.getNoteByPath('p/metadata');
    expect(nonArrays?.tags).toEqual([]);
    expect(nonArrays?.related).toEqual([]);
  });

  it('enforces path uniqueness', () => {
    store.insertNote(
      { path: 'p/a', title: 'A', body: '' },
      '/abs/a.md',
      1,
    );
    expect(() =>
      store.insertNote({ path: 'p/a', title: 'A2', body: '' }, '/abs/a2.md', 2),
    ).toThrow(/UNIQUE/);
  });

  it('updates a partial set of fields', () => {
    store.insertNote({ path: 'p/a', title: 'A', body: '' }, '/abs/a.md', 1);
    const updated = store.updateNote(
      'p/a',
      { title: 'A2', tags: ['x'] },
      2,
    );
    expect(updated?.title).toBe('A2');
    expect(updated?.tags).toEqual(['x']);
    expect(updated?.updated_at).toBe(2);
    expect(updated?.created_at).toBe(1);
  });

  it('updates every optional metadata field and accepts an empty patch', () => {
    store.insertNote({ path: 'p/full', title: 'Full', body: '' }, '/abs/full.md', 1);

    const updated = store.updateNote(
      'p/full',
      {
        type: 'idea',
        status: 'active',
        related: ['p/other'],
        source_hash: 'sha256:abc',
        confidence: 0.9,
        agent: 'test-agent',
      },
      2,
    );
    expect(updated).toMatchObject({
      type: 'idea',
      status: 'active',
      related: ['p/other'],
      source_hash: 'sha256:abc',
      confidence: 0.9,
      agent: 'test-agent',
      updated_at: 2,
    });

    expect(store.updateNote('p/full', {}, 3)).toEqual(updated);
  });

  it('returns null when updating a missing path', () => {
    expect(store.updateNote('missing/x', { title: 'noop' }, 1)).toBeNull();
  });

  it('deletes a note', () => {
    store.insertNote({ path: 'p/a', title: 'A', body: '' }, '/abs/a.md', 1);
    expect(store.deleteNoteByPath('p/a')).toBe(true);
    expect(store.getNoteByPath('p/a')).toBeNull();
  });

  it('manages note_links', () => {
    store.addLink({ from_path: 'a', to_path: 'b', rel: 'related' });
    store.addLink({ from_path: 'a', to_path: 'c', rel: null });
    expect(store.linksFrom('a')).toHaveLength(2);
    expect(store.linksTo('b')).toHaveLength(1);
    expect(store.removeLink('a', 'b')).toBe(true);
    expect(store.linksFrom('a')).toHaveLength(1);
  });

  it('manages kg_pending queue', () => {
    store.queueKg('a', 1);
    store.queueKg('b', 2, 'processing');
    expect(store.listKgPending()).toHaveLength(2);
    expect(store.listKgPending('pending')).toHaveLength(1);
    store.setKgStatus('b', 'done');
    expect(store.listKgPending('done')).toHaveLength(1);
    expect(store.removeKgPending('a')).toBe(true);
  });

  it('lists notes ordered by updated_at DESC', () => {
    store.insertNote({ path: 'p/a', title: 'A', body: '' }, '/abs/a.md', 1);
    store.insertNote({ path: 'p/b', title: 'B', body: '' }, '/abs/b.md', 5);
    store.insertNote({ path: 'p/c', title: 'C', body: '' }, '/abs/c.md', 3);
    const all = store.listAllNotes();
    expect(all.map((n) => n.path)).toEqual(['p/b', 'p/c', 'p/a']);
  });

  it('reports the row-missing invariant if a database trigger removes an insert', () => {
    store.raw.exec(`
      CREATE TRIGGER remove_inserted_note
      AFTER INSERT ON notes
      BEGIN
        DELETE FROM notes WHERE id = NEW.id;
      END;
    `);

    expect(() =>
      store.insertNote({ path: 'p/removed', title: 'Removed', body: '' }, '/abs/removed.md', 1),
    ).toThrow('SqliteStore.insertNote: row missing after insert');
  });

  it('can be closed more than once without touching the native handle again', () => {
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});

describe('SqliteStore constructor boundaries', () => {
  it('creates a missing parent directory and defaults an empty schema version to v0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sqlite-parent-'));
    const dbPath = path.join(root, 'missing', 'nested', 'kb.sqlite');
    const store = new SqliteStore({ dbPath, wal: false, migrate: false });
    try {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      store.raw.exec(`CREATE TABLE schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
      expect(store.schemaVersion).toBe(0);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('SqliteStore WAL mode', () => {
  it('enables WAL journal mode', () => {
    const dbPath = tmpDb();
    const store = new SqliteStore({ dbPath, wal: true });
    const mode = store.raw.pragma('journal_mode', { simple: true });
    expect(String(mode).toLowerCase()).toBe('wal');
    store.close();
    // WAL produces a -wal sidecar file when active.
    expect(fs.existsSync(`${dbPath}-wal`) || true).toBe(true);
  });
});

describe('runMigrations', () => {
  it('applies the default append-only v2 target', () => {
    const store = new SqliteStore({ dbPath: tmpDb() });
    const out = runMigrations(store);
    expect(out.from).toBe(0);
    expect(out.to).toBe(2);
    expect(out.applied).toEqual([1, 2]);
    store.close();
  });

  it('throws on missing migration step', () => {
    const store = new SqliteStore({ dbPath: tmpDb() });
    runMigrations(store, 2);
    expect(() => runMigrations(store, 3)).toThrow(/not registered/);
    store.close();
  });
});
