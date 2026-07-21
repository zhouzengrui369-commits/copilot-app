/**
 * KB type definitions.
 *
 * These types are the **frozen** cross-Sprint contract for Sprint 1.1 → 1.2 (KG
 * builder) → 1.3 (RAG). Any change must go through the PM change-request
 * channel; see `SCHEMA-FROZEN-1.1.md`.
 *
 * Two storage layers are kept in sync:
 *   1. `notes` table in SQLite (metadata, search indexes).
 *   2. `.md` files on disk (`md_path`), frontmatter parses JSON-able fields.
 */

export type NoteType =
  | 'article'
  | 'note'
  | 'meeting'
  | 'todo'
  | 'reference'
  | 'idea';

export type NoteStatus = 'draft' | 'active' | 'archived';

export interface Note {
  /** Auto-increment surrogate key. */
  id: number;
  /**
   * Compound path (URL-safe, `/`-separated). Examples:
   *   "calendar/2026-07-08/standup"
   *   "inbox/quick"
   *   "research/llm/rag"
   * UNIQUE. The disk file is `<root>/<path>.md`.
   */
  path: string;
  title: string;
  type: NoteType | null;
  status: NoteStatus | null;
  tags: string[];
  /** Related note paths. */
  related: string[];
  /** Top-level folder segment; "" for root-level notes. */
  folder: string;
  /** External content hash (mirrors v5 schema). */
  source_hash: string | null;
  /** Absolute path to the .md file on disk. */
  md_path: string;
  created_at: number;
  updated_at: number;
  confidence: number | null;
  /** Optional agent that produced the note. */
  agent: string | null;
}

export interface NoteInput {
  path: string;
  title: string;
  type?: NoteType | null;
  status?: NoteStatus | null;
  tags?: string[];
  related?: string[];
  folder?: string | null;
  source_hash?: string | null;
  confidence?: number | null;
  agent?: string | null;
  /** Markdown body. */
  body: string;
}

export interface NoteUpdate {
  title?: string;
  type?: NoteType | null;
  status?: NoteStatus | null;
  tags?: string[];
  related?: string[];
  source_hash?: string | null;
  confidence?: number | null;
  agent?: string | null;
  body?: string;
}

export interface NoteLink {
  from_path: string;
  to_path: string;
  rel: string | null;
}

export interface NoteLinkInput {
  from_path: string;
  to_path: string;
  rel?: string | null;
}

export type KgPendingStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface KgPendingEntry {
  note_path: string;
  status: KgPendingStatus;
  queued_at: number;
}

export interface ListFilter {
  type?: NoteType;
  status?: NoteStatus;
  /** Folder prefix (matches `folder == filter` AND `path LIKE 'filter/%'`). */
  folder?: string;
  /** Tag intersection: note must have ALL listed tags. */
  tags?: string[];
  /** Substring match against title/body/path (LIKE %q%). */
  query?: string;
  /** Updated-at range (inclusive). */
  updatedAfter?: number;
  updatedBefore?: number;
  limit?: number;
  offset?: number;
}

export interface ReadNoteResult {
  note: Note;
  body: string;
}

/**
 * A single "page" of notes plus total count (for pagination UI).
 */
export interface ListResult {
  items: Note[];
  total: number;
  limit: number;
  offset: number;
}

export type TrashKind = 'note' | 'todo';

export type TrashState =
  | 'prepared'
  | 'cleanup_pending'
  | 'trashed'
  | 'restoring'
  | 'restored'
  | 'purging'
  | 'purged';

/**
 * Durable metadata only. It deliberately contains no body, secret, or absolute
 * filesystem path. The Markdown bytes live under the private `.trash` root.
 */
export interface TrashEntry {
  trashId: string;
  kind: TrashKind;
  originalPath: string;
  originalRevision: string;
  trashRevision: string;
  metadataJson: string;
  contentSha256: string;
  idempotencyKey: string;
  inputSha256: string;
  state: TrashState;
  movedAt: number;
  restoredAt: number | null;
  purgedAt: number | null;
  cleanupAttempts: number;
  restoreIdempotencyKey: string | null;
  purgeIdempotencyKey: string | null;
  /** Durable single-writer lease. Empty only for migrated pre-r3 rows. */
  ownerId: string;
  leaseUntil: number;
  journalUpdatedAt: number;
  journalVersion: number;
}

export interface MoveNoteToTrashRequest {
  kind: TrashKind;
  path: string;
  expectedRevision: string;
  idempotencyKey: string;
}

export interface RestoreTrashRequest {
  trashId: string;
  expectedRevision: string;
  idempotencyKey: string;
}

export interface PurgeTrashRequest extends RestoreTrashRequest {}

export type TrashFaultPoint =
  | 'after_intent'
  | 'before_move_rename'
  | 'after_rename'
  | 'before_move_finalize'
  | 'after_finalize'
  | 'after_restore_intent'
  | 'before_restore_rename'
  | 'after_restore_rename'
  | 'before_restore_finalize'
  | 'after_restore_finalize'
  | 'after_purge_intent'
  | 'before_purge_delete'
  | 'after_purge_delete'
  | 'before_purge_finalize'
  | 'after_purge_finalize';

export type TrashErrorCode =
  | 'TRASH_INVALID_ARGUMENT'
  | 'TRASH_NOT_FOUND'
  | 'TRASH_REVISION_CONFLICT'
  | 'TRASH_IDEMPOTENCY_CONFLICT'
  | 'TRASH_FILE_UNSAFE'
  | 'TRASH_RESTORE_CONFLICT'
  | 'TRASH_RECOVERY_REQUIRED';

export class TrashError extends Error {
  constructor(public readonly code: TrashErrorCode) {
    super(code);
    this.name = 'TrashError';
  }
}
