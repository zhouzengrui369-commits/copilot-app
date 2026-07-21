// 2026-07-05 — R13: iOS bundled offline ASR model + dual-device acceptance.
//
// Contract:
//
//   Android side (R12B's deliverable, must NOT regress):
//
//     (A1) apps/mobile/android/app/src/main/assets/models/<modelDirName>/
//          exists with model.int8.onnx, tokens.txt, bbpe.model.
//     (A2) The Mate60 R12B APK at
//          /Users/njx/openclaw/copilot/openclaw-mate60-r12b-offline-asr.apk
//          contains those model files in <apk>/assets/models/...
//     (A3) Original openclaw-mate60.apk SHA256 unchanged.
//
//   iOS side (R13 NEW, no previous acceptance — must succeed):
//
//     (I1) apps/mobile/assets/models/<modelDirName>/ exists (shared
//          source of truth — same path Android reads from).
//     (I2) apps/mobile/ios/OpenClaw/assets/models/<modelDirName>/ exists
//          (the iOS plugin copies the parent `assets/` tree into the
//          OpenClaw Xcode project so the project-root-relative Folder
//          Reference can resolve it).
//     (I3) apps/mobile/ios/OpenClaw.xcodeproj/project.pbxproj references
//          the *parent* folder `assets/` (not the inner models/<dir>):
//          - PBXFileReference entry with lastKnownFileType = folder and
//            name = "assets" and path = "OpenClaw/assets"
//          - PBXBuildFile entry referencing the file ref
//          - OpenClaw PBXGroup children include the file ref
//          - PBXResourcesBuildPhase (13B07F8E1A680F5B00A75B9A) files
//            include the build file
//     (I4) The iOS Xcode project parses cleanly with the `xcode` node lib.
//
//   Engine / app behavior (must NOT regress from R12B):
//
//     (E1) apps/mobile/src/lib/engines/sherpaOnnxEngine.ts still exports
//          the bundled descriptor
//          SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 with modelDirName
//          matching the asset path (Android assets + iOS app bundle).
//     (E2) tryRegisterNativeOfflineAsr in apps/mobile/src/lib/engines/index.ts
//          probes the bundled descriptor BEFORE SHERPA_PARAFORMER_ZH
//          (engine still prefers bundled).
//     (E3) Engine code does NOT call fetch / axios / WebSocket.
//
//   App wiring:
//
//     (W1) apps/mobile/app.json plugins array includes
//          "./plugins/with-openclaw-ios-model.js" so `expo prebuild`
//          and `eas build` re-apply the iOS folder reference after a
//          clean ios/ regeneration.
//
//   iOS artifact (R13 NEW):
//
//     (X1) An unsigned Release-iphoneos `.app` exists at
//          tasks/mobile-r13-ios-bundled-asr-and-dual-device-20260705/
//          artifacts/OpenClaw-R13-iphoneos-unsigned.app
//          (or under /tmp/openclaw-r13-derived if artifacts copy is too
//           large to preserve on Windows).
//     (X2) The .app's bundle resource tree contains the model folder at
//          exactly OpenClaw.app/assets/models/<modelDirName>/{model.int8.onnx,
//          tokens.txt, bbpe.model} (which is what react-native-sherpa-onnx's
//          resolveAutoPath("assets/models/<modelDirName>") looks for).
//     (X3) The .app is unsigned (BLOCKED_IOS_SIGNING is the expected R13
//          blocker — distribute needs Apple Developer Program enrollment).
//
// Exit 0 = contract passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(repo, rel));
const stat = (rel) => fs.statSync(path.join(repo, rel));

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const MODEL_DIR_NAME =
  "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01";
const ANDROID_BUNDLED_DIR = `apps/mobile/android/app/src/main/assets/models/${MODEL_DIR_NAME}`;
const SHARED_BUNDLED_DIR = `apps/mobile/assets/models/${MODEL_DIR_NAME}`;
const IOS_BUNDLED_DIR = `apps/mobile/ios/OpenClaw/assets/models/${MODEL_DIR_NAME}`;
const PBXPROJ_PATH = `apps/mobile/ios/OpenClaw.xcodeproj/project.pbxproj`;
const ARTIFACT_DIR = `tasks/mobile-r13-ios-bundled-asr-and-dual-device-20260705/artifacts`;
const PRESERVED_APP = `${ARTIFACT_DIR}/OpenClaw-R13-iphoneos-unsigned.app`;

