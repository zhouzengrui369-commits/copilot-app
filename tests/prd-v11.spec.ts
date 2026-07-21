import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Locator, type Page } from "@playwright/test";

const marker = "WB_E2E_20260511";
let cookieHeader = "";
const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const testToken = process.env.OPENCLAW_WORKBENCH_TEST_TOKEN || "";
const petPositionStorageKey = "openclaw_workbench_codex_pet_position";
const reminderExcelPaths = [
  "/Volumes/南极熊-1/01人生规划/自我修炼/年度工作计划20260522.xlsx",
  "/Volumes/南极熊-1/01人生规划/自我修炼/个人事项20260522.xlsx",
];
const dataDir = process.env.OPENCLAW_DATA_DIR || new URL("../data", import.meta.url).pathname;
const db = new DatabaseSync(path.join(dataDir, "workbench.sqlite"));
db.exec("PRAGMA busy_timeout = 5000");
const sessionHashes: string[] = [];

test.beforeEach(async ({ context }) => {
  const token = `${marker}_${crypto.randomUUID()}`;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  let name = "owb_session";
  let value = encodeURIComponent(token);
  if (testToken) {
    name = "owb_test_session";
    value = testToken;
  } else {
    sessionHashes.push(tokenHash);
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, 1, expires, now);
  }
  cookieHeader = `${name}=${encodeURIComponent(value)}`;
  await context.addInitScript(() => {
    window.confirm = () => true;
  });
  await context.addCookies([{ name, value, url: baseUrl }]);
});

test.afterAll(() => {
  for (const hash of sessionHashes) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
  const taskIds = db.prepare("SELECT id FROM tasks WHERE title LIKE ?").all(`${marker}%`) as Array<{ id: string }>;
  for (const row of taskIds) {
    db.prepare("DELETE FROM approvals WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM task_events WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM development_run_events WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM development_artifacts WHERE task_id = ?").run(row.id);
    db.prepare("UPDATE development_work_packets SET active_task_id = NULL WHERE active_task_id = ?").run(row.id);
    db.prepare("DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?").run(row.id, row.id);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(row.id);
  }
  const chatRows = db.prepare("SELECT DISTINCT session_id FROM chat_attachments WHERE name LIKE ? UNION SELECT DISTINCT session_id FROM chat_messages WHERE content LIKE ?").all(`${marker}%`, `%${marker}%`) as Array<{ session_id: string }>;
  for (const row of chatRows) {
    db.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(row.session_id);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(row.session_id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(row.session_id);
  }
  db.prepare("DELETE FROM cron_jobs WHERE name LIKE ? OR prompt LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM approvals WHERE details LIKE ?").run(`%${marker}%`);
  db.prepare("DELETE FROM inbox_items WHERE title LIKE ? OR body LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM knowledge_preview_chats WHERE question LIKE ? OR answer LIKE ?").run(`%${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM knowledge_output_jobs WHERE title LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM knowledge_entries WHERE title LIKE ? OR summary LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM report_templates WHERE name LIKE ? OR content LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM reports WHERE title LIKE ? OR content LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM model_configs WHERE label LIKE ? OR model LIKE ?").run(`${marker}%`, `${marker}%`);
  db.prepare("DELETE FROM todo_sync_conflicts WHERE todo_id IN (SELECT id FROM todos WHERE title LIKE ? OR title LIKE ? OR notes LIKE ?)").run(`${marker}%`, `%${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM todo_sync_links WHERE todo_id IN (SELECT id FROM todos WHERE title LIKE ? OR title LIKE ? OR notes LIKE ?)").run(`${marker}%`, `%${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM todos WHERE title LIKE ? OR title LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM event_sync_conflicts WHERE event_id IN (SELECT id FROM events WHERE title LIKE ? OR title LIKE ?)").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM event_sync_links WHERE event_id IN (SELECT id FROM events WHERE title LIKE ? OR title LIKE ?)").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM events WHERE title LIKE ? OR title LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM opc_orders WHERE external_id LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM opc_order_items WHERE title LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM opc_skus WHERE sku LIKE ? OR name LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM opc_suppliers WHERE name LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM opc_campaigns WHERE name LIKE ? OR notes LIKE ?").run(`${marker}%`, `%${marker}%`);
  db.prepare("DELETE FROM opc_cashflows WHERE description LIKE ? OR category LIKE ?").run(`${marker}%`, `${marker}%`);
  db.prepare("DELETE FROM opc_risks WHERE title LIKE ? OR mitigation LIKE ?").run(`${marker}%`, `%${marker}%`);
  const connectorRows = db.prepare("SELECT id, provider FROM opc_integration_accounts WHERE key_ref LIKE ?").all(`${marker}%`) as Array<{ id: string; provider: string }>;
  for (const row of connectorRows) {
    const defaultRef = row.provider === "shopify" ? "SHOPIFY_ADMIN_TOKEN" : row.provider === "meta_ads" ? "META_MARKETING_TOKEN" : row.provider === "1688" ? "ALIBABA_OPEN_TOKEN" : row.provider === "xianyu" ? "XIANYU_OPEN_TOKEN_OR_MANUAL_IMPORT" : "";
    db.prepare("UPDATE opc_integration_accounts SET status = 'not_configured', mode = 'dry_run', key_ref = ?, credential_configured = 0, credential_hint = '', last_error = '', updated_at = ? WHERE id = ?").run(defaultRef, new Date().toISOString(), row.id);
  }
  const projectIds = db.prepare("SELECT id FROM projects WHERE name LIKE ?").all(`${marker}%`) as Array<{ id: string }>;
  for (const row of projectIds) {
    db.prepare("DELETE FROM development_subtask_acceptance WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_subtasks WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_baselines WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_product_roles WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_project_workspaces WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_review_records WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_context_manifests WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_gate_definitions WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_plugin_registry WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_tool_registry WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_work_packets WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_gates WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_artifacts WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_run_events WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_runs WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_stages WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_documents WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM development_project_profiles WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM project_deliverables WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM project_milestones WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(row.id);
  }
  db.close();
});

function desktopOnly(testInfo: { project: { name: string } }) {
  test.skip(testInfo.project.name !== "desktop", "full interaction flow runs once; responsive coverage runs in every project");
}

function localDateTimeInput(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function openPage(page: Page, label: string) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".sidebar nav").getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("main.main")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(size.scrollWidth, `${label} overflow: ${size.scrollWidth} > ${size.clientWidth}`).toBeLessThanOrEqual(size.clientWidth + 2);
}

async function triggerMention(page: Page, textarea: Locator, value: string) {
  await textarea.click();
  await textarea.fill("");
  await expect(textarea).toHaveValue("");
  await textarea.pressSequentially(value, { delay: 15 });
  await expect(page.locator(".mention-palette")).toBeVisible({ timeout: 10_000 });
}

test("PRD v1.1 navigation and responsive layout", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByText("OpenClaw").first()).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const globalSearch = page.getByPlaceholder(/搜索任务/);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    if (!await globalSearch.evaluate((el) => document.activeElement === el)) await globalSearch.click();
    await expect(globalSearch).toBeFocused();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J");
  } else {
    await page.getByPlaceholder(/搜索任务/).click();
    await expect(page.getByPlaceholder(/搜索任务/)).toBeFocused();
    await page.getByRole("button", { name: "智能助理", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "智能助理" })).toBeVisible();
  const sidebarPosition = await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).position);
  expect(sidebarPosition).toBe("sticky");

  await expect(page.locator(".sidebar nav").getByRole("button", { name: "指挥台", exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "任务", exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "总览", exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "深度研究", exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "OPC", exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "项目管理", exact: true })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    for (const english of ["Chat", "Agent", "Assistant", "Knowledge", "Dev Console", "Projects", "System"]) {
      await expect(page.locator(".sidebar nav").getByText(english, { exact: true })).toBeVisible();
    }
    for (const hiddenEnglish of ["Dashboard", "Research", "Business"]) {
      await expect(page.locator(".sidebar nav").getByText(hiddenEnglish, { exact: true })).toHaveCount(0);
    }
  }
  for (const label of ["对话", "智能体", "智能助理", "知识库", "开发台", "项目管理", "系统设置"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalOverflow(page, label);
  }
  for (const [legacyPath, expectedHeading] of [["/overview", "系统设置"], ["/mobile", "系统设置"], ["/research", "系统设置"], ["/opc", "项目管理"]] as const) {
    await page.goto(legacyPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();
    await expectNoHorizontalOverflow(page, legacyPath);
  }
});

