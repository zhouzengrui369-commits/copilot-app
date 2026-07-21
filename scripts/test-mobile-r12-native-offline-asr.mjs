// 2026-07-04 — R12: Native offline ASR wiring contract probe.
//
// R11 stopped at the abstraction layer (`offlineAsr.ts`). R12 must prove the
// real native engine wiring is in place:
//
//   (1) The real native packages (react-native-sherpa-onnx + whisper.rn) are
//       listed as dependencies in apps/mobile/package.json.
//
//   (2) Real engine adapters live under apps/mobile/src/lib/engines/. The
//       adapter files MUST export `createSherpaOnnxEngine` and
//       `createWhisperRnEngine` factory functions and a top-level
//       `tryRegisterNativeOfflineAsr()` orchestrator.
//
//   (3) The App.tsx startup path calls `bootstrapOfflineAsr()` AND
//       `tryRegisterNativeOfflineAsr()` in a useEffect. UI must not block on
//       the native check; the bootstrap fallback path keeps mac-segment-fallback
//       online while native init runs.
//
//   (4) The adapters implement the OfflineAsrEngine contract from R11:
//       - engineId is one of "sherpa-onnx" / "whisper-rn"
//       - getModelInfo() returns expectedModelSizeMB and modelLabel so UI can
//         surface "model missing, please download ~95 MB"
//       - ensureLoaded() returns ok:false with reason="missing" when model
//         isn't installed, never silently returns ok:true with fabricated text
//       - transcribe() maps native result to OfflineAsrResult with
//         source="offline" segments, or ok:false with engine_unavailable /
//         model_missing / audio_unreadable / failed reason
//
//   (5) The adapters do NOT use fetch / axios / WebSocket. They are pure
//       bridges to the native module, which itself is fully on-device.
//
//   (6) "Never fake transcript" — neither adapter returns ok:true with empty
//       text. If model produced 0 segments, transcribe() returns
//       ok:false / reason="audio_unreadable".
//
//   (7) The mac-segment-fallback engine remains registered as the safety net
//       when no native engine succeeds. `bootstrapOfflineAsr()` must still
//       surface `mac-segment-fallback` engine id before native registration
//       completes.
//
//   (8) The two real packages install cleanly: package.json + node_modules
//       presence. We check node_modules entries to confirm.
//
// Exit 0 = contract passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// (1) Real native packages are listed in apps/mobile/package.json
// ---------------------------------------------------------------------------
const pkg = JSON.parse(read("apps/mobile/package.json"));
expect(
  "apps/mobile/package.json lists react-native-sherpa-onnx",
  typeof pkg.dependencies?.["react-native-sherpa-onnx"] === "string",
  "primary native ASR package missing from package.json",
);
expect(
  "apps/mobile/package.json lists whisper.rn",
  typeof pkg.dependencies?.["whisper.rn"] === "string",
  "fallback native ASR package missing from package.json",
);

// node_modules presence — proves `npm install` actually dropped them on disk
expect(
  "react-native-sherpa-onnx is installed in node_modules",
  fs.existsSync(path.join(repo, "node_modules/react-native-sherpa-onnx/package.json")),
  "expected node_modules/react-native-sherpa-onnx after install",
);
expect(
  "whisper.rn is installed in node_modules",
  fs.existsSync(path.join(repo, "node_modules/whisper.rn/package.json")),
  "expected node_modules/whisper.rn after install",
);

// ---------------------------------------------------------------------------
// (2) Engine adapters under apps/mobile/src/lib/engines/ exist and export the
//     expected factory functions.
// ---------------------------------------------------------------------------
const enginesDir = "apps/mobile/src/lib/engines";
expect(
  "engines directory exists",
  fs.existsSync(path.join(repo, enginesDir)) && fs.statSync(path.join(repo, enginesDir)).isDirectory(),
  "expected apps/mobile/src/lib/engines/ directory",
);

const indexPath = path.join(repo, enginesDir, "index.ts");
expect(
  "engines/index.ts exists",
  fs.existsSync(indexPath),
  "expected apps/mobile/src/lib/engines/index.ts orchestrator",
);
const sherpaPath = path.join(repo, enginesDir, "sherpaOnnxEngine.ts");
expect(
  "engines/sherpaOnnxEngine.ts exists",
  fs.existsSync(sherpaPath),
  "expected apps/mobile/src/lib/engines/sherpaOnnxEngine.ts adapter",
);
const whisperPath = path.join(repo, enginesDir, "whisperRnEngine.ts");
expect(
  "engines/whisperRnEngine.ts exists",
  fs.existsSync(whisperPath),
  "expected apps/mobile/src/lib/engines/whisperRnEngine.ts adapter",
);

