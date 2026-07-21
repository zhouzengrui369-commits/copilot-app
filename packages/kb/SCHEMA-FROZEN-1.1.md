# KB Schema Freeze · Sprint 1.1 (T-1.1.4)

> Status: **FROZEN** as of 2026-07-09 (Sprint 1.1 close)
> Owner: PM (Mavis)
> Consumer contracts: Sprint 1.2 T-1.2.1 KG builder + Sprint 1.3 T-1.3.1 RAG
> Implementation: `/packages/kb/` (workspace `@copilot/kb`)

This document is the **frozen contract** for the local KB persistence layer.
Any field rename / type change / table drop after this freeze MUST go through
the PM change-request channel (rules.md §1.4). Worker self-service edits to
the frozen fields are forbidden.

---

## 1. Storage layout

| Concern | Tech | Path |
|---|---|---|
| Metadata + indexes | SQLite (WAL mode) | `<userData>/kb.sqlite` (+ `-wal`, `-shm` sidecars) |
| Note bodies + frontmatter | Markdown files via `gray-matter` | `<userData>/notes/<compound-path>.md` |
| Schema version | `schema_meta.k = 'version'` | inside the SQLite file |

Both stores are kept in sync by `KbClient.createNote / updateNote / deleteNote`.
The SQLite row is the source of truth for *metadata*; the `.md` file is the
source of truth for *body content*.

---

## 2. Tables (SQLite schema v0)

### 2.1 `schema_meta`

```sql
CREATE TABLE schema_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
```

Used to store the current schema version. Row `('version', '0')` is inserted
on first open. Migrations bump this to `'1'`, `'2'`, etc.

### 2.2 `notes`

```sql
CREATE TABLE notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT    UNIQUE NOT NULL,    -- compound path, e.g. "calendar/2026-07-08"
  title        TEXT    NOT NULL,
  type         TEXT,                       -- article / note / meeting / todo / reference / idea
  status       TEXT,                       -- draft / active / archived
  tags         TEXT,                       -- JSON array of strings
  related      TEXT,                       -- JSON array of note paths
  folder       TEXT,                       -- denormalized top-level folder, "" for root
  source_hash  TEXT,                       -- external content hash (v5 parity)
  md_path      TEXT    NOT NULL,           -- absolute path to <root>/<path>.md
  created_at   INTEGER NOT NULL,           -- unix ms
  updated_at   INTEGER NOT NULL,           -- unix ms
  confidence   REAL,                       -- LLM confidence 0..1, nullable
  agent        TEXT                        -- producing agent id, nullable
);
CREATE INDEX idx_notes_path        ON notes(path);
CREATE INDEX idx_notes_type        ON notes(type);
CREATE INDEX idx_notes_folder      ON notes(folder);
CREATE INDEX idx_notes_updated_at  ON notes(updated_at);
```

**Frozen semantics**:

- `path` is canonical id; UNIQUE; URL-safe compound (`/`-separated).
  Validation rules live in `src/util/path-encoding.ts` and reject `\\`, empty
  segments, `.` / `..`, control chars, segments > 128 chars, total > 1024 chars.
- `tags` / `related` are stored as JSON-stringified arrays in TEXT columns.
  Sprint 1.1 uses `LIKE '%"tag"%'` matching — cheap and index-free. Sprint 1.4
  may swap in FTS5 / json1 if volume warrants.
- `folder` is denormalized at write time as `folderOf(path)`; root-level notes
  get `''`.
- `source_hash` mirrors v5 workbench schema for cross-version data continuity.
- `md_path` is the absolute path on disk; tests use temp dirs, prod uses
  Electron `app.getPath('userData')/notes/`.

### 2.3 `note_links`

```sql
CREATE TABLE note_links (
  from_path  TEXT NOT NULL,
  to_path    TEXT NOT NULL,
  rel        TEXT,
  PRIMARY KEY (from_path, to_path)
);
```

Typed edges between notes. Sprint 1.2 KG builder writes these as it extracts
entities + relations from the body text. `rel` is free-form (`"cites"`,
`"follows-up"`, `"defines"`, ...).

### 2.4 `kg_pending`

```sql
CREATE TABLE kg_pending (
  note_path  TEXT PRIMARY KEY,
  status     TEXT,        -- pending / processing / done / failed
  queued_at  INTEGER      -- unix ms
);
```

Sprint 1.2 KG builder reads `WHERE status = 'pending'` to claim work, then
flips to `'processing'` → `'done'` (or `'failed'` on error).

---

## 3. Frontmatter (MD file mirror)

