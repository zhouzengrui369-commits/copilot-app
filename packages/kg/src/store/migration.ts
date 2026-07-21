/**
 * Schema migrations for the KG package.
 *
 * Migrations are append-only. v0 is the initial schema applied by
 * `KgStore`'s constructor (see `sqlite-store.ts`). v0 includes four tables:
 *   - kg_nodes (entities)
 *   - kg_edges (relations)
 *   - note_entities (note ↔ entity bridge)
 *   - kg_tags (taxonomy of tags with note_count)
 *
 * Plus `kg_schema_meta` for version tracking.
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
 * Future versions (Sprint 1.4 candidates, not used in Sprint 1.2):
 *   - v1: composite index `(type, updated_at)` for filtered graph queries
 *   - v1: edge weight precision widening to REAL (already is; future: split
 *     evidence JSON into a normalized `edge_evidence` table for richer
 *     queries in Sprint 2 / 3 visualisation).
 */
export const KG_MIGRATIONS: Record<number, KgMigrationStep> = {
  // 1: (store) => {
  //   store.raw.exec(`CREATE INDEX IF NOT EXISTS idx_kg_nodes_type_updated
  //     ON kg_nodes(type, updated_at DESC)`);
  // },
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