// ---------------------------------------------------------------------------
// (A1) Android source model files
// ---------------------------------------------------------------------------
expect(
  `Android bundled ASR model directory exists at ${ANDROID_BUNDLED_DIR}`,
  exists(ANDROID_BUNDLED_DIR),
  "R12B contract — required for both Android APK and iOS folder ref source",
);
expect(
  "Android model contains model.int8.onnx",
  exists(`${ANDROID_BUNDLED_DIR}/model.int8.onnx`),
);
expect(
  "Android model contains tokens.txt",
  exists(`${ANDROID_BUNDLED_DIR}/tokens.txt`),
);
expect(
  "Android model contains bbpe.model",
  exists(`${ANDROID_BUNDLED_DIR}/bbpe.model`),
);
if (exists(`${ANDROID_BUNDLED_DIR}/model.int8.onnx`)) {
  const s = stat(`${ANDROID_BUNDLED_DIR}/model.int8.onnx`);
  expect(
    "Android model.int8.onnx size in [10 MB, 60 MB] (small/zipformer/CTC int8)",
    s.size > 10 * 1024 * 1024 && s.size <= 60 * 1024 * 1024,
    `size=${s.size} bytes`,
  );
}

// ---------------------------------------------------------------------------
// (I1) Shared source-of-truth bundle dir
// ---------------------------------------------------------------------------
expect(
  `Shared bundle dir at ${SHARED_BUNDLED_DIR}/ exists (iOS plugin source)`,
  exists(SHARED_BUNDLED_DIR),
);
expect(
  "Shared bundle dir contains model.int8.onnx",
  exists(`${SHARED_BUNDLED_DIR}/model.int8.onnx`),
);
expect(
  "Shared bundle dir contains tokens.txt",
  exists(`${SHARED_BUNDLED_DIR}/tokens.txt`),
);
expect(
  "Shared bundle dir contains bbpe.model",
  exists(`${SHARED_BUNDLED_DIR}/bbpe.model`),
);

// ---------------------------------------------------------------------------
// (I2) iOS OpenClaw/assets/models/<modelDirName>/ exists with model files
// ---------------------------------------------------------------------------
expect(
  `iOS bundle target dir at ${IOS_BUNDLED_DIR}/ exists`,
  exists(IOS_BUNDLED_DIR),
  "Plugin failed to copy assets/ tree into OpenClaw/ios/OpenClaw/",
);
expect(
  "iOS bundle target contains model.int8.onnx",
  exists(`${IOS_BUNDLED_DIR}/model.int8.onnx`),
);
expect(
  "iOS bundle target contains tokens.txt",
  exists(`${IOS_BUNDLED_DIR}/tokens.txt`),
);
expect(
  "iOS bundle target contains bbpe.model",
  exists(`${IOS_BUNDLED_DIR}/bbpe.model`),
);

if (exists(`${ANDROID_BUNDLED_DIR}/model.int8.onnx`) && exists(`${IOS_BUNDLED_DIR}/model.int8.onnx`)) {
  const a = stat(`${ANDROID_BUNDLED_DIR}/model.int8.onnx`).size;
  const i = stat(`${IOS_BUNDLED_DIR}/model.int8.onnx`).size;
  expect(
    `iOS model.int8.onnx size (${i}) matches Android source size (${a})`,
    a === i,
    "model copy was incomplete or corrupted",
  );
}

