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
    platform === 'darwin'
    && nodeEnv === 'test'
    && copilotE2E === '1'
  );
  if (useMockKeychain && !args.includes('--use-mock-keychain')) {
    args.push('--use-mock-keychain');
  }
  return args;
}

interface ElectronLaunchContractOptions {
  appRoot: string;
  e2eUserData: string;
  configuredExecutablePath: string | undefined;
  e2eMode: string | undefined;
  platform: NodeJS.Platform;
  nodeEnv: string | undefined;
  copilotE2E: string | undefined;
  resolveSourceExecutable?: () => string;
}

export function resolveElectronLaunchContract({
  appRoot,
  e2eUserData,
  configuredExecutablePath,
  e2eMode,
  platform,
  nodeEnv,
  copilotE2E,
  resolveSourceExecutable = resolveSourceElectronExecutable,
}: ElectronLaunchContractOptions): {
  executablePath: string;
  args: string[];
} {
  if (e2eMode === 'release' && !configuredExecutablePath) {
    throw new Error('BLOCKED_RELEASE_ELECTRON_EXECUTABLE_MISSING');
  }
  const executablePath = selectElectronExecutable(
    configuredExecutablePath,
    resolveSourceExecutable,
  );
  const packagedExecutablePath = e2eMode === 'release'
    ? configuredExecutablePath
    : undefined;
  return {
    executablePath,
    args: buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath,
      e2eMode,
      platform,
      nodeEnv,
      copilotE2E,
    }),
  };
}

export interface ElectronRuntimeIdentity {
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

export interface ElectronProcessExitReceipt {
  clean: boolean;
  exitCode: number | null;
  signalCode: string | null;
  error: string | null;
}

export interface ElectronReceiptRecorder<TApp = ElectronApplication> {
  recordRuntime: (app: TApp) => Promise<ElectronRuntimeIdentity>;
  closeAndRecord: (app: TApp) => Promise<ElectronProcessExitReceipt>;
  flush: () => Promise<void>;
}

interface ElectronReceiptDirectories {
  runtimeReceiptDirectory: string | undefined;
  processExitReceiptDirectory: string | undefined;
}

export function resolveElectronReceiptPaths(
  producer: string,
  {
    runtimeReceiptDirectory,
    processExitReceiptDirectory,
  }: ElectronReceiptDirectories,
): {
  runtimeReceiptPath: string;
  processExitReceiptPath: string;
} {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(producer)) {
    throw new Error(`BLOCKED_ELECTRON_RECEIPT_PRODUCER_INVALID: ${producer}`);
  }
  if (
    !runtimeReceiptDirectory
    || !processExitReceiptDirectory
    || !path.isAbsolute(runtimeReceiptDirectory)
    || !path.isAbsolute(processExitReceiptDirectory)
  ) {
    throw new Error('BLOCKED_ELECTRON_RECEIPT_DIRECTORY_INVALID');
  }
  return {
    runtimeReceiptPath: path.join(runtimeReceiptDirectory, `${producer}.json`),
    processExitReceiptPath: path.join(processExitReceiptDirectory, `${producer}.json`),
  };
}

