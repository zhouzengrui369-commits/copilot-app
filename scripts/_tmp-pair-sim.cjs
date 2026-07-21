// 用 Playwright 进 workbench /mobile, 点"生成配对码", 把 6 位码 + bootstrap URL 写到 /tmp/pair-result.json
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("http://127.0.0.1:38888/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.fill("openclaw2026"); await pw.press("Enter"); await page.waitForTimeout(3500); }

  await page.goto("http://127.0.0.1:38888/mobile", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // bootstrap URL
  const body = await page.locator("body").innerText();
  const urlMatch = body.match(/http:\/\/[^ ]*?:38888/);
  const lanUrl = urlMatch ? urlMatch[0] : "http://127.0.0.1:38888";
  console.log("LAN URL:", lanUrl);

  // 点"生成配对码"
  const btn = page.locator("text=生成配对码").first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(3000);
  }

  // 抓 6 位码
  const codeMatch = body.match(/配对码[^\d]{0,20}(\d{6})/);
  // 改：截图前再读一次 body
  await page.screenshot({ path: "/tmp/mobile-pairing-page.png", fullPage: true });
  const body2 = await page.locator("body").innerText();
  const codeMatch2 = body2.match(/(\d{6})/g);
  console.log("All 6-digit codes on page:", codeMatch2);

  fs.writeFileSync("/tmp/pair-result.json", JSON.stringify({
    lanUrl,
    possibleCodes: codeMatch2,
    pageSnippet: body2.slice(0, 2000),
  }, null, 2));

  await browser.close();
})();
