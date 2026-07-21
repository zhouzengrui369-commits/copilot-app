const { chromium } = require("playwright");

const BASE_URL = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const PASSWORDS = [
  process.env.VERIFY_PASSWORD,
  process.env.OPENCLAW_WORKBENCH_PASSWORD,
  "openclaw2026",
  "123456",
].filter(Boolean);

function fail(message) {
  throw new Error(message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertNoHorizontalOverflow(page, label) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (size.scrollWidth > size.clientWidth + 2) {
    fail(`${label}: horizontal overflow ${size.scrollWidth} > ${size.clientWidth}`);
  }
}

async function assertRowsDoNotOverlap(page, selector, label) {
  const rows = await page.locator(selector).evaluateAll((nodes) => nodes.slice(0, 5).map((node) => {
    const children = Array.from(node.children);
    return children.map((child) => {
      const box = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        text: child.textContent || "",
      };
    });
  }));
  for (const [rowIndex, row] of rows.entries()) {
    const visible = row.filter((child) => child.display !== "none" && child.width > 0 && child.height > 0);
    for (let i = 0; i < visible.length - 1; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const verticalOverlap = Math.min(visible[i].bottom, visible[j].bottom) - Math.max(visible[i].top, visible[j].top);
        const horizontalOverlap = Math.min(visible[i].right, visible[j].right) - Math.max(visible[i].left, visible[j].left);
        if (verticalOverlap > 1 && horizontalOverlap > 1) {
          fail(`${label}: row ${rowIndex + 1} columns overlap (${visible[i].text} / ${visible[j].text})`);
        }
      }
    }
  }
}

async function assertVerticalRowsDoNotOverlap(page, selector, label) {
  const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      display: style.display,
      visibility: style.visibility,
      text: node.textContent || "",
    };
  }).filter((box) => box.display !== "none" && box.visibility !== "hidden" && box.height > 0));
  const sorted = boxes.sort((a, b) => a.top - b.top);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i].bottom > sorted[i + 1].top + 1) {
      fail(`${label}: rows overlap vertically (${sorted[i].text.trim()} / ${sorted[i + 1].text.trim()})`);
    }
  }
}

async function ensureLoggedIn(page) {
  await page.goto(`${BASE_URL}/delivery`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  const passwordInput = page.locator('input[type="password"]').first();
  if (!(await passwordInput.count())) return;
  for (const password of PASSWORDS) {
    await passwordInput.fill(password);
    await passwordInput.press("Enter");
    await page.waitForTimeout(1_200);
    if (!(await page.locator('input[type="password"]').count())) return;
  }
  fail("login required but no known verification password worked");
}

async function visibleBox(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) fail(`${label}: not visibly laid out`);
  return box;
}

async function visibleControlInLabel(scope, labelText, controlSelector, label) {
  const labelNode = scope.locator("label").filter({
    hasText: new RegExp(`^\\s*${escapeRegExp(labelText)}`),
  }).first();
  await visibleBox(labelNode, `${label || labelText} label`);
  return visibleBox(labelNode.locator(controlSelector).first(), label || `${labelText} ${controlSelector}`);
}

async function assertRightRailCollapseRestore(page) {
  const collapse = page.locator(".delivery-right-rail .delivery-right-rail-collapse").first();
  await visibleBox(collapse, "right rail collapse button");
  await collapse.click();
  await visibleBox(page.locator(".delivery-right-rail-collapsed").first(), "collapsed right rail");
  const collapsedShellCount = await page.locator(".delivery-three-column.right-rail-collapsed").count();
  if (collapsedShellCount !== 1) fail(`right rail collapsed shell count should be 1, got ${collapsedShellCount}`);

  const expand = page.locator(".delivery-right-rail-collapsed .delivery-right-rail-expand").first();
  await visibleBox(expand, "right rail expand button");
  await expand.click();
  await page.locator(".delivery-right-rail-collapsed").waitFor({ state: "detached", timeout: 15_000 });
  await visibleBox(page.locator(".delivery-right-rail:not(.delivery-right-rail-collapsed)").first(), "expanded right rail");
}

