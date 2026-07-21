#!/usr/bin/env node
// Knowledge graph 3D parity check (V14 — truthful gate).
//
// Region-only compare: reference captures #view-3d, app captures .kg3d-canvas.
// Pixel diff: real grayscale MSE computed in a Playwright canvas (no sharp dep).
// Gate metric: content-pixel similarity (luma > 50 in either image).
//   - Excludes the dark background so the comparison cannot "pass" because both
//     images are mostly black. Per gate requirement: do not compare blank/dark
//     areas only.
//   - Overall and bright-pixel similarity are reported as informational.
// Threshold: any pair with content_sim < 0.85 -> passed=false, exit nonzero.
//
// Run from the repo root:
//   node apps/web/scripts/knowledge-graph-3d-parity.mjs
//
// Exit codes:
//   0 = all pairs >= threshold
//   1 = any pair < threshold, OR capture/activation failed

import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as wait } from "node:timers/promises";

const REF_HTML = "/Users/njx/Library/Application Support/com.tencent.mac.marvis/MarvisData/User/oAN1i2V8S2WSK_yTMn6Xp-HBtEGc/workspace/conv_19efca11ec6_5504931cc5fd/output/nanjixiong_knowledge_map.html";
const APP_BASE = "http://127.0.0.1:38889";
const EVIDENCE = "release/knowledge-3d-evidence/parity";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PASSWORD = process.env.OPENCLAW_WORKBENCH_PASSWORD || process.env.OPENCLAW_PASSWORD || "openclaw2026";
const THRESHOLD = 0.85;
const DIFF_W = 256;
const DIFF_H = 256;

function startStaticServer(filePath, port) {
  return new Promise((resolveFn, rejectFn) => {
    const server = createServer((req, res) => {
      try {
        const data = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      } catch {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.on("error", (e) => rejectFn(e));
    server.listen(port, "127.0.0.1", () => resolveFn(server));
  });
}

async function startStaticServerOnAvailablePort(filePath, basePort) {
  for (let p = basePort; p < basePort + 10; p++) {
    try {
      const s = await startStaticServer(filePath, p);
      return { server: s, port: p };
    } catch (e) {
      if (e && e.code === "EADDRINUSE") continue;
      throw e;
    }
  }
  throw new Error(`No available port found in range [${basePort}, ${basePort + 10})`);
}

// Compute grayscale MSE + similarity by loading both images into a Playwright page,
// drawing each to a fixed-size canvas, and reading pixel data. No native deps.
async function computeSimilarity(refPath, appPath, browser) {
  const refData = (await readFile(refPath)).toString("base64");
  const appData = (await readFile(appPath)).toString("base64");
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(
      async ({ refData, appData, W, H }) => {
        const loadImg = (b64) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("image_load_failed"));
            img.src = `data:image/png;base64,${b64}`;
          });
        const refImg = await loadImg(refData);
        const appImg = await loadImg(appData);
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        const draw = (img) => {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          // cover fit, centered, preserves aspect ratio
          const ar = img.width / img.height;
          let dw, dh;
          if (ar >= 1) { dw = W; dh = Math.round(W / ar); }
          else { dh = H; dw = Math.round(H * ar); }
          const dx = Math.floor((W - dw) / 2);
          const dy = Math.floor((H - dh) / 2);
          ctx.drawImage(img, dx, dy, dw, dh);
          return ctx.getImageData(0, 0, W, H).data;
        };
        const refPx = draw(refImg);
        const appPx = draw(appImg);
        const CONTENT_LUMA_THRESHOLD = 50; // pixels brighter than this are "content" (3D nodes, not background)
        let sumSq = 0;
        let sumRef = 0;
        let sumApp = 0;
        let contentSumSq = 0;
        let contentCount = 0;
        let brightSumSq = 0;
        let brightCount = 0;
        for (let i = 0; i < refPx.length; i += 4) {
          const r = 0.299 * refPx[i] + 0.587 * refPx[i + 1] + 0.114 * refPx[i + 2];
          const a = 0.299 * appPx[i] + 0.587 * appPx[i + 1] + 0.114 * appPx[i + 2];
          const d = r - a;
          sumSq += d * d;
          sumRef += r;
          sumApp += a;
          // "content" pixels: luma > threshold in EITHER image.
          // This focuses the diff on the rendered 3D nodes/UI, not the dark background
          // (per gate requirement: do not compare blank/dark areas only).
          if (r > CONTENT_LUMA_THRESHOLD || a > CONTENT_LUMA_THRESHOLD) {
            contentSumSq += d * d;
            contentCount += 1;
          }
          // "bright" pixels: luma > 120 — only the most prominent 3D nodes/labels.
          if (r > 120 || a > 120) {
            brightSumSq += d * d;
            brightCount += 1;
          }
        }
        const n = refPx.length / 4;
        // Overall (whole image, including background) — informational
        const overallMSE = sumSq / n;
        const overallSimilarity = Math.max(0, 1 - overallMSE / 65025);
        // Content similarity (the actual gate metric) — excludes dark background
        const contentMSE = contentCount ? contentSumSq / contentCount : 0;
        const contentSimilarity = contentCount ? Math.max(0, 1 - contentMSE / 65025) : 1;
        // Bright similarity (most prominent content only) — informational
        const brightMSE = brightCount ? brightSumSq / brightCount : 0;
        const brightSimilarity = brightCount ? Math.max(0, 1 - brightMSE / 65025) : 1;
        const meanRef = sumRef / n;
        const meanApp = sumApp / n;
        return {
          overall: { mse: Math.round(overallMSE * 100) / 100, similarity: Math.round(overallSimilarity * 1000) / 1000 },
          content: {
            count: contentCount,
            frac: Math.round((contentCount / n) * 1000) / 10,
            mse: Math.round(contentMSE * 100) / 100,
            similarity: Math.round(contentSimilarity * 1000) / 1000,
            lumaThreshold: CONTENT_LUMA_THRESHOLD,
          },
          bright: {
            count: brightCount,
            frac: Math.round((brightCount / n) * 1000) / 10,
            mse: Math.round(brightMSE * 100) / 100,
            similarity: Math.round(brightSimilarity * 1000) / 1000,
          },
          refSize: { w: refImg.naturalWidth, h: refImg.naturalHeight },
          appSize: { w: appImg.naturalWidth, h: appImg.naturalHeight },
          meanRefLuma: Math.round(meanRef * 10) / 10,
          meanAppLuma: Math.round(meanApp * 10) / 10,
        };
      },
      { refData, appData, W: DIFF_W, H: DIFF_H }
    );
    return result;
  } finally {
    await page.close();
  }
}

