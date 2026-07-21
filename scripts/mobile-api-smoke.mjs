import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const marker = `WB_MOBILE_SMOKE_${Date.now()}`;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileConfig = JSON.parse(fs.readFileSync(path.join(rootDir, "apps", "mobile", "app.json"), "utf8")).expo;
const expectedMobileDistribution = mobileConfig.extra?.openclaw?.distribution || "ios-simulator-first";
const canonicalDataDir = "/Users/njx/openclaw_data/copilot/data";
const fallbackDataDir = path.join(rootDir, "data");
const dataDir = process.env.OPENCLAW_DATA_DIR
  ? path.resolve(process.env.OPENCLAW_DATA_DIR)
  : fs.existsSync(path.join(canonicalDataDir, "workbench.sqlite"))
    ? canonicalDataDir
    : fallbackDataDir;
const dbPath = process.env.OPENCLAW_MOBILE_SMOKE_DB_PATH
  ? path.resolve(process.env.OPENCLAW_MOBILE_SMOKE_DB_PATH)
  : path.join(dataDir, "workbench.sqlite");
let kbVaultRoot = process.env.OPENCLAW_KB_VAULT_DIR || "/Users/njx/openclaw";
let kbVaultReadOnly = false;
if (!fs.existsSync(dbPath)) throw new Error(`mobile smoke db not found: ${dbPath}`);
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000");

const createdAt = new Date().toISOString();
const cleanup = {
  sessionHashes: [],
  pairingIds: [],
  deviceIds: [],
  chatSessionIds: [],
  approvalIds: [],
  voiceNoteIds: [],
  calendarNoteIds: [],
  knowledgeEntryIds: [],
  markdownPaths: [],
  htmlPaths: [],
  kbFilePaths: [],
};

function assert(condition, message, details) {
  if (!condition) {
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
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookieFromResponse(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  if (!match) return "";
  const token = decodeURIComponent(match[1]);
  cleanup.sessionHashes.push(tokenHash(token));
  return `owb_session=${encodeURIComponent(token)}`;
}

async function desktopAuthCookie(health) {
  const authPassword = process.env.OPENCLAW_MOBILE_SMOKE_PASSWORD || process.env.OPENCLAW_WORKBENCH_PASSWORD || "openclaw-mobile-smoke";
  let auth = await request(health.data?.setupRequired ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: authPassword }),
  });
  if (auth.res.status === 409) {
    auth = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: authPassword }),
    });
  }
  assert(auth.res.ok && auth.data?.ok, "desktop_auth_failed", auth.data);
  const cookie = sessionCookieFromResponse(auth.res);
  assert(cookie, "desktop_auth_cookie_missing", { status: auth.res.status, headers: Object.fromEntries(auth.res.headers.entries()) });
  return cookie;
}

