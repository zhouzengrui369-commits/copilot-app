#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const appPath = path.resolve(desktopRoot, process.argv[2] || "release/mac-arm64/njx-copilot.app");
const entitlementsPath = path.resolve(desktopRoot, "build/entitlements.mac.plist");

function p(...parts) {
  return path.join(appPath, ...parts);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function detectIdentity() {
  if (process.env.NJX_COPILOT_CODESIGN_IDENTITY) return process.env.NJX_COPILOT_CODESIGN_IDENTITY;
  if (!/^(1|true|yes|on)$/i.test(process.env.NJX_COPILOT_CODESIGN_USE_APPLE_DEVELOPMENT || "")) {
    // Local acceptance runs on the owner machine must prefer launchability over
    // distribution identity. On this machine Apple Development re-signs pass
    // `codesign --verify` but are killed by AMFI before Electron starts; the
    // leaf-to-root ad-hoc signature is the stable local-app path. Set
    // NJX_COPILOT_CODESIGN_USE_APPLE_DEVELOPMENT=1 or
    // NJX_COPILOT_CODESIGN_IDENTITY=... for distribution-oriented builds.
    return "-";
  }
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const match = result.stdout?.match(/"([^"]*Apple Development:[^"]+)"/);
  if (match?.[1]) return match[1];
  return "-";
}

function listFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(file);
      } else if (entry.isFile()) {
        out.push(file);
      }
    }
  }
  return out;
}

function stripAccidentalExecutableBits() {
  const roots = [
    p("Contents", "Resources", "resources", "server", "node_modules"),
    p("Contents", "Resources", "resources", "web"),
  ].filter(existsSync);
  for (const root of roots) {
    for (const file of listFiles(root)) {
      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if ((stat.mode & 0o111) === 0) continue;
      const ext = path.extname(file).toLowerCase();
      const basename = path.basename(file);
      const keepExecutable =
        ext === ".node" ||
        ext === ".dylib" ||
        basename.endsWith(".sh") ||
        basename === "node" ||
        basename === "esbuild";
      if (keepExecutable) continue;
      chmodSync(file, stat.mode & ~0o111);
    }
  }
}

function signCode(target, { entitlements = false, runtime = identity !== "-" } = {}) {
  if (!existsSync(target)) return;
  const args = [
    "--force",
    "--timestamp=none",
  ];
  if (runtime) {
    args.push("--options", "runtime");
  }
  if (entitlements) {
    args.push("--entitlements", entitlementsPath);
  }
  args.push("--sign", identity, target);
  run("codesign", args);
}

if (!existsSync(appPath)) {
  throw new Error(`App bundle not found: ${appPath}`);
}
if (!existsSync(entitlementsPath)) {
  throw new Error(`Entitlements file not found: ${entitlementsPath}`);
}

const identity = detectIdentity();
console.log(`[sign-local] signing ${appPath}`);
console.log(`[sign-local] identity ${identity}`);

// Remove copied code-signing extended attributes before applying the final
// bundle signature. Keeping them can trigger AppleSystemPolicy rejection.
run("xattr", ["-cr", appPath]);

// NPM packages sometimes ship ordinary text/js files with executable bits.
// Keeping those inside a signed app can make Gatekeeper scan unnecessary files.
stripAccidentalExecutableBits();

// Electron bundles are more reliable when signed explicitly from leaves to root.
// Avoid `codesign --deep` here: it can report success while leaving AMFI with a
// launch-time policy decision different from `codesign --verify`.
[
  p("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries", "libEGL.dylib"),
  p("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries", "libGLESv2.dylib"),
  p("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries", "libffmpeg.dylib"),
  p("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Libraries", "libvk_swiftshader.dylib"),
  p("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Helpers", "chrome_crashpad_handler"),
  p("Contents", "Frameworks", "Squirrel.framework", "Versions", "A", "Resources", "ShipIt"),
].forEach((target) => signCode(target, { runtime: false }));

[
  p("Contents", "Frameworks", "Mantle.framework"),
  p("Contents", "Frameworks", "ReactiveObjC.framework"),
  p("Contents", "Frameworks", "Squirrel.framework"),
  p("Contents", "Frameworks", "Electron Framework.framework"),
].forEach((target) => signCode(target, { runtime: false }));

[
  p("Contents", "Frameworks", "njx-copilot Helper.app"),
  p("Contents", "Frameworks", "njx-copilot Helper (GPU).app"),
  p("Contents", "Frameworks", "njx-copilot Helper (Plugin).app"),
  p("Contents", "Frameworks", "njx-copilot Helper (Renderer).app"),
].forEach((target) => signCode(target, { entitlements: true }));

signCode(appPath, { entitlements: true });
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
