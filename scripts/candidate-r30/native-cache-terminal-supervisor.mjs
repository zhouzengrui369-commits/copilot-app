#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateNativeHydrationReceipt } from './native-cache-policy.mjs';

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const OWNER_AUTHORITY = 'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';

export class NativeCacheTerminalSupervisorBlocked extends Error {
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'NativeCacheTerminalSupervisorBlocked';
    this.code = code;
    this.detail = detail;
    this.context = context;
  }
}

function block(code, detail, context = {}) {
  throw new NativeCacheTerminalSupervisorBlocked(code, detail, context);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    block('BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT', `missing value for ${flag}`);
  }
  return value;
}

function requireAbsolute(label, value) {
  if (!value || !path.isAbsolute(value)) {
    block('BLOCKED_NATIVE_CACHE_TERMINAL_PATH', `${label} must be absolute`, {
      label,
      value: value ?? null,
    });
  }
  return path.resolve(value);
}

function inside(parent, child) {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
}

async function requireRegularNonSymlink(label, file) {
  let value;
  try {
    value = await lstat(file);
  } catch (error) {
    block('BLOCKED_NATIVE_CACHE_TERMINAL_SCRIPT', `${label} is missing`, {
      label,
      file,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!value.isFile() || value.isSymbolicLink()) {
    block(
      'BLOCKED_NATIVE_CACHE_TERMINAL_SCRIPT',
      `${label} must be a regular non-symlink file`,
      { label, file },
    );
  }
}

export function parseNativeCacheTerminalSupervisorArgs(argv) {
  const parsed = {
    repository: null,
    sourceCommit: null,
    cacheDir: null,
    receiptOutput: null,
    ownerAuthority: null,
    terminalReceipt: null,
    hydratorScript: null,
    watchdogScript: null,
    watchdogLog: null,
  };
  const flags = new Map([
    ['--repository', 'repository'],
    ['--source-commit', 'sourceCommit'],
    ['--cache-dir', 'cacheDir'],
    ['--receipt-output', 'receiptOutput'],
    ['--owner-authority', 'ownerAuthority'],
    ['--terminal-receipt', 'terminalReceipt'],
    ['--hydrator-script', 'hydratorScript'],
    ['--watchdog-script', 'watchdogScript'],
    ['--watchdog-log', 'watchdogLog'],
  ]);
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) {
      block('BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT', `unknown argument ${String(flag)}`);
    }
    if (seen.has(flag)) {
      block('BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT', `duplicate argument ${flag}`);
    }
    seen.add(flag);
    parsed[key] = requiredValue(argv, ++index, flag);
  }

  for (const [flag, key] of flags) {
    if (!seen.has(flag) || !parsed[key]) {
      block('BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT', `required argument ${flag} is missing`);
    }
  }
  if (!FULL_COMMIT.test(parsed.sourceCommit)) {
    block(
      'BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT',
      'source commit must be exactly 40 lower-case hex characters',
    );
  }
  if (parsed.ownerAuthority !== OWNER_AUTHORITY) {
    block(
      'BLOCKED_NATIVE_CACHE_TERMINAL_ARGUMENT',
      'exact bounded native-toolchain owner authority token is required',
    );
  }

  const result = {
    ...parsed,
    repository: requireAbsolute('repository', parsed.repository),
    cacheDir: requireAbsolute('cache dir', parsed.cacheDir),
    receiptOutput: requireAbsolute('hydration PASS receipt', parsed.receiptOutput),
    terminalReceipt: requireAbsolute('terminal receipt', parsed.terminalReceipt),
    hydratorScript: requireAbsolute('hydrator script', parsed.hydratorScript),
    watchdogScript: requireAbsolute('watchdog script', parsed.watchdogScript),
    watchdogLog: requireAbsolute('watchdog log', parsed.watchdogLog),
  };
  if (inside(result.cacheDir, result.terminalReceipt) || inside(result.cacheDir, result.watchdogLog)) {
    block(
      'BLOCKED_NATIVE_CACHE_TERMINAL_PATH',
      'terminal evidence must stay outside the native cache target',
    );
  }
  return result;
}

