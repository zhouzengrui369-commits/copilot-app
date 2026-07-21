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

// Find any node and click it
const targetInfo = await page.evaluate(() => {
  const d = window.__kg3dDebug;
  if (!d) return { error: "no __kg3dDebug" };
  const ids = Array.from(d.positions.keys());
  // Find a node we can pickNode
  let picked = null;
  for (const id of ids) {
    const pos = d.positions.get(id);
    if (!pos) continue;
    const v = pos.clone();
    d.camera.updateMatrixWorld(true);
    v.project(d.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const hit = d.pickNode(x, y);
    if (hit) { picked = { id, x, y }; break; }
  }
  return picked || { error: "no pickable" };
});
console.log("TARGET:", JSON.stringify(targetInfo));

if (targetInfo.x) {
  // Capture state before
  const before = await page.evaluate(() => {
    const d = window.__kg3dDebug;
    return d ? { cam: [d.camera.position.x, d.camera.position.y, d.camera.position.z], target: [d.controls.target.x, d.controls.target.y, d.controls.target.z] } : null;
  });
  console.log("BEFORE:", JSON.stringify(before));

  await page.mouse.click(targetInfo.x, targetInfo.y);
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const d = window.__kg3dDebug;
    return d ? { cam: [d.camera.position.x, d.camera.position.y, d.camera.position.z], target: [d.controls.target.x, d.controls.target.y, d.controls.target.z] } : null;
  });
  console.log("AFTER:", JSON.stringify(after));
}

const flyLogs = logs.filter(l => /fly|click hit|raycaster|onPointerDown|WebGL|snapped/i.test(l.text));
console.log("\n=== FLY LOGS ===");
flyLogs.forEach(l => console.log(`[${l.type}] ${l.text}`));

await browser.close();
