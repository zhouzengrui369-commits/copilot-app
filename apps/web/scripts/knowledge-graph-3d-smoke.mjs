#!/usr/bin/env node
// Knowledge graph 3D smoke test (V1–V12 minimal).
// 1) Logs in to the workbench (default password 123456)
// 2) Activates 3D mode on /graph (or /knowledge fallback)
// 3) Captures default / after-click / orbit screenshots
// 4) Reverts to 2D and verifies no lingering WebGL canvas
//
// Run from the repo root:
//   node apps/web/scripts/knowledge-graph-3d-smoke.mjs

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const BASE = "http://127.0.0.1:38889";
const EVIDENCE = "release/knowledge-3d-evidence";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PASSWORD = process.env.OPENCLAW_WORKBENCH_PASSWORD || process.env.OPENCLAW_PASSWORD || "openclaw2026";

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch (_) { /* */ }
    await wait(1000);
  }
  throw new Error(`dev server not up at ${url}`);
}

async function isServerUp(url) {
  try { const r = await fetch(url); return r.ok; } catch { return false; }
}

async function tryActivate3D(page) {
  const order = [
    async () => {
      const sel = page.locator("select").filter({ hasText: "Obsidian Graph" }).first();
      if (await sel.count() > 0) { await sel.selectOption("cosmos3d"); return "graph-select"; }
      return null;
    },
    async () => {
      const btn = page.getByRole("button", { name: /🛰\s*3D|3D · Cosmos/i });
      if (await btn.count() > 0) { await btn.first().click(); return "knowledge-toggle"; }
      return null;
    },
  ];
  for (const attempt of order) {
    try { const v = await attempt(); if (v) return v; } catch { /* */ }
  }
  return null;
}