test("Development console keeps top global nav and runs on real development domain state", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const projectName = `${marker}_${testInfo.project.name}_development_project`;
  const createdProject = await request.post("/api/development/projects", {
    headers: { Cookie: cookieHeader },
    data: { name: projectName, objective: `${marker} validates development domain`, description: "E2E development project", previewUrl: "http://127.0.0.1:38888/delivery" },
  });
  expect(createdProject.ok()).toBeTruthy();
  const createdJson = await createdProject.json();
  expect(createdJson.detail.workPackets.length).toBeGreaterThan(0);
  expect(createdJson.detail.workspace.workspacePath).toContain("development_projects");
  expect(createdJson.detail.productRole.title).toContain("Product Manager");
  expect(createdJson.detail.baseline.subtasks.length).toBeGreaterThan(0);
  const baselineLock = await request.post(`/api/development/projects/${createdJson.project.id}/baseline/lock`, { headers: { Cookie: cookieHeader } });
  expect(baselineLock.ok()).toBeTruthy();
  const baselineJson = await baselineLock.json();
  const currentSubtask = baselineJson.baseline.currentSubtask;
  const nextSubtask = baselineJson.baseline.subtasks.find((item: any) => item.id !== currentSubtask.id);
  const outOfOrder = await request.post(`/api/development/subtasks/${nextSubtask.id}/run`, { headers: { Cookie: cookieHeader } });
  expect(outOfOrder.status()).toBe(409);
  expect(await outOfOrder.text()).toContain("out_of_order_subtask");
  const currentRun = await request.post(`/api/development/subtasks/${currentSubtask.id}/run`, { headers: { Cookie: cookieHeader } });
  expect(currentRun.ok()).toBeTruthy();
  const failedAcceptance = await request.post(`/api/development/subtasks/${currentSubtask.id}/acceptance`, { headers: { Cookie: cookieHeader }, data: { status: "passed", score: 92, evidence: "" } });
  expect(failedAcceptance.ok()).toBeTruthy();
  expect((await failedAcceptance.json()).acceptance.status).not.toBe("passed");
  const passedAcceptance = await request.post(`/api/development/subtasks/${currentSubtask.id}/acceptance`, { headers: { Cookie: cookieHeader }, data: { status: "passed", score: 92, evidence: `${marker} e2e evidence` } });
  expect(passedAcceptance.ok()).toBeTruthy();
  const passedJson = await passedAcceptance.json();
  expect(passedJson.acceptance.status).toBe("passed");
  expect(passedJson.baseline.currentSubtask.id).not.toBe(currentSubtask.id);
  const override = await request.post(`/api/development/subtasks/${passedJson.baseline.currentSubtask.id}/override`, { headers: { Cookie: cookieHeader }, data: { action: "force_pass", reason: marker } });
  expect(override.ok()).toBeTruthy();
  expect((await override.json()).requiresApproval).toBeTruthy();
  const toolRes = await request.get(`/api/development/projects/${createdJson.project.id}/tool-registry`, { headers: { Cookie: cookieHeader } });
  expect(toolRes.ok()).toBeTruthy();
  expect(JSON.stringify(await toolRes.json())).toContain("gateway");
  const gateDefRes = await request.get(`/api/development/projects/${createdJson.project.id}/gate-definitions`, { headers: { Cookie: cookieHeader } });
  expect(gateDefRes.ok()).toBeTruthy();
  expect(JSON.stringify(await gateDefRes.json())).toContain("no_fake_ok");
  const pluginRes = await request.get(`/api/development/projects/${createdJson.project.id}/plugins`, { headers: { Cookie: cookieHeader } });
  expect(pluginRes.ok()).toBeTruthy();
  expect(JSON.stringify(await pluginRes.json())).toContain("openclaw-delivery-core");
  const reviewsRes = await request.get(`/api/development/projects/${createdJson.project.id}/reviews`, { headers: { Cookie: cookieHeader } });
  expect(reviewsRes.ok()).toBeTruthy();
  expect(JSON.stringify(await reviewsRes.json())).toContain("Product Taste");
  const reviewRun = await request.post(`/api/development/projects/${createdJson.project.id}/reviews/run`, {
    headers: { Cookie: cookieHeader },
    data: { workPacketId: createdJson.detail.activeWorkPacket?.id || "" },
  });
  expect(reviewRun.ok()).toBeTruthy();
  const manifestRes = await request.get(`/api/development/projects/${createdJson.project.id}/context-manifest/latest`, { headers: { Cookie: cookieHeader } });
  expect(manifestRes.ok()).toBeTruthy();
  expect(JSON.stringify(await manifestRes.json())).toContain("development-context-manifest/v2");
  await page.goto("/delivery", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "开发台", exact: true })).toBeVisible();
  await expect(page.locator(".development-title-row h1")).toHaveText(/AOG Co-pilot/);
  await expect(page.getByText("项目任务基线").first()).toBeVisible();
  await expect(page.getByText("修复 web_search 降级阻塞").first()).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("position", "sticky");
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "任务", exact: true })).toHaveCount(0);
  await expect(page.locator(".development-project-rail")).toBeVisible();
  await expect(page.locator(".development-dialogue-column")).toBeVisible();
  await expect(page.locator(".development-board-column")).toBeVisible();
  await expect(page.locator(".development-sticky-brief .development-baseline-board")).toHaveCount(0);
  await expect(page.locator(".development-board-column .development-baseline-board")).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await expect(page.locator(".dev-review-strip")).toBeVisible();
    await page.locator(".dev-review-strip button").filter({ hasText: "Product Taste" }).first().click();
    await expect(page.locator(".development-doc-drawer")).toBeVisible();
    await expect(page.locator(".development-doc-drawer .development-panel-head h2")).toHaveText(/Product Taste/);
    await expect(page.locator(".development-doc-drawer .dev-source-box")).toContainText("Reviewer");
    await page.locator(".development-doc-drawer .development-drawer-close").click();
    await page.locator(".board-gate-list button").first().click();
    await expect(page.locator(".development-doc-drawer .dev-source-box")).toContainText(/development_gates|Gate|gate/i);
    await page.locator(".development-doc-drawer .development-drawer-close").click();
    await page.locator(".dev-plugin-list button").filter({ hasText: /Web Search|Delivery Core/ }).first().click();
    await expect(page.locator(".development-doc-drawer .dev-source-box")).toContainText(/plugin|skill|tool/i);
    await page.locator(".development-doc-drawer .development-drawer-close").click();
    await page.locator(".dev-record-list button").first().click();
    await expect(page.locator(".development-doc-drawer .dev-source-box")).toContainText(/development_artifacts|artifact|source|evidence/i);
    await page.locator(".development-doc-drawer .development-drawer-close").click();
    await page.locator(".board-doc-tabs").getByRole("button", { name: /PRD/ }).click();
    await expect(page.locator(".development-doc-drawer")).toBeVisible();
    await expect(page.locator(".development-doc-drawer .development-panel-head h2")).toHaveText(/PRD\.md|目标/);
  }
  await expect(page.getByRole("button", { name: /开发报告/ })).toBeVisible();
  await expect(page.locator(".dev-tree-actions").getByText("自动化")).toHaveCount(0);
  await expect(page.locator(".dev-tree-actions").getByText("插件 / Skill")).toHaveCount(0);
  await expect(page.locator(".development-status-row").getByRole("button", { name: /Shadow 检查/ })).toBeVisible();
  if (await page.locator(".development-doc-drawer").count() === 0) {
    await page.locator(".board-doc-tabs").getByRole("button", { name: /PRD/ }).click();
  }
  await expect(page.locator(".development-doc-drawer")).toBeVisible();
  await expect(page.getByText("/Users/njx/openclaw_data/tasks/development_projects/aog-copilot/PRD.md")).toBeVisible();
  await page.locator(".development-doc-drawer .development-drawer-close").click();
  await expect(page.getByText("TASK_20260520_002")).toHaveCount(0);
  await expect(page.getByLabel("思考中")).toHaveCount(0);
  if (testInfo.project.name === "desktop") {
    const boardBox = await page.locator(".development-board-column").boundingBox();
    expect(boardBox?.width || 0).toBeGreaterThanOrEqual(360);
  }
  await page.getByRole("button", { name: /Chat Agent/ }).first().click();
  await expect(page.locator(".development-title-row h1")).toHaveText(/Chat Agent/);
  await expect(page.locator(".development-board-column")).toContainText(/Chat Agent|项目看板/);
  await expect(page.locator(".development-doc-drawer")).toHaveCount(0);
  await page.getByRole("button", { name: /AOG Co-pilot/ }).first().click();
  await page.getByRole("button", { name: /修复 web_search 降级阻塞/ }).first().click();
  await expect(page.getByText(/web_search 未配置|Brave API|fake OK/).first()).toBeVisible();
  await expect(page.locator(".dev-blocker-decision")).toContainText(/搜索配置门控|配置凭据|Browser fallback/);
  await expect(page.getByLabel("推荐下一步").getByRole("button", { name: /配置搜索凭据/ })).toBeVisible();
  await expect(page.getByLabel("推荐下一步").getByRole("button", { name: /申请浏览器降级/ })).toBeVisible();
  await page.locator(".dev-composer-suggestions").getByRole("button", { name: /申请浏览器降级/ }).click();
  await expect(page.getByPlaceholder(/同意执行/)).toHaveValue(/Browser fallback/);
  await page.locator(".dev-composer-suggestions").getByRole("button", { name: /人工输入/ }).click();
  await expect(page.getByPlaceholder(/同意执行/)).toBeFocused();
  await expect(page.getByPlaceholder(/同意执行/)).toHaveValue(/Browser fallback/);
  await expect(page.getByPlaceholder(/同意执行/)).toBeVisible();
  await expect(page.getByPlaceholder(/同意执行/)).toHaveJSProperty("tagName", "TEXTAREA");
  await page.locator(".development-status-row").getByRole("button", { name: /执行当前/ }).click();
  await expect(page.locator(".dev-composer-progress")).toBeVisible();
  await expect(page.locator(".dev-execution-pulse")).toBeVisible();
  await expect(page.locator(".development-thread")).toContainText(/已发送执行指令|正在准备子任务/);
  await expect(page.locator(".dev-composer-notice")).toContainText(/已发送执行指令|搜索配置门控|Browser fallback/);
  await page.locator(".board-doc-tabs").getByRole("button", { name: /计划/ }).click();
  await expect(page.locator(".development-doc-drawer .development-panel-head h2")).toHaveText(/PLAN\.md|目标/);
  await expect(page.locator(".development-doc-drawer .dev-source-box code")).toContainText("TASK_20260519_002");
  await page.locator(".development-doc-drawer .development-drawer-close").click();
  await page.locator(".board-doc-tabs").getByRole("button", { name: /结果/ }).click();
  await expect(page.locator(".development-doc-drawer .development-panel-head h2")).toHaveText(/RESULT\.md/);
  await page.locator(".development-doc-drawer .development-drawer-close").click();
  await page.getByPlaceholder(/搜索项目/).fill(marker);
  await page.locator(".development-project-rail .dev-tree-folder").filter({ hasText: projectName }).click();
  await expect(page.locator(".development-title-row h1")).toHaveText(new RegExp(projectName));
  await expect(page.getByText(/项目任务基线 v1/).first()).toBeVisible();
  await expect(page.getByText(/定义目标和 PRD/).first()).toBeVisible();
  await page.locator(".development-project-rail .dev-tree-row.sub").filter({ hasText: /拆解实现任务/ }).first().click();
  await expect(page.locator(".development-thread")).toContainText(/拆解实现任务/);
  await page.getByPlaceholder(/同意执行/).fill("继续执行当前子任务");
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".dev-execution-pulse")).toBeVisible();
  await expect(page.locator(".dev-execution-pulse")).toContainText(/已发送|执行中|阻塞收敛|已收敛/);
  await expect(page.locator(".board-execution-section")).toBeVisible();
  await expect(page.locator(".dev-composer-notice")).toContainText(/已触发当前子任务|仍有阻塞/);
  await page.locator(".dev-tool-select").first().selectOption("人工审批");
  await page.getByPlaceholder(/同意执行/).fill(`${marker}_manual_acceptance_evidence`);
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".dev-composer-notice")).toContainText(/人工确认通过|人工确认未通过/);
  await page.locator(".dev-tool-select").first().selectOption("自动审查");
  await page.getByPlaceholder(/同意执行/).fill(`${marker}_plain_development_message`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".dev-composer-notice")).toContainText(/已记录到开发记录/);
  await expect(page.locator(".development-thread")).toContainText(`${marker}_plain_development_message`);
  await page.getByPlaceholder(/同意执行/).fill(`申请基线修订：${marker}_baseline_revision_request`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/高风险动作|审批|approval/).first()).toBeVisible();
  await page.getByRole("button", { name: /归档所选/ }).click();
  await page.getByRole("button", { name: "打开附加菜单" }).click();
  const quickMenu = page.locator(".dev-quick-menu");
  await expect(quickMenu.getByText("执行当前")).toBeVisible();
  await expect(quickMenu.getByText("申请验收")).toBeVisible();
  await expect(quickMenu.getByText("申请基线修订")).toBeVisible();
  await expect(quickMenu.getByText("添加照片和文件")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `development-${testInfo.project.name}`);
  if (testInfo.project.name === "desktop") {
    await page.screenshot({ path: "/Users/njx/openclaw_data/tasks/TASK_20260523_010_dev_console_board_drawer/development-console-board-drawer-playwright.png", fullPage: true });
  }
});

test("Agent integrates command center and System exposes ops review", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(60_000);
  await openPage(page, "智能体");
  await expect(page.getByRole("heading", { name: "智能体" })).toBeVisible();
  await expect(page.getByRole("button", { name: /运行指挥/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OpenClaw 三代理当前工作状态" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "三代理运行态" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OpenClaw 代理任务队列" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "动态产出遥测" })).toBeVisible();
  for (const label of ["Main", "Boss", "Worker"]) await expect(page.locator(".agent-runtime-row strong").filter({ hasText: new RegExp(`^${label} ·`) }).first()).toBeVisible();
  await expect(page.getByText("飞书渠道配置")).toHaveCount(0);
  await expect(page.getByText(/Token/).first()).toBeVisible();
  await expect(page.getByText("文字编辑量").first()).toBeVisible();
  await expect(page.getByText("文档产出量").first()).toBeVisible();
  await openPage(page, "系统设置");
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByText("系统告警")).toBeVisible();
  await expect(page.getByText("连接器与运行能力")).toBeVisible();
});

test("System settings exposes configurable read-only cockpit", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(60_000);
  const today = localDateTimeInput();
  const taskRes = await request.post("/api/tasks", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_dashboard_task`, description: `${marker} dashboard task`, agentId: "boss", riskLevel: "high", priority: "P1" },
  });
  expect(taskRes.ok()).toBeTruthy();
  const todoRes = await request.post("/api/todos", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_dashboard_todo`, priority: "P1", dueAt: today, tags: ["dashboard"] },
  });
  expect(todoRes.ok()).toBeTruthy();
  const eventRes = await request.post("/api/events", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_dashboard_event`, startAt: today, eventType: "schedule" },
  });
  expect(eventRes.ok()).toBeTruthy();
  const projectRes = await request.post("/api/projects", {
    headers: { Cookie: cookieHeader },
    data: { name: `${marker}_dashboard_project`, status: "active", objective: "Dashboard V2" },
  });
  expect(projectRes.ok()).toBeTruthy();
  const overviewRes = await request.get("/api/overview", { headers: { Cookie: cookieHeader } });
  expect(overviewRes.ok()).toBeTruthy();
  const overviewJson = await overviewRes.json();
  expect(JSON.stringify(overviewJson.today)).toContain(`${marker}_dashboard_todo`);
  expect(JSON.stringify(overviewJson.today)).toContain(`${marker}_dashboard_event`);

  await page.goto("/system", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: /系统总览/ })).toBeVisible();
  await expect(page.getByText("高优先级告警", { exact: true })).toBeVisible();
  for (const title of ["三代理缩略档案", "今日工作区", "任务摘要", "知识库状态", "项目与产出", "成本与资源"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await expect(page.getByText(`${marker}_dashboard_todo`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${marker}_dashboard_event`)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "配置卡片" }).click();
  await expect(page.getByRole("heading", { name: "卡片配置" })).toBeVisible();
  await page.getByRole("button", { name: "运维视角" }).click();
  await expect(page.getByText("当前：运维视角")).toBeVisible();
  await page.locator(".dashboard-config-row").filter({ hasText: "成本与资源" }).getByRole("combobox").selectOption("medium");
  await page.locator(".dashboard-config-row").filter({ hasText: "成本与资源" }).getByRole("spinbutton").fill("70");
  await expect(page.locator(".dashboard-config-row").filter({ hasText: "成本与资源" }).getByRole("spinbutton")).toHaveValue("70");

  await page.locator(".dashboard-widget").filter({ hasText: "三代理缩略档案" }).getByRole("button", { name: "进入模块" }).click();
  await expect(page.getByRole("heading", { name: "智能体" })).toBeVisible();
});

