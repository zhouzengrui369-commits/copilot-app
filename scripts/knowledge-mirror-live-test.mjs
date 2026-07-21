import crypto from "node:crypto";
import fs from "node:fs";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || "";
const marker = `OPENCLAW_MIRROR_LIVE_${Date.now()}`;

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

function htmlFor(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;line-height:1.75;margin:32px;color:#172033;background:#fff}
    main{max-width:880px;margin:auto}
    h1{font-size:28px}
    .card{border:1px solid #d8dee9;border-radius:8px;padding:16px;margin:14px 0}
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <section class="card"><h2>验收结论</h2><p>${body}</p></section>
    <section class="card"><h2>证据</h2><p>该笔记用于验证 Workbench 添加笔记链路可以触发 NAS mirror hook。</p></section>
    <section class="card"><h2>下一步</h2><p>若 mirrorPath 存在且文件可读，则 A2 live path 验收通过。</p></section>
  </main>
</body>
</html>`;
}

async function authCookie() {
  const health = await request("/api/health");
  assert(health.res.ok && health.data?.ok, "health_failed", health.data);
  if (!password && health.data?.setupRequired !== false) {
    throw new Error("OPENCLAW_WORKBENCH_PASSWORD_REQUIRED");
  }
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

async function main() {
  if (!password) throw new Error("OPENCLAW_WORKBENCH_PASSWORD_REQUIRED");
  const cookie = await authCookie();
  const today = new Date().toISOString().slice(0, 10);
  const title = `${marker} 知识库镜像验收`;
  const rawContent = [
    `# ${title}`,
    "",
    `marker: ${marker}`,
    "目的：验证 Workbench 添加笔记写入 workspace 后，NAS mirror hook 在同一请求中写出 mirrorPath。",
    "验收：响应 note.mirrorStatus 为 mirrored/renamed/skipped，mirrorPath 在 NAS 下且文件存在。",
    "边界：这是受控验收笔记，不删除源、不回写 NAS 原始文件。",
  ].join("\n");
  const html = htmlFor(title, `验收标记 ${marker} 已写入。`);
  const sourceHash = crypto.createHash("sha256").update(rawContent).digest("hex");
  const create = await request("/api/knowledge/notes", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({
      title,
      date: today,
      type: "工作记录",
      status: "待归档",
      tags: ["copilot-mirror-live-test", "验收"],
      related: [],
      folder: "daily",
      rawContent,
      markdown: rawContent,
      layoutStrategy: { template: "acceptance" },
      htmlDraft: { html, title, sourceHash },
      htmlQuality: { score: 100, passed: true, issues: [] },
      generationPipeline: ["codex_pm_live_acceptance"],
      htmlMode: "acceptance",
    }),
  });
  assert(create.res.ok && create.data?.ok, "note_create_failed", { status: create.res.status, data: create.data });
  const note = create.data.note || {};
  const mirrorPath = String(note.mirrorPath || "");
  const sourcePath = String(note.path || "");
  assert(sourcePath && fs.existsSync(sourcePath), "source_note_missing", { sourcePath });
  assert(mirrorPath && mirrorPath.startsWith("/Volumes/南极熊/07知识库/copilot_knowledge_mirror/"), "mirror_path_invalid", note);
  assert(fs.existsSync(mirrorPath), "mirror_file_missing", { mirrorPath, note });
  const mirrorText = fs.readFileSync(mirrorPath, "utf-8");
  assert(mirrorText.includes(marker), "mirror_marker_missing", { mirrorPath });
  console.log(JSON.stringify({
    ok: true,
    marker,
    sourcePath,
    htmlPath: note.htmlPath,
    mirrorPath,
    mirrorStatus: note.mirrorStatus,
    mirrorError: note.mirrorError,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
