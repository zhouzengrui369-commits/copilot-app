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
  terminalReceiptPath,
} from './native-cache-background-launch.mjs';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OWNER_AUTHORITY = 'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'copilot-r62-launch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo');
  const scriptDir = path.join(repository, 'scripts/candidate-r30');
  mkdirSync(scriptDir, { recursive: true });
  for (const script of [
    'npm-native-cache-hydrate.mjs',
    'native-cache-terminal-supervisor.mjs',
    'native-cache-command-watchdog.mjs',
  ]) {
    writeFileSync(
      path.join(scriptDir, script),
      '#!/usr/bin/env node\nprocess.exit(0);\n',
      { mode: 0o700 },
    );
  }
  const launchReceipt = path.join(root, 'evidence', 'hydrator-launch.json');
  return {
    root,
    repository,
    cacheDir: path.join(root, 'native-cache', 'candidate-cache'),
    receiptOutput: path.join(root, 'receipts', 'native-cache.json'),
    stdout: path.join(root, 'evidence', 'hydrator.stdout.log'),
    stderr: path.join(root, 'evidence', 'hydrator.stderr.log'),
    launchReceipt,
    terminalReceipt: terminalReceiptPath(launchReceipt),
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

test('R62 launcher starts one detached terminal supervisor without creating cache or terminal/PASS receipt targets', (t) => {
  const paths = fixture(t);
  let spawnCall = null;
  let unrefCount = 0;
  const spawnImpl = (command, args, settings) => {
    assert.equal(existsSync(paths.cacheDir), false, 'launcher must not precreate native cache dir');
    assert.equal(existsSync(paths.receiptOutput), false, 'launcher must not precreate native PASS receipt');
    assert.equal(existsSync(paths.terminalReceipt), false, 'launcher must not precreate terminal receipt');
    spawnCall = { command, args, settings };
    return {
      pid: 4242,
      unref() { unrefCount += 1; },
    };
  };

  const receipt = launchNativeCacheHydrator(options(paths), { spawnImpl });
  assert.equal(receipt.status, 'LAUNCHED');
  assert.equal(receipt.processId, 4242);
  assert.equal(receipt.terminalSupervisorPid, 4242);
  assert.equal(receipt.processRole, 'native-cache-terminal-supervisor');
  assert.equal(receipt.detached, true);
  assert.equal(receipt.shell, false);
  assert.equal(receipt.launchReceiptIsTerminal, false);
  assert.equal(receipt.terminalReceiptRequired, true);
  assert.equal(receipt.terminalReceipt, paths.terminalReceipt);
  assert.equal(receipt.launcherDidCreateCacheDir, false);
  assert.equal(receipt.launcherDidCreateReceiptOutput, false);
  assert.equal(receipt.launcherDidCreateTerminalReceipt, false);
  assert.equal(receipt.candidateMayStartBeforeTerminalPass, false);
  assert.equal(receipt.automaticRetry, false);
  assert.equal(receipt.replacementProcessAllowed, false);
  assert.equal(unrefCount, 1);

  assert.equal(existsSync(paths.cacheDir), false);
  assert.equal(existsSync(paths.receiptOutput), false);
  assert.equal(existsSync(paths.terminalReceipt), false);
  assert.equal(existsSync(paths.stdout), true);
  assert.equal(existsSync(paths.stderr), true);
  assert.equal(existsSync(paths.launchReceipt), true);

  assert.equal(spawnCall.command, process.execPath);
  assert.equal(spawnCall.settings.cwd, paths.repository);
  assert.equal(spawnCall.settings.detached, true);
  assert.equal(spawnCall.settings.shell, false);
  assert.equal(Object.hasOwn(spawnCall.settings.env, 'NODE_OPTIONS'), false);
  assert.equal(Object.hasOwn(spawnCall.settings.env, 'COPILOT_NATIVE_COMMAND_WATCHDOG_LOG'), false);
  assert.equal(
    spawnCall.args[0],
    path.join(paths.repository, 'scripts/candidate-r30/native-cache-terminal-supervisor.mjs'),
  );
  assert.ok(spawnCall.args.includes('--repository'));
  assert.ok(spawnCall.args.includes(paths.repository));
  assert.ok(spawnCall.args.includes('--cache-dir'));
  assert.ok(spawnCall.args.includes(paths.cacheDir));
  assert.ok(spawnCall.args.includes('--receipt-output'));
  assert.ok(spawnCall.args.includes(paths.receiptOutput));
  assert.ok(spawnCall.args.includes('--terminal-receipt'));
  assert.ok(spawnCall.args.includes(paths.terminalReceipt));
  assert.ok(spawnCall.args.includes('--hydrator-script'));
  assert.ok(spawnCall.args.includes(path.join(
    paths.repository,
    'scripts/candidate-r30/npm-native-cache-hydrate.mjs',
  )));
  assert.ok(spawnCall.args.includes('--watchdog-script'));
  assert.equal(spawnCall.args.includes('setsid'), false);

  const diskReceipt = JSON.parse(readFileSync(paths.launchReceipt, 'utf8'));
  assert.equal(diskReceipt.processId, 4242);
  assert.equal(diskReceipt.terminalSupervisorPid, 4242);
  assert.equal(diskReceipt.terminalReceipt, paths.terminalReceipt);
  assert.equal(diskReceipt.terminalStateOwnedBy, 'source-owned-detached-supervisor');
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

test('R62 launcher refuses an existing terminal receipt and never overwrites it', (t) => {
  const paths = fixture(t);
  mkdirSync(path.dirname(paths.terminalReceipt), { recursive: true });
  writeFileSync(paths.terminalReceipt, 'immutable-terminal\n');

  assert.throws(
    () => launchNativeCacheHydrator(options(paths), {
      spawnImpl: () => { throw new Error('must not spawn'); },
    }),
    (error) => error instanceof NativeCacheBackgroundLaunchBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_OUTPUT_EXISTS',
  );
  assert.equal(readFileSync(paths.terminalReceipt, 'utf8'), 'immutable-terminal\n');
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
