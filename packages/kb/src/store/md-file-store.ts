/**
 * MD file store — persists note bodies on disk + parses gray-matter frontmatter.
 *
 * Schema mirrors `sqlite-store.ts`. JSON-serializable fields (tags, related,
 * status, type, etc.) are duplicated into frontmatter so the `.md` file is
 * self-describing even when the SQLite index is missing (e.g. during migration
 * or sync).
 *
 * Crash safety: writes are atomic via write-to-temp + rename. A truncated
 * frontmatter is recoverable (we fall back to body-only).
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import type { NoteStatus, NoteType } from '../types.js';
import { TrashError } from '../types.js';
import { encodePath } from '../util/path-encoding.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FRONTMATTER_TYPES = new Set([
  'path',
  'title',
  'type',
  'status',
  'tags',
  'related',
  'folder',
  'source_hash',
  'confidence',
  'agent',
  'created_at',
  'updated_at',
]);

export interface Frontmatter {
  path: string;
  title: string;
  type?: NoteType | null;
  status?: NoteStatus | null;
  tags?: string[];
  related?: string[];
  folder?: string;
  source_hash?: string | null;
  confidence?: number | null;
  agent?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

export interface MdFileStoreOptions {
  /** Absolute root directory for note files. Created if missing. */
  rootDir: string;
}

export type MdBodyIntegrityCode =
  | 'KB_MD_BODY_PATH_INVALID'
  | 'KB_MD_BODY_OUTSIDE_ROOT'
  | 'KB_MD_BODY_MISSING'
  | 'KB_MD_BODY_SYMLINK'
  | 'KB_MD_BODY_NON_REGULAR'
  | 'KB_MD_BODY_UNREADABLE';

export class MdBodyIntegrityError extends Error {
  readonly code: MdBodyIntegrityCode;

  constructor(code: MdBodyIntegrityCode) {
    super(code);
    this.name = 'MdBodyIntegrityError';
    this.code = code;
  }
}

export type MdWriteIntegrityCode =
  | 'KB_MD_WRITE_PATH_INVALID'
  | 'KB_MD_WRITE_OUTSIDE_ROOT'
  | 'KB_MD_WRITE_PARENT_SYMLINK'
  | 'KB_MD_WRITE_PARENT_NON_DIRECTORY'
  | 'KB_MD_WRITE_TARGET_SYMLINK'
  | 'KB_MD_WRITE_TARGET_NON_REGULAR'
  | 'KB_MD_WRITE_UNAVAILABLE';

export class MdWriteIntegrityError extends Error {
  readonly code: MdWriteIntegrityCode;

  constructor(code: MdWriteIntegrityCode) {
    super(code);
    this.name = 'MdWriteIntegrityError';
    this.code = code;
  }
}

function atomicWriteFileSync(
  target: string,
  content: string,
  validateBoundary: () => void = () => undefined,
): void {
  const dir = path.dirname(target);
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    validateBoundary();
    descriptor = fs.openSync(
      tmp,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    validateBoundary();
    fs.renameSync(tmp, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      if (fs.lstatSync(tmp).isFile()) fs.unlinkSync(tmp);
    } catch {
      // Missing temp is the expected successful-rename state.
    }
  }
}

export class MdFileStore {
  readonly rootDir: string;
  private readonly canonicalRootDir: string;

