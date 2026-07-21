// Diagnostic: load /graph, activate cosmos3d, dump DOM state
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:38889";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PASSWORD = "openclaw2026";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1500));

// Login via API
const r = await page.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
console.log("login:", r.status());

await page.goto(`${BASE}/graph`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));

// Find and select cosmos3d
const sel = page.locator("select").filter({ hasText: "Obsidian Graph" }).first();
const selCount = await sel.count();
console.log("select count:", selCount);
if (selCount > 0) {
  await sel.selectOption("cosmos3d");
  console.log("selected cosmos3d");
}

await new Promise((r) => setTimeout(r, 5000));

// Dump state
const state = await page.evaluate(() => {
  const root = document.querySelector(".kg3d-root");
  const canvasLayer = document.querySelector(".kg3d-canvas");
  const labelLayer = document.querySelector(".kg3d-label-layer");
  const fallback = document.querySelector(".kg3d-fallback");
  const loading = document.querySelector(".kg3d-loading");
  const allCanvases = document.querySelectorAll("canvas");
  const inCanvasLayer = canvasLayer ? canvasLayer.querySelectorAll("canvas").length : 0;
  // Try probe
  const probe = document.createElement("canvas");
  const webgl2 = !!probe.getContext("webgl2");
  const webgl = !!probe.getContext("webgl");
  return {
    hasKg3dRoot: !!root,
    kg3dRootSize: root ? `${root.clientWidth}x${root.clientHeight}` : "n/a",
    hasCanvasLayer: !!canvasLayer,
    canvasLayerSize: canvasLayer ? `${canvasLayer.clientWidth}x${canvasLayer.clientHeight}` : "n/a",
    canvasLayerHTML: canvasLayer ? canvasLayer.innerHTML.slice(0, 300) : "n/a",
    canvasesInKg3dCanvas: inCanvasLayer,
    hasLabelLayer: !!labelLayer,
    hasFallback: !!fallback,
    fallbackText: fallback ? fallback.textContent : null,
    hasLoading: !!loading,
    totalCanvases: allCanvases.length,
    webgl2Available: webgl2,
    webglAvailable: webgl,
    bodyClasses: document.body.className,
    visualStyleSelectValue: document.querySelector("select")?.value,
  };
});

console.log("STATE:", JSON.stringify(state, null, 2));

// Take a screenshot to see what's happening
await page.screenshot({ path: "/tmp/kg3d-diagnostic.png", fullPage: false });
console.log("screenshot saved to /tmp/kg3d-diagnostic.png");

await browser.close();