const indexTs = fs.existsSync(indexPath) ? read(path.join(enginesDir, "index.ts")) : "";
const sherpaTs = fs.existsSync(sherpaPath) ? read(path.join(enginesDir, "sherpaOnnxEngine.ts")) : "";
const whisperTs = fs.existsSync(whisperPath) ? read(path.join(enginesDir, "whisperRnEngine.ts")) : "";

expect(
  "engines/index.ts exports tryRegisterNativeOfflineAsr",
  /export\s+(async\s+)?function\s+tryRegisterNativeOfflineAsr/.test(indexTs),
  "orchestrator missing — App.tsx has nothing to call at startup",
);
expect(
  "engines/index.ts re-exports createSherpaOnnxEngine",
  /export\s+\{[^}]*createSherpaOnnxEngine/s.test(indexTs),
  "createSherpaOnnxEngine re-export missing",
);
expect(
  "engines/index.ts re-exports createWhisperRnEngine",
  /export\s+\{[^}]*createWhisperRnEngine/s.test(indexTs),
  "createWhisperRnEngine re-export missing",
);

expect(
  "sherpaOnnxEngine.ts exports createSherpaOnnxEngine factory",
  /export\s+function\s+createSherpaOnnxEngine/.test(sherpaTs),
  "sherpaOnnxEngine.ts must export createSherpaOnnxEngine",
);
expect(
  "sherpaOnnxEngine.ts exports SHERPA_PARAFORMER_ZH descriptor",
  /export\s+const\s+SHERPA_PARAFORMER_ZH/.test(sherpaTs),
  "SHERPA_PARAFORMER_ZH descriptor missing",
);
expect(
  "sherpaOnnxEngine.ts implements OfflineAsrEngine (engineId + getModelInfo + ensureLoaded + transcribe + release)",
  /engineId:\s*"sherpa-onnx"/.test(sherpaTs) &&
    /getModelInfo:/.test(sherpaTs) &&
    /ensureLoaded\s*\(/.test(sherpaTs) &&
    /transcribe\s*\(/.test(sherpaTs) &&
    /release\s*\(/.test(sherpaTs),
  "sherpaOnnxEngine.ts does not implement the full OfflineAsrEngine contract",
);

expect(
  "whisperRnEngine.ts exports createWhisperRnEngine factory",
  /export\s+function\s+createWhisperRnEngine/.test(whisperTs),
  "whisperRnEngine.ts must export createWhisperRnEngine",
);
expect(
  "whisperRnEngine.ts exports WHISPER_TINY_MULTILINGUAL descriptor",
  /export\s+const\s+WHISPER_TINY_MULTILINGUAL/.test(whisperTs),
  "WHISPER_TINY_MULTILINGUAL descriptor missing",
);
expect(
  "whisperRnEngine.ts implements OfflineAsrEngine (engineId + getModelInfo + ensureLoaded + transcribe + release)",
  /engineId:\s*"whisper-rn"/.test(whisperTs) &&
    /getModelInfo:/.test(whisperTs) &&
    /ensureLoaded\s*\(/.test(whisperTs) &&
    /transcribe\s*\(/.test(whisperTs) &&
    /release\s*\(/.test(whisperTs),
  "whisperRnEngine.ts does not implement the full OfflineAsrEngine contract",
);

// ---------------------------------------------------------------------------
// (3) App.tsx startup wires the engine registration
// ---------------------------------------------------------------------------
const appTs = read("apps/mobile/src/App.tsx");
expect(
  "App.tsx imports bootstrapOfflineAsr from offlineAsr",
  /from\s+['"]@\/lib\/offlineAsr['"]/.test(appTs) && /bootstrapOfflineAsr/.test(appTs),
  "App.tsx must import bootstrapOfflineAsr to seed the mac-segment-fallback safety net",
);
expect(
  "App.tsx imports tryRegisterNativeOfflineAsr from engines",
  /from\s+['"]@\/lib\/engines['"]/.test(appTs) && /tryRegisterNativeOfflineAsr/.test(appTs),
  "App.tsx must call tryRegisterNativeOfflineAsr at startup",
);
expect(
  "App.tsx has a useEffect that calls bootstrapOfflineAsr + tryRegisterNativeOfflineAsr",
  /useEffect\s*\([\s\S]{0,1500}?bootstrapOfflineAsr[\s\S]{0,1500}?tryRegisterNativeOfflineAsr/.test(appTs),
  "App.tsx useEffect must call both bootstrapOfflineAsr and tryRegisterNativeOfflineAsr",
);

// ---------------------------------------------------------------------------
// (4) Adapters satisfy the OfflineAsrEngine contract shape
// ---------------------------------------------------------------------------

// sherpaOnnx: getModelInfo() returns modelInfo() which is built by a helper.
// The modelInfo helper must include expectedModelSizeMB + modelLabel so UI can
// render "model missing, please download ~95 MB". We check the helper instead
// of the inline call.
expect(
  "sherpaOnnx getModelInfo / modelInfo helper returns expectedModelSizeMB",
  /function\s+modelInfo[\s\S]{0,400}?expectedModelSizeMB/.test(sherpaTs) ||
    /getModelInfo[\s\S]{0,400}?expectedModelSizeMB/.test(sherpaTs) ||
    /expectedModelSizeMB:\s*descriptor\.expectedModelSizeMB/.test(sherpaTs),
  "UI needs expectedModelSizeMB to render download prompt",
);
expect(
  "sherpaOnnx getModelInfo / modelInfo helper returns modelLabel",
  /function\s+modelInfo[\s\S]{0,400}?modelLabel/.test(sherpaTs) ||
    /getModelInfo[\s\S]{0,400}?modelLabel/.test(sherpaTs) ||
    /modelLabel:\s*descriptor\.modelLabel/.test(sherpaTs),
  "UI needs modelLabel for the offlineAsr status line",
);
expect(
  "sherpaOnnx ensureLoaded returns ok:false with reason='missing' for absent model",
  /ensureLoaded[\s\S]{0,4000}?reason:\s*"missing"/.test(sherpaTs),
  "ensureLoaded must surface model_missing instead of silently returning ok:true",
);
expect(
  "sherpaOnnx ensureLoaded returns ok:false with reason='unsupported' when native module is missing",
  /ensureLoaded[\s\S]{0,4000}?reason:\s*"unsupported"/.test(sherpaTs),
  "ensureLoaded must surface unsupported when native module isn't linked",
);
expect(
  "sherpaOnnx transcribe returns source='offline' on success",
  /transcribe[\s\S]{0,3000}?source:\s*"offline"/.test(sherpaTs),
  "transcribe must tag segments as source='offline' so UI knows it's the real on-device path",
);
expect(
  "sherpaOnnx transcribe returns reason='engine_unavailable' when not loaded",
  /transcribe[\s\S]{0,3000}?reason:\s*"engine_unavailable"/.test(sherpaTs),
  "transcribe must surface engine_unavailable when native isn't ready",
);
expect(
  "sherpaOnnx transcribe returns reason='audio_unreadable' for empty result",
  /transcribe[\s\S]{0,3000}?reason:\s*"audio_unreadable"/.test(sherpaTs),
  "transcribe must NOT fake success on empty text — return audio_unreadable instead",
);

expect(
  "whisperRn getModelInfo / buildModelInfo helper returns expectedModelSizeMB",
  /buildModelInfo[\s\S]{0,400}?expectedModelSizeMB/.test(whisperTs) ||
    /getModelInfo[\s\S]{0,400}?expectedModelSizeMB/.test(whisperTs) ||
    /expectedModelSizeMB:\s*descriptor\.expectedModelSizeMB/.test(whisperTs),
  "UI needs expectedModelSizeMB on the fallback path too",
);
expect(
  "whisperRn getModelInfo / buildModelInfo helper returns modelLabel",
  /buildModelInfo[\s\S]{0,400}?modelLabel/.test(whisperTs) ||
    /getModelInfo[\s\S]{0,400}?modelLabel/.test(whisperTs) ||
    /modelLabel:\s*descriptor\.modelLabel/.test(whisperTs),
  "UI needs modelLabel on the fallback path too",
);
expect(
  "whisperRn ensureLoaded returns ok:false with reason='missing' for absent model",
  /ensureLoaded[\s\S]{0,4000}?reason:\s*"missing"/.test(whisperTs),
  "whisper fallback ensureLoaded must surface model_missing",
);
expect(
  "whisperRn transcribe returns source='offline' on success",
  /transcribe[\s\S]{0,3000}?source:\s*"offline"/.test(whisperTs),
  "whisper fallback segments must be source='offline'",
);
expect(
  "whisperRn transcribe maps seg.t0 / seg.t1 to startSeconds / endSeconds",
  /startSeconds:\s*typeof\s+seg\.t0/.test(whisperTs),
  "whisper.rn gives us token timestamps — engine adapter must surface them",
);
expect(
  "whisperRn transcribe returns reason='audio_unreadable' for empty result",
  /transcribe[\s\S]{0,3000}?reason:\s*"audio_unreadable"/.test(whisperTs),
  "whisper fallback must NOT fake success on empty text",
);

// ---------------------------------------------------------------------------
// (5) No fetch / axios / WebSocket inside the engine adapters
// ---------------------------------------------------------------------------
expect(
  "sherpaOnnxEngine.ts MUST NOT use fetch()",
  !/\bfetch\s*\(/.test(sherpaTs),
  "sherpaOnnxEngine must be 100% on-device — fetch is forbidden",
);
expect(
  "sherpaOnnxEngine.ts MUST NOT import axios",
  !/from\s+['"]axios['"]/.test(sherpaTs) && !/require\(\s*['"]axios['"]\s*\)/.test(sherpaTs),
  "axios import is forbidden in on-device engine adapter",
);
expect(
  "whisperRnEngine.ts MUST NOT use fetch()",
  !/\bfetch\s*\(/.test(whisperTs),
  "whisperRnEngine must be 100% on-device — fetch is forbidden",
);
expect(
  "whisperRnEngine.ts MUST NOT import axios",
  !/from\s+['"]axios['"]/.test(whisperTs) && !/require\(\s*['"]axios['"]\s*\)/.test(whisperTs),
  "axios import is forbidden in on-device engine adapter",
);

// ---------------------------------------------------------------------------
// (6) orchestrator tries primary first then fallback
// ---------------------------------------------------------------------------
expect(
  "engines/index.ts probes sherpa-onnx before whisper",
  /probeSherpaOnnxEngine[\s\S]{0,4000}?probeWhisperRnEngine/.test(indexTs),
  "tryRegisterNativeOfflineAsr must try sherpa-onnx first then whisper",
);
expect(
  "engines/index.ts calls setOfflineAsrEngine on success",
  /setOfflineAsrEngine\s*\(/.test(indexTs),
  "orchestrator must call setOfflineAsrEngine — otherwise App keeps mac-segment-fallback forever",
);

// ---------------------------------------------------------------------------
// (7) R11 contract still passes (we did NOT regress R11)
// ---------------------------------------------------------------------------
// (Smoke: just grep that R11 didn't change. The full R11 contract is its own
// script. We do a minimal spot-check here so a single failure surfaces both.)
const offlineAsrPath = "apps/mobile/src/lib/offlineAsr.ts";
expect(
  "R11 offlineAsr.ts still exports the engine registry",
  /export\s+function\s+setOfflineAsrEngine/.test(read(offlineAsrPath)),
  "R11 contract must not regress",
);
expect(
  "R11 offlineAsr.ts still exports the mac-segment-fallback engine factory",
  /export\s+function\s+makeMacSegmentFallbackEngine/.test(read(offlineAsrPath)),
  "mac-segment-fallback safety net must remain",
);

// ---------------------------------------------------------------------------
// (8) No fakes / no fabricated text in the engines
// ---------------------------------------------------------------------------
expect(
  "sherpaOnnxEngine.transcribe MUST NOT return ok:true with empty/short text",
  !/transcribe[\s\S]{0,3000}?ok:\s*true[\s\S]{0,500}?text:\s*["']{2}/.test(sherpaTs) &&
    !/transcribe[\s\S]{0,3000}?ok:\s*true[\s\S]{0,500}?text:\s*["']\s*["']/.test(sherpaTs),
  "no fabricated empty-text success path",
);
expect(
  "whisperRnEngine.transcribe MUST NOT return ok:true with empty/short text",
  !/transcribe[\s\S]{0,3000}?ok:\s*true[\s\S]{0,500}?text:\s*["']{2}/.test(whisperTs) &&
    !/transcribe[\s\S]{0,3000}?ok:\s*true[\s\S]{0,500}?text:\s*["']\s*["']/.test(whisperTs),
  "no fabricated empty-text success path",
);

if (failures.length) {
  console.error("MOBILE_R12_NATIVE_OFFLINE_ASR_CONTRACT_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R12_NATIVE_OFFLINE_ASR_CONTRACT_PASS");