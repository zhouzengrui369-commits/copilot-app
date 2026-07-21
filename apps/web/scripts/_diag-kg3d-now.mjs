import { chromium } from "playwright";
const BASE = "http://127.0.0.1:38889";
const PASSWORD = "openclaw2026";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
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

const probe = await page.evaluate(() => {
  const d = window.__kg3dDebug;
  if (!d) return { error: "no __kg3dDebug" };
  // Look for any node containing 'ima' or '.codex'
  const allIds = Array.from(d.positions.keys());
  const imaIds = allIds.filter(id => id.toLowerCase().includes("ima") || id.toLowerCase().includes("codex"));
  const nodeByIdHasIma = Array.from(d.nodeById.keys()).filter(id => id.toLowerCase().includes("ima") || id.toLowerCase().includes("codex"));
  // Get a nodeById entry to inspect layer
  const sampleNode = nodeByIdHasIma.length > 0 ? d.nodeById.get(nodeByIdHasIma[0]) : null;
  const samplePos = imaIds.length > 0 ? d.positions.get(imaIds[0]) : null;
  return {
    positionsTotal: allIds.length,
    positionsWithImaOrCodex: imaIds,
    nodeByIdWithImaOrCodex: nodeByIdHasIma,
    sampleNode: sampleNode ? { id: sampleNode.node.id, layer: sampleNode.layer, type: sampleNode.node.type, source: sampleNode.node.source } : null,
    samplePos: samplePos ? { x: samplePos.x.toFixed(2), y: samplePos.y.toFixed(2), z: samplePos.z.toFixed(2) } : null,
    nodeByIdSize: d.nodeById.size,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
