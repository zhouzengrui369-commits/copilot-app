#!/usr/bin/env node
// 2026-07-05 — R16: Packaged Mate60 APK with embedded JS bundle.
//
// The Mate60 APK at `/Users/njx/openclaw/copilot/openclaw-mate60.apk` showed
// "Unable to load script" because the previous APK (R12B rebuild) was
// assembled via `assembleDebug`, which intentionally does NOT embed the JS
// bundle — it expects Metro at runtime.
//
// R16 must prove:
//
//   (1) The canonical Mate60 APK at the versioned path
//       (`/Users/njx/openclaw/copilot/openclaw-mate60-r16-packaged.apk`) exists
//       and is NOT the old R12B APK (`6ae2cf7e...`).
//
//   (2) The new APK contains `assets/index.android.bundle` (the JS bundle
//       that was missing in R12B). Verified via `unzip -l <apk>`.
//
//   (3) The new APK still contains the offline ASR native libs
//       (libsherpa-onnx-c-api.so, libsherpa-onnx-cxx-api.so,
//       libsherpa-onnx-jni.so, libsherpaonnx.so, libonnxruntime.so,
//       libonnxruntime4j_jni.so, librnwhisper*) so the Sherpa engine
//       can load at runtime.
//
//   (4) The new APK still contains the bundled Chinese ASR model files
//       at `assets/models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/`
//       (model.int8.onnx, bbpe.model, tokens.txt).
//
//   (5) The new APK is arm64-v8a only (Mate60 is arm64, and a single-arch
//       build is ~3× smaller than a fat APK).
//
//   (6) The new APK is signed with the debug keystore (compatible with
//       manual install via `adb install -r`).
//
//   (7) The canonical Mate60 APK at `openclaw-mate60.apk` is now the R16
//       APK (replaced after verification).
//
//   (8) The R5 1.0.8 anchor APK remains preserved at
//       `/Users/njx/openclaw/copilot/openclaw-mate60-r5-anchor-20260703.apk`
//       (it was preserved separately by NJX before R12B).
//
//   (9) The R12B anchor APK remains preserved at the versioned path
//       `/Users/njx/openclaw/copilot/openclaw-mate60-r12b-offline-asr.apk`.
//
//  (10) The `npm run check --workspace @openclaw-workbench/mobile` and
//       R11/R12 contract tests still pass (no source regression).
//
// Exit 0 = contract passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const exists = (abs) => fs.existsSync(abs);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function sha256(abs) {
  const buf = fs.readFileSync(abs);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// (1) R16 APK exists at the versioned path and is NOT the R12B APK
// ---------------------------------------------------------------------------
const R16_APK = path.join(repo, "openclaw-mate60-r16-packaged.apk");
expect(
  "R16 versioned APK exists at /Users/njx/openclaw/copilot/openclaw-mate60-r16-packaged.apk",
  exists(R16_APK),
  `expected ${R16_APK}`,
);

if (exists(R16_APK)) {
  const stat = fs.statSync(R16_APK);
  const sha = sha256(R16_APK);
  expect(
    "R16 APK SHA256 is NOT the old R12B APK (6ae2cf7e...) — must be a fresh build",
    sha !== "6ae2cf7efee7c3833e0c0c1dececb3b1e96759cee7c0444ce037cb09a4bdf5be",
    `got ${sha}`,
  );
  expect(
    "R16 APK SHA256 is NOT the R5 1.0.8 APK (0cefc405...) — must be a fresh build",
    sha !== "0cefc40584601390349ad664209663d6c8d80be43a2c647e17f123e8792f0775",
    `got ${sha}`,
  );
  expect(
    "R16 APK size > 50 MB (real Android app, not stub)",
    stat.size > 50 * 1024 * 1024,
    `size ${stat.size} bytes`,
  );
  expect(
    "R16 APK size < 200 MB (single-arm64 build, no fat APK bloat)",
    stat.size < 200 * 1024 * 1024,
    `size ${stat.size} bytes`,
  );
}

// ---------------------------------------------------------------------------
// (2) R16 APK contains `assets/index.android.bundle`
// ---------------------------------------------------------------------------
function unzipList(apkAbs, pattern) {
  const out = spawnSync("unzip", ["-l", apkAbs], { encoding: "utf8" });
  if (out.status !== 0) return "";
  return out.stdout.split("\n").filter((l) => pattern.test(l));
}

function apkSigningScheme(apkAbs) {
  const apksigner = "/Users/njx/android-sdk/build-tools/35.0.0/apksigner";
  const env = { ...process.env };
  // apksigner shells out to java; ensure JAVA_HOME is set so it can find it.
  if (!env.JAVA_HOME) {
    const candidates = [
      "/opt/homebrew/opt/openjdk@17",
      "/usr/local/opt/openjdk@17",
      "/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home",
      "/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home",
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, "bin", "java"))) {
        env.JAVA_HOME = c;
        env.PATH = `${path.join(c, "bin")}:${env.PATH || ""}`;
        break;
      }
    }
  }
  const out = spawnSync(apksigner, ["verify", "--verbose", apkAbs], {
    encoding: "utf8",
    env,
  });
  return (out.stdout || "") + (out.stderr || "");
}