test("Agent operations exposes multi-agent command and intervention queues", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(60_000);
  const res = await request.post("/api/tasks", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_command_task`, description: `${marker} command center task`, agentId: "boss", riskLevel: "high", priority: "P1" },
  });
  expect(res.ok()).toBeTruthy();
  await openPage(page, "智能体");
  await expect(page.getByRole("heading", { name: "智能体" })).toBeVisible();
  await expect(page.getByRole("button", { name: /运行指挥/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "三代理运行态" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OpenClaw 代理任务队列" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "动态产出遥测" })).toBeVisible();
  await expect(page.getByText(`${marker}_command_task`).first()).toBeVisible();
  await expect(page.locator(".agent-runtime-queue").getByText(/等待人工审批|等待确认执行|等待代理执行|等待上游条件/).first()).toBeVisible();
});

test("hidden tasks route renders agent workbench kanban and task detail", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(60_000);
  const res = await request.post("/api/tasks", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_task`, description: marker, agentId: "worker", riskLevel: "high", priority: "P1" },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/tasks", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "智能体" })).toBeVisible();
  await page.getByText("历史 / Kanban 概览").click();
  await expect(page.getByRole("heading", { name: "Kanban 摘要" })).toBeVisible();
  const taskButton = page.locator(".task-workbench-kanban button").filter({ hasText: `${marker}_task` }).first();
  await expect(taskButton).toBeVisible({ timeout: 10_000 });
  await taskButton.click();
  await expect(page.locator(".task-workbench-detail")).toContainText(`${marker}_task`);
  await expect(page.locator("summary").filter({ hasText: "任务讨论" })).toBeVisible();
});

test("chat supports @ knowledge and skill mentions plus repeated attachments", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript((key) => {
    const clearedKey = `${key}_cleared_for_test`;
    if (!window.sessionStorage.getItem(clearedKey)) {
      window.localStorage.removeItem(key);
      window.sessionStorage.setItem(clearedKey, "1");
    }
  }, petPositionStorageKey);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("button", { name: "对话", exact: true }).click();

  const textarea = page.locator(".compose-box textarea");
  await expect(textarea).toBeInViewport();
  await triggerMention(page, textarea, "@nas");
  await page.getByRole("option", { name: /^@nas 知识源/ }).click();
  await expect(page.locator(".chat-config-summary")).toContainText("@nas");

  await triggerMention(page, textarea, "@task");
  await page.getByRole("option", { name: /@task-executor/ }).click();
  await expect(page.locator(".chat-config-summary")).toContainText("@task-executor");

  await triggerMention(page, textarea, "@ima");
  await textarea.press("Escape");
  await expect(page.locator(".mention-palette")).toHaveCount(0);

  await page.locator(".chat-toolbar").getByRole("button", { name: /^附件/ }).click();
  await page.locator('input[type="file"]').setInputFiles([{ name: `${marker}_file1.txt`, mimeType: "text/plain", buffer: Buffer.from("one") }]);
  await expect(page.locator(".attachment-chips")).toContainText(`${marker}_file1.txt`);
  await page.locator(".attachment-chips").getByRole("button", { name: "预览" }).first().click();
  await expect(page.getByRole("heading", { name: "文档预览" })).toBeVisible();
  await expect(page.locator(".chat-preview-content")).toContainText("one");
  await expect(page.locator(".download-link")).toHaveAttribute("href", /download=1/);
  await page.locator(".preview-actions").getByRole("button", { name: "加入知识库" }).click();
  await expect(page.locator(".chat-preview")).toContainText("已加入知识库", { timeout: 10_000 });
  await page.locator('input[type="file"]').setInputFiles([{ name: `${marker}_file2.txt`, mimeType: "text/plain", buffer: Buffer.from("two") }]);
  await expect(page.locator(".attachment-chips")).toContainText(`${marker}_file2.txt`);

  await expect(page.locator(".codex-pet")).toContainText("MiniMax");
  await expect(page.locator(".codex-pet-floating .codex-pet")).toBeVisible();
  const pet = page.locator(".codex-pet-floating");
  const beforePet = await pet.boundingBox();
  expect(beforePet).toBeTruthy();
  if (beforePet) {
    await page.mouse.move(beforePet.x + 12, beforePet.y + 12);
    await page.mouse.down();
    await page.mouse.move(beforePet.x + 92, beforePet.y + 42);
    await page.mouse.up();
    const afterPet = await pet.boundingBox();
    expect(afterPet).toBeTruthy();
    expect(Math.abs((afterPet?.x || 0) - beforePet.x) + Math.abs((afterPet?.y || 0) - beforePet.y)).toBeGreaterThan(30);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect(pet).toBeVisible();
    const reloadedPet = await pet.boundingBox();
    expect(reloadedPet).toBeTruthy();
    const reloadedViewport = page.viewportSize() || { width: 1280, height: 720 };
    expect(reloadedPet?.x || 0).toBeGreaterThanOrEqual(0);
    expect(reloadedPet?.y || 0).toBeGreaterThanOrEqual(0);
    expect((reloadedPet?.x || 0) + (reloadedPet?.width || 0)).toBeLessThanOrEqual(reloadedViewport.width + 1);
    expect((reloadedPet?.y || 0) + (reloadedPet?.height || 0)).toBeLessThanOrEqual(reloadedViewport.height + 1);

    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    if (reloadedPet) {
      await page.mouse.move(reloadedPet.x + 12, reloadedPet.y + 12);
      await page.mouse.down();
      await page.mouse.move(viewport.width + 400, viewport.height + 400);
      await page.mouse.up();
      const edgePet = await pet.boundingBox();
      expect(edgePet).toBeTruthy();
      expect(edgePet?.x || 0).toBeGreaterThanOrEqual(0);
      expect(edgePet?.y || 0).toBeGreaterThanOrEqual(0);
      expect((edgePet?.x || 0) + (edgePet?.width || 0)).toBeLessThanOrEqual(viewport.width + 1);
      expect((edgePet?.y || 0) + (edgePet?.height || 0)).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
  if (await page.getByRole("button", { name: "新增模型" }).count() === 0) {
    await page.locator(".chat-toolbar").getByRole("button", { name: "设置" }).click();
  }
  await page.getByRole("button", { name: "新增模型" }).click();
  await page.getByPlaceholder("模型名称，例如 MiniMax M3 高速").fill(`${marker}_model`);
  await page.getByPlaceholder(/Provider/).fill("minimax");
  await page.getByPlaceholder(/Model ID/).fill(`${marker}_model_id`);
  await page.getByRole("textbox", { name: "API Key", exact: true }).fill(`${marker}_api_key`);
  await page.getByPlaceholder(/API Key 环境变量名/).fill("WB_E2E_API_KEY");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.locator(".model-select")).toContainText(`${marker}_model`, { timeout: 10_000 });
  await page.getByRole("button", { name: "新增模型" }).click();
  const createdModelRow = page.locator(".model-config-row").filter({ hasText: `${marker}_model` }).first();
  await expect(createdModelRow).toBeVisible();
  await createdModelRow.getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".model-select")).not.toContainText(`${marker}_model`, { timeout: 10_000 });
  await expect(page.locator(".model-select")).not.toContainText(/deepseek/i);
});

test("Chat full flow gives visible feedback for plan, execution, non-plan send, and message actions", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(300_000);
  page.on("dialog", (dialog) => dialog.accept());
  await openPage(page, "对话");

  const newChatResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/chat/sessions");
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  expect((await newChatResponse).ok()).toBeTruthy();
  await page.locator(".chat-toolbar").getByRole("button", { name: "设置" }).click();
  await page.locator(".chat-settings-panel select").first().selectOption("boss");
  const textarea = page.locator(".compose-box textarea");
  await triggerMention(page, textarea, "@nas");
  await page.getByRole("option", { name: /^@nas 知识源/ }).click();
  await expect(page.locator(".chat-config-summary")).toContainText("@nas");
  await triggerMention(page, textarea, "@ima");
  await page.getByRole("option", { name: /^@ima 知识源/ }).click();
  await expect(page.locator(".chat-config-summary")).toContainText("@ima");
  await triggerMention(page, textarea, "@task");
  await page.getByRole("option", { name: /@task-executor/ }).click();
  await expect(page.locator(".chat-config-summary")).toContainText("@nas");
  await expect(page.locator(".chat-config-summary")).toContainText("@ima");
  await expect(page.locator(".skill-badges")).toContainText("@task-executor");

  await page.locator(".chat-toolbar").getByRole("button", { name: /^附件/ }).click();
  await page.locator('input[type="file"]').setInputFiles([{ name: `${marker}_plan_a.txt`, mimeType: "text/plain", buffer: Buffer.from("attachment A") }]);
  await expect(page.getByText(`${marker}_plan_a.txt`)).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="file"]').setInputFiles([{ name: `${marker}_plan_b.txt`, mimeType: "text/plain", buffer: Buffer.from("attachment B") }]);
  await expect(page.getByText(`${marker}_plan_b.txt`)).toBeVisible({ timeout: 15_000 });

  await textarea.fill(`${marker} Chat plan acceptance`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(async () => {
    return await page.locator(".message.pending").count()
      + await page.locator(".message.user").filter({ hasText: `${marker} Chat plan acceptance` }).count()
      + await page.getByRole("button", { name: "确认执行" }).count();
  }, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    return await page.getByText("代理正在处理").count()
      + await page.getByRole("button", { name: "确认执行" }).count();
  }, { timeout: 10_000 }).toBeGreaterThan(0);
  await textarea.fill(`${marker} runtime guidance`);
  const interruptButton = page.getByRole("button", { name: "插队/引导" });
  if (await interruptButton.isEnabled()) {
    await interruptButton.click();
    await expect(page.getByText("插队/引导 已进入审批队列")).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(interruptButton).toBeDisabled();
  }
  await expect.poll(async () => {
    return await page.locator(".message.pending").count()
      + await page.getByRole("button", { name: "确认执行" }).count()
      + await page.locator(".message.user").filter({ hasText: `${marker} Chat plan acceptance` }).count();
  }, { timeout: 35_000 }).toBeGreaterThan(0);
  await expect(page.getByText(/openclaw-cn gateway call/i)).toHaveCount(0);
  await expect(page.getByText(/DEP0040|punycode/i)).toHaveCount(0);

  const firstActions = page.locator(".message-actions").first();
  await firstActions.getByRole("button", { name: "预览" }).click();
  await expect(page.locator(".chat-preview-content")).toContainText(marker);
  await page.locator(".preview-actions").getByRole("button", { name: "加入知识库" }).click();
  await expect(page.locator(".chat-preview")).toContainText("已加入知识库", { timeout: 10_000 });
  await page.locator(".chat-preview").getByRole("button", { name: "关闭" }).click();
  await expect(page.locator(".chat-preview")).toHaveCount(0);
  await firstActions.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(firstActions.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible({ timeout: 10_000 });
  await firstActions.getByRole("button", { name: "重新生成" }).click();
  await expect(firstActions.getByRole("button", { name: "重新生成" })).toBeVisible({ timeout: 35_000 });

  const confirmExecute = page.getByRole("button", { name: "确认执行" }).first();
  if (await confirmExecute.count()) {
    await confirmExecute.click();
    await expect.poll(async () => {
      return await page.locator(".message").filter({ hasText: /Gateway 暂不可用|已发送给|OpenClaw Gateway|confirmed|completed|gateway_unavailable/ }).count();
    }, { timeout: 35_000 }).toBeGreaterThan(0);
  }
  await expect(page.getByText(/openclaw-cn gateway call/i)).toHaveCount(0);
  await expect(page.getByText(/DEP0040|punycode/i)).toHaveCount(0);

  const planUserText = `${marker} Chat plan acceptance`;
  const userMessage = page.locator(".message.user").filter({ hasText: planUserText });
  await expect(userMessage).toHaveCount(1);
  await userMessage.getByRole("button", { name: "更多" }).click();
  const deleteResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/api\/chat\/messages\//.test(new URL(response.url()).pathname));
  await userMessage.getByRole("button", { name: "删除" }).click();
  expect((await deleteResponse).ok()).toBeTruthy();
  await expect(userMessage).toHaveCount(0);

  await page.getByRole("button", { name: "历史" }).click();
  const nonPlanChatResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/chat/sessions");
  await page.locator(".chat-history").getByRole("button", { name: "新建", exact: true }).click();
  expect((await nonPlanChatResponse).ok()).toBeTruthy();
  await page.locator(".chat-history").getByRole("button", { name: "关闭" }).click();
  await page.getByLabel("任务计划").uncheck();
  const nonPlanText = `${marker} non-plan gateway fallback\n\`\`\`ts\nconst openclaw = true;\n\`\`\``;
  await textarea.fill(nonPlanText);
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(async () => {
    return await page.locator(".message.pending").count() + await page.locator(".message").filter({ hasText: /Gateway 暂不可用|已发送给|OpenClaw Gateway/ }).count();
  }, { timeout: 2500 }).toBeGreaterThan(0);
  await expect(page.locator(".message").filter({ hasText: /Gateway 暂不可用|已发送给|OpenClaw Gateway/ }).last()).toBeVisible({ timeout: 35_000 });
  await expect(page.getByText(/openclaw-cn gateway call/i)).toHaveCount(0);
  const codeMessage = page.locator(".message.user").filter({ hasText: `${marker} non-plan gateway fallback` }).first();
  await codeMessage.getByRole("button", { name: "更多" }).click();
  await codeMessage.getByRole("button", { name: "代码" }).click();
  await expect(page.locator(".chat-preview-content .code-preview")).toContainText("const openclaw = true");
});

