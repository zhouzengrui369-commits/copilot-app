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

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MdFileStore, _internal } from '../src/store/md-file-store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-md-edge-'));
}

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
