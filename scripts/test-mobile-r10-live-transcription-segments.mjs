// 2026-07-04 — R10 real live transcription segments regression.
//
// Mate60 validation after R9F still failed the R6 core promise: during a note
// recording the transcript textarea stayed blank and "已上传 0/— 个分片" never
// moved, because the app only POLLED listRecorderSegments() while recording and
// did not upload any audio until stopVoiceRecording() ran. The server /chunks
// endpoint also only stored client-supplied text — it never transcribed audio.
//
// R10 implements the REAL live data path:
//   - Mobile runs a rolling segment loop while noteRecordingActive: record
//     ~LIVE_SEGMENT_MS, finalize, upload the finished segment via
//     uploadRecorderLiveSegment(), keep recording. Stop only flushes the final
//     partial segment; it is no longer the first/only upload point.
//   - Server exposes /recorder/sessions/:id/live-segments, assembles each
//     completed live segment WITHOUT clearing prior segments, and calls
//     transcribeMobileVoiceAudio() on it, writing non-empty text into
//     mobile_transcript_segments when the provider succeeds (or a truthful
//     provider-unavailable state when not).
//   - The UI distinguishes uploaded / pending-transcription / received /
//     provider-unavailable states.
//
// This probe is SOURCE-LEVEL (no Metro / RN runtime) so it runs in CI. It must
// FAIL on the pre-R10 source and PASS after the implementation.
//
// Exit 0 = contract satisfied. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function stripJsxComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, " "));
}

