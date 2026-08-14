import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ELECTRON_ARTIFACT_MAX_BYTES,
  ELECTRON_ARTIFACT_PACKAGE_PATHS,
  ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
  ELECTRON_ARTIFACT_RANGE_BYTES,
  ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
  ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
  downloadElectronArtifactInRanges,
} from './electron-artifact-prefetch.mjs';

const OFFICIAL_URL =
  'https://github.com/electron/electron/releases/download/v38.8.6/electron-v38.8.6-darwin-arm64.zip';

test('Electron artifact range policy is exact, bounded and covers both reviewed packages', () => {
  assert.equal(ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
    'official-electron-embedded-sha256-bounded-range-v1');
  assert.equal(ELECTRON_ARTIFACT_RANGE_BYTES, 1_024 * 1_024);
  assert.equal(ELECTRON_ARTIFACT_RANGE_CONCURRENCY, 4);
  assert.equal(ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS, 3);
  assert.equal(ELECTRON_ARTIFACT_MAX_BYTES, 512 * 1_024 * 1_024);
  assert.deepEqual(ELECTRON_ARTIFACT_PACKAGE_PATHS, [
    'apps/copilot-desktop/node_modules/electron',
    'node_modules/electron',
  ]);
});

test('bounded downloader assembles exact ranges and retries only a transient segment error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-electron-range-'));
  const target = path.join(root, 'electron.zip');
  const source = Buffer.from('0123456789abcdef');
  const attempts = new Map();
  try {
    const report = await downloadElectronArtifactInRanges({
      url: OFFICIAL_URL,
      targetFilePath: target,
      rangeBytes: 5,
      concurrency: 2,
      maxAttempts: 3,
      fetchRange: async (_url, start, end) => {
        const key = `${start}-${end}`;
        const count = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, count);
        if (start === 5 && count === 1) {
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        }
        return { body: source.subarray(start, end + 1), total: source.length };
      },
    });
    assert.deepEqual(await readFile(target), source);
    assert.deepEqual(report, {
      bytes: source.length,
      rangeCount: 4,
      requestCount: 6,
      retryCount: 1,
    });
    assert.equal(attempts.get('5-9'), 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded downloader rejects non-official origins and never retries protocol failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-electron-range-deny-'));
  try {
    await assert.rejects(
      downloadElectronArtifactInRanges({
        url: 'https://mirror.invalid/electron.zip',
        targetFilePath: path.join(root, 'mirror.zip'),
        fetchRange: async () => ({ body: Buffer.from('x'), total: 1 }),
      }),
      /exact official release origin/u,
    );
    let calls = 0;
    await assert.rejects(
      downloadElectronArtifactInRanges({
        url: OFFICIAL_URL,
        targetFilePath: path.join(root, 'protocol.zip'),
        rangeBytes: 4,
        fetchRange: async (_url, start, end) => {
          calls += 1;
          if (start === 0 && end === 0) return { body: Buffer.from('0'), total: 8 };
          return { body: Buffer.alloc(end - start + 1), total: 9 };
        },
      }),
      /changed total or length/u,
    );
    assert.equal(calls, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
