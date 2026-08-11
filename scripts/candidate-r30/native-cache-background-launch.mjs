#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
  NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
} from './native-cache-command-watchdog-policy.mjs';

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const OWNER_AUTHORITY = 'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';

export class NativeCacheBackgroundLaunchBlocked extends Error {
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'NativeCacheBackgroundLaunchBlocked';
    this.code = code;
    this.detail = detail;
    this.context = context;
  }
}

function block(code, detail, context = {}) {
  throw new NativeCacheBackgroundLaunchBlocked(code, detail, context);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT', `missing value for ${flag}`);
  }
  return value;
}

function inside(parent, child) {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
}

function requireAbsolute(label, value) {
  if (!value || !path.isAbsolute(value)) {
    block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_PATH', `${label} must be absolute`, {
      label,
      value: value ?? null,
    });
  }
  return path.resolve(value);
}

function requireAbsent(label, target) {
  if (existsSync(target)) {
    block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_OUTPUT_EXISTS', `${label} already exists`, {
      label,
      target,
    });
  }
}

function watchdogLogPath(launchReceipt) {
  return launchReceipt.endsWith('.json')
    ? `${launchReceipt.slice(0, -'.json'.length)}.command-watchdog.jsonl`
    : `${launchReceipt}.command-watchdog.jsonl`;
}

