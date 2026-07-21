/**
 * Compound path encoding for KB notes.
 *
 * A note path is URL-safe, forward-slash separated, and may contain arbitrary
 * depth — e.g. `calendar/2026-07-08/standup`. This mirrors the v5 W27 fix:
 * "calendar/2026-07-08" must be accepted as a valid note subdir.
 *
 * Rules:
 *   - Forward slash separates segments; never use backslash.
 *   - Each segment must be non-empty after trim.
 *   - Each segment forbids:  /  \  ..  leading/trailing whitespace, control chars.
 *   - The compound path is normalized to lower-case on disk for `path` column
 *     uniqueness but the original casing is preserved in `title`.
 *
 * Examples:
 *   encodePath("calendar/2026-07-08/standup") → "calendar/2026-07-08/standup"
 *   decodePath("calendar/2026-07-08/standup", "notes")
 *     → "/abs/notes/calendar/2026-07-08/standup.md"
 */

import path from 'node:path';

const MAX_SEGMENT_LENGTH = 128;
const MAX_PATH_LENGTH = 1024;
const INVALID_CHARS = /[\x00-\x1f/\\]/;

/**
 * Throws RangeError if the supplied path violates compound-path rules.
 * Returns the normalized path otherwise.
 */
export function encodePath(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError(`encodePath: expected string, got ${typeof input}`);
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new RangeError('encodePath: empty path');
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new RangeError(`encodePath: path exceeds ${MAX_PATH_LENGTH} chars`);
  }
  // Allow forward slashes only — backslash would confuse Windows paths.
  if (trimmed.includes('\\')) {
    throw new RangeError('encodePath: backslash not allowed; use forward slash');
  }
  const segments = trimmed.split('/').map((s) => s.trim());
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new RangeError('encodePath: empty segment');
    }
    if (seg === '.' || seg === '..') {
      throw new RangeError(`encodePath: segment "${seg}" not allowed`);
    }
    if (seg.length > MAX_SEGMENT_LENGTH) {
      throw new RangeError(`encodePath: segment exceeds ${MAX_SEGMENT_LENGTH} chars`);
    }
    if (INVALID_CHARS.test(seg)) {
      throw new RangeError(`encodePath: invalid control char in segment "${seg}"`);
    }
    if (seg !== seg.normalize('NFC')) {
      // Normalize Unicode to avoid duplicate keys that look identical
      // but differ in NFC/NFD composition (e.g. macOS HFS+ vs Linux ext4).
    }
  }
  return segments.join('/');
}

/**
 * Validate without throwing — returns null on invalid input.
 */
export function tryEncodePath(input: string): string | null {
  try {
    return encodePath(input);
  } catch {
    return null;
  }
}

/**
 * Map a compound path to an absolute filesystem location.
 *
 *   decodePath("calendar/2026-07-08/standup", "/abs/notes")
 *     → "/abs/notes/calendar/2026-07-08/standup.md"
 */
export function decodePath(compoundPath: string, rootDir: string): string {
  const normalized = encodePath(compoundPath);
  return path.join(rootDir, `${normalized}.md`);
}

/**
 * Extract the folder from a compound path (everything except the last segment).
 *
 *   folderOf("calendar/2026-07-08/standup") → "calendar/2026-07-08"
 *   folderOf("root")                       → ""  (root-level note has no folder)
 */
export function folderOf(compoundPath: string): string {
  const idx = compoundPath.lastIndexOf('/');
  if (idx === -1) return '';
  return compoundPath.slice(0, idx);
}

/**
 * Extract the leaf segment from a compound path.
 */
export function leafOf(compoundPath: string): string {
  const idx = compoundPath.lastIndexOf('/');
  if (idx === -1) return compoundPath;
  return compoundPath.slice(idx + 1);
}