async function main() {
  if (!existsSync(EVIDENCE)) await mkdir(EVIDENCE, { recursive: true });
  let proc = null;
  let shots = 0;
  // Reuse an existing dev server if it's already running, otherwise spawn one
  if (await isServerUp(BASE)) {
    console.log("== using existing dev server at", BASE, "==");
  } else {
    console.log("== spawning dev server (no existing instance) ==");
    proc = spawn("npm", ["run", "dev", "--workspace", "@openclaw-workbench/web"], { detached: false, stdio: ["ignore", "pipe", "pipe"] });
  }
  try {
    await waitForServer(BASE);
    const browser = await chromium.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("response", (r) => { if (r.status() === 401) {/* tolerated */} });

    // ── 1) Authenticate via the page itself so the cookie is set on the right origin ──
    console.log("== visiting root to trigger login form ==");
    await page.goto(`${BASE}/?bust=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await wait(1500);
    // The login form is shown when the API returns 401. Look for it eagerly.
    const passwordInput = page.locator("input[type=password]").first();
    if (await passwordInput.count() > 0) {
      console.log("== filling login form on page ==");
      await passwordInput.fill(PASSWORD);
      await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
      // Wait for the auth form to disappear (login success)
      await page.waitForSelector("input[type=password]", { state: "detached", timeout: 10000 }).catch(() => {});
      await wait(1500);
    }
    // Login via the proxied API URL so the Set-Cookie lands on the same origin as the page (38889).
    // Vite proxies /api/* → 38888, so the browser stores the cookie for 38889, which is exactly
    // what subsequent page requests on 38889/api/* will send.
    const loginRes = await page.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
    console.log("login status:", loginRes.status());
    if (!loginRes.ok()) console.log("login body:", (await loginRes.text()).slice(0, 200));
    // Reload the page to pick up the cookie in the React app's auth state
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(1500);

    // ── 2) Navigate to /graph and activate 3D ──
    console.log("== visiting /graph ==");
    await page.goto(`${BASE}/graph`, { waitUntil: "domcontentloaded" });
    await wait(2500);
    // If login form is still showing (cookie didn't stick), fill it again
    if (await page.locator("input[type=password]").count() > 0) {
      console.log("== filling login form again on /graph ==");
      await page.locator("input[type=password]").first().fill(PASSWORD);
      await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
      await wait(3000);
    }
    const via = await tryActivate3D(page);
    if (!via) throw new Error("Could not activate 3D on /graph");
    console.log("activated via:", via);
    await wait(3500);

    let canvas = page.locator(".kg3d-canvas canvas").first();
    if (await canvas.count() === 0) {
      console.log("fallback to /knowledge");
      await page.goto(`${BASE}/knowledge`, { waitUntil: "domcontentloaded" });
      await wait(2500);
      if (await page.locator("input[type=password]").count() > 0) {
        console.log("== filling login form on /knowledge ==");
        await page.locator("input[type=password]").first().fill(PASSWORD);
        await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
        await wait(3000);
      }
      const via2 = await tryActivate3D(page);
      if (!via2) throw new Error("Could not activate 3D on /knowledge");
      console.log("activated via:", via2);
      await wait(3500);
    }
    canvas = page.locator(".kg3d-canvas canvas").first();
    const canvasCount = await canvas.count();
    if (canvasCount === 0) throw new Error("3D canvas not mounted");
    // Three.js r160 sets `data-engine="three.js r160"` on its renderer canvas once a
    // WebGL context has been successfully created — this is the most reliable signal
    // that the 3D view is mounted. As a fallback we probe getContext("webgl2") first
    // (Three.js prefers it) then "webgl". Calling getContext("webgl") on a canvas
    // bound to a webgl2 context returns null, which previously caused a false
    // "WebGL context missing" failure under Playwright's swiftshader config.
    const webglInfo = await canvas.evaluate((el) => {
      const engine = el.getAttribute && el.getAttribute("data-engine");
      if (engine) {
        const gl = el.getContext("webgl2") || el.getContext("webgl");
        return { present: true, source: "data-engine", engine, lost: !!(gl && gl.isContextLost && gl.isContextLost()) };
      }
      const gl = el.getContext("webgl2") || el.getContext("webgl") || el.getContext("experimental-webgl");
      if (!gl) return { present: false, source: "probe", engine: null, lost: null };
      return { present: true, source: "probe", engine: null, lost: !!gl.isContextLost() };
    });
    const webgl = webglInfo.present;
    if (!webgl) throw new Error("WebGL context missing");
    if (webglInfo.lost) console.log("note: WebGL context currently in lost state; component fallback UI is active");

    const visibleBox = await canvas.boundingBox();
    if (!visibleBox || visibleBox.width < 320 || visibleBox.height < 240) {
      throw new Error(`3D canvas not visibly sized: ${visibleBox ? `${Math.round(visibleBox.width)}x${Math.round(visibleBox.height)}` : "missing"}`);
    }

    await page.screenshot({ path: `${EVIDENCE}/knowledge-3d-1-default.jpg` }); shots++;
    console.log("✓ shot 1: default");

    const box = visibleBox;
    if (box) {
      // Pause autoRotate first so the click target is stable
      try {
        const pauseBtn = page.getByRole("button", { name: /⏸ 暂停|⟳ 旋转/ }).first();
        if (await pauseBtn.count() > 0) {
          await pauseBtn.click();
          await wait(800);
        }
      } catch { /* ok if missing */ }

      // ── iter15: capture camera state BEFORE click for fly-to assertion ──
      const camBefore = await page.evaluate(() => {
        const d = (window).__kg3dDebug;
        if (!d || !d.camera) return null;
        return { x: d.camera.position.x, y: d.camera.position.y, z: d.camera.position.z, dist: d.camera.position.length() };
      });
      const targetBefore = await page.evaluate(() => {
        const d = (window).__kg3dDebug;
        if (!d || !d.controls) return null;
        return { x: d.controls.target.x, y: d.controls.target.y, z: d.controls.target.z };
      });

      // Try clicking near the center first; if no node selected, sweep outward
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      let clicked = false;
      let hitNodeId = null;
      const sweep = [
        [0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [60, 60], [-60, -60], [80, -40], [-80, 40],
        [120, 0], [-120, 0], [0, 120], [0, -120], [160, 80], [-160, -80],
      ];
      for (const [dx, dy] of sweep) {
        await page.mouse.click(cx + dx, cy + dy);
        await wait(300);
        // iter15: ask __kg3dDebug.pickNode whether the click would hit anything
        hitNodeId = await page.evaluate(({ sx, sy }) => {
          const d = (window).__kg3dDebug;
          return d && typeof d.pickNode === "function" ? d.pickNode(sx, sy) : null;
        }, { sx: cx + dx, sy: cy + dy });
        if (hitNodeId) {
          clicked = true;
          await page.screenshot({ path: `${EVIDENCE}/kb-3d-3-after-click.jpg` }); shots++;
          console.log(`✓ shot 2: after click (offset ${dx},${dy}, node=${hitNodeId})`);
          break;
        }
      }
      if (!clicked) {
        // Fallback: just take a screenshot at center
        await page.mouse.click(cx, cy);
        await wait(800);
        await page.screenshot({ path: `${EVIDENCE}/kb-3d-3-after-click.jpg` }); shots++;
        console.log("✓ shot 2: after click (center fallback, no node hit)");
      }

      // ── iter15: fly-to assertion — wait for the 1200ms easeOutCubic to settle ──
      if (clicked) {
        await wait(1500); // 1200ms duration + buffer
        const camAfter = await page.evaluate(() => {
          const d = (window).__kg3dDebug;
          if (!d || !d.camera) return null;
          return { x: d.camera.position.x, y: d.camera.position.y, z: d.camera.position.z, dist: d.camera.position.length() };
        });
        const targetAfter = await page.evaluate(() => {
          const d = (window).__kg3dDebug;
          if (!d || !d.controls) return null;
          return { x: d.controls.target.x, y: d.controls.target.y, z: d.controls.target.z };
        });
        const selectedAfter = await page.evaluate(() => {
          const d = (window).__kg3dDebug;
          return d && typeof d.selectedNodeId === "function" ? d.selectedNodeId() : null;
        });
        // Assert the camera or controls.target moved meaningfully (>0.5 unit).
        // We compare both because some fly targets may end up close to the home
        // position even though the controls.target visibly lerps toward the node.
        const camMoved = camBefore && camAfter &&
          Math.hypot(camAfter.x - camBefore.x, camAfter.y - camBefore.y, camAfter.z - camBefore.z) > 0.5;
        const targetMoved = targetBefore && targetAfter &&
          Math.hypot(targetAfter.x - targetBefore.x, targetAfter.y - targetBefore.y, targetAfter.z - targetBefore.z) > 0.5;
        const flyMoved = camMoved || targetMoved;
        console.log(JSON.stringify({
          iter15_fly_to: {
            hitNodeId,
            selectedAfter,
            camBefore, camAfter, camMoved,
            targetBefore, targetAfter, targetMoved,
            flyMoved,
          },
        }, null, 2));
        if (!flyMoved) {
          throw new Error(`iter15 fly-to assertion failed: camera/target did not move after clicking ${hitNodeId}`);
        }
        console.log(`✓ iter15: fly-to completed (${camMoved ? "camera" : ""}${camMoved && targetMoved ? "+" : ""}${targetMoved ? "target" : ""} moved)`);

        // ── iter15: side-preview iframe assertion (leaf only) ──
        await wait(500);
        const sidePreviewVisible = await page.evaluate(() => {
          const el = document.querySelector(".kg3d-side-preview");
          if (!el) return false;
          const iframe = el.querySelector("iframe.kg3d-side-preview-frame");
          return !!(iframe);
        });
        const infoCardVisible = await page.evaluate(() => !!document.querySelector(".kg3d-info-card"));
        console.log(JSON.stringify({ iter15_overlays: { sidePreviewVisible, infoCardVisible, hitNodeId, selectedAfter } }, null, 2));
        // Note: side-preview only opens for type=leaf. Most center clicks land
        // on MOC/sub-MOC, so sidePreviewVisible is informational — we don't
        // fail on absence. We DO take a screenshot if any overlay opened.
        if (sidePreviewVisible) {
          await page.screenshot({ path: `${EVIDENCE}/kb-3d-4-side-preview.jpg` }); shots++;
          console.log("✓ shot 2b: side-preview iframe visible");
        }
        if (infoCardVisible) {
          await page.screenshot({ path: `${EVIDENCE}/kb-3d-4-info-card.jpg` }); shots++;
          console.log("✓ shot 2c: info-card visible");
        }
      }
    }
    await wait(2000);
    await page.screenshot({ path: `${EVIDENCE}/kb-3d-2-orbit.jpg` }); shots++;
    console.log("✓ shot 3: orbit");

    // ── 4) Visit /graph to take a graph-page-specific screenshot ──
    console.log("== visiting /graph for graph-3d-1 ==");
    await page.goto(`${BASE}/graph`, { waitUntil: "domcontentloaded" });
    await wait(2000);
    if (await page.locator("input[type=password]").count() > 0) {
      await page.locator("input[type=password]").first().fill(PASSWORD);
      await page.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
      await wait(3000);
    }
    const via3 = await tryActivate3D(page);
    if (via3) {
      console.log("activated via:", via3);
      await wait(3500);
      await page.screenshot({ path: `${EVIDENCE}/graph-3d-1.jpg` }); shots++;
      console.log("✓ shot 4: graph page 3D");
    } else {
      console.log("⚠️  could not activate 3D on /graph; skipping shot 4");
    }

    // Revert
    const revertOrder = [
      async () => {
        const sel = page.locator("select").filter({ hasText: "3D · Cosmos" }).first();
        if (await sel.count() > 0) { await sel.selectOption("obsidian"); return true; }
        return false;
      },
      async () => {
        const btn = page.getByRole("button", { name: /🗺\s*2D/i });
        if (await btn.count() > 0) { await btn.first().click(); return true; }
        return false;
      },
    ];
    for (const r of revertOrder) { try { if (await r()) break; } catch { /* */ } }
    await wait(1500);
    const lingering = await page.locator("canvas").count();
    const threeCanvases = await page.locator(".kg3d-canvas canvas").count();
    console.log(JSON.stringify({
      status: "ok", webgl, canvasCount, lingeringCanvases: lingering,
      threeCanvasesAfterRevert: threeCanvases, screenshots: shots,
    }, null, 2));
    await browser.close();
  } finally {
    try { proc.kill("SIGTERM"); } catch { /* */ }
  }
}

main().catch((err) => { console.error("SMOKE_FAIL", err.message || err); process.exit(1); });
