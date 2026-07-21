import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(rootDir, "apps", "server", "dist", "mobileTranscription.js");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mobile-transcription-"));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

try {
  const fixtureCommand = path.join(tmpDir, "fixture-transcriber.mjs");
  const audioPath = path.join(tmpDir, "voice.m4a");
  fs.writeFileSync(audioPath, "fake mobile voice bytes");
  fs.writeFileSync(
    fixtureCommand,
    [
      "import fs from 'node:fs';",
      "const audioPath = process.env.OPENCLAW_TRANSCRIPTION_AUDIO_PATH || process.argv.at(-1) || '';",
      "if (!audioPath || !fs.existsSync(audioPath)) process.exit(2);",
      "console.log(JSON.stringify({ text: `本地转写成功 ${process.env.OPENCLAW_TRANSCRIPTION_LANGUAGE || ''}` }));",
    ].join("\n"),
  );

  const mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  const env = {
    OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER: "command",
    OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND: process.execPath,
    OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND_ARGS: JSON.stringify([fixtureCommand]),
    OPENCLAW_MOBILE_TRANSCRIPTION_MODEL: "local-command-smoke",
    OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS: "15000",
  };

  assert(mod.mobileTranscriptionConfigured(env) === true, "command_provider_should_be_configured");
  const result = await mod.transcribeMobileVoiceAudio(
    {
      audioBuffer: Buffer.from("fake mobile voice bytes"),
      audioMime: "audio/m4a",
      filename: "voice.m4a",
      language: "zh-CN",
      audioPath,
    },
    env,
  );
  assert(result.provider === "command", "command_provider_name_failed", result);
  assert(result.model === "local-command-smoke", "command_provider_model_failed", result);
  assert(result.text.includes("本地转写成功 zh-CN"), "command_provider_transcript_failed", result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
