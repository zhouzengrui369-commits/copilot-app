/**
 * Render the two screenshot HTMLs to PNGs via Playwright (Chromium).
 *
 * Run with:
 *   node scripts/render-screenshots.mjs
 *
 * Output:
 *   ../screenshots/T-1.1.5/01_streaming_chunks.png
 *   ../screenshots/T-1.1.5/02_retry_backoff.png
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/render-screenshots.mjs → packages/llm-client/scripts/
//   → go up 3 to /Users/njx/openclaw/copilot.wt-T115/wt-T115
const SCREEN_DIR = path.resolve(__dirname, '..', '..', '..', 'screenshots', 'T-1.1.5');

const targets = [
  {
    html: path.join(SCREEN_DIR, 'source_streaming.html'),
    png: path.join(SCREEN_DIR, '01_streaming_chunks.png'),
  },
  {
    html: path.join(SCREEN_DIR, 'source_retry.html'),
    png: path.join(SCREEN_DIR, '02_retry_backoff.png'),
  },
];

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  for (const t of targets) {
    const page = await ctx.newPage();
    await page.goto(`file://${t.html}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: t.png, fullPage: true });
    console.log('  wrote', t.png);
    await page.close();
  }
} finally {
  await browser.close();
}