const screen = read("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const api = read("apps/mobile/src/lib/api.ts");
const server = read("apps/server/src/index.ts");
const context = read("apps/mobile/src/lib/RecorderContext.tsx");

// ---------------------------------------------------------------------------
// (1) api.ts exposes a real live-segment upload function that hits a dedicated
//     live-segment endpoint and chunks at the small CloudBase-safe size.
// ---------------------------------------------------------------------------
expect(
  "api.ts exports uploadRecorderLiveSegment()",
  /export\s+async\s+function\s+uploadRecorderLiveSegment\s*\(/.test(api),
  "no live-segment upload function — recording would still only poll, never upload",
);
expect(
  "uploadRecorderLiveSegment posts to /recorder/sessions/:id/live-segments",
  /uploadRecorderLiveSegment[\s\S]{0,2000}?\/api\/mobile\/recorder\/sessions\/[^"]+\/live-segments/.test(api),
);
expect(
  "uploadRecorderLiveSegment chunks at recorderChunkBytes (CloudBase 413 guard)",
  /uploadRecorderLiveSegment[\s\S]{0,2000}?recorderChunkBytes/.test(api),
);

// ---------------------------------------------------------------------------
// (2) The screen runs a rolling segment loop that uploads BEFORE final stop.
// ---------------------------------------------------------------------------
const segMs = screen.match(/LIVE_SEGMENT_MS\s*=\s*([0-9_]+)/);
const segMsValue = segMs ? Number(segMs[1].replaceAll("_", "")) : null;
expect(
  "screen declares LIVE_SEGMENT_MS constant (rolling segment length)",
  segMs !== null,
);
expect(
  "LIVE_SEGMENT_MS is a near-realtime 8-20s window",
  segMsValue !== null && segMsValue >= 8000 && segMsValue <= 20000,
  segMsValue === null ? "constant not found" : `LIVE_SEGMENT_MS=${segMsValue}ms outside 8-20s`,
);
expect(
  "screen drives a rolling loop with setInterval(rollLiveSegment, LIVE_SEGMENT_MS)",
  /setInterval\s*\(\s*rollLiveSegment\s*,\s*LIVE_SEGMENT_MS\s*\)/.test(screen),
  "no rolling interval — the loop that uploads during recording is missing",
);
expect(
  "rollLiveSegment uploads via uploadRecorderLiveSegment()",
  /rollLiveSegment[\s\S]{0,1500}?uploadRecorderLiveSegment\s*\(/.test(screen),
  "the rolling loop must actually call the live-segment upload function",
);
expect(
  "rolling loop is gated on noteLiveActive (only for active note recording)",
  /if\s*\(\s*!noteLiveActive\s*\)\s*return\s+undefined;?/.test(screen),
);

// ---------------------------------------------------------------------------
// (3) startVoiceRecording initializes the live segment state/session.
// ---------------------------------------------------------------------------
const startStart = screen.indexOf("const startVoiceRecording = async (target: VoiceRecordTarget) => {");
const startEnd = startStart >= 0 ? screen.indexOf("const cancelVoiceRecording", startStart) : -1;
const startBody = startStart >= 0 && startEnd > startStart ? screen.slice(startStart, startEnd) : "";
expect("startVoiceRecording() body is extractable", startBody.length > 0);
expect(
  "startVoiceRecording initializes live segment state (setNoteLiveActive(true))",
  /setNoteLiveActive\s*\(\s*true\s*\)/.test(startBody),
  "live segment loop is never armed on start",
);
expect(
  "startVoiceRecording resets the live segment index",
  /liveSegmentIndexRef\.current\s*=\s*0/.test(startBody),
);

// ---------------------------------------------------------------------------
// (4) stopVoiceRecording flushes the final partial segment but is NOT the
//     first/only upload point: it disables the rolling loop, still references
//     uploadRecorderAudio (final flush), and does NOT itself contain the
//     rolling uploadRecorderLiveSegment call (that lives in the loop).
// ---------------------------------------------------------------------------
const stopStart = screen.indexOf("const stopVoiceRecording = async () => {");
const stopEnd = stopStart >= 0 ? screen.indexOf("};\n", stopStart) : -1;
const stopBody = stopStart >= 0 && stopEnd > stopStart ? screen.slice(stopStart, stopEnd) : "";
expect("stopVoiceRecording() body is extractable", stopBody.length > 0);
expect(
  "stopVoiceRecording disables the rolling loop (setNoteLiveActive(false))",
  /setNoteLiveActive\s*\(\s*false\s*\)/.test(stopBody),
);
expect(
  "stopVoiceRecording still flushes the final partial via uploadRecorderAudio (R9 contract)",
  /uploadRecorderAudio\s*\(/.test(stopBody),
);
expect(
  "the rolling upload (uploadRecorderLiveSegment) is NOT inside stopVoiceRecording",
  !/uploadRecorderLiveSegment\s*\(/.test(stripJsxComments(stopBody)),
  "stop must not be the upload point for rolling live segments — that proves stop is not the first/only upload",
);
expect(
  "uploadRecorderLiveSegment is invoked somewhere in the screen (the rolling loop)",
  /uploadRecorderLiveSegment\s*\(/.test(screen),
);

// ---------------------------------------------------------------------------
// (5) Server: the live-segment endpoint calls transcribeMobileVoiceAudio().
// ---------------------------------------------------------------------------
const liveEpStart = server.indexOf('app.post("/api/mobile/recorder/sessions/:id/live-segments"');
const liveEpEnd = liveEpStart >= 0 ? server.indexOf("app.get(\"/api/mobile/recorder/sessions/:id/segments\"", liveEpStart) : -1;
const liveEpBody = liveEpStart >= 0 && liveEpEnd > liveEpStart ? server.slice(liveEpStart, liveEpEnd) : "";
expect(
  "server declares POST /recorder/sessions/:id/live-segments",
  liveEpStart >= 0,
  "no dedicated live-segment endpoint",
);
expect(
  "live-segments endpoint calls transcribeMobileVoiceAudio()",
  liveEpBody.length > 0 && /transcribeMobileVoiceAudio\s*\(/.test(liveEpBody),
  "server never transcribes the uploaded live segment audio",
);
expect(
  "live-segments endpoint keeps per-segment audio isolated (no shared-dir reset of prior segments)",
  liveEpBody.length > 0 && /mobileRecorderLiveSegmentDir\s*\(/.test(liveEpBody),
  "prior segment audio must not be cleared when a later segment uploads",
);

// ---------------------------------------------------------------------------
// (6) Server stores non-empty transcript text into mobile_transcript_segments
//     when transcription succeeds.
// ---------------------------------------------------------------------------
expect(
  "live-segments endpoint writes transcript text into mobile_transcript_segments",
  liveEpBody.length > 0 &&
    /UPDATE\s+mobile_transcript_segments[\s\S]{0,120}?SET\s+text\s*=/i.test(liveEpBody),
  "transcribed text is never persisted to the segment row",
);
expect(
  "live-segments endpoint marks a truthful provider-unavailable state when unconfigured",
  liveEpBody.length > 0 &&
    /mobileTranscriptionConfigured\s*\(\s*\)/.test(liveEpBody) &&
    /provider_unavailable/.test(liveEpBody),
  "server must report provider-unavailable instead of pretending realtime is running",
);

// ---------------------------------------------------------------------------
// (7) UI + context expose explicit live-transcription states.
// ---------------------------------------------------------------------------
expect(
  "RecorderContext defines a LiveTranscriptionState with the four real states",
  /LiveTranscriptionState/.test(context) &&
    /"uploading"/.test(context) &&
    /"waiting"/.test(context) &&
    /"received"/.test(context) &&
    /"unavailable"/.test(context) &&
    /"failed"/.test(context),
);
expect(
  "RecorderContext exposes liveTranscription state + reportLiveSegmentUploaded action",
  /liveTranscription/.test(context) && /reportLiveSegmentUploaded/.test(context),
);
expect(
  "screen renders an explicit R10 live-transcription status row",
  /testID="mobile-recorder-live-transcription-status"/.test(screen),
);
expect(
  "screen status row distinguishes received / provider-unavailable / uploaded-waiting states",
  /appRecorderState\.liveTranscription === "received"/.test(screen) &&
    /appRecorderState\.liveTranscription === "unavailable"/.test(screen) &&
    /appRecorderState\.liveSegmentsUploaded/.test(screen),
);

// ---------------------------------------------------------------------------
// (8) Forbidden-scope guards: R10 must not touch desktop / broker / vault.
// ---------------------------------------------------------------------------
for (const fragment of ["apps/desktop/", "cloudbaseForwarder.ts", "MAX_BROKER_ACK_RESPONSE_BYTES", "KB_VAULT_DIR"]) {
  expect(
    `screen MUST NOT touch forbidden scope "${fragment}"`,
    !screen.includes(fragment),
  );
  expect(
    `api MUST NOT touch forbidden scope "${fragment}"`,
    !api.includes(fragment),
  );
}

if (failures.length) {
  console.error("MOBILE_R10_LIVE_TRANSCRIPTION_SEGMENTS_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R10_LIVE_TRANSCRIPTION_SEGMENTS_PASS");
