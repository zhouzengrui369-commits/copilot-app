import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const marker = "WB_NOTE_OPS_RETRY";
const dataDir = process.env.OPENCLAW_DATA_DIR || new URL("../data", import.meta.url).pathname;
const db = new DatabaseSync(path.join(dataDir, "workbench.sqlite"));
db.exec("PRAGMA busy_timeout = 5000");
const sessionHashes: string[] = [];

test.beforeEach(async ({ context }) => {
  const token = `${marker}_${crypto.randomUUID()}`;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  sessionHashes.push(tokenHash);
  db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, 1, expires, now);
  await context.addCookies([{ name: "owb_session", value: encodeURIComponent(token), url: baseUrl }]);
});

test.afterAll(() => {
  for (const hash of sessionHashes) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
  db.close();
});

test("Add Note auto-enters Worker ops recovery and retries after Gateway transport failure", async ({ page }) => {
  test.setTimeout(90_000);
  const jobId = `${marker}_transport_job`;
  let jobCreateCalls = 0;
  let jobPollCalls = 0;
  const workerAttempt = {
    attempt: 1,
    stage: "worker_system_ops_recovery",
    strategy: "server_side_shadow_watchdog_then_retry",
    status: "passed",
    reason: "ops_recovery_recovered",
    repairDirectives: ["Worker system_ops shadow 巡检", "恢复后重试 Gateway/MiniMax 整理"],
    debugReportPath: "/tmp/knowledge-note-ops-recovery.json",
  };

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理；如失败会自动进入 Worker 运维恢复后重试。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [],
          debugReports: [],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${jobId}`, async (route) => {
    jobPollCalls += 1;
    const succeeded = jobPollCalls >= 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: succeeded ? "succeeded" : "running",
          phase: succeeded ? "preview_ready" : "worker_ops_shadow_check",
          message: succeeded ? "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。" : "Worker 正在主动执行 shadow 运维巡检。",
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [workerAttempt],
          debugReports: ["/tmp/knowledge-note-ops-recovery.json"],
          opsRecovery: { status: "RECOVERED", attempts: 1, retryRecommended: true, reports: ["/tmp/knowledge-note-ops-recovery.json"], blockers: [], nextActions: ["自动重试添加笔记"] },
          result: succeeded ? {
            ok: true,
            qualityMode: "m3-html",
            draft: {
              rawContent: `${marker} 原始会议记录`,
              title: `${marker} 自动恢复成功`,
              date: "2026-06-01",
              type: "工作记录",
              status: "仅供参考",
              tags: ["添加笔记", "自动恢复"],
              related: [],
              folder: "openclaw",
              markdown: `---\ntitle: ${marker} 自动恢复成功\n---\n\n# ${marker} 自动恢复成功\n\n- Worker 运维恢复后自动重试成功。`,
            },
            layoutStrategy: { mode: "report" },
            agentDecision: { chosenAgent: "worker", reason: "knowledge note", escalationNeeded: false },
            quality: { confidence: 0.99, sourceCoverage: "source_hash_verified", unresolvedItems: [] },
            htmlDraft: { title: `${marker} 自动恢复成功`, html: "<!doctype html><html><body><main><h1>自动恢复成功</h1></main></body></html>" },
            htmlQuality: { score: 100, passed: true, issues: [] },
            generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
            attempts: [workerAttempt, { attempt: 1, stage: "m3_obsidian_markdown", strategy: "normal", status: "passed", reason: "ok", confidence: 0.99 }],
            diagnosis: null,
            retryBudget: { used: 1, max: 3, exhausted: false },
            debugReports: ["/tmp/knowledge-note-ops-recovery.json"],
            nextActions: [],
            knowledgeNotePipelineVersion: "m3-html-v3",
          } : null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel("标题").fill(`${marker} 自动恢复`);
  await noteDialog.locator(".folder-input-row input").fill("openclaw");
  await noteDialog.getByLabel("原始笔记").fill(`${marker} Gateway 传输失败后需要 Worker 自动运维并重试。`);
  await noteDialog.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => jobPollCalls, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await expect(noteDialog.getByLabel("标题")).toHaveValue(`${marker} 自动恢复成功`, { timeout: 30_000 });
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("诊断与自动修复", { timeout: 30_000 });
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("已尝试 1/3 次自动修复");
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toBeVisible();
});

