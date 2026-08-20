import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
  NativeCacheTerminalSupervisorBlocked,
  parseNativeCacheTerminalSupervisorArgs,
  superviseNativeCacheHydration,
  terminalOutcome,
  writeExclusiveTerminalReceipt,
} from './native-cache-terminal-supervisor.mjs';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OWNER_AUTHORITY = 'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'copilot-terminal-supervisor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo');
  const scriptDir = path.join(repository, 'scripts/candidate-r30');
  mkdirSync(scriptDir, { recursive: true });
  const hydratorScript = path.join(scriptDir, 'npm-native-cache-hydrate.mjs');
  const watchdogScript = path.join(scriptDir, 'native-cache-command-watchdog.mjs');
  writeFileSync(hydratorScript, '#!/usr/bin/env node\n', { mode: 0o700 });
  writeFileSync(watchdogScript, '#!/usr/bin/env node\n', { mode: 0o700 });
  return {
    root,
    repository,
    cacheDir: path.join(root, 'cache'),
    receiptOutput: path.join(root, 'receipt', 'native-cache.json'),
    terminalReceipt: path.join(root, 'evidence', 'hydrator.terminal.json'),
    hydratorScript,
    watchdogScript,
    watchdogLog: path.join(root, 'evidence', 'hydrator.command-watchdog.jsonl'),
  };
}

function options(paths) {
  return {
    repository: paths.repository,
    sourceCommit: SOURCE_COMMIT,
    cacheDir: paths.cacheDir,
    receiptOutput: paths.receiptOutput,
    ownerAuthority: OWNER_AUTHORITY,
    terminalReceipt: paths.terminalReceipt,
    hydratorScript: paths.hydratorScript,
    watchdogScript: paths.watchdogScript,
    watchdogLog: paths.watchdogLog,
  };
}

function fakeChild(pid = 7001) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = () => true;
  return child;
}

test('terminal supervisor parser requires exact absolute bounded authority', () => {
  const paths = {
    repository: '/tmp/repo',
    cacheDir: '/tmp/cache',
    receiptOutput: '/tmp/receipt.json',
    terminalReceipt: '/tmp/terminal.json',
    hydratorScript: '/tmp/hydrator.mjs',
    watchdogScript: '/tmp/watchdog.mjs',
    watchdogLog: '/tmp/watchdog.jsonl',
  };
  const parsed = parseNativeCacheTerminalSupervisorArgs([
    '--repository', paths.repository,
    '--source-commit', SOURCE_COMMIT,
    '--cache-dir', paths.cacheDir,
    '--receipt-output', paths.receiptOutput,
    '--owner-authority', OWNER_AUTHORITY,
    '--terminal-receipt', paths.terminalReceipt,
    '--hydrator-script', paths.hydratorScript,
    '--watchdog-script', paths.watchdogScript,
    '--watchdog-log', paths.watchdogLog,
  ]);
  assert.equal(parsed.sourceCommit, SOURCE_COMMIT);
  assert.equal(parsed.terminalReceipt, paths.terminalReceipt);

  assert.throws(
    () => parseNativeCacheTerminalSupervisorArgs([
      '--repository', 'relative/repo',
      '--source-commit', SOURCE_COMMIT,
      '--cache-dir', paths.cacheDir,
      '--receipt-output', paths.receiptOutput,
      '--owner-authority', OWNER_AUTHORITY,
      '--terminal-receipt', paths.terminalReceipt,
      '--hydrator-script', paths.hydratorScript,
      '--watchdog-script', paths.watchdogScript,
      '--watchdog-log', paths.watchdogLog,
    ]),
    (error) => error instanceof NativeCacheTerminalSupervisorBlocked,
  );
});

test('terminal outcome can PASS only after zero exit and validated hydration receipt', () => {
  assert.deepEqual(
    terminalOutcome({ exitCode: 0, signal: null, passReceiptValidated: true }),
    { status: 'PASS', blockerCode: null, blockerDetail: null },
  );
  assert.equal(
    terminalOutcome({ exitCode: 2, signal: null, passReceiptValidated: false }).blockerCode,
    'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_EXIT',
  );
  assert.equal(
    terminalOutcome({ exitCode: 0, signal: 'SIGTERM', passReceiptValidated: false }).blockerCode,
    'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_SIGNAL',
  );
  assert.equal(
    terminalOutcome({
      exitCode: 0,
      signal: null,
      passReceiptValidated: false,
      validationErrorCode: 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
    }).blockerCode,
    'BLOCKED_NATIVE_CACHE_TERMINAL_PASS_RECEIPT_INVALID',
  );
});

