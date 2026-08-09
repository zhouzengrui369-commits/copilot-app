import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NativeCacheBackgroundLaunchBlocked,
  launchNativeCacheHydrator,
  parseNativeCacheBackgroundLaunchArgs,
} from './native-cache-background-launch.mjs';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OWNER_AUTHORITY = 'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'copilot-r62-launch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo');
  const scriptDir = path.join(repository, 'scripts/candidate-r30');
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(
    path.join(scriptDir, 'npm-native-cache-hydrate.mjs'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    { mode: 0o700 },
  );
  return {
    root,
    repository,
    cacheDir: path.join(root, 'native-cache', 'candidate-cache'),
    receiptOutput: path.join(root, 'receipts', 'native-cache.json'),
    stdout: path.join(root, 'evidence', 'hydrator.stdout.log'),
    stderr: path.join(root, 'evidence', 'hydrator.stderr.log'),
    launchReceipt: path.join(root, 'evidence', 'hydrator-launch.json'),
  };
}

function options(paths) {
  return {
    repository: paths.repository,
    sourceCommit: SOURCE_COMMIT,
    cacheDir: paths.cacheDir,
    receiptOutput: paths.receiptOutput,
    ownerAuthority: OWNER_AUTHORITY,
    stdout: paths.stdout,
    stderr: paths.stderr,
    launchReceipt: paths.launchReceipt,
  };
}

test('R62 launcher requires exact absolute one-shot authority arguments', () => {
  const parsed = parseNativeCacheBackgroundLaunchArgs([
    '--repository', '/tmp/repo',
    '--source-commit', SOURCE_COMMIT,
    '--cache-dir', '/tmp/cache',
    '--receipt-output', '/tmp/receipt.json',
    '--owner-authority', OWNER_AUTHORITY,
    '--stdout', '/tmp/evidence/stdout.log',
    '--stderr', '/tmp/evidence/stderr.log',
    '--launch-receipt', '/tmp/evidence/launch.json',
  ]);
  assert.equal(parsed.repository, '/tmp/repo');
  assert.equal(parsed.cacheDir, '/tmp/cache');

  for (const argv of [
    ['--repository', 'relative/repo'],
    ['--repository', '/tmp/repo', '--repository', '/tmp/other'],
  ]) {
    assert.throws(
      () => parseNativeCacheBackgroundLaunchArgs([
        ...argv,
        '--source-commit', SOURCE_COMMIT,
        '--cache-dir', '/tmp/cache',
        '--receipt-output', '/tmp/receipt.json',
        '--owner-authority', OWNER_AUTHORITY,
        '--stdout', '/tmp/evidence/stdout.log',
        '--stderr', '/tmp/evidence/stderr.log',
        '--launch-receipt', '/tmp/evidence/launch.json',
      ]),
      (error) => error instanceof NativeCacheBackgroundLaunchBlocked,
    );
  }
});

test('R62 launcher starts one detached node hydrator without creating cache or PASS receipt targets', (t) => {
  const paths = fixture(t);
  let spawnCall = null;
  let unrefCount = 0;
  const spawnImpl = (command, args, settings) => {
    assert.equal(existsSync(paths.cacheDir), false, 'launcher must not precreate native cache dir');
    assert.equal(existsSync(paths.receiptOutput), false, 'launcher must not precreate native PASS receipt');
    spawnCall = { command, args, settings };
    return {
      pid: 4242,
      unref() { unrefCount += 1; },
    };
  };

  const receipt = launchNativeCacheHydrator(options(paths), { spawnImpl });
  assert.equal(receipt.status, 'LAUNCHED');
  assert.equal(receipt.processId, 4242);
  assert.equal(receipt.detached, true);
  assert.equal(receipt.shell, false);
  assert.equal(receipt.launcherDidCreateCacheDir, false);
  assert.equal(receipt.launcherDidCreateReceiptOutput, false);
  assert.equal(receipt.automaticRetry, false);
  assert.equal(receipt.replacementProcessAllowed, false);
  assert.equal(unrefCount, 1);

  assert.equal(existsSync(paths.cacheDir), false);
  assert.equal(existsSync(paths.receiptOutput), false);
  assert.equal(existsSync(paths.stdout), true);
  assert.equal(existsSync(paths.stderr), true);
  assert.equal(existsSync(paths.launchReceipt), true);

  assert.equal(spawnCall.command, process.execPath);
  assert.equal(spawnCall.settings.cwd, paths.repository);
  assert.equal(spawnCall.settings.detached, true);
  assert.equal(spawnCall.settings.shell, false);
  assert.ok(spawnCall.args.includes('--repository'));
  assert.ok(spawnCall.args.includes(paths.repository));
  assert.ok(spawnCall.args.includes('--cache-dir'));
  assert.ok(spawnCall.args.includes(paths.cacheDir));
  assert.ok(spawnCall.args.includes('--receipt-output'));
  assert.ok(spawnCall.args.includes(paths.receiptOutput));
  assert.equal(spawnCall.args.includes('setsid'), false);

  const diskReceipt = JSON.parse(readFileSync(paths.launchReceipt, 'utf8'));
  assert.equal(diskReceipt.processId, 4242);
  assert.equal(diskReceipt.cacheDir, paths.cacheDir);
  assert.equal(diskReceipt.launcherDidCreateCacheDir, false);
});

test('R62 launcher refuses an existing cache target and never removes it', (t) => {
  const paths = fixture(t);
  mkdirSync(paths.cacheDir, { recursive: true });
  const sentinel = path.join(paths.cacheDir, 'sentinel.txt');
  writeFileSync(sentinel, 'preserve\n');

  assert.throws(
    () => launchNativeCacheHydrator(options(paths), {
      spawnImpl: () => { throw new Error('must not spawn'); },
    }),
    (error) => error instanceof NativeCacheBackgroundLaunchBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_OUTPUT_EXISTS',
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve\n');
});

test('R62 launcher forbids evidence/log paths inside the native cache target', (t) => {
  const paths = fixture(t);
  const unsafe = {
    ...options(paths),
    stdout: path.join(paths.cacheDir, 'hydrator.stdout.log'),
  };
  assert.throws(
    () => launchNativeCacheHydrator(unsafe, {
      spawnImpl: () => { throw new Error('must not spawn'); },
    }),
    (error) => error instanceof NativeCacheBackgroundLaunchBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_PATH',
  );
  assert.equal(existsSync(paths.cacheDir), false);
});
