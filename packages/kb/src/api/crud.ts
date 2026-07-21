/**
 * CRUD + search API on top of `SqliteStore` + `MdFileStore`.
 *
 * Persistence model:
 *   - `createNote` / `updateNote` / `deleteNote` write the `.md` file first,
 *     then commit the SQLite metadata row inside the same call. If the
 *     SQLite write fails, the on-disk file is rolled back (best-effort).
 *   - `readNote` returns metadata + body from the SQLite row, but always
 *     re-reads the body from disk so concurrent edits are picked up.
 *
 * Public API:
 *   - createNote, readNote, updateNote, deleteNote, listNotes, searchNotes
 *   - addLink, removeLink, listLinks
 *   - queueKg, listKgPending
 */

import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type {
  KgPendingStatus,
  ListFilter,
  ListResult,
  Note,
  NoteInput,
  NoteLink,
  NoteLinkInput,
  NoteUpdate,
  ReadNoteResult,
  MoveNoteToTrashRequest,
  PurgeTrashRequest,
  RestoreTrashRequest,
  TrashEntry,
  TrashFaultPoint,
  TrashKind,
  TrashState,
} from '../types.js';
import { TrashError } from '../types.js';
import { encodePath, folderOf } from '../util/path-encoding.js';
import type { SqliteStore } from '../store/sqlite-store.js';
import type { MdFileStore } from '../store/md-file-store.js';
import type { Frontmatter } from '../store/md-file-store.js';
import { runMigrations } from './migration.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface KbClientOptions {
  sqlite: SqliteStore;
  md: MdFileStore;
  /** Clock injection (default Date.now). Useful for tests. */
  clock?: () => number;
  uuid?: () => string;
  /** Deterministic crash-point injection used only by hermetic recovery tests. */
  trashFault?: (point: TrashFaultPoint) => void;
  /** Durable single-writer identity; defaults to a fresh process-local UUID. */
  ownerId?: string;
  /** Recovery lease duration. Defaults to 30 seconds. */
  trashLeaseMs?: number;
}

interface TrashMetadataV2 {
  schemaVersion: 2;
  note: Omit<Note, 'id' | 'md_path'>;
}

const SYSTEM_TODO_PREFIX = 'system/todos/';
const SYSTEM_TODO_TAG = '__copilot_todo__';
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const TRASH_METADATA_KEYS = ['note', 'schemaVersion'] as const;
const TRASH_NOTE_KEYS = [
  'agent', 'confidence', 'created_at', 'folder', 'path', 'related',
  'source_hash', 'status', 'tags', 'title', 'type', 'updated_at',
] as const;

interface ListNoteRow {
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

export class KbClient {
  private readonly sqlite: SqliteStore;
  private readonly md: MdFileStore;
  private readonly clock: () => number;
  private readonly uuid: () => string;
  private readonly trashFault: (point: TrashFaultPoint) => void;
  private readonly ownerId: string;
  private readonly trashLeaseMs: number;

