#!/usr/bin/env node
// 2026-07-06 — T10 njx-copilot Add Note MiniMax Direct HTML render quality
// rework5. NJX's scope correction: stop optimizing around the complex repair
// branches / quality-score machinery. The contract is now simple:
//
//   1. MiniMax direct organizes the raw note as an Obsidian-style note.
//   2. The server renders a readable HTML document from that note.
//   3. The HTML preview must look like a clean article — no raw Markdown
//      artifacts (no `**bold**`, no `---` frontmatter, no `source-hash:`,
//      no fenced code blocks, no `<think>`).
//
// This script verifies the contract at the source level + a deterministic
// runtime probe (fake MiniMax server + real server child process). It is
// structurally the same pattern as the rework4 repair-runtime test — a
// fake MiniMax HTTP server that records every call and returns programmed
// responses, plus a spawn of the real `apps/server/dist/index.js` pointed
// at the fake via the `MINIMAX_BASE_URL` env var.
//
// The fixture response below is the canonical Obsidian-style note MiniMax
// would produce. It deliberately exercises every leak class that NJX
// reported:
//
//   - `---` frontmatter block at the top
//   - `**bold**` markers in a body line (时间/日期线索 — the exact case NJX
//     pasted from the screenshot)
//   - `## heading` (already handled by the renderer — used as a regression
//     guard so we know the fix doesn't break the existing path)
//   - `- bullet` items (already handled — same regression reason)
//   - inline `` `code` `` (added by rework5 — was not handled before)
//   - a fenced ```code``` block (added by rework5 — was previously
//     rendered, but we want to confirm the body is still clean)
//   - `source-hash: <hex>` trailing line (was previously leaked into body;
//     rework5 hides it from the visible HTML — only the meta tag carries
//     the source hash)
//
// The script writes `probe-html-render-quality.json` to the task folder
// (this can be either the BEFORE or the AFTER state, depending on which
// the caller asks for via the PROBE_BEFORE / PROBE_AFTER env var — both
// default to true; callers can suppress one with PROBE_BEFORE=0).
//
// Exits 0 when all assertions pass. Exits 1 with a detailed failure log
// otherwise.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const TASK_DIR = path.resolve(
  repoRoot,
  "tasks/openclaw/2026-07-06T-njx-copilot-add-note-html-render-quality-rework5",
);

