#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const sourceApp = path.join(desktopRoot, "release", "mac-arm64", "njx-copilot.app");
const targetApp = process.env.NJX_COPILOT_DEV_APP || "/Users/njx/Applications/njx-copilot-dev.app";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, OPENCLAW_WORKBENCH_ENV: "dev" },
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function assertDevTarget() {
  const normalized = targetApp.replace(/\\/g, "/");
  if (!normalized.endsWith("/njx-copilot-dev.app")) {
    throw new Error(`Refusing to install dev app to non-dev target: ${targetApp}`);
  }
  if (normalized === "/Users/njx/Applications/njx-copilot.app") {
    throw new Error("Refusing to overwrite production app from desktop:dev:install");
  }
}

function patchPlist() {
  const plist = path.join(targetApp, "Contents", "Info.plist");
  run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "ai.njx.copilot.dev", plist]);
  run("/usr/bin/plutil", ["-replace", "CFBundleDisplayName", "-string", "njx-copilot-dev", plist]);
}

assertDevTarget();

console.log("[desktop-dev-install] building web/server/desktop");
run("npm", ["run", "build", "--workspace", "@openclaw-workbench/web"]);
run("npm", ["run", "build", "--workspace", "@openclaw-workbench/server"]);
run("npm", ["run", "dist:mac:arm64:dir", "--workspace", "@openclaw-workbench/desktop"]);

if (!fs.existsSync(sourceApp)) {
  throw new Error(`Build did not produce app: ${sourceApp}`);
}

console.log(`[desktop-dev-install] installing DEV app: ${targetApp}`);
fs.rmSync(targetApp, { recursive: true, force: true });
run("/usr/bin/ditto", [sourceApp, targetApp]);
patchPlist();
run("node", [path.join(desktopRoot, "scripts", "sign-local.mjs"), targetApp]);

console.log("[desktop-dev-install] DEV app ready");
console.log(`app=${targetApp}`);
console.log("env=dev");
console.log("url=http://127.0.0.1:38889");
console.log(`data=${path.join(repoRoot, "data", "env", "dev", "data")}`);
console.log(`workspace=${path.join(repoRoot, "data", "env", "dev", "workspace")}`);
