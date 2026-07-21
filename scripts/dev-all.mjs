#!/usr/bin/env node
/**
 * dev-all.mjs
 *
 * One command boots the full OpenClaw Workbench dev stack:
 *   1. Fastify server (apps/server) on :38888 — build first if dist is stale.
 *   2. Vite dev server (apps/web) on :38889 — HMR enabled.
 *   3. Electron desktop shell — loads vite (NJX_COPILOT_LOAD_VITE=1).
 *
 * On Ctrl-C, kills all three child processes cleanly.
 *
 * This wraps the desktop dev orchestrator (apps/desktop/scripts/dev-desktop.mjs)
 * but does the vite bring-up itself so the developer doesn't have to spawn
 * vite in a second terminal. It also passes the workbench env explicitly so
 * the Fastify server picks up the unified `OPENCLAW_DATA_DIR` if the desktop
 * shell has set one.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const VITE_URL = process.env.OPENCLAW_WEB_PREVIEW_URL || "http://127.0.0.1:38889";
const SERVER_URL = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const VITE_PORT = Number(new URL(VITE_URL).port || 80);
const SERVER_PORT = Number(new URL(SERVER_URL).port || 80);
const VITE_READY_TIMEOUT_MS = 30_000;
const SERVER_READY_TIMEOUT_MS = 60_000;

const children = [];

function log(prefix, msg) {
  process.stdout.write(`[${prefix}] ${msg}`);
}

function spawnLogged(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  children.push(child);
  child.stdout?.on("data", (b) => process.stdout.write(`[${name}] ${b}`));
  child.stderr?.on("data", (b) => process.stderr.write(`[${name}] ${b}`));
  child.on("exit", (code, signal) => {
    log(name, `exited code=${code} signal=${signal}\n`);
  });
  return child;
}

function probe(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/health", method: "GET", timeout: 1500 },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForServer(port, label, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probe(port)) {
      log("dev", `${label} ready on :${port}\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} did not respond on :${port} within ${timeoutMs}ms`);
}

function killAll(signal = "SIGTERM") {
  for (const c of children) {
    try { c.kill(signal); } catch {}
  }
}

function shutdown(reason, exitCode = 0) {
  log("dev", `${reason}, shutting down…\n`);
  killAll("SIGTERM");
  setTimeout(() => process.exit(exitCode), 800);
}

process.on("SIGINT", () => shutdown("received SIGINT"));
process.on("SIGTERM", () => shutdown("received SIGTERM"));

// 1. Start vite (apps/web) — proxies /api -> :38888, so the Fastify server
//    must be up before vite's HMR has data, but vite itself can boot first.
const vite = spawnLogged("vite", "npm", ["--prefix", repoRoot, "run", "dev:web"]);

// 2. Start the Fastify server via npm run dev:server (which builds then runs).
//    Use the desktop dev orchestrator for the Electron part.
const server = spawnLogged(
  "server",
  "npm",
  ["--prefix", repoRoot, "run", "dev:server"],
);

// 3. Hand off to the existing desktop dev launcher, which manages Electron
//    lifecycle and tears the server/vite down on exit. We just need to wait
//    for the server to be ready before launching it.
(async () => {
  try {
    await waitForServer(SERVER_PORT, "fastify", SERVER_READY_TIMEOUT_MS);
    await waitForServer(VITE_PORT, "vite", VITE_READY_TIMEOUT_MS);

    log("dev", "launching Electron desktop shell…\n");
    const electron = spawnLogged(
      "desktop",
      "npm",
      ["--prefix", repoRoot, "run", "dev:desktop"],
      {
        env: {
          ...process.env,
          NJX_COPILOT_LOAD_VITE: "1",
          NJX_COPILOT_VITE_URL: VITE_URL,
          OPENCLAW_WEB_PROXY_TARGET: SERVER_URL,
        },
      },
    );

    electron.on("exit", (code) => {
      log("dev", `desktop exited (code=${code})\n`);
      killAll("SIGTERM");
      setTimeout(() => process.exit(code ?? 0), 500);
    });
  } catch (err) {
    log("dev", `FATAL: ${err.message}\n`);
    killAll("SIGTERM");
    setTimeout(() => process.exit(1), 500);
  }
})();
