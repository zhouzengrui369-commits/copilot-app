import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
import {
  startFakeMiniMaxProvider,
  type FakeMiniMaxProvider,
} from './helpers/fake-minimax-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, '../..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist/main/main.js');
const RENDERER_ENTRY = path.join(APP_ROOT, 'dist/renderer/index.html');
const SYNTHETIC_LOOPBACK_CREDENTIAL = 'e2e-loopback-credential-r1';
const SOURCE_ELECTRON_VERSION = '38.8.6';

interface SourceElectronRuntimeSelection {
  expectedVersion: string;
  packageVersion: string;
  executablePath: string;
  executableExists: boolean;
}

function readAppElectronContract(packageJsonPath: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies?: { electron?: unknown };
    };
    const version = packageJson.devDependencies?.electron;
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error('devDependencies.electron is missing');
    }
    return version;
  } catch (error) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_APP_PACKAGE_INVALID: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readElectronPackageVersion(packageJsonPath: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown;
    };
    const version = packageJson.version;
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error('version is missing');
    }
    return version;
  } catch (error) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_PACKAGE_INVALID: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function validateSourceElectronRuntimeSelection({
  expectedVersion,
  packageVersion,
  executablePath,
  executableExists,
}: SourceElectronRuntimeSelection): string {
  if (expectedVersion !== SOURCE_ELECTRON_VERSION) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_APP_CONTRACT_MISMATCH: expected=${SOURCE_ELECTRON_VERSION} actual=${expectedVersion}`,
    );
  }
  if (packageVersion !== expectedVersion) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_VERSION_MISMATCH: expected=${expectedVersion} actual=${packageVersion}`,
    );
  }
  if (!path.isAbsolute(executablePath)) {
    throw new Error(`BLOCKED_SOURCE_ELECTRON_EXECUTABLE_NOT_ABSOLUTE: ${executablePath}`);
  }
  if (!executableExists) {
    throw new Error(`BLOCKED_SOURCE_ELECTRON_EXECUTABLE_MISSING: ${executablePath}`);
  }
  return executablePath;
}

export function resolveSourceElectronExecutable(appRoot = APP_ROOT): string {
  const appPackageJsonPath = path.join(appRoot, 'package.json');
  const expectedVersion = readAppElectronContract(appPackageJsonPath);
  let electronPackageJsonPath: string;
  try {
    electronPackageJsonPath = createRequire(appPackageJsonPath).resolve(
      'electron/package.json',
    );
  } catch (error) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_PACKAGE_RESOLUTION: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const packageRelativePath = path.relative(appRoot, electronPackageJsonPath);
  if (
    packageRelativePath.length === 0
    || packageRelativePath.startsWith(`..${path.sep}`)
    || packageRelativePath === '..'
    || path.isAbsolute(packageRelativePath)
  ) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_PACKAGE_NOT_APP_LOCAL: ${electronPackageJsonPath}`,
    );
  }

  const electronPackageRoot = path.dirname(electronPackageJsonPath);
  const packageVersion = readElectronPackageVersion(electronPackageJsonPath);
  let relativeExecutablePath: string;
  try {
    relativeExecutablePath = readFileSync(
      path.join(electronPackageRoot, 'path.txt'),
      'utf8',
    ).trim();
  } catch (error) {
    throw new Error(
      `BLOCKED_SOURCE_ELECTRON_PATH_INVALID: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const executablePath = path.resolve(
    electronPackageRoot,
    'dist',
    relativeExecutablePath,
  );
  return validateSourceElectronRuntimeSelection({
    expectedVersion,
    packageVersion,
    executablePath,
    executableExists: existsSync(executablePath),
  });
}

export function selectElectronExecutable(
  packagedExecutablePath: string | undefined,
  resolveSourceExecutable: () => string = resolveSourceElectronExecutable,
): string {
  return packagedExecutablePath || resolveSourceExecutable();
}

interface ElectronLaunchArgsOptions {
  appRoot: string;
  e2eUserData: string;
  packagedExecutablePath: string | undefined;
  e2eMode: string | undefined;
  platform: NodeJS.Platform;
  nodeEnv: string | undefined;
  copilotE2E: string | undefined;
}

export function buildElectronLaunchArgs({
  appRoot,
  e2eUserData,
  packagedExecutablePath,
  e2eMode,
  platform,
  nodeEnv,
  copilotE2E,
}: ElectronLaunchArgsOptions): string[] {
  const args = packagedExecutablePath && e2eMode === 'release'
    ? [`--user-data-dir=${e2eUserData}`]
    : [appRoot, `--user-data-dir=${e2eUserData}`];
  const useMockKeychain = (
    !packagedExecutablePath
    && platform === 'darwin'
    && nodeEnv === 'test'
    && copilotE2E === '1'
  );
  if (useMockKeychain && !args.includes('--use-mock-keychain')) {
    args.push('--use-mock-keychain');
  }
  return args;
}

