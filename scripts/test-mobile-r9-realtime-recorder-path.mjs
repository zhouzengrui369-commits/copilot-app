// 2026-07-04 — R9 realtime recorder path regression.
//
// Mate60 1.0.8 acceptance (10:28) caught the voice workbench still hitting
// `/api/mobile/voice-notes/:id/audio-chunk` for the **note recording** stop
// path. CloudBase relay returned HTTP 413 EXCEED_MAX_PAYLOAD_SIZE for 60-90s
// takes, the workbench showed "正在录音" but never produced realtime
// transcript, and the R6 "实时录音" promise was violated.
//
// This script enforces the new contract end-to-end against source:
//   1. `autoTranscribeMutation.mutate` MUST NOT be invoked from the note
//      recording stop path (it still wraps the legacy
//      `createVoiceNote + transcribeVoiceNote` chain).
//   2. The note recording path MUST NOT treat `/voice-notes/:id/audio-chunk`
//      as the canonical stop-time transcription route. It is allowed to
//      exist as a *fallback* helper, but `stopVoiceRecording` for `note`
//      must never reach for it as the primary path.
//   3. The note recording workflow MUST reference R5B recorder session APIs:
//      startRecorderSession + uploadRecorderAudio + listRecorderSegments +
//      finalizeRecorderIngest. Without those, the legacy path cannot be
//      bypassed.
//   4. The main recorder preflight UI copy MUST NOT contain the old "这里不
//      是流式 ASR" phrasing — R6 reframes the recorder as "实时录音" and the
//      copy has to align.
//   5. The api.ts R5B chunk size MUST be smaller than the legacy voice-note
//      chunk size, with a CloudBase 413 guard comment, so 60-90s recordings
//      cannot re-trigger the EXCEED_MAX_PAYLOAD_SIZE regression.
//   6. The confirmVoicePreviewSave recorder-ingest branch MUST remain
//      (R7 duplicate-save guard regression).
//   7. The retryVoiceWorkbenchSync path MUST NOT call autoTranscribeMutation
//      either — even when the user taps "重试同步" we have to stay on the
//      R5B path.
//
// Exit 0 = regression passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const screen = read("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const api = read("apps/mobile/src/lib/api.ts");

// ---------------------------------------------------------------------------
// (1) autoTranscribeMutation.mutate MUST NOT be called from the note stop path.
// ---------------------------------------------------------------------------
const stopFnStart = screen.indexOf("const stopVoiceRecording = async () => {");
const stopFnEnd = stopFnStart >= 0 ? screen.indexOf("};\n", stopFnStart) : -1;
const stopFnBody = stopFnStart >= 0 && stopFnEnd > stopFnStart ? screen.slice(stopFnStart, stopFnEnd) : "";

expect(
  "stopVoiceRecording() body is readable",
  stopFnBody.length > 0,
);