  constructor(opts: MdFileStoreOptions) {
    this.rootDir = path.resolve(opts.rootDir);
    if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir, { recursive: true });
    this.canonicalRootDir = fs.realpathSync.native(this.rootDir);
  }

  /** Absolute path for a compound path. Does not check existence. */
  pathFor(compoundPath: string): string {
    return path.join(this.rootDir, `${encodePath(compoundPath)}.md`);
  }

  exists(compoundPath: string): boolean {
    return fs.existsSync(this.pathFor(compoundPath));
  }

  /**
   * Read + parse a note file. Returns null if the file does not exist.
   * Corrupt frontmatter degrades gracefully: body is preserved, frontmatter
   * fields default to {}.
   */
  read(compoundPath: string): ParsedNote | null {
    const target = this.pathFor(compoundPath);
    if (!fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, 'utf8');
    return parseRaw(raw);
  }

  /**
   * Fail-closed body read for a path loaded from SQLite.
   *
   * Persisted metadata can be damaged or externally modified, so every read
   * revalidates the compound path, canonical root containment, target type,
   * and final-file symlink boundary. Errors intentionally expose only a
   * stable code and never an absolute host path.
   */
  readPersisted(compoundPath: string): ParsedNote {
    const target = this.resolvePersistedTarget(compoundPath);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        target,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      if (!fs.fstatSync(descriptor).isFile()) failBodyIntegrity('KB_MD_BODY_NON_REGULAR');
      return parseRaw(fs.readFileSync(descriptor, 'utf8'));
    } catch (error) {
      if (error instanceof MdBodyIntegrityError) throw error;
      throw new MdBodyIntegrityError(mapFsBodyError(error));
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  /** Exact persisted bytes for digesting/moving after the full body boundary check. */
  readPersistedRaw(compoundPath: string): Buffer {
    const target = this.resolvePersistedTarget(compoundPath);
    return this.readSingleLinkRegularFile(target);
  }

  private resolvePersistedTarget(compoundPath: string): string {
    let normalized: string;
    try {
      normalized = encodePath(compoundPath);
    } catch {
      failBodyIntegrity('KB_MD_BODY_PATH_INVALID');
    }
    if (normalized !== compoundPath) failBodyIntegrity('KB_MD_BODY_PATH_INVALID');

    const lexicalTarget = path.resolve(this.canonicalRootDir, `${normalized}.md`);
    if (!isWithinRoot(this.canonicalRootDir, lexicalTarget)) {
      failBodyIntegrity('KB_MD_BODY_OUTSIDE_ROOT');
    }

    let targetStat: fs.Stats;
    try {
      targetStat = fs.lstatSync(lexicalTarget);
    } catch (error) {
      failBodyIntegrity(mapFsBodyError(error));
    }
    if (targetStat.isSymbolicLink()) failBodyIntegrity('KB_MD_BODY_SYMLINK');
    if (!targetStat.isFile()) failBodyIntegrity('KB_MD_BODY_NON_REGULAR');

    let canonicalTarget: string;
    try {
      canonicalTarget = fs.realpathSync.native(lexicalTarget);
    } catch (error) {
      failBodyIntegrity(mapFsBodyError(error));
    }
    if (!isWithinRoot(this.canonicalRootDir, canonicalTarget)) {
      failBodyIntegrity('KB_MD_BODY_OUTSIDE_ROOT');
    }
    return canonicalTarget;
  }

  /**
   * Write a note file (frontmatter + body). Atomic rename. Replaces any
   * existing file at the target path.
   */
  write(compoundPath: string, fm: Frontmatter, body: string): string {
    const cleanFm = sanitizeFrontmatter(fm);
    const raw = serializeRaw(cleanFm, body);
    const target = this.resolveWriteTarget(compoundPath);
    try {
      atomicWriteFileSync(target, raw, () => this.validateWriteBoundary(target));
    } catch (error) {
      if (error instanceof MdWriteIntegrityError) throw error;
      throw new MdWriteIntegrityError(mapFsWriteError(error));
    }
    this.validateWrittenTarget(target);
    return target;
  }

  private resolveWriteTarget(compoundPath: string): string {
    let normalized: string;
    try {
      normalized = encodePath(compoundPath);
    } catch {
      failWriteIntegrity('KB_MD_WRITE_PATH_INVALID');
    }
    if (normalized !== compoundPath) failWriteIntegrity('KB_MD_WRITE_PATH_INVALID');

    const segments = normalized.split('/');
    const leaf = segments.pop();
    if (!leaf) failWriteIntegrity('KB_MD_WRITE_PATH_INVALID');
    let current = this.canonicalRootDir;
    for (const segment of segments) {
      const next = path.join(current, segment);
      if (!isWithinRoot(this.canonicalRootDir, next)) {
        failWriteIntegrity('KB_MD_WRITE_OUTSIDE_ROOT');
      }
      current = this.ensureWriteDirectory(next);
    }
    const target = path.join(current, `${leaf}.md`);
    if (!isWithinRoot(this.canonicalRootDir, target)) {
      failWriteIntegrity('KB_MD_WRITE_OUTSIDE_ROOT');
    }
    this.validateWriteBoundary(target);
    return target;
  }

  private ensureWriteDirectory(directory: string): string {
    let entry: fs.Stats;
    try {
      entry = fs.lstatSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        failWriteIntegrity(mapFsWriteError(error));
      }
      try {
        fs.mkdirSync(directory, { mode: 0o700 });
        entry = fs.lstatSync(directory);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          failWriteIntegrity(mapFsWriteError(mkdirError));
        }
        entry = fs.lstatSync(directory);
      }
    }
    if (entry.isSymbolicLink()) failWriteIntegrity('KB_MD_WRITE_PARENT_SYMLINK');
    if (!entry.isDirectory()) failWriteIntegrity('KB_MD_WRITE_PARENT_NON_DIRECTORY');
    let canonical: string;
    try {
      canonical = fs.realpathSync.native(directory);
    } catch (error) {
      failWriteIntegrity(mapFsWriteError(error));
    }
    if (!isWithinRoot(this.canonicalRootDir, canonical)) {
      failWriteIntegrity('KB_MD_WRITE_OUTSIDE_ROOT');
    }
    return canonical;
  }

  private validateWriteBoundary(target: string): void {
    const parent = path.dirname(target);
    this.validateExistingWriteParents(parent);
    try {
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) failWriteIntegrity('KB_MD_WRITE_TARGET_SYMLINK');
      if (!targetStat.isFile()) failWriteIntegrity('KB_MD_WRITE_TARGET_NON_REGULAR');
    } catch (error) {
      if (error instanceof MdWriteIntegrityError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        failWriteIntegrity(mapFsWriteError(error));
      }
    }
  }

  private validateExistingWriteParents(parent: string): void {
    if (parent !== this.canonicalRootDir && !isWithinRoot(this.canonicalRootDir, parent)) {
      failWriteIntegrity('KB_MD_WRITE_OUTSIDE_ROOT');
    }
    const relative = path.relative(this.canonicalRootDir, parent);
    let current = this.canonicalRootDir;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      let entry: fs.Stats;
      try {
        entry = fs.lstatSync(current);
      } catch (error) {
        failWriteIntegrity(mapFsWriteError(error));
      }
      if (entry.isSymbolicLink()) failWriteIntegrity('KB_MD_WRITE_PARENT_SYMLINK');
      if (!entry.isDirectory()) failWriteIntegrity('KB_MD_WRITE_PARENT_NON_DIRECTORY');
      let canonical: string;
      try {
        canonical = fs.realpathSync.native(current);
      } catch (error) {
        failWriteIntegrity(mapFsWriteError(error));
      }
      if (!isWithinRoot(this.canonicalRootDir, canonical)) {
        failWriteIntegrity('KB_MD_WRITE_OUTSIDE_ROOT');
      }
      current = canonical;
    }
  }

  private validateWrittenTarget(target: string): void {
    this.validateWriteBoundary(target);
    try {
      if ((fs.lstatSync(target).mode & 0o777) !== 0o600 && process.platform !== 'win32') {
        fs.chmodSync(target, 0o600);
      }
    } catch (error) {
      if (error instanceof MdWriteIntegrityError) throw error;
      failWriteIntegrity(mapFsWriteError(error));
    }
  }

  /** Delete a note file. No-op if missing. */
  delete(compoundPath: string): boolean {
    const target = this.pathFor(compoundPath);
    if (!fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
  }

  /** Whether any active filesystem entry exists; callers must still validate it before use. */
  activeEntryExists(compoundPath: string): boolean {
    return fs.existsSync(this.pathFor(compoundPath));
  }

  trashPathFor(trashId: string): string {
    this.requireTrashId(trashId);
    return path.join(this.trashRoot(), `${trashId}.md`);
  }

  trashExists(trashId: string): boolean {
    const target = this.trashPathFor(trashId);
    if (!fs.existsSync(target)) return false;
    this.readSingleLinkRegularFile(target);
    return true;
  }

  readTrashRaw(trashId: string): Buffer {
    const target = this.trashPathFor(trashId);
    if (!fs.existsSync(target)) throw new TrashError('TRASH_NOT_FOUND');
    return this.readSingleLinkRegularFile(target);
  }

  /** Same-volume, no-overwrite move into an opaque hidden trash filename. */
  moveToTrash(compoundPath: string, trashId: string): void {
    const source = this.resolvePersistedTarget(compoundPath);
    this.readSingleLinkRegularFile(source);
    const target = this.trashPathFor(trashId);
    if (fs.existsSync(target)) throw new TrashError('TRASH_FILE_UNSAFE');
    try {
      fs.renameSync(source, target);
      this.readSingleLinkRegularFile(target);
      this.fsyncDirectory(path.dirname(source));
      this.fsyncDirectory(path.dirname(target));
      this.pruneEmptyParents(compoundPath);
    } catch (error) {
      if (error instanceof TrashError) throw error;
      throw new TrashError('TRASH_FILE_UNSAFE');
    }
  }

  /** Same-volume, no-overwrite restore to the original validated logical path. */
  restoreFromTrash(trashId: string, compoundPath: string): void {
    const source = this.trashPathFor(trashId);
    if (!fs.existsSync(source)) throw new TrashError('TRASH_NOT_FOUND');
    this.readSingleLinkRegularFile(source);
    const target = this.resolveWriteTarget(compoundPath);
    if (fs.existsSync(target)) throw new TrashError('TRASH_RESTORE_CONFLICT');
    try {
      fs.renameSync(source, target);
      this.validateWrittenTarget(target);
      this.fsyncDirectory(path.dirname(source));
      this.fsyncDirectory(path.dirname(target));
    } catch (error) {
      if (error instanceof TrashError) throw error;
      throw new TrashError('TRASH_FILE_UNSAFE');
    }
  }

  purgeTrash(trashId: string): boolean {
    const target = this.trashPathFor(trashId);
    if (!fs.existsSync(target)) return false;
    this.readSingleLinkRegularFile(target);
    try {
      fs.unlinkSync(target);
      this.fsyncDirectory(path.dirname(target));
      return true;
    } catch {
      throw new TrashError('TRASH_FILE_UNSAFE');
    }
  }

  private trashRoot(): string {
    const target = path.join(this.canonicalRootDir, '.trash');
    try {
      if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe');
      if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
        fs.chmodSync(target, 0o700);
        const privateStat = fs.lstatSync(target);
        if (privateStat.isSymbolicLink() || !privateStat.isDirectory() || (privateStat.mode & 0o777) !== 0o700) {
          throw new Error('unsafe permissions');
        }
      }
      const canonical = fs.realpathSync.native(target);
      if (!isWithinRoot(this.canonicalRootDir, canonical)) throw new Error('outside');
      return canonical;
    } catch {
      throw new TrashError('TRASH_FILE_UNSAFE');
    }
  }

  private requireTrashId(trashId: string): void {
    if (!UUID_V4.test(trashId)) throw new TrashError('TRASH_INVALID_ARGUMENT');
  }

  private readSingleLinkRegularFile(target: string): Buffer {
    let descriptor: number | undefined;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        throw new TrashError('TRASH_FILE_UNSAFE');
      }
      descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const openStat = fs.fstatSync(descriptor);
      if (!openStat.isFile() || openStat.nlink !== 1) throw new TrashError('TRASH_FILE_UNSAFE');
      return fs.readFileSync(descriptor);
    } catch (error) {
      if (error instanceof TrashError) throw error;
      throw new TrashError('TRASH_FILE_UNSAFE');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  private fsyncDirectory(directory: string): void {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      fs.fsyncSync(descriptor);
    } catch {
      // Windows does not consistently allow directory handles. The atomic
      // same-volume rename remains authoritative there and is proven live later.
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  /** Walk the root dir and yield all (relativePath, absolutePath) pairs. */
  listAll(): Array<{ compoundPath: string; absolutePath: string }> {
    const out: Array<{ compoundPath: string; absolutePath: string }> = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // skip hidden / temp files
        const abs = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(abs, rel);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          out.push({ compoundPath: rel.replace(/\.md$/, ''), absolutePath: abs });
        }
      }
    };
    walk(this.rootDir, '');
    return out;
  }

  /** Remove empty parent directories up to rootDir. */
  pruneEmptyParents(compoundPath: string): void {
    const target = this.pathFor(compoundPath);
    let dir = path.dirname(target);
    const stop = path.resolve(this.rootDir);
    while (path.resolve(dir) !== stop && fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
}

// ─── parse helpers ──────────────────────────────────────────────────────────

function parseRaw(raw: string): ParsedNote {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    // corrupt frontmatter — treat the whole file as body
    return { frontmatter: { path: '', title: '' }, body: raw };
  }
  const fm: Frontmatter = { path: '', title: '' };
  for (const [k, v] of Object.entries(parsed.data ?? {})) {
    if (!FRONTMATTER_TYPES.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (k === 'tags' || k === 'related') {
      if (Array.isArray(v)) {
        (fm as unknown as Record<string, unknown>)[k] = v.map(String);
      }
      continue;
    }
    (fm as unknown as Record<string, unknown>)[k] = v;
  }
  // Body without frontmatter fences.
  const body = parsed.content ?? '';
  return { frontmatter: fm, body };
}

function serializeRaw(fm: Frontmatter, body: string): string {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue;
    payload[k] = v;
  }
  return matter.stringify(body, payload);
}

