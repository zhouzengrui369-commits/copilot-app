import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { KgStore } from '../src/store/sqlite-store.js';

const require = createRequire(import.meta.url);
const betterSqliteEntry = require.resolve('better-sqlite3');
const hostNativeBinding = path.resolve(
  path.dirname(betterSqliteEntry),
  '../build/Release/better_sqlite3.node',
);

describe('KgStore explicit native binding', () => {
  it('opens and queries through the explicitly selected host addon', () => {
    const store = new KgStore({
      dbPath: ':memory:',
      nativeBinding: hostNativeBinding,
    });
    try {
      expect(store.listNodes()).toEqual([]);
      expect(store.schemaVersion).toBeGreaterThanOrEqual(0);
    } finally {
      store.close();
    }
  });
});
