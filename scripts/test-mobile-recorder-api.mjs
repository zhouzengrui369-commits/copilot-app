import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

// Each check is [file, label, predicate]. The predicate can be a string
// (literal substring) or a function (text) => boolean. We deliberately
// avoid spreading file content into the array literal because some
// predicates need a regex window that crosses multiple lines.
const checks = [
  ["apps/server/src/index.ts", "POST /api/mobile/recorder/sessions", 'app.post("/api/mobile/recorder/sessions"'],
  ["apps/server/src/index.ts", "PATCH /api/mobile/recorder/sessions/:id", 'app.patch("/api/mobile/recorder/sessions/:id"'],
  ["apps/server/src/index.ts", "POST /api/mobile/recorder/sessions/:id/chunks", 'app.post("/api/mobile/recorder/sessions/:id/chunks"'],
  ["apps/server/src/index.ts", "GET /api/mobile/recorder/sessions/:id/segments", 'app.get("/api/mobile/recorder/sessions/:id/segments"'],
  ["apps/server/src/index.ts", "POST /api/mobile/recorder/sessions/:id/ingest", 'app.post("/api/mobile/recorder/sessions/:id/ingest"'],
  ["apps/server/src/mobileRecorder.ts", "createMobileRecordingSession export", "export function createMobileRecordingSession"],
  ["apps/server/src/mobileRecorder.ts", "updateMobileRecordingSession export", "export function updateMobileRecordingSession"],
  ["apps/server/src/mobileRecorder.ts", "insertMobileTranscriptSegment export", "export function insertMobileTranscriptSegment"],
  ["apps/server/src/mobileRecorder.ts", "listMobileTranscriptSegments export", "export function listMobileTranscriptSegments"],
  ["apps/server/src/mobileRecorder.ts", "getMobileIngestionJobBySessionTarget export", "export function getMobileIngestionJobBySessionTarget"],
  ["apps/server/src/db.ts", "mobile_recording_sessions table", "CREATE TABLE IF NOT EXISTS mobile_recording_sessions"],
  ["apps/server/src/db.ts", "mobile_transcript_segments table", "CREATE TABLE IF NOT EXISTS mobile_transcript_segments"],
  ["apps/server/src/db.ts", "mobile_ingestion_jobs table", "CREATE TABLE IF NOT EXISTS mobile_ingestion_jobs"],
  ["apps/server/src/index.ts", "recorder ingest uses voice-note organizer", "saveMobileVoiceNoteToCalendar(voiceNote)"],
  ["apps/server/src/index.ts", "recorder ingest completes job", "status = 'completed'"],
  ["apps/server/src/index.ts", "recorder ingest audit", "mobile.recorder.ingest.completed"],
  ["apps/server/src/index.ts", "recorder ingest triggers wiki compile", "compileKnowledgeWiki(db, { mode: \"incremental\" })"],
  ["apps/server/src/index.ts", "recorder ingest wiki audit", "mobile.recorder.ingest.wiki_compile"],
  ["apps/mobile/src/lib/api.ts", "mobile recorder start wrapper", "export function startRecorderSession"],
  ["apps/mobile/src/lib/api.ts", "mobile recorder audio upload wrapper", "export async function uploadRecorderAudio"],
  ["apps/mobile/src/lib/api.ts", "mobile recorder ingest wrapper", "export function finalizeRecorderIngest"],

  // R7 (2026-07-03) — ASR timeout fix: the recorder chunk endpoint must NEVER
  // spawn Whisper on individual `.part` chunks. They are raw evidence; the
  // helper is invoked only after the user finalizes the session with a full
  // transcript payload (or the parent voice-note upload completes).
  [
    "apps/server/src/index.ts",
    "recorder chunk handler must not spawn whisper on individual chunks",
    (text) => {
      const chunkAnchor = text.indexOf('app.post("/api/mobile/recorder/sessions/:id/chunks"');
      const ingestAnchor = text.indexOf('app.post("/api/mobile/recorder/sessions/:id/ingest"');
      if (chunkAnchor < 0 || ingestAnchor < 0 || ingestAnchor <= chunkAnchor) return true;
      const window = text.slice(chunkAnchor, ingestAnchor);
      return !/transcribeMobileVoiceAudio\s*\(/.test(window);
    },
  ],
  ["apps/server/src/index.ts", "recorder ingest requires transcript before ASR", "transcript_required"],
  ["apps/server/src/mobileTranscribeWhisperCommand.ts", "tiny default model", (text) => /\|\|\s*"tiny"/.test(text)],
  ["apps/server/src/mobileTranscribeWhisperCommand.ts", "OPENCLAW_MOBILE_WHISPER_MODEL precedence", "OPENCLAW_MOBILE_WHISPER_MODEL"],
  ["apps/server/src/mobileTranscribeWhisperCommand.ts", "structured failure codes include whisper_timeout", "whisper_timeout"],
  ["apps/server/src/mobileTranscription.ts", "structured command-failure reason surfaces stderr detail", "transcription_command_failed:"],
  ["apps/desktop/src/server-runner.ts", "packaged app defaults to tiny model", "OPENCLAW_MOBILE_WHISPER_MODEL || \"tiny\""],
];

const failures = [];
const runCheck = (needle) => (typeof needle === "string" ? (text) => text.includes(needle) : needle);

for (const [rel, label, needle] of checks) {
  const text = read(rel);
  const predicate = runCheck(needle);
  if (!predicate(text)) failures.push(`${label}: missing ${typeof needle === "string" ? needle : "<predicate>"} in ${rel}`);
}

const todayConsole = read("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const confirmStart = todayConsole.indexOf("const confirmVoicePreviewSave = async () => {");
const confirmEnd = todayConsole.indexOf("const closeVoiceWorkbench = () => {", confirmStart);
const confirmBody = confirmStart >= 0 && confirmEnd > confirmStart ? todayConsole.slice(confirmStart, confirmEnd) : "";
const recorderBranchIndex = confirmBody.indexOf("if (mobileRecorderSessionId)");
const firstLegacySaveIndex = confirmBody.indexOf("await addKnowledgeNote(");
if (!confirmBody) {
  failures.push("recorder duplicate-save guard: missing confirmVoicePreviewSave body");
} else if (recorderBranchIndex < 0) {
  failures.push("recorder duplicate-save guard: recorder session branch missing");
} else if (firstLegacySaveIndex >= 0 && firstLegacySaveIndex < recorderBranchIndex) {
  failures.push("recorder duplicate-save guard: legacy addKnowledgeNote runs before recorder ingest branch");
}
if (confirmBody.includes("笔记已入库,但 R5B ingest job 未登记")) {
  failures.push("recorder duplicate-save guard: partial success message allows addKnowledgeNote + failed ingest double-write");
}

if (failures.length) {
  console.error("MOBILE_RECORDER_API_SMOKE_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_RECORDER_API_SMOKE_PASS");