test("Agent console exposes agent status, cron, inbox, and config files", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openPage(page, "智能体");
  await expect(page.getByRole("heading", { name: "OpenClaw 三代理当前工作状态" })).toBeVisible();
  await expect(page.locator(".agent-runtime-row")).toHaveCount(3);
  await expect(page.locator(".agent-runtime-row").filter({ hasText: "Main" })).toBeVisible();
  await expect(page.locator(".agent-runtime-row").filter({ hasText: "Boss" })).toBeVisible();
  await expect(page.locator(".agent-runtime-row").filter({ hasText: "Worker" })).toBeVisible();
  await expect(page.locator(".agent-runtime-model").first()).toContainText(/model:/);
  await expect(page.getByRole("heading", { name: "OpenClaw 代理任务队列" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "动态产出遥测" })).toBeVisible();
  await expect(page.locator(".task-current-focus")).toBeVisible();
  await expect(page.getByText("筛选、新建任务与系统摘要")).toBeVisible();
});

test("Tasks support creation, DAG detail, and approval actions", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/tasks", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator("main.main")).toBeVisible();
  await page.getByText("筛选、新建任务与系统摘要").click();
  const title = `${marker}_task_ui`;
  await page.getByPlaceholder("任务标题").fill(title);
  await page.locator(".quick-task-form select").nth(0).selectOption("worker");
  await page.locator(".quick-task-form select").nth(1).selectOption("P1");
  await page.locator(".quick-task-form select").nth(2).selectOption("high");
  await page.getByPlaceholder("目标 / 输入材料 / 验收标准").fill(`${marker} task acceptance`);
  const createTaskResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tasks");
  await page.getByRole("button", { name: "布置任务" }).click();
  expect((await createTaskResponse).ok()).toBeTruthy();
  await page.getByText("历史 / Kanban 概览").click();
  await expect(page.getByRole("heading", { name: "Kanban 摘要" })).toBeVisible();
  const taskRow = page.locator(".task-workbench-kanban button").filter({ hasText: title }).first();
  await expect(taskRow).toBeVisible({ timeout: 10_000 });
  await taskRow.click();
  await expect(page.locator(".task-workbench-detail")).toContainText(title);
  await expect(page.locator(".task-workbench-detail")).toContainText("当前工作");

  const tasksRes = await page.request.get("/api/tasks", { headers: { Cookie: cookieHeader } });
  const tasksJson = await tasksRes.json();
  const task = tasksJson.tasks.find((row: any) => row.title === title);
  expect(task?.id).toBeTruthy();
  for (const action of ["inject", "pause", "retry", "terminate"] as const) {
    const res = await page.request.post(`/api/tasks/${task.id}/${action}`, { headers: { Cookie: cookieHeader } });
    expect(res.ok()).toBeTruthy();
  }
  const approvalsRes = await page.request.get("/api/tasks", { headers: { Cookie: cookieHeader } });
  const approvalsJson = await approvalsRes.json();
  expect(JSON.stringify(approvalsJson.approvals)).toContain("terminate");
});