test("Add Note treats quality-gate exhaustion as recoverable ops flow before retry", async ({ page }) => {
  test.setTimeout(90_000);
  const jobId = `${marker}_quality_job`;
  let jobCreateCalls = 0;
  let jobPollCalls = 0;

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [],
          debugReports: [],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${jobId}`, async (route) => {
    jobPollCalls += 1;
    const result = {
      ok: true,
      qualityMode: "m3-html",
      draft: {
        rawContent: `${marker} 低信息密度原始记录`,
        title: `${marker} 质量降级预览成功`,
        date: "2026-06-01",
        type: "备忘",
        status: "仅供参考",
        tags: ["添加笔记", "低信息密度"],
        related: [],
        folder: "openclaw",
        markdown: `---\ntitle: ${marker} 质量降级预览成功\n---\n\n# ${marker} 质量降级预览成功\n\n## 高价值摘要\nMiniMax 重试后返回可保存草稿。\n\n## Workbench 质量说明\n按仅供参考保存。`,
      },
      layoutStrategy: { mode: "low-information" },
      agentDecision: { chosenAgent: "worker", reason: "knowledge note", escalationNeeded: false },
      quality: { confidence: 0.72, sourceCoverage: "degraded accepted", unresolvedItems: ["低信息密度"] },
      htmlDraft: { title: `${marker} 质量降级预览成功`, html: "<!doctype html><html><body><main><h1>质量降级预览成功</h1></main></body></html>" },
      htmlQuality: { score: 88, passed: true, issues: ["degraded_accepted"] },
      generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_markdown_quality_degraded_acceptance", "m3_html_document", "server_sanitize"],
      attempts: [{ attempt: 3, stage: "m3_markdown_quality_acceptance", strategy: "degraded_gateway_draft_acceptance", status: "passed", reason: "degraded_accept:gateway_quality_gate:low_value_or_noisy_summary", confidence: 0.72 }],
      diagnosis: {
        category: "内容质量降级通过",
        rootCause: "MiniMax 已返回可信低信息密度草稿。",
        retryable: false,
        userAction: "可以保存为仅供参考。",
        repairDirectives: ["保留 Gateway/MiniMax 可信草稿"],
        nextActions: ["保存当前低信息密度笔记"],
      },
      retryBudget: { used: 3, max: 3, exhausted: true },
      debugReports: [],
      nextActions: ["保存当前低信息密度笔记"],
      knowledgeNotePipelineVersion: "m3-html-v3",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "succeeded",
          phase: "preview_ready",
          message: "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。",
          createdAt: new Date(Date.now() - 5000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: result.attempts,
          debugReports: [],
          result,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel("标题").fill(`${marker} 质量门槛`);
  await noteDialog.locator(".folder-input-row input").fill("openclaw");
  await noteDialog.getByLabel("原始笔记").fill(`${marker} 一段短会议闲聊，需要自动诊断后重试。`);
  await noteDialog.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => jobPollCalls, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect(noteDialog.getByLabel("标题")).toHaveValue(`${marker} 质量降级预览成功`, { timeout: 30_000 });
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("内容质量降级通过", { timeout: 30_000 });
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toBeVisible();
});

