import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/store/sqlite-store.js';

const cleanup: string[] = [];
const require = createRequire(import.meta.url);
const betterSqliteEntry = require.resolve('better-sqlite3');
const hostNativeBinding = path.resolve(
  path.dirname(betterSqliteEntry),
  '../build/Release/better_sqlite3.node',
);

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('SqliteStore explicit native binding', () => {
  it('opens and queries through the explicitly selected host addon', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-native-binding-'));
    cleanup.push(directory);
    const store = new SqliteStore({
      dbPath: path.join(directory, 'kb.sqlite'),
      nativeBinding: hostNativeBinding,
    });
    try {
      expect(store.raw.prepare('select 1 as value').get()).toEqual({ value: 1 });
      expect(store.schemaVersion).toBe(0);
    } finally {
      store.close();
    }
  });
});