test("Knowledge supports search, preview, graph, preview chat, and output job", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(240_000);
  const noteMarker = `${marker}_note_${crypto.randomUUID().slice(0, 8)}`;
  const previewFixture = (name: string) => new URL(`fixtures/knowledge_preview/${name}`, import.meta.url).pathname;
  const previewFixtures = [
    ["chart.md", "markdown", "markdown"],
    ["data.json", "json", "json"],
    ["table.csv", "csv", "csv"],
    ["sample.pdf", "pdf", "pdf"],
    ["audio.mp3", "audio", "audio"],
    ["video.mp4", "video", "video"],
    ["document.docx", "office", "file-card"],
    ["archive.zip", "archive", "file-card"],
    ["page.html", "html", "html"],
  ] as const;
  for (const [name, expectedType, expectedMode] of previewFixtures) {
    const res = await page.request.get(`/api/knowledge/preview?path=${encodeURIComponent(previewFixture(name))}`, { headers: { Cookie: cookieHeader } });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.type).toBe(expectedType);
    expect(json.previewMode).toBe(expectedMode);
    expect(json.mime).toBeTruthy();
  }
  const fileRes = await page.request.get(`/api/knowledge/file?path=${encodeURIComponent(previewFixture("sample.pdf"))}`, { headers: { Cookie: cookieHeader } });
  expect(fileRes.ok()).toBeTruthy();
  expect(fileRes.headers()["content-type"]).toContain("application/pdf");
  const htmlFileRes = await page.request.get(`/api/knowledge/file?path=${encodeURIComponent(previewFixture("page.html"))}`, { headers: { Cookie: cookieHeader } });
  expect(htmlFileRes.ok()).toBeTruthy();
  expect(htmlFileRes.headers()["content-type"]).toContain("text/plain");
  const htmlDocumentRes = await page.request.get(`/api/documents/file?path=${encodeURIComponent(previewFixture("page.html"))}`, { headers: { Cookie: cookieHeader } });
  expect(htmlDocumentRes.ok()).toBeTruthy();
  expect(htmlDocumentRes.headers()["content-type"]).toContain("text/html");
  const localOrganizeRes = await page.request.post("/api/knowledge/notes/organize", {
    headers: { Cookie: cookieHeader },
    data: {
      rawContent: `${noteMarker} OpenClaw 知识库会议记录：需要跟进添加笔记入口，并确认长期记忆资产可搜索。\n张经理需要在本周确认搜索和预览验收。`,
      title: `${noteMarker} note smoke`,
      type: "会议纪要",
      folder: "openclaw",
      qualityMode: "local",
    },
  });
  expect(localOrganizeRes.ok()).toBeFalsy();
  const localOrganizeJson = await localOrganizeRes.json();
  expect(localOrganizeJson.knowledgeNotePipelineVersion).toBe("m3-html-v3");
  expect(localOrganizeJson.error).toBe("gateway_model_required");
  expect(localOrganizeJson.reason).toBe("local_mode_disabled_gateway_required");
  const m27TimeoutRes = await page.request.post("/api/knowledge/notes/organize", {
    headers: { Cookie: cookieHeader },
    data: {
      rawContent: `${noteMarker} MBA 课程转写：供应链管理、库存目标冲突、账期与供应链金融、波特五力模型。`,
      type: "学习笔记",
      folder: "openclaw",
      gatewayTimeoutMs: 1,
    },
  });
  expect(m27TimeoutRes.ok()).toBeFalsy();
  const m27TimeoutJson = await m27TimeoutRes.json();
  expect(m27TimeoutJson.knowledgeNotePipelineVersion).toBe("m3-html-v3");
  expect(m27TimeoutJson.error).toBe("gateway_model_required");
  expect(String(m27TimeoutJson.reason || "")).not.toContain("unexpected property 'modelId'");
  expect(String(m27TimeoutJson.generationPipeline || "")).not.toContain("local_html_fallback");
  const nestedNoteRes = await page.request.post("/api/knowledge/notes", {
    headers: { Cookie: cookieHeader },
    data: {
      rawContent: `${noteMarker} 多级文件夹保存验证。`,
      title: `${noteMarker} nested note`,
      type: "工作记录",
      folder: "openclaw/project-a",
      markdown: `---\ntype: 工作记录\n---\n\n# ${noteMarker} nested note\n\n用于验证添加笔记目标文件夹。`,
      layoutStrategy: {
        template: "knowledge-note",
        hero: `${noteMarker} 验收首屏`,
        summaryCards: [{ label: "模式", value: "M2.7", note: "版式策略" }],
        sidebarBlocks: [{ title: "验收入口", items: ["Markdown 可信源", "HTML 阅读层"] }],
        primarySections: ["内容理解", "后续行动"],
        visualEmphasis: "learning-map",
      },
      htmlDraft: {
        title: `${noteMarker} nested note`,
        sourceHash: "model-html-smoke-source",
        html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="source-hash" content="model-html-smoke-source"><title>${noteMarker} nested model html</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#172033}.hero{padding:36px;background:#fff;border-bottom:1px solid #d9e3ef}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:20px}.card{background:#fff;border:1px solid #d9e3ef;border-radius:8px;padding:16px;line-height:1.7}.evidence{margin:0 20px 24px;padding:18px;border-left:4px solid #0f766e;background:#fff}</style></head><body><section class="hero model-html-smoke"><p>核心判断</p><h1>${noteMarker} 模型 HTML 阅读层</h1><p>主题地图：可信源、阅读层、服务端清洗、证据入口。高价值摘要：验证 MiniMax HTML 可以作为阅读层保存，而不是回退成通用 Markdown 壳。</p><p>金句/判断句：合格文档应先讲清楚为什么值得读，再提供下钻路径。</p></section><main class="grid"><article class="card"><h2>主题地图</h2><p>可信 Markdown、HTML sidecar、来源 hash、服务端安全清洗共同构成可审计阅读层。</p></article><article class="card"><h2>高价值摘要</h2><p>这是一份用于测试的高品味 HTML 文档，重点验证模型生成的结构化阅读层被服务端安全接纳，并且保留证据入口、来源 hash 和可信 Markdown 的对应关系。</p></article><article class="card"><h2>金句/判断句</h2><p>阅读层可以强化表达，但不能伪造原文不存在的项目、人物或结论。</p></article><article class="card"><h2>行动项</h2><p>保存 Markdown 可信源与 HTML sidecar；刷新文件栏后默认打开 HTML；用户仍可通过 Markdown 可信源校对内容。</p></article><article class="card"><h2>待核验</h2><p>如果 HTML 含脚本、外链或质量不足，服务端必须回退并记录原因。</p></article><article class="card"><h2>证据入口</h2><p>原始记录、source hash、生成链路和服务端清洗状态。测试只验证机制，不引入额外事实。</p></article></main><section class="evidence"><h2>来源依据</h2><p>这段长文本保证 HTML 不只是极短片段，满足质量门槛中的首屏信息量要求，并覆盖核心判断、主题地图、高价值摘要、金句/判断句、行动项、待核验和证据入口。</p></section></body></html>`,
      },
      htmlQuality: { score: 94, passed: true, issues: [], dimensions: { semanticCoverage: 94, visualHierarchy: 92, evidenceTrace: 96, noiseControl: 100, safety: 100 } },
      generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
    },
  });
  expect(nestedNoteRes.ok()).toBeTruthy();
  const nestedNoteJson = await nestedNoteRes.json();
  expect(nestedNoteJson.note?.path).toContain("memory/knowledge/notes/openclaw/project-a");
  expect(nestedNoteJson.note?.htmlPath).toContain("memory/knowledge/notes/openclaw/project-a");
  expect(nestedNoteJson.note?.htmlPath).toContain(".html");
  const nestedHtml = await page.request.get(`/api/documents/file?path=${encodeURIComponent(nestedNoteJson.note.htmlPath)}`, { headers: { Cookie: cookieHeader } });
  expect(nestedHtml.ok()).toBeTruthy();
  expect(nestedHtml.headers()["content-type"]).toContain("text/html");
  const nestedHtmlText = await nestedHtml.text();
  expect(nestedHtmlText).toContain("source-hash");
  expect(nestedHtmlText).toContain("model-html-smoke");
  expect(nestedHtmlText).toContain("核心判断");
  expect(nestedHtmlText).toContain("价值摘要");
  expect(nestedNoteJson.note?.htmlFallback).toBe(false);
  const nestedPreview = await page.request.get(`/api/knowledge/preview?path=${encodeURIComponent(nestedNoteJson.note.path)}`, { headers: { Cookie: cookieHeader } });
  const nestedPreviewJson = await nestedPreview.json();
  expect(nestedPreviewJson.ok).toBeTruthy();
  expect(nestedPreviewJson.content).toContain("html_strategy");
  expect(nestedPreviewJson.content).toContain("html_quality");
  expect(nestedPreviewJson.content).toContain("generation_pipeline");
  const maliciousNoteRes = await page.request.post("/api/knowledge/notes", {
    headers: { Cookie: cookieHeader },
    data: {
      rawContent: `${noteMarker} 非法 HTML 清洗验证。`,
      title: `${noteMarker} malicious html`,
      type: "工作记录",
      folder: "openclaw/project-a",
      markdown: `---\ntype: 工作记录\n---\n\n# ${noteMarker} malicious html\n\n## 内容理解\n用于验证 HTML 安全清洗。`,
      htmlDraft: {
        html: `<!doctype html><html><head><meta name="source-hash" content="bad"><script>alert(1)</script></head><body onload="alert(1)"><iframe src="https://example.com"></iframe><h1>核心判断</h1><p>价值摘要 行动项 待核验 证据入口。</p></body></html>`,
      },
      htmlQuality: { score: 96, passed: true, issues: [] },
      generationPipeline: ["local_seed", "m3_obsidian_markdown", "m3_html_document", "server_sanitize"],
    },
  });
  expect(maliciousNoteRes.ok()).toBeFalsy();
  const maliciousNoteJson = await maliciousNoteRes.json();
  expect(maliciousNoteJson.error).toContain("gateway_html_quality_failed");
  const regenerateHtmlRes = await page.request.post("/api/knowledge/notes/regenerate-html", {
    headers: { Cookie: cookieHeader },
    data: { path: nestedNoteJson.note.path, mode: "local-high-value" },
  });
  expect(regenerateHtmlRes.ok()).toBeFalsy();
  const regenerateHtmlJson = await regenerateHtmlRes.json();
  expect(regenerateHtmlJson.knowledgeNotePipelineVersion).toBe("m3-html-v3");
  expect(regenerateHtmlJson.error).toBe("gateway_regenerate_required_no_local_fallback");
  const folderRes = await page.request.get("/api/knowledge/folders?scope=local", { headers: { Cookie: cookieHeader } });
  expect(folderRes.ok()).toBeTruthy();
  const folderJson = await folderRes.json();
  const workspaceRoot = folderJson.folders.find((folder: any) => folder.scope === "workspace" && folder.relativePath === "")?.path;
  const nestedTarget = path.dirname(nestedNoteJson.note.path);
  const importedContent = `${noteMarker} imported markdown content`;
  const importRes = await page.request.post("/api/knowledge/files/import", {
    headers: { Cookie: cookieHeader },
    data: {
      files: [
        { name: `${noteMarker}_import.md`, mime: "text/markdown", size: Buffer.byteLength(importedContent), contentBase64: Buffer.from(importedContent).toString("base64") },
        { name: `${noteMarker}_pixel.png`, mime: "image/png", size: 8, contentBase64: Buffer.from("png-test").toString("base64") },
        { name: `${noteMarker}_doc.pdf`, mime: "application/pdf", size: 8, contentBase64: Buffer.from("%PDF-1.4").toString("base64") },
      ],
    },
  });
  expect(importRes.ok()).toBeTruthy();
  const importJson = await importRes.json();
  expect(importJson.files.length).toBe(3);
  const movedRes = await page.request.post("/api/knowledge/files/move", {
    headers: { Cookie: cookieHeader },
    data: { path: importJson.files[0].path, targetFolderPath: nestedTarget },
  });
  expect(movedRes.ok()).toBeTruthy();
  const movedJson = await movedRes.json();
  expect(movedJson.file.path).toContain("memory/knowledge/notes/openclaw/project-a");
  const movedPreview = await page.request.get(`/api/knowledge/preview?path=${encodeURIComponent(movedJson.file.path)}`, { headers: { Cookie: cookieHeader } });
  expect((await movedPreview.json()).content).toContain(importedContent);
  const archiveRes = await page.request.post("/api/knowledge/files/archive", { headers: { Cookie: cookieHeader }, data: { path: movedJson.file.path } });
  expect(archiveRes.ok()).toBeTruthy();
  const archiveJson = await archiveRes.json();
  expect(archiveJson.file.path).toContain("memory/knowledge/archive/files");
  const archivedPreview = await page.request.get(`/api/knowledge/preview?path=${encodeURIComponent(archiveJson.file.path)}`, { headers: { Cookie: cookieHeader } });
  expect((await archivedPreview.json()).ok).toBeTruthy();
  const trashRes = await page.request.post("/api/knowledge/files/trash", { headers: { Cookie: cookieHeader }, data: { path: importJson.files[1].path } });
  expect(trashRes.ok()).toBeTruthy();
  const trashJson = await trashRes.json();
  expect(trashJson.file.status).toBe("trashed");
  expect(trashJson.file.path).toContain("memory/knowledge/archive/.trash");
  const trashedPreview = await page.request.get(`/api/knowledge/preview?path=${encodeURIComponent(trashJson.file.path)}`, { headers: { Cookie: cookieHeader } });
  expect((await trashedPreview.json()).ok).toBeTruthy();
  if (workspaceRoot) {
    const protectedRes = await page.request.post("/api/knowledge/files/archive", { headers: { Cookie: cookieHeader }, data: { path: `${workspaceRoot}/AGENTS.md` } });
    expect(protectedRes.status()).toBe(400);
    const workspaceImportRes = await page.request.post("/api/knowledge/files/import", {
      headers: { Cookie: cookieHeader },
      data: { targetFolderPath: workspaceRoot, files: [{ name: `${noteMarker}_workspace.md`, mime: "text/markdown", size: 9, contentBase64: Buffer.from("workspace").toString("base64") }] },
    });
    expect(workspaceImportRes.ok()).toBeTruthy();
    const workspaceImportJson = await workspaceImportRes.json();
    const workspaceArchiveRes = await page.request.post("/api/knowledge/files/archive", { headers: { Cookie: cookieHeader }, data: { path: workspaceImportJson.files[0].path } });
    expect(workspaceArchiveRes.ok()).toBeTruthy();
    expect((await workspaceArchiveRes.json()).file.path).toContain("archive/files");
  }

  const wikiUploadA = await page.request.post("/api/knowledge/upload", {
    headers: { Cookie: cookieHeader },
    data: { source: "workspace", name: `${noteMarker}_wiki_a.md`, content: `# ${noteMarker} Wiki A\n\nOpenClaw Knowledge Wiki 编译来源 A，包含项目计划和知识管理主题。` },
  });
  const wikiUploadB = await page.request.post("/api/knowledge/upload", {
    headers: { Cookie: cookieHeader },
    data: { source: "workspace", name: `${noteMarker}_wiki_b.md`, content: `# ${noteMarker} Wiki B\n\n这里存在冲突：同一主题出现不一致表述，需要进入待审。` },
  });
  expect(wikiUploadA.ok()).toBeTruthy();
  expect(wikiUploadB.ok()).toBeTruthy();
  const wikiUploadJsonA = await wikiUploadA.json();
  const wikiUploadJsonB = await wikiUploadB.json();
  expect(["embedded", "completed_with_errors"].includes(String(wikiUploadJsonA.wikiCompile?.status || ""))).toBeTruthy();
  expect(["embedded", "completed_with_errors"].includes(String(wikiUploadJsonB.wikiCompile?.status || ""))).toBeTruthy();
  const wikiPathA = wikiUploadJsonA.upload.path;
  const wikiPathB = wikiUploadJsonB.upload.path;
  const wikiCompile = await page.request.post("/api/knowledge/wiki/compile", {
    headers: { Cookie: cookieHeader },
    data: { mode: "selected", sourcePaths: [wikiPathA, wikiPathB] },
  });
  expect(wikiCompile.ok()).toBeTruthy();
  const wikiCompileJson = await wikiCompile.json();
  expect(Number(wikiCompileJson.generatedCount || 0) + Number(wikiCompileJson.skippedCount || 0)).toBeGreaterThan(0);
  expect(Number(wikiCompileJson.conflictCount || 0)).toBeGreaterThanOrEqual(0);
  expect(
    (Array.isArray(wikiCompileJson.pages) && wikiCompileJson.pages.some((page: any) => String(page.path || "").includes("memory/knowledge/wiki"))) ||
    Number(wikiUploadJsonA.wikiCompile?.generatedCount || 0) > 0 ||
    Number(wikiUploadJsonB.wikiCompile?.generatedCount || 0) > 0,
  ).toBeTruthy();
  const wikiRepeat = await page.request.post("/api/knowledge/wiki/compile", {
    headers: { Cookie: cookieHeader },
    data: { mode: "selected", sourcePaths: [wikiPathA, wikiPathB] },
  });
  expect(wikiRepeat.ok()).toBeTruthy();
  const wikiRepeatJson = await wikiRepeat.json();
  expect(wikiRepeatJson.skippedCount).toBeGreaterThanOrEqual(2);
  const wikiPagesRes = await page.request.get(`/api/knowledge/wiki/pages?q=${encodeURIComponent(noteMarker)}`, { headers: { Cookie: cookieHeader } });
  expect(wikiPagesRes.ok()).toBeTruthy();
  const wikiPagesJson = await wikiPagesRes.json();
  expect(wikiPagesJson.pages.length).toBeGreaterThan(0);
  expect(wikiPagesJson.pages.some((page: any) => page.review_status === "needs_review")).toBeTruthy();
  const wikiSearchRes = await page.request.get(`/api/knowledge/search?q=${encodeURIComponent(noteMarker)}&sources=memory,wiki`, { headers: { Cookie: cookieHeader } });
  expect(wikiSearchRes.ok()).toBeTruthy();
  const wikiSearchJson = await wikiSearchRes.json();
  expect(wikiSearchJson.results.some((hit: any) => hit.source === "wiki")).toBeTruthy();
  expect(wikiSearchJson.results.some((hit: any) => hit.source === "memory")).toBeTruthy();
  const globalWikiSearchRes = await page.request.get(`/api/search?q=${encodeURIComponent(`@wiki ${noteMarker}`)}`, { headers: { Cookie: cookieHeader } });
  expect(globalWikiSearchRes.ok()).toBeTruthy();
  const globalWikiSearchJson = await globalWikiSearchRes.json();
  expect(globalWikiSearchJson.sources).toContain("wiki");
  expect(globalWikiSearchJson.results.knowledge.some((hit: any) => hit.source === "wiki")).toBeTruthy();
  const wikiGraphRes = await page.request.get(`/api/knowledge/graph?path=${encodeURIComponent(wikiPagesJson.pages[0].path)}`, { headers: { Cookie: cookieHeader } });
  expect(wikiGraphRes.ok()).toBeTruthy();
  const wikiGraphJson = await wikiGraphRes.json();
  expect(wikiGraphJson.graph.nodes.some((node: any) => node.source === "wiki")).toBeTruthy();
  expect(wikiGraphJson.graph.edges.some((edge: any) => edge.label === "source-evidence")).toBeTruthy();
  const atlasRes = await page.request.get("/api/knowledge/atlas", { headers: { Cookie: cookieHeader } });
  expect(atlasRes.ok()).toBeTruthy();
  const atlasJson = await atlasRes.json();
  const atlasText = JSON.stringify(atlasJson);
  expect(atlasText).not.toContain(noteMarker);
  expect(atlasText).not.toContain("WB_E2E_");
  expect(atlasJson.categories.length).toBeGreaterThan(0);
  expect(atlasJson.noteCategories.length).toBeGreaterThan(0);
  expect(atlasJson.sourceEvidence.some((row: any) => (row.sources || []).length > 0)).toBeTruthy();
  expect(atlasJson.focusItems.some((item: any) => String(item.id || "").startsWith("category:") && (item.sources || []).length > 0)).toBeTruthy();
  expect(atlasJson.graph.nodes.length).toBeGreaterThan(0);
  expect(atlasJson.graph.edges.some((edge: any) => ["source-evidence", "embedded", "contains"].includes(edge.label))).toBeTruthy();

  await page.addInitScript((pathValue) => {
    window.localStorage.setItem("openclawKnowledgePath", pathValue);
  }, previewFixture("chart.md"));
  await openPage(page, "知识库");
  await expect(page.locator(".vault-head")).toContainText("文件栏");
  await expect(page.locator(".vault-head")).not.toContainText("Obsidian 文档栏");
  await expect(page.locator(".knowledge-tree").first()).not.toContainText("移动到...");
  await expect(page.locator(".tree-row-actions")).toHaveCount(0);
  await expect(page.locator(".tree-row-drag-hint")).toHaveCount(0);
  await expect(page.locator(".source-selection-bar")).toContainText("已选 0 个来源");
  await expect(page.locator(".source-selection-bar").getByRole("button", { name: "全选当前筛选" })).toBeVisible();
  const indexTreeRow = page.locator('.tree-row[data-title="index.md"]').first();
  await expect(indexTreeRow).toBeVisible({ timeout: 30_000 });
  await expect(indexTreeRow.locator(".tree-source-check")).toBeVisible();
  await expect(indexTreeRow.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(indexTreeRow.locator(".tree-icon")).toHaveCount(0);
  await expect(indexTreeRow).not.toContainText("markdown");
  await indexTreeRow.locator('input[type="checkbox"]').check();
  await expect(page.locator(".source-selection-bar")).toContainText("已选 1 个来源");
  await indexTreeRow.locator('input[type="checkbox"]').uncheck();
  await expect(page.locator(".source-selection-bar")).toContainText("已选 0 个来源");
  await page.locator('.tree-row[data-title="index.md"]').first().click({ button: "right" });
  await expect(page.locator(".file-context-menu")).toContainText("归档");
  await expect(page.locator(".file-context-menu")).toContainText("移入回收站");
  await page.mouse.click(10, 10);
  await expect(page.getByRole("button", { name: /添加笔记/ })).toBeVisible();
  await expect(page.locator(".knowledge-markdown-preview .markdown-content")).toContainText("Knowledge Preview Fixture", { timeout: 10_000 });
  await expect(page.locator(".markdown-table-wrap")).toContainText("Mermaid");
  await expect(page.locator(".mermaid-preview svg")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".markmap-preview-shell")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator(".markmap-preview g").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "源码" }).first().click();
  await expect(page.locator(".knowledge-markdown-preview .preview-content")).toContainText("```mermaid");
  await page.getByRole("button", { name: "预览" }).first().click();
  await expect(page.locator(".knowledge-studio-panel")).toContainText("Studio");
  const knowledgeChatPanel = page.locator(".knowledge-chat-panel");
  await expect(knowledgeChatPanel).toHaveClass(/collapsed/);
  await knowledgeChatPanel.getByRole("button", { name: "展开对话栏" }).click();
  await expect(knowledgeChatPanel).not.toHaveClass(/collapsed/);
  await expect(knowledgeChatPanel).toContainText("ima Chat");
  await expect(page.locator(".knowledge-right-resizer")).toHaveAttribute("role", "separator");
  await page.locator(".knowledge-studio-panel").getByRole("button", { name: "折叠 Studio" }).click();
  await expect(page.locator(".knowledge-studio-panel")).toHaveClass(/collapsed/);
  await page.locator(".knowledge-studio-panel").getByRole("button", { name: "展开 Studio" }).click();
  await expect(page.locator(".knowledge-studio-panel")).not.toHaveClass(/collapsed/);
  await knowledgeChatPanel.getByRole("button", { name: "折叠对话栏" }).click();
  await expect(knowledgeChatPanel).toHaveClass(/collapsed/);
  await knowledgeChatPanel.getByRole("button", { name: "展开对话栏" }).click();
  await expect(knowledgeChatPanel).not.toHaveClass(/collapsed/);
  await expect(page.locator(".ima-agent-tools")).toContainText("参考与管理");
  await expect.poll(async () => page.locator(".ima-agent-tools").evaluate((node) => node.hasAttribute("open"))).toBe(false);
  await expect(page.locator(".ima-agent-feed .agent-panel-block")).toHaveCount(0);
  await expect(page.locator(".ima-agent-feed")).not.toContainText("相关笔记");
  await expect(page.locator(".ima-agent-feed")).not.toContainText("录入知识");
  await expect(page.locator(".ima-agent-feed")).not.toContainText("输出任务");
  const notesFolder = page.locator('.tree-row[data-title="notes"]').first();
  const notesFolderPath = await notesFolder.getAttribute("data-path");
  expect(notesFolderPath).toBeTruthy();
  await expect(notesFolder.getByRole("button", { name: "置顶 notes" })).toBeVisible();
  await notesFolder.getByRole("button", { name: "置顶 notes" }).click();
  await expect(notesFolder).toHaveClass(/folder-pinned/);
  await expect(page.locator(".source-selection-bar")).toContainText("已置顶 1 个文件夹");
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.localStorage.getItem("openclawKnowledgePinnedFolders") || "[]"))).toContain(notesFolderPath);
  await notesFolder.getByRole("button", { name: "取消置顶 notes" }).click();
  await expect(notesFolder).not.toHaveClass(/folder-pinned/);
  await notesFolder.click();
  const openclawFolder = page.locator('.tree-row[data-title="openclaw"]').first();
  if (await openclawFolder.count()) {
    await openclawFolder.click();
  }
  const imaFolder = page.locator('.tree-row[data-title="ima_08"]').first();
  if (await imaFolder.count()) {
    await imaFolder.click();
    await expect(page.locator(".knowledge-tree").first()).toContainText(/Note|2026/i, { timeout: 10_000 });
  }

  await page.getByRole("button", { name: /添加笔记/ }).click();
  const noteDialog = page.getByRole("dialog", { name: "添加笔记" });
  await expect(noteDialog).toBeVisible();
  await expect(noteDialog.locator(".note-ai-status")).toContainText("高质量整理");
  await expect(noteDialog.locator(".note-ai-status")).toContainText("MiniMax M3");
  await expect(noteDialog.locator(".note-stage-list")).toHaveCount(0);
  await noteDialog.getByLabel("标题").fill(`${noteMarker} 长期记忆测试`);
  await noteDialog.locator(".folder-input-row input").fill("openclaw/project-a");
  await noteDialog.getByLabel("原始笔记").fill(`${noteMarker} OpenClaw Workbench 添加笔记功能会议纪要。\n需要保存到 memory/knowledge/notes/openclaw，后续跟进搜索和预览验收。`);
  await page.route("**/api/knowledge/notes/organize", async (route) => {
    await page.waitForTimeout(300);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "gateway_model_required",
        message: "Gateway/MiniMax 整理失败：strict e2e mocked gateway failure",
        stage: "m3_obsidian_markdown",
        reason: "strict_e2e_gateway_required",
        generationPipeline: ["local_seed", "m3_obsidian_markdown_failed"],
        attempts: [
          {
            attempt: 0,
            stage: "m3_obsidian_markdown",
            strategy: "normal",
            status: "failed",
            reason: "strict_e2e_gateway_required",
            debugReportPath: "/tmp/knowledge-note-debug.json",
          },
        ],
        diagnosis: {
          category: "内容质量门槛未过",
          rootCause: "MiniMax 输出仍像口语转写，缺少可复用判断、证据和行动项。",
          retryable: true,
          userAction: "补充会议背景、目标、决策对象后重试。",
          repairDirectives: ["去口语", "补齐证据锚点", "列出行动项"],
          nextActions: ["自动执行价值结构修复", "补充上下文后重试"],
        },
        retryBudget: { used: 1, max: 3, exhausted: false },
        debugReports: ["/tmp/knowledge-note-debug.json"],
        nextActions: ["自动执行价值结构修复", "补充上下文后重试"],
        knowledgeNotePipelineVersion: "m3-html-v3",
      }),
    });
  });
  const uiOrganizeResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/notes/organize");
  await noteDialog.getByRole("button", { name: "整理预览" }).click();
  await expect(noteDialog.locator(".note-progress-track")).toBeVisible();
  await expect(noteDialog.locator(".note-stage-list")).toContainText("MiniMax 整理 Obsidian 笔记");
  await expect(noteDialog.locator(".note-stage-list")).toContainText("MiniMax 生成高品味 HTML");
  expect((await uiOrganizeResponse).ok()).toBeFalsy();
  await expect(noteDialog.locator(".form-error")).toContainText("Gateway/MiniMax 整理失败", { timeout: 10_000 });
  await expect(noteDialog.locator(".form-error")).toContainText("strict_e2e_gateway_required");
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("诊断与自动修复");
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("内容质量门槛未过");
  await expect(noteDialog.locator(".note-diagnosis-panel")).toContainText("去口语");
  await expect(noteDialog.getByRole("button", { name: "自动修复并重试" })).toBeVisible();
  await expect(noteDialog.getByRole("button", { name: /查看诊断详情|收起诊断/ })).toBeVisible();
  await expect(noteDialog.getByRole("button", { name: "保存笔记" })).toHaveCount(0);
  await noteDialog.getByRole("button", { name: "取消" }).click();
  await expect(noteDialog).toHaveCount(0);
  await page.unroute("**/api/knowledge/notes/organize");
  const projectNoteFolder = page.locator('.tree-row[data-title="project-a"]').first();
  if (await projectNoteFolder.count()) {
    await projectNoteFolder.click();
  }
  const nestedHtmlTreeRow = page.locator(".tree-row").filter({ hasText: path.basename(nestedNoteJson.note.htmlPath) }).first();
  await expect(nestedHtmlTreeRow).toBeVisible({ timeout: 10_000 });
  await nestedHtmlTreeRow.click();
  await expect(page.locator(".html-document-preview")).toContainText("HTML Interaction Document", { timeout: 10_000 });
  await expect(page.locator(".knowledge-preview").first()).toContainText(noteMarker, { timeout: 10_000 });
  const dragImportResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/files/import");
  const dataTransfer = await page.evaluateHandle((value) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([`${value} drag import`], `${value}_drag.md`, { type: "text/markdown" }));
    transfer.items.add(new File([`${value} batch drag import`], `${value}_batch_drag.md`, { type: "text/markdown" }));
    return transfer;
  }, noteMarker);
  await page.locator(".knowledge-tree").first().dispatchEvent("dragover", { dataTransfer });
  await page.locator(".knowledge-tree").first().dispatchEvent("drop", { dataTransfer });
  const dragImport = await dragImportResponse;
  expect(dragImport.ok()).toBeTruthy();
  const dragImportJson = await dragImport.json();
  expect(dragImportJson.files).toHaveLength(2);
  await expect(page.locator(".knowledge-preview").first()).toContainText(`${noteMarker} drag import`, { timeout: 10_000 });
  const projectTarget = page.locator('.tree-row[data-title="project-a"]').first();
  if (await projectTarget.count() === 0) {
    await page.locator('.tree-row[data-title="notes"]').first().click();
    const openclawMoveFolder = page.locator('.tree-row[data-title="openclaw"]').first();
    if (await openclawMoveFolder.count()) {
      await openclawMoveFolder.click();
    }
  }
  await expect(projectTarget).toBeVisible({ timeout: 10_000 });
  const importedDragPaths = dragImportJson.files.map((file: any) => file.path);
  const moveTransfer = await page.evaluateHandle((pathValues) => {
    const transfer = new DataTransfer();
    transfer.setData("application/x-openclaw-knowledge-paths", JSON.stringify(pathValues));
    transfer.setData("application/x-openclaw-knowledge-path", pathValues[0]);
    transfer.setData("text/plain", pathValues[0]);
    return transfer;
  }, importedDragPaths);
  let dragMoveCount = 0;
  const dragMoveResponse = page.waitForResponse((response) => {
    const matches = response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/files/move";
    if (matches) dragMoveCount += 1;
    return matches && dragMoveCount === importedDragPaths.length;
  });
  await projectTarget.dispatchEvent("dragover", { dataTransfer: moveTransfer });
  await projectTarget.dispatchEvent("drop", { dataTransfer: moveTransfer });
  const dragMove = await dragMoveResponse;
  expect(dragMove.ok()).toBeTruthy();
  expect((await dragMove.json()).file.path).toContain("memory/knowledge/notes/openclaw/project-a");

  await page.locator(".ima-agent-tools summary").click();
  await page.locator("form.search input").first().fill(`@memory ${noteMarker}`);
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.getByRole("heading", { name: "搜索结果" })).toBeVisible();
  await expect(page.locator(".ima-agent-tools")).toContainText(noteMarker, { timeout: 10_000 });
  await expect(page.locator(".ima-agent-tools")).toContainText("相关笔记");
  await expect(page.locator(".ima-agent-tools")).toContainText("录入知识");

  await expect(page.getByRole("heading", { name: "相关笔记" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开局部关系图谱" })).toBeVisible();

  await expect(page.locator(".ima-agent-head")).toContainText("ima");
  await expect(page.locator(".knowledge-studio-panel .current-file-card")).toContainText(noteMarker);
  await page.getByRole("button", { name: "Atlas 首页" }).click();
  await expect(page.locator(".knowledge-atlas-home")).toContainText("Master MOC", { timeout: 10_000 });
  await expect(page.locator(".knowledge-atlas-home")).toContainText("整体知识 Wiki");
  await expect(page.locator(".knowledge-atlas-home")).toContainText("最近嵌入 / 待审");
  await expect(page.locator(".knowledge-atlas-home")).toContainText("关系图谱");
  await expect(page.locator(".knowledge-atlas-home")).toContainText("来源证据");
  await page.locator(".atlas-moc-card").first().click();
  await expect(page.locator(".knowledge-preview").first()).toContainText(/MOC|来源依据|反向链接/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Atlas 首页" }).click();
  await expect(page.locator(".knowledge-atlas-home")).toBeVisible({ timeout: 10_000 });
  await page.locator(".atlas-graph-node").first().click();
  await expect(page.locator(".atlas-focus-panel")).toBeVisible({ timeout: 10_000 });
  await page.locator(".atlas-live-item").first().click();
  await expect(page.locator(".knowledge-studio-panel .current-file-card")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "关闭预览" }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "关闭预览" }).first().click();
  await expect(page.locator(".knowledge-atlas-home")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".generated-output-panel")).toContainText("生成内容");
  await expect(page.locator(".source-mode-toggle").getByRole("button", { name: "Wiki", exact: true })).toBeVisible();
  const wikiUiResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/wiki/compile");
  await page.locator(".knowledge-studio-panel .current-file-card").getByRole("button", { name: "编译到 Wiki", exact: true }).click();
  expect((await wikiUiResponse).ok()).toBeTruthy();
  await expect(page.locator(".wiki-status-panel")).toContainText("Wiki 编译状态", { timeout: 10_000 });
  await expect(page.locator(".source-mode-toggle button.active")).toContainText("Wiki");
  await expect.poll(async () => {
    const previewText = await page.locator(".knowledge-preview").first().textContent().catch(() => "");
    const linkCount = await page.locator(".wiki-page-link").count();
    return (previewText || "").includes("来源依据") || linkCount > 0;
  }, { timeout: 20_000 }).toBeTruthy();
  const currentPreviewText = await page.locator(".knowledge-preview").first().textContent().catch(() => "");
  if (!currentPreviewText?.includes("来源依据")) {
    const wikiPreviewLink = page.locator(".wiki-page-link").filter({ hasText: noteMarker }).first();
    if (await wikiPreviewLink.count()) {
      await wikiPreviewLink.click();
    } else {
      await page.locator(".wiki-page-link").first().click();
    }
  }
  await expect(page.locator(".knowledge-preview").first()).toContainText("来源依据", { timeout: 10_000 });
  const previewChatResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/preview-chat");
  await page.getByPlaceholder("有问题尽管问 ima").fill(`${marker} preview question`);
  await page.locator(".ima-input").getByRole("button", { name: "发送" }).click();
  expect((await previewChatResponse).ok()).toBeTruthy();
  await expect(page.locator(".ima-agent-feed")).toContainText("已基于当前预览文件生成讨论上下文", { timeout: 20_000 });

  const outputResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/output-jobs");
  await page.locator(".knowledge-studio-panel .current-file-card").getByRole("button", { name: "报告", exact: true }).click();
  const createdOutput = await outputResponse;
  expect(createdOutput.ok()).toBeTruthy();
  const createdOutputJson = await createdOutput.json();
  await expect(page.locator(".ima-agent-feed")).toContainText("已基于 1 个来源创建", { timeout: 10_000 });
  await expect(page.locator(".generated-output-panel")).toContainText(createdOutputJson.job.title, { timeout: 10_000 });
  await page.locator(".generated-output-panel .generated-output-link").filter({ hasText: createdOutputJson.job.title }).first().click();
  await expect(page.locator(".knowledge-preview").first()).toContainText(/standard-report|knowledge_output|report/i, { timeout: 10_000 });
  const mindmapResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/knowledge/output-jobs");
  await page.locator(".knowledge-studio-panel .current-file-card").getByRole("button", { name: "思维导图", exact: true }).click();
  const createdMindmap = await mindmapResponse;
  expect(createdMindmap.ok()).toBeTruthy();
  const createdMindmapJson = await createdMindmap.json();
  await expect(page.locator(".generated-output-panel")).toContainText(createdMindmapJson.job.title, { timeout: 10_000 });
  await page.locator(".generated-output-panel .generated-output-link").filter({ hasText: createdMindmapJson.job.title }).first().click();
  await expect(page.locator(".knowledge-preview").first()).toContainText(/standard-mindmap|knowledge_output|mindmap/i, { timeout: 10_000 });
  await expect(page.locator(".knowledge-preview .markmap-preview-shell").first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator(".knowledge-preview .markmap-preview g").count(), { timeout: 15_000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: "打开局部关系图谱" }).click();
  await expect(page.getByRole("heading", { name: "关系图谱" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Knowledge Graph" })).toBeVisible();
  await expect(page.getByPlaceholder("搜索节点、标签、路径")).toBeVisible();
  await expect.poll(async () => {
    const graphCount = await page.locator(".react-flow").count();
    const emptyCount = await page.getByText("暂无图谱节点。").count();
    return graphCount + emptyCount;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("Assistant, Reports, and Projects complete core CRUD flows", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);
  page.on("dialog", (dialog) => dialog.accept(`${marker} dialog fallback`));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(9, 0, 0, 0);
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(12);
  nextMonth.setHours(11, 0, 0, 0);
  const yesterdayStart = localDateTimeInput(yesterday);
  const nextMonthStart = localDateTimeInput(nextMonth);
  const yesterdayKey = yesterdayStart.slice(0, 10);
  const nextMonthKey = nextMonthStart.slice(0, 10);
  await request.post("/api/events", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_yesterday_event`, startAt: yesterdayStart, eventType: "schedule" },
  });
  await request.post("/api/events", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_next_month_event`, startAt: nextMonthStart, eventType: "schedule" },
  });
  await request.post("/api/todos", {
    headers: { Cookie: cookieHeader },
    data: { title: `${marker}_next_month_todo`, priority: "P2", dueAt: nextMonthStart, tags: ["calendar"] },
  });
  const calendarRes = await request.get(`/api/calendar?start=${yesterdayKey}&end=${nextMonthKey}`, { headers: { Cookie: cookieHeader } });
  expect(calendarRes.ok()).toBeTruthy();
  const calendarJson = await calendarRes.json();
  expect(JSON.stringify(calendarJson.events)).toContain(`${marker}_yesterday_event`);
  expect(JSON.stringify(calendarJson.events)).toContain(`${marker}_next_month_event`);
  expect(JSON.stringify(calendarJson.todos)).toContain(`${marker}_next_month_todo`);
  const holidayRes = await request.get("/api/calendar?start=2026-10-01&end=2026-10-01", { headers: { Cookie: cookieHeader } });
  expect(holidayRes.ok()).toBeTruthy();
  const holidayJson = await holidayRes.json();
  expect(JSON.stringify(holidayJson.holidays)).toContain("国庆");
  const cappedRes = await request.get("/api/calendar?start=2026-01-01&end=2027-01-07", { headers: { Cookie: cookieHeader } });
  expect(cappedRes.status()).toBe(400);
  await openPage(page, "智能助理");
  await expect(page.getByRole("heading", { name: "快速捕获" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "提醒事项同步" })).toBeVisible();
  const reminderPreviewRes = await request.post("/api/imports/reminders/preview", { headers: { Cookie: cookieHeader }, data: {} });
  expect(reminderPreviewRes.ok()).toBeTruthy();
  const reminderPreviewJson = await reminderPreviewRes.json();
  expect(reminderPreviewJson.ok).toBeTruthy();
  if (reminderExcelPaths.every((file) => fs.existsSync(file))) {
    const importCandidates =
      (reminderPreviewJson.counts.create || 0) +
      (reminderPreviewJson.counts.update || 0) +
      (reminderPreviewJson.counts.duplicate || 0);
    expect(importCandidates).toBeGreaterThan(0);
    expect(reminderPreviewJson.counts.skipped).toBeGreaterThan(0);
    expect(reminderPreviewJson.categories).toContain("业务管理");
    expect(reminderPreviewJson.categories).toContain("个人");
  }
  await page.getByRole("button", { name: "导入预览" }).click();
  await expect(page.getByRole("dialog", { name: "导入预览" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".reminder-preview-summary")).toContainText("待创建");
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator(".calendar-sidecar")).toContainText("我的任务");
  await expect(page.locator(".calendar-sidecar")).toContainText("日程");
  await expect(page.locator(".calendar-sidecar")).toContainText("报告");
  await expect(page.locator(".calendar-sidecar")).toContainText("中国节假日");
  await expect(page.locator(".calendar")).toContainText(`${marker}_yesterday_event`, { timeout: 12_000 });
  await page.locator(".calendar-nav").getByRole("button", { name: "下一段" }).click();
  await expect(page.locator(".calendar")).toContainText(`${marker}_next_month_event`, { timeout: 12_000 });
  await expect(page.locator(".calendar")).toContainText(`${marker}_next_month_todo`, { timeout: 12_000 });
  await page.locator(".calendar-nav").getByLabel("跳转日期").fill("2026-10-01");
  await expect(page.locator(".calendar")).toContainText("国庆", { timeout: 12_000 });
  await page.locator(".calendar-modes").getByRole("button", { name: "年" }).click();
  await expect(page.locator(".calendar")).toContainText("国庆", { timeout: 12_000 });
  await page.locator(".calendar-nav").getByRole("button", { name: "今天" }).click();
  await page.locator(".calendar-modes").getByRole("button", { name: "月" }).click();
  const captureForm = page.locator(".opc-capture-form");
  await captureForm.getByPlaceholder("快速添加任务").fill(`${marker}_todo_ui`);
  await captureForm.locator("select").first().selectOption("P1");
  await captureForm.getByLabel("负责人", { exact: true }).fill("周队");
  await captureForm.getByLabel("分类", { exact: true }).fill(`${marker}_分类`);
  await captureForm.getByPlaceholder(/备注，例如/).fill(`${marker} todo note`);
  await captureForm.getByPlaceholder("标签，逗号分隔").fill("prd11,e2e");
  const createTodoResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/todos");
  await page.getByRole("button", { name: "添加待办" }).click();
  expect((await createTodoResponse).ok()).toBeTruthy();
  const todoPanel = page.locator(".todo-panel").filter({ hasText: "个人待办" }).first();
  await expect(todoPanel).toContainText("我负责的");
  await expect(todoPanel).toContainText("只看未完成");
  await expect(todoPanel).toContainText("优先级");
  await expect(todoPanel).toContainText("字段配置");
  await expect(todoPanel.locator(".task-workbench-toolbar")).toBeVisible();
  await expect(todoPanel.locator(".task-board-stats .task-stat-card")).toHaveCount(2);
  await expect(todoPanel.locator(".task-table-head")).toContainText("任务标题");
  await expect(todoPanel.locator(".task-table-head")).toContainText("截止时间");
  await expect(todoPanel.locator(".task-table-head")).toContainText("分类/类型");
  await expect(todoPanel.locator(".task-table-head")).toContainText("备注");
  await expect(todoPanel.locator(".task-table-head")).toContainText("反馈");
  await todoPanel.getByRole("button", { name: "全部", exact: true }).click();
  await expect(todoPanel).toContainText(`${marker}_todo_ui`, { timeout: 12_000 });
  await expect(todoPanel).toContainText(`${marker} todo note`);
  const todoCard = todoPanel.locator(".todo-card").filter({ hasText: `${marker}_todo_ui` }).first();
  await expect(todoCard.getByLabel(`负责人 ${marker}_todo_ui`)).toHaveValue("周队");
  await todoCard.getByLabel(`负责人 ${marker}_todo_ui`).fill(`${marker}_负责人`);
  await todoCard.getByLabel(`负责人 ${marker}_todo_ui`).press("Enter");
  await expect(todoCard.getByLabel(`负责人 ${marker}_todo_ui`)).toHaveValue(`${marker}_负责人`, { timeout: 10_000 });
  await expect(todoCard.getByLabel(`分类 ${marker}_todo_ui`)).toHaveValue(`${marker}_分类`);
  await todoCard.getByLabel(`分类 ${marker}_todo_ui`).fill(`${marker}_项目分类`);
  await todoCard.getByLabel(`分类 ${marker}_todo_ui`).press("Enter");
  await expect(todoCard.getByLabel(`分类 ${marker}_todo_ui`)).toHaveValue(`${marker}_项目分类`, { timeout: 10_000 });
  const adjustedDue = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    date.setHours(11, 30, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await todoCard.locator('input[type="datetime-local"]').fill(adjustedDue);
  await expect(todoCard.locator('input[type="datetime-local"]')).toHaveValue(adjustedDue);
  await expect(todoCard.getByLabel(`备注历史 ${marker}_todo_ui`)).toContainText(`${marker} todo note`);
  await todoCard.getByLabel("输入备注").fill(`${marker} updated note`);
  await todoCard.getByRole("button", { name: "保存备注" }).click();
  await expect(todoCard.getByLabel(`备注历史 ${marker}_todo_ui`)).toContainText(`${marker} updated note`, { timeout: 15_000 });
  await todoCard.getByLabel("输入反馈").fill(`${marker} feedback done`);
  await todoCard.getByRole("button", { name: "保存反馈" }).click();
  await expect(todoCard).toContainText(`${marker} feedback done`, { timeout: 15_000 });
  await expect(todoCard.getByRole("button", { name: "加入日程" })).toHaveCount(0);
  await expect(page.locator(".calendar")).toContainText(`${marker}_todo_ui`, { timeout: 12_000 });
  const reminderDue = await page.evaluate(() => {
    const date = new Date(Date.now() - 60_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  const reminderTitle = `${marker}_${crypto.randomUUID()}_shi qing_reminder`;
  await request.post("/api/todos", {
    headers: { Cookie: cookieHeader },
    data: { title: reminderTitle, priority: "P1", dueAt: reminderDue, agentId: "周队", notes: `${marker} shi qing reminder note` },
  });
  await expect.poll(async () => {
    const res = await request.get("/api/inbox", { headers: { Cookie: cookieHeader } });
    const data = await res.json();
    return JSON.stringify(data.items || []);
  }, { timeout: 45_000, intervals: [1000, 2000, 5000] }).toContain(reminderTitle);
  await page.getByRole("button", { name: /收件箱/ }).click();
  await expect(page.locator(".top-inbox-panel")).toContainText(reminderTitle, { timeout: 12_000 });
  await expect(page.locator(".top-inbox-panel")).toContainText("周队");
  await page.locator(".top-inbox > .top-inbox-button").click();
  await page.locator(".global-search").getByPlaceholder(/搜索任务/).fill(`@all shi qing`);
  await page.locator(".global-search").getByRole("button", { name: "搜索" }).click();
  await expect(page.locator(".search-panel")).toContainText("Todos", { timeout: 30_000 });
  await expect(page.locator(".search-panel")).toContainText(reminderTitle, { timeout: 12_000 });
  await page.locator(".search-panel .search-hit-button").filter({ hasText: reminderTitle }).first().click();
  await expect(page.getByRole("heading", { name: "智能助理" })).toBeVisible();
  await todoCard.getByRole("checkbox").click();
  await todoPanel.getByRole("button", { name: "已完成" }).click();
  await expect(todoPanel.locator(".todo-card").filter({ hasText: `${marker}_todo_ui` }).first()).toContainText("done");
  await expect(page.getByRole("heading", { name: "代理讨论" })).toBeVisible();
  await expect(page.locator(".assistant-chat-rail .chat-history")).toHaveCount(0);
  await expect(page.locator(".assistant-chat-rail .chat-preview")).toHaveCount(0);
  await expect(page.locator(".assistant-chat-rail .compact-chat-layout .chat-toolbar")).toBeVisible();
  await expect(page.locator(".assistant-chat-rail .compact-chat-layout .compose-box textarea")).toBeVisible();
  const completedTodoCard = todoPanel.locator(".todo-card").filter({ hasText: `${marker}_todo_ui` }).first();
  await expect(completedTodoCard).toBeVisible();
  await completedTodoCard.locator(".task-title-cell").click();
  await expect(page.locator(".assistant-chat-rail .context-quick-card")).toContainText(`${marker}_todo_ui`);
  await page.locator(".assistant-chat-rail .context-quick-card").getByRole("button", { name: "总结" }).click();
  await expect(page.locator(".assistant-chat-rail .message.user").filter({ hasText: `${marker}_todo_ui` })).toBeVisible({ timeout: 15_000 });

  const eventStart = await page.evaluate(() => {
    const date = new Date();
    date.setHours(10, 0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await captureForm.getByRole("button", { name: "日程" }).click();
  await page.getByPlaceholder("日程标题").fill(`${marker}_event_ui`);
  await captureForm.locator('input[type="datetime-local"]').fill(eventStart);
  const createEventResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/events");
  await page.getByRole("button", { name: "添加日程" }).click();
  expect((await createEventResponse).ok()).toBeTruthy();
  await expect(page.locator(".calendar")).toContainText(`${marker}_event_ui`, { timeout: 12_000 });
  await page.locator(".calendar-modes").getByRole("button", { name: "周" }).click();
  await page.locator(".calendar-modes").getByRole("button", { name: "月" }).click();
  await page.locator(".calendar-modes").getByRole("button", { name: "日" }).click();
  await page.locator(".calendar-modes").getByRole("button", { name: "月" }).click();

  await expect(page.locator(".calendar-report-center")).toContainText("日报");
  await expect(page.locator(".calendar-report-center")).toContainText("周报");
  await expect(page.locator(".calendar-report-center")).toContainText("月报");
  await expect(page.locator(".calendar-report-center")).toContainText("年报");
  await page.locator(".report-form textarea").fill(`${marker} report notes`);
  await page.locator(".report-form").getByRole("button", { name: /生成|更新/ }).click();
  await expect(page.locator(".calendar-report-center")).toContainText("已生成报告", { timeout: 10_000 });
  await expect(page.locator(".calendar")).toContainText("日报", { timeout: 10_000 });
  await page.locator(".calendar-report-center").getByRole("button", { name: "编辑" }).first().click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  await page.locator(".inline-editor input").fill(`${marker}_report_edited`);
  await page.getByRole("button", { name: "保存报告" }).click();
  await expect(page.locator(".calendar-report-center")).toContainText(`${marker}_report_edited`);
  await page.locator(".calendar-report-center").getByRole("button", { name: "定时" }).first().click();

  await page.getByRole("button", { name: "项目管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目管理" })).toBeVisible();
  await expect(page.locator(".life-matrix-panel")).toContainText("人生修行矩阵", { timeout: 10_000 });
  await expect(page.locator(".life-matrix-panel")).toContainText("个人");
  await expect(page.locator(".life-matrix-panel")).toContainText("家庭");
  await expect(page.locator(".life-matrix-panel")).toContainText("事业");
  await expect(page.locator(".life-matrix-panel")).toContainText("社会");
  await expect(page.locator(".life-plan-hero")).toContainText("五年人生规划");
  await expect(page.locator("main")).not.toContainText("OpenClaw OPC Autopilot");
  await page.getByPlaceholder("项目名称").fill(`${marker}_project_ui`);
  await page.getByPlaceholder("项目目标").fill(`${marker} project objective`);
  await page.getByLabel("人生维度", { exact: true }).selectOption("事业");
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.locator(".gantt")).toContainText(`${marker}_project_ui`);
  await expect(page.locator(".life-project-panel")).toContainText("事业");
  await page.locator("form").filter({ hasText: "新增里程碑" }).locator("select").selectOption({ label: `${marker}_project_ui` });
  await page.getByPlaceholder("里程碑名称").fill(`${marker}_milestone_ui`);
  await page.getByRole("button", { name: "添加里程碑" }).click();
  const milestonePanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: /^里程碑$/ }) }).first();
  await expect(milestonePanel).toContainText(`${marker}_milestone_ui`);
  await page.locator("form").filter({ hasText: "关联成果物" }).locator("select").selectOption({ label: `${marker}_project_ui` });
  await page.getByPlaceholder("成果物标题").fill(`${marker}_deliverable_ui`);
  await page.getByPlaceholder("文档链接或本地路径").fill("/Users/njx/openclaw_data/MEMORY.md");
  await page.getByRole("button", { name: "关联文档" }).click();
  await expect(page.locator(".panel").filter({ hasText: "成果物与文档" })).toContainText(`${marker}_deliverable_ui`);
});

test("OPC Autopilot initializes CRM ERP dry-run workbench", async ({ page, request }, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);
  const bootstrapRes = await request.post("/api/opc/bootstrap", { headers: { Cookie: cookieHeader } });
  expect(bootstrapRes.ok()).toBeTruthy();
  const bootstrapJson = await bootstrapRes.json();
  expect(bootstrapJson.initialized).toBeTruthy();
  expect(bootstrapJson.project.status).toBe("autopilot_enabled");
  expect(bootstrapJson.project.objective).toContain("自动化运营 OPC");
  const projectId = bootstrapJson.project.id;

  const secondBootstrap = await request.post("/api/opc/bootstrap", { headers: { Cookie: cookieHeader } });
  expect(secondBootstrap.ok()).toBeTruthy();
  const secondJson = await secondBootstrap.json();
  expect(secondJson.project.id).toBe(projectId);

  const policyRes = await request.post(`/api/opc/projects/${projectId}/autopilot/policies`, {
    headers: { Cookie: cookieHeader },
    data: { mode: "dry_run", budget_usd: 3289 },
  });
  expect(policyRes.ok()).toBeTruthy();
  const orderRes = await request.post(`/api/opc/projects/${projectId}/orders`, {
    headers: { Cookie: cookieHeader },
    data: { external_id: `${marker}_opc_order`, platform: "shopify", status: "paid", amount_usd: 120, cost_usd: 70, notes: `${marker} profitable validation` },
  });
  expect(orderRes.ok()).toBeTruthy();
  const orderJson = await orderRes.json();
  expect(orderJson.row.net_value_usd).toBe(50);
  const riskTitle = `${marker}_opc_manual_confirm_risk`;
  const riskRes = await request.post(`/api/opc/projects/${projectId}/risks`, {
    headers: { Cookie: cookieHeader },
    data: { title: riskTitle, category: "compliance", severity: "P0", status: "open", trigger_condition: `${marker} live gate`, mitigation: `${marker} human approval required`, owner: "OpenClaw" },
  });
  expect(riskRes.ok()).toBeTruthy();
  const runRes = await request.post(`/api/opc/projects/${projectId}/autopilot/run`, { headers: { Cookie: cookieHeader } });
  expect(runRes.ok()).toBeTruthy();
  const runJson = await runRes.json();
  expect(JSON.stringify(runJson.runs)).toContain("sync_platforms");
  expect(JSON.stringify(runJson.syncs)).toContain("not_configured");
  expect(runJson.dashboard.humanQueue.length).toBeGreaterThan(0);
  expect(runJson.dashboard.automationGraph.nodes.length).toBeGreaterThan(6);
  const markerApprovals = runJson.dashboard.humanQueue.filter((row: any) => row.queueType === "approval" && String(row.title).includes(riskTitle));
  expect(markerApprovals).toHaveLength(1);
  const duplicateRunRes = await request.post(`/api/opc/projects/${projectId}/autopilot/run`, { headers: { Cookie: cookieHeader } });
  expect(duplicateRunRes.ok()).toBeTruthy();
  const duplicateRunJson = await duplicateRunRes.json();
  const duplicateMarkerApprovals = duplicateRunJson.dashboard.humanQueue.filter((row: any) => row.queueType === "approval" && String(row.title).includes(riskTitle));
  expect(duplicateMarkerApprovals).toHaveLength(1);
  const configureRes = await request.post(`/api/opc/projects/${projectId}/integrations/shopify/configure`, {
    headers: { Cookie: cookieHeader },
    data: { mode: "dry_run", key_ref: `${marker}_SHOPIFY_ADMIN_TOKEN_REF`, credential_configured: true, scopes: ["products", "orders", "fulfillments"], notes: `${marker} shopify connector` },
  });
  expect(configureRes.ok()).toBeTruthy();
  const configureJson = await configureRes.json();
  expect(configureJson.integration.status).toBe("configured");
  const testConnectorRes = await request.post(`/api/opc/projects/${projectId}/integrations/shopify/test`, {
    headers: { Cookie: cookieHeader },
    data: { mode: "dry_run" },
  });
  expect(testConnectorRes.ok()).toBeTruthy();
  const testConnectorJson = await testConnectorRes.json();
  expect(testConnectorJson.ready).toBeTruthy();
  expect(testConnectorJson.status).toBe("connected");
  const rerunRes = await request.post(`/api/opc/projects/${projectId}/autopilot/run`, { headers: { Cookie: cookieHeader } });
  expect(rerunRes.ok()).toBeTruthy();
  const rerunJson = await rerunRes.json();
  expect(JSON.stringify(rerunJson.syncs)).toContain("success");

  await page.goto("/opc", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "项目管理" })).toBeVisible();
  const panel = page.locator(".opc-autopilot-panel");
  await expect(panel).toContainText("OPC 运营工作台", { timeout: 20_000 });
  await expect(panel).toContainText("OPC 持续运营", { timeout: 20_000 });
  await expect(panel).toContainText("autopilot_enabled");
  await expect(panel).toContainText("dry_run");
  await expect(panel).toContainText("需要你确认");
  await expect(panel).toContainText("自动化运行拓扑");
  await panel.locator(".opc-graph-node").filter({ hasText: "风险合规" }).click();
  await expect(panel.locator(".opc-graph-detail")).toContainText(riskTitle, { timeout: 10_000 });
  const markerQueueItem = panel.locator(".opc-queue-item").filter({ hasText: `复核 OPC 风险：${riskTitle}` }).first();
  await expect(markerQueueItem).toBeVisible();
  await markerQueueItem.getByRole("button", { name: "转为待办" }).click();
  await markerQueueItem.getByRole("button", { name: "拒绝" }).click();
  await expect(panel.locator(".opc-queue-item").filter({ hasText: `复核 OPC 风险：${riskTitle}` })).toHaveCount(0, { timeout: 10_000 });
  await panel.locator(".opc-tabs").getByRole("button", { name: "CRM订单" }).click();
  await expect(panel).toContainText(`${marker}_opc_order`);
  await panel.locator(".opc-tabs").getByRole("button", { name: "ERP供应链" }).click();
  await expect(panel).toContainText("E88PRO", { timeout: 10_000 });
  await panel.locator(".opc-tabs").getByRole("button", { name: "风险合规" }).click();
  await expect(panel).toContainText("FCC", { timeout: 10_000 });
  await panel.locator(".opc-tabs").getByRole("button", { name: "自动化" }).click();
  await expect(panel).toContainText("连接器配置");
  await expect(panel).toContainText("sync_platforms");
  const shopifyCard = panel.locator(".opc-connector-card").filter({ hasText: "Shopify Admin API" });
  await expect(shopifyCard).toContainText("connected");
  await shopifyCard.getByLabel("shopify 凭证引用").fill(`${marker}_SHOPIFY_UI_REF`);
  await shopifyCard.getByLabel("shopify 凭证已配置").check();
  await shopifyCard.getByRole("button", { name: "保存配置" }).click();
  await expect(shopifyCard.getByLabel("shopify 凭证引用")).toHaveValue(`${marker}_SHOPIFY_UI_REF`, { timeout: 10_000 });
  await shopifyCard.getByRole("button", { name: "测试连接" }).click();
  await expect(shopifyCard).toContainText("connected", { timeout: 10_000 });
  await panel.getByRole("button", { name: "执行一轮自动运营" }).first().click();
  await expect(panel).toContainText("daily_net_value_report", { timeout: 12_000 });
  await panel.locator(".opc-tabs").getByRole("button", { name: "报告" }).click();
  const reportResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/reports/generate");
  await panel.getByRole("button", { name: "日报 生成/更新" }).click();
  expect((await reportResponse).ok()).toBeTruthy();
  await expect(panel).toContainText("日报", { timeout: 10_000 });
  await expectNoHorizontalOverflow(page, "OPC business workbench");
});