async function main() {
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.port === "38888" && process.env.OPENCLAW_ALLOW_PROD_SMOKE_WRITE !== "YES-I-KNOW") {
    throw new Error(`refuses to run writable mobile smoke against prod target ${baseUrl}; set OPENCLAW_WORKBENCH_URL to dev/staging or OPENCLAW_ALLOW_PROD_SMOKE_WRITE=YES-I-KNOW`);
  }

  const health = await request("/api/health");
  assert(health.res.ok && health.data.ok, "health_failed", health.data);

  const cookie = await desktopAuthCookie(health);
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
      deviceName: `${marker} Mate60`,
      platform: "android",
      appVersion: `${mobileConfig.version}-smoke`,
      buildNumber: String(mobileConfig.android?.versionCode || ""),
    }),
  });
  assert(claim.res.ok && claim.data.accessToken && claim.data.refreshToken, "pairing_claim_failed", claim.data);
  cleanup.deviceIds.push(claim.data.device.id);

  const auth = { Authorization: `Bearer ${claim.data.accessToken}` };
  const bootstrap = await request("/api/mobile/bootstrap", { headers: auth });
  assert(bootstrap.res.ok && bootstrap.data.ok && Array.isArray(bootstrap.data.agentOps), "bootstrap_failed", bootstrap.data);
  assert(bootstrap.data.mobile?.platform === expectedMobileDistribution, "bootstrap_mobile_contract_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.packageName === "com.openclaw.mobile", "bootstrap_android_package_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.iosBundleIdentifier === "com.openclaw.mobile", "bootstrap_ios_bundle_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.latestAppVersion === mobileConfig.version, "bootstrap_android_version_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.latestAndroidVersionCode === Number(mobileConfig.android?.versionCode || 0), "bootstrap_android_version_code_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.distribution === expectedMobileDistribution, "bootstrap_mobile_distribution_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.syncModel === "mac_primary_online_write_offline_readonly", "bootstrap_sync_model_failed", bootstrap.data.mobile);
  assert(bootstrap.data.featureFlags?.voiceRecording === true, "bootstrap_voice_recording_flag_failed", bootstrap.data.featureFlags);
  assert(bootstrap.data.featureFlags?.voiceAutoTranscription === false, "bootstrap_voice_auto_transcription_flag_failed", bootstrap.data.featureFlags);
  assert(bootstrap.data.mobile?.nativeCapabilities?.audioRecording === true, "bootstrap_native_audio_recording_failed", bootstrap.data.mobile);
  assert(bootstrap.data.mobile?.nativeCapabilities?.microphonePermission === true, "bootstrap_microphone_capability_failed", bootstrap.data.mobile);
  assert(bootstrap.data.vault?.root, "bootstrap_vault_truth_missing", bootstrap.data.vault);
  if (fs.existsSync("/Volumes/南极熊")) {
    assert(String(bootstrap.data.vault.root).startsWith("/Volumes/南极熊"), "bootstrap_vault_not_nanjixiong", bootstrap.data.vault);
  }
  kbVaultRoot = String(bootstrap.data.vault.root);
  kbVaultReadOnly = bootstrap.data.vault.writable === false;

  const today = await request(`/api/mobile/today?date=${new Date().toISOString().slice(0, 10)}`, { headers: auth });
  assert(today.res.ok && today.data.ok && Array.isArray(today.data.nextActions), "today_failed", today.data);

  const rawVoiceCreate = await request("/api/mobile/voice-notes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      date: today.data.date,
      title: `${marker} 待自动转写`,
      transcriptText: "",
      source: "audio_upload",
      language: "zh-CN",
      durationSeconds: 3,
    }),
  });
  assert(rawVoiceCreate.res.ok && rawVoiceCreate.data.voiceNote?.id && rawVoiceCreate.data.voiceNote?.status === "manual_transcript_required", "raw_voice_note_create_failed", rawVoiceCreate.data);
  cleanup.voiceNoteIds.push(rawVoiceCreate.data.voiceNote.id);

  const transcribeUnavailable = await request(`/api/mobile/voice-notes/${encodeURIComponent(rawVoiceCreate.data.voiceNote.id)}/transcribe`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      audioBase64: Buffer.from("not a real audio file").toString("base64"),
      audioMime: "audio/m4a",
      filename: "mobile-smoke.m4a",
      durationSeconds: 3,
      language: "zh-CN",
    }),
  });
  assert(
    transcribeUnavailable.res.status === 503 && transcribeUnavailable.data?.error === "transcription_provider_unavailable",
    "transcription_unavailable_contract_failed",
    transcribeUnavailable.data,
  );

  const voiceTranscript = [
    `${marker} 手机语音记录测试`,
    "今天需要确认 OpenClaw 手机端可以把语音转写文本保存为知识笔记，并自动加入今日日程。",
    "这条记录来自 mobile API 烟测。",
  ].join("\n");
  const voiceCreate = await request("/api/mobile/voice-notes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      date: today.data.date,
      title: `${marker} 语音笔记`,
      transcriptText: voiceTranscript,
      source: "speech_recognition",
      language: "zh-CN",
      durationSeconds: 42,
    }),
  });
  assert(voiceCreate.res.ok && voiceCreate.data.voiceNote?.id && voiceCreate.data.voiceNote?.status === "transcript_ready", "voice_note_create_failed", voiceCreate.data);
  assert(voiceCreate.data.voiceNote?.source === "speech_recognition" && voiceCreate.data.voiceNote?.durationSeconds === 42, "voice_note_recording_metadata_failed", voiceCreate.data.voiceNote);
  cleanup.voiceNoteIds.push(voiceCreate.data.voiceNote.id);

  const voiceOrganize = await request(`/api/mobile/voice-notes/${encodeURIComponent(voiceCreate.data.voiceNote.id)}/organize`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  assert(voiceOrganize.res.ok && voiceOrganize.data.calendarNote?.id && voiceOrganize.data.knowledgeEntry?.id, "voice_note_organize_failed", voiceOrganize.data);
  cleanup.calendarNoteIds.push(voiceOrganize.data.calendarNote.id);
  cleanup.knowledgeEntryIds.push(voiceOrganize.data.knowledgeEntry.id);
  if (voiceOrganize.data.markdownPath) cleanup.markdownPaths.push(voiceOrganize.data.markdownPath);
  assert(voiceOrganize.data.markdownPath && fs.existsSync(voiceOrganize.data.markdownPath), "voice_note_markdown_missing", voiceOrganize.data);
  // 2026-06-19 — Mate60: organize 必须同时产出 Markdown + HTML,calendar_notes.knowledge_html_path 也要 set
  assert(voiceOrganize.data.htmlPath && fs.existsSync(voiceOrganize.data.htmlPath), "voice_note_html_missing", voiceOrganize.data);
  cleanup.htmlPaths.push(voiceOrganize.data.htmlPath);
  const storedNote = db.prepare("SELECT knowledge_html_path FROM calendar_notes WHERE id = ?").get(voiceOrganize.data.calendarNote.id);
  assert(storedNote?.knowledge_html_path === voiceOrganize.data.htmlPath, "voice_note_html_path_not_persisted", { storedNote, expected: voiceOrganize.data.htmlPath });
  const storedRender = db.prepare("SELECT html_path, source_path FROM document_renders WHERE html_path = ?").get(voiceOrganize.data.htmlPath);
  assert(storedRender?.source_path === voiceOrganize.data.markdownPath, "voice_note_document_renders_missing", { storedRender, expected: voiceOrganize.data.markdownPath });

  // 2026-06-19 — 再次调用 organize 必须返回同一对路径(幂等 + htmlPath 不再空)
  const voiceOrganizeAgain = await request(`/api/mobile/voice-notes/${encodeURIComponent(voiceCreate.data.voiceNote.id)}/organize`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  assert(voiceOrganizeAgain.res.ok && voiceOrganizeAgain.data.markdownPath === voiceOrganize.data.markdownPath, "voice_note_organize_idempotent_failed", voiceOrganizeAgain.data);
  assert(voiceOrganizeAgain.data.htmlPath === voiceOrganize.data.htmlPath, "voice_note_organize_html_idempotent_failed", voiceOrganizeAgain.data);

  const voiceList = await request(`/api/mobile/voice-notes?date=${encodeURIComponent(today.data.date)}`, { headers: auth });
  assert(voiceList.res.ok && (voiceList.data.voiceNotes || []).some((row) => row.id === voiceCreate.data.voiceNote.id && row.status === "organized"), "voice_note_list_failed", voiceList.data);

  const todayAfterVoice = await request(`/api/mobile/today?date=${encodeURIComponent(today.data.date)}`, { headers: auth });
  assert(
    todayAfterVoice.res.ok && (todayAfterVoice.data.notes || []).some((row) => row.id === voiceOrganize.data.calendarNote.id),
    "voice_note_today_sync_failed",
    todayAfterVoice.data,
  );

  // 2026-06-19 — Mate60: /api/mobile/kb/* 端到端 CRUD 烟测(vault 根走 server config 默认)
  const kbDir = `mobile-smoke/${marker}`;
  const kbMdName = `${marker}-note.md`;
  const kbHtmlName = `${marker}-page.html`;
  const kbMdPath = `/${kbDir}/${kbMdName}`;
  const kbHtmlPath = `/${kbDir}/${kbHtmlName}`;
  if (kbVaultReadOnly) {
    const kbListRoot = await request(`/api/mobile/kb/list?path=${encodeURIComponent("/")}`, { headers: auth });
    assert(kbListRoot.res.ok && Array.isArray(kbListRoot.data.entries), "kb_list_failed", kbListRoot.data);
    assert(kbListRoot.data.readOnly === true && kbListRoot.data.vault?.writable === false, "kb_readonly_truth_missing", kbListRoot.data);
    const readOnlyCreate = await request(`/api/mobile/kb/create?path=${encodeURIComponent(`/${marker}.md`)}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "markdown", content: "readonly should fail clearly" }),
    });
    assert(readOnlyCreate.res.status === 423 && readOnlyCreate.data?.error === "vault_read_only", "kb_readonly_create_should_423", readOnlyCreate.data);
  } else {
    // ensure parent dir on disk so kb create can succeed
    const kbAbsDir = path.join(kbVaultRoot, kbDir);
    fs.mkdirSync(kbAbsDir, { recursive: true });

    const kbListRoot = await request(`/api/mobile/kb/list?path=${encodeURIComponent("/" + kbDir)}`, { headers: auth });
    assert(kbListRoot.res.ok && Array.isArray(kbListRoot.data.entries), "kb_list_failed", kbListRoot.data);
    assert(kbListRoot.data.vaultRoot, "kb_vault_root_missing", kbListRoot.data);
    if (fs.existsSync("/Volumes/南极熊")) {
      assert(String(kbListRoot.data.vaultRoot).startsWith("/Volumes/南极熊"), "kb_vault_root_not_nanjixiong", kbListRoot.data);
    }
    kbVaultRoot = String(kbListRoot.data.vaultRoot);

    const kbMdCreate = await request(`/api/mobile/kb/create?path=${encodeURIComponent(kbMdPath)}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "markdown", title: `${marker} KB Markdown`, content: `# ${marker}\n\nmobile KB smoke markdown\n` }),
    });
    assert(kbMdCreate.res.ok && kbMdCreate.data.kind === "markdown" && kbMdCreate.data.bytes > 0, "kb_md_create_failed", kbMdCreate.data);
    cleanup.kbFilePaths.push(kbMdPath);

    const kbHtmlCreate = await request(`/api/mobile/kb/create?path=${encodeURIComponent(kbHtmlPath)}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "html", title: `${marker} KB HTML`, content: `<!doctype html><html><body><h1>${marker}</h1><p>smoke</p></body></html>` }),
    });
    assert(kbHtmlCreate.res.ok && kbHtmlCreate.data.kind === "html" && kbHtmlCreate.data.bytes > 0, "kb_html_create_failed", kbHtmlCreate.data);
    cleanup.kbFilePaths.push(kbHtmlPath);

    // 重复 create 必须 409
    const kbMdDup = await request(`/api/mobile/kb/create?path=${encodeURIComponent(kbMdPath)}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "markdown", content: "dup" }),
    });
    assert(kbMdDup.res.status === 409 && kbMdDup.data?.error === "file_exists", "kb_dup_should_409", kbMdDup.data);

    // read 路径校验
    const kbMdRead = await request(`/api/mobile/kb/read?path=${encodeURIComponent(kbMdPath)}`, { headers: auth });
    assert(kbMdRead.res.ok && kbMdRead.data.kind === "markdown" && kbMdRead.data.content.includes(marker), "kb_md_read_failed", kbMdRead.data);

    // write 覆盖
    const kbMdWrite = await request(`/api/mobile/kb/write?path=${encodeURIComponent(kbMdPath)}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ content: `# ${marker}\n\nupdated\n` }),
    });
    assert(kbMdWrite.res.ok && kbMdWrite.data.bytes > 0, "kb_md_write_failed", kbMdWrite.data);
    const kbMdRead2 = await request(`/api/mobile/kb/read?path=${encodeURIComponent(kbMdPath)}`, { headers: auth });
    assert(kbMdRead2.data.content.includes("updated"), "kb_md_write_not_persisted", kbMdRead2.data);

    // delete → 404 再次
    const kbMdDelete = await request(`/api/mobile/kb/delete?path=${encodeURIComponent(kbMdPath)}`, { method: "DELETE", headers: auth, body: JSON.stringify({}) });
    assert(kbMdDelete.res.ok && kbMdDelete.data.bytes > 0, "kb_md_delete_failed", kbMdDelete.data);
    const kbMdRead3 = await request(`/api/mobile/kb/read?path=${encodeURIComponent(kbMdPath)}`, { headers: auth });
    assert(kbMdRead3.res.status === 404, "kb_md_delete_should_404", kbMdRead3.data);
  }

  // 越界路径必须 403
  const kbTraversal = await request(`/api/mobile/kb/read?path=${encodeURIComponent("/../../etc/passwd")}`, { headers: auth });
  assert(kbTraversal.res.status === 403 && kbTraversal.data?.error === "path_traversal", "kb_path_traversal_should_403", kbTraversal.data);

  // 2026-06-19 — Mate60: /api/mobile/calendar/* 端到端 CRUD 烟测
  const calDate = new Date().toISOString().slice(0, 10);
  const calCreate = await request("/api/mobile/calendar/create", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      date: calDate,
      title: `${marker} 日程烟测`,
      description: "由 mobile-api-smoke 创建,验收后自动清理",
      startTime: "10:00",
      endTime: "11:30",
      kind: "event",
    }),
  });
  assert(calCreate.res.status === 201 && calCreate.data?.event?.id, "calendar_create_failed", calCreate.data);
  assert(calCreate.data.event.startTime === "10:00" && calCreate.data.event.endTime === "11:30", "calendar_create_time_mismatch", calCreate.data);
  assert(calCreate.data.event.kind === "event" && calCreate.data.event.status === "active", "calendar_create_kind_status_failed", calCreate.data);
  const calEventId = calCreate.data.event.id;
  cleanup.calendarNoteIds.push(calEventId);

  // calendar list by date 必须能查回
  const calList = await request(`/api/mobile/calendar?date=${encodeURIComponent(calDate)}`, { headers: auth });
  assert(calList.res.ok && (calList.data.events || []).some((row) => row.id === calEventId), "calendar_list_failed", calList.data);

  // range 也必须能查回
  const calRange = await request(`/api/mobile/calendar/range?start=${encodeURIComponent(calDate)}&end=${encodeURIComponent(calDate)}`, { headers: auth });
  assert(calRange.res.ok && (calRange.data.events || []).some((row) => row.id === calEventId), "calendar_range_failed", calRange.data);

  // 时间对错误(start > end)必须 400
  const calBadTime = await request("/api/mobile/calendar/create", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ date: calDate, title: "bad", startTime: "12:00", endTime: "11:00" }),
  });
  assert(calBadTime.res.status === 400 && calBadTime.data?.error === "time_pair_invalid", "calendar_invalid_time_should_400", calBadTime.data);

  // update: 改 status=completed + 描述
  const calUpdate = await request(`/api/mobile/calendar/${encodeURIComponent(calEventId)}/update`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ description: "updated desc", status: "completed" }),
  });
  assert(calUpdate.res.ok && calUpdate.data.event.status === "completed" && calUpdate.data.event.description === "updated desc", "calendar_update_failed", calUpdate.data);

  // delete 必须成功
  const calDelete = await request(`/api/mobile/calendar/${encodeURIComponent(calEventId)}/delete`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  assert(calDelete.res.ok && calDelete.data.id === calEventId, "calendar_delete_failed", calDelete.data);
  // 删除后 list 应找不到
  const calListAfter = await request(`/api/mobile/calendar?date=${encodeURIComponent(calDate)}`, { headers: auth });
  assert(calListAfter.res.ok && !(calListAfter.data.events || []).some((row) => row.id === calEventId), "calendar_delete_should_remove", calListAfter.data);

  const chatSession = await request("/api/chat/sessions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      title: `${marker} mobile remote chat`,
      agentId: "main",
      modelId: "minimax-m3",
      knowledgeSources: ["all"],
      skillIds: [],
      planEnabled: false,
    }),
  });
  assert(chatSession.res.ok && chatSession.data.session?.id, "mobile_chat_session_create_failed", chatSession.data);
  cleanup.chatSessionIds.push(chatSession.data.session.id);

  const approvalId = crypto.randomUUID();
  cleanup.approvalIds.push(approvalId);
  db.prepare("INSERT INTO approvals (id, task_id, action, status, requested_at, details) VALUES (?, ?, ?, ?, ?, ?)")
    .run(approvalId, null, "mobile_smoke_low_risk", "pending", createdAt, JSON.stringify({ source: "mobile-api-smoke", marker, risk: "low" }));
  const approvalResolve = await request(`/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ decision: "rejected" }),
  });
  const approvalRow = db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId);
  assert(approvalResolve.res.ok && approvalResolve.data.ok && approvalRow?.status === "rejected", "mobile_approval_resolve_failed", {
    response: approvalResolve.data,
    approvalRow,
  });

  const refresh = await request("/api/mobile/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: claim.data.refreshToken }),
  });
  assert(refresh.res.ok && refresh.data.accessToken, "refresh_failed", refresh.data);

  const devices = await request("/api/mobile/devices", { headers: { Authorization: `Bearer ${refresh.data.accessToken}` } });
  const device = (devices.data.devices || []).find((row) => row.id === claim.data.device.id);
  assert(devices.res.ok && device?.status === "active", "devices_failed", devices.data);

  const revoke = await request(`/api/mobile/devices/${encodeURIComponent(claim.data.device.id)}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refresh.data.accessToken}` },
    body: JSON.stringify({}),
  });
  assert(revoke.res.ok && revoke.data.device?.status === "revoked", "revoke_failed", revoke.data);

  const revokedAccess = await request("/api/mobile/bootstrap", { headers: { Authorization: `Bearer ${refresh.data.accessToken}` } });
  assert(revokedAccess.res.status === 401, "revoked_token_still_valid", revokedAccess.data);

  console.log(JSON.stringify({
    ok: true,
    marker,
    pairingId: start.data.pairing.id,
    deviceId: claim.data.device.id,
    platform: claim.data.device.platform,
    mobile: bootstrap.data.mobile,
    today: { date: today.data.date, nextActions: today.data.nextActions.length },
    remoteOps: {
      chatSessionCreated: chatSession.data.session.id,
      approvalResolved: approvalId,
      voiceNoteCreated: voiceCreate.data.voiceNote.id,
      voiceNoteCalendarNote: voiceOrganize.data.calendarNote.id,
      voiceNoteKnowledgeEntry: voiceOrganize.data.knowledgeEntry.id,
      voiceNoteMarkdownPath: voiceOrganize.data.markdownPath,
      voiceNoteHtmlPath: voiceOrganize.data.htmlPath,
      voiceNoteHtmlPersisted: true,
      kbSmoke: {
        mdPath: kbMdPath,
        htmlPath: kbHtmlPath,
        traversalBlocked: true,
      },
      calendarSmoke: {
        date: calDate,
        createId: calEventId,
        rangeOk: true,
        invalidTimeRejected: true,
        updateStatus: "completed",
        deleted: true,
      },
      voiceRecordingCapability: bootstrap.data.mobile.nativeCapabilities.audioRecording,
      voiceAutoTranscription: bootstrap.data.featureFlags.voiceAutoTranscription,
    },
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      for (const voiceNoteId of cleanup.voiceNoteIds) {
        db.prepare("DELETE FROM mobile_voice_notes WHERE id = ?").run(voiceNoteId);
      }
      for (const calendarNoteId of cleanup.calendarNoteIds) {
        db.prepare("DELETE FROM calendar_notes WHERE id = ?").run(calendarNoteId);
      }
      for (const knowledgeEntryId of cleanup.knowledgeEntryIds) {
        db.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(knowledgeEntryId);
      }
      for (const markdownPath of cleanup.markdownPaths) {
        if (markdownPath && fs.existsSync(markdownPath)) fs.unlinkSync(markdownPath);
      }
      for (const htmlPath of cleanup.htmlPaths) {
        if (htmlPath && fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
      }
      // 清理 KB 烟测残留(md 已被 DELETE 走真实接口,这里兜底 html)
      for (const kbFilePath of cleanup.kbFilePaths) {
        if (!kbFilePath) continue;
        const abs = path.join(kbVaultRoot, kbFilePath.replace(/^\/+/, ""));
        if (fs.existsSync(abs)) {
          try { fs.unlinkSync(abs); } catch { /* ignore */ }
        }
      }
      for (const chatSessionId of cleanup.chatSessionIds) {
        db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(chatSessionId);
        db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(chatSessionId);
      }
      for (const approvalId of cleanup.approvalIds) {
        db.prepare("DELETE FROM approvals WHERE id = ?").run(approvalId);
      }
      for (const deviceId of cleanup.deviceIds) {
        db.prepare("DELETE FROM mobile_device_tokens WHERE device_id = ?").run(deviceId);
        db.prepare("DELETE FROM mobile_devices WHERE id = ?").run(deviceId);
      }
      for (const pairingId of cleanup.pairingIds) {
        db.prepare("DELETE FROM mobile_pairing_challenges WHERE id = ?").run(pairingId);
      }
      for (const sessionHash of cleanup.sessionHashes) {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash);
      }
    } finally {
      db.close();
    }
  });
