#!/usr/bin/env node
// V4 修订 v4 - 38888 desktop app + 正确密码 + 拍 10 组
import { chromium } from "/Users/njx/openclaw_data/openclaw_workbench/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = "http://127.0.0.1:38888"; // desktop app 内嵌 server
const OUT = "/Users/njx/openclaw/copilot/evidence/kb-v3-v4-screenshots-v4";
const ROUNDS = 10;
const PASSWORD = "openclaw2026";

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
  await page.waitForTimeout(2000);
  const pwInput = page.locator('input[type="password"]').first();
  if (await pwInput.count() > 0) {
    await pwInput.fill(PASSWORD);
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.count() > 0) await submit.click();
    await page.waitForTimeout(4000); // 等 login API
    const me = await page.evaluate(async () => {
      try { return await fetch("/api/auth/me").then(r => r.json()); } catch { return null; }
    });
    return me;
  }
  return null;
}

const results = [];

for (let round = 1; round <= ROUNDS; round++) {
  const page = await ctx.newPage();
  let homeMd5 = "", agentMd5 = "", homeErr = null, agentErr = null, navTo = "", meAfterLogin = null;

  try {
    // 1. 登录
    meAfterLogin = await login(page);

    // 2. 拍 home
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2500);
    const homePath = `${OUT}/round${round}-01-home.png`;
    const homeBuf = await page.screenshot({ path: homePath, fullPage: false });
    homeMd5 = md5(homeBuf);

    // 3. 切到 agent: 先看页面有什么
    try {
      // 先尝试点 "智能体" / "Agent" tab/link
      const agentSelectors = [
        'a:has-text("Agent")',
        'a:has-text("智能体")',
        'button:has-text("Agent")',
        'button:has-text("智能体")',
        '[href*="agent"]',
        '[data-tab="agent"]',
      ];
      let clickedTab = "";
      let clicked = false;
      for (const sel of agentSelectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          try {
            await el.click();
            await page.waitForTimeout(3000);
            clickedTab = await el.innerText().catch(() => "");
            navTo = `clicked [${sel}]: ${clickedTab}`;
            clicked = true;
            break;
          } catch (e) { /* try next */ }
        }
      }
      if (!clicked) {
        // 退到 navigate
        await page.goto(`${BASE}/agent`, { waitUntil: "networkidle", timeout: 10000 });
        await page.waitForTimeout(2500);
        navTo = "direct /agent (no clickable link)";
      }
    } catch (e) {
      navTo = `nav FAIL: ${String(e).slice(0, 100)}`;
    }

    const agentPath = `${OUT}/round${round}-02-agent.png`;
    const agentBuf = await page.screenshot({ path: agentPath, fullPage: false });
    agentMd5 = md5(agentBuf);

    const currentUrl = page.url();
    const sameAsHome = homeMd5 === agentMd5;

    results.push({
      round,
      homeMd5,
      agentMd5,
      sameAsHome,
      navTo,
      currentUrl,
      meAfterLogin,
      homePath,
      agentPath,
    });
    console.log(`[round ${round}] home=${homeMd5.slice(0,8)} agent=${agentMd5.slice(0,8)} same=${sameAsHome} nav=${navTo.slice(0,80)} url=${currentUrl} me=${JSON.stringify(meAfterLogin)?.slice(0,40)}`);
  } catch (e) {
    homeErr = String(e).slice(0, 200);
    results.push({ round, homeMd5, agentMd5, homeErr, agentErr, navTo, meAfterLogin });
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
  password_used: PASSWORD,
  results,
  allHomeMd5: Array.from(new Set(results.map(r => r.homeMd5).filter(Boolean))),
  allAgentMd5: Array.from(new Set(results.map(r => r.agentMd5).filter(Boolean))),
  allDistinct: results.every(r => r.homeMd5 && r.agentMd5 && r.homeMd5 !== r.agentMd5),
  distinctHomeAgentRounds: results.filter(r => r.homeMd5 && r.agentMd5 && r.homeMd5 !== r.agentMd5).length,
};

await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));