export async function writeExclusiveTerminalReceipt(file, document) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    const directory = await open(path.dirname(file), fsConstants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // File fsync above is the required durability boundary. Directory fsync is best-effort.
  }
}

function cleanSupervisorChildEnvironment(watchdogScript, watchdogLog) {
  const {
    NODE_OPTIONS: _nodeOptions,
    COPILOT_NATIVE_COMMAND_WATCHDOG_LOG: _watchdogLog,
    ...base
  } = process.env;
  return {
    ...base,
    NODE_OPTIONS: `--import=${pathToFileURL(watchdogScript).href}`,
    COPILOT_NATIVE_COMMAND_WATCHDOG_LOG: watchdogLog,
  };
}

export function terminalOutcome({ exitCode, signal, passReceiptValidated, validationErrorCode = null }) {
  if (signal) {
    return {
      status: 'BLOCKED',
      blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_SIGNAL',
      blockerDetail: `hydrator terminated by ${signal}`,
    };
  }
  if (exitCode !== 0) {
    return {
      status: 'BLOCKED',
      blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_EXIT',
      blockerDetail: `hydrator exited with code ${String(exitCode)}`,
    };
  }
  if (!passReceiptValidated) {
    return {
      status: 'BLOCKED',
      blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_PASS_RECEIPT_INVALID',
      blockerDetail: validationErrorCode
        ? `hydrator exited zero but PASS receipt validation failed: ${validationErrorCode}`
        : 'hydrator exited zero but no valid PASS receipt was proven',
    };
  }
  return {
    status: 'PASS',
    blockerCode: null,
    blockerDetail: null,
  };
}

