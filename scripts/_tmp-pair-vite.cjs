const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // vite dev (38889)
  await page.goto("http://127.0.0.1:38889/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.fill("openclaw2026"); await pw.press("Enter"); await page.waitForTimeout(4000); }

  await page.goto("http://127.0.0.1:38889/mobile", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  await page.screenshot({ path: "/tmp/mobile-vite-page.png", fullPage: true });

  // 点"生成配对码"
  const btn = page.locator("text=生成配对码").first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: "/tmp/mobile-vite-page-2.png", fullPage: true });

  const body = await page.locator("body").innerText();
  const codeMatch = body.match(/(\d{6})/g);
  console.log("All 6-digit:", codeMatch);
  console.log("Body snippet:", body.slice(0, 2000));

  fs.writeFileSync("/tmp/pair-vite-result.json", JSON.stringify({
    possibleCodes: codeMatch,
    snippet: body.slice(0, 3000),
  }, null, 2));

  await browser.close();
})();
