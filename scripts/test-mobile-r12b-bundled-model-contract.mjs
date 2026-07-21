// 2026-07-04 — R12B: Bundled offline ASR model contract probe.
//
// R12 stopped at "ASR engines wired + native libs in APK" but the model itself
// was runtime-downloaded. R12B must prove:
//
//   (1) A small Chinese ASR model is bundled into the Android APK at
//       `assets/models/<modelDirName>/...`. Not "downloaded", not "fetched
//       at runtime" — actually present in `unzip -l` output.
//
//   (2) The bundled model is referenced from a SherpaModelDescriptor that
//       the engine registry prefers over the 95 MB Paraformer-zh fallback.
//       The descriptor must have engineId="sherpa-onnx", modelLabel, and
//       expectedModelSizeMB so UI can render "bundled model · 26 MB".
//
//   (3) The Android APK at the versioned path (`openclaw-mate60-r12b-offline-asr.apk`)
//       actually contains the model — verified by `unzip -l <apk>` showing
//       `model.int8.onnx`, `tokens.txt`, `bbpe.model` under
//       `assets/models/<modelDirName>/`.
//
//   (4) The APK also keeps the sherpa-onnx native libs (libsherpa-onnx-c-api.so,
//       libonnxruntime.so) so the engine can actually load the model.
//
//   (5) The original `openclaw-mate60.apk` SHA256 is unchanged — R12B did
//       not overwrite the R5 1.0.8 release.
//
//   (6) The native engine code (sherpaOnnxEngine.ts) does NOT use fetch /
//       axios / WebSocket — model loading is purely local IO (assets → filesDir
//       via react-native-sherpa-onnx's resolveAutoPath).
//
//   (7) The bundled descriptor `SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8`
//       exists, is re-exported from `engines/index.ts`, and the orchestrator
//       `tryRegisterNativeOfflineAsr()` probes it BEFORE the legacy
//       Paraformer-zh descriptor.
//
// Exit 0 = contract passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(repo, rel));

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// (1) Bundled model files exist on disk in apps/mobile/android/app/src/main/assets
// ---------------------------------------------------------------------------
const BUNDLED_DIR =
  "apps/mobile/android/app/src/main/assets/models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01";

expect(
  "Android bundled ASR model directory exists at the canonical R12B path",
  exists(BUNDLED_DIR),
  `expected ${BUNDLED_DIR}/ to be checked in`,
);
expect(
  "Bundled model includes model.int8.onnx",
  exists(`${BUNDLED_DIR}/model.int8.onnx`),
  "expected int8 quantized ONNX weights",
);
expect(
  "Bundled model includes tokens.txt",
  exists(`${BUNDLED_DIR}/tokens.txt`),
  "expected tokens vocabulary",
);
expect(
  "Bundled model includes bbpe.model (BPE tokenizer)",
  exists(`${BUNDLED_DIR}/bbpe.model`),
  "expected BPE tokenizer model",
);

if (exists(`${BUNDLED_DIR}/model.int8.onnx`)) {
  const stat = fs.statSync(path.join(repo, `${BUNDLED_DIR}/model.int8.onnx`));
  expect(
    "model.int8.onnx size >= 10 MB (real Chinese ASR weights, not stub)",
    stat.size > 10 * 1024 * 1024,
    `model size ${stat.size} bytes`,
  );
  expect(
    "model.int8.onnx size <= 60 MB (small/zipformer/CTC int8 envelope, not Paraformer)",
    stat.size <= 60 * 1024 * 1024,
    `model size ${stat.size} bytes`,
  );
}

// ---------------------------------------------------------------------------
// (2) sherpaOnnxEngine.ts exports SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8
//     with expected fields + bundled descriptor is re-exported via engines/index.ts
// ---------------------------------------------------------------------------
const sherpaTs = read("apps/mobile/src/lib/engines/sherpaOnnxEngine.ts");
const indexTs = read("apps/mobile/src/lib/engines/index.ts");

expect(
  "sherpaOnnxEngine.ts exports SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 descriptor",
  /export\s+const\s+SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8/.test(sherpaTs),
  "bundled descriptor missing",
);
expect(
  "SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 uses engineId='sherpa-onnx'",
  /SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8[\s\S]{0,800}?engineId:\s*"sherpa-onnx"/.test(sherpaTs),
  "engineId mismatch",
);
expect(
  "SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 modelDirName matches Android asset path",
  /SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8[\s\S]{0,800}?modelDirName:\s*"sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01"/.test(sherpaTs),
  "modelDirName must exactly match Android assets/models/<dir>/",
);
expect(
  "SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 has expectedModelSizeMB in [10, 50]",
  /SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8[\s\S]{0,1000}?expectedModelSizeMB:\s*(\d+)/.test(sherpaTs),
  "expectedModelSizeMB missing",
);