test("Add Note renders late recovered preview as success instead of exhausted failure", async ({ page }) => {
  test.setTimeout(90_000);
  const jobId = `${marker}_late_recovered_job`;
  let jobCreateCalls = 0;
  let jobPollCalls = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, name: "Test User", role: "owner" } }),
    });
  });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [],
          debugReports: [],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${jobId}`, async (route) => {
    jobPollCalls += 1;
    const result = {
      ok: true,
      qualityMode: "m3-html",
      draft: {
        rawContent: `${marker} 早会及航材库房管理讨论`,
        title: `${marker} 后台回收预览成功`,
        date: "2026-06-16",
        type: "会议纪要",
        status: "仅供参考",
        tags: ["日程笔记", "后台回收"],
        related: [],
        folder: "calendar/2026-06",
        markdown: `---\ntitle: ${marker} 后台回收预览成功\n---\n\n# ${marker} 后台回收预览成功\n\n## 高价值摘要\nMiniMax-M3 已回收同一 sourceHash 的可信 Markdown。\n\n## 证据入口\nMarkdown 可信源、原始记录入口、source-hash 已保留。`,
      },
      layoutStrategy: { mode: "calendar-note" },
      agentDecision: { chosenAgent: "boss", reason: "late recovered note", escalationNeeded: false },
      quality: { confidence: 0.78, sourceCoverage: "覆盖原文主要事实", unresolvedItems: [] },
      htmlDraft: {
        title: `${marker} 后台回收预览成功`,
        html: "<!doctype html>\\n<html><head><style>body{font-family:sans-serif}.card{padding:12px}</style></head><body><main><section class=\\\"card\\\"><h1>后台回收预览成功</h1><h2>高价值摘要</h2><p>MiniMax-M3 已返回可保存 HTML。</p><h2>证据入口</h2><p>Markdown 可信源、原始记录入口、source-hash 已保留。</p></section></main></body></html>",
      },
      htmlQuality: { score: 72, passed: true, issues: ["html_too_thin"] },
      generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_recent_source_hash_reuse", "m3_html_document", "server_sanitize"],
      attempts: [
        { attempt: 1, stage: "worker_system_ops_recovery", strategy: "server_side_shadow_watchdog_then_retry", status: "passed", reason: "ops_recovery_recovered" },
        { attempt: 3, stage: "m3_obsidian_markdown", strategy: "late_m3_session_source_hash_harvest", status: "passed", confidence: 0.78 },
        { attempt: 0, stage: "m3_html_document", strategy: "html_document", status: "passed", htmlScore: 72 },
      ],
      diagnosis: null,
      retryBudget: { used: 3, max: 3, exhausted: true },
      debugReports: ["/tmp/late-recovered-note.json"],
      nextActions: ["保存当前预览"],
      opsRecovery: { status: "RECOVERED", attempts: 1, latestGatewayStatus: "connected", blockers: [], nextActions: ["Worker 运维恢复已执行，自动重试添加笔记。"] },
      knowledgeNotePipelineVersion: "m3-html-v3",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "succeeded",
          phase: "preview_ready",
          message: "轮询状态时已回收同一 sourceHash 的 MiniMax-M3 输出，并生成可保存 Markdown 与 HTML 预览。",
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: result.attempts,
          debugReports: result.debugReports,
          result,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel("标题").fill(`${marker} 后台回收`);
  await noteDialog.locator(".folder-input-row input").fill("calendar/2026-06");
  await noteDialog.getByLabel("原始笔记").fill(`${marker} 一段已完成但经历 late harvest 的日程笔记。`);
  await noteDialog.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => jobPollCalls, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect(noteDialog.getByLabel("标题")).toHaveValue(`${marker} 后台回收预览成功`, { timeout: 30_000 });
  const panel = noteDialog.locator(".note-diagnosis-panel");
  await expect(panel).toContainText("自动恢复完成", { timeout: 30_000 });
  await expect(panel).not.toContainText("模型整理诊断");
  await expect(panel).not.toContainText("已用尽");
  await expect(panel.getByRole("button", { name: "自动修复并重试" })).toHaveCount(0);
  await expect(noteDialog.locator(".note-ai-status")).toContainText("质量提示：HTML 信息量偏薄（不阻断保存）");
  await expect(noteDialog.locator(".note-ai-status")).not.toContainText("HTML 校验：html_too_thin");
  const htmlSrcdoc = await noteDialog.locator(".note-html-draft-preview iframe").getAttribute("srcdoc");
  expect(htmlSrcdoc || "").toContain("<html>");
  expect(htmlSrcdoc || "").not.toContain("\\n<html");
  expect(htmlSrcdoc || "").not.toContain("\\\"");
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toBeVisible();
});

