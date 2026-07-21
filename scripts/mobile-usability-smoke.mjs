import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const localBaseUrl = (process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888").replace(/\/+$/, "");
const fallbackBrokerUrl = (process.env.OPENCLAW_MOBILE_PUBLIC_URL
  || process.env.OPENCLAW_CB_BROKER_URL
  || "https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay").replace(/\/+$/, "");
const password = process.env.OPENCLAW_MOBILE_USABILITY_PASSWORD
  || process.env.OPENCLAW_WORKBENCH_PASSWORD
  || "openclaw2026";
const usabilityMode = (process.env.OPENCLAW_MOBILE_USABILITY_MODE || "broker").toLowerCase();
const useLocalMode = usabilityMode === "local";
const marker = `WB_MOBILE_USABILITY_${Date.now()}`;
const todayKey = new Date().toISOString().slice(0, 10);
const canonicalDbPath = path.join(os.homedir(), "openclaw_data", "copilot", "data", "workbench.sqlite");
const dbPath = process.env.OPENCLAW_MOBILE_USABILITY_DB_PATH || process.env.OPENCLAW_MOBILE_SMOKE_DB_PATH || canonicalDbPath;
let kbVaultRoot = process.env.OPENCLAW_KB_VAULT_DIR || path.join(os.homedir(), "openclaw");
let kbVaultReadOnly = false;
const cleanupDb = process.env.OPENCLAW_MOBILE_USABILITY_CLEANUP_DB !== "0" && fs.existsSync(dbPath);

const stepRows = [];
const cleanup = {
  sessionHashes: [],
  pairingIds: [],
  deviceIds: [],
  voiceNoteIds: [],
  calendarNoteIds: [],
  knowledgeEntryIds: [],
  documentRenderPaths: [],
  generatedFiles: [],
  kbPaths: [],
  failures: [],
};

let db = null;
if (cleanupDb) {
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseSessionCookie(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  if (!match) return "";
  const token = decodeURIComponent(match[1]);
  cleanup.sessionHashes.push(tokenHash(token));
  return `owb_session=${encodeURIComponent(token)}`;
}

function bytesOf(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? {}), "utf8");
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function request(baseUrl, pathname, options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs || 35_000;
  const method = options.method || "GET";
  const maxAttempts = method === "GET" ? Number(process.env.OPENCLAW_MOBILE_USABILITY_GET_RETRIES || 2) : 1;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    last = {
      res,
      data,
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - started,
      bytes: bytesOf(text),
      attempts: attempt,
    };
    if (!(res.status === 504 || data?.error === "GATEWAY_TIMEOUT") || attempt >= maxAttempts) return last;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return last;
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    stepRows.push({ name, ok: true, durationMs: Date.now() - started, ...(result || {}) });
    return result;
  } catch (err) {
    stepRows.push({ name, ok: false, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function main() {
  let brokerUrl = fallbackBrokerUrl;
  let desktopCookie = "";
  let accessToken = "";
  let refreshToken = "";
  let deviceId = "";

  await step("desktop health", async () => {
    const health = await request(localBaseUrl, "/api/health");
    assert(health.ok && health.data?.ok, "desktop_health_failed", health.data);
    return { status: health.status, bytes: health.bytes };
  });

  await step("desktop auth", async () => {
    let login = await request(localBaseUrl, "/api/auth/login", {
      method: "POST",
      body: { password },
    });
    if (login.status === 409) {
      login = await request(localBaseUrl, "/api/auth/setup", {
        method: "POST",
        body: { password },
      });
    }
    assert(login.ok && login.data?.ok, "desktop_auth_failed", login.data);
    desktopCookie = parseSessionCookie(login.res);
    assert(desktopCookie, "desktop_auth_cookie_missing", Object.fromEntries(login.res.headers.entries()));
    return { status: login.status };
  });

  const pairing = await step("pairing start via desktop, broker code", async () => {
    const start = await request(localBaseUrl, "/api/mobile/pairing/start", {
      method: "POST",
      headers: { Cookie: desktopCookie },
      body: { deviceHint: `${marker} computer-usability` },
    });
    assert(start.ok && /^\d{6}$/.test(String(start.data?.pairing?.code || "")), "pairing_start_failed", start.data);
    cleanup.pairingIds.push(start.data.pairing.id);
    brokerUrl = String(start.data.pairing.publicUrl || start.data.pairing.broker?.brokerUrl || fallbackBrokerUrl).replace(/\/+$/, "");
    if (useLocalMode) brokerUrl = localBaseUrl;
    else assert(start.data.pairing.broker?.ok === true, "broker_pairing_code_not_ready", start.data.pairing.broker);
    return {
      code: start.data.pairing.code,
      brokerUrl,
      expiresAt: start.data.pairing.expiresAt,
      mode: useLocalMode ? "local" : "broker",
    };
  });

  await step(useLocalMode ? "pairing claim via local workbench" : "pairing claim via public broker", async () => {
    const claim = await request(brokerUrl, "/api/mobile/pairing/claim", {
      method: "POST",
      body: {
        code: pairing.code,
        deviceName: useLocalMode ? `${marker} iOS local usability` : `${marker} Mate60 usability`,
        platform: useLocalMode ? "ios" : "android",
        appVersion: "1.0.7-computer-usability",
        buildNumber: "computer",
      },
      timeoutMs: 60_000,
    });
    assert(claim.ok && claim.data?.accessToken && claim.data?.refreshToken && claim.data?.device?.id, "broker_pairing_claim_failed", claim.data);
    accessToken = claim.data.accessToken;
    refreshToken = claim.data.refreshToken;
    deviceId = claim.data.device.id;
    cleanup.deviceIds.push(deviceId);
    return { status: claim.status, deviceId, durationMs: claim.durationMs, bytes: claim.bytes };
  });

  await step("bootstrap via public broker", async () => {
    const bootstrap = await request(brokerUrl, "/api/mobile/bootstrap", {
      headers: authHeader(accessToken),
      timeoutMs: 60_000,
    });
    assert(bootstrap.ok && bootstrap.data?.ok && bootstrap.data?.mobile?.packageName === "com.openclaw.mobile", "broker_bootstrap_failed", bootstrap.data);
    assert(bootstrap.data?.featureFlags?.knowledgePreview === true, "bootstrap_knowledge_flag_missing", bootstrap.data?.featureFlags);
    assert(bootstrap.data?.featureFlags?.voiceNotes === true, "bootstrap_voice_flag_missing", bootstrap.data?.featureFlags);
    assert(bootstrap.data?.vault?.root, "bootstrap_vault_truth_missing", bootstrap.data?.vault);
    if (fs.existsSync("/Volumes/南极熊")) {
      assert(String(bootstrap.data.vault.root).startsWith("/Volumes/南极熊"), "bootstrap_vault_not_nanjixiong", bootstrap.data.vault);
    }
    return { status: bootstrap.status, durationMs: bootstrap.durationMs, bytes: bootstrap.bytes, vault: bootstrap.data.vault };
  });

  await step("today console via public broker", async () => {
    const today = await request(brokerUrl, `/api/mobile/today?date=${encodeURIComponent(todayKey)}`, {
      headers: authHeader(accessToken),
      timeoutMs: 90_000,
    });
    assert(today.ok && today.data?.ok && Array.isArray(today.data?.nextActions), "broker_today_failed", today.data);
    assert(Array.isArray(today.data?.todos) && Array.isArray(today.data?.events) && Array.isArray(today.data?.planItems), "today_agenda_payload_missing", today.data);
    assert(today.bytes < 80_000, "broker_today_payload_too_large_for_mobile", { bytes: today.bytes });
    return {
      status: today.status,
      durationMs: today.durationMs,
      bytes: today.bytes,
      nextActions: today.data.nextActions.length,
      events: today.data.events.length,
      todos: today.data.todos.length,
      planItems: today.data.planItems.length,
      notes: Array.isArray(today.data.notes) ? today.data.notes.length : 0,
    };
  });

  await step("device list via public broker", async () => {
    const devices = await request(brokerUrl, "/api/mobile/devices", {
      headers: authHeader(accessToken),
      timeoutMs: 60_000,
    });
    assert(devices.ok && (devices.data?.devices || []).some((row) => row.id === deviceId), "broker_devices_missing_current_device", devices.data);
    return { status: devices.status, durationMs: devices.durationMs, bytes: devices.bytes, devices: devices.data.devices.length };
  });

  await step("knowledge root list via public broker", async () => {
    const list = await request(brokerUrl, "/api/mobile/kb/list?path=%2F", {
      headers: authHeader(accessToken),
      timeoutMs: 90_000,
    });
    assert(list.ok && Array.isArray(list.data?.entries), "broker_kb_root_list_failed", list.data);
    assert(list.data?.vaultRoot, "broker_kb_vault_root_missing", list.data);
    if (fs.existsSync("/Volumes/南极熊")) {
      assert(String(list.data.vaultRoot).startsWith("/Volumes/南极熊"), "broker_kb_vault_root_not_nanjixiong", list.data);
    }
    kbVaultRoot = String(list.data.vaultRoot);
    kbVaultReadOnly = Boolean(list.data.readOnly || list.data.vault?.writable === false);
    assert(list.bytes < 80_000, "broker_kb_root_payload_too_large_for_mobile", { bytes: list.bytes, total: list.data?.total });
    return { status: list.status, durationMs: list.durationMs, bytes: list.bytes, total: list.data.total, vaultRoot: list.data.vaultRoot, readOnly: kbVaultReadOnly };
  });

  await step("knowledge atlas via public broker", async () => {
    const atlas = await request(brokerUrl, "/api/mobile/knowledge/atlas", {
      headers: authHeader(accessToken),
      timeoutMs: 90_000,
    });
    assert(atlas.ok && atlas.data?.ok && Array.isArray(atlas.data?.sourceStates), "broker_knowledge_atlas_failed", atlas.data);
    assert(Array.isArray(atlas.data?.categories) && atlas.data?.graph?.nodes, "broker_knowledge_atlas_shape_failed", atlas.data);
    assert(atlas.bytes < 120_000, "broker_knowledge_atlas_payload_too_large_for_mobile", { bytes: atlas.bytes });
    return {
      status: atlas.status,
      durationMs: atlas.durationMs,
      bytes: atlas.bytes,
      sources: atlas.data.sourceStates.length,
      categories: atlas.data.categories.length,
      nodes: atlas.data.graph.nodes.length,
    };
  });

  const mdPath = `/${marker}.md`;
  const htmlPath = `/${marker}.html`;
  cleanup.kbPaths.push(mdPath, htmlPath);

  if (kbVaultReadOnly) {
    await step("knowledge write gate reports read-only vault", async () => {
      const create = await request(brokerUrl, `/api/mobile/kb/create?path=${encodeURIComponent(mdPath)}`, {
        method: "POST",
        headers: authHeader(accessToken),
        body: { kind: "markdown", title: `${marker} Markdown`, content: `# ${marker}\n\ncomputer usability markdown\n` },
        timeoutMs: 60_000,
      });
      assert(create.status === 423 && create.data?.error === "vault_read_only", "broker_kb_readonly_gate_failed", create.data);
      cleanup.kbPaths = cleanup.kbPaths.filter((p) => p !== mdPath && p !== htmlPath);
      return { status: create.status, durationMs: create.durationMs, bytes: create.bytes, reason: create.data.reason };
    });
  } else {

    await step("knowledge markdown create/read/write/delete via public broker", async () => {
      const create = await request(brokerUrl, `/api/mobile/kb/create?path=${encodeURIComponent(mdPath)}`, {
        method: "POST",
        headers: authHeader(accessToken),
        body: { kind: "markdown", title: `${marker} Markdown`, content: `# ${marker}\n\ncomputer usability markdown\n` },
        timeoutMs: 60_000,
      });
      assert(create.ok && create.data?.kind === "markdown", "broker_kb_md_create_failed", create.data);
      const read1 = await request(brokerUrl, `/api/mobile/kb/read?path=${encodeURIComponent(mdPath)}`, {
        headers: authHeader(accessToken),
        timeoutMs: 60_000,
      });
      assert(read1.ok && String(read1.data?.content || "").includes(marker), "broker_kb_md_read_failed", read1.data);
      const write = await request(brokerUrl, `/api/mobile/kb/write?path=${encodeURIComponent(mdPath)}`, {
        method: "POST",
        headers: authHeader(accessToken),
        body: { content: `# ${marker}\n\nupdated from broker usability smoke\n` },
        timeoutMs: 60_000,
      });
      assert(write.ok && write.data?.bytes > 0, "broker_kb_md_write_failed", write.data);
      const read2 = await request(brokerUrl, `/api/mobile/kb/read?path=${encodeURIComponent(mdPath)}`, {
        headers: authHeader(accessToken),
        timeoutMs: 60_000,
      });
      assert(read2.ok && String(read2.data?.content || "").includes("updated from broker"), "broker_kb_md_write_not_persisted", read2.data);
      const del = await request(brokerUrl, `/api/mobile/kb/delete?path=${encodeURIComponent(mdPath)}`, {
        method: "DELETE",
        headers: authHeader(accessToken),
        timeoutMs: 60_000,
      });
      assert(del.ok, "broker_kb_md_delete_failed", del.data);
      cleanup.kbPaths = cleanup.kbPaths.filter((p) => p !== mdPath);
      return { durationMs: create.durationMs + read1.durationMs + write.durationMs + read2.durationMs + del.durationMs, bytes: create.bytes + read1.bytes + write.bytes + read2.bytes + del.bytes };
    });

    await step("knowledge html create/read/write/delete via public broker", async () => {
      const create = await request(brokerUrl, `/api/mobile/kb/create?path=${encodeURIComponent(htmlPath)}`, {
        method: "POST",
        headers: authHeader(accessToken),
        body: { kind: "html", title: `${marker} HTML`, content: `<!doctype html><html><body><h1>${marker}</h1><p>computer usability html</p></body></html>` },
        timeoutMs: 60_000,
      });
      assert(create.ok && create.data?.kind === "html", "broker_kb_html_create_failed", create.data);
      const read1 = await request(brokerUrl, `/api/mobile/kb/read?path=${encodeURIComponent(htmlPath)}`, {
        headers: authHeader(accessToken),
        timeoutMs: 60_000,
      });
      assert(read1.ok && String(read1.data?.content || "").includes(marker), "broker_kb_html_read_failed", read1.data);
      const write = await request(brokerUrl, `/api/mobile/kb/write?path=${encodeURIComponent(htmlPath)}`, {
        method: "POST",
        headers: authHeader(accessToken),
        body: { content: `<!doctype html><html><body><h1>${marker}</h1><p>updated from broker</p></body></html>` },
        timeoutMs: 60_000,
      });
      assert(write.ok && write.data?.bytes > 0, "broker_kb_html_write_failed", write.data);
      const del = await request(brokerUrl, `/api/mobile/kb/delete?path=${encodeURIComponent(htmlPath)}`, {
        method: "DELETE",
        headers: authHeader(accessToken),
        timeoutMs: 60_000,
      });
      assert(del.ok, "broker_kb_html_delete_failed", del.data);
      cleanup.kbPaths = cleanup.kbPaths.filter((p) => p !== htmlPath);
      return { durationMs: create.durationMs + read1.durationMs + write.durationMs + del.durationMs, bytes: create.bytes + read1.bytes + write.bytes + del.bytes };
    });
  }

  await step("calendar create/list/update/delete via public broker", async () => {
    const create = await request(brokerUrl, "/api/mobile/calendar/create", {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        date: todayKey,
        title: `${marker} 日程可用性测试`,
        description: "电脑端模拟 Mate60 创建,测试后删除",
        startTime: "10:00",
        endTime: "10:30",
        kind: "event",
      },
      timeoutMs: 60_000,
    });
    assert(create.status === 201 && create.data?.event?.id, "broker_calendar_create_failed", create.data);
    const eventId = create.data.event.id;
    cleanup.calendarNoteIds.push(eventId);
    const list = await request(brokerUrl, `/api/mobile/calendar?date=${encodeURIComponent(todayKey)}`, {
      headers: authHeader(accessToken),
      timeoutMs: 60_000,
    });
    assert(list.ok && (list.data?.events || []).some((row) => row.id === eventId), "broker_calendar_list_missing_created_event", list.data);
    const update = await request(brokerUrl, `/api/mobile/calendar/${encodeURIComponent(eventId)}/update`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: { description: "updated by computer usability", status: "completed" },
      timeoutMs: 60_000,
    });
    assert(update.ok && update.data?.event?.status === "completed", "broker_calendar_update_failed", update.data);
    const del = await request(brokerUrl, `/api/mobile/calendar/${encodeURIComponent(eventId)}/delete`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: {},
      timeoutMs: 60_000,
    });
    assert(del.ok && del.data?.id === eventId, "broker_calendar_delete_failed", del.data);
    cleanup.calendarNoteIds = cleanup.calendarNoteIds.filter((id) => id !== eventId);
    return { eventId, durationMs: create.durationMs + list.durationMs + update.durationMs + del.durationMs, bytes: create.bytes + list.bytes + update.bytes + del.bytes };
  });

  await step("quick note transcript organize to markdown/html via public broker", async () => {
    const transcript = [
      `${marker} 手机端快速笔记`,
      "电脑端通过 CloudBase 公网模拟 Mate60 添加笔记。",
      "验收点:生成 Markdown 和 HTML,并能回到今日执行台。",
    ].join("\n");
    const create = await request(brokerUrl, "/api/mobile/voice-notes", {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        date: todayKey,
        title: `${marker} 快速笔记`,
        transcriptText: transcript,
        source: "speech_recognition",
        language: "zh-CN",
        durationSeconds: 18,
      },
      timeoutMs: 60_000,
    });
    assert(create.ok && create.data?.voiceNote?.id, "broker_voice_note_create_failed", create.data);
    const voiceNoteId = create.data.voiceNote.id;
    cleanup.voiceNoteIds.push(voiceNoteId);
    const organize = await request(brokerUrl, `/api/mobile/voice-notes/${encodeURIComponent(voiceNoteId)}/organize`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: {},
      timeoutMs: 90_000,
    });
    assert(organize.ok && organize.data?.markdownPath && organize.data?.htmlPath, "broker_voice_note_organize_failed", organize.data);
    cleanup.calendarNoteIds.push(organize.data.calendarNote.id);
    cleanup.knowledgeEntryIds.push(organize.data.knowledgeEntry.id);
    cleanup.documentRenderPaths.push(organize.data.markdownPath, organize.data.htmlPath);
    cleanup.generatedFiles.push(organize.data.markdownPath, organize.data.htmlPath);
    assert(fs.existsSync(organize.data.markdownPath), "organized_markdown_file_missing", organize.data);
    assert(fs.existsSync(organize.data.htmlPath), "organized_html_file_missing", organize.data);
    const list = await request(brokerUrl, `/api/mobile/voice-notes?date=${encodeURIComponent(todayKey)}`, {
      headers: authHeader(accessToken),
      timeoutMs: 60_000,
    });
    assert(list.ok && (list.data?.voiceNotes || []).some((row) => row.id === voiceNoteId && row.status === "organized"), "broker_voice_note_list_missing_organized", list.data);
    return {
      voiceNoteId,
      markdownPath: organize.data.markdownPath,
      htmlPath: organize.data.htmlPath,
      durationMs: create.durationMs + organize.durationMs + list.durationMs,
      bytes: create.bytes + organize.bytes + list.bytes,
    };
  });

  await step("auth refresh via public broker", async () => {
    const refresh = await request(brokerUrl, "/api/mobile/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      timeoutMs: 60_000,
    });
    assert(refresh.ok && refresh.data?.accessToken, "broker_refresh_failed", refresh.data);
    accessToken = refresh.data.accessToken;
    return { status: refresh.status, durationMs: refresh.durationMs, bytes: refresh.bytes };
  });

  await step("revoke test device via public broker", async () => {
    const revoke = await request(brokerUrl, `/api/mobile/devices/${encodeURIComponent(deviceId)}/revoke`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: {},
      timeoutMs: 60_000,
    });
    assert(revoke.ok && revoke.data?.device?.status === "revoked", "broker_device_revoke_failed", revoke.data);
    return { status: revoke.status, durationMs: revoke.durationMs, bytes: revoke.bytes };
  });

  console.log(JSON.stringify({
    ok: true,
    marker,
    localBaseUrl,
    brokerUrl,
    dbPath: cleanupDb ? dbPath : null,
    steps: stepRows,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      marker,
      error: err instanceof Error ? err.message : String(err),
      steps: stepRows,
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      for (const kbPath of cleanup.kbPaths) {
        const abs = path.join(kbVaultRoot, kbPath.replace(/^\/+/, ""));
        if (fs.existsSync(abs)) {
          try { fs.unlinkSync(abs); } catch { /* best effort */ }
        }
      }
      for (const generated of cleanup.generatedFiles) {
        if (generated && fs.existsSync(generated)) {
          try { fs.unlinkSync(generated); } catch { /* best effort */ }
        }
      }
      if (db) {
        const runCleanup = (sql, value) => {
          try {
            db.prepare(sql).run(value);
          } catch (error) {
            cleanup.failures.push({
              sql: sql.replace(/\s+/g, " ").trim(),
              value,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };
        for (const voiceNoteId of cleanup.voiceNoteIds) {
          runCleanup("DELETE FROM mobile_voice_notes WHERE id = ?", voiceNoteId);
        }
        for (const calendarNoteId of cleanup.calendarNoteIds) {
          runCleanup("DELETE FROM calendar_notes WHERE id = ?", calendarNoteId);
        }
        for (const knowledgeEntryId of cleanup.knowledgeEntryIds) {
          runCleanup("DELETE FROM knowledge_entries WHERE id = ?", knowledgeEntryId);
        }
        for (const filePath of cleanup.documentRenderPaths) {
          try {
            db.prepare("DELETE FROM document_renders WHERE source_path = ? OR html_path = ?").run(filePath, filePath);
          } catch (error) {
            cleanup.failures.push({
              sql: "DELETE FROM document_renders WHERE source_path = ? OR html_path = ?",
              value: filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        for (const deviceId of cleanup.deviceIds) {
          runCleanup("DELETE FROM mobile_device_tokens WHERE device_id = ?", deviceId);
          runCleanup("DELETE FROM mobile_devices WHERE id = ?", deviceId);
        }
        for (const pairingId of cleanup.pairingIds) {
          runCleanup("DELETE FROM mobile_pairing_challenges WHERE id = ?", pairingId);
        }
        for (const sessionHash of cleanup.sessionHashes) {
          runCleanup("DELETE FROM sessions WHERE token_hash = ?", sessionHash);
        }
      }
      if (cleanup.failures.length > 0) {
        console.warn(JSON.stringify({
          ok: true,
          warning: "cleanup_best_effort_failed",
          failures: cleanup.failures.slice(0, 12),
          truncated: cleanup.failures.length > 12,
        }, null, 2));
      }
    } finally {
      db?.close();
    }
  });