test('detached terminal supervisor writes PASS only after existing validator accepts exact receipt/cache identity', async (t) => {
  const paths = fixture(t);
  const child = fakeChild(7101);
  let validateCalls = 0;
  const run = superviseNativeCacheHydration(options(paths), {
    spawnImpl: (command, args, settings) => {
      assert.equal(command, process.execPath);
      assert.equal(settings.cwd, paths.repository);
      assert.equal(settings.detached, false);
      assert.equal(settings.shell, false);
      assert.ok(settings.env.NODE_OPTIONS.includes('native-cache-command-watchdog.mjs'));
      assert.equal(settings.env.COPILOT_NATIVE_COMMAND_WATCHDOG_LOG, paths.watchdogLog);
      assert.ok(args.includes(paths.receiptOutput));
      return child;
    },
    validateReceiptImpl: async (input) => {
      validateCalls += 1;
      assert.equal(input.repository, paths.repository);
      assert.equal(input.sourceCommit, SOURCE_COMMIT);
      assert.equal(input.cacheDir, paths.cacheDir);
      assert.equal(input.receiptPath, paths.receiptOutput);
      return {
        receiptSha256: 'a'.repeat(64),
        cacheIdentity: { aggregateSha256: 'b'.repeat(64) },
      };
    },
  });
  queueMicrotask(() => child.emit('close', 0, null));
  const receipt = await run;
  assert.equal(validateCalls, 1);
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.hydratorPid, 7101);
  assert.equal(receipt.passReceiptValidated, true);
  assert.equal(receipt.passReceiptSha256, 'a'.repeat(64));
  assert.equal(receipt.cacheIdentitySha256, 'b'.repeat(64));
  assert.equal(receipt.automaticRetry, false);
  assert.equal(receipt.candidateCreated, false);
  assert.equal(existsSync(paths.terminalReceipt), true);
  assert.equal(JSON.parse(readFileSync(paths.terminalReceipt, 'utf8')).status, 'PASS');
});

test('non-zero hydrator exit is durably BLOCKED and never invokes PASS validator', async (t) => {
  const paths = fixture(t);
  const child = fakeChild(7201);
  let validateCalls = 0;
  const run = superviseNativeCacheHydration(options(paths), {
    spawnImpl: () => child,
    validateReceiptImpl: async () => {
      validateCalls += 1;
      throw new Error('must not validate a failed hydrator');
    },
  });
  queueMicrotask(() => child.emit('close', 2, null));
  const receipt = await run;
  assert.equal(validateCalls, 0);
  assert.equal(receipt.status, 'BLOCKED');
  assert.equal(receipt.blockerCode, 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_EXIT');
  assert.equal(receipt.exitCode, 2);
  assert.equal(receipt.passReceiptValidated, false);
  assert.equal(JSON.parse(readFileSync(paths.terminalReceipt, 'utf8')).status, 'BLOCKED');
});

test('zero exit with missing or invalid PASS receipt remains durably BLOCKED', async (t) => {
  const paths = fixture(t);
  const child = fakeChild(7301);
  const run = superviseNativeCacheHydration(options(paths), {
    spawnImpl: () => child,
    validateReceiptImpl: async () => {
      const error = new Error('receipt missing');
      error.code = 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID';
      throw error;
    },
  });
  queueMicrotask(() => child.emit('close', 0, null));
  const receipt = await run;
  assert.equal(receipt.status, 'BLOCKED');
  assert.equal(receipt.blockerCode, 'BLOCKED_NATIVE_CACHE_TERMINAL_PASS_RECEIPT_INVALID');
  assert.equal(receipt.passReceiptValidated, false);
  assert.match(receipt.blockerDetail, /BLOCKED_NATIVE_CACHE_RECEIPT_INVALID/u);
});

test('terminal receipt is exclusive and cannot be overwritten', async (t) => {
  const paths = fixture(t);
  const document = { schemaVersion: 1, status: 'BLOCKED' };
  await writeExclusiveTerminalReceipt(paths.terminalReceipt, document);
  await assert.rejects(
    () => writeExclusiveTerminalReceipt(paths.terminalReceipt, { ...document, status: 'PASS' }),
    (error) => error?.code === 'EEXIST',
  );
  assert.equal(JSON.parse(readFileSync(paths.terminalReceipt, 'utf8')).status, 'BLOCKED');
});