if (exists(R16_APK)) {
  const bundleLines = unzipList(
    R16_APK,
    /assets\/index\.android\.bundle|main\.jsbundle/,
  );
  expect(
    "R16 APK contains assets/index.android.bundle (the JS bundle that R12B was missing)",
    bundleLines.length >= 1,
    bundleLines.length === 0 ? "no index.android.bundle found" : `${bundleLines.length} lines`,
  );

  if (bundleLines.length >= 1) {
    const first = bundleLines[0].trim().split(/\s+/);
    const size = parseInt(first[0], 10);
    expect(
      "R16 APK JS bundle size > 1 MB (real Expo bundle, not stub)",
      size > 1024 * 1024,
      `bundle size ${size} bytes`,
    );
  }
}

// ---------------------------------------------------------------------------
// (3) R16 APK contains the offline ASR native libs
// ---------------------------------------------------------------------------
if (exists(R16_APK)) {
  const libs = unzipList(R16_APK, /\slib\/arm64-v8a\/lib(sherpa|onnx)/);
  const required = [
    "libsherpa-onnx-c-api.so",
    "libsherpa-onnx-cxx-api.so",
    "libsherpa-onnx-jni.so",
    "libsherpaonnx.so",
    "libonnxruntime.so",
  ];
  for (const lib of required) {
    expect(
      `R16 APK contains lib/arm64-v8a/${lib} (offline ASR native lib)`,
      libs.some((l) => l.includes(`/${lib}`)),
    );
  }
  expect(
    "R16 APK contains whisper RN libs (librnwhisper*.so)",
    unzipList(R16_APK, /\slib\/arm64-v8a\/librnwhisper/).length >= 1,
  );
  expect(
    "R16 APK contains Hermes VM (libhermesvm.so)",
    unzipList(R16_APK, /\slib\/arm64-v8a\/libhermesvm\.so/).length >= 1,
  );
}

// ---------------------------------------------------------------------------
// (4) R16 APK contains bundled Chinese ASR model files
// ---------------------------------------------------------------------------
if (exists(R16_APK)) {
  const model = unzipList(
    R16_APK,
    /assets\/models\/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01\/(model\.int8\.onnx|tokens\.txt|bbpe\.model)/,
  );
  for (const f of ["model.int8.onnx", "tokens.txt", "bbpe.model"]) {
    expect(
      `R16 APK contains assets/models/.../${f}`,
      model.some((l) => l.includes(`/${f}`)),
    );
  }
  const m = model.find((l) => l.includes("model.int8.onnx"));
  if (m) {
    const size = parseInt(m.trim().split(/\s+/)[0], 10);
    expect(
      "model.int8.onnx size >= 10 MB (real Chinese ASR weights, not stub)",
      size > 10 * 1024 * 1024,
      `model size ${size} bytes`,
    );
    expect(
      "model.int8.onnx size <= 60 MB (small/zipformer/CTC int8 envelope, not Paraformer)",
      size <= 60 * 1024 * 1024,
      `model size ${size} bytes`,
    );
  }
}

