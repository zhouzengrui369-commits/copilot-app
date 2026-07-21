// 验证脚本：登录 + dev center + 3 project + 截 6 张图
// 用 desktop app 真实 session cookie 复用
const { chromium } = require('playwright');
const fs = require('fs');

const SERVER_URL = 'http://127.0.0.1:38888';
const SESSION_COOKIE = '6cb6a1c5e47d20efb6f644730719549725336eb87db3165eec54db7b481a5888';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  // 注入 desktop app 的 session
  await ctx.addCookies([{
    name: 'owb_session',
    value: SESSION_COOKIE,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!/401|login_required|setup_required|HMR|websocket/i.test(text)) {
        errors.push(`CONSOLE.ERROR: ${text}`);
      }
    }
  });

  fs.mkdirSync('/tmp/verify-2026-06-11', { recursive: true });
  const log = (s) => console.log(s);

  log('=== 1. boot 截图 ===');
  await page.goto(`${SERVER_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/verify-2026-06-11/01-boot.png' });
  log('  ✓');

  log('=== 2. 进 dev center ===');
  // 点 "开发台" 标签
  const devTab = page.locator('text=开发台').first();
  if (await devTab.count() > 0) {
    await devTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/verify-2026-06-11/02-dev-center.png', fullPage: true });
    log('  ✓ dev center 截图');
  } else {
    log('  ✗ 开发台 tab 找不到');
  }

  log('=== 3. 进 openclaw-workbench project ===');
  const projectLink = page.locator('text=OpenClaw Workbench').first();
  if (await projectLink.count() > 0) {
    await projectLink.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/tmp/verify-2026-06-11/03-project-overview.png', fullPage: true });
    log('  ✓ project 概览截图');
  } else {
    log('  ✗ OpenClaw Workbench 链接找不到');
  }

  log('=== 4. goal-openclaw-workbench-operator 详情 ===');
  const opGoal = page.locator('text=持续开发目标').first();
  if (await opGoal.count() > 0) {
    await opGoal.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/verify-2026-06-11/04-operator-goal-detail.png', fullPage: true });
    log('  ✓ operator goal 详情截图');
  }

  log('=== 5. subtask 列表 ===');
  const subtaskLink = page.locator('text=subtask-openclaw-workbench-001').first();
  if (await subtaskLink.count() > 0) {
    await subtaskLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/verify-2026-06-11/05-subtask-detail.png', fullPage: true });
    log('  ✓ subtask 详情截图');
  }

  log('=== 6. agent policy / auto-run 区域 ===');
  await page.goto(`${SERVER_URL}/dev/operator?goalId=goal-openclaw-workbench-operator`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/verify-2026-06-11/06-operator-settings.png', fullPage: true });
  log('  ✓ operator 设置页截图');

  log('\n=== console errors ===');
  if (errors.length === 0) {
    log('  无关键错误');
  } else {
    errors.slice(0, 10).forEach((e) => log(`  ${e}`));
  }

  await browser.close();
  log('\nDone. 截图存 /tmp/verify-2026-06-11/');
})().catch((e) => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
