/**
 * MdFileStore edge-case tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * The base `md-file-store.test.ts` covers the happy paths (write/read/delete,
 * prune, listAll, corrupt frontmatter). This file pins the *negative* and
 * *boundary* cases that are easy to regress:
 *   - `exists()` must report false for missing notes (not throw)
 *   - `pruneEmptyParents` must stop at the first non-empty ancestor
 *   - `pathFor` is pure (no IO, no side effects)
 *   - atomic write via `_internal.atomicWriteFileSync` survives a tmp file
 *     collision
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MdFileStore, _internal } from '../src/store/md-file-store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-md-edge-'));
}

const faultRoots = new Set<string>();

function faultFixture(): { rootDir: string; md: MdFileStore } {
  const rootDir = tmpDir();
  faultRoots.add(rootDir);
  return { rootDir, md: new MdFileStore({ rootDir }) };
}

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function expectStableCode(run: () => unknown, code: string): void {
  let received: unknown;
  try {
    run();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(Error);
  expect((received as Error & { code?: string }).code).toBe(code);
  expect((received as Error).message).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const rootDir of faultRoots) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
  faultRoots.clear();
});

describe('MdFileStore · exists() boundary', () => {
  let md: MdFileStore;
  let rootDir: string;

  beforeEach(() => {
    rootDir = tmpDir();
    md = new MdFileStore({ rootDir });
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns false for a missing note (does not throw)', () => {
    expect(md.exists('inbox/never-written')).toBe(false);
  });

  it('returns true for a note we just wrote', () => {
    md.write('a/b', { path: 'a/b', title: 'B' }, 'body');
    expect(md.exists('a/b')).toBe(true);
  });

  it('returns false again after delete', () => {
    md.write('a/b', { path: 'a/b', title: 'B' }, 'body');
    md.delete('a/b');
    expect(md.exists('a/b')).toBe(false);
  });
});

describe('MdFileStore · pruneEmptyParents boundary', () => {
  let md: MdFileStore;
  let rootDir: string;

  beforeEach(() => {
    rootDir = tmpDir();
    md = new MdFileStore({ rootDir });
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('stops pruning at the first ancestor that still has a sibling', () => {
    // Tree:
    //   rootDir/
    //     a/
    //       b/      <-- will be empty after delete
    //         c.md  <-- removed
    //       keep.md <-- sibling of b, must keep a/ alive
    md.write('a/b/c', { path: 'a/b/c', title: 'C' }, 'x');
    md.write('a/keep', { path: 'a/keep', title: 'K' }, 'y');
    md.delete('a/b/c');
    md.pruneEmptyParents('a/b/c');

    // a/b is empty, so it should be gone.
    expect(fs.existsSync(path.join(rootDir, 'a/b'))).toBe(false);
    // a still has `a/keep`, so it must survive.
    expect(fs.existsSync(path.join(rootDir, 'a'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'a/keep.md'))).toBe(true);
  });

  it('prunes all empty ancestors when the tree is fully empty', () => {
    md.write('a/b/c/d', { path: 'a/b/c/d', title: 'D' }, 'x');
    md.delete('a/b/c/d');
    md.pruneEmptyParents('a/b/c/d');

    expect(fs.existsSync(path.join(rootDir, 'a/b/c'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'a/b'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'a'))).toBe(false);
  });
});

describe('MdFileStore · pathFor is pure', () => {
  it('returns the expected absolute path without touching the filesystem', () => {
    const dir = tmpDir();
    const md = new MdFileStore({ rootDir: dir });
    const expected = path.join(dir, 'inbox/quick.md');
    expect(md.pathFor('inbox/quick')).toBe(expected);
    // File must not exist after pathFor — it is a pure mapping.
    expect(fs.existsSync(md.pathFor('inbox/quick'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('MdFileStore · _internal.sanitizeFrontmatter', () => {
  it('drops keys that are not in the Frontmatter allowlist', () => {
    const out = _internal.sanitizeFrontmatter({
      path: 'p/q',
      title: 'T',
      garbage: 'should be dropped',
      evil: 42,
    } as unknown as Parameters<typeof _internal.sanitizeFrontmatter>[0]);
    expect(out).toEqual({ path: 'p/q', title: 'T' });
  });

  it('coerces non-array tags/related to empty arrays (no TypeError)', () => {
    // Note: sanitizeFrontmatter uses `!== undefined` guards, so passing
    // `undefined` causes the key to be omitted entirely. We pass `null` /
    // a non-array string here to actually exercise the Array.isArray branch.
    const out = _internal.sanitizeFrontmatter({
      path: 'p/q',
      title: 'T',
      tags: 'not-an-array' as unknown as string[],
      related: null as unknown as string[],
    });
    expect(out.tags).toEqual([]);
    expect(out.related).toEqual([]);
  });
});

describe('MdFileStore · fail-closed filesystem boundaries', () => {
  it('closes and removes the private temp file when the descriptor write fails', () => {
    const { rootDir } = faultFixture();
    const target = path.join(rootDir, 'atomic.md');
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw errno('EIO', 'descriptor write failed');
    });

    expect(() => _internal.atomicWriteFileSync(target, 'private')).toThrow(
      'descriptor write failed',
    );
    expect(fs.readdirSync(rootDir)).toEqual([]);
  });

  it.each([
    ['ELOOP', 'KB_MD_WRITE_PARENT_SYMLINK'],
    ['ENOTDIR', 'KB_MD_WRITE_PARENT_NON_DIRECTORY'],
    ['EISDIR', 'KB_MD_WRITE_TARGET_NON_REGULAR'],
    ['EACCES', 'KB_MD_WRITE_UNAVAILABLE'],
  ])('maps atomic open errno %s to stable write code %s', (fsCode, stableCode) => {
    const { md } = faultFixture();
    vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
      throw errno(fsCode);
    });

    expectStableCode(
      () => md.write('fault/note', { path: 'fault/note', title: 'Fault' }, 'secret'),
      stableCode,
    );
  });

  it.each([
    ['ENOENT', 'KB_MD_BODY_MISSING'],
    ['ELOOP', 'KB_MD_BODY_SYMLINK'],
    ['EISDIR', 'KB_MD_BODY_NON_REGULAR'],
    ['ENOTDIR', 'KB_MD_BODY_NON_REGULAR'],
    ['EACCES', 'KB_MD_BODY_UNREADABLE'],
  ])('maps persisted lstat errno %s to stable body code %s', (fsCode, stableCode) => {
    const { md } = faultFixture();
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw errno(fsCode);
    });

    expectStableCode(() => md.readPersisted('fault/note'), stableCode);
  });

  it('preserves an integrity error raised after opening a non-regular handle', () => {
    const { md } = faultFixture();
    md.write('body/nonregular', { path: 'body/nonregular', title: 'Body' }, 'body');
    const actualFstat = fs.fstatSync.bind(fs);
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stat = actualFstat(descriptor);
      stat.isFile = () => false;
      return stat;
    });

    expectStableCode(
      () => md.readPersisted('body/nonregular'),
      'KB_MD_BODY_NON_REGULAR',
    );
  });

  it('maps a descriptor read failure without leaking the host path', () => {
    const { md } = faultFixture();
    md.write('body/unreadable', { path: 'body/unreadable', title: 'Body' }, 'body');
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.readPersisted('body/unreadable'),
      'KB_MD_BODY_UNREADABLE',
    );
  });

  it('accepts a concurrent directory creator only for the exact EEXIST race', () => {
    const { rootDir, md } = faultFixture();
    fs.mkdirSync(path.join(rootDir, 'race'));
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw errno('ENOENT');
    });
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw errno('EEXIST');
    });

    const target = md.write(
      'race/note',
      { path: 'race/note', title: 'Concurrent creator' },
      'body',
    );
    expect(fs.readFileSync(target, 'utf8')).toContain('body');
  });

  it('distinguishes an existing parent file from an existing final directory', () => {
    const { rootDir, md } = faultFixture();
    fs.writeFileSync(path.join(rootDir, 'parent-file'), 'not a directory');
    expectStableCode(
      () => md.write(
        'parent-file/note',
        { path: 'parent-file/note', title: 'Parent file' },
        'body',
      ),
      'KB_MD_WRITE_PARENT_NON_DIRECTORY',
    );

    const finalDirectory = md.pathFor('target/directory');
    fs.mkdirSync(finalDirectory, { recursive: true });
    expectStableCode(
      () => md.write(
        'target/directory',
        { path: 'target/directory', title: 'Target directory' },
        'body',
      ),
      'KB_MD_WRITE_TARGET_NON_REGULAR',
    );
  });

  it('normalizes a replaced target back to owner-only permissions', () => {
    if (process.platform === 'win32') return;
    const { md } = faultFixture();
    const target = md.pathFor('private/mode');
    const actualLstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation((candidate) => {
      const stat = actualLstat(candidate);
      if (path.resolve(String(candidate)) === path.resolve(target) && stat.isFile()) {
        stat.mode = (stat.mode & ~0o777) | 0o644;
      }
      return stat;
    });

    md.write('private/mode', { path: 'private/mode', title: 'Private' }, 'body');
    vi.restoreAllMocks();
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it('rejects malformed paths and unsafe trash roots with stable codes', () => {
    const { rootDir, md } = faultFixture();
    expectStableCode(
      () => md.write('', { path: '', title: 'Invalid' }, 'body'),
      'KB_MD_WRITE_PATH_INVALID',
    );
    expect(() => md.trashPathFor('not-a-v4-uuid')).toThrowError(
      expect.objectContaining({ code: 'TRASH_INVALID_ARGUMENT' }),
    );

    fs.writeFileSync(path.join(rootDir, '.trash'), 'not a directory');
    expect(() =>
      md.trashPathFor('11111111-1111-4111-8111-111111111111'),
    ).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
  });

  it('fails closed if a permissive trash directory cannot be normalized', () => {
    if (process.platform === 'win32') return;
    const { rootDir, md } = faultFixture();
    const trashRoot = path.join(rootDir, '.trash');
    fs.mkdirSync(trashRoot, { mode: 0o777 });
    fs.chmodSync(trashRoot, 0o777);
    vi.spyOn(fs, 'chmodSync').mockImplementationOnce(() => undefined);

    expect(() =>
      md.trashPathFor('11111111-1111-4111-8111-111111111111'),
    ).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
  });

  it('maps move, restore, and purge filesystem failures to trash safety', () => {
    const { md } = faultFixture();
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    md.write('trash/move-fail', { path: 'trash/move-fail', title: 'Move' }, 'body');
    md.trashPathFor(firstId);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });
    expect(() => md.moveToTrash('trash/move-fail', firstId)).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
    vi.restoreAllMocks();

    md.moveToTrash('trash/move-fail', firstId);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });
    expect(() => md.restoreFromTrash(firstId, 'trash/restore-fail')).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
    vi.restoreAllMocks();

    md.write('trash/purge-fail', { path: 'trash/purge-fail', title: 'Purge' }, 'body');
    md.moveToTrash('trash/purge-fail', secondId);
    vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });
    expect(() => md.purgeTrash(secondId)).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
  });

  it('rejects persisted and write paths whose normalized form changes', () => {
    const { md } = faultFixture();

    expectStableCode(
      () => md.readPersisted(' body/note '),
      'KB_MD_BODY_PATH_INVALID',
    );
    expectStableCode(
      () => md.write(
        ' write/note ',
        { path: 'write/note', title: 'Changed normalization' },
        'body',
      ),
      'KB_MD_WRITE_PATH_INVALID',
    );
  });

  it('maps a persisted-target realpath failure to a stable unreadable code', () => {
    const { md } = faultFixture();
    md.write('body/realpath', { path: 'body/realpath', title: 'Body' }, 'body');
    vi.spyOn(fs.realpathSync, 'native').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.readPersisted('body/realpath'),
      'KB_MD_BODY_UNREADABLE',
    );
  });

  it('maps an unexpected initial parent lstat error to write unavailable', () => {
    const { md } = faultFixture();
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.write(
        'denied/note',
        { path: 'denied/note', title: 'Denied parent' },
        'body',
      ),
      'KB_MD_WRITE_UNAVAILABLE',
    );
  });

  it('maps a failed parent-directory creation to write unavailable', () => {
    const { md } = faultFixture();
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw errno('ENOENT');
    });
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.write(
        'mkdir-denied/note',
        { path: 'mkdir-denied/note', title: 'Denied mkdir' },
        'body',
      ),
      'KB_MD_WRITE_UNAVAILABLE',
    );
  });

  it('fails closed when a newly resolved parent cannot be canonicalized', () => {
    const { md } = faultFixture();
    vi.spyOn(fs.realpathSync, 'native').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.write(
        'realpath-denied/note',
        { path: 'realpath-denied/note', title: 'Denied realpath' },
        'body',
      ),
      'KB_MD_WRITE_UNAVAILABLE',
    );
  });

  it('fails closed when a parent canonicalizes outside the note root', () => {
    const { md } = faultFixture();
    vi.spyOn(fs.realpathSync, 'native').mockImplementationOnce(() =>
      path.join(os.tmpdir(), 'kb-md-outside-parent'),
    );

    expectStableCode(
      () => md.write(
        'escaped/note',
        { path: 'escaped/note', title: 'Escaped parent' },
        'body',
      ),
      'KB_MD_WRITE_OUTSIDE_ROOT',
    );
  });

  it('maps a non-ENOENT target lstat failure before replacement', () => {
    const { md } = faultFixture();
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.write(
        'target-denied',
        { path: 'target-denied', title: 'Denied target' },
        'body',
      ),
      'KB_MD_WRITE_UNAVAILABLE',
    );
  });

  it.each([
    ['lstat error', 'KB_MD_WRITE_UNAVAILABLE'],
    ['symlink swap', 'KB_MD_WRITE_PARENT_SYMLINK'],
    ['file swap', 'KB_MD_WRITE_PARENT_NON_DIRECTORY'],
  ])('detects a parent TOCTOU %s', (scenario, stableCode) => {
    const { rootDir, md } = faultFixture();
    const parent = path.join(rootDir, 'toctou');
    fs.mkdirSync(parent);
    const canonicalParent = fs.realpathSync.native(parent);
    const actualLstat = fs.lstatSync.bind(fs);
    let parentReads = 0;
    vi.spyOn(fs, 'lstatSync').mockImplementation((candidate) => {
      const stat = actualLstat(candidate);
      if (path.resolve(String(candidate)) !== path.resolve(canonicalParent)) return stat;
      parentReads += 1;
      if (parentReads !== 2) return stat;
      if (scenario === 'lstat error') throw errno('EACCES');
      if (scenario === 'symlink swap') stat.isSymbolicLink = () => true;
      if (scenario === 'file swap') stat.isDirectory = () => false;
      return stat;
    });

    expectStableCode(
      () => md.write(
        'toctou/note',
        { path: 'toctou/note', title: 'TOCTOU parent' },
        'body',
      ),
      stableCode,
    );
  });

  it.each([
    ['realpath error', 'KB_MD_WRITE_UNAVAILABLE'],
    ['outside root', 'KB_MD_WRITE_OUTSIDE_ROOT'],
  ])('detects a canonical parent TOCTOU %s', (scenario, stableCode) => {
    const { rootDir, md } = faultFixture();
    const parent = path.join(rootDir, 'canonical-toctou');
    fs.mkdirSync(parent);
    const canonicalParent = fs.realpathSync.native(parent);
    const actualRealpath = fs.realpathSync.native.bind(fs.realpathSync);
    let parentReads = 0;
    vi.spyOn(fs.realpathSync, 'native').mockImplementation((candidate) => {
      if (path.resolve(String(candidate)) !== path.resolve(canonicalParent)) {
        return actualRealpath(candidate);
      }
      parentReads += 1;
      if (parentReads !== 2) return actualRealpath(candidate);
      if (scenario === 'realpath error') throw errno('EACCES');
      return path.join(os.tmpdir(), 'kb-md-outside-parent');
    });

    expectStableCode(
      () => md.write(
        'canonical-toctou/note',
        { path: 'canonical-toctou/note', title: 'Canonical TOCTOU' },
        'body',
      ),
      stableCode,
    );
  });

  it('maps a final owner-only chmod failure to write unavailable', () => {
    if (process.platform === 'win32') return;
    const { rootDir, md } = faultFixture();
    const target = path.join(
      fs.realpathSync.native(rootDir),
      'private/chmod-denied.md',
    );
    const actualLstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation((candidate) => {
      const stat = actualLstat(candidate);
      if (path.resolve(String(candidate)) === path.resolve(target) && stat.isFile()) {
        stat.mode = (stat.mode & ~0o777) | 0o644;
      }
      return stat;
    });
    vi.spyOn(fs, 'chmodSync').mockImplementationOnce(() => {
      throw errno('EACCES');
    });

    expectStableCode(
      () => md.write(
        'private/chmod-denied',
        { path: 'private/chmod-denied', title: 'Private' },
        'body',
      ),
      'KB_MD_WRITE_UNAVAILABLE',
    );
  });

  it('reports missing trash reads, restores, and purges explicitly', () => {
    const { md } = faultFixture();
    const missingId = '33333333-3333-4333-8333-333333333333';

    expect(() => md.readTrashRaw(missingId)).toThrowError(
      expect.objectContaining({ code: 'TRASH_NOT_FOUND' }),
    );
    expect(() => md.restoreFromTrash(missingId, 'trash/restored')).toThrowError(
      expect.objectContaining({ code: 'TRASH_NOT_FOUND' }),
    );
    expect(md.purgeTrash(missingId)).toBe(false);
  });

  it('rejects occupied trash and restore targets without overwriting bytes', () => {
    const { md } = faultFixture();
    const occupiedId = '44444444-4444-4444-8444-444444444444';
    const restoreId = '55555555-5555-4555-8555-555555555555';
    md.write('trash/source', { path: 'trash/source', title: 'Source' }, 'source');
    fs.writeFileSync(md.trashPathFor(occupiedId), 'occupied', { mode: 0o600 });

    expect(() => md.moveToTrash('trash/source', occupiedId)).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
    expect(md.readPersisted('trash/source').body).toBe('source\n');
    expect(md.readTrashRaw(occupiedId).toString('utf8')).toBe('occupied');

    md.moveToTrash('trash/source', restoreId);
    md.write('trash/conflict', { path: 'trash/conflict', title: 'Conflict' }, 'new');
    expect(() => md.restoreFromTrash(restoreId, 'trash/conflict')).toThrowError(
      expect.objectContaining({ code: 'TRASH_RESTORE_CONFLICT' }),
    );
    expect(md.readPersisted('trash/conflict').body).toBe('new\n');
    expect(md.trashExists(restoreId)).toBe(true);
  });

  it('fails closed when the trash directory canonicalizes outside the root', () => {
    const { md } = faultFixture();
    vi.spyOn(fs.realpathSync, 'native').mockImplementationOnce(() =>
      path.join(os.tmpdir(), 'kb-md-outside-trash'),
    );

    expect(() =>
      md.trashPathFor('66666666-6666-4666-8666-666666666666'),
    ).toThrowError(expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }));
  });

  it('rejects a non-regular descriptor after a safe persisted lstat', () => {
    const { md } = faultFixture();
    md.write('body/open-race', { path: 'body/open-race', title: 'Body' }, 'body');
    const actualFstat = fs.fstatSync.bind(fs);
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stat = actualFstat(descriptor);
      stat.isFile = () => false;
      return stat;
    });

    expect(() => md.readPersistedRaw('body/open-race')).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
  });

  it('preserves a post-rename trash integrity error without remapping it', () => {
    const { md } = faultFixture();
    const trashId = '77777777-7777-4777-8777-777777777777';
    md.write('trash/open-race', { path: 'trash/open-race', title: 'Race' }, 'body');
    const actualFstat = fs.fstatSync.bind(fs);
    let reads = 0;
    vi.spyOn(fs, 'fstatSync').mockImplementation((descriptor) => {
      const stat = actualFstat(descriptor);
      reads += 1;
      if (reads === 2) stat.isFile = () => false;
      return stat;
    });

    expect(() => md.moveToTrash('trash/open-race', trashId)).toThrowError(
      expect.objectContaining({ code: 'TRASH_FILE_UNSAFE' }),
    );
    expect(fs.existsSync(md.trashPathFor(trashId))).toBe(true);
    expect(md.activeEntryExists('trash/open-race')).toBe(false);
  });

  it('keeps a same-volume trash move authoritative when directory fsync is unavailable', () => {
    const { md } = faultFixture();
    const trashId = '88888888-8888-4888-8888-888888888888';
    md.write('trash/fsync', { path: 'trash/fsync', title: 'Fsync' }, 'body');
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw errno('EIO');
    });

    md.moveToTrash('trash/fsync', trashId);

    expect(md.activeEntryExists('trash/fsync')).toBe(false);
    expect(md.readTrashRaw(trashId).toString('utf8')).toContain('body');
  });
});
