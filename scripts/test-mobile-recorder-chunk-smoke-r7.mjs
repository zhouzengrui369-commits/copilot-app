// 2026-07-03 — R7 chunk-upload smoke against an OPENCLAW_WORKBENCH_URL.
// Defaults to http://127.0.0.1:38899 (the isolated local server with the
// post-fix dist), but can be re-pointed at the packaged njx-copilot.app on
// 38888 once that server is rebuilt / restarted.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38899";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || "openclaw-r7-test";
const marker = `WB_R7_CHUNK_SMOKE_${Date.now()}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-r7-chunk-smoke-"));

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

async function main() {
  console.log(`[smoke] baseUrl=${baseUrl}`);

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
      deviceName: `${marker} Mate60`,
      platform: "android",
      appVersion: "1.0.8-r7-smoke",
      buildNumber: "9",
    }),
  });
  assert(claim.res.ok && claim.body?.accessToken && claim.body?.refreshToken, "pairing_claim_failed", claim.body);

  const bearer = `Bearer ${claim.body.accessToken}`;
  const authHdr = { Authorization: bearer };

  const sessionCreate = await request("/api/mobile/recorder/sessions", {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({
      deviceId: claim.body.device.id,
      title: `${marker} Mate60 录音`,
      language: "zh-CN",
      source: "mobile_app",
      scene: "voice_note",
      sampleRate: 16000,
      channelCount: 1,
    }),
  });
  assert(sessionCreate.res.ok && sessionCreate.body?.ok && sessionCreate.body?.session?.id, "session_create_failed", sessionCreate.body);
  const sessionId = sessionCreate.body.session.id;

  // Upload 3 fake chunks. Each chunk is 1-second of empty PCM16 bytes.
  const totalChunks = 3;
  const chunkIndex0 = 0;
  const fakeAudio = Buffer.alloc(16000 * 2, 0x55); // 16 kHz * 2 bytes = 32 KB
  const audioBase64 = fakeAudio.toString("base64");

  // ---- The chunk that the Mate60 1.0.8 app reports as failing ----
  const chunk0 = await request(`/api/mobile/recorder/sessions/${encodeURIComponent(sessionId)}/chunks`, {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({
      chunkIndex: chunkIndex0,
      totalChunks,
      audioBase64,
      audioMime: "audio/wav",
      durationMs: 1000,
      language: "zh-CN",
      provider: "r7-smoke",
    }),
  });

  console.log("[smoke] chunk0 response:", JSON.stringify({ status: chunk0.res.status, ok: chunk0.body?.ok, error: chunk0.body?.error, status2: chunk0.body?.status }));

  assert(
    chunk0.res.status === 200,
    "chunk0_http_500_or_error",
    { status: chunk0.res.status, body: chunk0.body },
  );
  assert(chunk0.body?.ok === true, "chunk0_must_be_ok", chunk0.body);
  assert(
    !/Unknown named parameter/i.test(JSON.stringify(chunk0.body || {})),
    "chunk0_must_not_leak_unknown_named_parameter",
    chunk0.body,
  );
  assert(chunk0.body?.segment?.id, "chunk0_must_return_segment", chunk0.body);
  assert(chunk0.body?.session?.status, "chunk0_must_return_session_status", chunk0.body);

  // Upload chunks 1 and 2 to bring the session to "uploading" → later "ready"
  for (let i = 1; i < totalChunks; i++) {
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
        provider: "r7-smoke",
      }),
    });
    assert(r.res.status === 200, `chunk${i}_http_error`, { status: r.res.status, body: r.body });
  }

  const finalize = await request(`/api/mobile/recorder/sessions/${encodeURIComponent(sessionId)}/ingest`, {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({}),
  });
  console.log("[smoke] ingest response:", JSON.stringify({ status: finalize.res.status, ok: finalize.body?.ok, error: finalize.body?.error, status2: finalize.body?.session?.status }));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    sessionId,
    chunk0Status: chunk0.res.status,
    chunk0BodyStatus: chunk0.body?.status,
    chunk0SegmentId: chunk0.body?.segment?.id,
    chunk0SessionStatus: chunk0.body?.session?.status,
    ingestStatus: finalize.res.status,
    ingestOk: finalize.body?.ok,
    ingestError: finalize.body?.error || null,
    ingestSessionStatus: finalize.body?.session?.status || null,
    transcriptionProviderNote: "depends on env OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER; if `none` is configured, ingest will return ready with empty transcript and the explicit blocker is documented in EVIDENCE.md / RESULT.md",
  }));
}

main()
  .catch((err) => {
    console.error("R7_CHUNK_SMOKE_FAIL:", err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
