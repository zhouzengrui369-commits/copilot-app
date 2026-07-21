// 2026-07-04 — R9B realtime / near-realtime transcript loop regression.
//
// Mate60 1.0.8 acceptance (post-R9) still showed the recording workbench
// feeling like "record now, maybe see text after stop". R9 fixed the *stop*
// path (chunks → segments → finalize), but the *during recording* phase was
// blank. R9B adds a low-frequency polling loop on the existing R5B
// recorder session: while the recorder workbench is open AND recording is
// active AND a session id exists, it calls listRecorderSegments() at a
// fixed interval and merges new segments into the visible transcript draft.
//
// Source-level contract (no Jest / RN runtime — we are deliberately source
// only so this probe runs in CI without a Metro packager):
//
//   (1) The screen declares a fixed polling interval constant that is
//       greater than or equal to the contract floor (8000ms). Anything
//       faster would re-introduce the high-frequency loop that the R6
//       contract explicitly rejected.
//
//   (2) The screen contains a useEffect-style polling loop that calls
//       `listRecorderSegments(...)` and writes its result back into the
//       visible transcript state (`setVoiceTranscript`). Without (2), the
//       workbench has no realtime path and the contract is violated.
//
//   (3) The polling loop must only run while the workbench is "open" — i.e.
//       not while the user has minimized the workbench or closed it. The
//       loop must also short-circuit when the session is missing, so a
//       partially-booted recorder does not hammer a non-existent endpoint.
//
//   (4) The polling loop must merge segments without duplicating them. The
//       screen has to track segment ids it has already appended, otherwise
//       every poll will double-print everything.
//
//   (5) The visible UI must show honest realtime state:
//       * A hero meta line that says "实时转写" (or close to it) during
//         active recording.
//       * A fallback / empty state that literally says "录音中,等待 Mac 转写
//         片段" (the contract's mandated copy).
//       * A dedicated testID'd row (mobile-recorder-realtime-status) so a
//         downstream UI contract probe can find it.
//
//   (6) The polling loop MUST NOT call `autoTranscribeMutation.mutate(...)`
//       and MUST NOT POST to `/voice-notes/:id/audio-chunk`. Those are the
//       two legacy paths R9 removed for the note recording flow.
//
//   (7) The duplicate-save guard in confirmVoicePreviewSave (recorder
//       branch first, addKnowledgeNote fallback second) MUST remain in
//       place. R9B only adds a *during-recording* loop; it cannot change
//       the *confirm-time* guard.
//
//   (8) The stop handler (stopVoiceRecording) MUST still use
//       uploadRecorderAudio + listRecorderSegments + startRecorderSession
//       (R9 contract), and MUST still NOT call autoTranscribeMutation.mutate.
//       R9B does not relax that.
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
// (1) Fixed polling-interval constant must be >= 8000ms (contract floor).
// ---------------------------------------------------------------------------
const intervalMatch = screen.match(/RECORDER_SEGMENT_POLL_MS\s*=\s*([0-9_]+)/);
const intervalMs = intervalMatch ? Number(intervalMatch[1].replaceAll("_", "")) : null;
expect(
  "screen declares RECORDER_SEGMENT_POLL_MS constant",
  intervalMatch !== null,
  "no RECORDER_SEGMENT_POLL_MS constant — the contract requires a fixed interval",
);
expect(
  "RECORDER_SEGMENT_POLL_MS >= 8000ms (contract floor)",
  intervalMs !== null && intervalMs >= 8000,
  intervalMs === null
    ? "constant not found"
    : `interval=${intervalMs}ms violates the >=8000ms floor — would re-introduce high-frequency polling`,
);
// Hard cap: even on the generous end of the contract (15s), make sure we
// didn't accidentally pick 60s which would defeat the "near-realtime" promise.
expect(
  "RECORDER_SEGMENT_POLL_MS <= 30000ms (sanity cap)",
  intervalMs !== null && intervalMs <= 30_000,
  intervalMs === null ? "constant not found" : `interval=${intervalMs}ms is too slow to feel realtime`,
);

