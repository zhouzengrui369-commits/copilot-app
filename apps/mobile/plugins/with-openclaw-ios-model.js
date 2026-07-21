// 2026-07-05 — R13: Expo config plugin that bundles the offline ASR model
// into the iOS Xcode project as a Folder Reference (blue folder).
//
// Why a Folder Reference:
//
//   On iOS, react-native-sherpa-onnx's native `resolveAutoPath` searches
//   three places (SherpaOnnx+Assets.mm:46-89):
//
//     1. <App>/Documents/models/<folder>           (downloaded cache)
//     2. <MainBundle.resourcePath>/<assetPath>    (bundled assets)  ← this
//     3. fallback pathForResource
//
//   To make path #2 resolve, we must put the model folder inside the .app
//   at exactly `<MainBundle>/assets/models/<modelDirName>/`. Android
//   achieves this via `app/src/main/assets/`. iOS requires the Xcode
//   project to be wired because Expo SDK 56 ships no generic asset-folder
//   packaging API.
//
//   A Folder Reference (`lastKnownFileType = folder`) preserves the
//   directory hierarchy in the resource bundle — Xcode copies the entire
//   subtree verbatim. A Group Reference (yellow folder) would have to
//   list every file individually.
//
// Strategy:
//
//   We add ONE Folder Reference at the level of `apps/mobile/ios/OpenClaw/assets/`
//   (which already contains `models/<modelDirName>/...`). Xcode copies
//   this whole subtree into the bundle, producing:
//
//       OpenClaw.app/assets/models/<modelDirName>/{model.int8.onnx,tokens.txt,bbpe.model,test_wavs/*}
//
//   This matches the asset path `assets/models/<modelDirName>` that the
//   engine passes to `resolveAutoPath`. No "AssetPath" rewrite on the JS
//   side, no schema change for the engine contract.
//
// What the plugin does, in order:
//
//   1. Refuse to run if the source-of-truth bundle
//      (`apps/mobile/assets/models/<modelDirName>/`) is missing or empty.
//      That dir is shared with Android and was populated by R12B.
//
//   2. Copy the model folder into
//      `apps/mobile/ios/OpenClaw/assets/models/<modelDirName>/` if not
//      already there.
//
//   3. Mutate `apps/mobile/ios/OpenClaw.xcodeproj/project.pbxproj` with
//      four edits:
//        (a) `PBXFileReference` for the parent folder
//            `OpenClaw/assets/` with `lastKnownFileType = folder`.
//        (b) `PBXBuildFile` referencing that file ref.
//        (c) Insert the fileRef into the existing OpenClaw PBXGroup's
//            children list.
//        (d) Insert the buildFile UUID into the project's
//            `PBXResourcesBuildPhase` (only one in this project:
//            `13B07F8E1A680F5B00A75B9A`).
//
//   4. Brace-balance sanity check, atomic write via tmpfile + rename.
//
// Why pbxproj regex manipulation instead of `xcode` lib:
//
//   - `xcode.project.addResourceFile()` and `addResourceFileToGroup()`
//     both call `correctForResourcesPath()` which requires a top-level
//     `Resources` PBXGroup by name; this prebuilt pbxproj has none
//     (resources live under the `OpenClaw` group). The call returns
//     null and throws "Cannot read properties of null (reading 'path')".
//
//   - The `xcode` lib also doesn't have a public API for creating
//     folder-style PBXFileReference entries with arbitrary name + path.
//     It only emits file references with extension-derived types.
//
//   Going to raw pbxproj text gives us 100% control and lets us match
//   the project's existing ID-style and indentation. The mutation is
//   idempotent: we scan for an existing reference whose `name` matches
//   the parent folder name; if present, exit without re-writing.
//
// Discpline:
//
//   - Only writes files inside `apps/mobile/ios/`, `apps/mobile/assets/`.
//   - Never touches source code, package.json, Podfile, Podfile.lock,
//     Info.plist, app.json, AndroidManifest.xml, or build.gradle.
//   - Never commits, pushes, runs `pod install`, or publishes OTA.
//
// Exit codes:
//   0 = success (pbxproj updated OR already in place)
//   1 = contract failure (source model missing / pbxproj corrupted)

const fs = require("node:fs");
const path = require("node:path");

const MODEL_DIR_NAME =
  "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01";

// We bundle the parent folder "assets" (which contains models/<dir>).
// In the app bundle: OpenClaw.app/assets/models/<modelDirName>/...
const PARENT_DIR_NAME = "assets";
const PARENT_DIR_REL_PATH = "OpenClaw/assets";

