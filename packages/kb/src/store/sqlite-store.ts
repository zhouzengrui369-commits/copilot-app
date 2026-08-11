/**
 * SQLite metadata store for the local KB.
 *
 * - better-sqlite3 (synchronous API) — strong typing + zero callback overhead.
 * - WAL mode enabled for concurrent reads while a write is in flight.
 * - Schema is `v0`; migrations are append-only via `src/api/migration.ts`.
 *
 * The store is the **source of truth for metadata**. The `.md` files on disk
 * are derived from this metadata + body text. See `md-file-store.ts`.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  KgPendingEntry,
  KgPendingStatus,
  Note,
  NoteInput,
  NoteLink,
  NoteLinkInput,
  NoteStatus,
  NoteType,
  TrashEntry,
  TrashKind,
  TrashState,
} from '../types.js';

const SCHEMA_VERSION = 0;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type TEXT,
  status TEXT,
  tags TEXT,
  related TEXT,
  folder TEXT,
  source_hash TEXT,
  md_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confidence REAL,
  agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);

CREATE TABLE IF NOT EXISTS note_links (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  rel TEXT,
  PRIMARY KEY (from_path, to_path)
);

CREATE TABLE IF NOT EXISTS kg_pending (
  note_path TEXT PRIMARY KEY,
  status TEXT,
  queued_at INTEGER
);
`;

interface NoteRow {
  id: number;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  tags: string | null;
  related: string | null;
  folder: string | null;
  source_hash: string | null;
  md_path: string;
  created_at: number;
  updated_at: number;
  confidence: number | null;
  agent: string | null;
}

interface TrashRow {
  trash_id: string;
  kind: TrashKind;
  original_path: string;
  original_revision: string;
  trash_revision: string;
  metadata_json: string;
  content_sha256: string;
  idempotency_key: string;
  input_sha256: string;
  state: TrashState;
  moved_at: number;
  restored_at: number | null;
  purged_at: number | null;
  cleanup_attempts: number;
  restore_idempotency_key: string | null;
  purge_idempotency_key: string | null;
  owner_id: string;
  lease_until: number;
  journal_updated_at: number;
  journal_version: number;
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    type: (row.type as NoteType | null) ?? null,
    status: (row.status as NoteStatus | null) ?? null,
    tags: parseJsonArray(row.tags),
    related: parseJsonArray(row.related),
    folder: row.folder ?? '',
    source_hash: row.source_hash,
    md_path: row.md_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confidence: row.confidence,
    agent: row.agent,
  };
}

function rowToTrash(row: TrashRow): TrashEntry {
  return {
    trashId: row.trash_id,
    kind: row.kind,
    originalPath: row.original_path,
    originalRevision: row.original_revision,
    trashRevision: row.trash_revision,
    metadataJson: row.metadata_json,
    contentSha256: row.content_sha256,
    idempotencyKey: row.idempotency_key,
    inputSha256: row.input_sha256,
    state: row.state,
    movedAt: row.moved_at,
    restoredAt: row.restored_at,
    purgedAt: row.purged_at,
    cleanupAttempts: row.cleanup_attempts,
    restoreIdempotencyKey: row.restore_idempotency_key,
    purgeIdempotencyKey: row.purge_idempotency_key,
    ownerId: row.owner_id,
    leaseUntil: row.lease_until,
    journalUpdatedAt: row.journal_updated_at,
    journalVersion: row.journal_version,
  };
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface SqliteStoreOptions {
  /** Absolute path to the SQLite file. The parent dir is created if missing. */
  dbPath: string;
  /** Explicit runtime-specific better-sqlite3 addon. Omit for the host default. */
  nativeBinding?: string;
  /** When true (default), set `PRAGMA journal_mode=WAL`. */
  wal?: boolean;
  /**
   * When true (default), apply the v0 schema on open if missing.
   * Set to false for read-only inspection.
   */
  migrate?: boolean;
}

export class SqliteStore {
  private db: DatabaseType;
  private closed = false;

