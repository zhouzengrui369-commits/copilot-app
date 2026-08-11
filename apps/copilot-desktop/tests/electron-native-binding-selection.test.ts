import { afterEach, describe, expect, it } from 'vitest';
import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DomainServiceError,
  LOCAL_STORAGE_NATIVE_UNAVAILABLE,
  resolveSourceSqliteNativeBinding,
} from '../src/main/local-knowledge-service.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  root: string;
  allowedTaskRoot: string;
  sharedNodeModulesRoot: string;
  binding: string;
}> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-selection-'));
  cleanup.push(created);
  const root = await realpath(created);
  const allowedTaskRoot = path.join(root, 'tasks/openclaw');
  const sharedNodeModulesRoot = path.join(root, 'node_modules');
  const binding = path.join(
    allowedTaskRoot,
    '2026-07-25-test-task',
    'run/native/better_sqlite3.node',
  );
  await mkdir(path.dirname(binding), { recursive: true });
  await mkdir(sharedNodeModulesRoot, { recursive: true });
  await writeFile(binding, 'synthetic-native-binding');
  return { root, allowedTaskRoot, sharedNodeModulesRoot, binding };
}

function expectUnavailable(run: () => unknown): void {
  try {
    run();
    throw new Error('expected source native binding validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainServiceError);
    expect(error).toMatchObject({
      code: 'INTERNAL',
      message: LOCAL_STORAGE_NATIVE_UNAVAILABLE,
    });
    expect(String(error)).not.toContain('synthetic-native-binding');
  }
}

describe('Electron source SQLite native binding selection', () => {
  it('accepts one owner-bound regular .node file in a task-owned run/native root', async () => {
    const current = await fixture();
    expect(resolveSourceSqliteNativeBinding({
      isPackaged: false,
      configuredPath: current.binding,
      allowedTaskRoot: current.allowedTaskRoot,
      sharedNodeModulesRoot: current.sharedNodeModulesRoot,
    })).toBe(current.binding);
  });

  it('ignores source overrides in packaged mode', async () => {
    const current = await fixture();
    expect(resolveSourceSqliteNativeBinding({
      isPackaged: true,
      configuredPath: path.join(current.root, 'missing-secret.node'),
      allowedTaskRoot: path.join(current.root, 'missing-tasks'),
      sharedNodeModulesRoot: path.join(current.root, 'missing-node-modules'),
    })).toBeUndefined();
  });

  it('fails closed with one stable safe error for missing, relative, outside, and wrong-owner paths', async () => {
    const current = await fixture();
    const outside = path.join(current.root, 'outside.node');
    await writeFile(outside, 'outside');
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const invalid = [
      undefined,
      'relative.node',
      path.join(current.root, 'missing.node'),
      outside,
    ];
    for (const configuredPath of invalid) {
      expectUnavailable(() => resolveSourceSqliteNativeBinding({
        isPackaged: false,
        configuredPath,
        allowedTaskRoot: current.allowedTaskRoot,
        sharedNodeModulesRoot: current.sharedNodeModulesRoot,
      }));
    }
    expectUnavailable(() => resolveSourceSqliteNativeBinding({
      isPackaged: false,
      configuredPath: current.binding,
      allowedTaskRoot: current.allowedTaskRoot,
      sharedNodeModulesRoot: current.sharedNodeModulesRoot,
      currentUid: currentUid + 1,
    }));
  });

  it('rejects symlinks, hardlinks, shared node_modules, and non-stage task paths', async () => {
    const current = await fixture();
    const symlinkPath = path.join(
      current.allowedTaskRoot,
      '2026-07-25-symlink',
      'run/native/better_sqlite3.node',
    );
    await mkdir(path.dirname(symlinkPath), { recursive: true });
    await symlink(current.binding, symlinkPath);

    const hardlinkPath = path.join(
      current.allowedTaskRoot,
      '2026-07-25-hardlink',
      'run/native/better_sqlite3.node',
    );
    await mkdir(path.dirname(hardlinkPath), { recursive: true });
    await link(current.binding, hardlinkPath);

    const sharedPath = path.join(current.sharedNodeModulesRoot, 'better_sqlite3.node');
    await writeFile(sharedPath, 'shared');
    const wrongStage = path.join(
      current.allowedTaskRoot,
      '2026-07-25-wrong-stage',
      'artifacts/better_sqlite3.node',
    );
    await mkdir(path.dirname(wrongStage), { recursive: true });
    await writeFile(wrongStage, 'wrong-stage');

    for (const configuredPath of [symlinkPath, hardlinkPath, sharedPath, wrongStage]) {
      expectUnavailable(() => resolveSourceSqliteNativeBinding({
        isPackaged: false,
        configuredPath,
        allowedTaskRoot: current.allowedTaskRoot,
        sharedNodeModulesRoot: current.sharedNodeModulesRoot,
      }));
    }
  });
});
