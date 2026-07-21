#!/usr/bin/env node
// 2026-07-06 — R18: Emulator-First Real Recorder ASR Fix contract probe.
//
// Mate60 1.0.8 acceptance (R18 retry) must prove the actual recorder runtime
// shows real local-ASR transcript text — not the 远端兜底 fake-progress copy
// that R17 left behind — and verify the source on Android emulator / runtime
// before any Mate60 APK is produced.
//
// R18 contract probe enforces these via file-grep + ts type contracts + a
// Node-side transpile runtime check of the recorder loop:
//
//   (1) offlineAsr.ts adds an honest "local segment push" entry point:
//       `recordLocalAsrSegment(text, startSec, endSec, engineId)` that appends
//       a segment tagged source="offline", engineId="sherpa-onnx"|"whisper-rn".
//       Without this, no UI counter for "本地 ASR 实时段" can ever increment.
//
//   (2) offlineAsr.ts exposes getLocalSegmentsCount() so the recorder state
//       machine can mirror "本地 ASR 已实时转写 X 段" without re-implementing
//       the filter.
//
//   (3) RecorderContext.tsx wires localSegmentsCount into RecorderState, has
//       a reportLocalAsrSegment() action, and resets to 0 on start() (so
//       next recording session doesn't inherit prior segments).
//
//   (4) TodayConsoleScreen.tsx — the active recording path **actually calls**
//       transcribeOffline() during recording:
//       - rollLiveSegment useEffect, after uploadRecorderLiveSegment(), also
//         invokes transcribeOffline() on the just-finished rolled chunk,
//         and on success calls recordLocalAsrSegment + reportLocalAsrSegment
//         + appends text to voiceTranscript.
//       - stopVoiceRecording does the same whole-audio transcribe as a final
//         safety net.
//
//   (5) The voiceHeroMeta / realtime row / live-transcription-status /
//       realtime-hint surfaces localSegmentsCount *explicitly*. When
//       localSegmentsCount > 0, the active status is "本地 ASR 已实时转写 X 段"
//       — NEVER "远端兜底转写片段待命中".
//
//   (6) "远端兜底转写片段待命中" copy (the exact string NJX rejected on Mate60)
//       must NOT be the sole/default active recording copy. It now sits as a
//       degraded secondary status only when local ASR is missing AND
//       no local ASR segment has been produced.
//
//   (7) Stable testIDs for the live local-ASR counter:
//         mobile-voice-workbench-hero-meta        (recording hero meta)
//         mobile-voice-workbench-realtime-hint    (recording secondary row)
//         mobile-recorder-local-asr-segment-count (workspace transcript card)
//         mobile-recorder-asr-segment-meta        (workspace status card)
//
//   (8) npm run check --workspace @openclaw-workbench/mobile passes.
//
//   (9) Existing R11/R12/R12B/R17 contract tests still pass — no regressions.
//
// Exit 0 = contract passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(repo, rel));

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// (1) offlineAsr.ts — recordLocalAsrSegment pushes a real local-engine segment.
// ---------------------------------------------------------------------------
const offlineAsrPath = "apps/mobile/src/lib/offlineAsr.ts";
let offlineAsr = "";
try {
  offlineAsr = read(offlineAsrPath);
} catch {
  failures.push("offlineAsr.ts MUST exist at apps/mobile/src/lib/offlineAsr.ts");
}

expect("offlineAsr.ts exists", offlineAsr.length > 0);

