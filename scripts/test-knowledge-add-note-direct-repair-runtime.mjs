#!/usr/bin/env node
// 2026-07-06 — T10 njx-copilot Add Note MiniMax Direct empty-after-clean repair
// integration test (rework4).
//
// NJX rejected the rework3 evidence because its runtime probes (against the
// real MiniMax-M3 model) always returned a valid Obsidian Markdown alongside
// the `<think>` block. So the first direct call passed after sanitization and
// the bounded repair retry was never triggered in production probes
// (`repaired:false` was honest, but it was the wrong test). The only way to
// deterministically force the "first response is think-only" failure mode is
// to swap MiniMax-M3 for a fake MiniMax-compatible HTTP server that returns
// the exact responses we want, in the exact order we want.
//
// This script:
//
//   1. Starts a local fake MiniMax-compatible HTTP server (Node's built-in
//      `http`). The fake server records every incoming `POST /chat/completions`
//      request and returns a programmed response. It speaks the same
//      `OpenAI /chat/completions` JSON shape that `directMinimaxM3Call` in
//      `apps/server/src/index.ts:8505` consumes.
//   2. Sets `process.env.MINIMAX_BASE_URL` to the fake server URL and
//      `process.env.MINIMAX_API_KEY` to a fake test key. These env vars are
//      read by the real server's `resolveMinimaxM3BaseUrl()` (line 8067) and
//      `resolveMinimaxM3ApiKey()` (line 8104) — highest-priority override
//      above `model_configs` and the hard-coded `https://api.minimaxi.com/v1`
//      default. No production semantics change.
//   3. Spawns the real server (`node apps/server/dist/index.js`) in a child
//      process with `OPENCLAW_DATA_DIR` pointing to a temp dir (so we don't
//      pollute the user's real DB) and `OPENCLAW_WORKBENCH_PORT` on a
//      dedicated port (39777).
//   4. POSTs the real `/api/knowledge/notes/organize` request with
//      `qualityMode: "minimax-direct"` and the real `午间咖啡杂谈` rawContent.
//   5. Asserts: HTTP 200, ok=true, htmlQuality.passed=true, htmlQuality.repaired=true,
//      qualityMode=minimax-direct, generationPipeline includes the
//      `minimax_direct_markdown_empty_after_clean` +
//      `minimax_direct_markdown_repair` markers, no `minimax_direct_failed_no_fallback`,
//      no `<think>` / `Let me analyze` leak in draft.markdown / draft.html,
//      exactly 2 calls recorded at the fake server.
//   6. Repeats with the negative case: 1st response think-only, 2nd response
//      ALSO think-only. Asserts: HTTP 422, error=blocked_minimax_direct_quality,
//      stage=minimax_direct_markdown_quality, exactly 2 calls recorded (bounded
//      limit), generationPipeline includes the empty_after_clean +
//      repair_failed + failed_no_fallback markers, no API key config advice,
//      no Gateway restart advice, retryBudget.maxMarkdownRepairAttempts=1.
//   7. Kills the server, removes the temp data dir, writes
//      `probe-repair-positive.json` and `probe-repair-negative.json` to the
//      task folder.
//
// Exits 0 when both positive and negative cases pass. Exits 1 with detailed
// failure messages otherwise.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const taskDir = path.resolve(
  repoRoot,
  "tasks/openclaw/2026-07-06T-njx-copilot-add-note-repair-integration-rework4",
);

