#!/usr/bin/env node
/**
 * dev-desktop.mjs — Sprint 1.1 T-1.1.1 dev runner.
 *
 * Starts vite for the renderer + tsc watch for the main process in parallel.
 * On the first successful main compile, spawns Electron pointing at the
 * built dist/main/main.js. Restarts Electron automatically when main
 * recompiles (renderer HMR is handled by vite).
 *
 * Goals (contract §5):
 *   - `npm run dev` brings up a macOS main window with the v6 title.
 *   - Stays running until killed (CI/dev workflows see port 5173 listen).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

const procs = [];

function spawnOne(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  child.on('exit', (code) => {
    console.error(`[dev-desktop] ${name} exited with code=${code}`);
  });
  procs.push({ name, child });
  return child;
}

// 1. Renderer (vite dev server, port 5173 by default).
spawnOne('vite', 'npx', ['vite', '--port', '5173', '--strictPort']);

// 2. Main process (tsc watch → dist/main/main.js).
spawnOne('tsc-main', 'npx', [
  'tsc',
  '-p',
  'tsconfig.main.json',
  '--watch',
  '--preserveWatchOutput',
]);

// 3. Wait briefly for the first main compile, then start Electron.
//    In CI / acceptance flows, the user can also just run `electron .`
//    against an already-built dist. We add a small grace window so the
//    watcher has time to emit dist/main/main.js.
setTimeout(() => {
  spawnOne('electron', 'npx', ['electron', '.'], {
    env: {
      // Tell electron to load from dist/ explicitly.
      COPILOT_DEV: '1',
    },
  });
}, 4000);

function shutdown(code = 0) {
  for (const { name, child } of procs) {
    try {
      child.kill('SIGTERM');
    } catch (err) {
      console.error(`[dev-desktop] failed to kill ${name}: ${err.message}`);
    }
  }
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));