// Source-of-truth shared bundle (also referenced by Android via Gradle's
// app/src/main/assets/ — populated by R12B).
const SHARED_MODEL_SUBDIR = `${PARENT_DIR_NAME}/models/${MODEL_DIR_NAME}`;
const SHARED_MODEL_DIR = path.join(
  __dirname,
  "..",
  "assets",
  "models",
  MODEL_DIR_NAME,
);
const SHARED_PARENT_DIR = path.join(
  __dirname,
  "..",
  "assets",
);

// Where the iOS plugin puts the source dir so Xcode's project-root-relative
// reference can resolve. Copied from SHARED_PARENT_DIR if missing.
const IOS_PROJECT_DIR = path.join(__dirname, "..", "ios");
const IOS_OPENCLAW_DIR = path.join(IOS_PROJECT_DIR, "OpenClaw");
const IOS_DEST_PARENT = path.join(IOS_OPENCLAW_DIR, PARENT_DIR_NAME);
const PBXPROJ_PATH = path.join(
  IOS_PROJECT_DIR,
  "OpenClaw.xcodeproj",
  "project.pbxproj",
);

// Distinctive Xcode 24-char UUID prefix for our entries.
const NEW_UUID_PREFIX = "9B13E5";
function randomXcodeId(prefix) {
  const suffix = [...Array(24 - prefix.length)]
    .map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase())
    .join("");
  return prefix + suffix;
}

function ensureBundleSourceExists() {
  if (!fs.existsSync(SHARED_MODEL_DIR)) {
    throw new Error(
      `[with-openclaw-ios-model] Source model folder missing at ${SHARED_MODEL_DIR}. ` +
        "Run R12B scaffolding or `cp -r` from the upstream " +
        "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models " +
        "(`sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.tar.bz2`) " +
        "into apps/mobile/assets/models/ first.",
    );
  }
  const required = ["model.int8.onnx", "tokens.txt", "bbpe.model"];
  for (const f of required) {
    if (!fs.existsSync(path.join(SHARED_MODEL_DIR, f))) {
      throw new Error(
        `[with-openclaw-ios-model] Required model file missing: ${path.join(SHARED_MODEL_DIR, f)}`,
      );
    }
  }
}

function copyAssetsTreeIntoIos() {
  fs.mkdirSync(IOS_DEST_PARENT, { recursive: true });
  if (fs.existsSync(path.join(IOS_DEST_PARENT, "models", MODEL_DIR_NAME))) {
    return; // already there
  }
  // Recursive copy of SHARED_PARENT_DIR (= SHARED_MODEL_DIR/../.. = apps/mobile/assets/)
  // into IOS_DEST_PARENT (= OpenClaw/assets/).
  // We could refactor but using copyDirSync keeps the implementation explicit.
  copyDirSync(SHARED_PARENT_DIR, IOS_DEST_PARENT);
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function pbxprojGetParentAlreadyBundled(text) {
  const refSection =
    /\/\* Begin PBXFileReference section \*\/[\s\S]*?\/\* End PBXFileReference section \*\//.exec(
      text,
    );
  if (!refSection) return false;
  return new RegExp(
    `lastKnownFileType = folder;[\\s\\S]*?name = ("?)${PARENT_DIR_NAME}\\1`,
  ).test(refSection[0]);
}

