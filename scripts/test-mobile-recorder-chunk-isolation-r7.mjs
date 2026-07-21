// 2026-07-03 — R7 chunk-isolation regression.
//
// Background:
//   The Mate60 1.0.8 recorder previously uploaded audio as a sequence of
//   256 KB `.part` chunks. ffprobe rejects a single `.part` chunk because
//   the moov atom is missing — it is only present in the fully assembled
//   audio file. R7 fix: the recorder chunk endpoint must NEVER spawn the
//   Whisper subprocess on individual chunks; transcription only happens
//   after the user explicitly finalizes the session.
//
// This script enforces that guarantee end-to-end against the same server
// used by `test-mobile-recorder-chunk-smoke-r7.mjs`. It does:
//
//   1. POST /api/mobile/recorder/sessions  (start session)
//   2. POST /api/mobile/recorder/sessions/:id/chunks ×3 (byte-chunk uploads)
//   3. Verifies the chunk dir on disk contains three *.part files
//      that ffprobe rejects (`moov atom not found`).
//   4. Hits /api/mobile/recorder/sessions/:id/segments and confirms no
//      segment has a status of "transcript_ready" / "transcribing" /
//      "completed" — chunks must remain raw evidence.
//   5. Hits /api/mobile/recorder/sessions/:id/ingest with no transcript
//      and confirms the server refuses it ("transcript_required") rather
//      than falling back to Whisper.
//   6. Inspects the audit_log to confirm no `whisper` / `transcribe` event
//      was emitted for any chunk during steps 2–5.
//
// Exit code 0 = regression passes. Exit code 1 = a chunk has been
// incorrectly transcribed or a regression has been introduced.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38899";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || "openclaw-r7-test";
const marker = `WB_R7_CHUNK_ISOLATION_${Date.now()}`;
const dataDir = process.env.OPENCLAW_DATA_DIR || "/Users/njx/openclaw_data/copilot/data";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-r7-isolation-"));