// ---------------------------------------------------------------------------
// (2) The screen must contain a polling useEffect that wires listRecorderSegments
//     into the visible transcript state.
// ---------------------------------------------------------------------------
expect(
  "screen has a useEffect that calls listRecorderSegments",
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,4000}?listRecorderSegments\s*\([\s\S]{0,2000}?setVoiceTranscript/m.test(screen),
  "polling loop must call listRecorderSegments and merge the result into setVoiceTranscript",
);
expect(
  "screen uses setInterval (not setTimeout) for the realtime loop",
  /setInterval\s*\(\s*fetchSegments\s*,\s*RECORDER_SEGMENT_POLL_MS\s*\)/.test(screen),
  "polling loop must use setInterval at the fixed RECORDER_SEGMENT_POLL_MS interval",
);
expect(
  "screen tears down the timer on cleanup (clearInterval)",
  /return\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}?clearInterval\(\s*timer\s*\)[\s\S]{0,80}?\}\s*;\s*\}/m.test(screen),
  "polling useEffect must clear its interval on cleanup so it stops when recording stops",
);

// ---------------------------------------------------------------------------
// (3) The polling loop must gate on the right conditions: workbench open,
//     recording active, session id present.
// ---------------------------------------------------------------------------
expect(
  "polling loop requires mobileRecorderSessionId",
  /if\s*\(\s*!mobileRecorderSessionId\s*\)/.test(screen),
  "polling loop must short-circuit when no R5B session id exists",
);
expect(
  "polling loop requires noteRecordingActive",
  /if\s*\(\s*!noteRecordingActive\s*\)\s*return\s+undefined;?/.test(screen),
  "polling loop must short-circuit when not actively recording",
);
expect(
  "polling loop requires voiceWorkbenchOpen && !voiceWorkbenchMinimized",
  /voiceWorkbenchOpen\s*\|\|\s*voiceWorkbenchMinimized[\s\S]{0,40}?return/.test(screen),
  "polling loop must not run when workbench is closed or minimized",
);

// ---------------------------------------------------------------------------
// (4) The polling loop must merge segments without duplicating them. It must
//     track segment ids it has already appended.
// ---------------------------------------------------------------------------
expect(
  "polling loop tracks seen segment ids (no duplication)",
  /seenSegmentIdsRef/.test(screen) &&
    (/seen\.has\(\s*id\s*\)/.test(screen) || /seenSegmentIdsRef\.current\.has\(\s*id\s*\)/.test(screen)),
  "polling loop must keep a Set of segment ids it has already appended",
);
expect(
  "polling loop adds new ids to the seen set",
  /seen\.add\(\s*id\s*\)/.test(screen) || /seenSegmentIdsRef\.current\.add\(\s*id\s*\)/.test(screen),
  "polling loop must add newly observed segment ids to the seen set",
);
expect(
  "polling loop resets seen-set when mobileRecorderSessionId changes",
  /!mobileRecorderSessionId[\s\S]{0,80}?seenSegmentIdsRef\.current\s*=\s*new\s+Set/.test(screen),
  "polling loop must reset the seen-set when the session id is cleared (restart recording)",
);

// ---------------------------------------------------------------------------
// (5) The visible UI must show honest realtime state. Multiple contract
//     requirements: "实时转写" in the hero meta, "录音中,等待 Mac 转写片段"
//     fallback copy, and a dedicated testID'd status row.
//     R11 — the "Mac 转写片段" literal was promoted to "远端兜底片段" /
//     "本地 ASR 转写片段" because R11 removed Mac-as-primary-ASR-route
//     wording. The honest-state contract is unchanged — we still require
//     (a) realtime copy in the hero meta and (b) a "录音中,等待 X 转写片段"
//     fallback line where X is one of the R11-allowed engines.
// ---------------------------------------------------------------------------
expect(
  "voice hero meta during recording mentions realtime transcript copy",
  /录音中 · 实时分片上传[\s\S]{0,260}?(实时转写中已拉取|已拉取|远端兜底|本地 ASR)[\s\S]{0,160}?(转写片段|片段)/.test(screen),
  "hero meta line must call out realtime/near-realtime transcript progress during recording",
);
expect(
  "fallback empty-state copy says '录音中,等待 X 转写片段' (R11: X ∈ {本地 ASR, 远端兜底})",
  /录音中,等待[\s\S]{0,30}?(本地 ASR|远端兜底)[\s\S]{0,30}?转写片段/.test(screen),
  "R9B contract requires literal copy '录音中,等待 X 转写片段' where X is the R11-allowed engine label",
);
expect(
  "realtime status row has mobile-recorder-realtime-status testID",
  /testID="mobile-recorder-realtime-status"/.test(screen),
  "downstream UI probes need a stable testID on the realtime status row",
);
expect(
  "realtime hint line has mobile-voice-workbench-realtime-hint testID",
  /testID="mobile-voice-workbench-realtime-hint"/.test(screen),
  "transcript panel must expose the realtime hint with a stable testID",
);