// Activate 3D in the workbench /graph page and wait for the canvas to render.
async function activate3DAndWait(page, waitMs) {
  const before = await page.evaluate(() => {
    const sel = document.querySelector("select");
    return { firstSelectValue: sel ? sel.value : null };
  });
  // Try the visualStyle select that contains "Obsidian Graph" option.
  const sel = page.locator("select").filter({ hasText: "Obsidian Graph" }).first();
  if ((await sel.count()) > 0) {
    await sel.selectOption("cosmos3d");
  } else {
    // Fallback: button labeled "3D · Cosmos" or satellite
    const btn = page.getByRole("button", { name: /3D · Cosmos|🛰\s*3D/i });
    if ((await btn.count()) > 0) await btn.first().click();
  }
  // Wait for the 3D canvas to mount. Two signals:
  //  (a) .kg3d-canvas has a child <canvas data-engine="three.js r160">
  //  (b) .kg3d-fallback overlay text exists (context lost is acceptable, we just need a region to capture)
  const start = Date.now();
  let canvasInfo = null;
  while (Date.now() - start < 12000) {
    canvasInfo = await page.evaluate(() => {
      const root = document.querySelector(".kg3d-root");
      const wrap = document.querySelector(".kg3d-canvas");
      const c = wrap ? wrap.querySelector("canvas") : null;
      const fallback = wrap ? wrap.querySelector(".kg3d-fallback") : null;
      const r = wrap ? wrap.getBoundingClientRect() : null;
      return {
        kg3dMounted: !!root,
        canvasMounted: !!c,
        dataEngine: c ? c.getAttribute("data-engine") : null,
        canvasRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        fallbackText: fallback ? fallback.textContent : null,
      };
    });
    if (canvasInfo.kg3dMounted && canvasInfo.canvasMounted) break;
    await wait(250);
  }
  if (!canvasInfo || !canvasInfo.kg3dMounted) {
    throw new Error("3D did not mount: .kg3d-root not found");
  }
  if (!canvasInfo.canvasMounted) {
    console.log("[note] 3D canvas not mounted; component is in blocking fallback. Capturing fallback region.");
  }
  // Give Three.js a few render frames so any non-lost frame is on the canvas.
  await wait(waitMs);
  const after = await page.evaluate(() => {
    const sel2 = document.querySelector("select");
    return { firstSelectValue: sel2 ? sel2.value : null };
  });
  return { before, after, canvasInfo };
}

