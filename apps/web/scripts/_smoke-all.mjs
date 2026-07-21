import { chromium } from "playwright";
const BASE = "http://127.0.0.1:38889";
const PASSWORD = "openclaw2026";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("KnowledgeGraph3D") || text.includes("kg3d") || text.includes("fly")) {
    logs.push(`[${msg.type()}] ${text}`);
  }
});
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.locator("input[type=password]").first().fill(PASSWORD);
await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
await page.waitForSelector("input[type=password]", { state: "detached", timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.goto(`${BASE}/graph`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const sel = page.locator("select").filter({ hasText: "Obsidian Graph" }).first();
await sel.selectOption("cosmos3d");
await page.waitForTimeout(3500);

console.log("=== after activate 3D ===");
console.log("logs so far:", logs.length);
logs.forEach(l => console.log("  ", l));
logs.length = 0;

// Find canvas and click
const canvasCount = await page.locator(".kg3d-canvas canvas").count();
console.log("canvas count:", canvasCount);
const canvas = page.locator(".kg3d-canvas canvas").first();
const box = await canvas.boundingBox();
console.log("canvas box:", box);
if (box) {
  console.log("Clicking at", box.x + box.width/2, box.y + box.height/2);
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await page.waitForTimeout(2000);
  console.log("\n=== after click ===");
  console.log("logs:");
  logs.forEach(l => console.log("  ", l));
  const state = await page.evaluate(() => {
    const d = window.__kg3dDebug;
    if (!d) return { error: "no debug" };
    return {
      camera: { x: d.camera.position.x.toFixed(2), y: d.camera.position.y.toFixed(2), z: d.camera.position.z.toFixed(2), dist: d.camera.position.length().toFixed(2) },
      target: { x: d.controls.target.x.toFixed(2), y: d.controls.target.y.toFixed(2), z: d.controls.target.z.toFixed(2) },
      selectedNodeId: d.selectedNodeId(),
    };
  });
  console.log("\nSTATE:", JSON.stringify(state, null, 2));
}
await browser.close();
