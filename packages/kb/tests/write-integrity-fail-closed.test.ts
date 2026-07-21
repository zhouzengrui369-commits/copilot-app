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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-write-integrity-'));
  const rootDir = path.join(dir, 'notes');
  const sqlite = new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') });
  const md = new MdFileStore({ rootDir });
  return { dir, rootDir, sqlite, md, kb: new KbClient({ sqlite, md }) };
}

function expectStableError(execute: () => unknown, code: string, rootDir: string): void {
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

describe('KbClient update body write boundary', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setup();
  });

  afterEach(() => {
    fixture.kb.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('rejects an intermediate symlink escape and leaves outside bytes unchanged', () => {
    fixture.kb.createNote({ path: 'escape/note', title: 'Escape note', body: 'inside' });
    const outsideDir = path.join(fixture.dir, 'outside');
    fs.mkdirSync(outsideDir);
    const outsideFile = path.join(outsideDir, 'note.md');
    const original = Buffer.from('outside-original-bytes');
    fs.writeFileSync(outsideFile, original);
    fs.rmSync(path.join(fixture.rootDir, 'escape'), { recursive: true, force: true });
    fs.symlinkSync(outsideDir, path.join(fixture.rootDir, 'escape'), 'dir');

    expectStableError(
      () => fixture.kb.updateNote('escape/note', { body: 'attempted overwrite' }),
      'KB_MD_BODY_OUTSIDE_ROOT',
      fixture.rootDir,
    );
    expect(fs.readFileSync(outsideFile)).toEqual(original);
  });

  it('rejects update-with-body when persisted Markdown is missing', () => {
    fixture.kb.createNote({ path: 'missing/note', title: 'Missing note', body: 'inside' });
    fs.unlinkSync(fixture.md.pathFor('missing/note'));

    expectStableError(
      () => fixture.kb.updateNote('missing/note', { body: 'replacement' }),
      'KB_MD_BODY_MISSING',
      fixture.rootDir,
    );
    expect(fs.existsSync(fixture.md.pathFor('missing/note'))).toBe(false);
  });

  it('rejects update-with-body when the final Markdown target is a symlink', () => {
    fixture.kb.createNote({ path: 'final/link', title: 'Final link', body: 'inside' });
    const target = fixture.md.pathFor('final/link');
    const outside = path.join(fixture.dir, 'outside-final.md');
    const original = Buffer.from('outside-final-original');
    fs.writeFileSync(outside, original);
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target, 'file');

    expectStableError(
      () => fixture.kb.updateNote('final/link', { body: 'replacement' }),
      'KB_MD_BODY_SYMLINK',
      fixture.rootDir,
    );
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside)).toEqual(original);
  });

  it('rejects update-with-body when the final Markdown target is non-regular', () => {
    fixture.kb.createNote({ path: 'final/directory', title: 'Directory', body: 'inside' });
    const target = fixture.md.pathFor('final/directory');
    fs.unlinkSync(target);
    fs.mkdirSync(target);

    expectStableError(
      () => fixture.kb.updateNote('final/directory', { body: 'replacement' }),
      'KB_MD_BODY_NON_REGULAR',
      fixture.rootDir,
    );
    expect(fs.lstatSync(target).isDirectory()).toBe(true);
  });
});

describe('MdFileStore write/create boundary', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setup();
  });

  afterEach(() => {
    fixture.kb.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('keeps legal replacement atomic, regular, private, and temp-free', () => {
    const target = fixture.md.write(
      'legal/note',
      { path: 'legal/note', title: 'Legal' },
      'first body',
    );
    fixture.md.write('legal/note', { path: 'legal/note', title: 'Legal' }, 'second body');

    const targetStat = fs.lstatSync(target);
    expect(targetStat.isFile()).toBe(true);
    expect(targetStat.isSymbolicLink()).toBe(false);
    if (process.platform !== 'win32') expect(targetStat.mode & 0o777).toBe(0o600);
    expect(fixture.md.readPersisted('legal/note').body.trim()).toBe('second body');
    expect(fs.readdirSync(path.dirname(target)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects createNote through an outside-root parent symlink', () => {
    const outsideDir = path.join(fixture.dir, 'outside-create');
    fs.mkdirSync(outsideDir);
    fs.symlinkSync(outsideDir, path.join(fixture.rootDir, 'escape'), 'dir');

    expectStableError(
      () => fixture.kb.createNote({ path: 'escape/new', title: 'New', body: 'secret' }),
      'KB_MD_WRITE_PARENT_SYMLINK',
      fixture.rootDir,
    );
    expect(fs.existsSync(path.join(outsideDir, 'new.md'))).toBe(false);
  });

  it('rejects direct write through an outside-root parent symlink', () => {
    const outsideDir = path.join(fixture.dir, 'outside-write');
    fs.mkdirSync(outsideDir);
    fs.symlinkSync(outsideDir, path.join(fixture.rootDir, 'escape'), 'dir');

    expectStableError(
      () => fixture.md.write('escape/new', { path: 'escape/new', title: 'New' }, 'secret'),
      'KB_MD_WRITE_PARENT_SYMLINK',
      fixture.rootDir,
    );
    expect(fs.existsSync(path.join(outsideDir, 'new.md'))).toBe(false);
  });

  it('rejects a direct write to a final symlink without changing target bytes', () => {
    const outside = path.join(fixture.dir, 'outside-target.md');
    const original = Buffer.from('outside-target-original');
    fs.writeFileSync(outside, original);
    const target = fixture.md.pathFor('final/link');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(outside, target, 'file');

    expectStableError(
      () => fixture.md.write('final/link', { path: 'final/link', title: 'Link' }, 'secret'),
      'KB_MD_WRITE_TARGET_SYMLINK',
      fixture.rootDir,
    );
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside)).toEqual(original);
  });
});
