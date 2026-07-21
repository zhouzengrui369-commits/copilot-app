import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbClient } from '../src/api/crud.js';
import { MdFileStore } from '../src/store/md-file-store.js';
import { SqliteStore } from '../src/store/sqlite-store.js';

interface Fixture {
  dir: string;
  rootDir: string;
  sqlite: SqliteStore;
  md: MdFileStore;
  kb: KbClient;
}

function setup(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-body-integrity-'));
  const rootDir = path.join(dir, 'notes');
  const sqlite = new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') });
  const md = new MdFileStore({ rootDir });
  return { dir, rootDir, sqlite, md, kb: new KbClient({ sqlite, md }) };
}

function expectStableIntegrityError(
  execute: () => unknown,
  code: string,
  rootDir: string,
): void {
  let received: unknown;
  try {
    execute();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(Error);
  expect((received as Error & { code?: string }).code).toBe(code);
  expect((received as Error).message).toBe(code);
  expect((received as Error).message).not.toContain(rootDir);
}

function replacePersistedPath(sqlite: SqliteStore, from: string, to: string): void {
  sqlite.raw.prepare('UPDATE notes SET path = ?, md_path = ? WHERE path = ?')
    .run(to, 'redacted-untrusted-md-path', from);
}

describe('KbClient body-query integrity boundary', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setup();
  });

  afterEach(() => {
    fixture.kb.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('reports query total before limit/offset pagination on every page', () => {
    for (let index = 0; index < 3; index += 1) {
      fixture.kb.createNote({
        path: `page/match-${index}`,
        title: `Page fixture ${index}`,
        body: 'body-pagination-token-9a4d',
        tags: ['body-page'],
      });
    }
    fixture.kb.createNote({
      path: 'page/control',
      title: 'Control',
      body: 'unrelated',
      tags: ['body-page'],
    });

    const pages = [0, 1, 2, 3].map((offset) => fixture.kb.listNotes({
      query: 'body-pagination-token-9a4d',
      tags: ['body-page'],
      limit: 1,
      offset,
    }));

    expect(pages.map((page) => page.total)).toEqual([3, 3, 3, 3]);
    expect(pages.map((page) => page.items.length)).toEqual([1, 1, 1, 0]);
    expect(new Set(pages.slice(0, 3).flatMap((page) => page.items.map((note) => note.path))).size)
      .toBe(3);
  });

  it('fails closed with a stable error when a persisted row has no Markdown file', () => {
    fixture.kb.createNote({
      path: 'missing/body',
      title: 'Missing body fixture',
      body: 'missing-body-token-741f',
    });
    fs.unlinkSync(fixture.md.pathFor('missing/body'));

    expectStableIntegrityError(
      () => fixture.kb.listNotes({ query: 'missing-body-token-741f' }),
      'KB_MD_BODY_MISSING',
      fixture.rootDir,
    );
    expectStableIntegrityError(
      () => fixture.kb.readNote('missing/body'),
      'KB_MD_BODY_MISSING',
      fixture.rootDir,
    );
  });

  it('rejects a traversal-shaped persisted path before reading outside-root content', () => {
    fixture.kb.createNote({ path: 'safe/traversal-row', title: 'Traversal row', body: 'safe' });
    fs.writeFileSync(path.join(fixture.dir, 'outside.md'), 'outside-root-secret-token-557c', 'utf8');
    replacePersistedPath(fixture.sqlite, 'safe/traversal-row', '../outside');

    expectStableIntegrityError(
      () => fixture.kb.listNotes({ query: 'outside-root-secret-token-557c' }),
      'KB_MD_BODY_PATH_INVALID',
      fixture.rootDir,
    );
  });

  it('rejects a final Markdown symlink before reading its target', () => {
    fixture.kb.createNote({ path: 'safe/symlink-row', title: 'Symlink row', body: 'safe' });
    const outside = path.join(fixture.dir, 'symlink-target.md');
    fs.writeFileSync(outside, 'symlink-secret-token-c2d8', 'utf8');
    const target = fixture.md.pathFor('safe/symlink-row');
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target, 'file');

    expectStableIntegrityError(
      () => fixture.kb.listNotes({ query: 'symlink-secret-token-c2d8' }),
      'KB_MD_BODY_SYMLINK',
      fixture.rootDir,
    );
  });

  it('rejects a non-regular Markdown target with a stable error', () => {
    fixture.kb.createNote({ path: 'safe/directory-row', title: 'Directory row', body: 'safe' });
    const target = fixture.md.pathFor('safe/directory-row');
    fs.unlinkSync(target);
    fs.mkdirSync(target);

    expectStableIntegrityError(
      () => fixture.kb.listNotes({ query: 'never-match' }),
      'KB_MD_BODY_NON_REGULAR',
      fixture.rootDir,
    );
  });
});
