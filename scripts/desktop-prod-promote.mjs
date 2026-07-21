#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const sourceApp = process.env.NJX_COPILOT_PROD_SOURCE_APP || path.join(desktopRoot, "release", "mac-arm64", "njx-copilot.app");
const targetApp = process.env.NJX_COPILOT_PROD_APP || "/Users/njx/Applications/njx-copilot.app";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, OPENCLAW_WORKBENCH_ENV: "prod" },
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

if (process.env.OPENCLAW_ALLOW_PROD_OPS !== "YES-I-KNOW") {
  console.error("Refusing production promote. Set OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW after DEV acceptance.");
  process.exit(2);
}

if (targetApp !== "/Users/njx/Applications/njx-copilot.app") {
  throw new Error(`Refusing unexpected production target: ${targetApp}`);
}
if (!fs.existsSync(sourceApp)) {
  throw new Error(`Production source app missing: ${sourceApp}`);
}

const backup = `${targetApp}.backup-before-promote-${stamp()}`;
if (fs.existsSync(targetApp)) {
  console.log(`[desktop-prod-promote] backup ${targetApp} -> ${backup}`);
  run("/usr/bin/ditto", [targetApp, backup]);
}

console.log(`[desktop-prod-promote] promote ${sourceApp} -> ${targetApp}`);
fs.rmSync(targetApp, { recursive: true, force: true });
run("/usr/bin/ditto", [sourceApp, targetApp]);
run("node", [path.join(desktopRoot, "scripts", "sign-local.mjs"), targetApp]);

console.log("[desktop-prod-promote] PROD app promoted");
console.log(`backup=${backup}`);
console.log("url=http://127.0.0.1:38888");
