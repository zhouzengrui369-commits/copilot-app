#!/usr/bin/env bash
# wb-12h-screenshots.sh
# 12 小时持续监控 —— 每 30 分钟抓一张 workbench 主页截图
# 用 playwright + chrome for testing (已通过 npm install 装在 ~/Library/Caches/ms-playwright)
# 输出: /tmp/workbench-12h-monitor/screenshots/screenshot-<timestamp>.png

set -u

MONITOR_DIR="/tmp/workbench-12h-monitor"
SCREENSHOT_DIR="${MONITOR_DIR}/screenshots"
WORKBENCH_DIR="/Users/njx/openclaw_data/openclaw_workbench"
BASE_URL="${OPENCLAW_WORKBENCH_URL:-http://127.0.0.1:38888}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")

mkdir -p "${SCREENSHOT_DIR}"

# 优先: 已装的 chrome-for-testing headless shell
CHROME_BIN=""
if [ -x "$HOME/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ]; then
  CHROME_BIN="$HOME/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

if [ -z "${CHROME_BIN}" ]; then
  # 写日志说明 GUI 工具未启用
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] SKIP: no chrome binary found" >> "${MONITOR_DIR}/screenshot.log"
  exit 0
fi

# 准备 Node 端 playwright 调用（用 SDK 加载本地 chrome）
OUT_FILE="${SCREENSHOT_DIR}/screenshot-${TIMESTAMP}.png"

cat > "${WORKBENCH_DIR}/.wb_screenshot.mjs" <<'EOF'
import { chromium } from "playwright";
import process from "node:process";

const CHROME_BIN = process.env.CHROME_BIN || "";
const BASE_URL = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const OUT_FILE = process.env.OUT_FILE || "";
const LOG_FILE = process.env.LOG_FILE || "";

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  if (LOG_FILE) {
    try { require("node:fs").appendFileSync(LOG_FILE, line); } catch {}
  }
}

(async () => {
  const startedAt = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME_BIN,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: "WorkbenchMonitor/1.0 (+12h-stability-watch)",
    });
    const page = await ctx.newPage();

    const targets = [
      { url: `${BASE_URL}/`, name: "home" },
      { url: `${BASE_URL}/delivery?health=1`, name: "delivery" },
    ];

    const results = [];
    for (const t of targets) {
      try {
        const t0 = Date.now();
        const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 8000 });
        const status = resp ? resp.status() : 0;
        await page.waitForTimeout(800);  // 等待 hydration
        await page.screenshot({ path: OUT_FILE.replace(/\.png$/, `-${t.name}.png`), fullPage: false });
        results.push({ name: t.name, url: t.url, status, ms: Date.now() - t0 });
      } catch (e) {
        results.push({ name: t.name, url: t.url, error: String(e).slice(0, 200) });
      }
    }

    log(`screenshot ok browser_launch=${Date.now() - startedAt}ms ${JSON.stringify(results)}`);
    process.exit(0);
  } catch (err) {
    log(`screenshot failed: ${String(err).slice(0, 500)}`);
    process.exit(1);
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
})();
EOF

# 运行 Node 脚本（必须从 workbench 目录跑，playwright 在 node_modules 里）
OUT_FILE="${OUT_FILE}" \
  CHROME_BIN="${CHROME_BIN}" \
  BASE_URL="${BASE_URL}" \
  LOG_FILE="${MONITOR_DIR}/screenshot.log" \
  node "${WORKBENCH_DIR}/.wb_screenshot.mjs" 2>&1

EXIT=$?

# 清理临时脚本
rm -f "${WORKBENCH_DIR}/.wb_screenshot.mjs"

# 保留最新 200 张截图，删除更早的
TOTAL=$(ls -1 "${SCREENSHOT_DIR}"/screenshot-*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "${TOTAL}" -gt 200 ]; then
  ls -1t "${SCREENSHOT_DIR}"/screenshot-*.png | tail -n +101 | while read -r f; do
    rm -f "$f"
  done
fi

exit ${EXIT}