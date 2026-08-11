import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as electronFixture from './e2e/electron.fixture.js';
import {
  buildElectronLaunchArgs,
  launchElectronWithReceipt,
  resolveElectronLaunchContract,
  resolveElectronReceiptPaths,
  waitForElectronFirstWindow,
  type ElectronProcessExitReceipt,
  type ElectronRuntimeIdentity,
  type ElectronWindowIdentity,
} from './e2e/electron.fixture.js';

const expectedUserDataPath = '/isolated/user-data';

function identity(
  windowCount: number,
  userDataPath = expectedUserDataPath,
): ElectronWindowIdentity {
  return {
    appName: 'njx-copilot-v6',
    appPath: '/repo/apps/copilot-desktop',
    userDataPath,
    windowCount,
  };
}

const canonicalizeSame = async (expected: string, actual: string) => ({
  expected,
  actual,
});

type ProducerUserDataPathResolver = (
  workerRoot: string,
  producer: string,
) => string;

function requireProducerUserDataPathResolver(): ProducerUserDataPathResolver {
  const resolver = (
    electronFixture as unknown as {
      resolveElectronProducerUserDataPath?: ProducerUserDataPathResolver;
    }
  ).resolveElectronProducerUserDataPath;
  expect(resolver).toBeTypeOf('function');
  return resolver as ProducerUserDataPathResolver;
}

describe('Electron per-producer user-data isolation', () => {
  it('resolves the same stable path for the same producer', () => {
    const resolveProducerUserDataPath = requireProducerUserDataPathResolver();

    expect(resolveProducerUserDataPath('/isolated/user-data', 'exp-cop-008')).toBe(
      path.join('/isolated/user-data', 'producers', 'exp-cop-008'),
    );
    expect(resolveProducerUserDataPath('/isolated/user-data', 'exp-cop-008')).toBe(
      path.join('/isolated/user-data', 'producers', 'exp-cop-008'),
    );
  });

  it('resolves EXP-COP-008 and EXP-COP-009 to distinct sibling paths', () => {
    const resolveProducerUserDataPath = requireProducerUserDataPathResolver();
    const exp008 = resolveProducerUserDataPath('/isolated/user-data', 'exp-cop-008');
    const exp009 = resolveProducerUserDataPath('/isolated/user-data', 'exp-cop-009');

    expect(exp008).toBe(path.join('/isolated/user-data', 'producers', 'exp-cop-008'));
    expect(exp009).toBe(path.join('/isolated/user-data', 'producers', 'exp-cop-009'));
    expect(exp008).not.toBe(exp009);
    expect(path.dirname(exp008)).toBe(path.dirname(exp009));
  });

  it('fails closed on a relative worker root with the exact code', () => {
    const resolveProducerUserDataPath = requireProducerUserDataPathResolver();

    expect(() => resolveProducerUserDataPath('relative/user-data', 'exp-cop-008'))
      .toThrow('BLOCKED_ELECTRON_USER_DATA_ROOT_INVALID');
  });

  it('fails closed on an unsafe producer slug with the exact code', () => {
    const resolveProducerUserDataPath = requireProducerUserDataPathResolver();

    expect(() => resolveProducerUserDataPath('/isolated/user-data', '../shared'))
      .toThrow('BLOCKED_ELECTRON_USER_DATA_PRODUCER_INVALID');
  });
});