interface TestFixtures {
  fakeMiniMaxProvider: FakeMiniMaxProvider;
}

interface WorkerFixtures {
  electronApp: ElectronApplication;
  appPage: Page;
  e2eUserData: string;
}

interface RendererModelApiSnapshot {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export const ELECTRON_WINDOW_READINESS_TIMEOUT_MS = 30_000;

export interface ElectronWindowIdentity {
  appName: string;
  appPath: string;
  userDataPath: string;
  windowCount: number;
}

interface ElectronWindowReadinessOptions {
  expectedUserDataPath: string;
  readIdentity: () => Promise<ElectronWindowIdentity>;
  waitForFirstWindow: (options: { timeout: number }) => Promise<unknown>;
  timeoutMs?: number;
  canonicalizeUserDataPaths?: typeof canonicalizeElectronUserDataPaths;
}

async function assertElectronUserDataIsolation(
  expectedUserDataPath: string,
  identity: ElectronWindowIdentity,
  canonicalizeUserDataPaths: typeof canonicalizeElectronUserDataPaths,
): Promise<void> {
  const canonicalUserData = await canonicalizeUserDataPaths(
    expectedUserDataPath,
    identity.userDataPath,
  );
  if (canonicalUserData.actual !== canonicalUserData.expected) {
    throw new Error(`BLOCKED_NOT_ISOLATED_ELECTRON: ${JSON.stringify({
      ...identity,
      expectedUserDataPath,
      canonicalUserData,
    })}`);
  }
}

export async function waitForElectronFirstWindow({
  expectedUserDataPath,
  readIdentity,
  waitForFirstWindow,
  timeoutMs = ELECTRON_WINDOW_READINESS_TIMEOUT_MS,
  canonicalizeUserDataPaths = canonicalizeElectronUserDataPaths,
}: ElectronWindowReadinessOptions): Promise<ElectronWindowIdentity> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`WINDOW_READINESS_TIMEOUT_INVALID: ${String(timeoutMs)}`);
  }

  const initialIdentity = await readIdentity();
  await assertElectronUserDataIsolation(
    expectedUserDataPath,
    initialIdentity,
    canonicalizeUserDataPaths,
  );

  try {
    await waitForFirstWindow({ timeout: timeoutMs });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`WINDOW_READINESS_TIMEOUT: ${timeoutMs}ms: ${detail}`);
  }

  const readyIdentity = await readIdentity();
  await assertElectronUserDataIsolation(
    expectedUserDataPath,
    readyIdentity,
    canonicalizeUserDataPaths,
  );
  if (readyIdentity.windowCount < 1) {
    throw new Error(
      `WINDOW_READINESS_TIMEOUT: ${timeoutMs}ms: firstWindow resolved with windowCount=${readyIdentity.windowCount}`,
    );
  }
  return readyIdentity;
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

