#!/usr/bin/env node
// V4 修订 - 拍 10 组 web home / agent 截图，每次真切 tab
import { chromium } from "/Users/njx/openclaw_data/openclaw_workbench/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:38889";
const OUT = "/Users/njx/openclaw/copilot/evidence/kb-v3-v4-screenshots-v2";
const ROUNDS = 10;

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

const results = [];

for (let round = 1; round <= ROUNDS; round++) {
  const page = await ctx.newPage();
  let homeMd5 = "", agentMd5 = "", homeErr = null, agentErr = null;

  try {
    // 1. 拍 home
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(1500); // 等 SPA hydration
    const homePath = `${OUT}/round${round}-01-home.png`;
    const homeBuf = await page.screenshot({ path: homePath, fullPage: false });
    homeMd5 = md5(homeBuf);

    // 2. 切到 agent: 先找 Agent tab/link
    let navTo = null;
    // 方案 A: 直接 navigate /agent
    try {
      await page.goto(`${BASE}/agent`, { waitUntil: "networkidle", timeout: 10000 });
      await page.waitForTimeout(1500);
      navTo = "direct /agent";
    } catch (e) {
      navTo = "direct /agent FAILED: " + String(e).slice(0, 100);
    }
    // 方案 B: 如果 A 失败，try click Agent 链接/tab
    if (!navTo.startsWith("direct")) {
      try {
        const agentLink = page.locator('a[href*="agent"], button:has-text("Agent"), [data-tab="agent"]').first();
        if (await agentLink.count() > 0) {
          await agentLink.click();
          await page.waitForTimeout(2000);
          navTo += " + clicked agent link";
        }
      } catch (e) {
        navTo += " click FAIL: " + String(e).slice(0, 100);
      }
    }
    const agentPath = `${OUT}/round${round}-02-agent.png`;
    const agentBuf = await page.screenshot({ path: agentPath, fullPage: false });
    agentMd5 = md5(agentBuf);

    // 3. verify md5 不同
    const sameAsHome = homeMd5 === agentMd5;

    results.push({
      round,
      homeMd5,
      agentMd5,
      sameAsHome,
      navTo,
      homePath,
      agentPath,
    });
    console.log(`[round ${round}] home=${homeMd5.slice(0,8)} agent=${agentMd5.slice(0,8)} same=${sameAsHome} nav=${navTo}`);
  } catch (e) {
    homeErr = String(e).slice(0, 200);
    results.push({ round, homeMd5, agentMd5, homeErr, agentErr });
    console.log(`[round ${round}] ERROR: ${homeErr}`);
  } finally {
    await page.close();
  }
}

await browser.close();

// 写 summary
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