  constructor(opts: SqliteStoreOptions) {
    const { dbPath, nativeBinding, wal = true, migrate = true } = opts;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = nativeBinding === undefined
      ? new Database(dbPath)
      : new Database(dbPath, { nativeBinding });
    if (wal) this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    if (migrate) {
      this.db.exec(SCHEMA_SQL);
      this.ensureSchemaVersion();
    }
  }

  /** Internal: handle to native binding (used by migration / tests). */
  get raw(): DatabaseType {
    return this.db;
  }

  get schemaVersion(): number {
    const row = this.db
      .prepare<[], { v: string }>(`SELECT v FROM schema_meta WHERE k='version'`)
      .get();
    return row ? Number(row.v) : SCHEMA_VERSION;
  }

  private ensureSchemaVersion(): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO schema_meta (k, v) VALUES ('version', ?)`)
      .run(String(SCHEMA_VERSION));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // ──────────────────────────────────────────────────────────────────────
  // notes CRUD
  // ──────────────────────────────────────────────────────────────────────

  insertNote(input: NoteInput, mdPath: string, now: number): Note {
    const tagsJson = JSON.stringify(input.tags ?? []);
    const relatedJson = JSON.stringify(input.related ?? []);
    const stmt = this.db.prepare(`
      INSERT INTO notes (
        path, title, type, status, tags, related, folder,
        source_hash, md_path, created_at, updated_at, confidence, agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      input.path,
      input.title,
      input.type ?? null,
      input.status ?? null,
      tagsJson,
      relatedJson,
      input.folder ?? '',
      input.source_hash ?? null,
      mdPath,
      now,
      now,
      input.confidence ?? null,
      input.agent ?? null,
    );
    const row = this.db
      .prepare<[number | bigint], NoteRow>(`SELECT * FROM notes WHERE id = ?`)
      .get(info.lastInsertRowid);
    if (!row) throw new Error('SqliteStore.insertNote: row missing after insert');
    return rowToNote(row);
  }

  getNoteByPath(path: string): Note | null {
    const row = this.db
      .prepare<[string], NoteRow>(`SELECT * FROM notes WHERE path = ?`)
      .get(path);
    return row ? rowToNote(row) : null;
  }

  getNoteById(id: number): Note | null {
    const row = this.db
      .prepare<[number], NoteRow>(`SELECT * FROM notes WHERE id = ?`)
      .get(id);
    return row ? rowToNote(row) : null;
  }

  listAllNotes(): Note[] {
    const rows = this.db
      .prepare<[], NoteRow>(`SELECT * FROM notes ORDER BY updated_at DESC`)
      .all();
    return rows.map(rowToNote);
  }

  countNotes(): number {
    const row = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM notes`)
      .get();
    return row?.c ?? 0;
  }

  updateNote(
    path: string,
    patch: {
      title?: string;
      type?: NoteType | null;
      status?: NoteStatus | null;
      tags?: string[];
      related?: string[];
      source_hash?: string | null;
      confidence?: number | null;
      agent?: string | null;
    },
    now: number,
  ): Note | null {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      args.push(patch.title);
    }
    if (patch.type !== undefined) {
      sets.push('type = ?');
      args.push(patch.type);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      args.push(patch.status);
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      args.push(JSON.stringify(patch.tags));
    }
    if (patch.related !== undefined) {
      sets.push('related = ?');
      args.push(JSON.stringify(patch.related));
    }
    if (patch.source_hash !== undefined) {
      sets.push('source_hash = ?');
      args.push(patch.source_hash);
    }
    if (patch.confidence !== undefined) {
      sets.push('confidence = ?');
      args.push(patch.confidence);
    }
    if (patch.agent !== undefined) {
      sets.push('agent = ?');
      args.push(patch.agent);
    }
    if (sets.length === 0) return this.getNoteByPath(path);
    sets.push('updated_at = ?');
    args.push(now);
    args.push(path);
    const sql = `UPDATE notes SET ${sets.join(', ')} WHERE path = ?`;
    const info = this.db.prepare(sql).run(...args);
    if (info.changes === 0) return null;
    return this.getNoteByPath(path);
  }

  deleteNoteByPath(path: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM notes WHERE path = ?`)
      .run(path);
    return info.changes > 0;
  }

  // ──────────────────────────────────────────────────────────────────────
  // reversible trash journal (schema v1)
  // ──────────────────────────────────────────────────────────────────────

  insertTrashIntent(entry: TrashEntry): TrashEntry {
    this.db.prepare(`
      INSERT INTO trash_entries (
        trash_id, kind, original_path, original_revision, trash_revision,
        metadata_json, content_sha256, idempotency_key, input_sha256, state,
        moved_at, restored_at, purged_at, cleanup_attempts,
        restore_idempotency_key, purge_idempotency_key, owner_id,
        lease_until, journal_updated_at, journal_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.trashId,
      entry.kind,
      entry.originalPath,
      entry.originalRevision,
      entry.trashRevision,
      entry.metadataJson,
      entry.contentSha256,
      entry.idempotencyKey,
      entry.inputSha256,
      entry.state,
      entry.movedAt,
      entry.restoredAt,
      entry.purgedAt,
      entry.cleanupAttempts,
      entry.restoreIdempotencyKey,
      entry.purgeIdempotencyKey,
      entry.ownerId,
      entry.leaseUntil,
      entry.journalUpdatedAt,
      entry.journalVersion,
    );
    return this.getTrashById(entry.trashId)!;
  }

  getTrashById(trashId: string): TrashEntry | null {
    const row = this.db.prepare<[string], TrashRow>(
      `SELECT * FROM trash_entries WHERE trash_id = ?`,
    ).get(trashId);
    return row ? rowToTrash(row) : null;
  }

  getTrashByIdempotencyKey(idempotencyKey: string): TrashEntry | null {
    const row = this.db.prepare<[string], TrashRow>(
      `SELECT * FROM trash_entries WHERE idempotency_key = ?`,
    ).get(idempotencyKey);
    return row ? rowToTrash(row) : null;
  }

  listTrashEntries(states?: readonly TrashState[]): TrashEntry[] {
    if (states?.length) {
      const placeholders = states.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM trash_entries WHERE state IN (${placeholders}) ORDER BY moved_at ASC, trash_id ASC`,
      ).all(...states) as TrashRow[];
      return rows.map(rowToTrash);
    }
    const rows = this.db.prepare<[], TrashRow>(
      `SELECT * FROM trash_entries ORDER BY moved_at ASC, trash_id ASC`,
    ).all();
    return rows.map(rowToTrash);
  }

  acquireTrashLease(input: {
    trashId: string;
    ownerId: string;
    now: number;
    leaseUntil: number;
  }): TrashEntry | null {
    const tx = this.db.transaction(() => {
      const entry = this.getTrashById(input.trashId);
      if (!entry) return false;
      if (entry.ownerId !== input.ownerId && entry.leaseUntil > input.now) return false;
      const result = this.db.prepare(`
        UPDATE trash_entries
        SET owner_id = ?, lease_until = ?, journal_updated_at = ?,
            journal_version = journal_version + 1
        WHERE trash_id = ? AND journal_version = ?
          AND (owner_id = ? OR lease_until <= ?)
      `).run(
        input.ownerId,
        input.leaseUntil,
        input.now,
        input.trashId,
        entry.journalVersion,
        input.ownerId,
        input.now,
      );
      return result.changes === 1;
    });
    return tx() ? this.getTrashById(input.trashId) : null;
  }

  releaseTrashLeases(ownerId: string, now: number): void {
    this.db.prepare(`
      UPDATE trash_entries
      SET lease_until = ?, journal_updated_at = ?, journal_version = journal_version + 1
      WHERE owner_id = ? AND lease_until > ?
    `).run(now, now, ownerId, now);
  }

  deletePreparedTrashOwned(trashId: string, ownerId: string, journalVersion: number): boolean {
    const info = this.db.prepare(`
      DELETE FROM trash_entries
      WHERE trash_id = ? AND state = 'prepared' AND owner_id = ? AND journal_version = ?
    `).run(trashId, ownerId, journalVersion);
    return info.changes > 0;
  }

  finalizeTrashMove(input: {
    trashId: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry {
    const tx = this.db.transaction(() => {
      const entry = this.getTrashById(input.trashId);
      if (!entry) throw new Error('TRASH_NOT_FOUND');
      if (
        entry.state !== 'prepared'
        || entry.ownerId !== input.ownerId
        || entry.journalVersion !== input.journalVersion
      ) throw new Error('TRASH_RECOVERY_REQUIRED');
      const active = this.getNoteByPath(entry.originalPath);
      const activeRevision = active ? `${entry.kind}:${active.updated_at}` : null;
      if (activeRevision !== entry.originalRevision) throw new Error('TRASH_REVISION_CONFLICT');
      this.db.prepare(`DELETE FROM note_links WHERE from_path = ? OR to_path = ?`)
        .run(entry.originalPath, entry.originalPath);
      this.db.prepare(`DELETE FROM kg_pending WHERE note_path = ?`).run(entry.originalPath);
      this.db.prepare(`DELETE FROM notes WHERE path = ?`).run(entry.originalPath);
      const result = this.db.prepare(`
        UPDATE trash_entries
        SET state = 'cleanup_pending', lease_until = ?, journal_updated_at = ?,
            journal_version = journal_version + 1
        WHERE trash_id = ? AND state = 'prepared' AND owner_id = ? AND journal_version = ?
      `).run(input.leaseUntil, input.now, input.trashId, input.ownerId, input.journalVersion);
      if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    });
    tx();
    return this.getTrashById(input.trashId)!;
  }

  markTrashCleanOwned(input: {
    trashId: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry | null {
    const result = this.db.prepare(`
      UPDATE trash_entries
      SET state = CASE WHEN state = 'cleanup_pending' THEN 'trashed' ELSE state END,
          cleanup_attempts = cleanup_attempts + CASE WHEN state = 'cleanup_pending' THEN 1 ELSE 0 END,
          lease_until = ?, journal_updated_at = ?, journal_version = journal_version + 1
      WHERE trash_id = ? AND state IN ('cleanup_pending', 'trashed')
        AND owner_id = ? AND journal_version = ?
    `).run(input.leaseUntil, input.now, input.trashId, input.ownerId, input.journalVersion);
    if (result.changes !== 1) return null;
    return this.getTrashById(input.trashId);
  }

  beginTrashRestore(input: {
    trashId: string;
    idempotencyKey: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry {
    const tx = this.db.transaction(() => {
      const entry = this.getTrashById(input.trashId);
      if (!entry) throw new Error('TRASH_NOT_FOUND');
      if (entry.restoreIdempotencyKey && entry.restoreIdempotencyKey !== input.idempotencyKey) {
        throw new Error('TRASH_IDEMPOTENCY_CONFLICT');
      }
      if (
        entry.state !== 'trashed'
        || entry.ownerId !== input.ownerId
        || entry.journalVersion !== input.journalVersion
      ) throw new Error('TRASH_RECOVERY_REQUIRED');
      const result = this.db.prepare(`
        UPDATE trash_entries
        SET state = 'restoring', restore_idempotency_key = ?, lease_until = ?,
            journal_updated_at = ?, journal_version = journal_version + 1
        WHERE trash_id = ? AND state = 'trashed' AND owner_id = ? AND journal_version = ?
      `).run(
        input.idempotencyKey,
        input.leaseUntil,
        input.now,
        input.trashId,
        input.ownerId,
        input.journalVersion,
      );
      if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    });
    tx();
    return this.getTrashById(input.trashId)!;
  }

  rollbackTrashRestoreOwned(input: {
    trashId: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry {
    const result = this.db.prepare(`
      UPDATE trash_entries
      SET state = 'trashed', lease_until = ?, journal_updated_at = ?, journal_version = journal_version + 1
      WHERE trash_id = ? AND state = 'restoring' AND owner_id = ? AND journal_version = ?
    `).run(input.leaseUntil, input.now, input.trashId, input.ownerId, input.journalVersion);
    if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    return this.getTrashById(input.trashId)!;
  }

  finalizeTrashRestore(input: {
    trashId: string;
    note: Omit<Note, 'id' | 'md_path'>;
    mdPath: string;
    restoredAt: number;
    ownerId: string;
    journalVersion: number;
    leaseUntil: number;
  }): TrashEntry {
    const tx = this.db.transaction(() => {
      const entry = this.getTrashById(input.trashId);
      if (!entry) throw new Error('TRASH_NOT_FOUND');
      if (
        entry.state !== 'restoring'
        || entry.ownerId !== input.ownerId
        || entry.journalVersion !== input.journalVersion
      ) throw new Error('TRASH_RECOVERY_REQUIRED');
      if (this.getNoteByPath(input.note.path)) throw new Error('TRASH_RESTORE_CONFLICT');
      this.db.prepare(`
        INSERT INTO notes (
          path, title, type, status, tags, related, folder, source_hash,
          md_path, created_at, updated_at, confidence, agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.note.path,
        input.note.title,
        input.note.type,
        input.note.status,
        JSON.stringify(input.note.tags),
        JSON.stringify(input.note.related),
        input.note.folder,
        input.note.source_hash,
        input.mdPath,
        input.note.created_at,
        input.note.updated_at,
        input.note.confidence,
        input.note.agent,
      );
      this.db.prepare(`INSERT OR REPLACE INTO kg_pending (note_path, status, queued_at) VALUES (?, 'pending', ?)`)
        .run(input.note.path, input.restoredAt);
      // Keep the durable journal in `restoring` until LocalKnowledgeService has
      // rebuilt both KG and RAG. Startup can therefore retry a crashed/failed
      // restore-index pass instead of exposing a false completed state.
      const result = this.db.prepare(`
        UPDATE trash_entries
        SET restored_at = ?, lease_until = ?, journal_updated_at = ?, journal_version = journal_version + 1
        WHERE trash_id = ? AND state = 'restoring' AND owner_id = ? AND journal_version = ?
      `).run(
        input.restoredAt,
        input.leaseUntil,
        input.restoredAt,
        input.trashId,
        input.ownerId,
        input.journalVersion,
      );
      if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    });
    tx();
    return this.getTrashById(input.trashId)!;
  }

  markTrashRestoredOwned(input: {
    trashId: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry | null {
    const result = this.db.prepare(`
      UPDATE trash_entries
      SET state = 'restored', lease_until = ?, journal_updated_at = ?, journal_version = journal_version + 1
      WHERE trash_id = ? AND state = 'restoring' AND owner_id = ? AND journal_version = ?
    `).run(input.leaseUntil, input.now, input.trashId, input.ownerId, input.journalVersion);
    if (result.changes !== 1) return null;
    return this.getTrashById(input.trashId);
  }

  beginTrashPurge(input: {
    trashId: string;
    idempotencyKey: string;
    ownerId: string;
    journalVersion: number;
    now: number;
    leaseUntil: number;
  }): TrashEntry {
    const tx = this.db.transaction(() => {
      const entry = this.getTrashById(input.trashId);
      if (!entry) throw new Error('TRASH_NOT_FOUND');
      if (entry.purgeIdempotencyKey && entry.purgeIdempotencyKey !== input.idempotencyKey) {
        throw new Error('TRASH_IDEMPOTENCY_CONFLICT');
      }
      if (
        entry.state !== 'trashed'
        || entry.ownerId !== input.ownerId
        || entry.journalVersion !== input.journalVersion
      ) throw new Error('TRASH_RECOVERY_REQUIRED');
      const result = this.db.prepare(`
        UPDATE trash_entries
        SET state = 'purging', purge_idempotency_key = ?, lease_until = ?,
            journal_updated_at = ?, journal_version = journal_version + 1
        WHERE trash_id = ? AND state = 'trashed' AND owner_id = ? AND journal_version = ?
      `).run(
        input.idempotencyKey,
        input.leaseUntil,
        input.now,
        input.trashId,
        input.ownerId,
        input.journalVersion,
      );
      if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    });
    tx();
    return this.getTrashById(input.trashId)!;
  }

  finalizeTrashPurge(input: {
    trashId: string;
    ownerId: string;
    journalVersion: number;
    purgedAt: number;
    leaseUntil: number;
  }): TrashEntry {
    const result = this.db.prepare(`
      UPDATE trash_entries
      SET state = 'purged', purged_at = ?, metadata_json = '{}', lease_until = ?,
          journal_updated_at = ?, journal_version = journal_version + 1
      WHERE trash_id = ? AND state = 'purging' AND owner_id = ? AND journal_version = ?
    `).run(
      input.purgedAt,
      input.leaseUntil,
      input.purgedAt,
      input.trashId,
      input.ownerId,
      input.journalVersion,
    );
    if (result.changes !== 1) throw new Error('TRASH_RECOVERY_REQUIRED');
    return this.getTrashById(input.trashId)!;
  }

  // ──────────────────────────────────────────────────────────────────────
  // note_links
  // ──────────────────────────────────────────────────────────────────────

  addLink(link: NoteLinkInput): NoteLink {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO note_links (from_path, to_path, rel) VALUES (?, ?, ?)`,
      )
      .run(link.from_path, link.to_path, link.rel ?? null);
    return { ...link, rel: link.rel ?? null };
  }

  removeLink(from_path: string, to_path: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM note_links WHERE from_path = ? AND to_path = ?`)
      .run(from_path, to_path);
    return info.changes > 0;
  }

  linksFrom(from_path: string): NoteLink[] {
    const rows = this.db
      .prepare<[string], { from_path: string; to_path: string; rel: string | null }>(
        `SELECT from_path, to_path, rel FROM note_links WHERE from_path = ?`,
      )
      .all(from_path);
    return rows.map((r) => ({ from_path: r.from_path, to_path: r.to_path, rel: r.rel }));
  }

  linksTo(to_path: string): NoteLink[] {
    const rows = this.db
      .prepare<[string], { from_path: string; to_path: string; rel: string | null }>(
        `SELECT from_path, to_path, rel FROM note_links WHERE to_path = ?`,
      )
      .all(to_path);
    return rows.map((r) => ({ from_path: r.from_path, to_path: r.to_path, rel: r.rel }));
  }

  // ──────────────────────────────────────────────────────────────────────
  // kg_pending — Sprint 1.2 reads this to feed the KG builder
  // ──────────────────────────────────────────────────────────────────────

  queueKg(note_path: string, now: number, status: KgPendingStatus = 'pending'): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kg_pending (note_path, status, queued_at) VALUES (?, ?, ?)`,
      )
      .run(note_path, status, now);
  }

  setKgStatus(note_path: string, status: KgPendingStatus): void {
    this.db
      .prepare(`UPDATE kg_pending SET status = ? WHERE note_path = ?`)
      .run(status, note_path);
  }

  listKgPending(status?: KgPendingStatus): KgPendingEntry[] {
    const rows = status
      ? this.db
          .prepare<[string], { note_path: string; status: string; queued_at: number }>(
            `SELECT note_path, status, queued_at FROM kg_pending WHERE status = ? ORDER BY queued_at ASC`,
          )
          .all(status)
      : this.db
          .prepare<[], { note_path: string; status: string; queued_at: number }>(
            `SELECT note_path, status, queued_at FROM kg_pending ORDER BY queued_at ASC`,
          )
          .all();
    return rows.map((r) => ({
      note_path: r.note_path,
      status: r.status as KgPendingStatus,
      queued_at: r.queued_at,
    }));
  }

  removeKgPending(note_path: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM kg_pending WHERE note_path = ?`)
      .run(note_path);
    return info.changes > 0;
  }
}