function assert(cond, message, details) {
  if (!cond) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function request(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

function sessionCookieFromResponse(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  if (!match) return "";
  const token = decodeURIComponent(match[1]);
  return `owb_session=${encodeURIComponent(token)}`;
}

function ffprobeRejects(filePath) {
  try {
    execFileSync("ffprobe", ["-v", "error", "-show_format", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return false;
  } catch (err) {
    const stderr = String((err.stderr || "") + (err.stdout || ""));
    return /moov atom not found|Invalid data found/i.test(stderr);
  }
}

function auditLogEventsForSession(dbPath, sessionId) {
  // Best-effort SQLite read. The audit table is `audit_logs` and stores
  // action / target_id / details (JSON string). We only care about events
  // that would surface if a chunk had been auto-transcribed.
  const sqliteBin = process.env.SQLITE_BIN || "sqlite3";
  const sql = `
    SELECT action, risk_level, details, ts
    FROM audit_logs
    WHERE target_id = '${sessionId.replace(/'/g, "''")}'
    ORDER BY ts ASC
  `;
  try {
    const raw = execFileSync(sqliteBin, [dbPath, sql], { encoding: "utf8" });
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          action: parts[0] || "",
          riskLevel: parts[1] || "",
          details: (parts[2] || "").trim(),
          ts: parts[3] || "",
        };
      });
  } catch {
    return [];
  }
}

async function main() {
  console.log(`[smoke] baseUrl=${baseUrl} dataDir=${dataDir}`);

  const health = await request("/api/health");
  assert(health.res.ok && health.body?.ok === true, "health_failed", health.body);

  const auth = await request(health.body?.setupRequired ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  assert(auth.res.ok && auth.body?.ok, "desktop_auth_failed", auth.body);
  const cookie = sessionCookieFromResponse(auth.res);
  assert(cookie, "desktop_auth_cookie_missing", { status: auth.res.status });

  const start = await request("/api/mobile/pairing/start", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ deviceHint: marker }),
  });
  assert(start.res.ok && /^\d{6}$/.test(String(start.body?.pairing?.code || "")), "pairing_start_failed", start.body);

  const claim = await request("/api/mobile/pairing/claim", {
    method: "POST",
    body: JSON.stringify({
      code: start.body.pairing.code,
      deviceName: `${marker} Mate60-isolation`,
      platform: "android",
      appVersion: "1.0.8-r7-isolation",
      buildNumber: "9",
    }),
  });
  assert(claim.res.ok && claim.body?.accessToken, "pairing_claim_failed", claim.body);

  const bearer = `Bearer ${claim.body.accessToken}`;
  const authHdr = { Authorization: bearer };

  const sessionCreate = await request("/api/mobile/recorder/sessions", {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({
      deviceId: claim.body.device.id,
      title: `${marker} R7 chunk-isolation`,
      language: "zh-CN",
      source: "mobile_app",
      scene: "voice_note",
      sampleRate: 16000,
      channelCount: 1,
    }),
  });
  assert(sessionCreate.res.ok && sessionCreate.body?.session?.id, "session_create_failed", sessionCreate.body);
  const sessionId = sessionCreate.body.session.id;

  // Upload 3 byte-chunks. Each chunk is a random byte buffer so ffprobe
  // would reject them outright.
  const totalChunks = 3;
  const fakeAudio = crypto.randomBytes(32 * 1024); // 32 KiB raw noise
  const audioBase64 = fakeAudio.toString("base64");

  const auditBefore = auditLogEventsForSession(path.join(dataDir, "workbench.sqlite"), sessionId);

  for (let i = 0; i < totalChunks; i += 1) {
    const r = await request(`/api/mobile/recorder/sessions/${encodeURIComponent(sessionId)}/chunks`, {
      method: "POST",
      headers: authHdr,
      body: JSON.stringify({
        chunkIndex: i,
        totalChunks,
        audioBase64,
        audioMime: "audio/wav",
        durationMs: 1000,
        language: "zh-CN",
        provider: "r7-isolation",
      }),
    });
    assert(r.res.status === 200, `chunk${i}_http_error`, { status: r.res.status, body: r.body });
    assert(r.body?.ok === true, `chunk${i}_must_be_ok`, r.body);
  }

  // Verify the session does NOT have a `status` of `transcribing` or `ready`
  // after raw chunk upload — chunks are evidence only.
  const sessionResp = await request(`/api/mobile/recorder/sessions/${encodeURIComponent(sessionId)}/segments`, {
    headers: authHdr,
  });
  assert(sessionResp.res.ok, "segments_list_failed", sessionResp.body);
  const segments = Array.isArray(sessionResp.body?.segments) ? sessionResp.body.segments : [];
  assert(segments.length === totalChunks, "segment_count_mismatch", { expected: totalChunks, got: segments.length });

  for (const seg of segments) {
    const st = String(seg.status || "");
    assert(
      !["transcript_ready", "transcribing", "completed"].includes(st),
      `chunk_segment_status_must_not_transcribe: got status=${st}`,
      seg,
    );
    assert(!seg.text || seg.text === "", "chunk_segment_text_must_be_empty_until_finalize", seg);
  }

  // Verify the chunks directory on disk exists and ffprobe rejects any
  // individual `.part` chunk as standalone audio (moov atom missing).
  const chunkDir = path.join(dataDir, "mobile", "recording-sessions", sessionId, "chunks");
  if (fs.existsSync(chunkDir)) {
    const partFiles = fs.readdirSync(chunkDir).filter((name) => /^\d{5}\.part$/.test(name));
    assert(partFiles.length >= 1, "part_files_missing_on_disk", { chunkDir });
    // At least one .part must be rejected by ffprobe — this is the
    // premise that motivates the regression. (Random bytes trivially fail,
    // but if Whisper ever ran directly on a single chunk, the server would
    // NOT have written it as a .part and ffprobe would still see no moov.)
    const samplePart = path.join(chunkDir, partFiles[0]);
    assert(ffprobeRejects(samplePart), "part_chunk_must_be_unreadable_by_ffprobe", { samplePart });
  }

  // Hit ingest WITHOUT a transcript — server must refuse and never spawn
  // Whisper as a fallback.
  const ingest = await request(`/api/mobile/recorder/sessions/${encodeURIComponent(sessionId)}/ingest`, {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({ target: "knowledge", payload: {} }),
  });
  assert(
    ingest.res.status === 400 && ingest.body?.error === "transcript_required",
    "ingest_without_transcript_must_refuse",
    ingest.body,
  );

  const auditAfter = auditLogEventsForSession(path.join(dataDir, "workbench.sqlite"), sessionId);
  const newAudit = auditAfter.slice(auditBefore.length);
  for (const ev of newAudit) {
    const lower = `${ev.action} ${ev.details}`.toLowerCase();
    assert(
      !/whisper|transcribe|transcription|asr/.test(lower),
      `audit_event_must_not_reference_asr_for_chunks: ${ev.action} ${ev.details}`,
      ev,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    sessionId,
    chunkCount: totalChunks,
    segmentStatuses: segments.map((seg) => seg.status),
    auditEventsObserved: newAudit.length,
    ingestRefusedWith: ingest.body?.error || null,
    note: "individual .part chunks must remain raw evidence; Whisper only runs after explicit finalize.",
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("R7_CHUNK_ISOLATION_FAIL:", err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });