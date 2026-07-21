// Capture ALL console messages, click on a node, see if fly tick fires
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:38889";
const PASSWORD = "openclaw2026";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Capture ALL console messages + page errors
const allLogs = [];
page.on("console", (msg) => {
  const text = msg.text();
  allLogs.push({ type: msg.type(), text, time: Date.now() });
});
page.on("pageerror", (err) => {
  allLogs.push({ type: "pageerror", text: `PAGE ERROR: ${err.message}\n${err.stack || ""}`, time: Date.now() });
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
await page.waitForTimeout(6000);

// wait for __kg3dDebug to be ready
await page.waitForFunction(() => {
  const d = window.__kg3dDebug;
  return d && d.positions && d.positions.size > 100;
}, { timeout: 10000 }).catch(() => {});

// Use __kg3dDebug to find any pickable and project it to screen, then click
const clickResult = await page.evaluate(() => {
  const d = window.__kg3dDebug;
  if (!d) return { error: "no __kg3dDebug" };
  // Get a position for any node and project it to screen space
  const ids = Array.from(d.positions.keys());
  if (ids.length === 0) return { error: "no positions", positionsSize: d.positions.size, nodeByIdSize: d.nodeById.size };
  // Prefer sub-moc layer (0.5)
  let targetId = null;
  for (const id of ids) {
    const entry = d.nodeById.get(id);
    if (entry && entry.layer === 0.5) { targetId = id; break; }
  }
  if (!targetId) {
    for (const id of ids) {
      const entry = d.nodeById.get(id);
      if (entry && entry.layer === 1) { targetId = id; break; }
    }
  }
  if (!targetId) {
    targetId = ids[0];
  }
  const pos = d.positions.get(targetId);
  if (!pos) return { error: "no position" };
  // Use d.pickNode to find canvas-relative offset
  const entry = d.nodeById.get(targetId);
  // Project: use camera
  const cam = d.camera;
  const v = pos.clone();
  v.project(cam);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  return { targetId, layer: entry.layer, screenX: x, screenY: y, worldX: pos.x, worldY: pos.y, worldZ: pos.z };
});

console.log("CLICK TARGET:", JSON.stringify(clickResult, null, 2));

if (!clickResult.error) {
  // First force camera matrices to update (since WebGL context is lost,
  // renderer.render never runs and matrixWorld may be stale).
  await page.evaluate(() => {
    const d = window.__kg3dDebug;
    if (d && d.camera) {
      d.camera.updateMatrixWorld(true);
      d.camera.updateProjectionMatrix();
    }
  });
  // Verify pickNode at the projected screen position returns our target
  const pickCheck = await page.evaluate(({ sx, sy, tid }) => {
    const d = window.__kg3dDebug;
    if (!d || !d.pickNode) return { error: "no pickNode" };
    const hit = d.pickNode(sx, sy);
    // Try a small grid scan to find ANY hit
    const gridHits = [];
    for (let dx = -60; dx <= 60; dx += 20) {
      for (let dy = -60; dy <= 60; dy += 20) {
        const h = d.pickNode(sx + dx, sy + dy);
        if (h) gridHits.push({ offsetX: dx, offsetY: dy, hitId: h.substring(h.lastIndexOf("/") + 1) });
      }
    }
    return { projectHit: hit, projectHitEnds: hit ? hit.substring(hit.lastIndexOf("/") + 1) : null, targetIdEnds: tid.substring(tid.lastIndexOf("/") + 1), gridHits: gridHits.slice(0, 6), totalGridHits: gridHits.length };
  }, { sx: clickResult.screenX, sy: clickResult.screenY, tid: clickResult.targetId });
  console.log("PICK VERIFY:", JSON.stringify(pickCheck, null, 2));

  // Use the first grid hit if available
  let clickX = clickResult.screenX;
  let clickY = clickResult.screenY;
  if (pickCheck.gridHits && pickCheck.gridHits.length > 0) {
    const gh = pickCheck.gridHits[0];
    clickX = clickX + gh.offsetX;
    clickY = clickY + gh.offsetY;
    console.log("ADJUSTED CLICK to grid offset:", gh);
  }

  await page.mouse.click(clickX, clickY);
  console.log("CLICKED at", clickX, clickY);
  await page.waitForTimeout(5000);

  // Now check final state
  const finalState = await page.evaluate(() => {
    const d = window.__kg3dDebug;
    if (!d) return { error: "no __kg3dDebug" };
    return {
      camPos: [d.camera.position.x.toFixed(2), d.camera.position.y.toFixed(2), d.camera.position.z.toFixed(2)],
      camTarget: [d.controls.target.x.toFixed(2), d.controls.target.y.toFixed(2), d.controls.target.z.toFixed(2)],
      selected: d.selectedNodeId ? d.selectedNodeId() : null,
    };
  });
  console.log("FINAL STATE:", JSON.stringify(finalState, null, 2));
}

// Print all relevant fly logs
const flyLogs = allLogs.filter(l => /fly|click hit|WebGL|pointer|KnowledgeGraph3D|ERROR/i.test(l.text));
console.log("\n=== FLY / CLICK / WEBGL LOGS ===");
flyLogs.forEach(l => console.log(`[${l.type}] ${l.text}`));

console.log("\n=== ALL LOGS COUNT:", allLogs.length, "===");
console.log("\n=== ALL LOGS TAIL (last 20) ===");
allLogs.slice(-20).forEach(l => console.log(`[${l.type}] ${l.text.substring(0, 200)}`));

await browser.close();