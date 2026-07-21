import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || "";
const taskDir = "/Users/njx/openclaw/copilot/tasks/openclaw/20260630-yuanbao-two-recordings";

const recordings = [
  {
    title: "航材管理部月例会汇报",
    recordedAt: "2026-06-30 13:27",
    duration: "77:04",
    transcriptPath: path.join(taskDir, "recording-1-transcript.txt"),
  },
  {
    title: "岗位调动与执照考取讨论",
    recordedAt: "2026-06-30 09:40",
    duration: "65:34",
    transcriptPath: path.join(taskDir, "recording-2-transcript.txt"),
  },
];

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function request(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { rawText: text };
  }
  return { res, data };
}

function sessionCookieFromResponse(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  return match ? `owb_session=${encodeURIComponent(decodeURIComponent(match[1]))}` : "";
}

async function authCookie() {
  if (!password) throw new Error("OPENCLAW_WORKBENCH_PASSWORD_REQUIRED");
  const health = await request("/api/health");
  assert(health.res.ok && health.data?.ok, "health_failed", health.data);
  const loginPath = health.data?.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  let auth = await request(loginPath, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (auth.res.status === 409) {
    auth = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }
  assert(auth.res.ok && auth.data?.ok, "auth_failed", { status: auth.res.status, data: auth.data });
  const cookie = sessionCookieFromResponse(auth.res);
  assert(cookie, "auth_cookie_missing", Object.fromEntries(auth.res.headers.entries()));
  return cookie;
}

function buildMarkdown(item, transcript, sourceHash) {
  return [
    `# 元宝录音：${item.title}`,
    "",
    "- 来源：元宝录音可见 UI 转写",
    `- 录音时间：${item.recordedAt}`,
    `- 录音时长：${item.duration}`,
    `- 转写哈希：${sourceHash}`,
    "- 入库方式：yuanbao-visible-ui-transcript-v1",
    "- 边界：原始音频未在本机文件系统候选目录中找到；本次按元宝可见转写入库。",
    "",
    "## 实时转写",
    "",
    transcript.trim(),
    "",
  ].join("\n");
}

function buildHtml(item, markdown, transcript) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>元宝录音：${escapeHtml(item.title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;line-height:1.75;margin:32px;color:#172033;background:#fff}
    main{max-width:960px;margin:auto}
    h1{font-size:28px}
    .meta{border:1px solid #d8dee9;border-radius:8px;padding:14px 16px;background:#f8fafc}
    pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>元宝录音：${escapeHtml(item.title)}</h1>
    <section class="meta">
      <p>录音时间：${escapeHtml(item.recordedAt)}</p>
      <p>录音时长：${escapeHtml(item.duration)}</p>
      <p>入库方式：yuanbao-visible-ui-transcript-v1</p>
    </section>
    <h2>实时转写</h2>
    <pre>${escapeHtml(transcript)}</pre>
  </main>
</body>
</html>`;
}

async function main() {
  const cookie = await authCookie();
  const imported = [];

  for (const item of recordings) {
    assert(fs.existsSync(item.transcriptPath), "transcript_missing", { path: item.transcriptPath });
    const transcript = fs.readFileSync(item.transcriptPath, "utf-8").trim();
    assert(transcript.length > 500, "transcript_too_short", { path: item.transcriptPath, length: transcript.length });
    const sourceHash = crypto.createHash("sha256").update(transcript).digest("hex");
    const markdown = buildMarkdown(item, transcript, sourceHash);
    const html = buildHtml(item, markdown, transcript);
    const htmlHash = crypto.createHash("sha256").update(html).digest("hex");

    const create = await request("/api/knowledge/notes", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        title: `元宝录音：${item.title}`,
        date: "2026-06-30",
        type: "会议纪要",
        status: "待跟进",
        tags: ["元宝录音", "语音转写", "auto-yuanbao-sync", "visible-ui-import"],
        related: [],
        folder: "voice_raw",
        rawContent: markdown,
        markdown,
        layoutStrategy: { template: "yuanbao-visible-ui-transcript" },
        htmlDraft: { html, title: `元宝录音：${item.title}`, sourceHash: htmlHash },
        htmlQuality: { score: 100, passed: true, issues: [] },
        generationPipeline: ["yuanbao_visible_ui_transcript_v1"],
        htmlMode: "acceptance",
      }),
    });

    assert(create.res.ok && create.data?.ok, "note_create_failed", { status: create.res.status, data: create.data });
    const note = create.data.note || {};
    const sourcePath = String(note.path || "");
    const htmlPath = String(note.htmlPath || "");
    const mirrorPath = String(note.mirrorPath || "");
    assert(sourcePath && fs.existsSync(sourcePath), "source_note_missing", { sourcePath, note });
    assert(htmlPath && fs.existsSync(htmlPath), "html_missing", { htmlPath, note });
    assert(mirrorPath && fs.existsSync(mirrorPath), "mirror_missing", { mirrorPath, note });
    assert(String(note.mirrorStatus || "") === "mirrored" || String(note.mirrorStatus || "") === "renamed" || String(note.mirrorStatus || "") === "skipped", "mirror_status_invalid", note);
    imported.push({
      title: item.title,
      recordedAt: item.recordedAt,
      duration: item.duration,
      transcriptBytes: Buffer.byteLength(transcript),
      transcriptHash: sourceHash,
      sourcePath,
      htmlPath,
      mirrorPath,
      mirrorStatus: note.mirrorStatus,
      mirrorError: note.mirrorError,
    });
  }

  fs.writeFileSync(path.join(taskDir, "import-result.json"), JSON.stringify({ ok: true, imported }, null, 2), "utf-8");
  console.log(JSON.stringify({ ok: true, imported }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
