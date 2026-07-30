import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveSourceSqliteNativeBinding,
} from '../src/main/local-knowledge-service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('source SQLite native binding final critical branch', () => {
  it('uses the current process uid when no explicit uid is injected', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'copilot-native-binding-'));
    roots.push(root);
    const allowedTaskRoot = path.join(root, 'tasks');
    const sharedNodeModulesRoot = path.join(root, 'shared-node-modules');
    const configuredPath = path.join(
      allowedTaskRoot,
      'task-a',
      'run',
      'native',
      'better-sqlite3.node',
    );
    mkdirSync(path.dirname(configuredPath), { recursive: true });
    mkdirSync(sharedNodeModulesRoot, { recursive: true });
    writeFileSync(configuredPath, 'synthetic native binding fixture');

    expect(resolveSourceSqliteNativeBinding({
      isPackaged: false,
      configuredPath,
      allowedTaskRoot,
      sharedNodeModulesRoot,
    })).toBe(configuredPath);
  });

  it('never resolves a source-only native binding for a packaged app', () => {
    expect(resolveSourceSqliteNativeBinding({
      isPackaged: true,
      configuredPath: undefined,
      allowedTaskRoot: '/unused',
      sharedNodeModulesRoot: '/unused',
    })).toBeUndefined();
  });
});
