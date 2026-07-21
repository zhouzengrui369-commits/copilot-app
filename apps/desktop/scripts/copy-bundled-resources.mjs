#!/usr/bin/env node
/**
 * copy-bundled-resources.mjs
 *
 * Used by `npm run dist:mac` to stage a self-contained server + web dist
 * inside the Electron app's `Resources/` tree before electron-builder
 * packages everything into a .dmg.
 *
 * Why a separate script: electron-builder's `extraResources` config copies
 * the source-of-truth dist on every build, but it does NOT recompile them.
 * This script is the explicit "build + stage" step that wires the desktop
 * workspace into the existing monorepo build pipeline.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const desktopDir = path.join(repoRoot, "apps", "desktop");
const stageDir = path.join(desktopDir, "stage");
const serverSrc = path.join(repoRoot, "apps", "server", "src");
const webSrc = path.join(repoRoot, "apps", "web", "src");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function stage(label, src, dst) {
  if (!existsSync(src)) {
    throw new Error(`[stage] ${label} source missing: ${src}`);
  }
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  const size = statSync(dst).size;
  console.log(`[stage] ${label} -> ${dst} (root inode size=${size})`);
}

async function main() {
  console.log("[stage] building server + web in monorepo root");
  await run("npm", ["--prefix", repoRoot, "run", "build"]);

  stage("server dist", path.join(repoRoot, "apps", "server", "dist"), path.join(stageDir, "server"));
  stage("web dist", path.join(repoRoot, "apps", "web", "dist"), path.join(stageDir, "web"));

  console.log("[stage] done. electron-builder will pick this up via extraResources when configured to.");
}

main().catch((err) => {
  console.error("[stage] fatal:", err);
  process.exit(1);
});

// Reference: prevent unused-warning if node ever toggles strict-unused.
void serverSrc; void webSrc;
