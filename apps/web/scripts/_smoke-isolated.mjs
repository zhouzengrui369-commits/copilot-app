import { chromium } from "playwright";
const BASE = "http://127.0.0.1:38889";
const PASSWORD = "openclaw2026";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
// Disable cache
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
const page = await ctx.newPage();
await ctx.route("**/*", (route) => {
  const headers = { ...route.request().headers(), "cache-control": "no-cache" };
  route.continue({ headers });
});

const logs = [];
page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text(), url: msg.location()?.url || "" }));
page.on("pageerror", (err) => logs.push({ type: "pageerror", text: err.message }));

await page.goto(`${BASE}/?bust=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.locator("input[type=password]").first().fill(PASSWORD);
await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
await page.waitForSelector("input[type=password]", { state: "detached", timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.goto(`${BASE}/graph?bust=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const sel = page.locator("select").filter({ hasText: "Obsidian Graph" }).first();
await sel.selectOption("cosmos3d");
await page.waitForTimeout(3500);

const allLogs = logs.filter(l => !/WebGL|GPU stall/i.test(l.text));
console.log("=== ALL (non-WebGL) LOGS ===");
allLogs.forEach(l => console.log(`[${l.type}] ${l.text.substring(0, 250)}`));

await browser.close();