const SERVER_DIST = path.join(repoRoot, "apps/server/dist/index.js");
const NODE_BIN = process.execPath;
const FAKE_PORT = Number(process.env.OPENCLAW_REPAIR_TEST_FAKE_PORT || 39901);
const SERVER_PORT = Number(process.env.OPENCLAW_REPAIR_TEST_SERVER_PORT || 39777);
const TEST_API_KEY = "test-minimax-repair-rework4-fake-key";
const TEST_SESSION_TOKEN = "openclaw-repair-rework4-test-session-token-1234567890";
const TASK_TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-repair-rework4-data-"));
const SERVER_LOG_PATH = path.join(taskDir, "server.log");
const FAKE_LOG_PATH = path.join(taskDir, "fake-minimax.log");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function logStep(...args) {
  process.stderr.write(`[rework4] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// (1) Local fake MiniMax-compatible HTTP server.
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
        body,
        promptSnippet: typeof parsed?.messages?.[0]?.content === "string"
          ? parsed.messages[0].content.slice(0, 240)
          : "<non-string>",
        ts: new Date().toISOString(),
      });
      const next = responses.shift();
      if (!next) {
        // No more programmed responses — return 500 to surface over-shoot.
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "fake_minimax: no more programmed responses" } }));
        return;
      }
      // Simulate the same `choices[0].message.content` JSON shape that
      // directMinimaxM3Call expects.
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
// (2) Spawn the real server in a child process with the fake MiniMax base URL.
// ---------------------------------------------------------------------------

function startRealServer(envExtras = {}) {
  const child = spawn(
    NODE_BIN,
    ["--experimental-sqlite", SERVER_DIST],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        // The real server's resolveMinimaxM3BaseUrl() reads MINIMAX_BASE_URL
        // first; we use that to point it at the local fake server.
        MINIMAX_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
        MINIMAX_API_KEY: TEST_API_KEY,
        // Isolate the test from the user's real DB / workspace.
        OPENCLAW_DATA_DIR: TASK_TMP_DATA,
        OPENCLAW_WORKBENCH_PORT: String(SERVER_PORT),
        OPENCLAW_WORKBENCH_HOST: "127.0.0.1",
        // Disable any cloudbase / sidecar features that could touch the network.
        OPENCLAW_CB_ENABLED: "0",
        // Bypass the global preHandler auth hook (apps/server/dist/auth.js:38-40).
        // The test token requires length >= 20 and matches the owb_test_session
        // cookie we send with every request. This is the documented test-only
        // mechanism for running the server headless without a real user setup.
        OPENCLAW_WORKBENCH_TEST_TOKEN: TEST_SESSION_TOKEN,
        // Keep the env-isolation smoke happy (no cross-project env).
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
        req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
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
          // Bypass the global preHandler auth hook (apps/server/dist/auth.js:38-40).
          // The server checks cookies.owb_test_session === process.env.OPENCLAW_WORKBENCH_TEST_TOKEN.
          "Cookie": `owb_test_session=${TEST_SESSION_TOKEN}`,
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
// (3) Source-level guard: confirm the direct branch + repair is wired in.
// ---------------------------------------------------------------------------

function checkSourceContract() {
  const serverSrc = fs.readFileSync(path.join(repoRoot, "apps/server/src/index.ts"), "utf8");
  // Confirm the repair retry path exists. If it does not, no point in
  // running the runtime test — the deterministic fake-minimax probe is
  // vacuous.
  expect(
    "source: buildKnowledgeNoteM3RepairPrompt function exists",
    /function\s+buildKnowledgeNoteM3RepairPrompt\s*\(/.test(serverSrc),
    "buildKnowledgeNoteM3RepairPrompt not found in apps/server/src/index.ts",
  );
  expect(
    "source: direct branch calls directMinimaxM3Call at least twice on empty-after-clean",
    /await\s+directMinimaxM3Call[\s\S]{0,400}await\s+directMinimaxM3Call/.test(serverSrc)
      || /directMinimaxM3Call\([^)]*repairPrompt/.test(serverSrc),
    "direct branch does not have a second directMinimaxM3Call for repair",
  );
  expect(
    "source: pipeline emits 'minimax_direct_markdown_empty_after_clean' on repair path",
    /minimax_direct_markdown_empty_after_clean/.test(serverSrc),
    "pipeline marker 'minimax_direct_markdown_empty_after_clean' missing from server source",
  );
  expect(
    "source: pipeline emits 'minimax_direct_markdown_repair' on repair success",
    /minimax_direct_markdown_repair/.test(serverSrc),
    "pipeline marker 'minimax_direct_markdown_repair' missing from server source",
  );
  expect(
    "source: pipeline emits 'minimax_direct_markdown_repair_failed' on dual failure",
    /minimax_direct_markdown_repair_failed/.test(serverSrc),
    "pipeline marker 'minimax_direct_markdown_repair_failed' missing from server source",
  );
  expect(
    "source: resolveMinimaxM3BaseUrl reads MINIMAX_BASE_URL env var (test injection point)",
    /process\.env\.MINIMAX_BASE_URL/.test(serverSrc) || /process\.env\.OPENCLAW_MINIMAX_BASE_URL/.test(serverSrc),
    "resolveMinimaxM3BaseUrl does not read MINIMAX_BASE_URL env var — test injection point broken",
  );
}

// ---------------------------------------------------------------------------
// (4) The actual probe fixtures.
// ---------------------------------------------------------------------------

// Casual raw transcript (the 午间咖啡杂谈 one from rework3). Kept short so the
// fake server's first response (think-only) results in cleanedMarkdown.length === 0.
const RAW_CASUAL_TRANSCRIPT = `今天中午和老婆喝了杯咖啡, 聊聊近况.

- 7 月初气温 30 多度, 空调电费又涨.
- 2026 年是美国建国 250 周年 (1776 起算).
- 两个人都说"年纪越大时间过得越快", 心理感受, 不是物理时间.
- 孩子开学前想安排一次出行, 远则飞机, 近则自驾.

整体就是闲聊, 没具体决策, 没行动项.`;

const THINK_ONLY_RESPONSE = `<think>Let me analyze this raw casual conversation carefully. The user is asking me to organize this into an Obsidian-compatible Markdown note. The raw notes are about a casual coffee conversation. I need to identify the key points, action items, and follow-ups. I should produce clean Obsidian markdown. Let me start with the frontmatter. Let me think about the structure. Frontmatter with title, date, type, status, tags, related, folder. Then # title. Then sections. I think the title should be 午间咖啡杂谈. Let me think about the date. 2026-07-06. Let me think about the type. 备忘. Status: 仅供参考. Let me think about the tags. casual, summer, travel. Let me think about the action items. There are no clear action items in the conversation. Let me think about the structure. I should write the high-value summary. I should write the key facts. I should write the action items. I should write the risk and to-be-verified section. I should write the evidence anchors. I should write the original record entry. Let me think about what to write in each section. The high-value summary should briefly summarize the conversation. The key facts should list the main points. The action items should be honest about the lack of actions. The risk and to-be-verified section should note the low information density. The evidence anchors should cite the original lines. The original record entry should reference the source. Let me think about the conversation more. The conversation mentions 7 月初气温 30 多度. This is a fact. The conversation mentions 2026 年是美国建国 250 周年. This is a fact. The conversation mentions 年纪越大时间过得越快. This is an observation. The conversation mentions 孩子开学前想安排一次出行. This is a vague plan. OK I think I have thought about this enough. Let me close the think block and not output any markdown. The server should retry me with a repair prompt. Closing the think block now. End of thinking. No markdown output. The model ran out of steam and only returned the think block. Server should detect cleanedMarkdown empty and retry.</think>`;
// ---------------------------------------------------------------------------
// The repair-response fixture: a valid Obsidian Markdown note that the
// model (or fake) returns on the second call after the repair prompt.
// ---------------------------------------------------------------------------
const REPAIR_VALID_RESPONSE = `---
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

本次是 2026 年 7 月初一段低信息密度的咖啡闲聊, 没有具体决策或行动项. 主要话题包括 7 月高温、美国建国 250 周年, 以及对"年纪越大时间越快"的心理感受. 末尾约定在孩子开学前再安排一次出行.

## 关键事实

- 7 月初气温 30 多度, 已进入暑期, 空调电费预估上涨.
- 2026 年是美国建国 250 周年, 起算年 1776.
- 对话双方对"年龄越大主观时间越快"形成共识, 心理学解释为新体验减少.
- 孩子开学前计划一次出行, 距离远则飞机、近则自驾.

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
// (5) Run the positive + negative cases against the real server.
// ---------------------------------------------------------------------------

async function runPositiveCase() {
  logStep("positive case: starting fake MiniMax server with [think-only, valid repair] responses");
  const { server, recordedCalls } = await startFakeMinimaxServer([
    { content: THINK_ONLY_RESPONSE },
    { content: REPAIR_VALID_RESPONSE },
  ]);
  let realServer = null;
  let positiveResult = null;
  try {
    logStep("positive case: spawning real server with MINIMAX_BASE_URL pointing to fake");
    const started = startRealServer();
    realServer = started.child;
    const healthy = await waitForServerHealth(45_000);
    if (!healthy) {
      throw new Error(`real server did not become healthy on port ${SERVER_PORT}; see ${SERVER_LOG_PATH}`);
    }
    logStep(`positive case: real server healthy on http://127.0.0.1:${SERVER_PORT}`);
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
    logStep("positive case: POST /api/knowledge/notes/organize (this can take 5-30s)");
    const startedAt = Date.now();
    const result = await postOrganizeRequest(payload);
    const durationMs = Date.now() - startedAt;
    logStep(`positive case: server responded status=${result.status} in ${durationMs}ms; calls recorded=${recordedCalls.length}`);
    expect(
      "positive: server returns HTTP 200",
      result.status === 200,
      `expected 200, got ${result.status}; body=${(result.body || "").slice(0, 400)}`,
    );
    expect(
      "positive: response.ok === true",
      result.parsed?.ok === true,
      `expected ok=true, got ${result.parsed?.ok}`,
    );
    expect(
      "positive: response.qualityMode === 'minimax-direct' (no Gateway fallback)",
      result.parsed?.qualityMode === "minimax-direct",
      `expected qualityMode=minimax-direct, got ${result.parsed?.qualityMode}`,
    );
    expect(
      "positive: htmlQuality.passed === true",
      result.parsed?.htmlQuality?.passed === true,
      `expected htmlQuality.passed=true, got ${JSON.stringify(result.parsed?.htmlQuality)}`,
    );
    expect(
      "positive: htmlQuality.repaired === true (proves 2nd-call repair was used)",
      result.parsed?.htmlQuality?.repaired === true,
      `expected htmlQuality.repaired=true, got ${result.parsed?.htmlQuality?.repaired}`,
    );
    const pipeline = Array.isArray(result.parsed?.generationPipeline) ? result.parsed.generationPipeline : [];
    expect(
      "positive: generationPipeline includes the first-round quality marker (empty_after_clean or quality_failed)",
      pipeline.includes("minimax_direct_markdown_empty_after_clean") || pipeline.includes("minimax_direct_markdown_quality_failed"),
      `pipeline missing first-round quality marker: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "positive: generationPipeline includes 'minimax_direct_markdown_repair'",
      pipeline.includes("minimax_direct_markdown_repair"),
      `pipeline missing repair marker: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "positive: generationPipeline does NOT include 'minimax_direct_failed_no_fallback'",
      !pipeline.includes("minimax_direct_failed_no_fallback"),
      `pipeline should not include failed_no_fallback on success: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "positive: directMinimaxNote.fallback === false (or absent on success)",
      result.parsed?.directMinimaxNote == null || result.parsed?.directMinimaxNote?.fallback === false,
      `directMinimaxNote.fallback should be false (or absent on success), got ${JSON.stringify(result.parsed?.directMinimaxNote)}`,
    );
    expect(
      "positive: stage === 'minimax_direct_markdown' (NOT 'minimax_direct_markdown_quality')",
      result.parsed?.stage === "minimax_direct_markdown" || result.parsed?.stage === undefined,
      `stage should not be quality-failure for success path, got ${result.parsed?.stage}`,
    );
    expect(
      "positive: error field is empty",
      !result.parsed?.error,
      `error should be empty on success, got ${result.parsed?.error}`,
    );
    // Leak checks against the final draft.
    const draftMd = String(result.parsed?.draft?.markdown || "");
    const draftHtml = String(result.parsed?.draft?.html || result.parsed?.htmlDraft?.html || "");
    expect(
      "positive: draft.markdown does NOT contain <think>",
      !/<think>/i.test(draftMd),
      `draft.markdown still contains <think>: ${draftMd.slice(0, 240)}`,
    );
    expect(
      "positive: draft.markdown does NOT contain 'Let me analyze'",
      !/Let me analyze/i.test(draftMd),
      `draft.markdown still contains Let me analyze: ${draftMd.slice(0, 240)}`,
    );
    expect(
      "positive: draft.markdown does NOT contain 'The user is asking'",
      !/The user is asking/i.test(draftMd),
      `draft.markdown still contains The user is asking: ${draftMd.slice(0, 240)}`,
    );
    expect(
      "positive: draft.html does NOT contain <think>",
      !/<think>/i.test(draftHtml),
      `draft.html still contains <think>: ${draftHtml.slice(0, 240)}`,
    );
    expect(
      "positive: draft.html does NOT contain 'Let me analyze'",
      !/Let me analyze/i.test(draftHtml),
      `draft.html still contains Let me analyze: ${draftHtml.slice(0, 240)}`,
    );
    expect(
      "positive: draft.markdown contains 'source-hash' line (repair passed the quality gate)",
      /^source-hash\s*[:：]/im.test(draftMd),
      `draft.markdown missing source-hash line: ${draftMd.slice(0, 240)}`,
    );
    // Call log checks — the strongest single proof that 2 direct calls happened.
    expect(
      "positive: fake MiniMax received EXACTLY 2 calls (1st think-only, 2nd valid)",
      recordedCalls.length === 2,
      `expected 2 calls, got ${recordedCalls.length}; calls=${JSON.stringify(recordedCalls.map(c => ({ callIndex: c.callIndex, promptSnippet: c.promptSnippet.slice(0, 80) })))}`,
    );
    if (recordedCalls.length >= 2) {
      expect(
        "positive: 1st call to /chat/completions uses POST",
        recordedCalls[0].method === "POST" && /\/chat\/completions/.test(recordedCalls[0].url),
        `1st call method/url wrong: ${recordedCalls[0].method} ${recordedCalls[0].url}`,
      );
      expect(
        "positive: 1st call sends Authorization: Bearer <fake-key>",
        recordedCalls[0].authorization === `Bearer ${TEST_API_KEY}`,
        `1st call auth wrong: ${recordedCalls[0].authorization}`,
      );
      expect(
        "positive: 2nd call sends Authorization: Bearer <fake-key>",
        recordedCalls[1].authorization === `Bearer ${TEST_API_KEY}`,
        `2nd call auth wrong: ${recordedCalls[1].authorization}`,
      );
      // The 2nd call's prompt should reference the previous failure (repair prompt).
      const repairPromptSignal = /上一版|上一轮|repair|重新整理|已通过质量门禁.*未通过/i;
      expect(
        "positive: 2nd call's prompt is the repair prompt (references previous failure)",
        repairPromptSignal.test(recordedCalls[1].promptSnippet) || repairPromptSignal.test(recordedCalls[1].body),
        `2nd call prompt does not look like a repair prompt: ${recordedCalls[1].promptSnippet.slice(0, 200)}`,
      );
      const firstPromptSignal = /^(?!\s*<think>).*?(?:\(这是.*不是\)|原始.*信息|不要输出\s*<think>|绝对不要)/i;
      expect(
        "positive: 1st call's prompt is the direct (initial) prompt, NOT the repair prompt",
        !repairPromptSignal.test(recordedCalls[0].promptSnippet) && !repairPromptSignal.test(recordedCalls[0].body),
        `1st call prompt should NOT contain repair-prompt signals (would indicate wrong call order): ${recordedCalls[0].promptSnippet.slice(0, 200)}`,
      );
      // Belt-and-suspenders: the first prompt does mention the initial direct constraints.
      expect(
        "positive: 1st call's prompt mentions the 'don't output <think>' direct-mode constraint",
        firstPromptSignal.test(recordedCalls[0].promptSnippet) || firstPromptSignal.test(recordedCalls[0].body),
        `1st call prompt does not include direct-mode constraints: ${recordedCalls[0].promptSnippet.slice(0, 200)}`,
      );
    }
    positiveResult = {
      verdict: "PASS",
      status: result.status,
      durationMs,
      responseOk: result.parsed?.ok,
      qualityMode: result.parsed?.qualityMode,
      htmlQuality: result.parsed?.htmlQuality,
      generationPipeline: pipeline,
      stage: result.parsed?.stage,
      error: result.parsed?.error || null,
      directMinimaxNote: result.parsed?.directMinimaxNote || null,
      attempts: result.parsed?.attempts || null,
      draftMarkdownLength: draftMd.length,
      draftHtmlLength: draftHtml.length,
      draftMarkdownSample: draftMd.slice(0, 400),
      draftHtmlSample: draftHtml.slice(0, 400),
      fakeMinimaxCallCount: recordedCalls.length,
      fakeMinimaxCalls: recordedCalls.map((c) => ({
        callIndex: c.callIndex,
        method: c.method,
        url: c.url,
        authorization: c.authorization,
        promptSnippet: c.promptSnippet,
        bodyLength: c.body.length,
      })),
      httpResponseSample: (result.body || "").slice(0, 1500),
    };
  } finally {
    await killServer(realServer);
    await new Promise((r) => server.close(r));
  }
  return positiveResult;
}

async function runNegativeCase() {
  logStep("negative case: starting fake MiniMax server with [think-only, think-only] responses");
  const { server, recordedCalls } = await startFakeMinimaxServer([
    { content: THINK_ONLY_RESPONSE },
    { content: THINK_ONLY_RESPONSE },
  ]);
  let realServer = null;
  let negativeResult = null;
  try {
    logStep("negative case: spawning real server with MINIMAX_BASE_URL pointing to fake");
    const started = startRealServer();
    realServer = started.child;
    const healthy = await waitForServerHealth(45_000);
    if (!healthy) {
      throw new Error(`real server did not become healthy on port ${SERVER_PORT}; see ${SERVER_LOG_PATH}`);
    }
    logStep(`negative case: real server healthy on http://127.0.0.1:${SERVER_PORT}`);
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
    logStep("negative case: POST /api/knowledge/notes/organize (this can take 5-30s)");
    const startedAt = Date.now();
    const result = await postOrganizeRequest(payload);
    const durationMs = Date.now() - startedAt;
    logStep(`negative case: server responded status=${result.status} in ${durationMs}ms; calls recorded=${recordedCalls.length}`);
    expect(
      "negative: server returns HTTP 422 (quality gate fails, no Gateway fallback)",
      result.status === 422,
      `expected 422, got ${result.status}; body=${(result.body || "").slice(0, 400)}`,
    );
    expect(
      "negative: response.error === 'blocked_minimax_direct_quality'",
      result.parsed?.error === "blocked_minimax_direct_quality",
      `expected blocked_minimax_direct_quality, got ${result.parsed?.error}`,
    );
    expect(
      "negative: response.stage starts with 'minimax_direct_markdown_quality'",
      String(result.parsed?.stage || "").startsWith("minimax_direct_markdown_quality"),
      `expected stage to start with minimax_direct_markdown_quality, got ${result.parsed?.stage}`,
    );
    const pipeline = Array.isArray(result.parsed?.generationPipeline) ? result.parsed.generationPipeline : [];
    expect(
      "negative: generationPipeline includes the first-round quality marker (empty_after_clean or quality_failed)",
      pipeline.includes("minimax_direct_markdown_empty_after_clean") || pipeline.includes("minimax_direct_markdown_quality_failed"),
      `pipeline missing first-round quality marker: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "negative: generationPipeline includes 'minimax_direct_markdown_repair_failed'",
      pipeline.includes("minimax_direct_markdown_repair_failed"),
      `pipeline missing repair_failed marker: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "negative: generationPipeline includes 'minimax_direct_failed_no_fallback'",
      pipeline.includes("minimax_direct_failed_no_fallback"),
      `pipeline missing failed_no_fallback marker: ${JSON.stringify(pipeline)}`,
    );
    expect(
      "negative: directMinimaxNote.fallback === false (no Gateway fallback)",
      result.parsed?.directMinimaxNote?.fallback === false,
      `directMinimaxNote.fallback should be false, got ${result.parsed?.directMinimaxNote?.fallback}`,
    );
    const reasonCode = String(result.parsed?.reason || "").split(":")[0];
    expect(
      "negative: reason starts with 'minimax_direct_markdown_empty_after_clean' or 'minimax_direct_markdown_repair_failed'",
      /^(minimax_direct_markdown_empty_after_clean|minimax_direct_markdown_repair_failed|minimax_direct_markdown_quality_failed)$/.test(reasonCode),
      `reason should be a quality/repair reason, got ${reasonCode} (full=${result.parsed?.reason})`,
    );
    // attempts should record 2 entries (1 initial failure + 1 repair failure).
    const attempts = Array.isArray(result.parsed?.attempts) ? result.parsed.attempts : [];
    expect(
      "negative: attempts has exactly 2 entries (initial + repair)",
      attempts.length === 2,
      `attempts should have 2 entries, got ${attempts.length}: ${JSON.stringify(attempts)}`,
    );
    if (attempts.length === 2) {
      expect(
        "negative: 1st attempt stage is 'minimax_direct_markdown_quality' (initial gate)",
        attempts[0].stage === "minimax_direct_markdown_quality",
        `1st attempt stage wrong: ${attempts[0].stage}`,
      );
      expect(
        "negative: 1st attempt status is 'failed'",
        attempts[0].status === "failed",
        `1st attempt status wrong: ${attempts[0].status}`,
      );
      expect(
        "negative: 2nd attempt stage is 'minimax_direct_markdown_repair'",
        attempts[1].stage === "minimax_direct_markdown_repair",
        `2nd attempt stage wrong: ${attempts[1].stage}`,
      );
      expect(
        "negative: 2nd attempt status is 'failed'",
        attempts[1].status === "failed",
        `2nd attempt status wrong: ${attempts[1].status}`,
      );
    }
    // retryBudget must reflect the bounded 2-call limit.
    const retryBudget = result.parsed?.retryBudget || {};
    expect(
      "negative: retryBudget.maxMarkdownRepairAttempts === 1 (bounded repair limit)",
      retryBudget.maxMarkdownRepairAttempts === 1,
      `retryBudget.maxMarkdownRepairAttempts should be 1, got ${retryBudget.maxMarkdownRepairAttempts}`,
    );
    // User-facing copy must NOT recommend API key config or Gateway restart.
    const fullText = [
      result.parsed?.message,
      result.parsed?.reasonLabel,
      result.parsed?.advice,
      result.parsed?.diagnosis?.reasonLabel,
      result.parsed?.diagnosis?.advice,
      result.parsed?.diagnosis?.userAction,
      result.parsed?.diagnosis?.rootCause,
      result.parsed?.diagnosis?.category,
    ].filter(Boolean).join("\n");
    expect(
      "negative: user-facing copy does NOT mention '请配置 MiniMax API key' (API key was used successfully)",
      !/请配置\s+MiniMax\s+API\s*key|配置\s+MiniMax\s+API\s*key/.test(fullText),
      `user copy still mentions API key config: ${fullText.slice(0, 400)}`,
    );
    expect(
      "negative: user-facing copy does NOT recommend '重启 OpenClaw Gateway'",
      !/重启\s+OpenClaw\s+Gateway|重新连接\s+Gateway/.test(fullText),
      `user copy still recommends Gateway restart: ${fullText.slice(0, 400)}`,
    );
    // The user copy should explain that BOTH direct attempts failed (2-call limit).
    const mentionsDualFailure = /两次.*均未通过|两次直连|一次.*repair|首次.*repair|第一次.*第二次/i.test(fullText)
      || /两次|均未通过/.test(String(result.parsed?.reason || ""));
    expect(
      "negative: user-facing copy mentions BOTH direct attempts failed (or '两次均未通过')",
      mentionsDualFailure,
      `user copy should mention dual failure: ${fullText.slice(0, 400)}`,
    );
    // Call log checks: bounded 2-call limit (no third call).
    expect(
      "negative: fake MiniMax received EXACTLY 2 calls (bounded limit, no third call)",
      recordedCalls.length === 2,
      `expected 2 calls (bounded), got ${recordedCalls.length}`,
    );
    if (recordedCalls.length >= 2) {
      expect(
        "negative: 1st call's prompt is the direct (initial) prompt",
        !/上一版|上一轮|repair|重新整理/.test(recordedCalls[0].promptSnippet) && !/上一版|上一轮|repair|重新整理/.test(recordedCalls[0].body),
        `1st call prompt should NOT be the repair prompt: ${recordedCalls[0].promptSnippet.slice(0, 200)}`,
      );
      expect(
        "negative: 2nd call's prompt IS the repair prompt",
        /上一版|上一轮|repair|重新整理|已通过质量门禁.*未通过/.test(recordedCalls[1].promptSnippet) || /上一版|上一轮|repair|重新整理|已通过质量门禁.*未通过/.test(recordedCalls[1].body),
        `2nd call prompt should be repair prompt: ${recordedCalls[1].promptSnippet.slice(0, 200)}`,
      );
    }
    negativeResult = {
      verdict: "PASS",
      status: result.status,
      durationMs,
      error: result.parsed?.error || null,
      stage: result.parsed?.stage,
      reason: result.parsed?.reason,
      generationPipeline: pipeline,
      directMinimaxNote: result.parsed?.directMinimaxNote || null,
      attempts,
      retryBudget,
      diagnosis: result.parsed?.diagnosis || null,
      message: result.parsed?.message || null,
      reasonLabel: result.parsed?.reasonLabel || null,
      advice: result.parsed?.advice || null,
      fakeMinimaxCallCount: recordedCalls.length,
      fakeMinimaxCalls: recordedCalls.map((c) => ({
        callIndex: c.callIndex,
        method: c.method,
        url: c.url,
        authorization: c.authorization,
        promptSnippet: c.promptSnippet,
        bodyLength: c.body.length,
      })),
      httpResponseSample: (result.body || "").slice(0, 1500),
    };
  } finally {
    await killServer(realServer);
    await new Promise((r) => server.close(r));
  }
  return negativeResult;
}

// ---------------------------------------------------------------------------
// (6) Main.
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(taskDir, { recursive: true });
  logStep(`task dir: ${taskDir}`);
  logStep(`fake MiniMax port: ${FAKE_PORT}`);
  logStep(`real server port: ${SERVER_PORT}`);
  logStep(`temp data dir: ${TASK_TMP_DATA}`);

  // Source-level guards first (fast, deterministic).
  logStep("running source-level guards");
  checkSourceContract();
  if (failures.length) {
    console.error("TEST_KNOWLEDGE_ADD_NOTE_DIRECT_REPAIR_RUNTIME_FAIL");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  logStep("source-level guards passed");

  // Source-level guards pass; now run the live integration tests.
  const positiveResult = await runPositiveCase();
  logStep(`positive case verdict: ${positiveResult.verdict}; htmlQuality.repaired=${positiveResult.htmlQuality?.repaired}`);

  const negativeResult = await runNegativeCase();
  logStep(`negative case verdict: ${negativeResult.verdict}; error=${negativeResult.error}`);

  // Write evidence files (in addition to the stdout JSON).
  const positiveJsonPath = path.join(taskDir, "probe-repair-positive.json");
  const negativeJsonPath = path.join(taskDir, "probe-repair-negative.json");
  fs.writeFileSync(positiveJsonPath, JSON.stringify(positiveResult, null, 2), "utf8");
  fs.writeFileSync(negativeJsonPath, JSON.stringify(negativeResult, null, 2), "utf8");
  logStep(`wrote evidence: ${positiveJsonPath}`);
  logStep(`wrote evidence: ${negativeJsonPath}`);

  // Cleanup the temp data dir.
  try { fs.rmSync(TASK_TMP_DATA, { recursive: true, force: true }); } catch {}

  // Final verdict.
  const positivePass = positiveResult.verdict === "PASS" && failures.length === 0;
  // The negative case is allowed to mark itself PASS internally; we also
  // require no failures accumulated during the negative run.
  const allPass = positivePass && negativeResult.verdict === "PASS" && failures.length === 0;

  if (allPass) {
    console.log("TEST_KNOWLEDGE_ADD_NOTE_DIRECT_REPAIR_RUNTIME_PASS");
    process.exit(0);
  }
  console.error("TEST_KNOWLEDGE_ADD_NOTE_DIRECT_REPAIR_RUNTIME_FAIL");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("TEST_KNOWLEDGE_ADD_NOTE_DIRECT_REPAIR_RUNTIME_FAIL");
  console.error(err?.stack || String(err));
  // Best-effort cleanup.
  try { fs.rmSync(TASK_TMP_DATA, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
