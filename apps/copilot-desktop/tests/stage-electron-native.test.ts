import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRootShaUnchanged,
  atomicStageBinary,
  rebuildArgs,
  resolveStagePaths,
  sha256,
  spawnFailureEvidence,
} from '../scripts/stage-electron-native.mjs';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('stage-electron-native', () => {
  it('builds the explicit Electron rebuild command without global install flags', () => {
    expect(rebuildArgs('33.4.11', 'arm64')).toEqual([
      'rebuild',
      '--runtime=electron',
      '--target=33.4.11',
      '--arch=arm64',
      '--dist-url=https://electronjs.org/headers',
      '--build-from-source',
    ]);
  });

  it('atomically stages only the destination while preserving root SHA', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'native-stage-test-'));
    cleanup.push(dir);
    const root = path.join(dir, 'root/better_sqlite3.node');
    const staged = path.join(dir, 'staged/better_sqlite3.node');
    const packaged = path.join(dir, 'app/better_sqlite3.node');
    await mkdir(path.dirname(root), { recursive: true });
    await mkdir(path.dirname(staged), { recursive: true });
    await mkdir(path.dirname(packaged), { recursive: true });
    await writeFile(root, 'node-abi-137');
    await writeFile(staged, 'electron-abi-130');
    await writeFile(packaged, 'old-node-abi-137');
    const rootBefore = await sha256(root);

    await atomicStageBinary(staged, packaged);

    expect(await readFile(packaged, 'utf8')).toBe('electron-abi-130');
    expect(await assertRootShaUnchanged(root, rootBefore)).toBe(rootBefore);
    expect(await sha256(packaged)).not.toBe(rootBefore);
  });

  it('resolves the packaged asar.unpacked-only destination', () => {
    const paths = resolveStagePaths({ appPath: '/tmp/NJX.app' });
    expect(paths.packagedBinary).toBe(
      '/tmp/NJX.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    );
    expect(paths.rootBinary).toContain('/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  });

  it('preserves structured timeout and signal evidence instead of exit null', () => {
    const error = Object.assign(new Error('spawn timed out'), { code: 'ETIMEDOUT' });
    expect(spawnFailureEvidence({ status: null, signal: 'SIGTERM', error })).toEqual({
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: true,
      error: expect.objectContaining({ code: 'ETIMEDOUT', message: 'spawn timed out' }),
    });
  });
});
