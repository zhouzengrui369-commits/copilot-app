// scripts/njx-copilot-topnav-smoke.mjs
// Visual smoke test: capture top navigation layout of /Users/njx/Applications/njx-copilot.app
// via http://127.0.0.1:38888/ (port 38888 = prod).
//
// Usage:
//   node scripts/njx-copilot-topnav-smoke.mjs
//
// Output (in env NX_TOPNAV_OUT or tasks/openclaw/<dir>/topnav-evidence/):
//   - <slug>-before.png         (top fold screenshot)
//   - <slug>-measure.json       (DOM geometry of banner, topnav, nav row, topbar, ghost)
//   - <slug>-console.log        (console output from page)
//   - <slug>-index.html         (a captured <body> dump for diffing)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.NX_TOPNAV_OUT
  || path.join(rootDir, "tasks", "openclaw", "2026-07-06T-njx-copilot-nav-overlap-fix", "topnav-evidence");
const url = process.env.NX_TOPNAV_URL || "http://127.0.0.1:38888/";
const slug = process.env.NX_TOPNAV_SLUG || "topnav-prod";
const viewportW = Number(process.env.NX_TOPNAV_W || 1440);
const viewportH = Number(process.env.NX_TOPNAV_H || 900);

fs.mkdirSync(outDir, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(outDir, `${slug}.console.log`), `${line}\n`);
}

function detectForwarderToken() {
  try {
    const out = execFileSync("bash", [
      "-lc",
      "ps eww -p $(lsof -nP -iTCP:38888 -sTCP:LISTEN -t | head -1) | tr ' ' '\\n' | grep OPENCLAW_FORWARDER_TOKEN | head -1",
    ]).toString().trim();
    const m = out.match(/OPENCLAW_FORWARDER_TOKEN=(\S+)/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function probeHealth() {
  const r = await fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(5000) });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  log(`health probe: status=${r.status} body=${JSON.stringify(data)}`);
  return { status: r.status, data };
}

async function measureLayout(page) {
  return await page.evaluate(() => {
    function dump(el, depth = 0) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        cls: el.className || "",
        tag: el.tagName.toLowerCase(),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        position: cs.position,
        gridRow: cs.gridRow,
        gridColumn: cs.gridColumn,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridTemplateRows: cs.gridTemplateRows,
        height: cs.height,
        minHeight: cs.minHeight,
        overflow: cs.overflow,
        zIndex: cs.zIndex,
        children: Array.from(el.children).slice(0, 8).map((c) => dump(c, depth + 1)),
      };
    }
    const root = document.querySelector(".app.app-runtime-bannered");
    if (!root) return { error: "no .app.app-runtime-bannered" };
    return {
      tree: dump(root),
      window: { iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio },
    };
  });
}

async function main() {
  await probeHealth();
  const FORWARDER = detectForwarderToken();
  log(`forwarder token: ${FORWARDER ? "<set, len=" + FORWARDER.length + ">" : "<missing>"}`);
  if (!FORWARDER) {
    log("WARN: no forwarder token; will try to load / unauthenticated and see what renders.");
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    executablePath: process.env.NX_TOPNAV_CHROME
      || "/Users/njx/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: viewportW, height: viewportH },
      deviceScaleFactor: 2,
      extraHTTPHeaders: FORWARDER
        ? { "x-openclaw-forwarder-token": FORWARDER, "x-forwarded-by": "cloudbase-forwarder" }
        : {},
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => log(`[page-console:${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => log(`[page-error] ${err.message}`));
    log(`navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".sidebar.app-topnav, .auth-card, .login, body", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const before = path.join(outDir, `${slug}.png`);
    await page.screenshot({ path: before, fullPage: false });
    log(`screenshot saved: ${before}`);
    const measure = await measureLayout(page);
    fs.writeFileSync(path.join(outDir, `${slug}.measure.json`), JSON.stringify(measure, null, 2));
    log(`measure saved (${measure.matched.length} elements)`);
    const html = await page.content();
    fs.writeFileSync(path.join(outDir, `${slug}.index.html`), html);
    log(`html saved (${html.length} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
