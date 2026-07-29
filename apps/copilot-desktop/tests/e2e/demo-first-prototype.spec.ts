import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, openView, test } from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

function screenshotPath(name: string): string {
  const directory = process.env.COPILOT_PROTOTYPE_SCREENSHOT_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('COPILOT_PROTOTYPE_SCREENSHOT_DIR must be an absolute task-owned path');
  return path.join(directory, name);
}

function expectPng1440x900(buffer: Buffer): void {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(buffer.readUInt32BE(16)).toBe(1440);
  expect(buffer.readUInt32BE(20)).toBe(900);
}

test('Demo-first primary journey stays truthful and captures four real Electron views', async ({ electronApp, appPage }) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  await expect.poll(() => appPage.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900]);
  await mkdir(path.dirname(screenshotPath('01-today-1440x900.png')), { recursive: true });

  await expect(appPage.locator('.titlebar')).toBeVisible();
  await expect(appPage.locator('.nav')).toBeVisible();
  await expect(appPage.locator('.decision-strip')).toBeVisible();
  await expect(appPage.locator('.statusbar')).toBeVisible();
  await expect(appPage.locator('.nav a')).toHaveCount(4);
  await expect(appPage.getByTestId('nav-voice')).toHaveCount(0);
  await expect(appPage.getByTestId('current-candidate-identity')).toContainText('CURRENT SOURCE PREVIEW');
  await expect(appPage.getByTestId('current-candidate-identity')).toContainText(/njx-copilot-v6 · [^·]+ · darwin/u);
  await expect(appPage.getByTestId('current-candidate-identity')).not.toContainText(/unavailable/u);
  await expect(appPage.getByTestId('current-candidate-state')).toContainText('MVP_NOT_COMPLETE');
  await expect(appPage.getByTestId('view-schedule')).toBeVisible();

  for (const selector of ['.today-grid', '.calendar-rail', '.day-workbench', '.capture', '.todo-list', '.floating-ai']) {
    await expect(appPage.locator(selector).first()).toBeVisible();
  }
  await expect(appPage.getByTestId('today-capture-composition')).toBeVisible();
  await expect(appPage.getByTestId('today-transcript-stream')).toBeVisible();
  await expect(appPage.getByTestId('today-capture-enrichment')).toBeVisible();
  const todayGeometry = await appPage.evaluate(() => {
    const rail = document.querySelector('.calendar-rail')?.getBoundingClientRect();
    const capture = document.querySelector('[data-testid="today-capture-composition"]');
    const columns = capture ? getComputedStyle(capture).gridTemplateColumns.split(' ').map(Number.parseFloat) : [];
    return {
      railWidth: rail?.width ?? 0,
      captureColumns: columns,
    };
  });
  expect(todayGeometry.railWidth).toBe(260);
  expect(todayGeometry.captureColumns).toHaveLength(2);
  expect(todayGeometry.captureColumns[0] / todayGeometry.captureColumns[1]).toBeGreaterThan(1.55);
  expect(todayGeometry.captureColumns[0] / todayGeometry.captureColumns[1]).toBeLessThan(1.78);
  await expect(appPage.locator('.todo-list')).toBeVisible();
  await expect(appPage.locator('.todo-list .todo')).toHaveCount(0);
  await expect(appPage.getByTestId('today-todo-empty')).toBeVisible();
  await expect(appPage.getByTestId('today-todo-empty')).toContainText('暂无待办');
  await expect(appPage.getByTestId('today-todo-empty')).toContainText('真实的本地空状态');
  await expect(appPage.getByTestId('today-timeline-empty')).toContainText('选中日期没有时间线项目');
  const todayAssistant = appPage.getByTestId('today-context-ai');
  const todayAssistantSummary = todayAssistant.locator(':scope > summary');
  await expect(todayAssistant).not.toHaveAttribute('open', '');
  await expect(todayAssistant).toContainText('NOT_PROBED');
  await expect(todayAssistant).toContainText('NO_SOURCE');
  const collapsedAssistantGeometry = await todayAssistant.evaluate((details) => {
    const summary = details.querySelector(':scope > summary');
    const badge = summary?.querySelector('.badge');
    const title = Array.from(summary?.childNodes ?? []).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('今日 AI 助手'),
    );
    if (!(summary instanceof HTMLElement) || !(badge instanceof HTMLElement) || !title) {
      throw new Error('TODAY_ASSISTANT_GEOMETRY_TARGET_MISSING');
    }
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    const titleLines = new Set(
      Array.from(titleRange.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top)),
    );
    const detailsRect = details.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    const detailsStyle = getComputedStyle(details);
    return {
      titleLineCount: titleLines.size,
      summaryHeight: summaryRect.height,
      collapsedWidth: detailsRect.width,
      badgeInside: (
        badgeRect.left >= summaryRect.left
        && badgeRect.right <= summaryRect.right
        && badgeRect.top >= summaryRect.top
        && badgeRect.bottom <= summaryRect.bottom
      ),
      horizontalOverflow: summary.scrollWidth - summary.clientWidth,
      position: detailsStyle.position,
      right: detailsStyle.right,
      bottom: detailsStyle.bottom,
      disclosure: getComputedStyle(summary, '::after').content,
    };
  });
  expect(collapsedAssistantGeometry.titleLineCount).toBe(1);
  expect(collapsedAssistantGeometry.summaryHeight).toBeLessThanOrEqual(46);
  expect(collapsedAssistantGeometry.collapsedWidth).toBeGreaterThan(230);
  expect(collapsedAssistantGeometry.collapsedWidth).toBeLessThan(356);
  expect(collapsedAssistantGeometry.badgeInside).toBe(true);
  expect(collapsedAssistantGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(collapsedAssistantGeometry.position).toBe('fixed');
  expect(collapsedAssistantGeometry.right).toBe('22px');
  expect(collapsedAssistantGeometry.bottom).toBe('82px');
  expect(collapsedAssistantGeometry.disclosure).toBe('"展开"');

  await todayAssistantSummary.click();
  await expect(todayAssistant).toHaveAttribute('open', '');
  await expect(todayAssistant).toContainText('NOT_PROBED');
  await expect(todayAssistant.getByText('NO_SOURCE')).toBeVisible();
  const openAssistantGeometry = await todayAssistant.evaluate((details) => {
    const summary = details.querySelector(':scope > summary');
    if (!(summary instanceof HTMLElement)) throw new Error('TODAY_ASSISTANT_SUMMARY_MISSING');
    return {
      width: details.getBoundingClientRect().width,
      disclosure: getComputedStyle(summary, '::after').content,
    };
  });
  expect(openAssistantGeometry.width).toBe(356);
  expect(openAssistantGeometry.disclosure).toBe('"收起"');

  await todayAssistantSummary.click();
  await expect(todayAssistant).not.toHaveAttribute('open', '');
  await expect(todayAssistant).toContainText('NOT_PROBED');
  const reclosedAssistantGeometry = await todayAssistant.evaluate((details) => {
    const summary = details.querySelector(':scope > summary');
    const title = Array.from(summary?.childNodes ?? []).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('今日 AI 助手'),
    );
    if (!(summary instanceof HTMLElement) || !title) {
      throw new Error('TODAY_ASSISTANT_RECLOSE_TARGET_MISSING');
    }
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    return {
      titleLineCount: new Set(
        Array.from(titleRange.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => Math.round(rect.top)),
      ).size,
      summaryHeight: summary.getBoundingClientRect().height,
      disclosure: getComputedStyle(summary, '::after').content,
    };
  });
  expect(reclosedAssistantGeometry.titleLineCount).toBe(1);
  expect(reclosedAssistantGeometry.summaryHeight).toBeLessThanOrEqual(46);
  expect(reclosedAssistantGeometry.disclosure).toBe('"展开"');
  await expect(appPage.getByTestId('view-schedule')).not.toContainText(/DEMO FIXTURE|SIMULATED|录音中|3D 星辰大海/u);
  const todayPng = await appPage.screenshot({ path: screenshotPath('01-today-1440x900.png') });
  expectPng1440x900(todayPng);

  const beforeCancel = await appPage.evaluate(async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total);
  await appPage.getByTestId('today-capture-draft').fill('将被取消的本地草稿');
  await appPage.getByRole('button', { name: '取消草稿' }).click();
  const afterCancel = await appPage.evaluate(async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total);
  expect(afterCancel).toBe(beforeCancel);

  await appPage.getByTestId('today-capture-draft').fill('原型实操记录 ' + String(Date.now()));
  await appPage.getByRole('button', { name: '保存为本地笔记' }).click();
  await expect(appPage.getByText('已保存到本地笔记。')).toBeVisible();
  await expect(appPage.getByTestId('capture-index-truth')).toContainText(/WIKI (CURRENT|FAILED|NOT_READY|STALE)/u);

  await openView(appPage, 'knowledge');
  await expect(appPage.getByTestId('knowledge-moc-reader')).toBeVisible();
  const knowledgePng = await appPage.screenshot({ path: screenshotPath('02-knowledge-1440x900.png') });
  expectPng1440x900(knowledgePng);
  await appPage.getByRole('tab', { name: '2D 关系' }).click();
  await expect(appPage.getByTestId('knowledge-graph-view')).toBeVisible();
  await appPage.getByRole('button', { name: '返回 MOC 阅读' }).click();

  await openView(appPage, 'ask');
  await expect(appPage.getByTestId('view-ask')).toBeVisible();
  const askPng = await appPage.screenshot({ path: screenshotPath('03-ask-1440x900.png') });
  expectPng1440x900(askPng);

  await openView(appPage, 'settings');
  await expect(appPage.getByTestId('settings-post-mvp-boundary')).toContainText('OFF · POST-MVP');
  const settingsPng = await appPage.screenshot({ path: screenshotPath('04-settings-1440x900.png') });
  expectPng1440x900(settingsPng);
});