export async function superviseNativeCacheHydration(
  options,
  { spawnImpl = spawn, validateReceiptImpl = validateNativeHydrationReceipt } = {},
) {
  const repository = await realpath(options.repository);
  await requireRegularNonSymlink('hydrator script', options.hydratorScript);
  await requireRegularNonSymlink('command watchdog script', options.watchdogScript);

  let terminalExists = false;
  try {
    await lstat(options.terminalReceipt);
    terminalExists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (terminalExists) {
    block(
      'BLOCKED_NATIVE_CACHE_TERMINAL_OUTPUT_EXISTS',
      'terminal receipt already exists and cannot be overwritten',
      { terminalReceipt: options.terminalReceipt },
    );
  }

  const hydratorArgs = [
    options.hydratorScript,
    '--repository', repository,
    '--source-commit', options.sourceCommit,
    '--cache-dir', options.cacheDir,
    '--receipt-output', options.receiptOutput,
    '--owner-authority', options.ownerAuthority,
  ];
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let child;

  const writeFinal = async ({
    exitCode = null,
    signal = null,
    passReceiptValidated = false,
    receiptSha256 = null,
    cacheIdentitySha256 = null,
    validationErrorCode = null,
    overrideOutcome = null,
    processErrorCode = null,
  }) => {
    const endedAtMs = Date.now();
    const outcome = overrideOutcome ?? terminalOutcome({
      exitCode,
      signal,
      passReceiptValidated,
      validationErrorCode,
    });
    const document = {
      schemaVersion: 1,
      status: outcome.status,
      sourceCommit: options.sourceCommit,
      repository,
      cacheDir: options.cacheDir,
      receiptOutput: options.receiptOutput,
      terminalReceipt: options.terminalReceipt,
      hydratorScript: options.hydratorScript,
      watchdogScript: options.watchdogScript,
      watchdogLog: options.watchdogLog,
      supervisorPid: process.pid,
      hydratorPid: Number.isInteger(child?.pid) ? child.pid : null,
      exitCode,
      signal,
      blockerCode: outcome.blockerCode,
      blockerDetail: outcome.blockerDetail,
      processErrorCode,
      passReceiptValidated,
      passReceiptSha256: SHA256.test(receiptSha256 ?? '') ? receiptSha256 : null,
      cacheIdentitySha256: SHA256.test(cacheIdentitySha256 ?? '') ? cacheIdentitySha256 : null,
      automaticRetry: false,
      replacementProcessAllowed: false,
      candidateCreated: false,
      terminalStateOwnedBy: 'source-owned-detached-supervisor',
      startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      elapsedMs: Math.max(0, endedAtMs - startedAtMs),
    };
    await writeExclusiveTerminalReceipt(options.terminalReceipt, document);
    return document;
  };

  try {
    child = spawnImpl(process.execPath, hydratorArgs, {
      cwd: repository,
      detached: false,
      env: cleanSupervisorChildEnvironment(options.watchdogScript, options.watchdogLog),
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: false,
    });
  } catch (error) {
    return writeFinal({
      overrideOutcome: {
        status: 'BLOCKED',
        blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_SPAWN',
        blockerDetail: 'failed to spawn the exact-source hydrator',
      },
      processErrorCode: error?.code ?? null,
    });
  }

  if (!Number.isInteger(child?.pid) || child.pid <= 0 || typeof child.once !== 'function') {
    return writeFinal({
      overrideOutcome: {
        status: 'BLOCKED',
        blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_PROCESS',
        blockerDetail: 'hydrator did not return one durable process identity',
      },
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const signalHandlers = new Map();

    const cleanup = () => {
      for (const [name, handler] of signalHandlers) process.off(name, handler);
    };

    const finish = async (details) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        resolve(await writeFinal(details));
      } catch (error) {
        reject(error);
      }
    };

    child.once('error', (error) => {
      void finish({
        overrideOutcome: {
          status: 'BLOCKED',
          blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_HYDRATOR_SPAWN',
          blockerDetail: 'hydrator process emitted a spawn/runtime error',
        },
        processErrorCode: error?.code ?? null,
      });
    });

    child.once('close', (exitCode, signal) => {
      void (async () => {
        if (exitCode !== 0 || signal) {
          await finish({ exitCode, signal });
          return;
        }
        try {
          const validated = await validateReceiptImpl({
            repository,
            sourceCommit: options.sourceCommit,
            cacheDir: options.cacheDir,
            receiptPath: options.receiptOutput,
          });
          await finish({
            exitCode,
            signal,
            passReceiptValidated: true,
            receiptSha256: validated.receiptSha256,
            cacheIdentitySha256: validated.cacheIdentity?.aggregateSha256 ?? null,
          });
        } catch (error) {
          await finish({
            exitCode,
            signal,
            passReceiptValidated: false,
            validationErrorCode: error?.code ?? error?.name ?? 'UNKNOWN_RECEIPT_VALIDATION_ERROR',
          });
        }
      })().catch(reject);
    });

    for (const name of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
      const handler = () => {
        try {
          child.kill?.('SIGTERM');
        } catch {
          // Terminal receipt below remains the authoritative fail-closed outcome.
        }
        void finish({
          signal: name,
          overrideOutcome: {
            status: 'BLOCKED',
            blockerCode: 'BLOCKED_NATIVE_CACHE_TERMINAL_SUPERVISOR_SIGNAL',
            blockerDetail: `terminal supervisor received ${name}`,
          },
        });
      };
      signalHandlers.set(name, handler);
      process.once(name, handler);
    }
  });
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const options = parseNativeCacheTerminalSupervisorArgs(process.argv.slice(2));
    const receipt = await superviseNativeCacheHydration(options);
    const output = `${JSON.stringify(receipt)}\n`;
    if (receipt.status === 'PASS') process.stdout.write(output);
    else {
      process.stderr.write(output);
      process.exitCode = 2;
    }
  } catch (error) {
    const payload = error instanceof NativeCacheTerminalSupervisorBlocked
      ? { status: 'BLOCKED', code: error.code, detail: error.detail, context: error.context }
      : { status: 'BLOCKED', code: 'BLOCKED_NATIVE_CACHE_TERMINAL_UNKNOWN', detail: String(error) };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 2;
  }
}
