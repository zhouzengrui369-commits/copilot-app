import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || process.env.OPENCLAW_PASSWORD || "123456";
const voiceRawRoot = process.env.OPENCLAW_VOICE_RAW_ROOT || path.join(process.cwd(), "memory/knowledge/notes/voice_raw");
const pollIntervalMs = Number(process.env.AUTO_VOICE_NOTE_POLL_INTERVAL_MS || 3000);
const maxPollRounds = Number(process.env.AUTO_VOICE_NOTE_MAX_POLLS || 240);
const requestTimeoutMs = Number(process.env.AUTO_VOICE_NOTE_REQUEST_TIMEOUT_MS || 120000);
const defaultFolder = process.env.AUTO_VOICE_NOTE_FOLDER || "calendar";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(input) {
  return String(input || "").replace(/\r\n/g, "\n").trim();
}

function parseFrontmatter(fileContent) {
  if (!fileContent.startsWith("---\n")) return { data: {}, body: fileContent };
  const endIndex = fileContent.indexOf("\n---", 4);
  if (endIndex < 0) return { data: {}, body: fileContent };
  const fm = fileContent.slice(4, endIndex).trim();
  const body = fileContent.slice(endIndex + 4).replace(/^\n/, "");
  const data = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (value === undefined) {
      data[key] = "";
      continue;
    }
    if (/^["']/.test(value)) {
      value = value.replace(/^["']|["']$/g, "");
    }
    if (value === "true" || value === "false") {
      data[key] = value === "true";
    } else if (/^\d+$/.test(value)) {
      data[key] = Number(value);
    } else if (value === "" || value === '""' || value === "''") {
      data[key] = "";
    } else {
      data[key] = value;
    }
  }
  return { data, body };
}

function dumpFrontmatter(data, body) {
  const fm = Object.entries(data)
    .map(([key, value]) => {
      if (typeof value === "boolean") return `${key}: ${value ? "true" : "false"}`;
      if (typeof value === "number") return `${key}: "${value}"`;
      if (value === undefined || value === null) return `${key}: ""`;
      return `${key}: "${String(value).replace(/"/g, '\\"')}"`;
    })
    .join("\n");
  return `---\n${fm}\n---\n${body.trimStart()}`;
}

function parseDate(raw) {
  const text = String(raw || "").trim();
  if (!text) return nowIso().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.replaceAll("/", "-").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return text.slice(0, 10);
  return nowIso().slice(0, 10);
}

function deriveTranscriptText(rawFilePath, body) {
  const marker = "## 原始转写";
  const idx = body.indexOf(marker);
  return normalizeText(idx >= 0 ? body.slice(idx + marker.length) : body);
}

function withTimeout(fetchPromise, url = "") {
  return Promise.race([
    fetchPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`fetch_timeout:${url}`)), requestTimeoutMs)),
  ]);
}

async function api(route, options = {}, cookie) {
  const res = await withTimeout(fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  }), `${route}`);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { raw: text };
    }
  }
  if (!res.ok || data.ok === false) {
    const message = data?.message || data?.error || text || `HTTP ${res.status}`;
    throw new Error(`${route} failed: ${res.status} ${message}`);
  }
  return data;
}

async function ensureLoginCookie() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`登录失败: ${res.status} ${text || "no body"}`);
  }
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("登录成功但未返回 Set-Cookie");
  const token = cookie.split(";")[0] || "";
  if (text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (data && data.ok === false) {
      throw new Error(`登录返回异常: ${text}`);
    }
  }
  return token;
}

async function createJob(cookie, payload) {
  return api("/api/knowledge/notes/organize-jobs", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { Cookie: cookie },
  }, cookie);
}

async function getJob(cookie, jobId) {
  return api(`/api/knowledge/notes/organize-jobs/${encodeURIComponent(jobId)}`, {
    headers: { Cookie: cookie },
  }, cookie);
}

function isSuccessPipeline(result = {}) {
  return (
    result && result.ok === true
    && result.draft?.markdown
    && result.htmlDraft?.html
    && Array.isArray(result.generationPipeline)
    && result.generationPipeline.includes("m3_obsidian_markdown")
    && result.generationPipeline.includes("m3_html_document")
  );
}

async function waitJob(cookie, jobId, filePath) {
  for (let i = 0; i < maxPollRounds; i += 1) {
    const status = await getJob(cookie, jobId);
    const job = status.job || {};
    const { status: state } = job;
    const phase = job.phase || "";
    const msg = job.message || "";
    console.log(`[${path.basename(filePath)}] job=${jobId} status=${state} phase=${phase} msg=${msg}`);
    if (state === "succeeded") return job;
    if (state === "failed" || state === "aborted") {
      return { ...job, failed: true };
    }
    const waitMs = i < 20 ? pollIntervalMs : Math.min(pollIntervalMs * 2, 10000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { failed: true, reason: "poll_timeout", message: "组织任务轮询超时" };
}

async function saveNote(cookie, sourceFile, jobResult, meta) {
  const draft = jobResult.draft || {};
  const htmlDraft = jobResult.htmlDraft || {};
  const payload = {
    rawContent: meta.rawContent,
    title: draft.title || meta.recordTitle,
    date: meta.date,
    type: draft.type || meta.type || "会议纪要",
    status: draft.status || "待跟进",
    tags: draft.tags || meta.tags || ["语音记录"],
    related: draft.related || meta.related || [],
    folder: draft.folder || defaultFolder,
    markdown: draft.markdown || "",
    layoutStrategy: jobResult.layoutStrategy || {},
    htmlDraft: {
      html: htmlDraft.html || "",
      sourceHash: htmlDraft.sourceHash || jobResult.sourceHash || meta.rawHash || "",
      fallbackReason: htmlDraft.fallbackReason || "",
      title: htmlDraft.title || draft.title || meta.recordTitle,
    },
    htmlQuality: jobResult.htmlQuality || { passed: false, score: 0, issues: ["missing_result"] },
    generationPipeline: jobResult.generationPipeline || [],
    htmlMode: "m3",
  };
  const saveRes = await api("/api/knowledge/notes", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { Cookie: cookie },
  }, cookie);
  return { saveRes, payload };
}

async function updateSourceMeta(filePath, currentMeta, patch) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const body = parsed.body || "";
  const merged = { ...parsed.data, ...patch };
  fs.writeFileSync(filePath, dumpFrontmatter(merged, body), "utf8");
}