function trackUnsafeWrites(page) {
  const unsafeRequests = [];
  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
    const url = new URL(request.url());
    if (/\/api\/auth\/login$/.test(url.pathname)) return;
    unsafeRequests.push(`${method} ${url.pathname}`);
  });
  return unsafeRequests;
}

function assertNoUnsafeWrites(unsafeRequests) {
  if (!unsafeRequests.length) return;
  fail(`verification triggered write requests:\n${unsafeRequests.slice(0, 8).join("\n")}`);
}

async function assertDevConsole(page) {
  await page.goto(`${BASE_URL}/delivery`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1_500);

  const topNav = page.locator(".sidebar.app-topnav");
  const navBox = await visibleBox(topNav, "top navigation");
  const viewport = page.viewportSize() || { width: 1440, height: 900 };
  if (navBox.height > 62) fail(`top navigation too tall: ${navBox.height}px`);
  if (navBox.width < viewport.width - 8) fail(`top navigation is not full width: ${navBox.width}px`);

  for (const label of ["对话", "智能体", "开发台", "知识库", "项目管理", "系统设置"]) {
    await visibleBox(page.getByRole("button", { name: label, exact: true }).first(), `top nav ${label}`);
  }
  const visibleEnglishNav = await page.locator(".sidebar.app-topnav .nav-label small").evaluateAll((nodes) => nodes.some((node) => {
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().width > 0;
  }));
  if (visibleEnglishNav) fail("top navigation still shows secondary English labels");

  const shellCount = await page.locator(".delivery-three-column").count();
  if (shellCount !== 1) fail(`expected exactly one Dev Console three-column shell, got ${shellCount}`);

  const left = page.locator(".delivery-left-rail");
  const center = page.locator(".delivery-center");
  const right = page.locator(".delivery-right-rail");
  const leftBox = await visibleBox(left, "Dev Console left task stack");
  const centerBox = await visibleBox(center, "Dev Console center thread");
  const rightBox = await visibleBox(right, "Dev Console right inspector");
  if (!(leftBox.x < centerBox.x && centerBox.x < rightBox.x)) {
    fail(`Dev Console columns are not ordered left-center-right: ${leftBox.x}, ${centerBox.x}, ${rightBox.x}`);
  }
  if (rightBox.width < 280) fail(`right inspector too narrow: ${rightBox.width}px`);
  const resizerBox = await page.locator(".delivery-right-rail .development-preview-resizer").first().boundingBox();
  if (resizerBox && resizerBox.width > 12) fail(`right inspector resizer covers content: ${resizerBox.width}px`);

  for (const selector of [
    ".delivery-task-stack",
    ".codex-task-workflow-head",
    ".development-thread",
    ".codex-conversation-thread",
    ".codex-conversation-message",
    ".development-composer",
    ".development-composer .dev-composer-input",
    ".delivery-agent-runtime-inline",
    ".delivery-agent-runtime-chip",
    ".delivery-right-rail-kpi-hero",
    ".delivery-agent-runtime-card",
    ".delivery-current-evidence",
    ".delivery-current-evidence .delivery-inspector-changes",
    ".delivery-output-panel",
    ".delivery-output-list",
  ]) {
    await visibleBox(page.locator(selector).first(), selector);
  }

  await visibleBox(page.getByText(/Token 消耗估算/i).first(), "right rail token label");
  await visibleBox(page.getByText(/目标进度/i).first(), "right rail progress label");
  await visibleBox(page.locator(".delivery-right-rail-kpi-hero [role='progressbar']").first(), "right rail progress bar");
  await visibleBox(page.locator(".delivery-agent-runtime-card").getByText(/Agent Runtime/i).first(), "agent runtime label");
  await visibleBox(page.locator(".delivery-agent-runtime-card").getByText(/Gateway/i).first(), "agent runtime gateway signal");
  await visibleBox(page.locator(".delivery-agent-runtime-card").getByText(/当前代理|任务状态/i).first(), "agent runtime task signal");
  await visibleBox(page.getByText(/Current Task Evidence|CURRENT TASK EVIDENCE/i).first(), "right rail evidence label");
  await visibleBox(page.getByText(/Outputs/i).first(), "right rail outputs label");
  await visibleBox(page.getByText(/产出\s*\/\s*文件变更|文件变更/i).first(), "right rail outputs and file changes label");
  await visibleBox(page.locator(".codex-conversation-thread").getByText(/用户|OpenClaw/).first(), "task conversation message");
  await visibleBox(page.locator(".development-composer").locator("textarea").first(), "bottom composer textarea");
  await visibleBox(page.locator(".development-composer").locator("select.dev-tool-select").first(), "bottom composer mode select");
  const currentEvidenceText = await page.locator(".delivery-current-evidence").innerText();
  if (/<think>|<\/think>|The user is asking me/i.test(currentEvidenceText)) {
    fail("right rail current evidence leaks raw agent thinking");
  }
  await assertRowsDoNotOverlap(page, ".delivery-current-evidence .delivery-inspector-changes button", "right evidence change list");
  await assertRowsDoNotOverlap(page, ".delivery-output-list button", "right output list");

  const openGoalSummary = await page.locator("details.delivery-goal-evidence-summary[open]").count();
  if (openGoalSummary > 0) fail("Goal Evidence summary is expanded by default; right rail should default to current task evidence");
  const inspectorSummaries = await page.locator(".delivery-right-rail details.delivery-inspector-accordion > summary").evaluateAll((nodes) => nodes.map((node) => node.innerText.trim()));
  const goalEvidenceSummaryCount = inspectorSummaries.filter((text) => /^GOAL EVIDENCE/i.test(text)).length;
  if (goalEvidenceSummaryCount > 1) fail(`right rail repeats Goal Evidence summaries: ${goalEvidenceSummaryCount}`);
  await assertVerticalRowsDoNotOverlap(page, ".delivery-right-rail details.delivery-inspector-accordion > summary", "right rail accordion summaries");

  const gatewayText = await page.locator(".development-panel-head--status").innerText();
  if (/Gateway inferred/i.test(gatewayText)) fail("right rail still uses inferred Gateway status");

  await assertRightRailCollapseRestore(page);

  await page.getByRole("button", { name: /多 agents/ }).click();
  await visibleBox(page.locator("#delivery-left-rail-agents-popover"), "multi-agent picker");
  const agentRows = page.locator("#delivery-left-rail-agents-popover .delivery-left-rail-agent");
  if ((await agentRows.count()) > 0) {
    await visibleBox(agentRows.first(), "multi-agent row");
  }
  await page.getByRole("button", { name: /多 agents/ }).click();

  const newConversation = page.getByRole("button", { name: /新对话/ }).first();
  await visibleBox(newConversation, "left rail new conversation button");
  await newConversation.click();
  const launcher = page.getByRole("dialog", { name: /开启新任务对话|新对话/i }).first();
  await visibleBox(launcher, "new conversation dialog");
  await visibleBox(launcher.locator("textarea").first(), "new conversation textarea");
  for (const label of ["项目", "模式", "分支", "上下文"]) {
    await visibleControlInLabel(launcher, label, "select", `new conversation ${label} select`);
  }
  await visibleBox(launcher.getByRole("button", { name: /手动填写/ }).first(), "new conversation manual entry action");
  await visibleBox(launcher.getByRole("button", { name: /取消/ }).first(), "new conversation cancel action");
  await visibleBox(launcher.getByRole("button", { name: /^开启任务$/ }).first(), "new conversation start action");
  const submitStart = launcher.locator('button[type="submit"]').filter({ hasText: /开启任务|开启中/ }).first();
  await visibleBox(submitStart, "new conversation submit action");
  if (!(await submitStart.isDisabled())) fail("new conversation submit action is enabled before a prompt is entered");
  await launcher.getByRole("button", { name: /取消/ }).click();
  await launcher.waitFor({ state: "detached", timeout: 15_000 });

  await page.getByRole("button", { name: /新建技能/ }).click();
  const skillPanel = page.locator(".delivery-quick-panel.skill").first();
  await visibleBox(skillPanel, "skill creation panel");
  await visibleBox(skillPanel.getByText(/新建技能闭环/).first(), "skill panel title");
  await visibleBox(skillPanel.locator('input[placeholder*="技能名称"]').first(), "skill name input");
  await skillPanel.locator("header button").click();

  await page.getByRole("button", { name: /定时任务/ }).click();
  const cronPanel = page.locator(".delivery-quick-panel.cron").first();
  await visibleBox(cronPanel, "cron creation panel");
  await visibleBox(cronPanel.getByText(/新建定时任务闭环/).first(), "cron panel title");
  await visibleBox(cronPanel.locator('input[placeholder*="Cron 表达式"]').first(), "cron expression input");
  await cronPanel.locator("header button").click();

  await page.getByRole("button", { name: /手机操控/ }).click();
  const mobilePanel = page.locator(".delivery-quick-panel.mobile").first();
  await visibleBox(mobilePanel, "mobile control panel");
  await visibleBox(mobilePanel.getByText(/手机操控台/).first(), "mobile panel title");
  await visibleBox(mobilePanel.getByRole("button", { name: /生成配对码/ }).first(), "mobile pairing action");
  await mobilePanel.locator("header button").click();

  await assertNoHorizontalOverflow(page, "Dev Console 1440");
}