function sanitizeFrontmatter(fm: Frontmatter): Frontmatter {
  const out: Frontmatter = {
    path: fm.path,
    title: fm.title,
  };
  if (fm.type !== undefined) out.type = fm.type;
  if (fm.status !== undefined) out.status = fm.status;
  if (fm.tags !== undefined) out.tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
  if (fm.related !== undefined) out.related = Array.isArray(fm.related) ? fm.related.map(String) : [];
  if (fm.folder !== undefined) out.folder = fm.folder;
  if (fm.source_hash !== undefined) out.source_hash = fm.source_hash;
  if (fm.confidence !== undefined) out.confidence = fm.confidence;
  if (fm.agent !== undefined) out.agent = fm.agent;
  if (fm.created_at !== undefined) out.created_at = fm.created_at;
  if (fm.updated_at !== undefined) out.updated_at = fm.updated_at;
  return out;
}

/** Export the helpers for tests / migration code. */
export const _internal = {
  parseRaw,
  serializeRaw,
  sanitizeFrontmatter,
  atomicWriteFileSync,
};

// Re-export os for callers that want the platform temp dir (used in tests).
export { os };

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function mapFsBodyError(error: unknown): MdBodyIntegrityCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'KB_MD_BODY_MISSING';
  if (code === 'ELOOP') return 'KB_MD_BODY_SYMLINK';
  if (code === 'EISDIR' || code === 'ENOTDIR') return 'KB_MD_BODY_NON_REGULAR';
  return 'KB_MD_BODY_UNREADABLE';
}

function failBodyIntegrity(code: MdBodyIntegrityCode): never {
  throw new MdBodyIntegrityError(code);
}

function mapFsWriteError(error: unknown): MdWriteIntegrityCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ELOOP') return 'KB_MD_WRITE_PARENT_SYMLINK';
  if (code === 'ENOTDIR') return 'KB_MD_WRITE_PARENT_NON_DIRECTORY';
  if (code === 'EISDIR') return 'KB_MD_WRITE_TARGET_NON_REGULAR';
  return 'KB_MD_WRITE_UNAVAILABLE';
}

function failWriteIntegrity(code: MdWriteIntegrityCode): never {
  throw new MdWriteIntegrityError(code);
}