  constructor(opts: KbClientOptions) {
    this.sqlite = opts.sqlite;
    this.md = opts.md;
    this.clock = opts.clock ?? Date.now;
    this.uuid = opts.uuid ?? randomUUID;
    this.trashFault = opts.trashFault ?? (() => undefined);
    this.ownerId = opts.ownerId ?? randomUUID();
    this.trashLeaseMs = opts.trashLeaseMs ?? 30_000;
    if (!UUID_V4.test(this.ownerId) || !Number.isSafeInteger(this.trashLeaseMs) || this.trashLeaseMs < 1_000) {
      failTrash('TRASH_INVALID_ARGUMENT');
    }
    runMigrations(this.sqlite);
    this.reconcileTrash();
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────────────

  createNote(input: NoteInput): Note {
    const compoundPath = encodePath(input.path);
    if (this.sqlite.getNoteByPath(compoundPath)) {
      throw new Error(`createNote: path already exists: ${compoundPath}`);
    }
    if (this.md.exists(compoundPath)) {
      throw new Error(`createNote: md file already exists: ${compoundPath}`);
    }
    const now = this.clock();
    const folder = input.folder ?? folderOf(compoundPath);
    const mdPath = this.md.pathFor(compoundPath);
    const fm: Frontmatter = {
      path: compoundPath,
      title: input.title,
      type: input.type ?? null,
      status: input.status ?? null,
      tags: input.tags ?? [],
      related: input.related ?? [],
      folder,
      source_hash: input.source_hash ?? null,
      confidence: input.confidence ?? null,
      agent: input.agent ?? null,
      created_at: now,
      updated_at: now,
    };
    this.md.write(compoundPath, fm, input.body);
    try {
      const note = this.sqlite.insertNote(
        { ...input, path: compoundPath, folder },
        mdPath,
        now,
      );
      this.sqlite.queueKg(compoundPath, now, 'pending');
      return note;
    } catch (err) {
      // Roll back the on-disk file so we don't leak orphans.
      try {
        this.md.delete(compoundPath);
        this.md.pruneEmptyParents(compoundPath);
      } catch {
        // ignore — best-effort
      }
      throw err;
    }
  }

  readNote(path: string): ReadNoteResult | null {
    const compoundPath = encodePath(path);
    const note = this.sqlite.getNoteByPath(compoundPath);
    if (!note) return null;
    const body = this.md.readPersisted(note.path).body;
    return { note, body };
  }

  updateNote(path: string, patch: NoteUpdate): Note | null {
    const compoundPath = encodePath(path);
    const existing = this.sqlite.getNoteByPath(compoundPath);
    if (!existing) return null;
    const persistedBody = this.md.readPersisted(existing.path).body;
    const now = this.clock();
    // Re-write the .md file with the merged frontmatter + new body.
    const fm: Frontmatter = {
      path: existing.path,
      title: patch.title ?? existing.title,
      type: patch.type !== undefined ? patch.type : existing.type,
      status: patch.status !== undefined ? patch.status : existing.status,
      tags: patch.tags ?? existing.tags,
      related: patch.related ?? existing.related,
      folder: existing.folder,
      source_hash:
        patch.source_hash !== undefined ? patch.source_hash : existing.source_hash,
      confidence:
        patch.confidence !== undefined ? patch.confidence : existing.confidence,
      agent: patch.agent !== undefined ? patch.agent : existing.agent,
      created_at: existing.created_at,
      updated_at: now,
    };
    const body = patch.body ?? persistedBody;
    this.md.write(compoundPath, fm, body);
    const updated = this.sqlite.updateNote(
      compoundPath,
      {
        title: fm.title,
        type: fm.type ?? null,
        status: fm.status ?? null,
        tags: fm.tags,
        related: fm.related,
        source_hash: fm.source_hash,
        confidence: fm.confidence,
        agent: fm.agent,
      },
      now,
    );
    if (updated) {
      // Re-queue for KG re-indexing whenever tags/related/title change.
      this.sqlite.queueKg(compoundPath, now, 'pending');
    }
    return updated;
  }

  deleteNote(path: string): boolean {
    const compoundPath = encodePath(path);
    const existing = this.sqlite.getNoteByPath(compoundPath);
    if (!existing) return false;
    const removed = this.sqlite.deleteNoteByPath(compoundPath);
    this.md.delete(compoundPath);
    this.md.pruneEmptyParents(compoundPath);
    this.sqlite.removeKgPending(compoundPath);
    return removed;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Reversible trash (schema v1)
  // ──────────────────────────────────────────────────────────────────────

  moveNoteToTrash(request: MoveNoteToTrashRequest): TrashEntry {
    const normalized = normalizeMoveRequest(request);
    const input = {
      expectedRevision: normalized.expectedRevision,
      idempotencyKey: normalized.idempotencyKey,
      kind: normalized.kind,
      path: normalized.path,
    } as const;
    const prior = this.sqlite.getTrashByIdempotencyKey(normalized.idempotencyKey);
    if (prior) {
      if (
        prior.originalPath !== normalized.path
        || prior.originalRevision !== normalized.expectedRevision
        || prior.kind !== normalized.kind
      ) failTrash('TRASH_IDEMPOTENCY_CONFLICT');
      if (prior.state !== 'purged') {
        this.validateTrashMetadataBinding(prior);
        if (
          (prior.state === 'cleanup_pending' || prior.state === 'trashed')
          && !this.trashContentMatches(prior)
        ) failTrash('TRASH_RECOVERY_REQUIRED');
        if (
          (prior.state === 'restoring' || prior.state === 'restored')
          && this.sqlite.getNoteByPath(prior.originalPath)
          && !this.activeContentMatches(prior)
        ) failTrash('TRASH_RECOVERY_REQUIRED');
      }
      if (prior.state === 'prepared') {
        // A prepared row observed from an ordinary request may still belong to
        // another process. Only startup reconciliation may discard an intent.
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
      return this.sqlite.getTrashById(prior.trashId)!;
    }

    const existing = this.sqlite.getNoteByPath(normalized.path);
    if (!existing) failTrash('TRASH_NOT_FOUND');
    validateTrashKind(normalized.kind, existing);
    validateTrashNoteMetadata(noteMetadata(existing), normalized.path);
    const actualRevision = revisionFor(normalized.kind, existing.updated_at);
    if (actualRevision !== normalized.expectedRevision) failTrash('TRASH_REVISION_CONFLICT');

    let raw: Buffer;
    try {
      raw = this.md.readPersistedRaw(normalized.path);
    } catch (error) {
      throw mapTrashError(error, 'TRASH_FILE_UNSAFE');
    }
    const trashId = this.uuid();
    if (!UUID_V4.test(trashId)) failTrash('TRASH_INVALID_ARGUMENT');
    const movedAt = this.clock();
    const metadata: TrashMetadataV2 = {
      schemaVersion: 2,
      note: noteMetadata(existing),
    };
    const metadataJson = stableJson(metadata);
    const inputSha256 = digestJson({
      ...input,
      metadataSha256: createHash('sha256').update(metadataJson).digest('hex'),
    });
    let intent: TrashEntry = {
      trashId,
      kind: normalized.kind,
      originalPath: normalized.path,
      originalRevision: actualRevision,
      trashRevision: `trash:${trashId}:${movedAt}`,
      metadataJson,
      contentSha256: createHash('sha256').update(raw).digest('hex'),
      idempotencyKey: normalized.idempotencyKey,
      inputSha256,
      state: 'prepared',
      movedAt,
      restoredAt: null,
      purgedAt: null,
      cleanupAttempts: 0,
      restoreIdempotencyKey: null,
      purgeIdempotencyKey: null,
      ownerId: this.ownerId,
      leaseUntil: movedAt + this.trashLeaseMs,
      journalUpdatedAt: movedAt,
      journalVersion: 1,
    };
    try {
      this.sqlite.insertTrashIntent(intent);
    } catch (error) {
      const raced = this.sqlite.getTrashByIdempotencyKey(normalized.idempotencyKey);
      if (raced) {
        if (
          raced.inputSha256 === inputSha256
          && raced.originalPath === normalized.path
          && raced.originalRevision === normalized.expectedRevision
          && raced.kind === normalized.kind
        ) {
          if (raced.state === 'prepared') failTrash('TRASH_RECOVERY_REQUIRED');
          return raced;
        }
      }
      throw mapTrashError(error, 'TRASH_IDEMPOTENCY_CONFLICT');
    }
    this.trashFault('after_intent');

    try {
      this.trashFault('before_move_rename');
      intent = this.renewTrashLease(intent);
      if (!this.activeContentMatches(intent)) {
        if (!this.sqlite.deletePreparedTrashOwned(intent.trashId, this.ownerId, intent.journalVersion)) {
          failTrash('TRASH_RECOVERY_REQUIRED');
        }
        failTrash('TRASH_FILE_UNSAFE');
      }
      this.md.moveToTrash(normalized.path, trashId);
    } catch (error) {
      if (this.md.activeEntryExists(normalized.path) && !safeTrashExists(this.md, trashId)) {
        this.sqlite.deletePreparedTrashOwned(trashId, this.ownerId, intent.journalVersion);
      }
      throw mapTrashError(error, 'TRASH_FILE_UNSAFE');
    }
    this.trashFault('after_rename');
    if (!this.trashContentMatches(intent)) {
      this.rollbackPreparedMove(intent);
      failTrash('TRASH_FILE_UNSAFE');
    }
    let finalized: TrashEntry;
    try {
      this.trashFault('before_move_finalize');
      intent = this.renewTrashLease(intent);
      if (!this.trashContentMatches(intent)) {
        this.rollbackPreparedMove(intent);
        failTrash('TRASH_FILE_UNSAFE');
      }
      const now = this.clock();
      finalized = this.sqlite.finalizeTrashMove({
        trashId,
        ownerId: this.ownerId,
        journalVersion: intent.journalVersion,
        now,
        leaseUntil: now + this.trashLeaseMs,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code.includes('TRASH_REVISION_CONFLICT')) {
        try {
          this.md.restoreFromTrash(trashId, normalized.path);
          if (!this.sqlite.deletePreparedTrashOwned(trashId, this.ownerId, intent.journalVersion)) {
            failTrash('TRASH_RECOVERY_REQUIRED');
          }
        } catch {
          failTrash('TRASH_RECOVERY_REQUIRED');
        }
        failTrash('TRASH_REVISION_CONFLICT');
      }
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
    this.trashFault('after_finalize');
    return finalized;
  }

  readTrash(states?: readonly TrashState[]): TrashEntry[] {
    return this.sqlite.listTrashEntries(states);
  }

  markTrashClean(trashId: string): TrashEntry {
    requireUuid(trashId);
    let current = this.sqlite.getTrashById(trashId);
    if (!current) failTrash('TRASH_NOT_FOUND');
    current = this.renewTrashLease(current);
    if (
      (current.state !== 'cleanup_pending' && current.state !== 'trashed')
      || this.md.activeEntryExists(current.originalPath)
      || !this.trashContentMatches(current)
    ) failTrash('TRASH_RECOVERY_REQUIRED');
    this.validateTrashMetadataBinding(current);
    const now = this.clock();
    const entry = this.sqlite.markTrashCleanOwned({
      trashId,
      ownerId: this.ownerId,
      journalVersion: current.journalVersion,
      now,
      leaseUntil: now + this.trashLeaseMs,
    });
    if (!entry) failTrash('TRASH_NOT_FOUND');
    return entry;
  }

  restoreTrash(request: RestoreTrashRequest): TrashEntry {
    const normalized = normalizeTrashAction(request);
    let entry = this.sqlite.getTrashById(normalized.trashId);
    if (!entry) failTrash('TRASH_NOT_FOUND');
    if (entry.trashRevision !== normalized.expectedRevision) failTrash('TRASH_REVISION_CONFLICT');
    if (entry.state !== 'purged') this.validateTrashMetadataBinding(entry);
    if (entry.state === 'restored' && entry.restoreIdempotencyKey === normalized.idempotencyKey) return entry;
    if (entry.restoreIdempotencyKey && entry.restoreIdempotencyKey !== normalized.idempotencyKey) {
      failTrash('TRASH_IDEMPOTENCY_CONFLICT');
    }
    if (entry.state === 'restoring' && entry.restoreIdempotencyKey === normalized.idempotencyKey) {
      entry = this.renewTrashLease(entry);
      this.reconcileTrashEntry(entry);
      return this.sqlite.getTrashById(entry.trashId)!;
    }
    if (entry.state !== 'trashed') failTrash('TRASH_RECOVERY_REQUIRED');
    if (this.sqlite.getNoteByPath(entry.originalPath) || this.md.activeEntryExists(entry.originalPath)) {
      failTrash('TRASH_RESTORE_CONFLICT');
    }
    if (!this.trashContentMatches(entry)) failTrash('TRASH_FILE_UNSAFE');
    try {
      entry = this.renewTrashLease(entry);
      const now = this.clock();
      entry = this.sqlite.beginTrashRestore({
        trashId: entry.trashId,
        idempotencyKey: normalized.idempotencyKey,
        ownerId: this.ownerId,
        journalVersion: entry.journalVersion,
        now,
        leaseUntil: now + this.trashLeaseMs,
      });
    } catch (error) {
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
    if (entry.state === 'restored') return entry;
    this.trashFault('after_restore_intent');
    try {
      this.trashFault('before_restore_rename');
      entry = this.renewTrashLease(entry);
      if (!this.trashContentMatches(entry)) failTrash('TRASH_FILE_UNSAFE');
      this.md.restoreFromTrash(entry.trashId, entry.originalPath);
    } catch (error) {
      if (safeTrashExists(this.md, entry.trashId) && !this.md.activeEntryExists(entry.originalPath)) {
        this.rollbackRestoreJournal(entry);
      }
      throw mapTrashError(error, 'TRASH_FILE_UNSAFE');
    }
    this.trashFault('after_restore_rename');
    if (!this.activeContentMatches(entry)) {
      this.rollbackRestoreFile(entry);
      failTrash('TRASH_FILE_UNSAFE');
    }
    try {
      this.trashFault('before_restore_finalize');
      entry = this.renewTrashLease(entry);
      if (!this.activeContentMatches(entry)) {
        this.rollbackRestoreFile(entry);
        failTrash('TRASH_FILE_UNSAFE');
      }
      const finalized = this.finalizeRestore(entry, this.clock());
      this.trashFault('after_restore_finalize');
      return finalized;
    } catch (error) {
      const current = this.sqlite.getTrashById(entry.trashId);
      // A fault after SQLite reinsert deliberately leaves `restoring` durable
      // for LocalKnowledgeService startup re-index. Roll back only when no
      // active metadata row was committed.
      if (current?.state === 'restoring' && !this.sqlite.getNoteByPath(entry.originalPath)) {
        this.rollbackRestoreFile(entry);
      }
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
  }

  /** Mark restore complete only after the desktop rebuilt both KG and RAG. */
  markTrashRestored(trashId: string): TrashEntry {
    requireUuid(trashId);
    let entry = this.sqlite.getTrashById(trashId);
    if (!entry) failTrash('TRASH_NOT_FOUND');
    if (entry.state === 'restored') {
      this.validateTrashMetadataBinding(entry);
      if (!this.activeContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
      return entry;
    }
    if (entry.state !== 'restoring' || !this.sqlite.getNoteByPath(entry.originalPath)) {
      failTrash('TRASH_RECOVERY_REQUIRED');
    }
    entry = this.renewTrashLease(entry);
    if (safeTrashExists(this.md, trashId) || !this.activeContentMatches(entry)) {
      failTrash('TRASH_RECOVERY_REQUIRED');
    }
    this.validateTrashMetadataBinding(entry);
    const now = this.clock();
    const completed = this.sqlite.markTrashRestoredOwned({
      trashId,
      ownerId: this.ownerId,
      journalVersion: entry.journalVersion,
      now,
      leaseUntil: now + this.trashLeaseMs,
    });
    if (!completed) failTrash('TRASH_NOT_FOUND');
    return completed;
  }

  purgeTrash(request: PurgeTrashRequest): TrashEntry {
    const normalized = normalizeTrashAction(request);
    let entry = this.sqlite.getTrashById(normalized.trashId);
    if (!entry) failTrash('TRASH_NOT_FOUND');
    if (entry.trashRevision !== normalized.expectedRevision) failTrash('TRASH_REVISION_CONFLICT');
    if (entry.state === 'purged' && entry.purgeIdempotencyKey === normalized.idempotencyKey) return entry;
    if (entry.purgeIdempotencyKey && entry.purgeIdempotencyKey !== normalized.idempotencyKey) {
      failTrash('TRASH_IDEMPOTENCY_CONFLICT');
    }
    if (entry.state !== 'purged') {
      this.validateTrashMetadataBinding(entry);
      if (entry.state === 'trashed' && !this.trashContentMatches(entry)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
      if (entry.state === 'purging' && safeTrashExists(this.md, entry.trashId) && !this.trashContentMatches(entry)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
    }
    try {
      entry = this.renewTrashLease(entry);
      const now = this.clock();
      entry = this.sqlite.beginTrashPurge({
        trashId: entry.trashId,
        idempotencyKey: normalized.idempotencyKey,
        ownerId: this.ownerId,
        journalVersion: entry.journalVersion,
        now,
        leaseUntil: now + this.trashLeaseMs,
      });
    } catch (error) {
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
    if (entry.state === 'purged') return entry;
    this.trashFault('after_purge_intent');
    this.trashFault('before_purge_delete');
    entry = this.renewTrashLease(entry);
    if (!this.trashContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
    this.md.purgeTrash(entry.trashId);
    this.trashFault('after_purge_delete');
    this.trashFault('before_purge_finalize');
    entry = this.renewTrashLease(entry);
    if (safeTrashExists(this.md, entry.trashId)) failTrash('TRASH_RECOVERY_REQUIRED');
    const now = this.clock();
    const purged = this.sqlite.finalizeTrashPurge({
      trashId: entry.trashId,
      ownerId: this.ownerId,
      journalVersion: entry.journalVersion,
      purgedAt: now,
      leaseUntil: now + this.trashLeaseMs,
    });
    this.trashFault('after_purge_finalize');
    return purged;
  }

  /** Resolve durable partial file/SQLite operations before serving reads. */
  reconcileTrash(): TrashEntry[] {
    for (const entry of this.sqlite.listTrashEntries()) {
      if (entry.state === 'trashed' || entry.state === 'restored' || entry.state === 'purged') {
        this.reconcileTrashEntry(entry);
        continue;
      }
      const claimed = this.tryAcquireTrashLease(entry);
      if (claimed) this.reconcileTrashEntry(claimed);
    }
    return this.sqlite.listTrashEntries();
  }

  private reconcileTrashEntry(entry: TrashEntry): void {
    const active = this.md.activeEntryExists(entry.originalPath);
    const trash = safeTrashExists(this.md, entry.trashId);
    switch (entry.state) {
      case 'prepared':
        if (active && !trash) {
          if (!this.sqlite.deletePreparedTrashOwned(entry.trashId, this.ownerId, entry.journalVersion)) {
            failTrash('TRASH_RECOVERY_REQUIRED');
          }
          return;
        }
        if (!active && trash) {
          if (!this.trashContentMatches(entry)) {
            this.rollbackPreparedMove(entry);
            return;
          }
          this.validateTrashMetadataBinding(entry);
          const now = this.clock();
          this.sqlite.finalizeTrashMove({
            trashId: entry.trashId,
            ownerId: this.ownerId,
            journalVersion: entry.journalVersion,
            now,
            leaseUntil: now + this.trashLeaseMs,
          });
          return;
        }
        failTrash('TRASH_RECOVERY_REQUIRED');
      case 'cleanup_pending':
      case 'trashed':
        if (!active && trash && this.trashContentMatches(entry)) {
          this.validateTrashMetadataBinding(entry);
          return;
        }
        failTrash('TRASH_RECOVERY_REQUIRED');
      case 'restoring':
        if (!active && trash) {
          if (!this.trashContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
          this.validateTrashMetadataBinding(entry);
          this.rollbackRestoreJournal(entry);
          return;
        }
        if (active && !trash && !this.sqlite.getNoteByPath(entry.originalPath)) {
          this.finalizeRestore(entry, this.clock());
          return;
        }
        if (active && !trash && this.sqlite.getNoteByPath(entry.originalPath)) {
          this.validateTrashMetadataBinding(entry);
          if (!this.activeContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
          return;
        }
        failTrash('TRASH_RECOVERY_REQUIRED');
      case 'purging':
        this.validateTrashMetadataBinding(entry);
        if (trash) {
          if (!this.trashContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
          this.md.purgeTrash(entry.trashId);
        }
        if (safeTrashExists(this.md, entry.trashId)) failTrash('TRASH_RECOVERY_REQUIRED');
        {
          const now = this.clock();
          this.sqlite.finalizeTrashPurge({
            trashId: entry.trashId,
            ownerId: this.ownerId,
            journalVersion: entry.journalVersion,
            purgedAt: now,
            leaseUntil: now + this.trashLeaseMs,
          });
        }
        return;
      case 'restored':
        if (active && !trash && this.sqlite.getNoteByPath(entry.originalPath)) {
          this.validateTrashMetadataBinding(entry);
          if (!this.activeContentMatches(entry)) failTrash('TRASH_RECOVERY_REQUIRED');
          return;
        }
        failTrash('TRASH_RECOVERY_REQUIRED');
      case 'purged':
        if (!trash) return;
        failTrash('TRASH_RECOVERY_REQUIRED');
    }
  }

  private finalizeRestore(entry: TrashEntry, restoredAt: number): TrashEntry {
    const metadata = parseTrashMetadata(entry.metadataJson, entry);
    const raw = this.md.readPersistedRaw(entry.originalPath);
    const actualDigest = createHash('sha256').update(raw).digest('hex');
    if (actualDigest !== entry.contentSha256) failTrash('TRASH_FILE_UNSAFE');
    try {
      return this.sqlite.finalizeTrashRestore({
        trashId: entry.trashId,
        note: metadata.note,
        mdPath: this.md.pathFor(entry.originalPath),
        restoredAt,
        ownerId: this.ownerId,
        journalVersion: entry.journalVersion,
        leaseUntil: restoredAt + this.trashLeaseMs,
      });
    } catch (error) {
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
  }

  private validateTrashMetadataBinding(entry: TrashEntry): TrashMetadataV2 {
    const metadata = parseTrashMetadata(entry.metadataJson, entry);
    validateTrashKind(entry.kind, metadata.note, 'TRASH_RECOVERY_REQUIRED');
    const expectedInputSha256 = digestJson({
      expectedRevision: entry.originalRevision,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      path: entry.originalPath,
      metadataSha256: createHash('sha256').update(entry.metadataJson).digest('hex'),
    });
    if (entry.inputSha256 !== expectedInputSha256) failTrash('TRASH_RECOVERY_REQUIRED');
    return metadata;
  }

  private tryAcquireTrashLease(entry: TrashEntry): TrashEntry | null {
    const now = this.clock();
    return this.sqlite.acquireTrashLease({
      trashId: entry.trashId,
      ownerId: this.ownerId,
      now,
      leaseUntil: now + this.trashLeaseMs,
    });
  }

  private renewTrashLease(entry: TrashEntry): TrashEntry {
    const owned = this.tryAcquireTrashLease(entry);
    if (!owned) failTrash('TRASH_RECOVERY_REQUIRED');
    return owned;
  }

  private rollbackRestoreJournal(entry: TrashEntry): TrashEntry {
    const now = this.clock();
    return this.sqlite.rollbackTrashRestoreOwned({
      trashId: entry.trashId,
      ownerId: this.ownerId,
      journalVersion: entry.journalVersion,
      now,
      leaseUntil: now + this.trashLeaseMs,
    });
  }

  private trashContentMatches(entry: TrashEntry): boolean {
    try {
      const actual = createHash('sha256').update(this.md.readTrashRaw(entry.trashId)).digest('hex');
      return actual === entry.contentSha256;
    } catch {
      return false;
    }
  }

  private activeContentMatches(entry: TrashEntry): boolean {
    try {
      const actual = createHash('sha256').update(this.md.readPersistedRaw(entry.originalPath)).digest('hex');
      return actual === entry.contentSha256;
    } catch {
      return false;
    }
  }

  private rollbackPreparedMove(entry: TrashEntry): void {
    try {
      if (this.md.activeEntryExists(entry.originalPath) || !safeTrashExists(this.md, entry.trashId)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
      this.md.restoreFromTrash(entry.trashId, entry.originalPath);
      if (!this.md.activeEntryExists(entry.originalPath) || safeTrashExists(this.md, entry.trashId)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
      if (!this.sqlite.deletePreparedTrashOwned(entry.trashId, this.ownerId, entry.journalVersion)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
    } catch (error) {
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
  }

  private rollbackRestoreFile(entry: TrashEntry): void {
    try {
      if (!this.md.activeEntryExists(entry.originalPath) || safeTrashExists(this.md, entry.trashId)) {
        failTrash('TRASH_RECOVERY_REQUIRED');
      }
      this.md.moveToTrash(entry.originalPath, entry.trashId);
      this.rollbackRestoreJournal(entry);
    } catch (error) {
      throw mapTrashError(error, 'TRASH_RECOVERY_REQUIRED');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // List / search
  // ──────────────────────────────────────────────────────────────────────

  listNotes(filter: ListFilter = {}): ListResult {
    const limit = clamp(filter.limit ?? 100, 1, 1000);
    const offset = Math.max(0, filter.offset ?? 0);
    const where: string[] = [];
    const args: unknown[] = [];

    if (filter.type) {
      where.push('type = ?');
      args.push(filter.type);
    }
    if (filter.status) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.folder !== undefined) {
      if (filter.folder === '') {
        where.push("(folder IS NULL OR folder = '')");
      } else {
        where.push('(folder = ? OR path LIKE ?)');
        args.push(filter.folder, `${filter.folder}/%`);
      }
    }
    if (filter.updatedAfter !== undefined) {
      where.push('updated_at >= ?');
      args.push(filter.updatedAfter);
    }
    if (filter.updatedBefore !== undefined) {
      where.push('updated_at <= ?');
      args.push(filter.updatedBefore);
    }
    // Tag filter: stored as JSON array — match against serialized form.
    if (filter.tags && filter.tags.length > 0) {
      for (const t of filter.tags) {
        where.push(`tags LIKE ?`);
        args.push(`%"${t}"%`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let total: number;
    let rows: ListNoteRow[];
    if (filter.query) {
      const needle = filter.query.toLowerCase();
      const candidates = this.sqlite.raw
        .prepare(`SELECT * FROM notes ${whereSql} ORDER BY updated_at DESC`)
        .all(...args) as ListNoteRow[];
      const matches = candidates.filter((row) => {
        const body = this.md.readPersisted(row.path).body;
        return row.title.toLowerCase().includes(needle)
          || row.path.toLowerCase().includes(needle)
          || body.toLowerCase().includes(needle);
      });
      total = matches.length;
      rows = matches.slice(offset, offset + limit);
    } else {
      const totalRow = this.sqlite.raw
        .prepare(`SELECT COUNT(*) AS c FROM notes ${whereSql}`)
        .get(...args) as { c: number } | undefined;
      total = totalRow?.c ?? 0;
      rows = this.sqlite.raw
        .prepare(
          `SELECT * FROM notes ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset) as ListNoteRow[];
    }

    const items: Note[] = rows.map((r) => ({
      id: r.id,
      path: r.path,
      title: r.title,
      type: (r.type as Note['type']) ?? null,
      status: (r.status as Note['status']) ?? null,
      tags: parseArr(r.tags),
      related: parseArr(r.related),
      folder: r.folder ?? '',
      source_hash: r.source_hash,
      md_path: r.md_path,
      created_at: r.created_at,
      updated_at: r.updated_at,
      confidence: r.confidence,
      agent: r.agent,
    }));

    return { items, total, limit, offset };
  }

  searchNotes(query: string, opts: { limit?: number; tags?: string[] } = {}): ListResult {
    return this.listNotes({ query, tags: opts.tags, limit: opts.limit });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Links
  // ──────────────────────────────────────────────────────────────────────

  addLink(link: NoteLinkInput): NoteLink {
    const from = encodePath(link.from_path);
    const to = encodePath(link.to_path);
    return this.sqlite.addLink({ from_path: from, to_path: to, rel: link.rel ?? null });
  }

  removeLink(from_path: string, to_path: string): boolean {
    return this.sqlite.removeLink(encodePath(from_path), encodePath(to_path));
  }

  listLinks(path: string): { out: NoteLink[]; in: NoteLink[] } {
    const compoundPath = encodePath(path);
    return {
      out: this.sqlite.linksFrom(compoundPath),
      in: this.sqlite.linksTo(compoundPath),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // KG pending queue — read by Sprint 1.2 builder
  // ──────────────────────────────────────────────────────────────────────

  queueKg(path: string, status: KgPendingStatus = 'pending'): void {
    this.sqlite.queueKg(encodePath(path), this.clock(), status);
  }

  listKgPending(status?: KgPendingStatus) {
    return this.sqlite.listKgPending(status);
  }

  setKgStatus(path: string, status: KgPendingStatus): void {
    this.sqlite.setKgStatus(encodePath(path), status);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Maintenance
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Scan the MD root and align any orphan / missing rows. Useful after a
   * crash or restore-from-backup.
   */
  reconcile(): { added: Note[]; removed: string[] } {
    const onDisk = new Map<string, string>();
    for (const f of this.md.listAll()) onDisk.set(f.compoundPath, f.absolutePath);
    const inDb = new Map<string, Note>();
    for (const n of this.sqlite.listAllNotes()) inDb.set(n.path, n);

    const added: Note[] = [];
    for (const [p, abs] of onDisk) {
      if (inDb.has(p)) continue;
      const parsed = this.md.read(p);
      const body = parsed?.body ?? '';
      const fm = parsed?.frontmatter ?? { path: p, title: p };
      const note = this.sqlite.insertNote(
        {
          path: p,
          title: fm.title || p,
          type: fm.type ?? null,
          status: fm.status ?? null,
          tags: fm.tags ?? [],
          related: fm.related ?? [],
          folder: fm.folder ?? folderOf(p),
          source_hash: fm.source_hash ?? null,
          confidence: fm.confidence ?? null,
          agent: fm.agent ?? null,
          body,
        },
        abs,
        this.clock(),
      );
      added.push(note);
    }

    const removed: string[] = [];
    for (const p of inDb.keys()) {
      if (!onDisk.has(p)) {
        if (this.sqlite.deleteNoteByPath(p)) removed.push(p);
      }
    }
    return { added, removed };
  }

  /** Close underlying SQLite handle. */
  close(): void {
    this.sqlite.releaseTrashLeases(this.ownerId, this.clock());
    this.sqlite.close();
  }
}

function parseArr(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

// Re-export for symmetry / convenience.
export { fs };

function normalizeMoveRequest(request: MoveNoteToTrashRequest): MoveNoteToTrashRequest {
  if (!request || (request.kind !== 'note' && request.kind !== 'todo')) failTrash('TRASH_INVALID_ARGUMENT');
  const path = encodePath(request.path);
  if (request.kind === 'todo' ? !path.startsWith('system/todos/') : path.startsWith('system/todos/')) {
    failTrash('TRASH_INVALID_ARGUMENT');
  }
  requireUuid(request.idempotencyKey);
  if (typeof request.expectedRevision !== 'string' || request.expectedRevision.length > 160) {
    failTrash('TRASH_INVALID_ARGUMENT');
  }
  return { ...request, path };
}

function normalizeTrashAction<T extends RestoreTrashRequest>(request: T): T {
  if (!request) failTrash('TRASH_INVALID_ARGUMENT');
  requireUuid(request.trashId);
  requireUuid(request.idempotencyKey);
  if (typeof request.expectedRevision !== 'string' || request.expectedRevision.length > 200) {
    failTrash('TRASH_INVALID_ARGUMENT');
  }
  return request;
}

function requireUuid(value: string): void {
  if (typeof value !== 'string' || !UUID_V4.test(value)) failTrash('TRASH_INVALID_ARGUMENT');
}

function revisionFor(kind: TrashKind, updatedAt: number): string {
  return `${kind}:${updatedAt}`;
}

function noteMetadata(note: Note): Omit<Note, 'id' | 'md_path'> {
  const { id: _id, md_path: _mdPath, ...metadata } = note;
  return metadata;
}

function parseTrashMetadata(raw: string, entry: TrashEntry): TrashMetadataV2 {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isExactRecord(value, TRASH_METADATA_KEYS) || value.schemaVersion !== 2) {
      failTrash('TRASH_RECOVERY_REQUIRED');
    }
    if (raw !== stableJson(value)) failTrash('TRASH_RECOVERY_REQUIRED');
    const note = validateTrashNoteMetadata(value.note, entry.originalPath);
    return { schemaVersion: 2, note };
  } catch (error) {
    if (error instanceof TrashError) throw error;
    failTrash('TRASH_RECOVERY_REQUIRED');
  }
}

function validateTrashKind(
  kind: TrashKind,
  note: Omit<Note, 'id' | 'md_path'> | Note,
  errorCode: ConstructorParameters<typeof TrashError>[0] = 'TRASH_INVALID_ARGUMENT',
): void {
  const isSystemPath = note.path.startsWith(SYSTEM_TODO_PREFIX);
  const hasMarker = note.tags.includes(SYSTEM_TODO_TAG);
  if (kind === 'todo') {
    if (!isSystemPath || note.type !== 'todo' || !hasMarker) failTrash(errorCode);
    return;
  }
  if (isSystemPath || hasMarker) failTrash(errorCode);
}

function validateTrashNoteMetadata(
  input: unknown,
  expectedPath: string,
): Omit<Note, 'id' | 'md_path'> {
  if (!isExactRecord(input, TRASH_NOTE_KEYS)) failTrash('TRASH_RECOVERY_REQUIRED');
  if (input.path !== expectedPath || encodePath(input.path) !== expectedPath) {
    failTrash('TRASH_RECOVERY_REQUIRED');
  }
  requireSafeMetadataString(input.title, 4096, false);
  if (input.type !== null && !['article', 'note', 'meeting', 'todo', 'reference', 'idea'].includes(String(input.type))) {
    failTrash('TRASH_RECOVERY_REQUIRED');
  }
  if (input.status !== null && !['draft', 'active', 'archived'].includes(String(input.status))) {
    failTrash('TRASH_RECOVERY_REQUIRED');
  }
  validateMetadataStringArray(input.tags, false);
  validateMetadataStringArray(input.related, true);
  requireSafeMetadataString(input.folder, 1024, true);
  if (input.source_hash !== null) requireSafeMetadataString(input.source_hash, 4096, true);
  if (!Number.isSafeInteger(input.created_at) || Number(input.created_at) < 0) failTrash('TRASH_RECOVERY_REQUIRED');
  if (!Number.isSafeInteger(input.updated_at) || Number(input.updated_at) < 0) failTrash('TRASH_RECOVERY_REQUIRED');
  if (
    input.confidence !== null
    && (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
  ) failTrash('TRASH_RECOVERY_REQUIRED');
  if (input.agent !== null) requireSafeMetadataString(input.agent, 1024, true);
  return input as unknown as Omit<Note, 'id' | 'md_path'>;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireSafeMetadataString(value: unknown, maxLength: number, allowEmpty: boolean): asserts value is string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maxLength
    || CONTROL_CHARACTER.test(value)
  ) failTrash('TRASH_RECOVERY_REQUIRED');
}

function validateMetadataStringArray(value: unknown, paths: boolean): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 1024) failTrash('TRASH_RECOVERY_REQUIRED');
  for (const item of value) {
    requireSafeMetadataString(item, 1024, false);
    if (paths && encodePath(item) !== item) failTrash('TRASH_RECOVERY_REQUIRED');
  }
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function safeTrashExists(md: MdFileStore, trashId: string): boolean {
  try {
    return md.trashExists(trashId);
  } catch (error) {
    throw mapTrashError(error, 'TRASH_FILE_UNSAFE');
  }
}

function mapTrashError(error: unknown, fallback: ConstructorParameters<typeof TrashError>[0]): TrashError {
  if (error instanceof TrashError) return error;
  const message = error instanceof Error ? error.message : '';
  const known = [
    'TRASH_INVALID_ARGUMENT', 'TRASH_NOT_FOUND', 'TRASH_REVISION_CONFLICT',
    'TRASH_IDEMPOTENCY_CONFLICT', 'TRASH_FILE_UNSAFE', 'TRASH_RESTORE_CONFLICT',
    'TRASH_RECOVERY_REQUIRED',
  ] as const;
  const match = known.find((code) => message.includes(code));
  return new TrashError(match ?? fallback);
}

function failTrash(code: ConstructorParameters<typeof TrashError>[0]): never {
  throw new TrashError(code);
}