async function assertOtherPagesKeepOwnShape(page) {
  const checks = [
    ["对话", ".chat-page, .workbench-shell-chat"],
    ["智能体", ".agent-operator-grid, .agent-workbench-minimal, .page-agent-workbench"],
    ["系统总览", ".workbench-shell-overview, .dashboard-grid-v2"],
    ["指挥中心", ".agent-operator-grid, .page-agent-workbench"],
    ["知识库", ".workbench-shell-knowledge, .atlas-section-head, .knowledge-preview, .knowledge-atlas-home, .knowledge-shell"],
    ["深度研究", ".workbench-shell-research, form.panel.form-grid"],
    ["知识图谱", ".workbench-shell-graph, .graph-page"],
    ["智能助理", ".workbench-shell-assistant, .calendar-grid, .plan-board-shell"],
    ["OPC 运营", ".workbench-shell-opc, .page"],
    ["项目管理", ".workbench-shell-projects, .project-opc-embed, .projects-page, .page"],
    ["系统设置", ".system-section-tabs, .system-summary-banner, .workbench-shell-system, .page"],
  ];
  for (const [label, selector] of checks) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(900);
    const deliveryShells = await page.locator(".delivery-three-column").count();
    if (deliveryShells !== 0) fail(`${label}: should not embed Dev Console three-column shell`);
    await visibleBox(page.locator(selector).first(), `${label} own structure`);
    await visibleBox(page.locator(".sidebar.app-topnav"), `${label} top navigation`);
    await assertNoHorizontalOverflow(page, label);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/401|login_required|setup_required/i.test(msg.text())) errors.push(msg.text());
  });

  await ensureLoggedIn(page);
  const unsafeRequests = trackUnsafeWrites(page);
  await assertDevConsole(page);
  await page.screenshot({ path: "/tmp/openclaw-codex-ui-parity-devconsole-1440.png", fullPage: false });
  await assertOtherPagesKeepOwnShape(page);
  assertNoUnsafeWrites(unsafeRequests);

  if (errors.length) fail(`console/page errors:\n${errors.slice(0, 8).join("\n")}`);

  await page.screenshot({ path: "/tmp/openclaw-codex-ui-parity-1440.png", fullPage: false });
  await browser.close();
  console.log("Codex UI parity verification passed");
  console.log("Dev Console screenshot: /tmp/openclaw-codex-ui-parity-devconsole-1440.png");
  console.log("Screenshot: /tmp/openclaw-codex-ui-parity-1440.png");
})().catch(async (error) => {
  console.error("Codex UI parity verification failed:", error.message);
  process.exit(1);
});
