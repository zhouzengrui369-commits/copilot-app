/**
 * KG migration unit tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * Mirrors the contract pinned for `@copilot/kb` (see `packages/kb/tests/migration.test.ts`):
 *   - the migration map is append-only
 *   - the runner is a no-op on the current schema version (v0)
 *   - asking for a future version that has no registered step throws
 *   - the error message includes the missing version number for triage
 *
 * The Sprint 1.2 freeze locks KG at v0. If/when v1 lands (Sprint 1.4
 * candidate: composite index on `(type, updated_at)`), add a sibling
 * describe block for the happy-path migration rather than mutating these.
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

describe('KG_MIGRATIONS map (Sprint 1.2 v0 freeze)', () => {
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
  it('no-op when target equals current schema version (v0 → v0)', () => {
    const out = runKgMigrations(store);
    expect(out.from).toBe(0);
    expect(out.to).toBe(0);
    expect(out.applied).toEqual([]);
    expect(store.schemaVersion).toBe(0);
  });

  it('throws when requested target skips a missing version (v0 → v2)', () => {
    expect(() => runKgMigrations(store, 2)).toThrow(/v1 not registered/);
    expect(store.schemaVersion).toBe(0);
  });

  it('error message includes the first missing step (not the final target)', () => {
    // Loop throws on the first missing step (v1) when v0 → v3 is requested.
    let caught: Error | null = null;
    try {
      runKgMigrations(store, 3);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toMatch(/v1/);
    expect(caught?.message).toMatch(/skip-ahead/);
  });
});
