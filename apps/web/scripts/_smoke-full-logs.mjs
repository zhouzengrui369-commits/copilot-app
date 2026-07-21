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
page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text() }));
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

const visibleBox = await page.evaluate(() => {
  const c = document.querySelector(".kg3d-canvas");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
console.log("VISIBLE_BOX:", JSON.stringify(visibleBox));

const camBefore = await page.evaluate(() => {
  const d = (window).__kg3dDebug;
  return { cam: d ? [d.camera.position.x, d.camera.position.y, d.camera.position.z] : null, mountId: d?.mountId };
});
console.log("BEFORE:", JSON.stringify(camBefore));

const cx = visibleBox.x + visibleBox.width / 2;
const cy = visibleBox.y + visibleBox.height / 2;

const sweep = [[0,0],[40,0],[-40,0],[0,40],[0,-40],[60,60],[-60,-60]];
let clicked = false;
let hitNodeId = null;
for (const [dx, dy] of sweep) {
  const hit = await page.evaluate(({ sx, sy }) => {
    const d = (window).__kg3dDebug;
    return d ? d.pickNode(sx, sy) : null;
  }, { sx: cx + dx, sy: cy + dy });
  if (hit) {
    hitNodeId = hit;
    await page.mouse.click(cx + dx, cy + dy);
    clicked = true;
    console.log(`CLICKED at offset (${dx},${dy}), picked ${hit}`);
    break;
  }
}
if (!clicked) await page.mouse.click(cx, cy);

await page.waitForTimeout(2500);

const camAfter = await page.evaluate(() => {
  const d = (window).__kg3dDebug;
  return { cam: d ? [d.camera.position.x, d.camera.position.y, d.camera.position.z] : null, mountId: d?.mountId, selected: d?.selectedNodeId?.() };
});
console.log("AFTER:", JSON.stringify(camAfter));

console.log("\n=== KG3D LOGS ===");
logs.filter(l => /KnowledgeGraph3D/.test(l.text)).forEach(l => console.log(`[${l.type}] ${l.text.substring(0, 300)}`));

await browser.close();
