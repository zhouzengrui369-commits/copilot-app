import { mkdir } from 'node:fs/promises';
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
  resolveElectronProducerUserDataPath,
  test,
  waitForElectronFirstWindow,
  type ElectronRuntimeIdentity,
} from './electron.fixture.js';
import { startFakeMiniMaxProvider } from './helpers/fake-minimax-provider.js';

test.describe.configure({ mode: 'serial' });

const TIMEOUT = 30_000;
const CREDENTIAL = 'exp-cop-009-loopback-only';
const PRODUCER = 'exp-cop-009';

async function launch(
  userDataPath: string,
  recorder: ReturnType<typeof createElectronReceiptRecorder>,
): Promise<{
  app: ElectronApplication;
  page: Page;
  runtimeIdentity: ElectronRuntimeIdentity;
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
      timeout: TIMEOUT,
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

test('EXP-COP-009 keeps Ask, exact source, action receipt, and return state through relaunch at both viewports', async ({
  e2eUserData,
}) => {
  test.setTimeout(120_000);
  const producerUserData = resolveElectronProducerUserDataPath(e2eUserData, PRODUCER);
  await mkdir(producerUserData, { recursive: true });
  const provider = await startFakeMiniMaxProvider({ profile: 'success' });
  const token = `EXP COP 009 continuity ${Date.now()}`;
  const notePath = 'e2e/exp-cop-009-source';
  const todoTitle = `EXP-COP-009 Todo ${Date.now()}`;
  let first: ElectronApplication | null = null;
  let second: ElectronApplication | null = null;
  let firstRuntimeIdentity: ElectronRuntimeIdentity | null = null;
  const recorder = createElectronReceiptRecorder(PRODUCER);
  try {
    ({ app: first, runtimeIdentity: firstRuntimeIdentity } = await launch(
      producerUserData,
      recorder,
    ));
    let page = await first.firstWindow();
    await page.setViewportSize({ width: 1229, height: 768 });
    await page.evaluate(
      async ({ baseUrl, credential }: { baseUrl: string; credential: string }) => {
        const configured = await (window as any).copilot.settings.setModelApi({
          provider: 'minimax',
          baseUrl,
          model: 'MiniMax-M3',
          apiKey: credential,
        });
        if (!configured?.modelApi?.apiKeyConfigured) {
          throw new Error('BLOCKED_LOOPBACK_MODEL_API_NOT_CONFIGURED');
        }
      },
      { baseUrl: provider.baseUrl, credential: CREDENTIAL },
    );
    await page.evaluate(async ({ path, body }: { path: string; body: string }) => {
      await (window as any).copilot.notes.remove(path).catch(() => false);
      await (window as any).copilot.notes.create({
        path,
        title: 'EXP-COP-009 exact local source',
        body,
        tags: ['e2e', 'exp-cop-009'],
      });
    }, { path: notePath, body: `${token} exact source bytes.` });
    await expect.poll(
      () => page.evaluate(
        async (path: string) => (window as any).copilot.wiki.getForNote(path),
        notePath,
      ),
      { timeout: TIMEOUT },
    ).toMatchObject({
      truth: 'current',
      notePath,
      knowledgeBuild: { state: 'ready' },
    });

    provider.reset('grounded-rag');
    await openView(page, 'ask');
    await page.getByLabel('问题').fill(token);
    await page.getByRole('button', { name: '提问' }).click();
    expect(await provider.waitForRequest(TIMEOUT)).toMatchObject({
      profile: 'grounded-rag',
      body: { stream: true },
    });
    await expect(page.getByTestId('rag-answer')).toContainText('仅依据已完成索引', {
      timeout: TIMEOUT,
    });
    const sourceButton = page.getByRole('button', { name: notePath, exact: true });
    await expect(sourceButton).toBeEnabled({ timeout: TIMEOUT });

    await page.getByTestId('ask-create-todo').click();
    await page.getByLabel('待办标题').fill(todoTitle);
    await page.getByRole('button', { name: '创建待办' }).click();
    await expect(page.getByTestId('ask-todo-success')).toContainText(
      '待办已保存并完成本地回读',
    );
    await expect.poll(
      () => page.evaluate(async () => {
        const snapshot = await (window as any).copilot.askConversation.load();
        return snapshot?.todoReceipt?.title ?? null;
      }),
      { timeout: TIMEOUT },
    ).toBe(todoTitle);

    await sourceButton.click();
    const reader = page.getByTestId('knowledge-document-reader');
    await expect(reader).toHaveAttribute('data-document-path', notePath);
    await expect(reader.getByTestId('markdown-renderer')).toContainText(
      `${token} exact source bytes.`,
    );
    await page.screenshot({
      path: test.info().outputPath('exp-cop-009-1229x768-source.png'),
      fullPage: false,
    });
    await reader.getByRole('button', { name: '返回本轮回答' }).click();
    await expect(page.getByTestId('ask-workspace')).toBeVisible();
    await expect(page.getByTestId('rag-answer')).toContainText('仅依据已完成索引');
    await expect(page.getByRole('button', { name: notePath, exact: true })).toBeEnabled();
    await expect(page.getByTestId('ask-todo-success')).toContainText(todoTitle);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('ask-workspace')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('exp-cop-009-1440x900-return.png'),
      fullPage: false,
    });

    const firstExit = await recorder.closeAndRecord(first);
    first = null;
    expect(firstExit).toMatchObject({
      clean: true,
      exitCode: 0,
      signalCode: null,
      error: null,
    });
    const secondLaunch = await launch(producerUserData, recorder);
    second = secondLaunch.app;
    page = secondLaunch.page;
    expect(secondLaunch.runtimeIdentity).toEqual(firstRuntimeIdentity);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, 'ask');
    await expect(page.getByTestId('rag-answer')).toContainText('仅依据已完成索引', {
      timeout: TIMEOUT,
    });
    await expect(page.getByRole('button', { name: notePath, exact: true })).toBeEnabled();
    await expect(page.getByTestId('ask-todo-success')).toContainText(todoTitle);
    await expect(page.getByText(token).first()).toBeVisible();
  } finally {
    try {
      if (first) await recorder.closeAndRecord(first);
      if (second) await recorder.closeAndRecord(second);
      await recorder.flush();
    } finally {
      await provider.close();
    }
  }
});
