/**
 * @copilot/kb — public package surface.
 *
 * Cross-Sprint 1.2 / 1.3 contract surface (see `SCHEMA-FROZEN-1.1.md`):
 *   - `SqliteStore`     — raw metadata handle (rarely needed outside the package)
 *   - `MdFileStore`     — disk store for `.md` files
 *   - `KbClient`        — high-level CRUD + search + link + KG queue
 *   - `runMigrations`   — apply pending schema migrations
 *   - types             — `Note`, `NoteInput`, `NoteUpdate`, `ListFilter`, ...
 *
 * Usage:
 *   import { KbClient, SqliteStore, MdFileStore } from '@copilot/kb';
 *
 *   const kb = new KbClient({
 *     sqlite: new SqliteStore({ dbPath: '/abs/data/kb.sqlite' }),
 *     md:     new MdFileStore({ rootDir: '/abs/data/notes' }),
 *   });
 *
 *   const note = kb.createNote({
 *     path: 'calendar/2026-07-08/standup',
 *     title: '2026-07-08 standup',
 *     tags: ['standup', 'team'],
 *     body: '## Agenda\n- ...',
 *   });
 */

export { SqliteStore } from './store/sqlite-store.js';
export type { SqliteStoreOptions } from './store/sqlite-store.js';

export {
  MdFileStore,
  MdBodyIntegrityError,
  MdWriteIntegrityError,
} from './store/md-file-store.js';
export type {
  MdFileStoreOptions,
  MdBodyIntegrityCode,
  MdWriteIntegrityCode,
  ParsedNote,
  Frontmatter,
} from './store/md-file-store.js';

export { KbClient } from './api/crud.js';
export type { KbClientOptions } from './api/crud.js';

export { runMigrations, MIGRATIONS } from './api/migration.js';
export type { MigrationStep } from './api/migration.js';

export {
  encodePath,
  tryEncodePath,
  decodePath,
  folderOf,
  leafOf,
} from './util/path-encoding.js';

export type {
  Note,
  NoteInput,
  NoteUpdate,
  NoteType,
  NoteStatus,
  NoteLink,
  NoteLinkInput,
  KgPendingEntry,
  KgPendingStatus,
  ListFilter,
  ListResult,
  ReadNoteResult,
  TrashKind,
  TrashState,
  TrashEntry,
  MoveNoteToTrashRequest,
  RestoreTrashRequest,
  PurgeTrashRequest,
  TrashFaultPoint,
  TrashErrorCode,
} from './types.js';
export { TrashError } from './types.js';

// v0.3 Shared Knowledge Engine C1: storage-neutral contract/adapter surface.
// This export does not expose SQLite table names or database handles as an
// ecosystem integration contract.
export * from './shared-engine/index.js';