// ---------------------------------------------------------------------------
// (6) The polling loop MUST NOT call autoTranscribeMutation.mutate(...) and
//     MUST NOT POST to /voice-notes/:id/audio-chunk. Both are R9 contract
//     violations.
// ---------------------------------------------------------------------------
// Extract the polling useEffect body so we can scope the assertion narrowly.
const pollStart = screen.indexOf("const RECORDER_SEGMENT_POLL_MS");
const pollEnd = pollStart >= 0 ? screen.indexOf("// 2026-07-03 — R7: detect a stale voice workbench", pollStart) : -1;
const pollBody = pollStart >= 0 && pollEnd > pollStart ? screen.slice(pollStart, pollEnd) : "";
expect(
  "polling useEffect body is extractable",
  pollBody.length > 0,
);
expect(
  "polling loop MUST NOT call autoTranscribeMutation.mutate",
  pollBody.length > 0 && !/autoTranscribeMutation[\s\S]{0,80}?\.mutate\s*\(/.test(pollBody),
  "polling loop regressed: legacy transcribe path is wired into realtime polling",
);
expect(
  "polling loop MUST NOT POST to /voice-notes/.../audio-chunk",
  pollBody.length > 0 && !/audio-chunk/.test(pollBody),
  "polling loop regressed: legacy /voice-notes/:id/audio-chunk is wired into realtime polling",
);
expect(
  "polling loop MUST NOT call transcribeVoiceNote",
  pollBody.length > 0 && !/transcribeVoiceNote\s*\(/.test(pollBody),
  "polling loop regressed: legacy transcribeVoiceNote() is wired into realtime polling",
);

// ---------------------------------------------------------------------------
// (7) The duplicate-save guard in confirmVoicePreviewSave must still be in
//     place: recorder branch first, addKnowledgeNote fallback second.
// ---------------------------------------------------------------------------
const confirmStart = screen.indexOf("const confirmVoicePreviewSave = async () => {");
const confirmEnd = confirmStart >= 0 ? screen.indexOf("const closeVoiceWorkbench = () => {", confirmStart) : -1;
const confirmBody = confirmStart >= 0 && confirmEnd > confirmStart ? screen.slice(confirmStart, confirmEnd) : "";
expect(
  "confirmVoicePreviewSave still routes through finalizeRecorderIngest when session present",
  confirmBody.length > 0 && /finalizeRecorderIngest\s*\(/.test(confirmBody),
  "duplicate-save guard regressed: confirmVoicePreviewSave no longer uses finalizeRecorderIngest",
);
const recorderBranchIdx = confirmBody.indexOf("if (mobileRecorderSessionId)");
const legacyFallbackIdx = confirmBody.indexOf("await addKnowledgeNote(");
expect(
  "duplicate-save guard: recorder session branch precedes legacy fallback",
  confirmBody.length > 0 &&
    recorderBranchIdx >= 0 &&
    (legacyFallbackIdx < 0 || legacyFallbackIdx > recorderBranchIdx),
  "addKnowledgeNote fallback moved ahead of finalizeRecorderIngest branch — duplicate-save risk",
);

// ---------------------------------------------------------------------------
// (8) The stop handler (stopVoiceRecording) MUST still use
//     uploadRecorderAudio + listRecorderSegments + startRecorderSession (R9
//     contract) and MUST NOT call autoTranscribeMutation.mutate. R9B does not
//     relax that.
// ---------------------------------------------------------------------------
const stopStart = screen.indexOf("const stopVoiceRecording = async () => {");
const stopEnd = stopStart >= 0 ? screen.indexOf("};\n", stopStart) : -1;
const stopBody = stopStart >= 0 && stopEnd > stopStart ? screen.slice(stopStart, stopEnd) : "";
expect(
  "stopVoiceRecording still references uploadRecorderAudio (R9 contract)",
  stopBody.length > 0 && /uploadRecorderAudio\s*\(/.test(stopBody),
);
expect(
  "stopVoiceRecording still references listRecorderSegments (R9 contract)",
  stopBody.length > 0 && /listRecorderSegments\s*\(/.test(stopBody),
);
expect(
  "stopVoiceRecording still references startRecorderSession (R9 contract)",
  stopBody.length > 0 && /startRecorderSession\s*\(/.test(stopBody),
);
expect(
  "stopVoiceRecording MUST NOT call autoTranscribeMutation.mutate (R9 contract)",
  stopBody.length > 0 && !/autoTranscribeMutation[\s\S]{0,40}?\.mutate\s*\(/.test(stopBody),
  "R9 regression reappeared: autoTranscribeMutation.mutate is back in the stop handler",
);
// Strip comments before scanning for the legacy audio-chunk route — comments
// may legitimately mention /audio-chunk while explaining why it is avoided.
function stripJsxComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, " "));
}
const stopBodyNoComments = stripJsxComments(stopBody);
expect(
  "stopVoiceRecording MUST NOT POST to /voice-notes/.../audio-chunk (R9 contract)",
  stopBodyNoComments.length > 0 && !/audio-chunk/.test(stopBodyNoComments),
  "R9 regression reappeared: /voice-notes/:id/audio-chunk is back as the note primary path",
);

// ---------------------------------------------------------------------------
// (9) api.ts must still expose listRecorderSegments + startRecorderSession
//     + uploadRecorderAudio + finalizeRecorderIngest (R5B API surface that
//     R9B relies on for the realtime loop).
// ---------------------------------------------------------------------------
expect(
  "api.ts exports listRecorderSegments",
  /export\s+function\s+listRecorderSegments\s*\(/.test(api),
);
expect(
  "api.ts exports startRecorderSession",
  /export\s+function\s+startRecorderSession\s*\(/.test(api),
);
expect(
  "api.ts exports uploadRecorderAudio",
  /export\s+(?:async\s+)?function\s+uploadRecorderAudio\s*\(/.test(api),
);
expect(
  "api.ts exports finalizeRecorderIngest",
  /export\s+function\s+finalizeRecorderIngest\s*\(/.test(api),
);
expect(
  "listRecorderSegments hits /api/mobile/recorder/sessions/:id/segments",
  /listRecorderSegments[\s\S]{0,800}?\/api\/mobile\/recorder\/sessions\/[^"]+\/segments/.test(api),
  "R9B polling relies on the same R5B endpoint — make sure the URL is unchanged",
);

// ---------------------------------------------------------------------------
// (10) Forbidden scope guards (task contract says we MUST NOT touch
//      desktop / broker / NAS / vault / unrelated recordings). Indirect guard:
//      re-confirm the test itself does not depend on those files so any
//      contract violation is visible in the failure list, not hidden.
// ---------------------------------------------------------------------------
const forbiddenTouches = [
  "apps/desktop/",
  "cloudbaseForwarder.ts",
  "mobileVaultInfo",
  "KB_VAULT_DIR",
  "MAX_BROKER_ACK_RESPONSE_BYTES",
];
for (const fragment of forbiddenTouches) {
  // Surface any forbidden fragments that appear inside the polling block we
  // just wrote. Outside the polling block (e.g. comments quoting the
  // previous R9 fix) is fine and would show up in the R9 probe, not here.
  expect(
    `polling block MUST NOT touch forbidden scope "${fragment}"`,
    pollBody.length === 0 || !pollBody.includes(fragment),
  );
}

if (failures.length) {
  console.error("MOBILE_R9B_REALTIME_TRANSCRIPT_LOOP_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R9B_REALTIME_TRANSCRIPT_LOOP_PASS");