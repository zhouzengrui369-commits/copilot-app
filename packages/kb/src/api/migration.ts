/**
 * Schema migrations for the KB package.
 *
 * Migrations are append-only: never edit a published migration. Each step
 * is a `(version: number) => void` callback that takes a `SqliteStore` and
 * upgrades the schema from `version - 1` to `version`.
 *
 * The initial frozen schema is v0. Phase 1 adds v1 as an append-only local
 * reversible-trash journal; no frozen v0 column is renamed or repurposed.
 *
 * Sprint 1.1 freezes the **v0** schema in `SCHEMA-FROZEN-1.1.md`.
 */

import type { SqliteStore } from '../store/sqlite-store.js';

export type MigrationStep = (store: SqliteStore) => void;

export const MIGRATIONS: Record<number, MigrationStep> = {
  // v0 is the initial schema, applied by SqliteStore constructor — no migration needed.
  // 0: () => {},
  1: (store) => {
    store.raw.exec(`
      CREATE TABLE trash_entries (
        trash_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('note', 'todo')),
        original_path TEXT NOT NULL,
        original_revision TEXT NOT NULL,
        trash_revision TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        input_sha256 TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN (
          'prepared', 'cleanup_pending', 'trashed', 'restoring',
          'restored', 'purging', 'purged'
        )),
        moved_at INTEGER NOT NULL,
        restored_at INTEGER,
        purged_at INTEGER,
        cleanup_attempts INTEGER NOT NULL DEFAULT 0,
        restore_idempotency_key TEXT UNIQUE,
        purge_idempotency_key TEXT UNIQUE
      );
      CREATE UNIQUE INDEX trash_active_original_path
        ON trash_entries(original_path)
        WHERE state IN ('prepared', 'cleanup_pending', 'trashed', 'restoring');
    `);
  },
  // r3 durable operation ownership. Existing v1 rows are deliberately
  // ownerless and expired so the first startup must CAS-claim before recovery.
  2: (store) => {
    store.raw.exec(`
      ALTER TABLE trash_entries ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE trash_entries ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE trash_entries ADD COLUMN journal_updated_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE trash_entries ADD COLUMN journal_version INTEGER NOT NULL DEFAULT 0;
    `);
  },
};

/**
 * Apply all migrations from `currentVersion` up to `targetVersion` (inclusive).
 * No-op if `currentVersion === targetVersion`.
 */
export function runMigrations(
  store: SqliteStore,
  targetVersion: number = Math.max(0, ...Object.keys(MIGRATIONS).map(Number)),
): { from: number; to: number; applied: number[] } {
  const from = store.schemaVersion;
  const applied: number[] = [];
  if (from === targetVersion) return { from, to: from, applied };

  for (let v = from + 1; v <= targetVersion; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      throw new Error(`Migration v${v} not registered (skip-ahead forbidden)`);
    }
    const tx = store.raw.transaction(() => {
      step(store);
      store.raw
        .prepare(`UPDATE schema_meta SET v = ? WHERE k = 'version'`)
        .run(String(v));
    });
    tx();
    applied.push(v);
  }

  return { from, to: targetVersion, applied };
}