test("Add Note blocks placeholder-only HTML even when a cached job says it passed", async ({ page }) => {
  test.setTimeout(90_000);
  const jobId = `${marker}_placeholder_html_job`;
  let jobCreateCalls = 0;
  let jobPollCalls = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, name: "Test User", role: "owner" } }),
    });
  });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [],
          debugReports: [],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${jobId}`, async (route) => {
    jobPollCalls += 1;
    const result = {
      ok: true,
      qualityMode: "m3-html",
      draft: {
        rawContent: `${marker} 空壳 HTML 缓存`,
        title: `${marker} 空壳 HTML 应阻断`,
        date: "2026-06-16",
        type: "会议纪要",
        status: "仅供参考",
        tags: ["日程笔记", "空壳HTML"],
        related: [],
        folder: "calendar/2026-06",
        markdown: `---\ntitle: ${marker} 空壳 HTML 应阻断\n---\n\n# ${marker} 空壳 HTML 应阻断\n\n## 高价值摘要\nMarkdown 可信源有内容，但 HTML 阅读层只有省略号，不能保存。`,
      },
      layoutStrategy: { mode: "calendar-note" },
      agentDecision: { chosenAgent: "worker", reason: "cached placeholder html", escalationNeeded: false },
      quality: { confidence: 0.72, sourceCoverage: "覆盖原文主要事实", unresolvedItems: [] },
      htmlDraft: {
        title: `${marker} 空壳 HTML 应阻断`,
        html: "<!doctype html><html><head><style>body{font-family:sans-serif}.card{padding:12px}</style></head><body>...</body></html>",
      },
      htmlQuality: { score: 49, passed: true, issues: ["html_too_thin"] },
      generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
      attempts: [{ attempt: 0, stage: "m3_html_document", strategy: "html_document", status: "passed", htmlScore: 49 }],
      diagnosis: null,
      retryBudget: { used: 1, max: 3, exhausted: false },
      debugReports: [],
      nextActions: ["不要保存空壳 HTML"],
      knowledgeNotePipelineVersion: "m3-html-v3",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "succeeded",
          phase: "preview_ready",
          message: "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。",
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: result.attempts,
          debugReports: result.debugReports,
          result,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel("标题").fill(`${marker} 空壳 HTML`);
  await noteDialog.locator(".folder-input-row input").fill("calendar/2026-06");
  await noteDialog.getByLabel("原始笔记").fill(`${marker} 后台缓存返回的 HTML 只有省略号。`);
  await noteDialog.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => jobPollCalls, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect(noteDialog.getByLabel("标题")).toHaveValue(`${marker} 空壳 HTML 应阻断`, { timeout: 30_000 });
  await expect(noteDialog.locator(".note-ai-status")).toContainText("HTML 校验未通过：HTML 信息量偏薄、HTML 预览为空壳", { timeout: 30_000 });
  await expect(noteDialog.locator(".note-html-draft-preview")).toContainText("HTML 预览为空壳，已阻止保存");
  await expect(noteDialog.locator(".note-html-draft-preview iframe")).toHaveCount(0);
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toBeDisabled();
});