async function captureAppRegion(page, outPath) {
  // Use page.screenshot with clip from bounding box. Avoids Playwright's
  // element-level stability check (the WebGL canvas animates every frame,
  // so element-level screenshot would time out waiting for "stable").
  const rect = await page.evaluate(() => {
    const wrap = document.querySelector(".kg3d-canvas");
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!rect) throw new Error("App .kg3d-canvas region missing");
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`App .kg3d-canvas has zero size: ${rect.width}x${rect.height}`);
  }
  // Best-effort: pause auto-rotate so the captured frame is more stable
  // (helps the content-pixel metric, even though page.screenshot itself
  // doesn't require stability). The HUD button is "⏸ 暂停" while rotating.
  try {
    const pauseBtn = page.getByRole("button", { name: /⏸ 暂停/ }).first();
    if (await pauseBtn.count() > 0) {
      await pauseBtn.click({ timeout: 1500 });
      await wait(400);
    }
  } catch { /* tolerate */ }
  await page.screenshot({ path: outPath, type: "png", clip: rect });
}

async function captureRefRegion(page, outPath) {
  // Reference 3D canvas is #three-canvas. Capture the parent #view-3d
  // viewport to match the visual scope of the app's .kg3d-canvas region.
  // Use page.screenshot + clip to avoid element-stability wait.
  const rect = await page.evaluate(() => {
    const v = document.getElementById("view-3d");
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!rect) {
    const cv = await page.evaluate(() => {
      const c = document.getElementById("three-canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (!cv) throw new Error("Reference 3D region not found (#view-3d / #three-canvas)");
    await page.screenshot({ path: outPath, type: "png", clip: cv });
    return;
  }
  await page.screenshot({ path: outPath, type: "png", clip: rect });
}

async function main() {
  if (!existsSync(EVIDENCE)) await mkdir(EVIDENCE, { recursive: true });
  if (!existsSync(REF_HTML)) throw new Error(`Reference HTML not found: ${REF_HTML}`);
  const { server: refServer, port: refPort } = await startStaticServerOnAvailablePort(REF_HTML, 18999);
  console.log("== static server listening on", refPort, "==");
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
  });
  const pairs = [
    { name: "default", waitMs: 3000 },
    { name: "orbit", waitMs: 5000 },
    { name: "zoom-in", waitMs: 6000 },
  ];
  const report = {
    threshold: THRESHOLD,
    method: "browser-canvas-mse-content-gated",
    diffSize: { w: DIFF_W, h: DIFF_H },
    pairs: [],
  };
  let exitCode = 0;
  try {
    for (const pair of pairs) {
      // Reference capture
      const ref = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await ref.goto(`http://127.0.0.1:${refPort}`, { waitUntil: "domcontentloaded" });
        // reference auto-switches to 3D via setTimeout(300) at line ~1170
        await wait(pair.waitMs);
        const refPath = `${EVIDENCE}/ref-${pair.name}.png`;
        await captureRefRegion(ref, refPath);
      } finally {
        await ref.close();
      }

      // App capture
      const app = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const appPage = await app.newPage();
      let activation = null;
      const appPath = `${EVIDENCE}/app-${pair.name}.png`;
      try {
        appPage.on("response", (r) => {
          if (r.status() === 401) {/* tolerated */
          }
        });
        await appPage.goto(`${APP_BASE}/`, { waitUntil: "domcontentloaded" });
        await wait(1500);
        if ((await appPage.locator("input[type=password]").count()) > 0) {
          await appPage.locator("input[type=password]").first().fill(PASSWORD);
          await appPage.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
          await wait(2000);
        }
        const loginRes = await appPage.request.post(`${APP_BASE}/api/auth/login`, { data: { password: PASSWORD } });
        console.log(`[${pair.name}] proxied login:`, loginRes.status());
        await appPage.reload({ waitUntil: "domcontentloaded" });
        await wait(1500);
        await appPage.goto(`${APP_BASE}/graph`, { waitUntil: "domcontentloaded" });
        await wait(2000);
        if ((await appPage.locator("input[type=password]").count()) > 0) {
          await appPage.locator("input[type=password]").first().fill(PASSWORD);
          await appPage.locator("button:has-text('登录'), button:has-text('Login'), button[type=submit]").first().click();
          await wait(3000);
        }
        activation = await activate3DAndWait(appPage, pair.waitMs);
        await captureAppRegion(appPage, appPath);
      } catch (e) {
        console.log(`[${pair.name}] APP_CAPTURE_FAIL: ${e.message || e}`);
        // Write a 1x1 black PNG so the diff step still runs and produces a low-similarity record
        // (a real fail, not a silent skip).
        const fs = await import("node:fs/promises");
        const blankPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
        await fs.writeFile(appPath, blankPng);
        report.pairs.push({
          name: pair.name,
          ref: `parity/ref-${pair.name}.png`,
          app: `parity/app-${pair.name}.png`,
          error: e.message || String(e),
          activation,
        });
        exitCode = 1;
        await app.close();
        continue;
      } finally {
        await app.close();
      }

      // Pixel diff
      const refPath = `${EVIDENCE}/ref-${pair.name}.png`;
      const diff = await computeSimilarity(refPath, appPath, browser);
      // Gate metric: content similarity (luma > 50 in either image) — excludes dark background.
      // Per gate requirement: do not compare blank/dark areas only. Overall similarity is
      // reported as informational; passing requires content pixels to match the reference.
      const gateSimilarity = diff.content.similarity;
      const passed = gateSimilarity !== null && gateSimilarity >= THRESHOLD;
      if (!passed) exitCode = 1;
      report.pairs.push({
        name: pair.name,
        ref: `parity/ref-${pair.name}.png`,
        app: `parity/app-${pair.name}.png`,
        // gate metric (used for pass/fail)
        content: diff.content,
        // informational metrics
        overall: diff.overall,
        bright: diff.bright,
        refSize: diff.refSize,
        appSize: diff.appSize,
        meanRefLuma: diff.meanRefLuma,
        meanAppLuma: diff.meanAppLuma,
        passed,
        activation,
      });
      console.log(
        `[${pair.name}] content_sim=${diff.content.similarity} (count=${diff.content.count} frac=${diff.content.frac}% mse=${diff.content.mse}) ` +
          `overall_sim=${diff.overall.similarity} bright_sim=${diff.bright.similarity} ` +
          `refSize=${diff.refSize.w}x${diff.refSize.h} appSize=${diff.appSize.w}x${diff.appSize.h} ` +
          `dataEngine=${activation?.canvasInfo?.dataEngine || "n/a"} fallback=${activation?.canvasInfo?.fallbackText ? "yes" : "no"} passed=${passed}`
      );
    }
  } finally {
    await browser.close();
    refServer.close();
  }
  const failedPairs = report.pairs.filter((p) => p.passed === false || p.error);
  report.passed = failedPairs.length === 0;
  report.failed_pairs = failedPairs.map((p) => p.name);
  await writeFile("release/knowledge-3d-evidence/parity-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.passed ? "ok" : "fail",
    passed: report.passed,
    pairs: report.pairs.length,
    failed_pairs: report.failed_pairs,
    threshold: THRESHOLD,
    dir: EVIDENCE,
  }, null, 2));
  if (!report.passed) {
    console.error(`PARITY_FAIL ${failedPairs.length} of ${report.pairs.length} pair(s) below threshold ${THRESHOLD}`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("PARITY_FAIL", err.message || err);
  process.exit(1);
});
