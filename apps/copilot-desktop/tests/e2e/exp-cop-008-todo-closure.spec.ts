import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  APP_ROOT,
  createElectronReceiptRecorder,
  expect,
  launchElectronWithReceipt,
  openView,
  resolveElectronLaunchContract,
  test,
  waitForElectronFirstWindow,
} from './electron.fixture.js';
import { startFakeMiniMaxProvider } from './helpers/fake-minimax-provider.js';

test.describe.configure({ mode: 'serial' });

const TERMINAL_TIMEOUT_MS = 30_000;
const SYNTHETIC_LOOPBACK_CREDENTIAL = 'exp-cop-008-loopback-only';

function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

async function launchIsolatedElectron(
  userDataPath: string,
  recorder: ReturnType<typeof createElectronReceiptRecorder>,
): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const launchContract = resolveElectronLaunchContract({
    appRoot: APP_ROOT,
    e2eUserData: userDataPath,
    configuredExecutablePath: process.env.COPILOT_E2E_EXECUTABLE_PATH,
    e2eMode: process.env.COPILOT_E2E_MODE,
    platform: process.platform,
    nodeEnv: 'test',
    copilotE2E: '1',
  });
  return launchElectronWithReceipt({
    launchApp: () => electron.launch({
      executablePath: launchContract.executablePath,
      args: launchContract.args,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        COPILOT_E2E: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: TERMINAL_TIMEOUT_MS,
    }),
    recorder,
    initializePage: async (app) => {
      await waitForElectronFirstWindow({
        expectedUserDataPath: userDataPath,
        readIdentity: () => app.evaluate(({ app: electronApp, BrowserWindow }) => ({
          appName: electronApp.getName(),
          appPath: electronApp.getAppPath(),
          userDataPath: electronApp.getPath('userData'),
          windowCount: BrowserWindow.getAllWindows().length,
        })),
        waitForFirstWindow: (options) => app.firstWindow(options),
      });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('app-root')).toBeVisible();
      return page;
    },
  });
}