Every `.md` file carries a YAML frontmatter block with the same fields as the
SQLite row. `gray-matter` parses it; null/undefined fields are stripped at
write time (so we don't pollute the file with `agent: null`).

```yaml
---
path: calendar/2026-07-08
title: 2026-07-08 standup
type: meeting
status: active
tags:
  - standup
  - team
related: []
folder: calendar
source_hash: null
confidence: null
agent: null
created_at: 1752038400000
updated_at: 1752038400000
---

# Standup
- kickoff
- ...
```

**Frozen rule**: frontmatter field set matches `notes` table columns 1:1. New
fields require both a SQLite ALTER and a frontmatter write-path update.

---

## 4. Public TypeScript surface

Exported from `@copilot/kb`:

```ts
export type { Note, NoteInput, NoteUpdate, NoteType, NoteStatus } from './types.js';
export type { NoteLink, NoteLinkInput, KgPendingEntry, KgPendingStatus } from './types.js';
export type { ListFilter, ListResult, ReadNoteResult } from './types.js';

export class SqliteStore { ... }
export class MdFileStore { ... }
export class KbClient    { ... }       // CRUD + search + links + KG queue

export function encodePath(input: string): string;
export function tryEncodePath(input: string): string | null;
export function decodePath(compound: string, rootDir: string): string;
export function folderOf(compound: string): string;
export function leafOf(compound: string): string;

export function runMigrations(store: SqliteStore, target?: number): { from, to, applied };
```

`KbClient` constructor takes two pre-built stores:

```ts
const kb = new KbClient({
  sqlite: new SqliteStore({ dbPath: '/abs/kb.sqlite' }),
  md:     new MdFileStore({ rootDir: '/abs/notes' }),
});
```

Convenience factory for the desktop app can be added in Sprint 1.4 if needed.

---

## 5. Sprint 1.2 / 1.3 contract guarantees

- ✅ **KG builder** (T-1.2.1) can call `kb.listKgPending('pending')` to claim
  work, write edges via `kb.addLink({from_path, to_path, rel})`, and update
  status via `kb.setKgStatus(path, 'done' | 'failed')`.
- ✅ **RAG** (T-1.3.1) can call `kb.listNotes({type, status, tags, query, folder, limit, offset})`
  for candidate selection; `kb.readNote(path)` returns `{note, body}` for
  prompt construction.
- ✅ **Sync** (Sprint 1.4 T-2.7) can call `kb.reconcile()` to align SQLite
  rows with on-disk files after a backup restore.

---

## 6. Change-request protocol (frozen fields)

To add / rename / repurpose a field:

1. Open an issue in `tasks/openclaw/<date>-<slug>/TASK.md` describing the
   change and why the v0 schema is insufficient.
2. PM reviews; if approved, bump `MIGRATIONS` map in `src/api/migration.ts`.
3. Update this file's table + field list.
4. Coordinate with Sprint 1.2 / 1.3 leads before merging.

Forbidden without PM signoff:
- Renaming `notes.path`, `notes.md_path`, `notes.created_at`, `notes.updated_at`.
- Dropping the `kg_pending` table (Sprint 1.2 reads it).
- Changing `note_links` PK from `(from_path, to_path)`.
- Removing `source_hash` (v5 parity).

### Approved append-only change: schema v1 reversible trash

Phase 1 adds `trash_entries` through `MIGRATIONS[1]`. The frozen v0 tables and
columns above are unchanged. The v1 journal records only local identifiers,
logical paths, revisions, digests, lifecycle state, timestamps, and sanitized
metadata; it must not persist absolute paths, note bodies, or credentials.

The public local-only surface is `moveNoteToTrash`, `readTrash`,
`markTrashClean`, `restoreTrash`, `markTrashRestored`, and `purgeTrash`. Active
CRUD, search, KG, and RAG treat an item as absent after the journal finalize
step. Permanent purge is not part of the Remote protocol.

The journal's canonical metadata payload is schema v2 and contains exactly the
sanitized frozen note row; it never stores Markdown body bytes, absolute paths,
credentials, or `note_links`. Its SHA-256 is bound into `input_sha256`, and both
the canonical payload and binding are verified before recovery or restore.
Relationship rows are rebuilt only through production KG/RAG re-indexing.
After the Markdown and SQLite row are atomically restored, the journal remains
in `restoring` until the desktop has rebuilt both indexes; startup retries that
durable state before marking it `restored`.

### Approved append-only change: schema v2 trash ownership lease

`MIGRATIONS[2]` adds `owner_id`, `lease_until`, `journal_updated_at`, and
`journal_version` to `trash_entries`; no v0 or v1 column is renamed or
repurposed. Every move/restore/purge transition and destructive recovery step
is compare-and-swap bound to the current owner and journal version. A live
lease owned by another client is read-only: constructors and startup recovery
must not claim, finalize, delete, unlink, or roll it back. An expired lease is
recoverable only after a successful atomic claim, after which filesystem type,
single-link status, metadata binding, and content SHA-256 are revalidated at
the terminal mutation boundary.

Existing v1 rows migrate as ownerless, expired entries (`owner_id=''`, lease
and version fields `0`) so the first v2 recovery client must claim them before
reconciliation. Graceful close expires the current owner's leases; process
death leaves the bounded lease to expire naturally.

---

## 7. Verification at freeze time

```
npm run check          # tsc --noEmit        → 0 errors
npm run test           # vitest run          → 56 passed / 56
npm run test:perf      # 100 notes query     → avg 0.29ms, p95 0.54ms (target < 50ms)
npm run test:e2e       # write → kill → restart → read → PASS
npm run test:coverage  → statements 93.65%, lines 93.65%, branches 77.05%, funcs 95.16%
```

All above verified at 2026-07-09 12:48 (UTC+8) on macOS Darwin 25.2.0,
Node v24.13.1, better-sqlite3 11.10.0, gray-matter 4.0.3.

---

*Worker δ · T-1.1.4 · sp1.1-T-1.1.4 branch · 2026-07-09*
