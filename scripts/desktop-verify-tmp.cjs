// Playwright 自动化：登录 → 验证主界面
const { chromium } = require('playwright');

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
    if (msg.type() === 'error') errors.push(`CONSOLE.ERROR: ${msg.text()}`);
  });

  console.log('1. 加载登录页...');
  await page.goto('http://127.0.0.1:38889/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('   截图：登录页');
  await page.screenshot({ path: '/tmp/desktop-screen-0-login.png' });

  // 找密码输入框
  const pwInput = await page.$('input[type="password"]');
  if (!pwInput) {
    console.log('   没有 password input，可能不需要登录？');
  } else {
    console.log('2. 输入密码 123456 ...');
    await pwInput.fill('123456');
    await page.waitForTimeout(300);

    // 找登录按钮
    const loginBtn = await page.$('button:has-text("登录")');
    if (loginBtn) {
      console.log('3. 点击登录...');
      await loginBtn.click();
      await page.waitForTimeout(2500);
    } else {
      // 试试按 Enter
      await pwInput.press('Enter');
      await page.waitForTimeout(2500);
    }
  }

  console.log('4. 截图：登录后主界面');
  await page.screenshot({ path: '/tmp/desktop-screen-1-home.png' });

  const title = await page.title();
  console.log(`   <title> = ${title}`);

  // 顶栏 tab 计数
  const allButtons = await page.$$eval('button', (els) =>
    els.map((el) => el.textContent?.trim().slice(0, 30)).filter(Boolean)
  );
  console.log(`   所有 button 标签: ${JSON.stringify(allButtons.slice(0, 20))}`);

  // 找有"对话"或"知识库"等 tab
  const tabElements = await page.$$eval('[class*="tab"], [class*="Tab"], nav, header', (els) =>
    els.slice(0, 20).map((el) => ({
      tag: el.tagName,
      cls: el.className.toString().slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 60),
    })).filter(e => e.text)
  );
  console.log(`   顶栏结构: ${JSON.stringify(tabElements.slice(0, 5), null, 2)}`);

  // 验证 CSS 变量
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      brand: cs.getPropertyValue('--brand').trim(),
      text: cs.getPropertyValue('--text').trim(),
      bg: cs.getPropertyValue('--bg').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      motionBase: cs.getPropertyValue('--motion-base').trim(),
      motionFast: cs.getPropertyValue('--motion-fast').trim(),
      radius: cs.getPropertyValue('--radius').trim(),
      shadowMd: cs.getPropertyValue('--shadow-md').trim().slice(0, 40),
    };
  });
  console.log(`\n   CSS tokens: ${JSON.stringify(tokens, null, 2)}`);

  // 测 hover effect
  console.log('\n5. 测试 tab hover/click...');
  const knowledgeTab = await page.locator('text=知识库').first();
  if (await knowledgeTab.count() > 0) {
    await knowledgeTab.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/desktop-screen-2-knowledge-hover.png' });
    await knowledgeTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/desktop-screen-3-knowledge.png' });
    console.log('   截图：知识库 tab hover + 点击后');
  } else {
    console.log('   没找到知识库 tab');
  }

  // 测 chat tab
  const chatTab = await page.locator('text=对话').first();
  if (await chatTab.count() > 0) {
    await chatTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/desktop-screen-4-chat.png' });
    console.log('   截图：对话 tab');
  }

  // 测系统设置
  const settingsTab = await page.locator('text=系统设置').first();
  if (await settingsTab.count() > 0) {
    await settingsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/desktop-screen-5-settings.png' });
    console.log('   截图：系统设置 tab');
  }

  // 测开发台
  const devTab = await page.locator('text=开发台').first();
  if (await devTab.count() > 0) {
    await devTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/desktop-screen-6-dev.png' });
    console.log('   截图：开发台 tab');
  }

  // 回智能助理
  const assistantTab = await page.locator('text=智能助理').first();
  if (await assistantTab.count() > 0) {
    await assistantTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/desktop-screen-7-assistant.png' });
    console.log('   截图：智能助理 tab');
  }

  console.log('\n=== 错误日志 ===');
  if (errors.length === 0) {
    console.log('   无错误');
  } else {
    errors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
  }

  await browser.close();
  console.log('\nDone.');
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
