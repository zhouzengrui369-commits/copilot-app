// Verify the dev-mode stack (vite preview + Fastify API) via Playwright.
//
// Difference from desktop-packaged-verify.cjs:
//   - Entry point is vite dev (38901 by default) instead of the packaged web bundle.
//   - We hit the Fastify server directly for /api/* (not via the proxy),
//     so we can verify the dev server is alive even if vite has a hiccup.
//   - We don't attempt login unless the dev server is configured to require
//     it (it usually isn't on first run); we still click through all 7 tabs
//     and screenshot each one.
//
// Run with the stack already up:
//   npm run dev:all
//   node scripts/web-dev-verify.cjs
const { chromium } = require('playwright');

const VITE_URL = process.env.OPENCLAW_WEB_PREVIEW_URL || 'http://127.0.0.1:38901';
const SERVER_URL = process.env.OPENCLAW_WORKBENCH_URL || 'http://127.0.0.1:38888';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // 401s are expected on unauthenticated requests; vite HMR errors
      // sometimes show up as a benign console.error before HMR connects.
      if (!/401|login_required|setup_required|HMR|websocket/i.test(text)) {
        errors.push(`CONSOLE.ERROR: ${text}`);
      }
    }
  });

  // === 1. Vite dev server reachable ===
  console.log('=== dev verify ===');
  await page.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/web-1-boot.png' });
  console.log('1. boot 截图完成');

  // === 2. Fastify server reachable (bypassing vite proxy) ===
  console.log('\n=== server health ===');
  const health = await page.request.get(`${SERVER_URL}/api/health`);
  const healthJson = await health.json();
  console.log(`  ${health.status()}  /api/health  setupRequired=${healthJson.setupRequired}`);

  // === 3. Login (only if setup is required; dev db is often pre-seeded) ===
  const pwInput = await page.$('input[type="password"]');
  if (pwInput) {
    // dev verify doesn't know the user's password. Try the documented dev
    // password; if login fails, capture the error and continue — most tabs
    // are still clickable to verify the UI shell.
    await pwInput.fill('openclaw2026');
    await pwInput.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/web-2-after-login.png' });
    const stillOnLogin = await page.$('input[type="password"]');
    if (stillOnLogin) {
      console.log('2. login 失败（dev db 密码可能不同）— 继续验 UI shell');
    } else {
      console.log('2. 登录成功 home 截图完成');
    }
  } else {
    console.log('2. 已在登录后状态（无密码页 / 已 setup）');
  }

  // === 4. 7 tab walk ===
  const tabs = [
    ['对话', 'C'],
    ['智能体', 'A'],
    ['智能助理', 'H'],
    ['知识库', 'K'],
    ['开发台', 'V'],
    ['项目管理', 'P'],
    ['系统设置', 'S'],
  ];
  console.log('\n=== 7 tabs ===');
  for (let i = 0; i < tabs.length; i++) {
    const [label] = tabs[i];
    const el = page.locator(`text=${label}`).first();
    if (await el.count() === 0) {
      console.log(`   ✗ ${label} not found`);
      continue;
    }
    await el.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/web-tab-${i+1}-${label}.png` });
    console.log(`   ✓ ${label} 截图完成`);
  }

  // === 5. Vite HMR probe — make a no-op change and confirm no error ===
  console.log('\n=== vite HMR sanity ===');
  // We don't actually edit a file (that would mutate the working tree).
  // Instead we check that the vite client script is loaded.
  const hasViteClient = await page.evaluate(() => {
    return Boolean(document.querySelector('script[type="module"]') ||
                    (window).__vite_plugin_react_preamble_installed__);
  });
  console.log(`  vite client present: ${hasViteClient}`);

  // === 6. API smoke (dev server, not proxy) ===
  console.log('\n=== API smoke ===');
  const apis = ['/api/health', '/api/mobile/today?date=2026-06-10'];
  for (const url of apis) {
    const r = await page.request.get(`${SERVER_URL}${url}`);
    console.log(`  ${r.status()}  ${url}`);
  }

  // === 7. design token sanity ===
  console.log('\n=== design token sanity ===');
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      brand: s.getPropertyValue('--brand').trim(),
      motionBase: s.getPropertyValue('--motion-base').trim(),
      radius: s.getPropertyValue('--radius').trim(),
      shadowMd: s.getPropertyValue('--shadow-md').trim(),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  console.log('  tokens:', JSON.stringify(tokens, null, 2));

  // === Errors filter ===
  console.log('\n=== console errors ===');
  if (errors.length === 0) {
    console.log('  无关键错误（401 / HMR / login 已过滤）');
  } else {
    errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }

  await browser.close();
  console.log('\nDone.');
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