test('EXP-COP-008 preserves two sources, unscheduled and explicit-due Todos, memory, source open, and relaunch readback', async ({
  e2eUserData,
}) => {
  test.setTimeout(120_000);
  const provider = await startFakeMiniMaxProvider({ profile: 'success' });
  const notePaths = [
    'e2e/exp-cop-008-source-a',
    'e2e/exp-cop-008-source-b',
  ];
  const sourceToken = `EXP COP 008 multi source ${Date.now()}`;
  const createdTitle = `EXP-COP-008 unscheduled ${Date.now()}`;
  const editedTitle = `${createdTitle} edited`;
  const editedBody = 'Canonical unscheduled Todo body retained after full Electron relaunch.';
  const executionLog = 'Verified both local sources before follow-up.';
  const durableNote = 'Keep this Todo unscheduled until owner triage.';
  const explicitTitle = `EXP-COP-008 scheduled ${Date.now()}`;
  const explicitDate = new Date();
  explicitDate.setDate(explicitDate.getDate() + 1);
  explicitDate.setHours(10, 15, 0, 0);
  const explicitDue = localInput(explicitDate);
  const explicitDateKey = explicitDue.slice(0, 10);
  let first: ElectronApplication | null = null;
  let second: ElectronApplication | null = null;
  let unscheduledTodoId = '';
  let explicitTodoId = '';
  const recorder = createElectronReceiptRecorder('exp-cop-008');

  try {
    ({ app: first } = await launchIsolatedElectron(e2eUserData, recorder));
    const firstPage = await first.firstWindow();
    await firstPage.evaluate(
      async ({ baseUrl, credential }: { baseUrl: string; credential: string }) => {
        const settings = (window as any).copilot.settings;
        const configured = await settings.setModelApi({
          provider: 'minimax',
          baseUrl,
          model: 'MiniMax-M3',
          apiKey: credential,
        });
        if (
          configured?.modelApi?.provider !== 'minimax'
          || configured?.modelApi?.baseUrl !== baseUrl
          || configured?.modelApi?.apiKeyConfigured !== true
        ) {
          throw new Error('BLOCKED_LOOPBACK_MODEL_API_NOT_CONFIGURED');
        }
      },
      { baseUrl: provider.baseUrl, credential: SYNTHETIC_LOOPBACK_CREDENTIAL },
    );
    for (const [index, notePath] of notePaths.entries()) {
      await firstPage.evaluate(
        async ({ path, token, sourceIndex }: {
          path: string;
          token: string;
          sourceIndex: number;
        }) => {
          await (window as any).copilot.notes.remove(path).catch(() => false);
          return (window as any).copilot.notes.create({
            path,
            title: `EXP-COP-008 canonical source ${sourceIndex + 1}`,
            body: `${token} exists in local Electron source ${sourceIndex + 1}.`,
            tags: ['e2e', 'exp-cop-008'],
          });
        },
        { path: notePath, token: sourceToken, sourceIndex: index },
      );
      await expect.poll(
        () => firstPage.evaluate(
          async (path: string) => (window as any).copilot.wiki.getForNote(path),
          notePath,
        ),
        { timeout: TERMINAL_TIMEOUT_MS },
      ).toMatchObject({
        truth: 'current',
        notePath,
        knowledgeBuild: { state: 'ready' },
      });
    }

    provider.reset('grounded-rag');
    await expect.poll(
      () => firstPage.evaluate(
        async (question: string) => {
          const answer = await (window as any).copilot.rag.ask(question);
          return [...answer.sources].sort();
        },
        sourceToken,
      ),
      { timeout: TERMINAL_TIMEOUT_MS },
    ).toEqual([...notePaths].sort());

    provider.reset('grounded-rag');
    await openView(firstPage, 'ask');
    await firstPage.getByLabel('问题').fill(sourceToken);
    await firstPage.getByRole('button', { name: '提问' }).click();
    expect(await provider.waitForRequest(TERMINAL_TIMEOUT_MS)).toMatchObject({
      profile: 'grounded-rag',
      body: { stream: true },
    });
    await expect(firstPage.getByTestId('rag-answer')).toContainText('仅依据已完成索引', {
      timeout: TERMINAL_TIMEOUT_MS,
    });
    await expect(firstPage.getByTestId('answer-source-truth')).toHaveAttribute(
      'data-truth-state',
      'LOCAL_PRESENT',
    );
    for (const notePath of notePaths) {
      const sourceReceipt = firstPage.locator('[data-testid^="source-receipt-"]').filter({
        hasText: notePath,
      }).first();
      await expect(sourceReceipt).toHaveAttribute('data-truth-state', 'LOCAL_PRESENT');
    }

    await firstPage.getByTestId('ask-create-todo').click();
    await firstPage.getByLabel('待办标题').fill(createdTitle);
    await expect(firstPage.getByLabel('待办截止时间')).toHaveValue('');
    await expect(firstPage.getByTestId('todo-source-count')).toContainText('保留 2 条来源');
    await firstPage.getByRole('button', { name: '创建待办' }).click();
    await expect(firstPage.getByTestId('ask-todo-success')).toContainText(
      '待办已保存并完成本地回读',
    );
    unscheduledTodoId = await firstPage.evaluate(
      async (title: string) => {
        const result = await (window as any).copilot.todos.list();
        const item = result.find((candidate: any) => candidate.title === title);
        return item?.id ?? '';
      },
      createdTitle,
    );
    expect(unscheduledTodoId).not.toBe('');

    await firstPage.getByRole('button', { name: '查看待办' }).click();
    await expect(firstPage.getByTestId('schedule-workspace')).toBeVisible();
    await expect(firstPage.getByRole('button', { name: '未安排' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const focusedCard = firstPage.getByTestId(`todo-card-${unscheduledTodoId}`);
    await expect(focusedCard).toHaveAttribute('data-focused', 'true');
    const editor = firstPage.getByTestId(`todo-editor-${unscheduledTodoId}`);
    await expect(editor).toBeVisible();
    for (const notePath of notePaths) {
      await expect(
        editor.getByRole('button', { name: `打开来源：${notePath}` }),
      ).toBeVisible();
    }
    await editor.getByRole('button', { name: `打开来源：${notePaths[0]}` }).click();
    await expect(firstPage.locator('.breadcrumb')).toContainText(
      `知识 / 本地 MOC / ${notePaths[0]}`,
    );
    const compactPreview = firstPage.getByTestId('wiki-organized-preview-current');
    await expect(compactPreview).toContainText('EXP-COP-008 canonical source 1');
    await expect(compactPreview).toContainText(notePaths[0]);
    await compactPreview.getByRole('button', { name: '全页阅读' }).click();
    const fullReader = firstPage.getByTestId('knowledge-document-reader');
    await expect(fullReader).toHaveAttribute('data-document-path', notePaths[0]);
    await expect(fullReader).toContainText(notePaths[0]);
    await expect(fullReader.getByTestId('markdown-renderer')).toContainText(
      `${sourceToken} exists in local Electron source 1.`,
    );
    await fullReader.getByRole('button', { name: /返回 .* MOC/u }).click();
    await expect(firstPage.locator('.breadcrumb')).toContainText(
      `知识 / 本地 MOC / ${notePaths[0]}`,
    );
    await openView(firstPage, 'schedule');
    await firstPage.getByRole('button', { name: '未安排' }).click();
    const reopenedCard = firstPage.getByTestId(`todo-card-${unscheduledTodoId}`);
    await expect(reopenedCard).toBeVisible();
    const reopenedEditor = firstPage.getByTestId(`todo-editor-${unscheduledTodoId}`);
    if (!(await reopenedEditor.isVisible().catch(() => false))) {
      await reopenedCard.getByRole('button', { name: `展开待办 ${createdTitle}` }).click();
    }

    await reopenedEditor.getByLabel(`编辑待办标题 ${createdTitle}`).fill(editedTitle);
    await reopenedEditor.getByLabel(`编辑待办内容 ${createdTitle}`).fill(editedBody);
    await expect(reopenedEditor.getByLabel(`编辑待办截止时间 ${createdTitle}`)).toHaveValue('');
    await reopenedEditor.getByLabel('新增执行日志').fill(executionLog);
    await reopenedEditor.getByLabel('备注').fill(durableNote);
    await reopenedEditor.getByRole('button', { name: '保存待办详情' }).click();
    await expect(reopenedEditor.getByRole('status')).toHaveText('已保存并完成本地回读');
    await expect(firstPage.getByRole('button', { name: '未安排' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(reopenedCard).toContainText(editedTitle);
    await expect(firstPage.getByTestId(`todo-memory-summary-${unscheduledTodoId}`))
      .toContainText(executionLog);
    await expect(firstPage.getByTestId(`todo-memory-summary-${unscheduledTodoId}`))
      .toContainText(durableNote);

    await firstPage.getByRole('button', { name: '+ 新增待办' }).click();
    const todoDialog = firstPage.getByRole('dialog', { name: '新增待办' });
    await todoDialog.getByRole('textbox', { name: '待办标题' }).fill(explicitTitle);
    await todoDialog.getByRole('button', { name: '选择日期与提醒' }).click();
    const dateDialog = firstPage.getByRole('dialog', { name: '选择日期与提醒' });
    await dateDialog.getByLabel('临时日期与提醒时间').fill(explicitDue);
    await dateDialog.getByRole('button', { name: '使用此时间' }).click();
    await todoDialog.getByRole('combobox', { name: '搜索关联笔记' }).fill('canonical source 2');
    await todoDialog.getByRole('option', { name: /EXP-COP-008 canonical source 2/ }).click();
    await todoDialog.getByRole('button', { name: '添加待办' }).click();
    await expect(todoDialog).not.toBeVisible();
    explicitTodoId = await firstPage.evaluate(
      async (title: string) => {
        const result = await (window as any).copilot.todos.list();
        const item = result.find((candidate: any) => candidate.title === title);
        return item?.id ?? '';
      },
      explicitTitle,
    );
    expect(explicitTodoId).not.toBe('');

    const firstExit = await recorder.closeAndRecord(first);
    expect(firstExit).toMatchObject({
      clean: true,
      exitCode: 0,
      signalCode: null,
      error: null,
    });
    first = null;

    ({ app: second } = await launchIsolatedElectron(e2eUserData, recorder));
    const secondPage = await second.firstWindow();
    await openView(secondPage, 'schedule');
    await secondPage.getByRole('button', { name: '未安排' }).click();
    const relaunchedCard = secondPage.getByTestId(`todo-card-${unscheduledTodoId}`);
    await expect(relaunchedCard).toContainText(editedTitle);
    await relaunchedCard.getByRole('button', { name: `展开待办 ${editedTitle}` }).click();
    const relaunchedEditor = secondPage.getByTestId(`todo-editor-${unscheduledTodoId}`);
    await expect(relaunchedEditor.getByLabel(`编辑待办内容 ${editedTitle}`)).toHaveValue(
      editedBody,
    );
    await expect(relaunchedEditor.getByLabel(`编辑待办截止时间 ${editedTitle}`)).toHaveValue(
      '',
    );
    const persistedSourcePaths = (
      await relaunchedEditor
        .getByLabel(`编辑待办来源 ${editedTitle}`)
        .inputValue()
    )
      .split(/[\r\n,]+/u)
      .map((path) => path.trim())
      .filter(Boolean);
    expect(persistedSourcePaths).toHaveLength(notePaths.length);
    expect(new Set(persistedSourcePaths).size).toBe(notePaths.length);
    expect([...new Set(persistedSourcePaths)].sort()).toEqual([...notePaths].sort());
    await expect(secondPage.getByTestId(`todo-memory-summary-${unscheduledTodoId}`))
      .toContainText(executionLog);
    await expect(secondPage.getByTestId(`todo-memory-summary-${unscheduledTodoId}`))
      .toContainText(durableNote);
    for (const notePath of notePaths) {
      await expect(
        relaunchedEditor.getByRole('button', { name: `打开来源：${notePath}` }),
      ).toBeVisible();
    }

    await secondPage.getByLabel(`选择日期 ${explicitDateKey}`).click();
    await expect(secondPage.getByRole('button', { name: '所选日期' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const explicitCard = secondPage.getByTestId(`todo-card-${explicitTodoId}`);
    await expect(explicitCard).toContainText(explicitTitle);
    await expect(explicitCard).toContainText(explicitDue);
    await explicitCard.getByRole('button', { name: `展开待办 ${explicitTitle}` }).click();
    await expect(
      secondPage
        .getByTestId(`todo-editor-${explicitTodoId}`)
        .getByRole('button', { name: `打开来源：${notePaths[1]}` }),
    ).toBeVisible();
  } finally {
    try {
      try {
        const cleanupPage = second
          ? await second.firstWindow().catch(() => null)
          : first
            ? await first.firstWindow().catch(() => null)
            : null;
        if (cleanupPage) {
          if (unscheduledTodoId) {
            await cleanupPage.evaluate(
              (id: string) => (window as any).copilot.todos.remove(id).catch(() => false),
              unscheduledTodoId,
            );
          }
          if (explicitTodoId) {
            await cleanupPage.evaluate(
              (id: string) => (window as any).copilot.todos.remove(id).catch(() => false),
              explicitTodoId,
            );
          }
          for (const notePath of notePaths) {
            await cleanupPage.evaluate(
              (path: string) => (window as any).copilot.notes.remove(path).catch(() => false),
              notePath,
            );
          }
        }
      } finally {
        if (second) await recorder.closeAndRecord(second);
        if (first) await recorder.closeAndRecord(first);
        await recorder.flush();
      }
    } finally {
      await provider.close();
    }
  }
});
