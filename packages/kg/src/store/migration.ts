/**
 * Schema migrations for the KG package.
 *
 * Migrations are append-only. v0 is the initial schema applied by
 * `KgStore`'s constructor (see `sqlite-store.ts`). v0 includes five tables:
 *   - kg_nodes (entities)
 *   - kg_edges (relations)
 *   - note_entities (note ↔ entity bridge)
 *   - kg_tags (taxonomy of tags with note_count)
 *   - note_tags (note ↔ tag bridge, additive in wave 2)
 *
 * v1 (WIKI local projection R1) ADDITIVELY introduces `note_wiki`. All
 * pre-existing rows in v0 tables are preserved untouched.
 *
 * Sprint 1.2 freezes the v0 schema in `SCHEMA-FROZEN-1.2.md` (end of wave 3).
 * Any change requires a PM change request per rules.md §1.4.
 */

import type { KgStore } from './sqlite-store.js';

export type KgMigrationStep = (store: KgStore) => void;

/**
 * Append-only migration map. v0 is the initial schema and does not appear
 * here — it is applied by `KgStore` constructor via `KG_SCHEMA_SQL`.
 *
 * Future versions (not part of WIKI R1/R2):
 *   - v2: composite index `(type, updated_at)` for filtered graph queries
 *   - v2: edge weight precision widening to REAL (already is; future: split
 *     evidence JSON into a normalized `edge_evidence` table for richer
 *     queries in Sprint 2 / 3 visualisation).
 */
export const KG_MIGRATIONS: Record<number, KgMigrationStep> = {
  // v1 (WIKI local projection R1): add the `note_wiki` table that pins
  // per-note summary/tags/entity/relation snapshots to a SHA-256 content
  // digest. New stores already get this table via `KG_SCHEMA_SQL`; this
  // step exists so that stores opened against the Sprint 1.2 v0 schema
  // are additively upgraded without dropping any pre-existing KG rows.
  1: (store) => {
    store.raw.exec(`
      CREATE TABLE IF NOT EXISTS note_wiki (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('current','stale','failed')),
        content_digest TEXT NOT NULL,
        summary TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        entity_ids TEXT NOT NULL DEFAULT '[]',
        relation_signatures TEXT NOT NULL DEFAULT '[]',
        provider TEXT,
        model TEXT,
        generated_at INTEGER NOT NULL,
        failure_reason TEXT,
        failure_stage TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_wiki_note ON note_wiki(note_path);
      CREATE INDEX IF NOT EXISTS idx_note_wiki_status ON note_wiki(note_path, status);
      CREATE INDEX IF NOT EXISTS idx_note_wiki_digest ON note_wiki(note_path, content_digest);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_note_wiki_current_unique
        ON note_wiki(note_path) WHERE status = 'current';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_note_wiki_attempt_unique
        ON note_wiki(note_path, content_digest, status);
    `);
  },
};

/**
 * Apply pending migrations from `currentVersion` up to `targetVersion`
 * (inclusive). No-op when `from === target`.
 *
 * Skipped versions (for example: 0 → 2 without v1 registered) throw.
 */
export function runKgMigrations(
  store: KgStore,
  targetVersion: number = Math.max(0, ...Object.keys(KG_MIGRATIONS).map(Number)),
): { from: number; to: number; applied: number[] } {
  const from = store.schemaVersion;
  const applied: number[] = [];
  if (from === targetVersion) return { from, to: from, applied };

  for (let v = from + 1; v <= targetVersion; v++) {
    const step = KG_MIGRATIONS[v];
    if (!step) {
      throw new Error(`Kg migration v${v} not registered (skip-ahead forbidden)`);
    }
    const tx = store.raw.transaction(() => {
      step(store);
      store.raw
        .prepare(`UPDATE kg_schema_meta SET v = ? WHERE k = 'version'`)
        .run(String(v));
    });
    tx();
    applied.push(v);
  }

  return { from, to: targetVersion, applied };
}