test("Add Note rebuilds a job after server-side Gateway timeout exhaustion", async ({ page }) => {
  test.setTimeout(120_000);
  const firstJobId = `${marker}_exhausted_job_1`;
  const secondJobId = `${marker}_exhausted_job_2`;
  let jobCreateCalls = 0;
  let firstPollCalls = 0;
  let secondPollCalls = 0;
  let opsTaskCalls = 0;
  const workerAttempt = {
    attempt: 1,
    stage: "worker_system_ops_recovery",
    strategy: "auto_ops_recover_then_retry",
    status: "ops_recovery_attempted",
    reason: "background_job_timeout_after_480000ms",
    repairDirectives: ["自动检查 Workbench 服务健康", "创建 system_ops 运维任务记录", "健康恢复后自动重试添加笔记"],
    details: ["health:reachable checks=1", "system_ops_task:created"],
  };

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/system-ops/tasks", async (route) => {
    opsTaskCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, workbenchItem: { id: `${marker}_ops_task`, title: "添加笔记自动恢复" } }),
    });
  });

  await page.route("**/api/system-ops", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, latestReport: { status: "DEGRADED", network_status: "OK", nas_status: "mounted" } }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    const jobId = jobCreateCalls === 1 ? firstJobId : secondJobId;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理；如失败会自动进入 Worker 运维恢复后重试。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [],
          debugReports: [],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${firstJobId}`, async (route) => {
    firstPollCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: firstJobId,
          status: "failed",
          phase: "knowledge_note_background_wait",
          message: "后台整理任务超过等待上限。",
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [{ attempt: 3, stage: "knowledge_note_background_wait", strategy: "end_to_end_timeout_abort", status: "failed", reason: "background_job_timeout_after_480000ms" }],
          debugReports: ["/tmp/knowledge-note-exhausted.json"],
          diagnosis: {
            category: "模型超时",
            rootCause: "Gateway/MiniMax 后台整理超过等待上限。",
            retryable: true,
            userAction: "系统应进入 Worker 运维恢复并重新创建 job。",
            repairDirectives: ["检查 Gateway 队列", "重新整理"],
            nextActions: ["自动重试添加笔记"],
          },
          retryBudget: { used: 3, max: 3, exhausted: true },
          failure: {
            ok: false,
            error: "gateway_model_required",
            stage: "knowledge_note_background_wait",
            reason: "background_job_timeout_after_480000ms",
            reasonLabel: "模型超时",
            retryable: true,
            debugReports: ["/tmp/knowledge-note-exhausted.json"],
            diagnosis: {
              category: "模型超时",
              rootCause: "Gateway/MiniMax 后台整理超过等待上限。",
              retryable: true,
              userAction: "系统应进入 Worker 运维恢复并重新创建 job。",
              repairDirectives: ["检查 Gateway 队列", "重新整理"],
              nextActions: ["自动重试添加笔记"],
            },
            retryBudget: { used: 3, max: 3, exhausted: true },
          },
          result: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${secondJobId}`, async (route) => {
    secondPollCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: secondJobId,
          status: "succeeded",
          phase: "preview_ready",
          message: "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。",
          createdAt: new Date(Date.now() - 5000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [workerAttempt, { attempt: 1, stage: "m3_obsidian_markdown", strategy: "normal", status: "passed", reason: "ok", confidence: 0.98 }],
          debugReports: ["/tmp/knowledge-note-exhausted.json"],
          result: {
            ok: true,
            qualityMode: "m3-html",
            draft: {
              rawContent: `${marker} server exhausted 后自动重建 job`,
              title: `${marker} server exhausted 后恢复成功`,
              date: "2026-06-01",
              type: "工作记录",
              status: "仅供参考",
              tags: ["添加笔记", "自动恢复"],
              related: [],
              folder: "openclaw",
              markdown: `---\ntitle: ${marker} server exhausted 后恢复成功\n---\n\n# ${marker} server exhausted 后恢复成功\n\n- 第一条后台 job 超时后，前端进入 Worker 运维恢复并创建第二条 job。`,
            },
            layoutStrategy: { mode: "report" },
            agentDecision: { chosenAgent: "worker", reason: "knowledge note", escalationNeeded: false },
            quality: { confidence: 0.98, sourceCoverage: "source_hash_verified", unresolvedItems: [] },
            htmlDraft: { title: `${marker} server exhausted 后恢复成功`, html: "<!doctype html><html><body><main><h1>server exhausted 后恢复成功</h1></main></body></html>" },
            htmlQuality: { score: 99, passed: true, issues: [] },
            generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
            attempts: [workerAttempt, { attempt: 1, stage: "m3_obsidian_markdown", strategy: "normal", status: "passed", reason: "ok", confidence: 0.98 }],
            diagnosis: null,
            retryBudget: { used: 1, max: 3, exhausted: false },
            debugReports: ["/tmp/knowledge-note-exhausted.json"],
            nextActions: [],
            knowledgeNotePipelineVersion: "m3-html-v3",
          },
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await noteDialog.getByLabel("标题").fill(`${marker} server exhausted`);
  await noteDialog.locator(".folder-input-row input").fill("openclaw");
  await noteDialog.getByLabel("原始笔记").fill(`${marker} 第一条后台 job 用尽服务器重试后，必须自动进入 Worker 运维并重建 job。`);
  await noteDialog.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => firstPollCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => secondPollCalls, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => opsTaskCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(noteDialog.getByLabel("标题")).toHaveValue(`${marker} server exhausted 后恢复成功`, { timeout: 30_000 });
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("已尝试 1/3 次自动修复", { timeout: 30_000 });
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toBeVisible();
});