if (offlineAsr) {
  expect(
    "offlineAsr.ts exports recordLocalAsrSegment(text, startSec, endSec, engineId)",
    /export\s+function\s+recordLocalAsrSegment\s*\(\s*text\s*:/.test(offlineAsr) &&
      /startSeconds\s*[?:]\s*number\s*\|\s*null/.test(offlineAsr) &&
      /engineId\s*:\s*["']sherpa-onnx["']\s*\|\s*["']whisper-rn["']/.test(offlineAsr),
    "R18 needs recordLocalAsrSegment with engineId gating",
  );

  expect(
    "recordLocalAsrSegment writes segments with source='offline' and engineId passed in",
    /recordLocalAsrSegment[\s\S]{0,1500}?source:\s*["']offline["']/.test(offlineAsr) &&
      /recordLocalAsrSegment[\s\S]{0,1500}?engineId/.test(offlineAsr),
    "R18 recordLocalAsrSegment must tag source=offline + engineId",
  );

  expect(
    "offlineAsr.ts also exposes getLocalSegmentsCount() (sherpa-onnx / whisper-rn only)",
    /export\s+function\s+getLocalSegmentsCount\s*\(/.test(offlineAsr) &&
      /getLocalSegmentsCount[\s\S]{0,400}?["']sherpa-onnx["']/.test(offlineAsr) &&
      /getLocalSegmentsCount[\s\S]{0,400}?["']whisper-rn["']/.test(offlineAsr),
    "R18 must expose getLocalSegmentsCount with engineId filter",
  );

  expect(
    "offlineAsr.ts exports resetLocalSegmentsForNewRecording() to clear segments between sessions",
    /export\s+function\s+resetLocalSegmentsForNewRecording\s*\(/.test(offlineAsr),
    "R18 must allow RecorderContext to reset local segments between recordings",
  );
}

// ---------------------------------------------------------------------------
// (2) RecorderContext.tsx — localSegmentsCount + reportLocalAsrSegment.
// ---------------------------------------------------------------------------
const recorderCtxPath = "apps/mobile/src/lib/RecorderContext.tsx";
let recorderCtx = "";
try {
  recorderCtx = read(recorderCtxPath);
} catch {
  failures.push("RecorderContext.tsx MUST exist");
}

if (recorderCtx) {
  expect(
    "RecorderState declares localSegmentsCount: number",
    /localSegmentsCount:\s*number/.test(recorderCtx),
    "RecorderState must track localSegmentsCount distinct from segmentsCount",
  );

  expect(
    "RecorderActions exposes reportLocalAsrSegment()",
    /reportLocalAsrSegment:\s*\(\s*\)\s*=>\s*void/.test(recorderCtx) ||
      /reportLocalAsrSegment\s*\?:\s*\(\s*\)\s*=>\s*void/.test(recorderCtx),
    "RecorderActions must expose reportLocalAsrSegment()",
  );

  expect(
    "start() resets localSegmentsCount to 0",
    /start\s*=[\s\S]{0,1500}?localSegmentsCount:\s*0/.test(recorderCtx),
    "start() must reset localSegmentsCount so prior session doesn't bleed into new one",
  );

  expect(
    "reportLocalAsrSegment callback increments localSegmentsCount",
    /reportLocalAsrSegment[\s\S]{0,300}?localSegmentsCount:\s*prev\.localSegmentsCount\s*\+\s*1/.test(recorderCtx),
    "reportLocalAsrSegment must increment localSegmentsCount",
  );

  expect(
    "RecorderContext imports resetLocalSegmentsForNewRecording and calls it on start/close",
    /import\s*\{[\s\S]{0,150}?resetLocalSegmentsForNewRecording[\s\S]{0,150}?\}\s*from\s*["']@\/lib\/offlineAsr["']/.test(recorderCtx) &&
      /resetLocalSegmentsForNewRecording\(\)/.test(recorderCtx),
    "RecorderContext must call resetLocalSegmentsForNewRecording() at start/close boundaries",
  );
}

// ---------------------------------------------------------------------------
// (3) TodayConsoleScreen.tsx — actual runtime local-ASR during recording.
//
// This is the core R18 acceptance: the active recording path MUST invoke
// transcribeOffline() on each rolled chunk, not just on stop. The previous
// behavior was: server upload + polling segments, local ASR is silent.
// ---------------------------------------------------------------------------
const todayConsolePath = "apps/mobile/src/screens/TodayConsoleScreen.tsx";
let todayConsole = "";
try {
  todayConsole = read(todayConsolePath);
} catch {
  failures.push("TodayConsoleScreen.tsx MUST exist");
}

if (todayConsole) {
  expect(
    "TodayConsoleScreen imports transcribeOffline from offlineAsr",
    /import\s*\{[\s\S]{0,200}?transcribeOffline[\s\S]{0,200}?\}\s*from\s*["']@\/lib\/offlineAsr["']/.test(todayConsole),
    "TodayConsoleScreen must import transcribeOffline from offlineAsr",
  );

  expect(
    "TodayConsoleScreen imports recordLocalAsrSegment from offlineAsr",
    /import\s*\{[\s\S]{0,400}?recordLocalAsrSegment[\s\S]{0,400}?\}\s*from\s*["']@\/lib\/offlineAsr["']/.test(todayConsole),
    "TodayConsoleScreen must call recordLocalAsrSegment to push real local segments",
  );

  expect(
    "rollLiveSegment function actually calls transcribeOffline() on the just-finished chunk",
    /rollLiveSegment[\s\S]{0,4000}?transcribeOffline\s*\(\s*\{/.test(todayConsole),
    "rollLiveSegment MUST call transcribeOffline inside the loop — not only in stop",
  );

  expect(
    "rollLiveSegment calls transcribeOffline only when isLocalAsrMainPath() is true",
    /isLocalAsrMainPath\(\)/.test(todayConsole),
    "rollLiveSegment must guard transcribeOffline with isLocalAsrMainPath so noop engine isn't invoked",
  );

  expect(
    "rollLiveSegment calls recordLocalAsrSegment after transcribeOffline succeeds",
    /recordLocalAsrSegment\s*\(/.test(todayConsole),
    "recording loop must push real local segments to offlineAsr state",
  );

  expect(
    "stopVoiceRecording also runs transcribeOffline() as a final safety net",
    /stopVoiceRecording[\s\S]{0,5000}?transcribeOffline\s*\(\s*\{/.test(todayConsole),
    "stop handler must invoke transcribeOffline on the full audio as a fallback for last chunk",
  );

  expect(
    "stopVoiceRecording pushes local segments via recordLocalAsrSegment after stop transcribe",
    /stopVoiceRecording[\s\S]{0,8000}?recordLocalAsrSegment\s*\(/.test(todayConsole),
    "stop handler must also push final segments to offlineAsr lastSegments",
  );
}

// ---------------------------------------------------------------------------
// (4) UI copy demotes 远端兜底 — exact string NJX rejected on Mate60.
// ---------------------------------------------------------------------------

const rejectedCopy = "远端兜底转写片段待命中";

const voiceHeroMetaBranch = (() => {
  if (!todayConsole) return "";
  const m = todayConsole.match(/mobile-voice-workbench-hero-meta[\s\S]{0,4000}?\}\s*\)\s*\}/);
  return m ? m[0] : "";
})();

expect(
  "R18 contract: voiceHeroMeta is no longer dominated by 远端兜底转写片段待命中",
  !voiceHeroMetaBranch.includes(rejectedCopy),
  `The rejected Mate60 copy "${rejectedCopy}" must not be the dominant active recording copy in voiceHeroMeta`,
);

// The rejected copy may still exist in the file as a degraded secondary
// fallback when local ASR is missing — but it must NOT be the active status.
const localLiveLabelRegex = /本地 ASR 已实时转写\s+\$\{appRecorderState\.localSegmentsCount\}\s+段|voiceLocalLiveLabel/;

expect(
  "voiceHeroMeta now references voiceLocalLiveLabel (本地 ASR 已实时转写 X 段) as primary",
  localLiveLabelRegex.test(todayConsole),
  "voiceHeroMeta must surface 本地 ASR 已实时转写 X 段 as the new primary status",
);

// ---------------------------------------------------------------------------
// (5) Stable testIDs for the local ASR recording path.
// ---------------------------------------------------------------------------
const requiredR18TestIds = [
  "mobile-voice-workbench-hero-meta",
  "mobile-voice-workbench-realtime-hint",
  "mobile-recorder-local-asr-segment-count",
  "mobile-recorder-asr-segment-meta",
];

for (const id of requiredR18TestIds) {
  expect(
    `R18 stable testID "${id}" exists`,
    new RegExp(`testID\\s*=\\s*["']${id.replace(/[-]/g, "-")}["']`).test(todayConsole) ||
      new RegExp(`testID\\s*=\\s*["']${id.replace(/[-]/g, "-")}["']`).test(read("apps/mobile/src/components/RecorderWorkspace.tsx")),
    `missing testID "${id}" — must be present on TodayConsoleScreen OR RecorderWorkspace for R18 acceptance`,
  );
}

// ---------------------------------------------------------------------------
// (6) RecorderWorkspace.tsx — shows local ASR count distinct from server count.
// ---------------------------------------------------------------------------
const recorderWsPath = "apps/mobile/src/components/RecorderWorkspace.tsx";
let recorderWs = "";
try {
  recorderWs = read(recorderWsPath);
} catch {
  failures.push("RecorderWorkspace.tsx MUST exist");
}

if (recorderWs) {
  expect(
    "RecorderWorkspace destructures localSegmentsCount",
    /localSegmentsCount/.test(recorderWs),
    "RecorderWorkspace must destructure localSegmentsCount from RecorderState",
  );

  expect(
    "RecorderWorkspace transcript card shows 本地 ASR 段 count",
    /本地 ASR 段\s*\{localSegmentsCount\}/.test(recorderWs) ||
      /localSegmentsCount\s*\}[\s\S]{0,200}?本地 ASR/.test(recorderWs),
    "RecorderWorkspace transcript card must show 本地 ASR 段 count",
  );

  expect(
    "RecorderWorkspace statusMeta now distinguishes 本地 ASR 段 vs 远端兜底段",
    /本地 ASR 段\s+\{localSegmentsCount\}\s*·\s*远端兜底段\s+\{segmentsCount\}/.test(recorderWs) ||
      /本地 ASR 段/.test(recorderWs) &&
        /远端兜底段/.test(recorderWs),
    "RecorderWorkspace statusMeta must show separate 本地 ASR 段 vs 远端兜底段 counters",
  );
}

// ---------------------------------------------------------------------------
// (7) Pause/resume/stop controls + QR pairing — R17 regressions must NOT exist.
// ---------------------------------------------------------------------------
expect(
  "R17 pause/resume controls still in TodayConsoleScreen inline workbench",
  /testID\s*=\s*["']mobile-voice-workbench-pause["']/.test(todayConsole) &&
    /testID\s*=\s*["']mobile-voice-workbench-resume["']/.test(todayConsole) &&
    /testID\s*=\s*["']mobile-voice-workbench-stop-end["']/.test(todayConsole),
  "R17 pause/resume/stop controls must remain",
);

expect(
  "R17 QR scan pairing entry still exposed",
  /testID\s*=\s*["']mobile-qr-scan-panel["']/.test(todayConsole) &&
    /testID\s*=\s*["']mobile-pair-qr-open["']/.test(todayConsole) &&
    /testID\s*=\s*["']mobile-pair-qr-clipboard["']/.test(todayConsole),
  "R17 QR pairing entry must remain",
);

// ---------------------------------------------------------------------------
// (8) Runtime check: transcribeOffline path can be reached from rollLiveSegment.
//
// We can't run the real Expo/RN stack in Node, but we can transpile the
// offlineAsr module to ESM and exercise recordLocalAsrSegment + the local
// segment counter to prove the new helpers are runtime-functional (not just
// types).
// ---------------------------------------------------------------------------
const runtimeCheck = spawnSync(
  "node",
  [
    "--input-type=module",
    "--no-warnings",
    "-e",
    `
    import { spawnSync } from "node:child_process";
    const transpile = spawnSync("npx", [
      "--yes", "esbuild",
      "--bundle=false", "--format=esm", "--target=es2020",
      "--loader:.ts=ts",
      "--outfile=/tmp/r18_offlineAsr_check.mjs",
      "apps/mobile/src/lib/offlineAsr.ts"
    ], { encoding: "utf8" });
    if (transpile.status !== 0) {
      console.error("ESBUILD_FAILED", transpile.stdout, transpile.stderr);
      process.exit(2);
    }
    const mod = await import("/tmp/r18_offlineAsr_check.mjs");
    // reset to a known state
    mod.__resetOfflineAsrForTests();
    // 1. recordLocalAsrSegment with sherpa-onnx
    const a = mod.recordLocalAsrSegment("测试本地 ASR 第一段", 0, 12, "sherpa-onnx");
    if (!a || a.engineId !== "sherpa-onnx" || a.source !== "offline") {
      console.error("RECORD_LOCAL_BAD", JSON.stringify(a));
      process.exit(3);
    }
    // 2. recordLocalAsrSegment with whisper-rn
    const b = mod.recordLocalAsrSegment("测试 whisper 第二段", 12, 24, "whisper-rn");
    if (!b || b.engineId !== "whisper-rn") {
      console.error("RECORD_WHISPER_BAD", JSON.stringify(b));
      process.exit(4);
    }
    // 3. recordMacSegment with mac-segment-fallback should NOT be counted as local
    mod.recordMacSegment("远端兜底片段");
    const cnt = mod.getLocalSegmentsCount();
    if (cnt !== 2) {
      console.error("LOCAL_COUNT_BAD", cnt);
      process.exit(5);
    }
    // 4. lastSegments has 3 entries (2 local + 1 mac)
    const state = mod.getOfflineAsrState();
    if (state.lastSegments.length !== 3) {
      console.error("SEGMENTS_LEN_BAD", state.lastSegments.length);
      process.exit(6);
    }
    // 5. lastTranscript merges all text
    if (!state.lastTranscript || !state.lastTranscript.includes("测试本地 ASR 第一段")) {
      console.error("LAST_TRANSCRIPT_BAD", state.lastTranscript);
      process.exit(7);
    }
    // 6. resetLocalSegmentsForNewRecording clears
    mod.resetLocalSegmentsForNewRecording();
    const cleared = mod.getOfflineAsrState();
    if (cleared.lastSegments.length !== 0) {
      console.error("RESET_BAD", cleared.lastSegments.length);
      process.exit(8);
    }
    // 7. Empty text returns null
    if (mod.recordLocalAsrSegment("   ", null, null, "sherpa-onnx") !== null) {
      console.error("EMPTY_TEXT_NOT_NULL", "expected null");
      process.exit(9);
    }
    console.log("R18_OFFLINE_ASR_RUNTIME_PASS");
    `,
  ],
  { encoding: "utf8", cwd: repo },
);

if (runtimeCheck.status !== 0) {
  failures.push(
    `offlineAsr runtime check failed (exit ${runtimeCheck.status}) — ${(runtimeCheck.stdout || "").slice(0, 600)} | ${(runtimeCheck.stderr || "").slice(0, 600)}`,
  );
} else if (!/R18_OFFLINE_ASR_RUNTIME_PASS/.test(runtimeCheck.stdout || "")) {
  failures.push(
    `offlineAsr runtime check did not produce R18_OFFLINE_ASR_RUNTIME_PASS: ${(runtimeCheck.stdout || "").slice(0, 200)}`,
  );
} else {
  console.log(`[R18] offlineAsr runtime check: PASS`);
}

// ---------------------------------------------------------------------------
// (9) npm run check --workspace @openclaw-workbench/mobile passes.
// ---------------------------------------------------------------------------
const tsc = spawnSync(
  "npm",
  ["run", "check", "--workspace", "@openclaw-workbench/mobile"],
  { encoding: "utf8", cwd: repo },
);
expect(
  "npm run check --workspace @openclaw-workbench/mobile passes (exit 0)",
  tsc.status === 0,
  `exit ${tsc.status} — ${(tsc.stdout || "").slice(-600)}`,
);

// ---------------------------------------------------------------------------
// (10) Existing R11/R12/R12B/R17 contract tests must still pass.
// ---------------------------------------------------------------------------
for (const [name, file, marker] of [
  ["R11", "scripts/test-mobile-r11-offline-asr-contract.mjs", /MOBILE_R11_OFFLINE_ASR_CONTRACT_PASS/],
  ["R12", "scripts/test-mobile-r12-native-offline-asr.mjs", null],
  ["R12B", "scripts/test-mobile-r12b-bundled-model-contract.mjs", /MOBILE_R12B_BUNDLED_MODEL_CONTRACT_PASS/],
  ["R17", "scripts/test-mobile-r17-recorder-local-asr-ui-contract.mjs", /MOBILE_R17_RECORDER_LOCAL_ASR_UI_CONTRACT_PASS/],
]) {
  const res = spawnSync("node", [file], { encoding: "utf8", cwd: repo });
  if (marker) {
    expect(
      `${name} contract test still passes`,
      res.status === 0 && marker.test(res.stdout || ""),
      `exit ${res.status} — ${(res.stdout || "").slice(-400)}`,
    );
  } else {
    expect(
      `${name} contract test still passes`,
      res.status === 0,
      `exit ${res.status} — ${(res.stdout || "").slice(-400)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length) {
  console.error("MOBILE_R18_EMULATOR_RECORDER_ASR_CONTRACT_FAIL");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("MOBILE_R18_EMULATOR_RECORDER_ASR_CONTRACT_PASS");
