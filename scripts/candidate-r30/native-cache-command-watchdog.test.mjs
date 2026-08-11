import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeCommandWatchdogSpawn } from './native-cache-command-watchdog.mjs';

test('hydration command watchdog makes one child process group bounded and auditable', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stderr = new EventEmitter();
  const audit = [];
  const signals = [];
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

  await delay(80);
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

test('hydration command watchdog preserves a normally completed child without retry or signals', async () => {
  const child = new EventEmitter();
  child.pid = 4343;
  child.stderr = new EventEmitter();
  const audit = [];
  const signals = [];

  const watchedSpawn = createNativeCommandWatchdogSpawn({
    timeoutMs: 100,
    killGraceMs: 20,
    spawnImpl() { return child; },
    auditEvent(event) { audit.push(event); },
    killGroup(pid, signal) { signals.push([pid, signal]); },
  });

  watchedSpawn('/usr/bin/example', [], { cwd: '/tmp', env: {} });
  child.emit('close', 0, null);
  await delay(130);

  assert.deepEqual(signals, []);
  const closed = audit.find((event) => event.event === 'COMMAND_CLOSED');
  assert.equal(closed.exitCode, 0);
  assert.equal(closed.timedOut, false);
  assert.equal(audit.some((event) => event.event === 'COMMAND_TIMEOUT'), false);
});