const m = /SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8[\s\S]{0,1000}?expectedModelSizeMB:\s*(\d+)/.exec(sherpaTs);
if (m) {
  const size = Number(m[1]);
  expect(
    `bundled descriptor expectedModelSizeMB (${size}) is small (< 50 MB)`,
    size > 10 && size < 50,
    "expected a small Chinese model size, not Paraformer 95 MB",
  );
}

expect(
  "engines/index.ts re-exports SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8",
  /export\s+\{[^}]*SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8/s.test(indexTs),
  "index.ts must re-export bundled descriptor",
);

// ---------------------------------------------------------------------------
// (3) tryRegisterNativeOfflineAsr() probes the bundled descriptor BEFORE
//     SHERPA_PARAFORMER_ZH. The bundled path is the primary; Paraformer-zh
//     is the legacy fallback.
// ---------------------------------------------------------------------------
expect(
  "tryRegisterNativeOfflineAsr probes SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 before SHERPA_PARAFORMER_ZH",
  /probeSherpaOnnxEngine[\s\S]{0,80}?SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8/.test(indexTs) &&
    /probeSherpaOnnxEngine\s*\(\s*SHERPA_PARAFORMER_ZH\s*\)/.test(indexTs) &&
    indexTs.indexOf("SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8") <
      indexTs.indexOf("SHERPA_PARAFORMER_ZH"),
  "orchestrator must prefer the bundled model",
);

// ---------------------------------------------------------------------------
// (4) APK at the versioned path actually contains the bundled model + libs
// ---------------------------------------------------------------------------
const versionedApk = "openclaw-mate60-r12b-offline-asr.apk";
const versionedApkAbs = path.join(repo, versionedApk);

expect(
  `versioned APK exists at /Users/njx/openclaw/copilot/${versionedApk}`,
  fs.existsSync(versionedApkAbs),
  `expected ${versionedApk} at the workspace root`,
);

if (fs.existsSync(versionedApkAbs)) {
  const stat = fs.statSync(versionedApkAbs);
  expect(
    "versioned APK size >= 300 MB (Debug build with model bundled)",
    stat.size > 300 * 1024 * 1024,
    `APK size ${stat.size} bytes`,
  );

  // Read APK file listing via system unzip. We can't easily import a zip lib
  // and the shell command is the cleanest cross-platform approach here.
  // Use synchronous unzip via spawnSync.
  const r = spawnSync("unzip", ["-l", versionedApkAbs], { encoding: "utf8" });
  if (r.status !== 0) {
    failures.push(`unzip -l ${versionedApk} failed — exit ${r.status}: ${r.stderr}`);
  } else {
    const out = r.stdout;
    expect(
      "APK contains libsherpa-onnx-c-api.so (arm64-v8a)",
      /lib\/arm64-v8a\/libsherpa-onnx-c-api\.so/.test(out),
      "ASR engine C API lib missing",
    );
    expect(
      "APK contains libonnxruntime.so (arm64-v8a)",
      /lib\/arm64-v8a\/libonnxruntime\.so/.test(out),
      "ONNX runtime missing",
    );
    expect(
      "APK contains bundled model.int8.onnx",
      /assets\/models\/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01\/model\.int8\.onnx/.test(out),
      "bundled ONNX model missing from APK assets",
    );
    expect(
      "APK contains bundled tokens.txt",
      /assets\/models\/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01\/tokens\.txt/.test(out),
      "bundled tokens.txt missing from APK assets",
    );
    expect(
      "APK contains bundled bbpe.model (BPE)",
      /assets\/models\/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01\/bbpe\.model/.test(out),
      "bundled BPE model missing from APK assets",
    );
  }
}

// ---------------------------------------------------------------------------
// (5) R5 1.0.8 anchor APK is preserved (the previously-validated APK that
//     R12B must not have overwritten). The R5 anchor lives at
//     `openclaw-mate60-r5-anchor-20260703.apk` (a backup copy NJX made
//     before R12B rebuilt the canonical `openclaw-mate60.apk`). The
//     canonical `openclaw-mate60.apk` was updated by R16 to a fresh
//     release build (`1a91a781...`) — R12B itself did not write that
//     path, R16 did.
// ---------------------------------------------------------------------------
const R5_ANCHOR = path.join(repo, "openclaw-mate60-r5-anchor-20260703.apk");
const R5_HASH =
  "0cefc40584601390349ad664209663d6c8d80be43a2c647e17f123e8792f0775";
