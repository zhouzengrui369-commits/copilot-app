#!/usr/bin/env node
/**
 * sync-web-dist.mjs
 *
 * Sync the latest `apps/web/dist/` into an existing packaged Electron app's
 * `Contents/Resources/resources/web/` directory.
 *
 * Why this script exists:
 * The packaged app's web assets are frozen at the time of the last
 * `npm run dist:mac` (electron-builder packs `extraResources` once per build).
 * Iterative dev / hot-fix work (e.g. 3D view fix iter-6) only runs
 * `vite build`, which updates `apps/web/dist/`, NOT the release app.
 *
 * Bug it prevents (iter-7 controller recovery):
 * Without this sync, the packaged app references old chunk hashes in
 * `index.html` (e.g. `index-Ch2OnDQU.js`, `mermaid-Tmi9Q62P.js`) but the
 * dev surface has new hashes (e.g. `index-Ci5lQ0nu.js`, `mermaid-Bp7gXoHE.js`).
 * If any code path dynamically imports a new chunk, it 404s in the packaged app
 * even though it works in dev. Specifically: the lazy-loaded 3D graph view
 * was missing in the packaged app, breaking the entire /graph page.
 *
 * Usage:
 *   node apps/desktop/scripts/sync-web-dist.mjs [--app /path/to/app.app] [--source /path/to/web/dist]
 *
 * Defaults:
 *   --app    /Users/njx/Applications/njx-copilot.app  (resolved via symlink to release)
 *   --source apps/web/dist                          (resolved relative to repo root)
 *
 * What it does:
 *   1. Resolves the target app's `Contents/Resources/resources/web/` path
 *      (follows the `/Users/njx/Applications/njx-copilot.app` symlink).
 *   2. Validates the source `index.html` references all chunks in source `assets/`.
 *   3. Wipes the target `web/` clean (preserves nothing in packaged app web).
 *   4. Copies source to target.
 *   5. Re-validates the post-copy state: every chunk referenced in target
 *      `index.html` exists in target `assets/`.
 *   6. Prints a diff: which chunks were added / removed / replaced.
 *
 * Exit code:
 *   0 — sync OK + post-validate passed
 *   1 — source missing or empty
 *   2 — source index.html references missing chunks
 *   3 — target app path unresolved / not a real .app
 *   4 — post-copy validation failed
 */
import { existsSync, readFileSync, readdirSync, rmSync, cpSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

function parseArgs(argv) {
  const out = { app: undefined, source: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") out.app = argv[++i];
    else if (argv[i] === "--source") out.source = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const source = args.source
  ? path.resolve(args.source)
  : path.join(repoRoot, "apps", "web", "dist");
const appPath = args.app
  ? path.resolve(args.app)
  : "/Users/njx/Applications/njx-copilot.app";

function die(code, msg) {
  console.error(`[sync-web-dist] FATAL (${code}): ${msg}`);
  process.exit(code);
}

// 1. Source must exist
if (!existsSync(source)) die(1, `source missing: ${source}`);
const sourceStat = statSync(source);
if (!sourceStat.isDirectory()) die(1, `source not a directory: ${source}`);
const sourceAssets = path.join(source, "assets");
if (!existsSync(sourceAssets)) die(1, `source missing assets/ dir: ${sourceAssets}`);

// 2. Validate source: every chunk referenced in source index.html exists in source assets
function readIndex(dir) {
  const idx = path.join(dir, "index.html");
  if (!existsSync(idx)) die(1, `index.html missing in ${dir}`);
  return readFileSync(idx, "utf8");
}

function extractChunkRefs(html) {
  const re = /\/(assets\/[A-Za-z0-9._-]+)/g;
  const refs = new Set();
  let m;
  while ((m = re.exec(html)) !== null) refs.add(m[1]);
  return [...refs];
}

const sourceHtml = readIndex(source);
const sourceRefs = extractChunkRefs(sourceHtml);
const sourceAssetFiles = readdirSync(sourceAssets);
const sourceAssetSet = new Set(sourceAssetFiles);
const sourceMissing = sourceRefs.filter((r) => !sourceAssetSet.has(path.basename(r)));
if (sourceMissing.length) {
  die(2, `source index.html references missing chunks in source assets/: ${sourceMissing.join(", ")}`);
}
console.log(`[sync-web-dist] source OK: ${sourceRefs.length} chunk references, ${sourceAssetFiles.length} assets present`);

// 3. Resolve target app
let resolvedApp = appPath;
try {
  resolvedApp = realpathSync(appPath);
} catch (e) {
  die(3, `target app not found or unreadable: ${appPath} (${e.message})`);
}
if (!existsSync(path.join(resolvedApp, "Contents", "Info.plist"))) {
  die(3, `target is not a real .app bundle (no Contents/Info.plist): ${resolvedApp}`);
}
const targetWeb = path.join(resolvedApp, "Contents", "Resources", "resources", "web");
if (!existsSync(targetWeb)) {
  die(3, `target web/ missing: ${targetWeb}`);
}
console.log(`[sync-web-dist] target: ${targetWeb}`);

// 4. Snapshot pre-sync state
let preFiles = [];
try {
  preFiles = readdirSync(path.join(targetWeb, "assets"));
} catch { /* dir might not exist yet */ }

// 5. Wipe target web/ and copy
console.log(`[sync-web-dist] wiping ${targetWeb}`);
rmSync(targetWeb, { recursive: true, force: true });
console.log(`[sync-web-dist] copying ${source} -> ${targetWeb}`);
cpSync(source, targetWeb, { recursive: true });

// 6. Post-copy validation
const postHtml = readIndex(targetWeb);
const postRefs = extractChunkRefs(postHtml);
const postAssets = path.join(targetWeb, "assets");
if (!existsSync(postAssets)) die(4, `post-copy: assets/ dir missing under ${targetWeb}`);
const postAssetFiles = readdirSync(postAssets);
const postAssetSet = new Set(postAssetFiles);
const postMissing = postRefs.filter((r) => !postAssetSet.has(path.basename(r)));
if (postMissing.length) {
  die(4, `post-copy: index.html references missing chunks: ${postMissing.join(", ")}`);
}
console.log(`[sync-web-dist] post-copy OK: ${postRefs.length} chunk references, ${postAssetFiles.length} assets present`);

// 7. Print diff
const preSet = new Set(preFiles);
const postSet = new Set(postAssetFiles);
const added = [...postSet].filter((f) => !preSet.has(f));
const removed = [...preSet].filter((f) => !postSet.has(f));
const same = [...postSet].filter((f) => preSet.has(f));
console.log(`[sync-web-dist] diff: +${added.length} added, -${removed.length} removed, =${same.length} unchanged`);
if (added.length) {
  console.log(`[sync-web-dist] added chunks (first 10):`);
  for (const f of added.slice(0, 10)) console.log(`  + ${f}`);
}
if (removed.length) {
  console.log(`[sync-web-dist] removed chunks (first 10):`);
  for (const f of removed.slice(0, 10)) console.log(`  - ${f}`);
}
console.log(`[sync-web-dist] DONE. ${postRefs.length} chunk refs all resolved.`);
process.exit(0);
