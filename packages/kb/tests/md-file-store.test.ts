import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MdFileStore, _internal } from '../src/store/md-file-store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-md-'));
}

describe('MdFileStore', () => {
  let md: MdFileStore;
  let rootDir: string;

  beforeEach(() => {
    rootDir = tmpDir();
    md = new MdFileStore({ rootDir });
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates the root dir on construction', () => {
    const dir = tmpDir();
    const nested = path.join(dir, 'deep/nested');
    new MdFileStore({ rootDir: nested });
    expect(fs.existsSync(nested)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes + reads a note', () => {
    const fm = {
      path: 'calendar/2026-07-08/standup',
      title: '2026-07-08 standup',
      tags: ['standup', 'team'],
      created_at: 1,
      updated_at: 2,
    };
    const target = md.write('calendar/2026-07-08/standup', fm, '## Hello\n');
    expect(fs.existsSync(target)).toBe(true);
    const parsed = md.read('calendar/2026-07-08/standup');
    expect(parsed?.body).toBe('## Hello\n');
    expect(parsed?.frontmatter.title).toBe('2026-07-08 standup');
    expect(parsed?.frontmatter.tags).toEqual(['standup', 'team']);
  });

  it('omits null / undefined fields from frontmatter', () => {
    md.write(
      'inbox/x',
      { path: 'inbox/x', title: 'X', confidence: null, agent: undefined as unknown as null },
      'body',
    );
    const parsed = md.read('inbox/x');
    expect(parsed?.frontmatter.confidence).toBeUndefined();
    expect(parsed?.frontmatter.agent).toBeUndefined();
    expect(parsed?.frontmatter.title).toBe('X');
  });

  it('survives a corrupt frontmatter (body-only fallback)', () => {
    const target = md.pathFor('broken/x');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'no frontmatter at all', 'utf8');
    const parsed = md.read('broken/x');
    expect(parsed?.body).toBe('no frontmatter at all');
  });

  it('deletes a note', () => {
    md.write('a/b', { path: 'a/b', title: 'B' }, 'x');
    expect(md.delete('a/b')).toBe(true);
    expect(md.exists('a/b')).toBe(false);
  });

  it('returns explicit missing results for read and delete', () => {
    expect(md.read('missing/note')).toBeNull();
    expect(md.delete('missing/note')).toBe(false);
  });

  it('prunes empty parent dirs after delete', () => {
    md.write('a/b/c', { path: 'a/b/c', title: 'C' }, 'x');
    md.delete('a/b/c');
    md.pruneEmptyParents('a/b/c');
    expect(fs.existsSync(path.join(rootDir, 'a/b'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'a'))).toBe(false);
  });

  it('stops pruning when an ancestor still contains another note', () => {
    md.write('a/b/c', { path: 'a/b/c', title: 'C' }, 'x');
    md.write('a/keep', { path: 'a/keep', title: 'Keep' }, 'y');
    md.delete('a/b/c');

    md.pruneEmptyParents('a/b/c');

    expect(fs.existsSync(path.join(rootDir, 'a/b'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'a/keep.md'))).toBe(true);
  });

  it('lists all notes (skips hidden + non-md)', () => {
    md.write('a/b', { path: 'a/b', title: 'B' }, 'x');
    md.write('c', { path: 'c', title: 'C' }, 'y');
    fs.writeFileSync(path.join(rootDir, 'README'), 'not a note');
    fs.writeFileSync(path.join(rootDir, '.hidden'), 'skip');
    const all = md.listAll();
    const paths = all.map((f) => f.compoundPath).sort();
    expect(paths).toEqual(['a/b', 'c']);
  });

  it('treats a root removed during traversal as an empty store', () => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    expect(md.listAll()).toEqual([]);
  });

  it('preserves the complete raw body when YAML frontmatter is invalid', () => {
    const raw = '---\n: invalid\n---\nbody';
    expect(_internal.parseRaw(raw)).toEqual({
      frontmatter: { path: '', title: '' },
      body: raw,
    });
  });

  it('filters unknown and null values while parsing frontmatter', () => {
    const parsed = _internal.parseRaw(
      '---\npath: inbox/x\ntitle: X\nunknown: ignored\nagent: null\ntags: scalar\n---\nbody',
    );

    expect(parsed.frontmatter).toEqual({ path: 'inbox/x', title: 'X' });
    expect(parsed.body).toBe('body');
  });

  it('sanitizes every supported optional frontmatter field', () => {
    const sanitized = _internal.sanitizeFrontmatter({
      path: 'inbox/full',
      title: 'Full',
      type: 'idea',
      status: 'active',
      tags: 'not-an-array' as unknown as string[],
      related: ['inbox/other'],
      folder: 'inbox',
      source_hash: 'sha256:abc',
      confidence: 0.75,
      agent: 'test-agent',
      created_at: 10,
      updated_at: 20,
    });

    expect(sanitized).toEqual({
      path: 'inbox/full',
      title: 'Full',
      type: 'idea',
      status: 'active',
      tags: [],
      related: ['inbox/other'],
      folder: 'inbox',
      source_hash: 'sha256:abc',
      confidence: 0.75,
      agent: 'test-agent',
      created_at: 10,
      updated_at: 20,
    });
  });
});
