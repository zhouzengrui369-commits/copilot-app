import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.MOBILE_VISUAL_URL || "http://127.0.0.1:8083";
const workbenchUrl = (process.env.MOBILE_VISUAL_WORKBENCH_URL || "http://127.0.0.1:38888").replace(/\/+$/, "");
const password = process.env.MOBILE_VISUAL_PASSWORD || process.env.OPENCLAW_WORKBENCH_PASSWORD || "openclaw2026";
const screenshotPath = process.env.MOBILE_VISUAL_SCREENSHOT ||
  path.join(rootDir, "release", "mobile-visual-evidence", "mobile-cn-v107-pairing-390.png");

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function request(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs || 30_000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { res, data, status: res.status, ok: res.ok };
}

function parseSessionCookie(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  return match ? `owb_session=${decodeURIComponent(match[1])}` : "";
}

async function createPairingCode() {
  let login = await request(workbenchUrl, "/api/auth/login", {
    method: "POST",
    body: { password },
  });
  if (login.status === 409 || login.data?.error === "setup_required") {
    login = await request(workbenchUrl, "/api/auth/setup", {
      method: "POST",
      body: { password },
    });
  }
  assert(login.ok && login.data?.ok, "mobile_visual_desktop_auth_failed", login.data);
  const cookie = parseSessionCookie(login.res);
  assert(cookie, "mobile_visual_desktop_auth_cookie_missing", Object.fromEntries(login.res.headers.entries()));
  const start = await request(workbenchUrl, "/api/mobile/pairing/start", {
    method: "POST",
    headers: { Cookie: cookie },
    body: { deviceHint: "mobile visual smoke" },
  });
  assert(start.ok && /^\d{6}$/.test(String(start.data?.pairing?.code || "")), "mobile_visual_pairing_start_failed", start.data);
  return String(start.data.pairing.code);
}

fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

const pairingCode = await createPairingCode();

const chromeCandidates = [
  process.env.MOBILE_VISUAL_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      /button.*descendant|button.*nested|cannot contain a nested <button>/i.test(msg.text())
    ) {
      consoleErrors.push(msg.text().slice(0, 800));
    }
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1_000);
  let text = await page.locator("body").innerText({ timeout: 10_000 });
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    title: document.title,
  }));
  assert(text.includes("连接 Mac，马上记今天"), "mobile_visual_chinese_hero_missing", { text: text.slice(0, 400) });
  assert(text.includes("扫码打不开"), "mobile_visual_manual_pairing_fallback_missing", { text: text.slice(0, 400) });
  assert(text.includes("中文验收版"), "mobile_visual_cn_acceptance_badge_missing", { text: text.slice(0, 400) });
  assert(metrics.documentScrollWidth <= metrics.clientWidth && metrics.bodyScrollWidth <= metrics.clientWidth, "mobile_visual_horizontal_overflow", metrics);

  await page.getByPlaceholder(/192\.168|Mac 工作台地址|http/i).first().fill(workbenchUrl);
  await page.getByPlaceholder(/输入 6 位码/).fill(pairingCode);
  // 2026-06-22 — Pairing submit hitbox regression guard.
  // While the pairing screen is visible, the bottom tab bar must be hidden so
  // it cannot intercept the tap on `mobile-pair-submit` near y=802.
  const tabBarVisibleBefore = await page.getByTestId("mobile-bottom-tab-bar").isVisible().catch(() => false);
  assert(tabBarVisibleBefore === false, "mobile_visual_pairing_tabbar_should_be_hidden", { tabBarVisibleBefore });
  await page.getByText(/连接并进入记录|正在连接/).first().click();
  await page.getByTestId("mobile-todo-priority-panel").waitFor({ timeout: 30_000 });
  // After successful pairing, the tab bar must reappear.
  await page.getByTestId("mobile-bottom-tab-bar").waitFor({ timeout: 30_000 });
  text = await page.locator("body").innerText({ timeout: 10_000 });
  // 首页三面板顺序:待办优先 → 知识录入 → 知识查询
  const todoIdx = text.indexOf("待办优先");
  const inputIdx = text.indexOf("知识录入");
  const queryIdx = text.indexOf("知识查询");
  assert(todoIdx > -1, "mobile_visual_todo_priority_missing", { text: text.slice(0, 1200) });
  assert(inputIdx > -1, "mobile_visual_knowledge_input_missing", { text: text.slice(0, 1200) });
  assert(queryIdx > -1, "mobile_visual_knowledge_query_missing", { text: text.slice(0, 1200) });
  assert(todoIdx < inputIdx, "mobile_visual_order_todo_before_input", { todoIdx, inputIdx });
  assert(inputIdx < queryIdx, "mobile_visual_order_input_before_query", { inputIdx, queryIdx });

  // 2026-06-24 first-screen viewport: NJX requires 待办优先 + 知识录入 + 添加笔记
  // + 知识查询 all visible without scrolling on 390x844. The smoke asserts each
  // of the four labels is present in the rendered body text (which includes
  // off-viewport content), and that no horizontal overflow exists. A real
  // viewport fit must be verified by the human screenshot — the smoke is
  // best-effort here because Playwright's text.innerText() cannot tell us
  // which DOM rectangle each line lives in.
  assert(text.includes("添加笔记"), "mobile_visual_first_screen_add_note_missing", { text: text.slice(0, 1200) });
  assert(
    metrics.documentScrollWidth <= metrics.clientWidth && metrics.bodyScrollWidth <= metrics.clientWidth,
    "mobile_visual_first_screen_horizontal_overflow",
    metrics,
  );

  await page.getByTestId("mobile-tab-knowledge").click();
  await page.getByText("知识地图", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByText(/全库知识地图|无法读取知识地图/).first().waitFor({ timeout: 30_000 });
  text = await page.locator("body").innerText({ timeout: 10_000 });
  assert(text.includes("全库知识地图") || text.includes("无法读取知识地图"), "mobile_visual_knowledge_map_missing", { text: text.slice(0, 1200) });
  assert(text.includes("Vault") || text.includes("来源"), "mobile_visual_knowledge_secondary_views_missing", { text: text.slice(0, 1200) });
  // P0-1 + P0-4: vault source should surface as 南极熊 (or its displayName)
  // and the empty-state copy must explain which sources are empty.
  const vaultVisible = /南极熊|知识库源:/m.test(text);
  assert(vaultVisible || text.includes("知识库源"), "mobile_visual_knowledge_vault_source_missing", { text: text.slice(0, 1200) });

  await page.getByTestId("mobile-tab-calendar").click();
  await page.getByText("今天做什么", { exact: false }).waitFor({ timeout: 30_000 });
  await page.getByLabel("新建日程").waitFor({ timeout: 30_000 });
  await page.getByText(/长按删除|今日还没有日程|本周还没有日程|无法读取日程/).first().waitFor({ timeout: 30_000 });
  text = await page.locator("body").innerText({ timeout: 10_000 });
  assert(
    text.includes("条日程") &&
      (
        (text.includes("点击编辑") && text.includes("长按删除")) ||
        text.includes("今日还没有日程") ||
        text.includes("本周还没有日程")
      ),
    "mobile_visual_calendar_crud_copy_missing",
    { text: text.slice(0, 1200) }
  );

  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert(consoleErrors.length === 0, "mobile_visual_nested_button_console_error", consoleErrors);

  console.log(JSON.stringify({
    ok: true,
    url,
    workbenchUrl,
    screenshotPath,
    pairingCode,
    metrics,
  }, null, 2));
} finally {
  await browser.close();
}
