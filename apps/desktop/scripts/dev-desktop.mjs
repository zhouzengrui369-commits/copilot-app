#!/usr/bin/env node
/**
 * dev-desktop.mjs
 *
 * One-shot dev orchestrator for njx-copilot:
 *   1. Builds the server (apps/server) if its dist is stale or missing.
 *   2. Spawns the server as a child process on port 38888.
 *   3. Waits for /api/health to respond.
 *   4. Launches Electron, which loads http://127.0.0.1:38888.
 *   5. On Electron exit, kills the server.
 *
 * For fast iteration, set NJX_COPILOT_LOAD_VITE=1 to point Electron at the
 * Vite dev server (apps/web) instead of the production build. The dev server
 * already proxies /api -> 38888, so the same code path is exercised.
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const serverDist = path.join(repoRoot, "apps", "server", "dist", "index.js");
// npm 7+ workspaces hoists shared / top-level deps to the root node_modules.
// Electron is only in apps/desktop/package.json, but `npm install` from the
// repo root may still hoist it, so we probe both locations. An explicit
// `NJX_COPILOT_ELECTRON_BIN` env override wins (e.g. when running against a
// pre-installed Electron.app that is not in any node_modules tree).
const electronBinCandidates = [
  path.join(repoRoot, "apps", "desktop", "node_modules", ".bin", "electron"),
  path.join(repoRoot, "node_modules", ".bin", "electron"),
];
if (process.env.NJX_COPILOT_ELECTRON_BIN) {
  electronBinCandidates.unshift(process.env.NJX_COPILOT_ELECTRON_BIN);
}
const electronBin = electronBinCandidates.find((p) => existsSync(p));
const desktopPkg = path.join(repoRoot, "apps", "desktop");

// Resolve the Electron.app directory (the bundle that holds the actual
// launcher) given a `node_modules/.bin/electron` symlink or, via the
// `NJX_COPILOT_ELECTRON_BIN` env override, a direct path to the launcher
// binary. Returns the first existing path under a list of candidates.
function electronDistApp() {
  if (!electronBin) return "";
  const candidates = [];
  // 1) Standard hoisted/local install: <node_modules>/electron/dist/Electron.app
  candidates.push(
    path.join(path.resolve(path.dirname(electronBin), ".."), "electron", "dist", "Electron.app"),
  );
  // 2) Env override pointing at the launcher binary inside Electron.app:
  //    <pkg>/dist/Electron.app/Contents/MacOS/Electron
  if (process.env.NJX_COPILOT_ELECTRON_BIN) {
    const bin = process.env.NJX_COPILOT_ELECTRON_BIN;
    if (path.basename(path.dirname(bin)) === "MacOS" && path.basename(bin) === "Electron") {
      candidates.push(path.resolve(bin, "..", "..", "..", "Electron.app"));
    }
  }
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const PORT = Number(process.env.OPENCLAW_WORKBENCH_PORT ?? 38888);
const useVite = process.env.NJX_COPILOT_LOAD_VITE === "1";

function log(prefix, msg) {
  process.stdout.write(`[${prefix}] ${msg}\n`);
}

async function ensureServerBuilt() {
  if (existsSync(serverDist)) {
    log("dev", `server dist found: ${serverDist}`);
    return;
  }
  log("dev", "server dist missing — running tsc build");
  await run("npm", ["--prefix", repoRoot, "run", "build", "--workspace", "@openclaw-workbench/server"], { stdio: "inherit" });
  if (!existsSync(serverDist)) {
    throw new Error(`server build did not produce ${serverDist}`);
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function spawnLogged(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  child.stdout.on("data", (b) => process.stdout.write(`[${name}] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`[${name}] ${b}`));
  child.on("exit", (code, signal) => log(name, `exited code=${code} signal=${signal}`));
  return child;
}

async function waitForServer(port, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await probe(port);
    if (ok) return;
    await wait(300);
  }
  throw new Error(`server did not respond on port ${port} within ${timeoutMs}ms`);
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

async function main() {
  if (!electronBin) {
    log(
      "dev",
      `Electron binary not found. Probed:\n` +
        electronBinCandidates.map((p) => `  - ${p}`).join("\n") +
        `\nIf electron is installed elsewhere, point NJX_COPILOT_ELECTRON_BIN at its .bin path.`,
    );
    process.exit(1);
  }
  if (!existsSync(electronDistApp())) {
    log(
      "dev",
      `Electron package is at ${electronBin} but dist/Electron.app is missing — the binary download sub-step never ran. Run:\n` +
        `  cd <dir containing the electron package> && ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/" node install.js`,
    );
    process.exit(1);
  }

  await ensureServerBuilt();

  log("dev", `starting server on port ${PORT}`);
  const server = spawnLogged("server", process.execPath, ["--experimental-sqlite", serverDist], {
    OPENCLAW_WORKBENCH_PORT: String(PORT),
    OPENCLAW_WORKBENCH_HOST: "127.0.0.1",
  });

  // If we're loading Vite in Electron, also spawn the Vite dev server so
  // the developer doesn't have to run it in a second terminal. We probe
  // first: if a Vite is already serving on 38889, we just reuse it.
  let vite = null;
  if (useVite) {
    const viteUp = await probe(38889);
    if (viteUp) {
      log("dev", "vite already serving on 38889 — reusing");
    } else {
      log("dev", "starting vite dev server on 38889");
      vite = spawnLogged("vite", "npm", ["--prefix", repoRoot, "run", "dev:web"], {});
    }
    // Wait for vite to come up before launching Electron so the renderer
    // doesn't race the proxy.
    try {
      await waitForServer(38889, 30_000);
      log("dev", "vite is up");
    } catch (err) {
      log("dev", `vite failed to start: ${err.message}`);
      try { vite?.kill("SIGTERM"); } catch {}
      server.kill("SIGTERM");
      process.exit(1);
    }
  }

  try {
    await waitForServer(PORT);
    log("dev", "server is up — launching Electron");
  } catch (err) {
    log("dev", `server failed to start: ${err.message}`);
    try { vite?.kill("SIGTERM"); } catch {}
    server.kill("SIGTERM");
    process.exit(1);
  }

  const electron = spawnLogged("electron", electronBin, [desktopPkg], {
    OPENCLAW_WORKBENCH_PORT: String(PORT),
    ...(useVite ? { NJX_COPILOT_LOAD_VITE: "1", NJX_COPILOT_VITE_URL: process.env.NJX_COPILOT_VITE_URL ?? "http://127.0.0.1:38889" } : {}),
  });

  const shutdown = (signal) => {
    log("dev", `received ${signal}, shutting down`);
    try { electron.kill("SIGTERM"); } catch {}
    try { vite?.kill("SIGTERM"); } catch {}
    try { server.kill("SIGTERM"); } catch {}
    setTimeout(() => process.exit(0), 1500);
  };

  electron.on("exit", (code) => {
    log("dev", `electron exited (code=${code}) — stopping server and vite`);
    try { vite?.kill("SIGTERM"); } catch {}
    try { server.kill("SIGTERM"); } catch {}
    setTimeout(() => process.exit(code ?? 0), 500);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[dev] fatal:", err);
  process.exit(1);
});
