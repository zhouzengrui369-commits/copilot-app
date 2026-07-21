#!/usr/bin/env node
// V4 修订 final - 38888 + openclaw2026 + 10 轮
import { chromium } from "/Users/njx/openclaw_data/openclaw_workbench/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = "http://127.0.0.1:38888";
const OUT = "/Users/njx/openclaw/copilot/evidence/kb-v3-v4-screenshots-v4";
const ROUNDS = 10;
const PASSWORD = "openclaw2026";

await mkdir(OUT, { recursive: true });

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const md5 = b => createHash("md5").update(b).digest("hex");

const browser = await chromium.launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const results = [];

for (let round = 1; round <= ROUNDS; round++) {
  const page = await ctx.newPage();
  let homeMd5 = "", agentMd5 = "", navTo = "", meAfterLogin = null, clickInfo = "";

  try {
    console.log(`[round ${round}] start`);

    // 1. 登录
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1500);
    const pwCount = await page.locator('input[type="password"]').count();
    if (pwCount > 0) {
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(3000);
      meAfterLogin = await page.evaluate(async () => {
        try { return await fetch("/api/auth/me").then(r => r.json()); } catch { return null; }
      });
    }

    // 2. 拍 home (在登录后的页面)
    await page.waitForTimeout(2000);
    const homeBuf = await page.screenshot({ path: `${OUT}/round${round}-01-home.png` });
    homeMd5 = md5(homeBuf);

    // 3. 切到 agent - 先试 click，再 fallback navigate
    let clicked = false;
    const sels = ['a:has-text("智能体")', 'a:has-text("Agent")', 'button:has-text("Agent")', 'button:has-text("智能体")', '[href*="agent"]'];
    for (const s of sels) {
      const el = page.locator(s).first();
      if (await el.count() > 0) {
        try {
          await el.click();
          await page.waitForTimeout(3000);
          clickInfo = `${s}: ${await el.innerText().catch(() => "")}`;
          clicked = true;
          break;
        } catch {}
      }
    }
    if (!clicked) {
      await page.goto(`${BASE}/agent`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForTimeout(2500);
      clickInfo = "direct /agent (no clickable link)";
    }
    navTo = clickInfo;

    // 4. 拍 agent
    const agentBuf = await page.screenshot({ path: `${OUT}/round${round}-02-agent.png` });
    agentMd5 = md5(agentBuf);

    const currentUrl = page.url();
    const sameAsHome = homeMd5 === agentMd5;
    results.push({
      round, homeMd5, agentMd5, sameAsHome, navTo, currentUrl, meAfterLogin,
      homePath: `${OUT}/round${round}-01-home.png`,
      agentPath: `${OUT}/round${round}-02-agent.png`,
    });
    console.log(`[round ${round}] home=${homeMd5.slice(0,8)} agent=${agentMd5.slice(0,8)} same=${sameAsHome} nav=${navTo.slice(0,60)} me=${JSON.stringify(meAfterLogin)?.slice(0,30) || "null"}`);
  } catch (e) {
    console.log(`[round ${round}] ERROR: ${String(e).slice(0, 200)}`);
    results.push({ round, homeMd5, agentMd5, error: String(e).slice(0, 200), meAfterLogin, navTo });
  } finally {
    await page.close();
  }
}

await browser.close();

const summary = {
  timestamp: new Date().toISOString(),
  rounds: ROUNDS,
  base: BASE,
  password_used: PASSWORD,
  results,
  allHomeMd5: Array.from(new Set(results.map(r => r.homeMd5).filter(Boolean))),
  allAgentMd5: Array.from(new Set(results.map(r => r.agentMd5).filter(Boolean))),
  distinctHomeAgentRounds: results.filter(r => r.homeMd5 && r.agentMd5 && r.homeMd5 !== r.agentMd5).length,
  allDistinct: results.every(r => r.homeMd5 && r.agentMd5 && r.homeMd5 !== r.agentMd5),
};

await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log("\n=== SUMMARY ===");
console.log(`total rounds: ${ROUNDS}`);
console.log(`distinct home md5: ${summary.allHomeMd5.length} -> ${summary.allHomeMd5.map(m=>m.slice(0,8)).join(", ")}`);
console.log(`distinct agent md5: ${summary.allAgentMd5.length} -> ${summary.allAgentMd5.map(m=>m.slice(0,8)).join(", ")}`);
console.log(`distinct home/agent rounds: ${summary.distinctHomeAgentRounds}/${ROUNDS}`);
console.log(`allDistinct: ${summary.allDistinct}`);