export function parseNativeCacheBackgroundLaunchArgs(argv) {
  const parsed = {
    repository: null,
    sourceCommit: null,
    cacheDir: null,
    receiptOutput: null,
    ownerAuthority: null,
    stdout: null,
    stderr: null,
    launchReceipt: null,
  };
  const seen = new Set();
  const flags = new Map([
    ['--repository', 'repository'],
    ['--source-commit', 'sourceCommit'],
    ['--cache-dir', 'cacheDir'],
    ['--receipt-output', 'receiptOutput'],
    ['--owner-authority', 'ownerAuthority'],
    ['--stdout', 'stdout'],
    ['--stderr', 'stderr'],
    ['--launch-receipt', 'launchReceipt'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) {
      block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT', `unknown argument ${String(flag)}`);
    }
    if (seen.has(flag)) {
      block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT', `duplicate argument ${flag}`);
    }
    seen.add(flag);
    parsed[key] = requiredValue(argv, ++index, flag);
  }

  for (const [flag, key] of flags) {
    if (!seen.has(flag) || !parsed[key]) {
      block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT', `required argument ${flag} is missing`);
    }
  }
  if (!FULL_COMMIT.test(parsed.sourceCommit)) {
    block(
      'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT',
      'source commit must be exactly 40 lower-case hex characters',
    );
  }
  if (parsed.ownerAuthority !== OWNER_AUTHORITY) {
    block(
      'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_ARGUMENT',
      'exact bounded native-toolchain owner authority token is required',
    );
  }

  return {
    ...parsed,
    repository: requireAbsolute('repository', parsed.repository),
    cacheDir: requireAbsolute('cache dir', parsed.cacheDir),
    receiptOutput: requireAbsolute('receipt output', parsed.receiptOutput),
    stdout: requireAbsolute('stdout', parsed.stdout),
    stderr: requireAbsolute('stderr', parsed.stderr),
    launchReceipt: requireAbsolute('launch receipt', parsed.launchReceipt),
  };
}

export function nativeCacheBackgroundLaunchPlan(options) {
  const repository = requireAbsolute('repository', options.repository);
  const cacheDir = requireAbsolute('cache dir', options.cacheDir);
  const receiptOutput = requireAbsolute('receipt output', options.receiptOutput);
  const stdout = requireAbsolute('stdout', options.stdout);
  const stderr = requireAbsolute('stderr', options.stderr);
  const launchReceipt = requireAbsolute('launch receipt', options.launchReceipt);
  const watchdogLog = watchdogLogPath(launchReceipt);
  const hydratorScript = path.join(
    repository,
    'scripts/candidate-r30/npm-native-cache-hydrate.mjs',
  );
  const watchdogScript = path.join(
    repository,
    'scripts/candidate-r30/native-cache-command-watchdog.mjs',
  );

  for (const [label, target] of [
    ['cache dir', cacheDir],
    ['receipt output', receiptOutput],
    ['stdout', stdout],
    ['stderr', stderr],
    ['launch receipt', launchReceipt],
    ['command watchdog log', watchdogLog],
  ]) requireAbsent(label, target);

  for (const [label, target] of [
    ['stdout', stdout],
    ['stderr', stderr],
    ['launch receipt', launchReceipt],
    ['command watchdog log', watchdogLog],
  ]) {
    if (inside(cacheDir, target)) {
      block(
        'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_PATH',
        `${label} must not be inside the native cache target`,
        { label, target, cacheDir },
      );
    }
  }

  let hydratorStat;
  try {
    hydratorStat = lstatSync(hydratorScript);
  } catch (error) {
    block('BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_SCRIPT', 'exact-source hydrator is missing', {
      hydratorScript,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!hydratorStat.isFile() || hydratorStat.isSymbolicLink()) {
    block(
      'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_SCRIPT',
      'exact-source hydrator must be a regular non-symlink file',
      { hydratorScript },
    );
  }

  const hydratorArgs = [
    hydratorScript,
    '--repository', repository,
    '--source-commit', options.sourceCommit,
    '--cache-dir', cacheDir,
    '--receipt-output', receiptOutput,
    '--owner-authority', options.ownerAuthority,
  ];
  return {
    repository,
    cacheDir,
    receiptOutput,
    stdout,
    stderr,
    launchReceipt,
    watchdogLog,
    hydratorScript,
    watchdogScript,
    watchdogTimeoutMs: NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
    watchdogKillGraceMs: NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
    command: process.execPath,
    hydratorArgs,
  };
}

function writeLaunchDocument(fd, document) {
  writeFileSync(fd, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8' });
  fsyncSync(fd);
}

export function launchNativeCacheHydrator(options, { spawnImpl = spawn } = {}) {
  const plan = nativeCacheBackgroundLaunchPlan(options);

  // Only evidence/log parent directories may be created by the launcher.
  // The cache target and native-cache PASS receipt MUST remain absent for the hydrator itself.
  for (const file of [plan.stdout, plan.stderr, plan.launchReceipt, plan.watchdogLog]) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  const stdoutFd = openSync(plan.stdout, 'wx', 0o600);
  const stderrFd = openSync(plan.stderr, 'wx', 0o600);
  const launchFd = openSync(plan.launchReceipt, 'wx', 0o600);
  const launchedAt = new Date().toISOString();
  let child;
  try {
    child = spawnImpl(plan.command, plan.hydratorArgs, {
      cwd: plan.repository,
      detached: true,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(plan.watchdogScript).href}`,
        COPILOT_NATIVE_COMMAND_WATCHDOG_LOG: plan.watchdogLog,
      },
      stdio: ['ignore', stdoutFd, stderrFd],
      shell: false,
    });
    if (!Number.isInteger(child?.pid) || child.pid <= 0 || typeof child.unref !== 'function') {
      block(
        'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_PROCESS',
        'background hydrator did not return one durable process identity',
      );
    }
    child.unref();
    const receipt = {
      schemaVersion: 1,
      status: 'LAUNCHED',
      sourceCommit: options.sourceCommit,
      repository: plan.repository,
      cacheDir: plan.cacheDir,
      receiptOutput: plan.receiptOutput,
      hydratorScript: plan.hydratorScript,
      watchdogScript: plan.watchdogScript,
      watchdogLog: plan.watchdogLog,
      watchdogTimeoutMs: plan.watchdogTimeoutMs,
      watchdogKillGraceMs: plan.watchdogKillGraceMs,
      inheritedNodeOptionsStripped: true,
      processId: child.pid,
      detached: true,
      shell: false,
      stdout: plan.stdout,
      stderr: plan.stderr,
      launcherDidCreateCacheDir: false,
      launcherDidCreateReceiptOutput: false,
      automaticRetry: false,
      replacementProcessAllowed: false,
      launchedAt,
    };
    writeLaunchDocument(launchFd, receipt);
    return receipt;
  } catch (error) {
    const document = {
      schemaVersion: 1,
      status: 'BLOCKED',
      sourceCommit: options.sourceCommit,
      repository: plan.repository,
      cacheDir: plan.cacheDir,
      receiptOutput: plan.receiptOutput,
      watchdogScript: plan.watchdogScript,
      watchdogLog: plan.watchdogLog,
      watchdogTimeoutMs: plan.watchdogTimeoutMs,
      watchdogKillGraceMs: plan.watchdogKillGraceMs,
      launcherDidCreateCacheDir: false,
      launcherDidCreateReceiptOutput: false,
      automaticRetry: false,
      error: error instanceof Error ? error.message : String(error),
      launchedAt,
      endedAt: new Date().toISOString(),
    };
    try {
      writeLaunchDocument(launchFd, document);
    } catch {
      // Preserve the original launch failure.
    }
    if (error instanceof NativeCacheBackgroundLaunchBlocked) throw error;
    block(
      'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_PROCESS',
      'failed to start the exact-source background hydrator',
      { error: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    closeSync(launchFd);
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    const options = parseNativeCacheBackgroundLaunchArgs(process.argv.slice(2));
    const receipt = launchNativeCacheHydrator(options);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    const payload = error instanceof NativeCacheBackgroundLaunchBlocked
      ? { status: 'BLOCKED', code: error.code, detail: error.detail, context: error.context }
      : { status: 'BLOCKED', code: 'BLOCKED_NATIVE_CACHE_HYDRATION_LAUNCH_UNKNOWN', detail: String(error) };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 2;
  }
}
