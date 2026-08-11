/**
 * KG migration unit tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * Mirrors the contract pinned for `@copilot/kb` (see `packages/kb/tests/migration.test.ts`):
 *   - the migration map is append-only
 *   - the runner is a no-op on the current schema version (v1)
 *   - v0 stores are additively upgraded to v1 without losing KG rows
 *   - asking for a future version that has no registered step throws
 *   - the error message includes the missing version number for triage
 *
 * WIKI local projection adds v1 while preserving the frozen v0 graph tables.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { KG_MIGRATIONS, runKgMigrations } from '../src/store/migration.js';
import { KgStore } from '../src/store/sqlite-store.js';

let store: KgStore;

beforeEach(() => {
  store = new KgStore({ dbPath: ':memory:' });
});
afterEach(() => {
  store.close();
});

describe('KG_MIGRATIONS map (additive WIKI v1)', () => {
  it('is a plain object (stable JSON shape for SCHEMA-FROZEN snapshots)', () => {
    expect(KG_MIGRATIONS).toBeTypeOf('object');
    expect(KG_MIGRATIONS).not.toBeInstanceOf(Map);
  });

  it('does not register v0 — v0 is the initial schema, not a migration', () => {
    // v0 is applied by KgStore's constructor via KG_SCHEMA_SQL. Adding a
    // v0 entry would double-execute the schema and break the freeze.
    expect(KG_MIGRATIONS[0]).toBeUndefined();
  });
});

describe('runKgMigrations · skip-ahead forbidden', () => {
  it('no-op when target equals current schema version (v1 → v1)', () => {
    const out = runKgMigrations(store);
    expect(out.from).toBe(1);
    expect(out.to).toBe(1);
    expect(out.applied).toEqual([]);
    expect(store.schemaVersion).toBe(1);
  });

  it('upgrades a legacy v0 graph additively and preserves existing rows', () => {
    store.upsertEntity({
      entity_id: 'concept:preserved',
      type: 'concept',
      name: 'Preserved',
      source_note: 'legacy/note',
    }, 1);
    store.raw.exec(`
      DROP TABLE note_wiki;
      UPDATE kg_schema_meta SET v = '0' WHERE k = 'version';
    `);

    const out = runKgMigrations(store);
    expect(out).toEqual({ from: 0, to: 1, applied: [1] });
    expect(store.schemaVersion).toBe(1);
    expect(store.getEntityByIdString('concept:preserved')?.name).toBe('Preserved');
    expect(
      store.raw.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note_wiki'`,
      ).get(),
    ).toEqual({ name: 'note_wiki' });
  });

  it('throws when requested target skips a missing version (v1 → v2)', () => {
    expect(() => runKgMigrations(store, 2)).toThrow(/v2 not registered/);
    expect(store.schemaVersion).toBe(1);
  });

  it('error message includes the first missing step (not the final target)', () => {
    // Loop throws on the first missing step (v2) when v1 → v3 is requested.
    let caught: Error | null = null;
    try {
      runKgMigrations(store, 3);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toMatch(/v2/);
    expect(caught?.message).toMatch(/skip-ahead/);
  });
});
