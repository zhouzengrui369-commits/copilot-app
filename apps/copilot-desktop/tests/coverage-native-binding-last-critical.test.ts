import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

function bindingFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'copilot-native-binding-')));
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
  return { root, allowedTaskRoot, sharedNodeModulesRoot, configuredPath };
}

describe('source SQLite native binding final critical branch', () => {
  it('uses the current process uid when no explicit uid is injected', () => {
    const fixture = bindingFixture();
    expect(resolveSourceSqliteNativeBinding({
      isPackaged: false,
      configuredPath: fixture.configuredPath,
      allowedTaskRoot: fixture.allowedTaskRoot,
      sharedNodeModulesRoot: fixture.sharedNodeModulesRoot,
    })).toBe(fixture.configuredPath);
  });

  it('skips the uid comparison only when the host exposes no uid API', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
    expect(descriptor?.configurable).toBe(true);
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: undefined,
    });
    try {
      const fixture = bindingFixture();
      expect(resolveSourceSqliteNativeBinding({
        isPackaged: false,
        configuredPath: fixture.configuredPath,
        allowedTaskRoot: fixture.allowedTaskRoot,
        sharedNodeModulesRoot: fixture.sharedNodeModulesRoot,
      })).toBe(fixture.configuredPath);
    } finally {
      if (descriptor) Object.defineProperty(process, 'getuid', descriptor);
      else Reflect.deleteProperty(process, 'getuid');
    }
  });

  it('rejects a regular binding reached through a symlinked ancestor', () => {
    const fixture = bindingFixture();
    const aliasRoot = path.join(fixture.root, 'tasks-alias');
    symlinkSync(fixture.allowedTaskRoot, aliasRoot, 'dir');
    const aliasedPath = path.join(
      aliasRoot,
      'task-a',
      'run',
      'native',
      'better-sqlite3.node',
    );

    expect(() => resolveSourceSqliteNativeBinding({
      isPackaged: false,
      configuredPath: aliasedPath,
      allowedTaskRoot: fixture.allowedTaskRoot,
      sharedNodeModulesRoot: fixture.sharedNodeModulesRoot,
    })).toThrow('LOCAL_STORAGE_NATIVE_UNAVAILABLE');
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
