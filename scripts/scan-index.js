// One-off scanner (not part of the repo). Run with `node scan-index.js`.
const fs = require("fs");
const path = "/Users/njx/openclaw/copilot/apps/server/src/index.ts";
const text = fs.readFileSync(path, "utf8");
const lines = text.split("\n");
const targets = [
  "mobileDeviceFromRequest",
  "decodeMobileVoiceAudioBase64",
  "normalizeMobileAudioChunkNumber",
  "canAccessMobileVoiceNote",
  "mobileVoiceChunkDir",
  "mobileVoiceChunkPath",
  "cleanupMobileVoiceChunks",
  "mobileVoiceChunkMetaPath",
  "decodeMobileVoiceAudio",
  "normalizeMobileAudioMime",
  "mobileAudioExtension",
  "normalizeNullableInteger",
  "sanitizeMobileVoiceNote",
  "normalizeMobileTranscript",
  "normalizeMobileVoiceTitle",
  "normalizeMobileVoiceSource",
  "isTruthyMobileFlag",
  "normalizeMobilePlatform",
  "sanitizeMobileDevice",
  "createMobileDeviceToken",
  "localDateKey",
  "normalizeMobileDateKey",
  "parseDateKey",
  "wantsAsyncMobileTranscription",
  "probeMobileAudioSeconds",
  "mobileVoiceMinAudioSeconds",
  "saveMobileVoiceAudio",
  "MOBILE_AUDIO_CHUNK_MAX_COUNT",
  "MOBILE_AUDIO_CHUNK_ROOT",
  "audit",
  "nowIso",
  "safeName",
  "DATA_DIR",
];
for (const name of targets) {
  let first = null;
  let refs = [];
  for (let i = 0; i < lines.length; i++) {
    const re = new RegExp("\\b" + name + "\\b");
    if (re.test(lines[i])) {
      if (first === null) {
        first = { line: i + 1, snippet: lines[i].slice(0, 160) };
      }
      refs.push(i + 1);
      if (refs.length > 12) break;
    }
  }
  console.log(`${name}: line ${first ? first.line : "NOT_FOUND"} -> ${first ? first.snippet : ""}`);
  console.log("  ref lines: " + (refs.length ? refs.slice(0, 12).join(", ") + (refs.length > 12 ? "..." : "") : "none"));
}