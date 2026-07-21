/**
 * Migration module unit tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * Focused on the migration surface (`MIGRATIONS` map + `runMigrations`).
 * `runMigrations` is already exercised indirectly inside `sqlite-store.test.ts`,
 * but the dedicated tests below pin the *append-only* contract and the
 * "skip-ahead forbidden" error path so future schema bumps are caught early.
 *
 * Sprint 1.1 froze v0. Phase 1 registers v1 append-only for reversible trash.
 * We keep the assertions honest by checking the public surface, not just
 * "an object exists".
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS, runMigrations } from '../src/api/migration.js';
import { SqliteStore } from '../src/store/sqlite-store.js';

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-mig-'));
  return path.join(dir, 'kb.sqlite');
}

describe('MIGRATIONS map (frozen v0 + append-only v1)', () => {
  it('is a plain object (not a Map) for stable JSON serialization', () => {
    expect(MIGRATIONS).toBeTypeOf('object');
    expect(MIGRATIONS).not.toBeInstanceOf(Map);
  });

  it('does not register v0 — v0 is the initial schema, not a migration', () => {
    // v0 is applied by SqliteStore's constructor via SCHEMA_SQL. Adding a
    // v0 entry would double-execute the schema and break the freeze.
    expect(MIGRATIONS[0]).toBeUndefined();
  });

  it('keys are numeric version numbers when present', () => {
    for (const k of Object.keys(MIGRATIONS)) {
      const n = Number(k);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0); // 0 is reserved for initial schema
    }
  });

  it('registers the append-only reversible-trash v1 migration', () => {
    expect(MIGRATIONS[1]).toBeTypeOf('function');
  });
});

describe('runMigrations · skip-ahead forbidden', () => {
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new SqliteStore({ dbPath });
  });
  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('applies the default latest target (v0 → v2)', () => {
    const out = runMigrations(store);
    expect(out.from).toBe(0);
    expect(out.to).toBe(2);
    expect(out.applied).toEqual([1, 2]);
  });

  it('explicit target=0 also no-ops without touching schema_meta', () => {
    const out = runMigrations(store, 0);
    expect(out.applied).toEqual([]);
    expect(store.schemaVersion).toBe(0);
  });

  it('throws when requested target skips a missing version (v0 → v3)', () => {
    // v1 and v2 apply, then v3 is absent. Asking for v3 must stop at that gap.
    expect(() => runMigrations(store, 3)).toThrow(/v3 not registered/);
    expect(store.schemaVersion).toBe(2);
  });

  it('error message includes the offending version number for debugging', () => {
    // Sanity check on the error contract — operators triage from log lines,
    // so the version number must be present in the message body. Note: the
    // loop throws on the FIRST missing step (v3 when v0 → v4 is requested),
    // not on the final target — pin that exact behaviour.
    let caught: Error | null = null;
    try {
      runMigrations(store, 4);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toMatch(/v3/);
    expect(caught?.message).toMatch(/skip-ahead/);
  });
});