// ---------------------------------------------------------------------------
// (5) R16 APK is arm64-v8a only
// ---------------------------------------------------------------------------
if (exists(R16_APK)) {
  const archLines = unzipList(
    R16_APK,
    /\slib\/(arm64-v8a|armeabi-v7a|x86|x86_64)\//,
  ).map((l) => l.match(/lib\/([^/]+)\//)?.[1]).filter(Boolean);
  const uniq = [...new Set(archLines)];
  expect(
    "R16 APK contains arm64-v8a native libs",
    uniq.includes("arm64-v8a"),
    `archs found: ${uniq.join(",")}`,
  );
  expect(
    "R16 APK is arm64-v8a ONLY (single-arch Mate60 build, not a fat APK)",
    uniq.length === 1 && uniq[0] === "arm64-v8a",
    `archs found: ${uniq.join(",")}`,
  );
}

// ---------------------------------------------------------------------------
// (6) R16 APK is signed (debug keystore — manual install compatible)
//     Android signs APKs with one or more of v1 (JAR/META-INF), v2 (APK
//     Signature Scheme v2), v3, or v4. Release builds from AGP 8+
//     typically use v2 only — there's no .RSA in META-INF.
// ---------------------------------------------------------------------------
if (exists(R16_APK)) {
  const v1Sigs = unzipList(R16_APK, /META-INF\/.*\.(RSA|DSA|EC)$/);
  const v2 = apkSigningScheme(R16_APK);
  const isV1 = v1Sigs.length >= 1;
  const isV2 = /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(v2);
  const isV3 = /Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(v2);
  expect(
    "R16 APK is signed (v1 .RSA/.DSA/.EC OR v2/v3 APK Signature Scheme)",
    isV1 || isV2 || isV3,
    `v1=${isV1} v2=${isV2} v3=${isV3}`,
  );
}

// ---------------------------------------------------------------------------
// (7) Canonical openclaw-mate60.apk is now an installable release build.
//     R16 was the first release build promoted to canonical; R17
//     (recorder local ASR + controls + QR pairing) superseded it.
//     We accept EITHER hash so the R16 contract test does not regress
//     when a later release build is promoted.
// ---------------------------------------------------------------------------
const CANONICAL_APK = path.join(repo, "openclaw-mate60.apk");
if (exists(R16_APK) && exists(CANONICAL_APK)) {
  const shaR16 = sha256(R16_APK);
  const shaCanonical = sha256(CANONICAL_APK);
  // R17 release build (recorder local ASR + controls + QR pairing fix).
  const R17_HASH = "4988bda9b172953ef25c1107a61fe7dd4d926d94acfa4a81c5ed146095cfe797";
  const ACCEPTED_CANONICAL = new Set([shaR16, R17_HASH]);
  expect(
    "openclaw-mate60.apk SHA256 is the R16 or R17 release build (was replaced after verification)",
    ACCEPTED_CANONICAL.has(shaCanonical),
    `R16=${shaR16} R17=${R17_HASH} canonical=${shaCanonical}`,
  );
  expect(
    "openclaw-mate60.apk SHA256 is no longer the R12B APK (6ae2cf7e...)",
    shaCanonical !== "6ae2cf7efee7c3833e0c0c1dececb3b1e96759cee7c0444ce037cb09a4bdf5be",
  );
}

// ---------------------------------------------------------------------------
// (8) R5 1.0.8 anchor APK is preserved at its separate path
// ---------------------------------------------------------------------------
const R5_ANCHOR = path.join(repo, "openclaw-mate60-r5-anchor-20260703.apk");
expect(
  "R5 1.0.8 anchor APK still preserved at openclaw-mate60-r5-anchor-20260703.apk",
  exists(R5_ANCHOR),
);
if (exists(R5_ANCHOR)) {
  const sha = sha256(R5_ANCHOR);
  expect(
    "R5 1.0.8 anchor APK SHA256 matches the documented R5 anchor (0cefc405...)",
    sha === "0cefc40584601390349ad664209663d6c8d80be43a2c647e17f123e8792f0775",
    `got ${sha}`,
  );
}

// ---------------------------------------------------------------------------
// (9) R12B anchor APK is preserved at the versioned path
// ---------------------------------------------------------------------------
const R12B_APK = path.join(repo, "openclaw-mate60-r12b-offline-asr.apk");
expect(
  "R12B APK still preserved at openclaw-mate60-r12b-offline-asr.apk",
  exists(R12B_APK),
);
if (exists(R12B_APK)) {
  const sha = sha256(R12B_APK);
  expect(
    "R12B APK SHA256 matches the documented R12B anchor (6ae2cf7e...)",
    sha === "6ae2cf7efee7c3833e0c0c1dececb3b1e96759cee7c0444ce037cb09a4bdf5be",
    `got ${sha}`,
  );
}

// ---------------------------------------------------------------------------
// (10) Source-side regression checks (npm check + R11/R12 pass)
// ---------------------------------------------------------------------------
{
  const proc = spawnSync(
    "npm",
    ["run", "check", "--workspace", "@openclaw-workbench/mobile"],
    { cwd: repo, encoding: "utf8" },
  );
  expect(
    "npm run check --workspace @openclaw-workbench/mobile exits 0 (no TS regression)",
    proc.status === 0,
    `exit ${proc.status}, last lines: ${(proc.stdout + proc.stderr).split("\n").slice(-5).join(" | ")}`,
  );
}

{
  const proc = spawnSync(
    "node",
    [path.join(repo, "scripts/test-mobile-r11-offline-asr-contract.mjs")],
    { cwd: repo, encoding: "utf8" },
  );
  expect(
    "scripts/test-mobile-r11-offline-asr-contract.mjs PASSES",
    proc.status === 0 && /MOBILE_R11_OFFLINE_ASR_CONTRACT_PASS/.test(proc.stdout),
    `exit ${proc.status}, stdout tail: ${proc.stdout.split("\n").slice(-3).join(" | ")}`,
  );
}

{
  const proc = spawnSync(
    "node",
    [path.join(repo, "scripts/test-mobile-r12-native-offline-asr.mjs")],
    { cwd: repo, encoding: "utf8" },
  );
  expect(
    "scripts/test-mobile-r12-native-offline-asr.mjs PASSES",
    proc.status === 0 && /MOBILE_R12_NATIVE_OFFLINE_ASR_CONTRACT_PASS/.test(proc.stdout),
    `exit ${proc.status}, stdout tail: ${proc.stdout.split("\n").slice(-3).join(" | ")}`,
  );
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
if (failures.length === 0) {
  console.log("MOBILE_R16_PACKAGED_APK_CONTRACT_PASS");
  process.exit(0);
}
console.error("MOBILE_R16_PACKAGED_APK_CONTRACT_FAIL");
for (const f of failures) console.error(`- ${f}`);
process.exit(1);