export const test = base.extend<TestFixtures, WorkerFixtures>({
  fakeMiniMaxProvider: async ({ appPage }, use) => {
    const provider = await startFakeMiniMaxProvider();
    let originalModelApi: RendererModelApiSnapshot | null = null;
    const teardownErrors: string[] = [];
    try {
      originalModelApi = await appPage.evaluate(async () => {
        const settings = (window as any).copilot?.settings;
        if (!settings?.get || !settings?.setModelApi) {
          throw new Error('BLOCKED_BRIDGE_MISSING: window.copilot.settings model API is unavailable');
        }
        const snapshot = await settings.get();
        const modelApi = snapshot?.modelApi;
        if (
          !modelApi ||
          typeof modelApi.provider !== 'string' ||
          typeof modelApi.baseUrl !== 'string' ||
          typeof modelApi.model !== 'string'
        ) {
          throw new Error('BLOCKED_MODEL_API_SNAPSHOT_INVALID');
        }
        return {
          provider: modelApi.provider,
          baseUrl: modelApi.baseUrl,
          model: modelApi.model,
          apiKeyConfigured: modelApi.apiKeyConfigured === true,
        };
      });

      await appPage.evaluate(
        async ({ baseUrl, credential }: { baseUrl: string; credential: string }) => {
          const settings = (window as any).copilot?.settings;
          if (!settings?.setModelApi) {
            throw new Error('BLOCKED_BRIDGE_MISSING: window.copilot.settings.setModelApi unavailable');
          }
          const configured = await settings.setModelApi({
            provider: 'minimax',
            baseUrl,
            model: 'MiniMax-M3',
            apiKey: credential,
          });
          if (
            configured?.modelApi?.baseUrl !== baseUrl ||
            configured?.modelApi?.provider !== 'minimax' ||
            configured?.modelApi?.apiKeyConfigured !== true
          ) {
            throw new Error('BLOCKED_LOOPBACK_MODEL_API_NOT_CONFIGURED');
          }
        },
        { baseUrl: provider.baseUrl, credential: SYNTHETIC_LOOPBACK_CREDENTIAL },
      );

      await use(provider);
    } finally {
      if (originalModelApi) {
        try {
          await appPage.evaluate(
            async ({
              loopbackBaseUrl,
              original,
            }: {
              loopbackBaseUrl: string;
              original: RendererModelApiSnapshot;
            }) => {
              const settings = (window as any).copilot?.settings;
              if (!settings?.setModelApi) {
                throw new Error(
                  'BLOCKED_BRIDGE_MISSING: window.copilot.settings.setModelApi unavailable',
                );
              }
              await settings.setModelApi({
                provider: 'minimax',
                baseUrl: loopbackBaseUrl,
                model: 'MiniMax-M3',
                clearApiKey: true,
              });
              await settings.setModelApi({
                provider: original.provider,
                baseUrl: original.baseUrl,
                model: original.model,
                ...(original.apiKeyConfigured ? {} : { clearApiKey: true }),
              });
            },
            { loopbackBaseUrl: provider.baseUrl, original: originalModelApi },
          );
        } catch (error) {
          teardownErrors.push(`model-api-reset:${String(error)}`);
        }
      }
      try {
        provider.reset('success');
      } catch (error) {
        teardownErrors.push(`provider-reset:${String(error)}`);
      }
      try {
        await provider.close();
      } catch (error) {
        teardownErrors.push(`provider-close:${String(error)}`);
      }
      if (teardownErrors.length > 0) {
        throw new Error(`BLOCKED_FAKE_MINIMAX_TEARDOWN:${teardownErrors.join('|')}`);
      }
    }
  },

  e2eUserData: [async ({}, use) => {
    const configured = process.env.COPILOT_E2E_USER_DATA;
    const directory = configured ?? await mkdtemp(path.join(os.tmpdir(), 'njx-copilot-electron-e2e-'));
    if (!path.isAbsolute(directory)) throw new Error('COPILOT_E2E_USER_DATA must be absolute');
    await mkdir(directory, { recursive: true });
    await use(directory);
    if (!configured) await rm(directory, { recursive: true, force: true });
  }, { scope: 'worker' }],

  electronApp: [async ({ e2eUserData }, use) => {
    const packagedExecutablePath = process.env.COPILOT_E2E_EXECUTABLE_PATH;
    if (
      !packagedExecutablePath
      && (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY))
    ) {
      throw new Error(
        `BLOCKED_ELECTRON_BUILD_MISSING: expected ${MAIN_ENTRY} and ${RENDERER_ENTRY}`,
      );
    }
    if (
      packagedExecutablePath
      && (!path.isAbsolute(packagedExecutablePath) || !existsSync(packagedExecutablePath))
    ) {
      throw new Error(`BLOCKED_PACKAGED_EXECUTABLE_MISSING: ${packagedExecutablePath}`);
    }
    const executablePath = selectElectronExecutable(packagedExecutablePath);

    const app = await electron.launch({
      executablePath,
      args: buildElectronLaunchArgs({
        appRoot: APP_ROOT,
        e2eUserData,
        packagedExecutablePath,
        e2eMode: process.env.COPILOT_E2E_MODE,
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
      timeout: 30_000,
    });
    const child = app.process();
    let teardownError: unknown = null;
    try {
      const readIdentity = () =>
        app.evaluate(({ app: electronApp, BrowserWindow }) => ({
          appName: electronApp.getName(),
          appPath: electronApp.getAppPath(),
          userDataPath: electronApp.getPath('userData'),
          windowCount: BrowserWindow.getAllWindows().length,
        }));
      await waitForElectronFirstWindow({
        expectedUserDataPath: e2eUserData,
        readIdentity,
        waitForFirstWindow: (options) => app.firstWindow(options),
      });
      const runtimeIdentityPath = process.env.COPILOT_E2E_RUNTIME_IDENTITY_PATH;
      if (!runtimeIdentityPath || !path.isAbsolute(runtimeIdentityPath)) {
        throw new Error('BLOCKED_ELECTRON_RUNTIME_IDENTITY_PATH_INVALID');
      }
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
