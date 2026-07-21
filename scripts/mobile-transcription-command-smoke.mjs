import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.OPENCLAW_MOBILE_TRANSCRIPTION_SMOKE_PORT || 38991);
const baseUrl = `http://127.0.0.1:${port}`;
const marker = `WB_MOBILE_TRANSCRIBE_${Date.now()}`;
const fixtureDir = path.join(rootDir, "tmp", "mobile-transcription-smoke");
const fixtureDataDir = path.join(fixtureDir, "data");
const fixtureWorkspaceDir = path.join(fixtureDir, "workspace");
const fixtureSidecarDir = path.join(fixtureDataDir, "knowledge_sidecars");
const fixtureScript = path.join(fixtureDir, "transcribe-fixture.mjs");
let db;

const cleanup = {
  pairingIds: [],
  deviceIds: [],
  voiceNoteIds: [],
  audioPaths: [],
};

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function waitForHealth(child) {
  let lastError = "";
  for (let index = 0; index < 45; index += 1) {
    if (child.exitCode != null) throw new Error(`server_exited_before_health:${child.exitCode}`);
    try {
      const health = await request("/api/health");
      if (health.res.ok && health.data.ok) return;
      lastError = JSON.stringify(health.data);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  throw new Error(`server_health_timeout:${lastError}`);
}

function startServer() {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(fixtureDataDir, { recursive: true });
  fs.mkdirSync(fixtureWorkspaceDir, { recursive: true });
  fs.mkdirSync(fixtureSidecarDir, { recursive: true });
  fs.writeFileSync(
    fixtureScript,
    [
      "import fs from 'node:fs';",
      "const audioPath = process.env.OPENCLAW_TRANSCRIPTION_AUDIO_PATH || process.argv.at(-1) || '';",
      "if (!audioPath || !fs.existsSync(audioPath)) {",
      "  console.error(JSON.stringify({ error: 'audio_path_missing', audioPath }));",
      "  process.exit(2);",
      "}",
      "console.log(JSON.stringify({ text: `${process.env.OPENCLAW_TRANSCRIPTION_LANGUAGE || 'zh-CN'} 本地转写成功：请把这句话发送给主智能体。` }));",
    ].join("\n"),
  );

  const child = spawn(process.execPath, ["--experimental-sqlite", "apps/server/dist/index.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      OPENCLAW_WORKBENCH_PORT: String(port),
      OPENCLAW_DATA_DIR: fixtureDataDir,
      OPENCLAW_WORKSPACE: fixtureWorkspaceDir,
      OPENCLAW_SIDECAR_DIR: fixtureSidecarDir,
      OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER: "command",
      OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND: process.execPath,
      OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND_ARGS: JSON.stringify([fixtureScript]),
      OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS: "15000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

async function main() {
  const child = startServer();
  try {
    await waitForHealth(child);
    db = new DatabaseSync(path.join(fixtureDataDir, "workbench.sqlite"));
    db.exec("PRAGMA busy_timeout = 5000");

    const sessionToken = `${marker}_${crypto.randomUUID()}`;
    const sessionHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare("INSERT OR IGNORE INTO users (id, password_hash, salt, created_at) VALUES (?, ?, ?, ?)")
      .run(1, "smoke", "smoke", now);
    db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionHash, 1, expiresAt, now);
    const cookie = `owb_session=${encodeURIComponent(sessionToken)}`;

    const start = await request("/api/mobile/pairing/start", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ deviceHint: marker }),
    });
    assert(start.res.ok && /^\d{6}$/.test(String(start.data?.pairing?.code || "")), "pairing_start_failed", start.data);
    cleanup.pairingIds.push(start.data.pairing.id);

    const claim = await request("/api/mobile/pairing/claim", {
      method: "POST",
      body: JSON.stringify({
        code: start.data.pairing.code,
        deviceName: marker,
        platform: "ios",
        appVersion: "1.0.7-smoke",
        buildNumber: "3",
      }),
    });
    assert(claim.res.ok && claim.data.accessToken, "pairing_claim_failed", claim.data);
    cleanup.deviceIds.push(claim.data.device.id);
    const auth = { Authorization: `Bearer ${claim.data.accessToken}` };

    const bootstrap = await request("/api/mobile/bootstrap", { headers: auth });
    assert(bootstrap.res.ok && bootstrap.data.featureFlags?.voiceAutoTranscription === true, "command_provider_bootstrap_flag_failed", bootstrap.data);

    const voiceCreate = await request("/api/mobile/voice-notes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        title: `${marker} command provider`,
        transcriptText: "",
        source: "audio_upload",
        language: "zh-CN",
        durationSeconds: 2,
      }),
    });
    assert(voiceCreate.res.ok && voiceCreate.data.voiceNote?.id, "voice_note_create_failed", voiceCreate.data);
    cleanup.voiceNoteIds.push(voiceCreate.data.voiceNote.id);

    const transcribe = await request(`/api/mobile/voice-notes/${encodeURIComponent(voiceCreate.data.voiceNote.id)}/transcribe`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        audioBase64: Buffer.from("fake audio payload for command provider").toString("base64"),
        audioMime: "audio/m4a",
        filename: "command-smoke.m4a",
        language: "zh-CN",
        durationSeconds: 2,
      }),
    });
    assert(transcribe.res.ok && transcribe.data.transcriptText?.includes("本地转写成功"), "command_provider_transcribe_failed", transcribe.data);
    assert(transcribe.data.voiceNote?.status === "transcript_ready", "command_provider_voice_note_status_failed", transcribe.data.voiceNote);
    if (transcribe.data.voiceNote?.audioPath) cleanup.audioPaths.push(transcribe.data.voiceNote.audioPath);

    const chunkVoiceCreate = await request("/api/mobile/voice-notes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        title: `${marker} chunk provider`,
        transcriptText: "",
        source: "audio_upload",
        language: "zh-CN",
        durationSeconds: 3,
      }),
    });
    assert(chunkVoiceCreate.res.ok && chunkVoiceCreate.data.voiceNote?.id, "chunk_voice_note_create_failed", chunkVoiceCreate.data);
    cleanup.voiceNoteIds.push(chunkVoiceCreate.data.voiceNote.id);
    const chunkPayload = Buffer.from("fake chunked audio payload for command provider; this path avoids one large Cloudbase JSON request");
    const chunks = [chunkPayload.subarray(0, 23), chunkPayload.subarray(23)];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const upload = await request(`/api/mobile/voice-notes/${encodeURIComponent(chunkVoiceCreate.data.voiceNote.id)}/audio-chunk`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          audioBase64: chunks[chunkIndex].toString("base64"),
          audioMime: "audio/m4a",
          filename: "command-smoke-chunked.m4a",
          chunkIndex,
          totalChunks: chunks.length,
          totalBytes: chunkPayload.byteLength,
          durationSeconds: 3,
          reset: chunkIndex === 0,
        }),
      });
      assert(upload.res.ok && upload.data.uploadedChunks === chunkIndex + 1, "chunk_upload_failed", upload.data);
    }
    const chunkTranscribe = await request(`/api/mobile/voice-notes/${encodeURIComponent(chunkVoiceCreate.data.voiceNote.id)}/transcribe`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        uploadedAudio: true,
        audioMime: "audio/m4a",
        filename: "command-smoke-chunked.m4a",
        language: "zh-CN",
        durationSeconds: 3,
      }),
    });
    assert(chunkTranscribe.res.ok && chunkTranscribe.data.transcriptText?.includes("本地转写成功"), "chunk_provider_transcribe_failed", chunkTranscribe.data);
    assert(chunkTranscribe.data.voiceNote?.status === "transcript_ready", "chunk_provider_voice_note_status_failed", chunkTranscribe.data.voiceNote);
    if (chunkTranscribe.data.voiceNote?.audioPath) cleanup.audioPaths.push(chunkTranscribe.data.voiceNote.audioPath);

    console.log(JSON.stringify({
      ok: true,
      provider: transcribe.data.provider,
      model: transcribe.data.model,
      transcriptText: transcribe.data.transcriptText,
      chunkedTranscriptText: chunkTranscribe.data.transcriptText,
    }, null, 2));
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    if (child.exitCode == null) child.kill("SIGKILL");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      if (!db) return;
      for (const audioPath of cleanup.audioPaths) {
        if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      }
      for (const voiceNoteId of cleanup.voiceNoteIds) {
        db.prepare("DELETE FROM mobile_voice_notes WHERE id = ?").run(voiceNoteId);
      }
      for (const deviceId of cleanup.deviceIds) {
        db.prepare("DELETE FROM mobile_device_tokens WHERE device_id = ?").run(deviceId);
        db.prepare("DELETE FROM mobile_devices WHERE id = ?").run(deviceId);
      }
      for (const pairingId of cleanup.pairingIds) {
        db.prepare("DELETE FROM mobile_pairing_challenges WHERE id = ?").run(pairingId);
      }
    } finally {
      db?.close();
    }
  });
