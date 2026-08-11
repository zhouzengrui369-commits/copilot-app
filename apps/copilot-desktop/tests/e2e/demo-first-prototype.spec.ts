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
  const todayAssistant = appPage.getByTestId('global-assistant');
  const todayAssistantLauncher = appPage.getByTestId('global-assistant-launcher');
  const todayAssistantTruth = appPage.getByTestId('global-assistant-truth');
  await expect(todayAssistant).toHaveAttribute('data-open', 'false');
  await expect(todayAssistant).toHaveAttribute('data-placement', 'safe');
  await expect(todayAssistantLauncher).toHaveAttribute('aria-expanded', 'false');
  await expect(todayAssistantLauncher).toContainText('AI 助手');
  await expect(todayAssistantTruth).toHaveText('NOT_PROBED');
  await expect(appPage.getByTestId('global-assistant-sheet')).toHaveCount(0);
  const collapsedAssistantGeometry = await todayAssistant.evaluate((root) => {
    const launcher = root.querySelector('[data-testid="global-assistant-launcher"]');
    const truth = root.querySelector('[data-testid="global-assistant-truth"]');
    if (!(launcher instanceof HTMLElement) || !(truth instanceof HTMLElement)) {
      throw new Error('GLOBAL_ASSISTANT_GEOMETRY_TARGET_MISSING');
    }
    const rootRect = root.getBoundingClientRect();
    const launcherRect = launcher.getBoundingClientRect();
    const truthRect = truth.getBoundingClientRect();
    return {
      width: rootRect.width,
      launcherHeight: launcherRect.height,
      truthInside: (
        truthRect.left >= launcherRect.left
        && truthRect.right <= launcherRect.right
        && truthRect.top >= launcherRect.top
        && truthRect.bottom <= launcherRect.bottom
      ),
      horizontalOverflow: launcher.scrollWidth - launcher.clientWidth,
      position: getComputedStyle(root).position,
    };
  });
  expect(collapsedAssistantGeometry.width).toBeGreaterThanOrEqual(300);
  expect(collapsedAssistantGeometry.width).toBeLessThanOrEqual(320);
  expect(collapsedAssistantGeometry.launcherHeight).toBeGreaterThanOrEqual(56);
  expect(collapsedAssistantGeometry.truthInside).toBe(true);
  expect(collapsedAssistantGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(collapsedAssistantGeometry.position).toBe('fixed');

  await todayAssistantLauncher.click();
  await expect(todayAssistant).toHaveAttribute('data-open', 'true');
  await expect(todayAssistantLauncher).toHaveAttribute('aria-expanded', 'true');
  await expect(todayAssistantTruth).toHaveText('NOT_PROBED');
  const todayAssistantSheet = appPage.getByTestId('global-assistant-sheet');
  await expect(todayAssistantSheet).toBeVisible();
  await expect(todayAssistantSheet.getByText('NO_SOURCE')).toBeVisible();

  await todayAssistantLauncher.click();
  await expect(todayAssistant).toHaveAttribute('data-open', 'false');
  await expect(todayAssistantLauncher).toHaveAttribute('aria-expanded', 'false');
  await expect(todayAssistantTruth).toHaveText('NOT_PROBED');
  await expect(appPage.getByTestId('global-assistant-sheet')).toHaveCount(0);
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
  await expect(appPage.getByRole('tab', { name: '2D MOC 阅读' }))
    .toHaveAttribute('aria-selected', 'true');
  const postMvpGraph = appPage.getByText('3D 节点可视化知识图谱 · MVP 后', { exact: true });
  await expect(postMvpGraph).toBeVisible();
  await expect(postMvpGraph).toHaveAttribute('aria-disabled', 'true');
  await expect(appPage.getByTestId('knowledge-graph-view')).toHaveCount(0);

  await openView(appPage, 'ask');
  await expect(appPage.getByTestId('view-ask')).toBeVisible();
  const askPng = await appPage.screenshot({ path: screenshotPath('03-ask-1440x900.png') });
  expectPng1440x900(askPng);

  await openView(appPage, 'settings');
  await expect(appPage.getByTestId('settings-post-mvp-boundary')).toContainText('OFF · POST-MVP');
  const settingsPng = await appPage.screenshot({ path: screenshotPath('04-settings-1440x900.png') });
  expectPng1440x900(settingsPng);
});
