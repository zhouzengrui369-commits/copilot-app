import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeCommandWatchdogSpawn } from './native-cache-command-watchdog.mjs';

function createManualTimers() {
  let nextId = 1;
  const pending = [];

  function setTimer(callback, delayMs) {
    const timer = {
      id: nextId,
      delayMs,
      callback,
      unref() {},
    };
    nextId += 1;
    pending.push(timer);
    return timer;
  }

  function clearTimer(timer) {
    const index = pending.findIndex((candidate) => candidate.id === timer?.id);
    if (index >= 0) pending.splice(index, 1);
  }

  function runNext() {
    const timer = pending.shift();
    assert.ok(timer, 'expected one pending watchdog timer');
    timer.callback();
  }

  return {
    setTimer,
    clearTimer,
    runNext,
    pendingDelays: () => pending.map((timer) => timer.delayMs),
  };
}

test('hydration command watchdog makes one child process group bounded and auditable', () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stderr = new EventEmitter();
  const audit = [];
  const signals = [];
  const timers = createManualTimers();
  let diagnostic = '';
  let spawnSettings = null;
  child.stderr.on('data', (chunk) => { diagnostic += String(chunk); });

  const watchedSpawn = createNativeCommandWatchdogSpawn({
    timeoutMs: 40,
    killGraceMs: 20,
    spawnImpl(command, args, settings) {
      spawnSettings = { command, args, settings };
      return child;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    auditEvent(event) { audit.push(event); },
    killGroup(pid, signal) { signals.push([pid, signal]); },
  });

  const returned = watchedSpawn('/usr/bin/example', ['--bounded'], {
    cwd: '/tmp',
    env: {},
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  assert.equal(returned, child);
  assert.equal(spawnSettings.settings.detached, true);
  assert.equal(audit[0].event, 'COMMAND_STARTED');
  assert.equal(audit[0].pid, 4242);
  assert.equal(audit[0].timeoutMs, 40);

  assert.deepEqual(timers.pendingDelays(), [40]);
  timers.runNext();
  assert.deepEqual(signals, [[4242, 'SIGTERM']]);
  assert.deepEqual(timers.pendingDelays(), [20]);
  timers.runNext();
  assert.deepEqual(signals, [
    [4242, 'SIGTERM'],
    [4242, 'SIGKILL'],
  ]);
  assert.match(diagnostic, /COPILOT_NATIVE_COMMAND_WATCHDOG_TIMEOUT/u);
  assert.ok(audit.some((event) => event.event === 'COMMAND_TIMEOUT'));
  assert.ok(audit.some((event) => event.event === 'COMMAND_SIGNAL_SENT' && event.signal === 'SIGTERM'));
  assert.ok(audit.some((event) => event.event === 'COMMAND_SIGNAL_SENT' && event.signal === 'SIGKILL'));

  child.emit('close', null, 'SIGKILL');
  assert.ok(audit.some((event) => event.event === 'COMMAND_CLOSED' && event.timedOut === true));
});

test('hydration command watchdog preserves a normally completed child without retry or signals', () => {
  const child = new EventEmitter();
  child.pid = 4343;
  child.stderr = new EventEmitter();
  const audit = [];
  const signals = [];
  const timers = createManualTimers();

  const watchedSpawn = createNativeCommandWatchdogSpawn({
    timeoutMs: 100,
    killGraceMs: 20,
    spawnImpl() { return child; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    auditEvent(event) { audit.push(event); },
    killGroup(pid, signal) { signals.push([pid, signal]); },
  });

  watchedSpawn('/usr/bin/example', [], { cwd: '/tmp', env: {} });
  child.emit('close', 0, null);

  assert.deepEqual(signals, []);
  assert.deepEqual(timers.pendingDelays(), []);
  const closed = audit.find((event) => event.event === 'COMMAND_CLOSED');
  assert.equal(closed.exitCode, 0);
  assert.equal(closed.timedOut, false);
  assert.equal(audit.some((event) => event.event === 'COMMAND_TIMEOUT'), false);
});

test('hydration command watchdog cancels hard kill when the child closes during grace', () => {
  const child = new EventEmitter();
  child.pid = 4444;
  child.stderr = new EventEmitter();
  const audit = [];
  const signals = [];
  const timers = createManualTimers();

  const watchedSpawn = createNativeCommandWatchdogSpawn({
    timeoutMs: 40,
    killGraceMs: 20,
    spawnImpl() { return child; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    auditEvent(event) { audit.push(event); },
    killGroup(pid, signal) { signals.push([pid, signal]); },
  });

  watchedSpawn('/usr/bin/example', [], { cwd: '/tmp', env: {} });
  timers.runNext();
  child.emit('close', null, 'SIGTERM');

  assert.deepEqual(signals, [[4444, 'SIGTERM']]);
  assert.deepEqual(timers.pendingDelays(), []);
  assert.equal(audit.some((event) => event.event === 'COMMAND_SIGNAL_SENT' && event.signal === 'SIGKILL'), false);
  assert.ok(audit.some((event) => event.event === 'COMMAND_CLOSED' && event.signal === 'SIGTERM'));
});
