import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  APP_ROOT,
  buildElectronLaunchArgs,
  expect,
  openView,
  resolveSourceElectronExecutable,
  selectElectronExecutable,
  test,
  waitForElectronFirstWindow,
} from './electron.fixture.js';
import { startFakeMiniMaxProvider } from './helpers/fake-minimax-provider.js';

test.describe.configure({ mode: 'serial' });

const TIMEOUT = 30_000;
const CREDENTIAL = 'exp-cop-009-loopback-only';

interface RuntimeIdentity {
  schemaVersion: 1;
  source: 'launched-electron-main-process';
  electron: string;
  chrome: string;
  node: string;
  modules: string;
  napi: string;
  arch: string;
  platform: string;
}

interface ProcessExitReceipt {
  clean: boolean;
  exitCode: number | null;
  signalCode: string | null;
  error: string | null;
}

async function readRuntimeIdentity(app: ElectronApplication): Promise<RuntimeIdentity> {
  return app.evaluate(() => ({
    schemaVersion: 1,
    source: 'launched-electron-main-process',
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    modules: process.versions.modules ?? '',
    napi: process.versions.napi ?? '',
    arch: process.arch,
    platform: process.platform,
  }));
}

async function writeRuntimeIdentity(identity: RuntimeIdentity): Promise<void> {
  const target = process.env.COPILOT_E2E_RUNTIME_IDENTITY_PATH;
  if (!target) return;
  if (!path.isAbsolute(target)) {
    throw new Error('COPILOT_E2E_RUNTIME_IDENTITY_PATH must be absolute');
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(identity, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

async function waitForChildExit(
  child: ReturnType<ElectronApplication['process']>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('BLOCKED_ELECTRON_EXIT_TIMEOUT'));
    }, TIMEOUT);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function closeAndRecord(app: ElectronApplication): Promise<ProcessExitReceipt> {
  const child = app.process();
  let error: string | null = null;
  try {
    await app.close();
    await waitForChildExit(child);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    clean: error === null && child.exitCode === 0 && child.signalCode === null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    error,
  };
}

async function writeProcessExit(runs: ProcessExitReceipt[]): Promise<void> {
  const target = process.env.COPILOT_E2E_PROCESS_EXIT_PATH;
  if (!target) return;
  if (!path.isAbsolute(target)) {
    throw new Error('COPILOT_E2E_PROCESS_EXIT_PATH must be absolute');
  }
  const last = runs.at(-1);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({
    clean: runs.length === 2 && runs.every((run) => run.clean),
    exitCode: last?.exitCode ?? null,
    signalCode: last?.signalCode ?? null,
    runs,
  }, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

async function launch(userDataPath: string): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const app = await electron.launch({
    executablePath: selectElectronExecutable(
      process.env.COPILOT_E2E_EXECUTABLE_PATH,
      () => resolveSourceElectronExecutable(),
    ),
    args: buildElectronLaunchArgs({
      appRoot: APP_ROOT,
      e2eUserData: userDataPath,
      packagedExecutablePath: undefined,
      e2eMode: 'current-source',
      platform: process.platform,
      nodeEnv: 'test',
      copilotE2E: '1',
    }),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      COPILOT_E2E: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: TIMEOUT,
  });
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
  return { app, page };
}

test('EXP-COP-009 keeps Ask, exact source, action receipt, and return state through relaunch at both viewports', async ({
  e2eUserData,
}) => {
  test.setTimeout(120_000);
  const provider = await startFakeMiniMaxProvider({ profile: 'success' });
  const token = `EXP COP 009 continuity ${Date.now()}`;
  const notePath = 'e2e/exp-cop-009-source';
  const todoTitle = `EXP-COP-009 Todo ${Date.now()}`;
  let first: ElectronApplication | null = null;
  let second: ElectronApplication | null = null;
  let firstRuntimeIdentity: RuntimeIdentity | null = null;
  const processExits: ProcessExitReceipt[] = [];
  try {
    ({ app: first } = await launch(e2eUserData));
    firstRuntimeIdentity = await readRuntimeIdentity(first);
    await writeRuntimeIdentity(firstRuntimeIdentity);
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

    const firstExit = await closeAndRecord(first);
    processExits.push(firstExit);
    first = null;
    expect(firstExit).toMatchObject({
      clean: true,
      exitCode: 0,
      signalCode: null,
      error: null,
    });
    ({ app: second, page } = await launch(e2eUserData));
    expect(await readRuntimeIdentity(second)).toEqual(firstRuntimeIdentity);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openView(page, 'ask');
    await expect(page.getByTestId('rag-answer')).toContainText('仅依据已完成索引', {
      timeout: TIMEOUT,
    });
    await expect(page.getByRole('button', { name: notePath, exact: true })).toBeEnabled();
    await expect(page.getByTestId('ask-todo-success')).toContainText(todoTitle);
    await expect(page.getByText(token).first()).toBeVisible();
  } finally {
    if (first) processExits.push(await closeAndRecord(first));
    if (second) processExits.push(await closeAndRecord(second));
    await writeProcessExit(processExits);
    await provider.close();
  }
});
