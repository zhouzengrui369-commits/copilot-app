import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type TranscriptionEnv = Record<string, string | undefined>;

type MobileVoiceTranscriptionInput = {
  audioBuffer: Buffer;
  audioMime: string;
  filename: string;
  language: string;
  audioPath?: string;
};

export type MobileVoiceTranscriptionResult = {
  text: string;
  provider: string;
  model: string;
};

function openAiTranscriptionKey(env: TranscriptionEnv = process.env) {
  return env.OPENAI_API_KEY || env.OPENCLAW_OPENAI_API_KEY || "";
}

function normalizeProvider(value: string) {
  const provider = value.trim().toLowerCase();
  if (["off", "none", "disabled", "false"].includes(provider)) return "";
  if (["command", "local", "local-command"].includes(provider)) return "command";
  return provider;
}

export function mobileTranscriptionProvider(env: TranscriptionEnv = process.env) {
  const configured = normalizeProvider(env.OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER || "");
  if (configured) return configured;
  if (openAiTranscriptionKey(env)) return "openai";
  return "";
}

export function mobileTranscriptionConfigured(env: TranscriptionEnv = process.env) {
  const provider = mobileTranscriptionProvider(env);
  if (provider === "openai") return Boolean(openAiTranscriptionKey(env));
  if (provider === "command") return Boolean(env.OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND);
  return false;
}

function transcriptionModel(provider: string, env: TranscriptionEnv) {
  if (env.OPENCLAW_MOBILE_TRANSCRIPTION_MODEL) return env.OPENCLAW_MOBILE_TRANSCRIPTION_MODEL;
  if (provider === "command") return "local-command";
  return "gpt-4o-mini-transcribe";
}

function commandArgs(env: TranscriptionEnv) {
  const raw = String(env.OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND_ARGS || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("invalid_args");
    return parsed;
  } catch {
    throw new Error("transcription_command_args_invalid");
  }
}

function parseCommandTranscript(stdout: string) {
  const text = stdout.trim();
  if (!text) return { text: "", parsed: null as null | Record<string, unknown> };
  try {
    const parsed = JSON.parse(text) as { text?: unknown; transcriptText?: unknown; ok?: unknown; model?: unknown };
    return {
      text: String(parsed.text ?? parsed.transcriptText ?? "").trim(),
      parsed: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null,
    };
  } catch {
    return { text, parsed: null };
  }
}

async function transcribeWithCommand(input: MobileVoiceTranscriptionInput, env: TranscriptionEnv): Promise<MobileVoiceTranscriptionResult> {
  const command = env.OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND;
  if (!command) throw new Error("transcription_provider_unavailable");
  const provider = "command";
  const model = transcriptionModel(provider, env);
  const timeout = Number(env.OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS || 90_000);
  const args = [...commandArgs(env), input.audioPath || ""].filter(Boolean);
  let stdout = "";
  try {
    const result = await execFileAsync(command, args, {
      env: {
        ...process.env,
        ...env,
        OPENCLAW_TRANSCRIPTION_AUDIO_PATH: input.audioPath || "",
        OPENCLAW_TRANSCRIPTION_AUDIO_MIME: input.audioMime,
        OPENCLAW_TRANSCRIPTION_FILENAME: input.filename,
        OPENCLAW_TRANSCRIPTION_LANGUAGE: input.language,
        OPENCLAW_TRANSCRIPTION_MODEL: model,
      },
      timeout,
      maxBuffer: 1024 * 1024,
    });
    stdout = String(result.stdout || "");
  } catch (err) {
    const execError = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const stderr = String(execError.stderr || "");
    const stdoutTail = String(execError.stdout || "");
    const detailLine = (stderr || stdoutTail)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() || execError.message || "unknown_error";
    // Surface precise reason: model missing, timeout, generic failure.
    if (execError.code === "ETIMEDOUT" || /ETIMEDOUT/i.test(execError.message || "")) {
      const reason = `transcription_timeout: ${detailLine.slice(0, 240)}`;
      throw new Error(reason);
    }
    if (/whisper_model_missing|model not found|could not load model/i.test(detailLine)) {
      const reason = `transcription_model_missing: ${detailLine.slice(0, 240)}`;
      throw new Error(reason);
    }
    if (/whisper_binary_missing|no such file or directory.*whisper/i.test(detailLine)) {
      const reason = `transcription_binary_missing: ${detailLine.slice(0, 240)}`;
      throw new Error(reason);
    }
    if (/whisper_runtime_unavailable|out of memory|cuda|mps/i.test(detailLine)) {
      const reason = `transcription_runtime_unavailable: ${detailLine.slice(0, 240)}`;
      throw new Error(reason);
    }
    throw new Error(`transcription_command_failed: ${detailLine.slice(0, 240)}`);
  }
  const { text, parsed } = parseCommandTranscript(stdout);
  // If the helper returned {ok:false, code:..., detail:...} (e.g. exit 3/4 path)
  // we still want to surface the structured reason rather than only "command_failed".
  if (parsed && parsed.ok === false && typeof parsed.code === "string") {
    const detail = typeof parsed.detail === "string" ? parsed.detail : "";
    throw new Error(`transcription_${parsed.code}${detail ? `: ${detail}` : ""}`);
  }
  return { text, provider, model };
}

async function transcribeWithOpenAI(input: MobileVoiceTranscriptionInput, env: TranscriptionEnv): Promise<MobileVoiceTranscriptionResult> {
  const apiKey = openAiTranscriptionKey(env);
  if (!apiKey) throw new Error("transcription_provider_unavailable");
  const provider = "openai";
  const model = transcriptionModel(provider, env);
  const baseUrl = (env.OPENAI_BASE_URL || env.OPENCLAW_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  const form = new FormData();
  form.append("model", model);
  form.append("language", input.language.startsWith("zh") ? "zh" : input.language);
  form.append("response_format", "json");
  const audioArrayBuffer = input.audioBuffer.buffer.slice(input.audioBuffer.byteOffset, input.audioBuffer.byteOffset + input.audioBuffer.byteLength) as ArrayBuffer;
  form.append("file", new Blob([audioArrayBuffer], { type: input.audioMime }), input.filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS || 90_000));
  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const data = await res.json().catch(async () => ({ text: await res.text().catch(() => "") })) as { text?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message || `transcription_http_${res.status}`);
    return { text: String(data.text || ""), provider, model };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("transcription_timeout");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeMobileVoiceAudio(
  input: MobileVoiceTranscriptionInput,
  env: TranscriptionEnv = process.env,
): Promise<MobileVoiceTranscriptionResult> {
  const provider = mobileTranscriptionProvider(env);
  if (provider === "command") return transcribeWithCommand(input, env);
  if (provider === "openai") return transcribeWithOpenAI(input, env);
  throw new Error("transcription_provider_unavailable");
}