function pbxprojAddAssetsFolderReference(text, fileRefUuid, buildFileUuid) {
  // (a) PBXFileReference: parent folder `assets` containing models/<dir>/...
  //     lastKnownFileType = folder; name = "assets"; path = "OpenClaw/assets";
  //     sourceTree = "<group>";
  const refInsertion = `\t\t${fileRefUuid} /* ${PARENT_DIR_NAME} */ = {isa = PBXFileReference; lastKnownFileType = folder; name = "${PARENT_DIR_NAME}"; path = "OpenClaw/assets"; sourceTree = "<group>"; };\n`;
  if (!/\/\* End PBXFileReference section \*\//.test(text)) {
    throw new Error("PBXFileReference end marker not found");
  }
  text = text.replace(
    /(\/\* End PBXFileReference section \*\/)/,
    `${refInsertion}$1`,
  );

  // (b) PBXBuildFile: link the fileRef into the Resources build phase.
  const buildInsertion = `\t\t${buildFileUuid} /* ${PARENT_DIR_NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefUuid} /* ${PARENT_DIR_NAME} */; };\n`;
  if (!/\/\* End PBXBuildFile section \*\//.test(text)) {
    throw new Error("PBXBuildFile end marker not found");
  }
  text = text.replace(
    /(\/\* End PBXBuildFile section \*\/)/,
    `${buildInsertion}$1`,
  );

  // (c) Insert the fileRef UUID into the existing OpenClaw PBXGroup's children list.
  //     Match existing 4-tab indent used by sibling entries.
  const openclawGroupRegex =
    /(\/\* Begin PBXGroup section \*\/[\s\S]*?(\w+) \/\* OpenClaw \*\/ = \{[\s\S]*?children = \()([\s\S]*?)(\);[\s\S]*?name = OpenClaw;[\s\S]*?\};)/;
  const m = openclawGroupRegex.exec(text);
  if (!m) {
    throw new Error(
      "Could not find the OpenClaw PBXGroup in pbxproj — project structure may have diverged",
    );
  }
  const fileRefChild = `\t\t\t\t${fileRefUuid} /* ${PARENT_DIR_NAME} */,\n`;
  text =
    text.slice(0, m.index) +
    m[1] +
    m[3] +
    fileRefChild +
    text.slice(m.index + m[1].length + m[3].length).replace(m[4], m[4]);

  // (d) Insert the buildFile UUID into PBXResourcesBuildPhase.
  const resPhaseRegex =
    /(13B07F8E1A680F5B00A75B9A \/\* Resources \*\/ = \{[\s\S]*?files = \()([\s\S]*?)(\);[\s\S]*?\/\* End PBXResourcesBuildPhase section \*\/)/;
  const rm = resPhaseRegex.exec(text);
  if (!rm) {
    throw new Error("PBXResourcesBuildPhase block not found");
  }
  const inserted = `\t\t\t\t${buildFileUuid} /* ${PARENT_DIR_NAME} in Resources */,\n`;
  text =
    text.slice(0, rm.index + rm[1].length) +
    rm[2] +
    inserted +
    text.slice(rm.index + rm[1].length + rm[2].length);
  return text;
}

module.exports = function withOpenClawIosModel(config) {
  // Direct filesystem mutation. `expo prebuild` regenerates ios/ from scratch;
  // running this plugin on each prebuild / clean keeps the bundle wiring alive.
  ensureBundleSourceExists();
  copyAssetsTreeIntoIos();

  const originalText = fs.readFileSync(PBXPROJ_PATH, "utf8");

  if (pbxprojGetParentAlreadyBundled(originalText)) {
    console.log(
      `[with-openclaw-ios-model] iOS pbxproj already references ${PARENT_DIR_NAME}/ folder; skipping.`,
    );
    return config;
  }

  const fileRefUuid = randomXcodeId(NEW_UUID_PREFIX);
  const buildFileUuid = randomXcodeId("AA" + NEW_UUID_PREFIX.slice(2));
  if (buildFileUuid === fileRefUuid) {
    throw new Error("UUID collision — re-run");
  }

  const updated = pbxprojAddAssetsFolderReference(
    originalText,
    fileRefUuid,
    buildFileUuid,
  );

  if ((updated.match(/\{/g) || []).length !== (updated.match(/\}/g) || []).length) {
    throw new Error(
      "[with-openclaw-ios-model] Refusing to write pbxproj — brace count mismatch (would corrupt Xcode project).",
    );
  }

  const tmpPath = PBXPROJ_PATH + ".r13-tmp";
  fs.writeFileSync(tmpPath, updated, "utf8");
  fs.renameSync(tmpPath, PBXPROJ_PATH);

  console.log(
    `[with-openclaw-ios-model] Bundled ${PARENT_DIR_NAME}/ folder (containing models/${MODEL_DIR_NAME}/) into iOS Xcode project (fileRef=${fileRefUuid.slice(0, 8)}, buildFile=${buildFileUuid.slice(0, 8)}).`,
  );
  return config;
};

module.exports.MODEL_DIR_NAME = MODEL_DIR_NAME;
module.exports.PARENT_DIR_NAME = PARENT_DIR_NAME;
module.exports.SHARED_MODEL_DIR = SHARED_MODEL_DIR;
module.exports.SHARED_PARENT_DIR = SHARED_PARENT_DIR;
module.exports.IOS_DEST_PARENT = IOS_DEST_PARENT;
module.exports.PBXPROJ_PATH = PBXPROJ_PATH;