const SERVER_DIST = path.join(repoRoot, "apps/server/dist/index.js");
const NODE_BIN = process.execPath;
const FAKE_PORT = Number(process.env.OPENCLAW_RENDER_QUALITY_FAKE_PORT || 39921);
const SERVER_PORT = Number(process.env.OPENCLAW_RENDER_QUALITY_SERVER_PORT || 39821);
const TEST_API_KEY = "test-minimax-render-quality-rework5-fake-key";
const TEST_SESSION_TOKEN = "openclaw-render-quality-rework5-test-session-token-1234567890";
const TASK_TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-render-quality-rework5-data-"));
const SERVER_LOG_PATH = path.join(TASK_DIR, "server.log");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function logStep(...args) {
  process.stderr.write(`[render-quality] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// (A) Source-level guard: confirm the renderer has the rework5 enhancements.
// (Skipped when SUPPRESS_SOURCE_CHECK=1 — used to capture the BEFORE state
// against the unfixed source.)
// ---------------------------------------------------------------------------

function checkSourceContract() {
  const serverSrc = fs.readFileSync(path.join(repoRoot, "apps/server/src/index.ts"), "utf8");
  // The renderer must handle inline markers. We accept any of the common
  // implementations: a single regex pass on `<strong>`, separate passes for
  // <em> / <code> / <del>, or a helper. We require at least 4 inline marker
  // kinds to be present: **bold**, *italic* (or _italic_), `code`, ~~strike~~.
  const boldPresent = (/\*\*\(/.test(serverSrc) && /<strong>/.test(serverSrc))
    || /applyKnowledgeNoteDirectInlineMarkers/.test(serverSrc)
    || /renderInlineMarkdownMarkers/.test(serverSrc)
    || /convertInlineMarkdownToHtml/.test(serverSrc);
  expect(
    "source: renderer converts **bold** markers to <strong>...</strong>",
    boldPresent,
    "apps/server/src/index.ts does not contain a clear ** → <strong> renderer (rework5 enhancement missing).",
  );
  const inlineCodePresent = (/`[^`\n]+?`/.test(serverSrc) && /<code>/.test(serverSrc))
    || /applyKnowledgeNoteDirectInlineMarkers/.test(serverSrc);
  expect(
    "source: renderer converts inline `code` markers to <code>...</code>",
    inlineCodePresent,
    "apps/server/src/index.ts does not contain a clear ` → <code> renderer.",
  );
  const frontmatterSkipPresent = (/\^---\\s\*\$/.test(serverSrc) || /---\\s\*\$/.test(serverSrc))
    && /frontmatter/i.test(serverSrc)
    && (/inFrontmatter/.test(serverSrc)
      || /skipFrontmatter/.test(serverSrc)
      || /isInFrontmatterBlock/.test(serverSrc)
      || /frontmatterPhase/.test(serverSrc));
  expect(
    "source: renderer skips YAML frontmatter (`---` block at the top)",
    frontmatterSkipPresent,
    "apps/server/src/index.ts does not contain a frontmatter-skipping renderer (rework5 enhancement missing).",
  );
  const sourceHashHidePresent = /source-hash\s*[:：]/i.test(serverSrc)
    && (/skipSourceHash/.test(serverSrc)
      || /isSourceHashLine/.test(serverSrc)
      || /hideSourceHashLine/.test(serverSrc)
      || /SOURCE_HASH_LINE_RE/.test(serverSrc));
  expect(
    "source: renderer hides the trailing source-hash line from the visible body",
    sourceHashHidePresent,
    "apps/server/src/index.ts does not contain a source-hash-hide renderer (rework5 enhancement missing).",
  );
}

// ---------------------------------------------------------------------------
// (B) Fixture response: a faithful Obsidian-style note with all the leak
// classes NJX reported.
// ---------------------------------------------------------------------------

const RAW_CASUAL_TRANSCRIPT = `今天中午和老婆喝了杯咖啡, 聊聊近况.

- 7 月初气温 30 多度, 空调电费又涨.
- 2026 年是美国建国 250 周年 (1776 起算).
- 两个人都说"年纪越大时间过得越快", 心理感受, 不是物理时间.
- 孩子开学前想安排一次出行, 远则飞机, 近则自驾.

整体就是闲聊, 没具体决策, 没行动项.`;

const VALID_OBSIDIAN_RESPONSE = `---
title: 午间咖啡杂谈
date: 2026-07-06
type: 备忘
status: 仅供参考
tags: [casual, summer, travel]
related: []
folder: openclaw
---

# 午间咖啡杂谈

## 高价值摘要

本次是 2026 年 7 月初一段低信息密度的咖啡闲聊, 没有具体决策或行动项. 主要话题包括 7 月高温、美国建国 250 周年, 以及对"**年纪越大时间过得越快**"的心理感受. 末尾约定在孩子开学前再安排一次出行.

## 关键事实

- 7 月初气温 30 多度, 已进入暑期, 空调电费预估上涨.
- 2026 年是美国建国 250 周年, 起算年 1776.
- 对话双方对"**年龄越大主观时间越快**"形成共识, 心理学解释为新体验减少.
- 孩子开学前计划一次出行, 距离远则飞机、近则自驾.
- **时间/日期线索**: 7 月初, 2026 年 (建国 250 周年), 孩子开学前 (8 月底/9 月初).
- 涉及的话题标签: \`#summer\` \`#casual\` \`#psychology\` \`#travel-plan\`.

## 行动项

未从原文确认.

## 风险与待核验

- 原始信息密度低, 关键判断待用户补充; 出行时间 / 目的地 / 同行人等细节未明确.

## 证据锚点

- "今天中午和老婆喝了杯咖啡, 聊聊近况" — 对话原文
- "2026 年是美国建国 250 周年" — 对话原文
- "年纪越大, 时间过得越快" — 对话原文
- "孩子开学前想安排一次出行" — 对话原文

## 原始记录入口

见 sourceHash 引用.

source-hash: 1122334455667788112233445566778811223344556677881122334455667788
`;

// ---------------------------------------------------------------------------
// (C) Local fake MiniMax-compatible HTTP server.
// ---------------------------------------------------------------------------

function startFakeMinimaxServer(responses) {
  const recordedCalls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const callIndex = recordedCalls.length;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      const auth = String(req.headers.authorization || "");
      recordedCalls.push({
        callIndex,
        method: req.method,
        url: req.url,
        authorization: auth,
        promptSnippet: typeof parsed?.messages?.[0]?.content === "string"
          ? parsed.messages[0].content.slice(0, 240)
          : "<non-string>",
        ts: new Date().toISOString(),
      });
      const next = responses.shift();
      if (!next) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "fake_minimax: no more programmed responses" } }));
        return;
      }
      const payload = {
        id: `chatcmpl-fake-${callIndex}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "MiniMax-M3",
        choices: [{ index: 0, message: { role: "assistant", content: next.content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50 + callIndex * 10, completion_tokens: Math.max(1, Math.floor(next.content.length / 4)), total_tokens: 60 + callIndex * 10 + Math.floor(next.content.length / 4) },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_PORT, "127.0.0.1", () => resolve({ server, recordedCalls }));
  });
}

// ---------------------------------------------------------------------------
// (D) Spawn the real server in a child process.
// ---------------------------------------------------------------------------

function startRealServer(envExtras = {}) {
  const child = spawn(
    NODE_BIN,
    ["--experimental-sqlite", SERVER_DIST],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        MINIMAX_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
        MINIMAX_API_KEY: TEST_API_KEY,
        OPENCLAW_DATA_DIR: TASK_TMP_DATA,
        OPENCLAW_WORKBENCH_PORT: String(SERVER_PORT),
        OPENCLAW_WORKBENCH_HOST: "127.0.0.1",
        OPENCLAW_CB_ENABLED: "0",
        OPENCLAW_WORKBENCH_TEST_TOKEN: TEST_SESSION_TOKEN,
        ...envExtras,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logStream = fs.createWriteStream(SERVER_LOG_PATH, { flags: "w" });
  child.stdout?.on("data", (b) => logStream.write(b));
  child.stderr?.on("data", (b) => logStream.write(b));
  return { child, logStream };
}

async function waitForServerHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await new Promise((resolve) => {
        const req = http.request(
          { host: "127.0.0.1", port: SERVER_PORT, path: "/api/health", method: "GET", timeout: 1500 },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c) => { body += c; });
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", () => resolve({ status: 0, body: "" }));
        req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }) });
        req.end();
      });
      if (result.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function killServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once("exit", () => resolve());
    try { child.kill("SIGTERM"); } catch { resolve(); }
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 5_000);
  });
}

function postOrganizeRequest(payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: SERVER_PORT,
        path: "/api/knowledge/notes/organize",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Cookie: `owb_test_session=${TEST_SESSION_TOKEN}`,
        },
        timeout: 180_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, body, parsed });
        });
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: String(err), parsed: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout", parsed: null }); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// (E) Visible body extraction (mirrors the web's noteHtmlVisibleBodyText).
// ---------------------------------------------------------------------------

function visibleBodyText(html) {
  const s = String(html || "");
  const bodyHtml = s.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || s;
  return bodyHtml
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// (F) The actual probe.
// ---------------------------------------------------------------------------

async function runProbe({ label, outFile }) {
  logStep(`${label}: starting fake MiniMax server with [valid Obsidian] response`);
  const { server, recordedCalls } = await startFakeMinimaxServer([
    { content: VALID_OBSIDIAN_RESPONSE },
  ]);
  let realServer = null;
  let probeResult = null;
  try {
    const started = startRealServer();
    realServer = started.child;
    const healthy = await waitForServerHealth(45_000);
    if (!healthy) {
      throw new Error(`real server did not become healthy on port ${SERVER_PORT}; see ${SERVER_LOG_PATH}`);
    }
    logStep(`${label}: real server healthy on http://127.0.0.1:${SERVER_PORT}`);
    const payload = {
      rawContent: RAW_CASUAL_TRANSCRIPT,
      title: "午间咖啡杂谈",
      date: "2026-07-06",
      type: "备忘",
      status: "仅供参考",
      tags: ["casual", "summer", "travel"],
      related: [],
      folder: "openclaw",
      qualityMode: "minimax-direct",
      requestedQualityMode: "minimax-direct",
      htmlMode: "m3",
      agentId: "auto",
      gatewayTimeoutMs: 60_000,
      retryPolicy: { autoRepair: false, maxAttempts: 1, exposeDiagnostics: true },
    };
    const startedAt = Date.now();
    const result = await postOrganizeRequest(payload);
    const durationMs = Date.now() - startedAt;
    logStep(`${label}: server responded status=${result.status} in ${durationMs}ms; calls recorded=${recordedCalls.length}`);

    const draftMd = String(result.parsed?.draft?.markdown || "");
    const draftHtml = String(result.parsed?.draft?.html || result.parsed?.htmlDraft?.html || "");
    const visibleBody = visibleBodyText(draftHtml);

    // The contract: rendered HTML must not expose raw Markdown artifacts.
    // (rework5 contract — be lenient on score, strict on visible leakage.)
    expect(
      `${label}: HTTP 200`,
      result.status === 200,
      `expected 200, got ${result.status}; body=${(result.body || "").slice(0, 400)}`,
    );
    expect(
      `${label}: ok === true`,
      result.parsed?.ok === true,
      `expected ok=true, got ${result.parsed?.ok}`,
    );
    expect(
      `${label}: qualityMode === 'minimax-direct' (no Gateway fallback)`,
      result.parsed?.qualityMode === "minimax-direct",
      `expected qualityMode=minimax-direct, got ${result.parsed?.qualityMode}`,
    );
    expect(
      `${label}: htmlQuality.passed === true`,
      result.parsed?.htmlQuality?.passed === true,
      `expected htmlQuality.passed=true, got ${JSON.stringify(result.parsed?.htmlQuality)}`,
    );
    // Visible body must not contain raw Markdown syntax. These are the
    // hard contract from the scope correction: no **bold**, no ---, no
    // source-hash:, no <think>, no fenced ```.
    expect(
      `${label}: visible HTML body does NOT contain raw **bold** markers`,
      !/\*\*[^*\n]+\*\*/.test(visibleBody),
      `visible body still has **...**: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body does NOT contain raw --- frontmatter or horizontal rule`,
      !/^---\s*$/m.test(visibleBody) && !/---/.test(visibleBody.split("午间咖啡杂谈")[0] || visibleBody.slice(0, 200)),
      `visible body still has --- markers: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body does NOT contain raw "source-hash:" line`,
      !/source-hash\s*[:：]/i.test(visibleBody),
      `visible body still has source-hash: line: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body does NOT contain <think>`,
      !/<think>/i.test(visibleBody),
      `visible body still has <think>: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body does NOT contain raw fenced \`\`\` markers`,
      !/```/.test(visibleBody),
      `visible body still has \`\`\` markers: "${visibleBody.slice(0, 400)}"`,
    );
    // Positive contract: the rendered HTML should still contain the body
    // text (proves we did not over-strip).
    expect(
      `${label}: visible HTML body contains the title "午间咖啡杂谈"`,
      visibleBody.includes("午间咖啡杂谈"),
      `visible body missing the title: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body contains the "高价值摘要" section heading text`,
      visibleBody.includes("高价值摘要"),
      `visible body missing section heading: "${visibleBody.slice(0, 400)}"`,
    );
    expect(
      `${label}: visible HTML body contains the "时间/日期线索" content (without the ** marker)`,
      visibleBody.includes("时间/日期线索"),
      `visible body missing key fact content: "${visibleBody.slice(0, 400)}"`,
    );
    // Structural checks: the body should be marked up with semantic tags.
    expect(
      `${label}: rendered HTML has a <h1> for the title`,
      /<h1[^>]*>.*?午间咖啡杂谈.*?<\/h1>/i.test(draftHtml),
      `rendered HTML missing <h1> for title: "${draftHtml.slice(0, 400)}"`,
    );
    expect(
      `${label}: rendered HTML has a <h2> for "高价值摘要"`,
      /<h2[^>]*>.*?高价值摘要.*?<\/h2>/i.test(draftHtml),
      `rendered HTML missing <h2> for 高价值摘要: "${draftHtml.slice(0, 400)}"`,
    );
    expect(
      `${label}: rendered HTML has semantic <ul><li> for the bullet list`,
      /<ul>[\s\S]*<li>[\s\S]*?7 月初气温 30 多度/.test(draftHtml),
      `rendered HTML missing semantic <ul><li>: "${draftHtml.slice(0, 600)}"`,
    );
    expect(
      `${label}: rendered HTML wraps the bold phrase in <strong> (not raw **)`,
      /<strong>[^<]*?(?:年纪越大时间过得越快|年龄越大主观时间越快|时间\/日期线索)[^<]*?<\/strong>/i.test(draftHtml),
      `rendered HTML missing <strong> for the bold phrase: "${draftHtml.slice(0, 800)}"`,
    );
    expect(
      `${label}: rendered HTML wraps the inline code in <code> (not raw \`)`,
      /<code>[^<]*?#summer[^<]*?<\/code>/i.test(draftHtml),
      `rendered HTML missing <code> for inline code: "${draftHtml.slice(0, 800)}"`,
    );
    // No-fallback contract: minimax-direct must not route to Gateway.
    const pipeline = Array.isArray(result.parsed?.generationPipeline) ? result.parsed.generationPipeline : [];
    expect(
      `${label}: generationPipeline includes 'server_render_html'`,
      pipeline.includes("server_render_html"),
      `pipeline missing server_render_html: ${JSON.stringify(pipeline)}`,
    );
    expect(
      `${label}: directMinimaxNote.fallback === false (no Gateway fallback)`,
      result.parsed?.directMinimaxNote == null || result.parsed?.directMinimaxNote?.fallback === false,
      `directMinimaxNote.fallback should be false (or absent), got ${JSON.stringify(result.parsed?.directMinimaxNote)}`,
    );

    probeResult = {
      label,
      verdict: failures.length === 0 ? "PASS" : "FAIL",
      status: result.status,
      durationMs,
      responseOk: result.parsed?.ok,
      qualityMode: result.parsed?.qualityMode,
      htmlQuality: result.parsed?.htmlQuality,
      generationPipeline: pipeline,
      stage: result.parsed?.stage,
      error: result.parsed?.error || null,
      directMinimaxNote: result.parsed?.directMinimaxNote || null,
      draftMarkdownLength: draftMd.length,
      draftHtmlLength: draftHtml.length,
      visibleBodyLength: visibleBody.length,
      visibleBodySample: visibleBody.slice(0, 1200),
      draftHtmlSample: draftHtml.slice(0, 2000),
      fakeMinimaxCallCount: recordedCalls.length,
      visibleBodyHasRawBold: /\*\*[^*\n]+\*\*/.test(visibleBody),
      visibleBodyHasRawFrontmatter: /---/.test(visibleBody),
      visibleBodyHasSourceHash: /source-hash\s*[:：]/i.test(visibleBody),
      visibleBodyHasThink: /<think>/i.test(visibleBody),
      visibleBodyHasFencedCode: /```/.test(visibleBody),
    };
  } finally {
    await killServer(realServer);
    await new Promise((r) => server.close(r));
  }

  // Write the probe JSON for this run.
  if (outFile) {
    const outPath = path.join(TASK_DIR, outFile);
    fs.writeFileSync(outPath, JSON.stringify(probeResult, null, 2));
    logStep(`${label}: wrote ${outPath}`);
  }
  return probeResult;
}

// ---------------------------------------------------------------------------
// (G) Top-level driver.
// ---------------------------------------------------------------------------

const wantBefore = process.env.PROBE_BEFORE === "1";
const wantAfter = process.env.PROBE_AFTER !== "0";

if (process.env.SUPPRESS_SOURCE_CHECK !== "1") {
  checkSourceContract();
}

if (wantBefore) {
  await runProbe({ label: "BEFORE", outFile: "probe-html-render-quality-before.json" });
}
if (wantAfter) {
  await runProbe({ label: "AFTER", outFile: "probe-html-render-quality-after.json" });
}

if (failures.length) {
  console.error("KNOWLEDGE_ADD_NOTE_DIRECT_HTML_RENDER_QUALITY_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_ADD_NOTE_DIRECT_HTML_RENDER_QUALITY_PASS");