test("Calendar Add Note keeps background job running when minimized", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(test.info().project.name === "mobile", "Desktop assistant calendar command bar is covered by desktop and tablet projects.");
  const jobId = `${marker}_calendar_minimized_job`;
  let jobCreateCalls = 0;
  let jobPollCalls = 0;
  let jobListCalls = 0;
  let noteSaveCalls = 0;
  const workerAttempt = {
    attempt: 1,
    stage: "worker_system_ops_recovery",
    strategy: "server_side_shadow_watchdog_then_retry",
    status: "passed",
    reason: "previous_gateway_recovery",
    repairDirectives: ["Worker system_ops shadow 巡检", "恢复后重试 Gateway/MiniMax 整理"],
    debugReportPath: "/tmp/knowledge-note-calendar-recovery.json",
  };
  const successfulCalendarResult = {
    ok: true,
    qualityMode: "m3-html",
    draft: {
      rawContent: `${marker} 日程笔记后台执行`,
      title: `${marker} 日程后台整理成功`,
      date: "2026-06-15",
      type: "工作记录",
      status: "仅供参考",
      tags: ["日程笔记", "后台执行"],
      related: [],
      folder: "calendar/2026-06",
      markdown: `---\ntitle: ${marker} 日程后台整理成功\n---\n\n# ${marker} 日程后台整理成功\n\n- 最小化后后台 job 仍继续轮询并进入预览。`,
    },
    layoutStrategy: { mode: "report" },
    agentDecision: { chosenAgent: "worker", reason: "calendar knowledge note", escalationNeeded: false },
    quality: { confidence: 0.98, sourceCoverage: "source_hash_verified", unresolvedItems: [] },
    htmlDraft: { title: `${marker} 日程后台整理成功`, html: "<!doctype html><html><body><main><h1>日程后台整理成功</h1></main></body></html>" },
    htmlQuality: { score: 99, passed: true, issues: [] },
    generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
    attempts: [workerAttempt, { attempt: 1, stage: "m3_obsidian_markdown", strategy: "normal", status: "passed", reason: "ok", confidence: 0.98 }],
    diagnosis: null,
    retryBudget: { used: 1, max: 3, exhausted: false },
    debugReports: ["/tmp/knowledge-note-calendar-recovery.json"],
    nextActions: [],
    knowledgeNotePipelineVersion: "m3-html-v3",
  };

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, name: "E2E" } }),
    });
  });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, service: "openclaw-workbench", setupRequired: false }),
    });
  });

  await page.route("**/api/calendar?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        events: [],
        todos: [],
        planItems: [],
        notes: noteSaveCalls > 0 ? [{
          id: `${marker}_calendar_note`,
          title: `${marker} 日程后台整理成功`,
          date_key: "2026-06-15",
          summary: "已保存的日程知识笔记。",
          tags: ["日程笔记", "后台执行"],
          knowledge_entry_id: `${marker}_entry`,
          knowledge_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.md`,
          knowledge_html_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.html`,
          html_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.html`,
        }] : [],
        reports: [],
        holidays: [],
      }),
    });
  });

  await page.route("**/api/knowledge/folders?scope=notes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, folders: [{ path: "/Users/njx/openclaw_data/memory/knowledge/notes/calendar", relativePath: "calendar" }] }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs", async (route) => {
    jobCreateCalls += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: "running",
          phase: "m3_pipeline",
          message: "正在后台执行 Gateway/MiniMax 整理；仍在等待最终文本。",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [workerAttempt],
          debugReports: ["/tmp/knowledge-note-calendar-recovery.json"],
          result: null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route(`**/api/knowledge/notes/organize-jobs/${jobId}`, async (route) => {
    jobPollCalls += 1;
    const succeeded = jobPollCalls >= 4;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          id: jobId,
          status: succeeded ? "succeeded" : "running",
          phase: succeeded ? "preview_ready" : "m3_pipeline",
          message: succeeded ? "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。" : "正在后台执行 Gateway/MiniMax 整理；仍在等待最终文本。",
          createdAt: new Date(Date.now() - 12_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [workerAttempt],
          debugReports: ["/tmp/knowledge-note-calendar-recovery.json"],
          opsRecovery: { status: "RECOVERED", attempts: 1, retryRecommended: true, reports: ["/tmp/knowledge-note-calendar-recovery.json"], blockers: [], nextActions: ["自动重试添加笔记"] },
          result: succeeded ? successfulCalendarResult : null,
          failure: null,
        },
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });

  await page.route("**/api/knowledge/notes/organize-jobs?*", async (route) => {
    jobListCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        jobs: noteSaveCalls > 0 ? [{
          id: jobId,
          status: "succeeded",
          phase: "preview_ready",
          message: "Gateway/MiniMax 已返回可保存 Markdown 与 HTML，草稿可进入预览。",
          createdAt: new Date(Date.now() - 30_000).toISOString(),
          updatedAt: new Date().toISOString(),
          attempts: [workerAttempt],
          result: successfulCalendarResult,
          failure: null,
        }] : [],
      }),
    });
  });

  await page.route("**/api/knowledge/notes", async (route) => {
    noteSaveCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        note: {
          title: `${marker} 日程后台整理成功`,
          entryId: `${marker}_entry`,
          path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.md`,
          htmlPath: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.html`,
        },
      }),
    });
  });

  await page.route("**/api/calendar/notes/link", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        note: {
          id: `${marker}_calendar_note`,
          title: `${marker} 日程后台整理成功`,
          date_key: "2026-06-15",
          summary: "已保存的日程知识笔记。",
          tags: ["日程笔记", "后台执行"],
          knowledge_entry_id: `${marker}_entry`,
          knowledge_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.md`,
          knowledge_html_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.html`,
          html_path: `/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/${marker}.html`,
        },
      }),
    });
  });

  await page.route("**/api/knowledge/preview?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        type: "markdown",
        content: `# ${marker} 日程后台整理成功\n\n已保存的日程知识笔记。`,
      }),
    });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "智能助理" })).toBeVisible();
  await page.locator(".calendar-note-actions-inline").getByRole("button", { name: "+ 添加知识笔记" }).click();
  const panel = page.getByLabel("智能助理添加知识笔记");
  await expect(panel).toBeVisible();
  await panel.getByLabel("标题").fill(`${marker} 日程后台整理`);
  await panel.getByLabel("原始笔记").fill(`${marker} 日程添加笔记需要最小化后继续后台执行。`);
  await panel.getByRole("button", { name: "整理预览" }).click();

  await expect.poll(() => jobCreateCalls, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => jobPollCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(panel.locator(".note-ai-status")).not.toHaveClass(/fallback/);
  await expect(panel.locator(".note-stage-list span.active")).toContainText("整理 Obsidian 笔记");
  const runningMotion = await panel.evaluate((node) => {
    const progressFill = node.querySelector(".note-progress-fill");
    const activeStage = node.querySelector(".note-stage-list span.active");
    const statusCard = node.querySelector(".note-ai-status.running");
    return {
      progressFillAnimation: progressFill ? getComputedStyle(progressFill).animationName : "",
      activeStageAnimation: activeStage ? getComputedStyle(activeStage, "::before").animationName : "",
      statusCardAnimation: statusCard ? getComputedStyle(statusCard, "::after").animationName : "",
    };
  });
  expect(runningMotion.progressFillAnimation).toContain("note-progress-flow");
  expect(runningMotion.activeStageAnimation).toContain("note-stage-breathe");
  expect(runningMotion.statusCardAnimation).toContain("note-status-drift");
  await panel.getByRole("button", { name: "最小化后台执行" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".calendar-note-background-strip")).toContainText("后台整理");
  await expect.poll(() => jobPollCalls, { timeout: 45_000 }).toBeGreaterThanOrEqual(4);

  await page.locator(".calendar-note-background-strip").getByRole("button", { name: /查看后台整理|查看生成结果/ }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("标题")).toHaveValue(`${marker} 日程后台整理成功`, { timeout: 30_000 });
  await expect(panel.getByRole("button", { name: "保存到知识库并加入日程" })).toBeVisible();
  await panel.getByRole("button", { name: "保存到知识库并加入日程" }).click();

  await expect.poll(() => noteSaveCalls, { timeout: 30_000 }).toBe(1);
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("日程内查看笔记")).toContainText(`${marker} 日程后台整理成功`, { timeout: 30_000 });
  await expect.poll(() => jobListCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "+ 添加知识笔记" })).toBeVisible();
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "查看生成结果" })).toHaveCount(0);
  await expect(page.locator(".calendar-note-background-strip")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("openclaw.calendarKnowledgeNoteConsumed.v1") || "")).toContain(jobId);

  await page.evaluate(() => {
    window.sessionStorage.removeItem("openclaw.calendarKnowledgeNoteConsumed.v1");
  });
  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "智能助理" })).toBeVisible();
  await page.locator(".calendar-day-detail").scrollIntoViewIfNeeded();
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "+ 添加知识笔记" })).toBeVisible();
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "查看生成结果" })).toHaveCount(0);
  await expect(page.locator(".calendar-note-background-strip")).toHaveCount(0);

  await page.evaluate(() => {
    window.localStorage.removeItem("openclaw.calendarKnowledgeNoteConsumed.v1");
    window.sessionStorage.removeItem("openclaw.calendarKnowledgeNoteConsumed.v1");
  });
  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "智能助理" })).toBeVisible();
  await page.locator(".calendar-day-detail").scrollIntoViewIfNeeded();
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "+ 添加知识笔记" })).toBeVisible();
  await expect(page.locator(".calendar-note-actions-inline").getByRole("button", { name: "查看生成结果" })).toHaveCount(0);
  await expect(page.locator(".calendar-note-background-strip")).toHaveCount(0);

  await page.locator(".calendar-note-actions-inline").getByRole("button", { name: "+ 添加知识笔记" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("原始笔记")).toHaveValue("");
  await expect(panel.getByRole("button", { name: "整理预览" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "保存到知识库并加入日程" })).toHaveCount(0);
  expect(noteSaveCalls).toBe(1);
});
