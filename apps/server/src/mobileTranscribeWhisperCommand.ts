import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type FailureReason = {
  code: string;
  detail: string;
};

function sanitizeDetail(value: string, max = 240): string {
  // Strip control bytes and clamp length; never let a single whisper stderr
  // line dominate the API response. Drop absolute paths beyond the basename.
  const cleaned = String(value || "")
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function fail(reason: FailureReason): never {
  const payload = JSON.stringify({ ok: false, ...reason });
  process.stderr.write(`${payload}\n`);
  // Use a dedicated exit code so the parent server can map
  // transcription_command_failed → transcription_<reason> without re-parsing.
  process.exit(reason.code === "whisper_timeout" ? 3 : 4);
}

const audioPath = process.env.OPENCLAW_TRANSCRIPTION_AUDIO_PATH || process.argv.at(-1) || "";
if (!audioPath || !fs.existsSync(audioPath)) {
  fail({ code: "audio_file_missing", detail: sanitizeDetail(audioPath) });
}

const whisperBin = process.env.OPENCLAW_WHISPER_BIN || "/opt/homebrew/bin/whisper";
if (!fs.existsSync(whisperBin)) {
  fail({ code: "whisper_binary_missing", detail: sanitizeDetail(whisperBin) });
}

// Model precedence (R7 2026-07-03):
//   1. OPENCLAW_MOBILE_WHISPER_MODEL — explicit whisper-only override.
//   2. OPENCLAW_MOBILE_TRANSCRIPTION_MODEL — the server-runner.sh default
//      (kept in sync with the parent transcription config so the desktop
//      shell doesn't have to know the whisper-specific name).
//   3. "tiny" — fast enough to finish a 30-60s mobile recording inside
//      the default 180s timeout on a packaged Mac. The user can override
//      either env var above if they want a more accurate model.
const model =
  process.env.OPENCLAW_MOBILE_WHISPER_MODEL ||
  process.env.OPENCLAW_MOBILE_TRANSCRIPTION_MODEL ||
  "tiny";

const rawLanguage = process.env.OPENCLAW_TRANSCRIPTION_LANGUAGE || "zh";
const language = rawLanguage.toLowerCase().startsWith("zh") ? "zh" : rawLanguage.split("-")[0] || "zh";
const timeoutMs = Math.max(15_000, Number(process.env.OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS || 180_000));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-whisper-"));

try {
  const result = spawnSync(
    whisperBin,
    [
      audioPath,
      "--model",
      model,
      "--language",
      language,
      "--output_format",
      "txt",
      "--output_dir",
      outDir,
      "--fp16",
      "False",
      "--verbose",
      "False",
    ],
    { encoding: "utf8", timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.error) {
    const message = String((result.error as NodeJS.ErrnoException).message || "unknown_error");
    const code = (result.error as NodeJS.ErrnoException).code || "";
    if (result.signal === "SIGTERM" || /ETIMEDOUT/i.test(message) || code === "ETIMEDOUT") {
      fail({ code: "whisper_timeout", detail: `${model}@${timeoutMs}ms ${sanitizeDetail(message, 120)}` });
    }
    if (code === "ENOENT") {
      fail({ code: "whisper_binary_missing", detail: sanitizeDetail(whisperBin) });
    }
    fail({ code: "whisper_execution_failed", detail: sanitizeDetail(`${code} ${message}`.trim()) });
  }
  if (result.status !== 0) {
    const stderr = sanitizeDetail(result.stderr || "", 240);
    const stdoutTail = sanitizeDetail((result.stdout || "").split("\n").slice(-3).join(" "), 120);
    // Whisper prints "ERROR" lines to stderr when the model file is missing
    // or the audio is unreadable; surface the last meaningful line.
    const detail = stderr || stdoutTail || `exit ${result.status}`;
    const lowered = detail.toLowerCase();
    if (/model.*not.*found|could not load model|no such file/i.test(detail)) {
      fail({ code: "whisper_model_missing", detail: `model=${model} ${sanitizeDetail(detail, 200)}` });
    }
    if (/out of memory|cuda|mps/i.test(lowered)) {
      fail({ code: "whisper_runtime_unavailable", detail: sanitizeDetail(detail, 200) });
    }
    fail({ code: "whisper_execution_failed", detail: `model=${model} exit=${result.status} ${sanitizeDetail(detail, 200)}` });
  }

  const stem = path.basename(audioPath, path.extname(audioPath));
  const preferred = path.join(outDir, `${stem}.txt`);
  const txtPath = fs.existsSync(preferred)
    ? preferred
    : fs.readdirSync(outDir).map((name) => path.join(outDir, name)).find((file) => file.endsWith(".txt"));
  if (!txtPath) fail({ code: "whisper_output_missing", detail: sanitizeDetail(outDir, 120) });

  const text = fs.readFileSync(txtPath, "utf8").trim();
  process.stdout.write(`${JSON.stringify({ ok: true, text, model, language, timeoutMs })}\n`);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
