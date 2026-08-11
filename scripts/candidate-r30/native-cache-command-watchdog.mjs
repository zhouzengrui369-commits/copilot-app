import childProcess from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import {
  NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
  NATIVE_COMMAND_WATCHDOG_SCHEMA_VERSION,
  NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
} from './native-cache-command-watchdog-policy.mjs';

const WATCHDOG_LOG_ENV = 'COPILOT_NATIVE_COMMAND_WATCHDOG_LOG';

function isoNow(nowMs) {
  return new Date(nowMs).toISOString();
}

function defaultKillGroup(pid, signal) {
  process.kill(-pid, signal);
}

export function createNativeCommandWatchdogSpawn({
  spawnImpl = childProcess.spawn,
  timeoutMs = NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
  killGraceMs = NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
  auditEvent = () => {},
  killGroup = defaultKillGroup,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('native command watchdog timeout must be a positive integer');
  }
  if (!Number.isInteger(killGraceMs) || killGraceMs < 0) {
    throw new TypeError('native command watchdog kill grace must be a non-negative integer');
  }

  return function watchedSpawn(command, args = [], options = {}) {
    const startedAtMs = now();
    const child = spawnImpl(command, args, {
      ...options,
      detached: true,
    });
    const pid = Number.isInteger(child?.pid) && child.pid > 0 ? child.pid : null;
    let closed = false;
    let timedOut = false;
    let hardKillTimer = null;

    auditEvent({
      schemaVersion: NATIVE_COMMAND_WATCHDOG_SCHEMA_VERSION,
      event: 'COMMAND_STARTED',
      pid,
      command: String(command),
      args: Array.from(args, (value) => String(value)),
      cwd: options?.cwd ?? null,
      timeoutMs,
      killGraceMs,
      startedAt: isoNow(startedAtMs),
    });

    const finishAudit = (event, extra = {}) => {
      const endedAtMs = now();
      auditEvent({
        schemaVersion: NATIVE_COMMAND_WATCHDOG_SCHEMA_VERSION,
        event,
        pid,
        timedOut,
        startedAt: isoNow(startedAtMs),
        endedAt: isoNow(endedAtMs),
        durationMs: Math.max(0, endedAtMs - startedAtMs),
        ...extra,
      });
    };

    const timeoutTimer = setTimer(() => {
      if (closed) return;
      timedOut = true;
      finishAudit('COMMAND_TIMEOUT', { signal: 'SIGTERM' });
      try {
        child?.stderr?.emit?.(
          'data',
          Buffer.from(`\nCOPILOT_NATIVE_COMMAND_WATCHDOG_TIMEOUT timeoutMs=${timeoutMs}\n`),
        );
      } catch {
        // The durable watchdog audit remains the source of truth.
      }
      if (pid !== null) {
        try {
          killGroup(pid, 'SIGTERM');
          finishAudit('COMMAND_SIGNAL_SENT', { signal: 'SIGTERM' });
        } catch (error) {
          finishAudit('COMMAND_SIGNAL_ERROR', {
            signal: 'SIGTERM',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        hardKillTimer = setTimer(() => {
          if (closed) return;
          try {
            killGroup(pid, 'SIGKILL');
            finishAudit('COMMAND_SIGNAL_SENT', { signal: 'SIGKILL' });
          } catch (error) {
            finishAudit('COMMAND_SIGNAL_ERROR', {
              signal: 'SIGKILL',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }, killGraceMs);
        hardKillTimer?.unref?.();
      }
    }, timeoutMs);
    timeoutTimer?.unref?.();

    child?.once?.('error', (error) => {
      finishAudit('COMMAND_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child?.once?.('close', (status, signal) => {
      if (closed) return;
      closed = true;
      clearTimer(timeoutTimer);
      if (hardKillTimer) clearTimer(hardKillTimer);
      finishAudit('COMMAND_CLOSED', {
        exitCode: status ?? null,
        signal: signal ?? null,
      });
    });
    return child;
  };
}

function createDurableAudit(logPath) {
  if (!path.isAbsolute(logPath)) {
    throw new TypeError('native command watchdog log must be absolute');
  }
  mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const fd = openSync(logPath, 'wx', 0o600);
  let closed = false;
  return {
    append(event) {
      if (closed) return;
      writeSync(fd, `${JSON.stringify(event)}\n`, null, 'utf8');
      fsyncSync(fd);
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
    },
  };
}

export function installNativeCommandWatchdogFromEnvironment() {
  const logPath = process.env[WATCHDOG_LOG_ENV];
  if (!logPath) return null;

  const audit = createDurableAudit(logPath);
  const originalSpawn = childProcess.spawn;
  const watchedSpawn = createNativeCommandWatchdogSpawn({
    spawnImpl: originalSpawn,
    auditEvent: (event) => audit.append(event),
  });

  // The preload is authority for this hydrator process only. Never propagate it to npm,
  // lifecycle scripts, sandboxed children, or Candidate execution.
  delete process.env[WATCHDOG_LOG_ENV];
  delete process.env.NODE_OPTIONS;

  childProcess.spawn = watchedSpawn;
  syncBuiltinESMExports();

  audit.append({
    schemaVersion: NATIVE_COMMAND_WATCHDOG_SCHEMA_VERSION,
    event: 'WATCHDOG_INSTALLED',
    processId: process.pid,
    timeoutMs: NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
    killGraceMs: NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
    installedAt: new Date().toISOString(),
  });
  process.once('exit', () => audit.close());

  return {
    logPath,
    timeoutMs: NATIVE_COMMAND_WATCHDOG_TIMEOUT_MS,
    killGraceMs: NATIVE_COMMAND_WATCHDOG_KILL_GRACE_MS,
  };
}

installNativeCommandWatchdogFromEnvironment();