function scanRawFiles() {
  if (!fs.existsSync(voiceRawRoot)) return [];
  const files = fs.readdirSync(voiceRawRoot, { recursive: false, withFileTypes: true });
  return files
    .filter((item) => item.isDirectory() ? false : item.name.endsWith(".md"))
    .map((item) => path.join(voiceRawRoot, item.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function buildPayload(meta, bodyText) {
  const baseTitle = meta.record_title || meta.recordTitle || meta.title || "语音记录";
  const date = parseDate(meta.recorded_at || meta.recordedAt || meta.captured_at || meta.capturedAt);
  return {
    rawContent: bodyText,
    title: baseTitle,
    date,
    folder: defaultFolder,
    type: "会议纪要",
    status: "进行中",
    qualityMode: "m3-html",
    htmlMode: "m3",
    agentId: "worker",
    gatewayTimeoutMs: 330000,
    tags: ["语音记录", "自动入库", "元宝"],
    related: [],
  };
}

async function processFile(cookie, filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const status = String(data.status || "");
  if (status === "saved") {
    console.log(`[${path.basename(filePath)}] skip: status already saved`);
    return { filePath, skipped: true };
  }
  const bodyText = deriveTranscriptText(filePath, body);
  const rawHash = data.transcript_hash || crypto.createHash("sha256").update(bodyText).digest("hex");
  const payload = buildPayload(data, bodyText);
  const meta = {
    rawHash,
    rawContent: bodyText,
    recordTitle: data.record_title || data.recordTitle || payload.title,
    date: payload.date,
    type: payload.type,
    tags: payload.tags || [],
    related: payload.related || [],
  };
  const createRes = await createJob(cookie, payload);
  const job = createRes.job || {};
  await updateSourceMeta(filePath, data, {
    status: "organizing",
    organize_job_id: job.id || createRes.jobId || "",
    organize_failure_stage: "",
    organize_failure_reason: "",
    latest_gateway_status: "in_progress",
  });
  const jobResult = await waitJob(cookie, job.id, filePath);
  if (jobResult.failed) {
    await updateSourceMeta(filePath, data, {
      status: "gateway_unavailable",
      organize_job_id: job.id || "",
      organize_failure_stage: String(jobResult.failure?.stage || jobResult.stage || "knowledge_note_background_wait"),
      organize_failure_reason: String(jobResult.failure?.reason || jobResult.reason || jobResult.message || "unknown"),
      latest_gateway_status: "unavailable",
    });
    return { filePath, failed: true, reason: jobResult.reason || jobResult.message };
  }
  if (!isSuccessPipeline(jobResult.result || jobResult)) {
    await updateSourceMeta(filePath, data, {
      status: "gateway_unavailable",
      organize_failure_reason: "result_missing_markdown_html_or_pipeline",
      latest_gateway_status: "invalid_result",
    });
    return { filePath, failed: true, reason: "result_missing_markdown_html_or_pipeline" };
  }
  const organized = jobResult.result || {};
  const saveRes = await saveNote(cookie, filePath, organized, meta);
  await updateSourceMeta(filePath, data, {
    status: "saved",
    organize_job_id: job.id || "",
    organize_failure_stage: "",
    organize_failure_reason: "",
    latest_gateway_status: "ok",
    organize_saved_at: nowIso(),
    knowledge_note_path: saveRes.saveRes.note?.path || "",
    knowledge_html_path: saveRes.saveRes.note?.htmlPath || "",
    knowledge_entry_id: saveRes.saveRes.note?.entryId || "",
  });
  return { filePath, saved: true, note: saveRes.saveRes.note, jobId: job.id };
}

async function main() {
  const targets = process.argv.slice(2).filter(Boolean);
  const files = targets.length
    ? targets
    : scanRawFiles();
  if (!files.length) {
    console.log("未发现待处理 voice_raw 文件");
    return;
  }
  const cookie = await ensureLoginCookie();
  const targetFiles = files.filter((file) => file.endsWith(".md"));
  const results = [];
  for (const filePath of targetFiles) {
    try {
      console.log(`\n开始处理：${filePath}`);
      const result = await processFile(cookie, filePath);
      results.push(result);
      if (!result.failed) await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`处理失败：${filePath} -> ${err.message}`);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = parseFrontmatter(raw);
        await updateSourceMeta(filePath, parsed.data, {
          status: "gateway_unavailable",
          latest_gateway_status: "error",
          organize_failure_reason: err.message,
        });
      } catch {}
      results.push({ filePath, failed: true, reason: err.message });
    }
  }
  const saved = results.filter((item) => item?.saved).length;
  const failed = results.filter((item) => item?.failed).length;
  const skipped = results.filter((item) => item?.skipped).length;
  console.log(`\n处理完成：成功=${saved} 失败=${failed} 跳过=${skipped}`);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