describe('Electron fixture bounded first-window readiness', () => {
  it('records ownership and closes exactly once before propagating readiness failure', async () => {
    const readinessFailure = new Error('INJECTED_READINESS_FAILURE');
    const app = { id: 'injected-app' };
    const runtimeRows: ElectronRuntimeIdentity[] = [];
    const processRows: ElectronProcessExitReceipt[] = [];
    const runtimeIdentity: ElectronRuntimeIdentity = {
      schemaVersion: 1,
      source: 'launched-electron-main-process',
      electron: '38.8.6',
      chrome: '140',
      node: '22',
      modules: '140',
      napi: '10',
      arch: 'arm64',
      platform: 'darwin',
    };
    const cleanProcessReceipt: ElectronProcessExitReceipt = {
      clean: true,
      exitCode: 0,
      signalCode: null,
      error: null,
    };
    const closeAndRecord = vi.fn(async () => {
      processRows.push(cleanProcessReceipt);
      return cleanProcessReceipt;
    });
    const flush = vi.fn(async () => {
      expect(runtimeRows).toHaveLength(1);
      expect(processRows).toHaveLength(1);
      expect(processRows[0]).toEqual(cleanProcessReceipt);
    });

    await expect(launchElectronWithReceipt({
      launchApp: vi.fn(async () => app),
      recorder: {
        recordRuntime: vi.fn(async () => {
          runtimeRows.push(runtimeIdentity);
          return runtimeIdentity;
        }),
        closeAndRecord,
        flush,
      },
      initializePage: vi.fn(async () => {
        throw readinessFailure;
      }),
    })).rejects.toBe(readinessFailure);

    expect(runtimeRows).toEqual([runtimeIdentity]);
    expect(processRows).toEqual([cleanProcessReceipt]);
    expect(closeAndRecord).toHaveBeenCalledOnce();
    expect(closeAndRecord).toHaveBeenCalledWith(app);
    await expect(flush()).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('accepts a delayed first window within the exact deadline', async () => {
    const readIdentity = vi.fn()
      .mockResolvedValueOnce(identity(0))
      .mockResolvedValueOnce(identity(1));
    const waitForFirstWindow = vi.fn(async () => {
      await Promise.resolve();
      return {};
    });

    await expect(waitForElectronFirstWindow({
      expectedUserDataPath,
      readIdentity,
      waitForFirstWindow,
      timeoutMs: 321,
      canonicalizeUserDataPaths: canonicalizeSame,
    })).resolves.toEqual(identity(1));

    expect(waitForFirstWindow).toHaveBeenCalledOnce();
    expect(waitForFirstWindow).toHaveBeenCalledWith({ timeout: 321 });
    expect(readIdentity).toHaveBeenCalledTimes(2);
  });

  it('fails a zero-window launch with a bounded WINDOW_READINESS_TIMEOUT', async () => {
    const readIdentity = vi.fn().mockResolvedValue(identity(0));
    const waitForFirstWindow = vi.fn(async ({ timeout }: { timeout: number }) => {
      throw new Error(`Timeout ${timeout}ms exceeded`);
    });

    await expect(waitForElectronFirstWindow({
      expectedUserDataPath,
      readIdentity,
      waitForFirstWindow,
      timeoutMs: 17,
      canonicalizeUserDataPaths: canonicalizeSame,
    })).rejects.toThrow(
      'WINDOW_READINESS_TIMEOUT: 17ms: Timeout 17ms exceeded',
    );

    expect(waitForFirstWindow).toHaveBeenCalledOnce();
    expect(waitForFirstWindow).toHaveBeenCalledWith({ timeout: 17 });
    expect(readIdentity).toHaveBeenCalledOnce();
  });

  it('fails a userData mismatch immediately without waiting for a window', async () => {
    const readIdentity = vi.fn().mockResolvedValue(identity(0, '/shared/user-data'));
    const waitForFirstWindow = vi.fn();
    const canonicalizeMismatch = vi.fn(async () => ({
      expected: expectedUserDataPath,
      actual: '/shared/user-data',
    }));

    await expect(waitForElectronFirstWindow({
      expectedUserDataPath,
      readIdentity,
      waitForFirstWindow,
      timeoutMs: 999,
      canonicalizeUserDataPaths: canonicalizeMismatch,
    })).rejects.toThrow('BLOCKED_NOT_ISOLATED_ELECTRON');

    expect(canonicalizeMismatch).toHaveBeenCalledOnce();
    expect(waitForFirstWindow).not.toHaveBeenCalled();
  });
});

describe('Electron fixture launch arguments', () => {
  const appRoot = '/repo/apps/copilot-desktop';
  const e2eUserData = '/isolated/user-data';

  it('adds exactly one mock-keychain switch for a darwin source-test launch', () => {
    const args = buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: undefined,
      e2eMode: undefined,
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
    });

    expect(args).toEqual([
      appRoot,
      `--user-data-dir=${e2eUserData}`,
      '--use-mock-keychain',
    ]);
    expect(args.filter((arg) => arg === '--use-mock-keychain')).toHaveLength(1);
  });

  it('adds exactly one mock-keychain switch for a darwin packaged-release E2E test launch', () => {
    const args = buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/Applications/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'release',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
    });

    expect(args).toEqual([
      `--user-data-dir=${e2eUserData}`,
      '--use-mock-keychain',
    ]);
    expect(args.filter((arg) => arg === '--use-mock-keychain')).toHaveLength(1);
  });

  it('adds exactly one mock-keychain switch for a darwin packaged source-like E2E test launch', () => {
    const args = buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/tmp/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'source-like',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
    });

    expect(args).toEqual([
      appRoot,
      `--user-data-dir=${e2eUserData}`,
      '--use-mock-keychain',
    ]);
    expect(args.filter((arg) => arg === '--use-mock-keychain')).toHaveLength(1);
  });

  it('keeps non-darwin source-test launch arguments free of the mock-keychain switch', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: undefined,
      e2eMode: undefined,
      platform: 'linux',
      nodeEnv: 'test',
      copilotE2E: '1',
    })).toEqual([appRoot, `--user-data-dir=${e2eUserData}`]);
  });

  it('keeps ordinary non-E2E darwin source launch arguments unchanged', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: undefined,
      e2eMode: undefined,
      platform: 'darwin',
      nodeEnv: 'production',
      copilotE2E: undefined,
    })).toEqual([appRoot, `--user-data-dir=${e2eUserData}`]);
  });

  it('keeps darwin non-test E2E launch arguments free of the mock-keychain switch', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/Applications/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'release',
      platform: 'darwin',
      nodeEnv: 'production',
      copilotE2E: '1',
    })).toEqual([`--user-data-dir=${e2eUserData}`]);
  });

  it('keeps darwin test launch arguments free of the mock-keychain switch outside E2E', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/Applications/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'release',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: undefined,
    })).toEqual([`--user-data-dir=${e2eUserData}`]);
  });

  it('resolves a configured release executable with PACKAGED_E2E_MOCK_KEYCHAIN test isolation', () => {
    const executablePath = '/Applications/Copilot.app/Contents/MacOS/Copilot';
    expect(resolveElectronLaunchContract({
      appRoot,
      e2eUserData,
      configuredExecutablePath: executablePath,
      e2eMode: 'release',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
      resolveSourceExecutable: () => {
        throw new Error('source resolution must not run');
      },
    })).toEqual({
      executablePath,
      args: [
        `--user-data-dir=${e2eUserData}`,
        '--use-mock-keychain',
      ],
    });
  });

  it('preserves source arguments when a current-source executable is configured', () => {
    const executablePath = '/tmp/Electron.app/Contents/MacOS/Electron';
    expect(resolveElectronLaunchContract({
      appRoot,
      e2eUserData,
      configuredExecutablePath: executablePath,
      e2eMode: 'current-source',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
      resolveSourceExecutable: () => '/unused/source/electron',
    })).toEqual({
      executablePath,
      args: [
        appRoot,
        `--user-data-dir=${e2eUserData}`,
        '--use-mock-keychain',
      ],
    });
  });
});

describe('Electron per-producer receipt paths', () => {
  it('resolves exclusive producer-owned files beneath absolute directories', () => {
    expect(resolveElectronReceiptPaths('exp-cop-008', {
      runtimeReceiptDirectory: '/tmp/runtime-receipts',
      processExitReceiptDirectory: '/tmp/process-receipts',
    })).toEqual({
      runtimeReceiptPath: '/tmp/runtime-receipts/exp-cop-008.json',
      processExitReceiptPath: '/tmp/process-receipts/exp-cop-008.json',
    });
  });

  it('fails closed on unsafe producers or relative receipt directories', () => {
    expect(() => resolveElectronReceiptPaths('../shared', {
      runtimeReceiptDirectory: '/tmp/runtime-receipts',
      processExitReceiptDirectory: '/tmp/process-receipts',
    })).toThrow('BLOCKED_ELECTRON_RECEIPT_PRODUCER_INVALID');
    expect(() => resolveElectronReceiptPaths('exp-cop-008', {
      runtimeReceiptDirectory: 'relative/runtime',
      processExitReceiptDirectory: '/tmp/process-receipts',
    })).toThrow('BLOCKED_ELECTRON_RECEIPT_DIRECTORY_INVALID');
  });
});
