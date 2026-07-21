const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 1. 登录 vite 38889
  await page.goto("http://127.0.0.1:38889/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.fill("openclaw2026"); await pw.press("Enter"); }
  await page.waitForTimeout(4500);
  await page.screenshot({ path: "/tmp/mobile-after-login.png", fullPage: true });

  // 2. 进 /mobile
  await page.goto("http://127.0.0.1:38889/mobile", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: "/tmp/mobile-mobile-page.png", fullPage: true });

  // 3. 点"生成配对码"
  const btn = page.locator("text=生成配对码").first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(4500);
  }
  await page.screenshot({ path: "/tmp/mobile-after-gen.png", fullPage: true });

  const body = await page.locator("body").innerText();
  const codeMatch = body.match(/(\d{6})/g);
  console.log("6-digit codes found:", codeMatch);
  console.log("URL seen on page (LAN):", body.match(/http:\/\/[0-9.:]+/g));
  console.log("---BODY---");
  console.log(body.slice(0, 3000));

  fs.writeFileSync("/tmp/pair2-result.json", JSON.stringify({
    codes: codeMatch,
    body: body.slice(0, 5000),
  }, null, 2));

  await browser.close();
})();