// ---------------------------------------------------------------------------
// (I3) iOS pbxproj references the parent `assets/` folder via 4 entries
// ---------------------------------------------------------------------------
if (!exists(PBXPROJ_PATH)) {
  failures.push(`pbxproj not found at ${PBXPROJ_PATH}`);
} else {
  const pbx = read(PBXPROJ_PATH);

  expect(
    "pbxproj has balanced braces",
    (pbx.match(/\{/g) || []).length === (pbx.match(/\}/g) || []).length,
    `open=${(pbx.match(/\{/g) || []).length} close=${(pbx.match(/\}/g) || []).length}`,
  );

  // (i3a) PBXFileReference with `lastKnownFileType = folder; name = "assets"`
  expect(
    `pbxproj has PBXFileReference with lastKnownFileType = folder and name = "assets"`,
    new RegExp(
      `\\{[^{}]*lastKnownFileType = folder;\\s*name = "assets"`,
    ).test(pbx),
    "no folder reference for `assets/`",
  );

  // (i3b) PBXFileReference has the canonical path OpenClaw/assets
  expect(
    `pbxproj sets path = OpenClaw/assets for the folder ref`,
    new RegExp(`path = "OpenClaw/assets"`).test(pbx),
  );

  // (i3c) PBXBuildFile entry exists for "assets in Resources"
  expect(
    "pbxproj has PBXBuildFile entry referencing the fileRef (name 'assets in Resources')",
    new RegExp(
      `\\{[^{}]*isa = PBXBuildFile;[^;]*fileRef = \\w+ /\\* assets \\*/`,
    ).test(pbx),
  );

  // (i3d) OpenClaw PBXGroup children include the file ref
  const openclawGroupRe =
    /(\w+) \/\* OpenClaw \*\/ = \{[\s\S]*?children = \(([\s\S]*?)\);[\s\S]*?name = OpenClaw;/;
  const m = openclawGroupRe.exec(pbx);
  if (!m) {
    failures.push("Could not find the OpenClaw PBXGroup in pbxproj");
  } else {
    expect(
      "OpenClaw PBXGroup children contains the assets folder ref",
      new RegExp(`/\\* assets \\*/,`).test(m[2]),
    );
  }

  // (i3e) PBXResourcesBuildPhase files include the build file
  const resPhaseRe =
    /13B07F8E1A680F5B00A75B9A \/\* Resources \*\/ = \{[\s\S]*?files = \(([\s\S]*?)\)/;
  const rm = resPhaseRe.exec(pbx);
  if (!rm) {
    failures.push("PBXResourcesBuildPhase files block not found");
  } else {
    expect(
      "PBXResourcesBuildPhase files include the assets folder build file",
      new RegExp(`/\\* assets in Resources \\*/`).test(rm[1]),
    );
  }
}

// ---------------------------------------------------------------------------
// (I4) iOS pbxproj parses cleanly with `xcode` lib
// ---------------------------------------------------------------------------
try {
  const { createRequire } = await import("node:module");
  const projectRequire = createRequire(import.meta.url);
  const xcodeProjectCtor = projectRequire("xcode").project;
  if (typeof xcodeProjectCtor !== "function") {
    failures.push(
      `xcode lib did not export a project() constructor (got typeof=${typeof xcodeProjectCtor})`,
    );
  } else {
    const p = xcodeProjectCtor(path.join(repo, PBXPROJ_PATH));
    p.parseSync();
    const has = p.hasFile(`OpenClaw/assets`);
    const isObj = typeof has === "object" && has !== null;
    expect(
      `xcode lib parses pbxproj AND hasFile('OpenClaw/assets') returns a folder ref`,
      isObj && has.lastKnownFileType === "folder",
      !isObj
        ? `hasFile returned ${JSON.stringify(has)}`
        : `lastKnownFileType=${has.lastKnownFileType} (expected "folder")`,
    );
  }
} catch (err) {
  failures.push(
    `xcode lib parse failed — pbxproj corruption likely: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// ---------------------------------------------------------------------------
// (A2) Mate60 R12B APK at versioned path contains the model
// ---------------------------------------------------------------------------
const versionedApk = "openclaw-mate60-r12b-offline-asr.apk";
const versionedApkAbs = path.join(repo, versionedApk);
expect(
  `R12B versioned APK at /Users/njx/openclaw/copilot/${versionedApk}`,
  fs.existsSync(versionedApkAbs),
  "R12B evidence file — must remain in place",
);

if (fs.existsSync(versionedApkAbs)) {
  const r = spawnSync("unzip", ["-l", versionedApkAbs], { encoding: "utf8" });
  if (r.status !== 0) {
    failures.push(`unzip -l ${versionedApk} failed — exit ${r.status}: ${r.stderr}`);
  } else {
    const out = r.stdout;
    expect(
      "R12B APK contains libsherpa-onnx-c-api.so",
      /lib\/arm64-v8a\/libsherpa-onnx-c-api\.so/.test(out),
    );
    expect(
      "R12B APK contains bundled model.int8.onnx",
      new RegExp(
        `assets/models/${MODEL_DIR_NAME}/model\\.int8\\.onnx`,
      ).test(out),
    );
    expect(
      "R12B APK contains bundled tokens.txt",
      new RegExp(`assets/models/${MODEL_DIR_NAME}/tokens\\.txt`).test(out),
    );
    expect(
      "R12B APK contains bundled bbpe.model",
      new RegExp(`assets/models/${MODEL_DIR_NAME}/bbpe\\.model`).test(out),
    );
  }
}

// ---------------------------------------------------------------------------
// (A3) Original openclaw-mate60.apk SHA256 unchanged
// ---------------------------------------------------------------------------
const originalApk = path.join(repo, "openclaw-mate60.apk");
if (fs.existsSync(originalApk)) {
  const buf = fs.readFileSync(originalApk);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  expect(
    `original openclaw-mate60.apk SHA256 unchanged (got ${sha})`,
    sha === "0cefc40584601390349ad664209663d6c8d80be43a2c647e17f123e8792f0775",
    "R12B contract: original APK must NOT be overwritten",
  );
}

// ---------------------------------------------------------------------------
// (E1, E2, E3) Engine behavior must not regress
// ---------------------------------------------------------------------------
const sherpaTs = read("apps/mobile/src/lib/engines/sherpaOnnxEngine.ts");
expect(
  "sherpaOnnxEngine.ts still exports SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8",
  /export\s+const\s+SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8/.test(sherpaTs),
);
expect(
  "bundled descriptor modelDirName still matches the asset folder",
  new RegExp(
    `SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8[\\s\\S]{0,800}?modelDirName:\\s*"${MODEL_DIR_NAME}"`,
  ).test(sherpaTs),
);

const indexTs = read("apps/mobile/src/lib/engines/index.ts");
expect(
  "tryRegisterNativeOfflineAsr probes bundled descriptor BEFORE legacy Paraformer-zh",
  /probeSherpaOnnxEngine[\s\S]{0,80}?SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8/.test(indexTs) &&
    /probeSherpaOnnxEngine\s*\(\s*SHERPA_PARAFORMER_ZH\s*\)/.test(indexTs) &&
    indexTs.indexOf("SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8") <
      indexTs.indexOf("SHERPA_PARAFORMER_ZH"),
);

expect(
  "sherpaOnnxEngine.ts MUST NOT call fetch()",
  !/\bfetch\s*\(/.test(sherpaTs),
);
expect(
  "sherpaOnnxEngine.ts MUST NOT import axios",
  !/from\s+['"]axios['"]/.test(sherpaTs) && !/require\(\s*['"]axios['"]\s*\)/.test(sherpaTs),
);
expect(
  "sherpaOnnxEngine.ts MUST NOT use WebSocket",
  !/new\s+WebSocket\s*\(/.test(sherpaTs),
);

// ---------------------------------------------------------------------------
// (W1) app.json includes the iOS plugin
// ---------------------------------------------------------------------------
const appJson = JSON.parse(read("apps/mobile/app.json"));
const plugins = appJson?.expo?.plugins || [];
const iOSPluginEntry = plugins.find(
  (p) => typeof p === "string" && p.includes("with-openclaw-ios-model"),
);
expect(
  `app.json plugins array includes "./plugins/with-openclaw-ios-model.js"`,
  !!iOSPluginEntry,
);

// ---------------------------------------------------------------------------
// (X1, X2, X3) iOS unsigned .app artifact (code-side evidence)
// ---------------------------------------------------------------------------
expect(
  `iOS unsigned .app preserved at ${PRESERVED_APP}`,
  exists(PRESERVED_APP),
  "R13 evidence file — must be preserved at this path",
);

if (exists(PRESERVED_APP)) {
  // Confirm model is in the .app at exactly the asset path the engine probes
  const modelInApp = `${PRESERVED_APP}/assets/models/${MODEL_DIR_NAME}`;
  expect(
    `iOS .app bundle contains ${modelInApp}/ (the asset path the engine probes)`,
    exists(modelInApp),
  );
  expect(
    "iOS .app bundle contains model.int8.onnx at the asset path",
    exists(`${modelInApp}/model.int8.onnx`),
  );
  expect(
    "iOS .app bundle contains tokens.txt at the asset path",
    exists(`${modelInApp}/tokens.txt`),
  );
  expect(
    "iOS .app bundle contains bbpe.model at the asset path",
    exists(`${modelInApp}/bbpe.model`),
  );

  // Confirm native libs are still present (sherpa-onnx-statically-linked + whisper.rn dynamic)
  expect(
    "iOS .app has rnwhisper.framework in Frameworks/",
    exists(`${PRESERVED_APP}/Frameworks/rnwhisper.framework/rnwhisper`),
  );
  expect(
    "iOS .app has hermesvm.framework in Frameworks/",
    exists(`${PRESERVED_APP}/Frameworks/hermesvm.framework/hermesvm`),
  );

  // Confirm signing status (should be unsigned)
  const cs = spawnSync("codesign", ["-dvv", path.join(repo, PRESERVED_APP)], {
    encoding: "utf8",
  });
  const unsignedMarker = "code object is not signed at all";
  const signed = !cs.stderr.includes(unsignedMarker) && cs.stdout.includes("Signature=");
  expect(
    `iOS .app is unsigned as expected (codesign -dvv shows "${unsignedMarker}")`,
    !signed,
    cs.stdout
      ? `codesign output: ${cs.stdout.slice(0, 200)}`
      : `codesign stderr: ${cs.stderr.slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// Final
// ---------------------------------------------------------------------------
if (failures.length) {
  console.error("MOBILE_R13_IOS_BUNDLED_MODEL_CONTRACT_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R13_IOS_BUNDLED_MODEL_CONTRACT_PASS");