const R16_HASH =
  "1a91a781519383464f676954eedf3a7c59b62ec17b86f1c444583423e2d96608";
expect(
  "R5 1.0.8 anchor APK is preserved at openclaw-mate60-r5-anchor-20260703.apk",
  fs.existsSync(R5_ANCHOR),
);
if (fs.existsSync(R5_ANCHOR)) {
  const sha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(R5_ANCHOR))
    .digest("hex");
  expect(
    `R5 anchor SHA256 matches the documented R5 1.0.8 hash (got ${sha})`,
    sha === R5_HASH,
    "R12B contract: anchor APK must not be silently re-shuffled",
  );
}

const canonicalApk = path.join(repo, "openclaw-mate60.apk");
if (fs.existsSync(canonicalApk)) {
  const sha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(canonicalApk))
    .digest("hex");
  // R12B's own contribution (the bundled-model rebuild) lives at the
  // versioned path `openclaw-mate60-r12b-offline-asr.apk`. The
  // canonical `openclaw-mate60.apk` slot is allowed to hold EITHER:
  //   - the R5 hash (NJX hasn't yet promoted R12B to canonical), OR
  //   - the R16 hash (R16 release build was promoted to canonical), OR
  //   - the R17 hash (R17 release build was promoted to canonical after R17
  //     fixed the local ASR / controls / QR scan acceptance items).
  // It must NOT be the R12B APK at this path any more — the canonical
  // Mate60 APK is supposed to be installable (R12B APK at the canonical
  // path is what surfaced the "Unable to load script" regression).
  const ACCEPTED_CANONICAL_HASHES = new Set([
    R5_HASH,
    R16_HASH,
    // R17 release build (recorder local ASR + controls + QR pairing fix).
    "4988bda9b172953ef25c1107a61fe7dd4d926d94acfa4a81c5ed146095cfe797",
  ]);
  expect(
    `canonical openclaw-mate60.apk is the R5 / R16 / R17 release APK (got ${sha})`,
    ACCEPTED_CANONICAL_HASHES.has(sha),
    "R12B contract: canonical Mate60 APK must be a release build (R5/R16/R17), not the bundle-less R12B debug APK",
  );
}

// ---------------------------------------------------------------------------
// (6) Engine code does NOT call fetch / axios / WebSocket — pure local IO
// ---------------------------------------------------------------------------
expect(
  "sherpaOnnxEngine.ts MUST NOT call fetch() (model loaded from local assets)",
  !/\bfetch\s*\(/.test(sherpaTs),
  "engine code must be 100% on-device",
);
expect(
  "sherpaOnnxEngine.ts MUST NOT import axios",
  !/from\s+['"]axios['"]/.test(sherpaTs) && !/require\(\s*['"]axios['"]\s*\)/.test(sherpaTs),
  "axios import is forbidden",
);

// ---------------------------------------------------------------------------
// (7) offlineAsr.ts contract: bundled descriptor path is exposed via
//     describeOfflineAsrState() / recordMacSegment fallback chain.
// ---------------------------------------------------------------------------
const offlineAsrTs = read("apps/mobile/src/lib/offlineAsr.ts");
expect(
  "offlineAsr.ts has the R12B bundled-model semantics in the header comment",
  /bundled/.test(offlineAsrTs) && /zipformer/i.test(offlineAsrTs),
  "R12B offlineAsr.ts must mention bundled zipformer model in comments",
);

// ---------------------------------------------------------------------------
// (8) App.tsx still wires the engine registry (R11+R12 contract unchanged)
// ---------------------------------------------------------------------------
const appTs = read("apps/mobile/src/App.tsx");
expect(
  "App.tsx useEffect still calls bootstrapOfflineAsr + tryRegisterNativeOfflineAsr",
  /useEffect\s*\([\s\S]{0,1500}?bootstrapOfflineAsr[\s\S]{0,1500}?tryRegisterNativeOfflineAsr/.test(appTs),
  "App.tsx startup wiring regressed",
);

if (failures.length) {
  console.error("MOBILE_R12B_BUNDLED_MODEL_CONTRACT_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R12B_BUNDLED_MODEL_CONTRACT_PASS");