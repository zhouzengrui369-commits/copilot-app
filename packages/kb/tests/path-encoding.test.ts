import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  encodePath,
  tryEncodePath,
  decodePath,
  folderOf,
  leafOf,
} from '../src/util/path-encoding.js';

describe('encodePath', () => {
  it('accepts a flat path', () => {
    expect(encodePath('inbox/quick')).toBe('inbox/quick');
  });

  it('accepts a deeply nested compound path', () => {
    expect(encodePath('calendar/2026-07-08/standup')).toBe(
      'calendar/2026-07-08/standup',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(encodePath('  notes/daily  ')).toBe('notes/daily');
  });

  it('rejects backslash', () => {
    expect(() => encodePath('a\\b')).toThrow(/backslash/);
  });

  it('rejects empty path', () => {
    expect(() => encodePath('')).toThrow(/empty/);
    expect(() => encodePath('   ')).toThrow(/empty/);
  });

  it('rejects path with empty segment', () => {
    expect(() => encodePath('a//b')).toThrow(/empty segment/);
  });

  it('rejects dot segment', () => {
    expect(() => encodePath('a/./b')).toThrow(/not allowed/);
    expect(() => encodePath('a/../b')).toThrow(/not allowed/);
  });

  it('rejects control characters', () => {
    expect(() => encodePath('a/\u0000b')).toThrow(/invalid/);
  });

  it('rejects oversize segment', () => {
    const big = 'x'.repeat(129);
    expect(() => encodePath(big)).toThrow(/segment exceeds/);
  });

  it('rejects oversize path', () => {
    const tooLong = 'a/' + 'x'.repeat(1024);
    expect(() => encodePath(tooLong)).toThrow(/path exceeds/);
  });

  it('rejects non-string', () => {
    // @ts-expect-error — intentionally bad input
    expect(() => encodePath(null)).toThrow(TypeError);
    // @ts-expect-error — intentionally bad input
    expect(() => encodePath(42)).toThrow(TypeError);
  });
});

describe('tryEncodePath', () => {
  it('returns the encoded path on success', () => {
    expect(tryEncodePath('calendar/2026-07-08')).toBe('calendar/2026-07-08');
  });
  it('returns null on failure', () => {
    expect(tryEncodePath('')).toBeNull();
    expect(tryEncodePath('a\\b')).toBeNull();
  });
});

describe('decodePath', () => {
  it('maps compound path to absolute file', () => {
    const abs = decodePath('calendar/2026-07-08', '/abs/notes');
    expect(abs).toBe(path.join('/abs/notes', 'calendar/2026-07-08.md'));
  });

  it('throws on invalid compound path', () => {
    expect(() => decodePath('a\\b', '/abs')).toThrow();
  });
});

describe('folderOf / leafOf', () => {
  it('extracts folder', () => {
    expect(folderOf('calendar/2026-07-08/standup')).toBe('calendar/2026-07-08');
    expect(folderOf('root')).toBe('');
  });
  it('extracts leaf', () => {
    expect(leafOf('calendar/2026-07-08/standup')).toBe('standup');
    expect(leafOf('root')).toBe('root');
  });
});

describe('cross-platform sanity', () => {
  it('produces OS-appropriate absolute paths', () => {
    const abs = decodePath('foo/bar', os.tmpdir());
    expect(path.isAbsolute(abs)).toBe(true);
    expect(abs.endsWith('foo/bar.md')).toBe(true);
  });
});