export function createElectronReceiptRecorder(
  producer: string,
  directories: ElectronReceiptDirectories = {
    runtimeReceiptDirectory: process.env.COPILOT_E2E_RUNTIME_RECEIPT_DIR,
    processExitReceiptDirectory: process.env.COPILOT_E2E_PROCESS_EXIT_RECEIPT_DIR,
  },
): ElectronReceiptRecorder {
  const { runtimeReceiptPath, processExitReceiptPath } =
    resolveElectronReceiptPaths(producer, directories);
  const runtimeRuns: Array<{
    runIndex: number;
    identity: ElectronRuntimeIdentity;
  }> = [];
  const processRuns: Array<ElectronProcessExitReceipt & {
    runIndex: number;
  }> = [];

  const recordRuntime = async (
    app: ElectronApplication,
  ): Promise<ElectronRuntimeIdentity> => {
    const identity = await app.evaluate(() => ({
      schemaVersion: 1 as const,
      source: 'launched-electron-main-process' as const,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      modules: process.versions.modules ?? '',
      napi: process.versions.napi ?? '',
      arch: process.arch,
      platform: process.platform,
    }));
    runtimeRuns.push({
      runIndex: runtimeRuns.length + 1,
      identity,
    });
    return identity;
  };

  const closeAndRecord = async (
    app: ElectronApplication,
  ): Promise<ElectronProcessExitReceipt> => {
    const child = app.process();
    let error: string | null = null;
    try {
      await app.close();
      await waitForExit(child);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const receipt = {
      clean: error === null && child.exitCode === 0 && child.signalCode === null,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      error,
    };
    processRuns.push({
      runIndex: processRuns.length + 1,
      ...receipt,
    });
    return receipt;
  };

  const flush = async (): Promise<void> => {
    if (
      runtimeRuns.length === 0
      || runtimeRuns.length !== processRuns.length
      || runtimeRuns.some((run, index) => run.runIndex !== index + 1)
      || processRuns.some((run, index) => run.runIndex !== index + 1)
    ) {
      throw new Error(
        `BLOCKED_ELECTRON_RECEIPT_RUN_MISMATCH: ${producer} runtime=${runtimeRuns.length} process=${processRuns.length}`,
      );
    }
    await mkdir(path.dirname(runtimeReceiptPath), { recursive: true });
    await mkdir(path.dirname(processExitReceiptPath), { recursive: true });
    await writeFile(
      runtimeReceiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        producer,
        runs: runtimeRuns,
      }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      processExitReceiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        producer,
        runs: processRuns,
      }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    const unclean = processRuns.find((run) => !run.clean);
    if (unclean) {
      throw new Error(
        `BLOCKED_ELECTRON_UNCLEAN_EXIT: code=${unclean.exitCode} signal=${unclean.signalCode}`,
      );
    }
  };

  return { recordRuntime, closeAndRecord, flush };
}

export async function launchElectronWithReceipt<TApp, TPage>({
  launchApp,
  recorder,
  initializePage,
}: {
  launchApp: () => Promise<TApp>;
  recorder: ElectronReceiptRecorder<TApp>;
  initializePage: (app: TApp) => Promise<TPage>;
}): Promise<{
  app: TApp;
  page: TPage;
  runtimeIdentity: ElectronRuntimeIdentity;
}> {
  const app = await launchApp();
  try {
    const runtimeIdentity = await recorder.recordRuntime(app);
    const page = await initializePage(app);
    return { app, page, runtimeIdentity };
  } catch (error) {
    try {
      await recorder.closeAndRecord(app);
    } catch {
      // Preserve the readiness/app-root failure that caused ownership cleanup.
    }
    throw error;
  }
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

  electronApp: [async ({ e2eUserData }, use, workerInfo) => {
    const configuredExecutablePath = process.env.COPILOT_E2E_EXECUTABLE_PATH;
    if (
      !configuredExecutablePath
      && (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY))
    ) {
      throw new Error(
        `BLOCKED_ELECTRON_BUILD_MISSING: expected ${MAIN_ENTRY} and ${RENDERER_ENTRY}`,
      );
    }
    if (
      configuredExecutablePath
      && (
        !path.isAbsolute(configuredExecutablePath)
        || !existsSync(configuredExecutablePath)
      )
    ) {
      throw new Error(
        `BLOCKED_PACKAGED_EXECUTABLE_MISSING: ${configuredExecutablePath}`,
      );
    }
    const launchContract = resolveElectronLaunchContract({
      appRoot: APP_ROOT,
      e2eUserData,
      configuredExecutablePath,
      e2eMode: process.env.COPILOT_E2E_MODE,
      platform: process.platform,
      nodeEnv: 'test',
      copilotE2E: '1',
    });
    const recorder = createElectronReceiptRecorder(
      `fixture-worker-${workerInfo.workerIndex}`,
    );
    const app = await electron.launch({
      executablePath: launchContract.executablePath,
      args: launchContract.args,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        COPILOT_E2E: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 30_000,
    });
    let exitReceipt: ElectronProcessExitReceipt | null = null;
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
      await recorder.recordRuntime(app);
      await use(app);
    } finally {
      exitReceipt = await recorder.closeAndRecord(app);
      await recorder.flush();
      if (!exitReceipt.clean) {
        throw new Error(
          `BLOCKED_ELECTRON_UNCLEAN_EXIT: code=${exitReceipt.exitCode} signal=${exitReceipt.signalCode}`,
        );
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
