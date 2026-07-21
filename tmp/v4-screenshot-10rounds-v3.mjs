#!/usr/bin/env node
// V4 修订 v2 - 加登录 + 拍 10 组 web home / agent 截图
import { chromium } from "/Users/njx/openclaw_data/openclaw_workbench/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = "http://127.0.0.1:38889";
const OUT = "/Users/njx/openclaw/copilot/evidence/kb-v3-v4-screenshots-v3";
const ROUNDS = 10;
const PASSWORD = "iter16-verifier";

await mkdir(OUT, { recursive: true });

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function md5(buf) {
  return createHash("md5").update(buf).digest("hex");
}

const browser = await chromium.launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1500);
  const pwInput = page.locator('input[type="password"]').first();
  if (await pwInput.count() > 0) {
    await pwInput.fill(PASSWORD);
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.count() > 0) await submit.click();
    await page.waitForTimeout(3000); // 等 login API 返回
    console.log(`   login done`);
  } else {
    console.log(`   no login form`);
  }
}

const results = [];

for (let round = 1; round <= ROUNDS; round++) {
  const page = await ctx.newPage();
  let homeMd5 = "", agentMd5 = "", homeErr = null, agentErr = null, navTo = "";

  try {
    // 1. 登录
    await login(page);

    // 2. 拍 home
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2000); // 等 SPA hydration
    const homePath = `${OUT}/round${round}-01-home.png`;
    const homeBuf = await page.screenshot({ path: homePath, fullPage: false });
    homeMd5 = md5(homeBuf);

    // 3. 切到 agent: 先看页面有什么 tab/link
    const pageText = await page.locator("body").innerText().catch(() => "");
    let clickedTab = "";
    try {
      // 试多种选择器
      const agentLink = page.locator('a:has-text("Agent"), button:has-text("Agent"), [href*="agent"], [data-tab="agent"]').first();
      if (await agentLink.count() > 0) {
        await agentLink.click();
        await page.waitForTimeout(2500);
        clickedTab = await agentLink.innerText().catch(() => "");
        navTo = `clicked: ${clickedTab}`;
      } else {
        // 试 navigate
        await page.goto(`${BASE}/agent`, { waitUntil: "networkidle", timeout: 10000 });
        await page.waitForTimeout(2000);
        navTo = "direct /agent (no link found)";
      }
    } catch (e) {
      navTo = `nav FAIL: ${String(e).slice(0, 100)}`;
    }

    const agentPath = `${OUT}/round${round}-02-agent.png`;
    const agentBuf = await page.screenshot({ path: agentPath, fullPage: false });
    agentMd5 = md5(agentBuf);

    // 4. 记录 url 看真到 agent 没
    const currentUrl = page.url();

    const sameAsHome = homeMd5 === agentMd5;
    results.push({ round, homeMd5, agentMd5, sameAsHome, navTo, currentUrl, homePath, agentPath });
    console.log(`[round ${round}] home=${homeMd5.slice(0,8)} agent=${agentMd5.slice(0,8)} same=${sameAsHome} nav=${navTo} url=${currentUrl}`);
  } catch (e) {
    homeErr = String(e).slice(0, 200);
    results.push({ round, homeMd5, agentMd5, homeErr, agentErr, navTo });
    console.log(`[round ${round}] ERROR: ${homeErr}`);
  } finally {
    await page.close();
  }
}

await browser.close();

const summary = {
  timestamp: new Date().toISOString(),
  rounds: ROUNDS,
  base: BASE,
  results,
  allDistinct: results.every(r => r.homeMd5 !== r.agentMd5),
  allHomeUnique: new Set(results.map(r => r.homeMd5).filter(Boolean)).size === results.filter(r => r.homeMd5).length,
  allAgentUnique: new Set(results.map(r => r.agentMd5).filter(Boolean)).size === results.filter(r => r.agentMd5).length,
};

await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));