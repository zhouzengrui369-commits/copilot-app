// Verify packaged desktop app via Playwright against the server it spawned.
// The Electron renderer loads http://127.0.0.1:38888 which is exactly
// what we hit from headless chromium.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

// Default to the canonical dev/verify password. Override with VERIFY_PASSWORD
// env var if you've changed the workbench user password.
const VERIFY_PASSWORD = process.env.VERIFY_PASSWORD || 'openclaw2026';
const APP_PATH = process.env.NJX_COPILOT_APP || '/Users/njx/Applications/njx-copilot.app';
const APP_REALPATH = fs.realpathSync(APP_PATH);
const WEB_ASSET_DIR = path.join(APP_REALPATH, 'Contents/Resources/resources/web/assets');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function fail(message, detail) {
  console.error(`FATAL: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function assertSinglePackagedServer() {
  let lsof = '';
  try {
    lsof = run('lsof', ['-nP', '-iTCP:38888', '-sTCP:LISTEN']);
  } catch (error) {
    fail('38888 has no listening server; launch njx-copilot.app first.', error.message);
  }

  const rows = lsof.split(/\r?\n/).slice(1).filter(Boolean);
  if (rows.length !== 1) {
    fail(
      `38888 must have exactly one listener before packaged verification; found ${rows.length}.`,
      lsof,
    );
  }

  const pid = rows[0].trim().split(/\s+/)[1];
  const ps = run('ps', ['-o', 'pid=,ppid=,stat=,command=', '-p', pid]);
  if (!ps.includes(APP_REALPATH) || !ps.includes('/Contents/Resources/resources/server/index.js')) {
    fail(
      '38888 listener is not the current njx-copilot.app packaged server.',
      `app=${APP_REALPATH}\nlistener=${ps}`,
    );
  }
}

function assertPackagedUiMarkers() {
  const cssFiles = fs.readdirSync(WEB_ASSET_DIR).filter((name) => /^index-.*\.css$/.test(name));
  const jsFiles = fs.readdirSync(WEB_ASSET_DIR).filter((name) => /^index-.*\.js$/.test(name));
  const css = cssFiles.map((name) => fs.readFileSync(path.join(WEB_ASSET_DIR, name), 'utf8')).join('\n');
  const js = jsFiles.map((name) => fs.readFileSync(path.join(WEB_ASSET_DIR, name), 'utf8')).join('\n');
  const requiredCss = ['delivery-three-column', 'new-conversation-dialog', 'sidebar.app-topnav'];
  const missingCss = requiredCss.filter((marker) => !css.includes(marker));
  if (missingCss.length) {
    fail('packaged web assets are missing Codex-style UI markers.', missingCss.join(', '));
  }
  const requiredJs = ['开启新任务对话', '开发台', '智能助理'];
  const missingJs = requiredJs.filter((marker) => !js.includes(marker));
  if (missingJs.length) {
    fail('packaged web JS is missing expected route/action markers.', missingJs.join(', '));
  }
}

function requestHealth(host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port: 38888,
        path: '/api/health',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 && /"ok"\s*:\s*true/.test(body)) resolve(body);
          else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`health probe timeout for ${host}`)));
    req.end();
  });
}

async function assertMobileLanReachable() {
  const lanAddrs = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lanAddrs.push({ name, address: addr.address });
      }
    }
  }

  if (lanAddrs.length === 0) {
    console.log('mobile LAN health: skipped, no non-internal IPv4 address found');
    return;
  }

  const errors = [];
  for (const lan of lanAddrs) {
    try {
      await requestHealth(lan.address);
      console.log(`mobile LAN health ok: http://${lan.address}:38888/api/health (${lan.name})`);
      return;
    } catch (error) {
      errors.push(`${lan.name} ${lan.address}: ${error.message}`);
    }
  }

  fail(
    'packaged server is not reachable from the Mac LAN address; Mate60 pairing would fail.',
    errors.join('\n'),
  );
}

(async () => {
  assertSinglePackagedServer();
  assertPackagedUiMarkers();
  await assertMobileLanReachable();
  if (process.env.RUNTIME_GUARD_ONLY === '1') {
    console.log(`runtime guard ok: ${APP_REALPATH}`);
    return;
  }

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
      // Skip expected 401s (Playwright skips login; server requires session).
      if (!/401|login_required|setup_required/i.test(text)) {
        errors.push(`CONSOLE.ERROR: ${text}`);
      }
    }
  });

  console.log('=== packaged verify: 7 tabs ===');
  await page.goto('http://127.0.0.1:38888/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/pkg-1-boot.png' });
  console.log('1. boot 截图完成');

  // Login
  const pwInput = await page.$('input[type="password"]');
  if (pwInput) {
    await pwInput.fill(VERIFY_PASSWORD);
    await pwInput.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/pkg-2-home.png' });
    console.log('2. 登录后 home 截图完成');
  } else {
    console.log('2. 已经在登录后状态（已登录或无密码页）');
  }

  // 7 tab walk
  const tabs = [
    ['对话', 'C'],
    ['智能体', 'A'],
    ['智能助理', 'H'],
    ['知识库', 'K'],
    ['开发台', 'V'],
    ['项目管理', 'P'],
    ['系统设置', 'S'],
  ];
  for (let i = 0; i < tabs.length; i++) {
    const [label] = tabs[i];
    const el = page.locator(`text=${label}`).first();
    if (await el.count() === 0) {
      console.log(`   ✗ ${label} not found`);
      continue;
    }
    await el.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/pkg-tab-${i+1}-${label}.png` });
    console.log(`   ✓ ${label} 截图完成`);
  }

  // API smoke
  console.log('\n=== API smoke ===');
  const apis = ['/api/health', '/api/mobile/today?date=2026-06-10'];
  for (const url of apis) {
    const r = await page.request.get(`http://127.0.0.1:38888${url}`);
    console.log(`  ${r.status()}  ${url}`);
  }

  // design token sanity
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

  // Errors filter
  console.log('\n=== console errors ===');
  if (errors.length === 0) {
    console.log('  无关键错误（401 已过滤）');
  } else {
    errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }

  await browser.close();
  console.log('\nDone.');
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
