import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { canonicalizeElectronUserDataPaths } from '../support/electron-isolation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, '../..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist/main/main.js');
const RENDERER_ENTRY = path.join(APP_ROOT, 'dist/renderer/index.html');

interface WorkerFixtures {
  electronApp: ElectronApplication;
  appPage: Page;
  e2eUserData: string;
}

async function waitForExit(child: ReturnType<ElectronApplication['process']>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((_resolve, reject) => setTimeout(
      () => reject(new Error('BLOCKED_ELECTRON_PROCESS_DID_NOT_EXIT')),
      5_000,
    )),
  ]);
}

function launchScopedRuntimeIdentityPath(basePath: string, workerIndex: number, pid: number | undefined): string {
  const parsed = path.parse(basePath);
  const extension = parsed.ext || '.json';
  const processId = Number.isInteger(pid) ? String(pid) : 'unknown-pid';
  return path.join(
    parsed.dir,
    `${parsed.name}-worker-${workerIndex}-pid-${processId}-${randomUUID()}${extension}`,
  );
}

export const test = base.extend<{}, WorkerFixtures>({
  e2eUserData: [async ({}, use) => {
    const configured = process.env.COPILOT_E2E_USER_DATA;
    const directory = configured ?? await mkdtemp(path.join(os.tmpdir(), 'njx-copilot-electron-e2e-'));
    if (!path.isAbsolute(directory)) throw new Error('COPILOT_E2E_USER_DATA must be absolute');
    await mkdir(directory, { recursive: true });
    await use(directory);
    if (!configured) await rm(directory, { recursive: true, force: true });
  }, { scope: 'worker' }],

  electronApp: [async ({ e2eUserData }, use, workerInfo) => {
    const executablePath = process.env.COPILOT_E2E_EXECUTABLE_PATH;
    if (!executablePath && (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY))) {
      throw new Error(
        `BLOCKED_ELECTRON_BUILD_MISSING: expected ${MAIN_ENTRY} and ${RENDERER_ENTRY}`,
      );
    }
    if (executablePath && (!path.isAbsolute(executablePath) || !existsSync(executablePath))) {
      throw new Error(`BLOCKED_PACKAGED_EXECUTABLE_MISSING: ${executablePath}`);
    }

    const app = await electron.launch({
      executablePath,
      args: executablePath
        ? process.env.COPILOT_E2E_MODE === 'release'
          ? [`--user-data-dir=${e2eUserData}`]
          : [APP_ROOT, `--user-data-dir=${e2eUserData}`]
        : [APP_ROOT, `--user-data-dir=${e2eUserData}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        COPILOT_E2E: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 30_000,
    });
    const child = app.process();
    let teardownError: unknown = null;
    try {
      const identity = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
        appName: electronApp.getName(),
        appPath: electronApp.getAppPath(),
        userDataPath: electronApp.getPath('userData'),
        windowCount: BrowserWindow.getAllWindows().length,
      }));
      const canonicalUserData = await canonicalizeElectronUserDataPaths(
        e2eUserData,
        identity.userDataPath,
      );
      if (identity.windowCount < 1 || canonicalUserData.actual !== canonicalUserData.expected) {
        throw new Error(`BLOCKED_NOT_ISOLATED_ELECTRON: ${JSON.stringify({
          ...identity,
          expectedUserDataPath: e2eUserData,
          canonicalUserData,
        })}`);
      }
      const runtimeIdentityBasePath = process.env.COPILOT_E2E_RUNTIME_IDENTITY_PATH;
      if (!runtimeIdentityBasePath || !path.isAbsolute(runtimeIdentityBasePath)) {
        throw new Error('BLOCKED_ELECTRON_RUNTIME_IDENTITY_PATH_INVALID');
      }
      const runtimeIdentityPath = launchScopedRuntimeIdentityPath(
        runtimeIdentityBasePath,
        workerInfo.workerIndex,
        child.pid,
      );
      const runtimeIdentity = await app.evaluate(() => ({
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
      await mkdir(path.dirname(runtimeIdentityPath), { recursive: true });
      await writeFile(runtimeIdentityPath, `${JSON.stringify(runtimeIdentity, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      await use(app);
    } finally {
      try {
        await app.close();
        await waitForExit(child);
      } catch (error) {
        teardownError = error;
      }
      const marker = process.env.COPILOT_E2E_PROCESS_EXIT_PATH;
      if (marker) {
        if (!path.isAbsolute(marker)) throw new Error('COPILOT_E2E_PROCESS_EXIT_PATH must be absolute');
        await mkdir(path.dirname(marker), { recursive: true });
        await writeFile(marker, `${JSON.stringify({
          clean: teardownError === null && child.exitCode === 0 && child.signalCode === null,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          error: teardownError instanceof Error ? teardownError.message : teardownError ? String(teardownError) : null,
        }, null, 2)}\n`, 'utf8');
      }
      if (teardownError) throw teardownError;
      if (child.exitCode !== 0 || child.signalCode !== null) {
        throw new Error(`BLOCKED_ELECTRON_UNCLEAN_EXIT: code=${child.exitCode} signal=${child.signalCode}`);
      }
    }
  }, { scope: 'worker', timeout: 45_000 }],

  appPage: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    const rendererErrors: string[] = [];
    page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`);
    });
    await page.waitForLoadState('domcontentloaded');
    try {
      await expect(page.getByTestId('app-root')).toBeVisible();
      const identity = await page.evaluate(() => ({
        protocol: location.protocol,
        hasCopilot: typeof (window as unknown as { copilot?: unknown }).copilot === 'object',
        hasNodeRequire: typeof (globalThis as { require?: unknown }).require !== 'undefined',
      }));
      if (identity.protocol !== 'file:' || !identity.hasCopilot || identity.hasNodeRequire) {
        throw new Error(`BLOCKED_NOT_ELECTRON_RENDERER: ${JSON.stringify(identity)}`);
      }
    } catch (error) {
      const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
      throw new Error(
        `BLOCKED_RENDERER_BOOT: url=${page.url()} body=${JSON.stringify(body)} ` +
        `rendererErrors=${JSON.stringify(rendererErrors)}; ${String(error)}`,
      );
    }
    await use(page);
    expect(rendererErrors, `renderer errors: ${rendererErrors.join(' | ')}`).toEqual([]);
  }, { scope: 'worker' }],
});

export { expect };

export async function openView(page: Page, view: string): Promise<void> {
  await page.getByTestId(`nav-${view}`).click();
  await expect(page.getByTestId(`view-${view}`)).toBeVisible();
  await expect(page.getByTestId('workspace-loading')).toHaveCount(0);
}