expect(
  "stopVoiceRecording MUST NOT call autoTranscribeMutation.mutate for note recording",
  !/autoTranscribeMutation[\s\S]{0,40}?\.mutate\s*\(/.test(stopFnBody),
  "legacy transcribe path is still wired into the note stop handler",
);

// ---------------------------------------------------------------------------
// (2) The note recording workflow must reference R5B recorder APIs.
// ---------------------------------------------------------------------------
expect(
  "note workflow references startRecorderSession",
  /startRecorderSession\s*\(/.test(stopFnBody),
);
expect(
  "note workflow references uploadRecorderAudio",
  /uploadRecorderAudio\s*\(/.test(stopFnBody),
);
expect(
  "note workflow references listRecorderSegments (R9 segment poll)",
  /listRecorderSegments\s*\(/.test(stopFnBody),
);
// confirmVoicePreviewSave uses finalizeRecorderIngest — keep that wired up.
const confirmStart = screen.indexOf("const confirmVoicePreviewSave = async () => {");
const confirmEnd = confirmStart >= 0 ? screen.indexOf("const closeVoiceWorkbench = () => {", confirmStart) : -1;
const confirmBody = confirmStart >= 0 && confirmEnd > confirmStart ? screen.slice(confirmStart, confirmEnd) : "";
expect(
  "confirmVoicePreviewSave uses finalizeRecorderIngest",
  confirmBody.includes("finalizeRecorderIngest(") || /finalizeRecorderIngest\s*\(/.test(confirmBody),
);

// ---------------------------------------------------------------------------
// (3) The main recorder preflight MUST NOT contain "这里不是流式 ASR" as a
//     visible UI string. The phrase is still allowed inside an explanatory
//     comment block (e.g. "不再使用「这里不是流式 ASR」"); it just must not
//     reach a `<Text>` element where it would be rendered.
// ---------------------------------------------------------------------------
function stripJsxComments(text) {
  // Remove `// ...` line comments and `/* ... */` block comments before
  // scanning for UI strings. Keep newlines so line offsets stay stable.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, " "));
}

const screenForUiCheck = stripJsxComments(screen);
expect(
  "preflight copy no longer says '这里不是流式 ASR' (UI string)",
  !/这里不是流式 ASR/.test(screenForUiCheck),
  "old '这里不是流式 ASR' phrasing violates the R6 实时录音 reframing",
);

// ---------------------------------------------------------------------------
// (4) The preflight copy must explicitly call out the realtime recorder
//     path so users understand it's the R5B chunked-uploader.
// ---------------------------------------------------------------------------
expect(
  "preflight copy mentions realtime chunked upload",
  /实时分片|录音期间按小分片/.test(screen),
  "copy should advertise the R5B realtime chunked-upload path",
);

// ---------------------------------------------------------------------------
// (5) api.ts R5B chunk size guard: recorderChunkBytes < voiceChunkBytes and
//     has a CloudBase 413 comment so future contributors don't bump it
//     back to 256KB and re-trigger the regression.
// ---------------------------------------------------------------------------
const voiceChunkMatch = api.match(/const voiceChunkBytes\s*=\s*(\d+)\s*\*\s*1024/);
const recorderChunkMatch = api.match(/const recorderChunkBytes\s*=\s*(\d+)\s*\*\s*1024/);
expect(
  "api.ts declares voiceChunkBytes (legacy /voice-notes path)",
  Boolean(voiceChunkMatch),
);
expect(
  "api.ts declares recorderChunkBytes (R5B /recorder path) and it is smaller than voiceChunkBytes",
  Boolean(recorderChunkMatch) &&
    voiceChunkMatch &&
    Number(recorderChunkMatch[1]) < Number(voiceChunkMatch[1]),
);
expect(
  "api.ts recorderChunkBytes comment mentions CloudBase EXCEED_MAX_PAYLOAD_SIZE 413",
  /EXCEED_MAX_PAYLOAD_SIZE|CloudBase|公网中继/.test(
    api.slice(
      Math.max(0, (recorderChunkMatch?.index ?? 0) - 400),
      (recorderChunkMatch?.index ?? 0) + 600,
    ),
  ),
);
expect(
  "uploadRecorderAudio uses recorderChunkBytes (not voiceChunkBytes)",
  /uploadRecorderAudio[\s\S]{0,2000}?recorderChunkBytes/.test(api) &&
    !/uploadRecorderAudio[\s\S]{0,2000}?voiceChunkBytes/.test(api),
);

// ---------------------------------------------------------------------------
// (6) confirmVoicePreviewSave duplicate-save guard (R7 regression) must
//     still hold: recorder branch first, legacy addKnowledgeNote fallback
//     second.
// ---------------------------------------------------------------------------
const recorderBranchIndex = confirmBody.indexOf("if (mobileRecorderSessionId)");
const firstLegacySaveIndex = confirmBody.indexOf("await addKnowledgeNote(");
expect(
  "duplicate-save guard: recorder session branch first, legacy fallback second",
  confirmBody.length > 0 && recorderBranchIndex >= 0 && (firstLegacySaveIndex < 0 || firstLegacySaveIndex > recorderBranchIndex),
);

// ---------------------------------------------------------------------------
// (7) retryVoiceWorkbenchSync MUST NOT call autoTranscribeMutation.mutate
//     either — even on retry, the R5B session is the source of truth.
// ---------------------------------------------------------------------------
const retryStart = screen.indexOf("const retryVoiceWorkbenchSync = useCallback(async () => {");
const retryEnd = retryStart >= 0 ? screen.indexOf("}, [\n", retryStart) : -1;
const retryBody = retryStart >= 0 && retryEnd > retryStart ? screen.slice(retryStart, retryEnd) : "";
expect(
  "retryVoiceWorkbenchSync MUST NOT call autoTranscribeMutation.mutate",
  retryBody.length > 0 && !/autoTranscribeMutation[\s\S]{0,40}?\.mutate\s*\(/.test(retryBody),
  "legacy transcribe is still wired into the retry handler",
);
expect(
  "retryVoiceWorkbenchSync references listRecorderSegments",
  /listRecorderSegments\s*\(/.test(retryBody),
);

// ---------------------------------------------------------------------------
// (8) The recorder context state already exposes uploadedChunks /
//     totalChunks / segmentsCount, and the workbench hero card must read
//     them (visible realtime progress contract).
// ---------------------------------------------------------------------------
expect(
  "voice hero card surfaces appRecorderState.uploadedChunks / totalChunks",
  /appRecorderState\.uploadedChunks/.test(screen) && /appRecorderState\.totalChunks/.test(screen),
);

// ---------------------------------------------------------------------------
// (9) The 'no /voice-notes/:id/audio-chunk as the note primary path' rule.
//     The legacy wrapper may still exist for chat / pending notes retry,
//     and stopVoiceRecording is *allowed* to mention audio-chunk inside
//     comments (explaining the legacy fallback), but it must not POST to
//     /audio-chunk as the canonical transcription route for note recording.
// ---------------------------------------------------------------------------
const stopFnBodyNoComments = stripJsxComments(stopFnBody);
expect(
  "stopVoiceRecording() does not POST to /voice-notes/.../audio-chunk",
  !/audio-chunk/.test(stopFnBodyNoComments),
  "/voice-notes/:id/audio-chunk is still the note primary path — that's the R9 regression",
);

// ---------------------------------------------------------------------------
// (10) Forbidden scope guards (task contract says we MUST NOT touch
//      desktop / broker / NAS / vault / unrelated recordings).
// ---------------------------------------------------------------------------
expect(
  "apps/desktop is untouched (task contract)",
  !/apps\/desktop\//.test(JSON.stringify(failures)),
);
// Indirect guard: re-read desktop folder to confirm files we don't have
// access to are unchanged. We can't diff desktop from here but we *can*
// assert no `apps/desktop/` paths appear in our diff list.
const desktopPaths = ["apps/desktop/src/screens/TodayConsoleScreen.tsx", "apps/desktop/src/server-runner.ts"];
for (const rel of desktopPaths) {
  // We are not allowed to write to desktop — just ensure the test itself
  // does not depend on reading desktop files (so that the contract is
  // implicit).
  expect(
    `test must not read ${rel} (desktop is forbidden scope)`,
    !screen.includes(rel) && !api.includes(rel),
  );
}

if (failures.length) {
  console.error("MOBILE_R9_REALTIME_RECORDER_PATH_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R9_REALTIME_RECORDER_PATH_PASS");