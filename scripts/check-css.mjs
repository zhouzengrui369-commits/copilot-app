import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const FORWARDER = (() => {
  try {
    const out = execFileSync("bash", ["-lc", "ps eww -p $(lsof -nP -iTCP:38888 -sTCP:LISTEN -t | head -1) | tr ' ' '\\n' | grep OPENCLAW_FORWARDER_TOKEN | head -1"]).toString().trim();
    const m = out.match(/OPENCLAW_FORWARDER_TOKEN=(\S+)/);
    return m ? m[1] : "";
  } catch { return ""; }
})();

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], executablePath: "/Users/njx/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: FORWARDER ? { "x-openclaw-forwarder-token": FORWARDER, "x-forwarded-by": "cloudbase-forwarder" } : {} });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:38888/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".sidebar.app-topnav", { timeout: 15000 });
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  const brand = document.querySelector(".sidebar.app-topnav .brand");
  if (!brand) return { error: "no brand" };
  const span = brand.querySelector("span");
  if (!span) return { error: "no span" };
  const cs = getComputedStyle(span);
  return {
    spanText: span.textContent,
    display: cs.display,
    visibility: cs.visibility,
    height: cs.height,
    width: cs.width,
    // check if any stylesheet rule matches
    matchedRules: (function() {
      const out = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.includes("brand") && rule.selectorText.includes("span")) {
              out.push({ selector: rule.selectorText, display: rule.style.display || "n/a", cssText: rule.cssText.slice(0, 200) });
            }
          }
        } catch (e) { out.push({ error: e.message }); }
      }
      return out;
    })(),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
