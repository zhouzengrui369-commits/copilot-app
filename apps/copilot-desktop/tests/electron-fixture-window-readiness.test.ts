import { describe, expect, it, vi } from 'vitest';
import {
  buildElectronLaunchArgs,
  waitForElectronFirstWindow,
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

describe('Electron fixture bounded first-window readiness', () => {
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

  it('keeps packaged release launch arguments free of the mock-keychain switch', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/Applications/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'release',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
    })).toEqual([`--user-data-dir=${e2eUserData}`]);
  });

  it('keeps packaged non-release launch arguments free of the mock-keychain switch', () => {
    expect(buildElectronLaunchArgs({
      appRoot,
      e2eUserData,
      packagedExecutablePath: '/tmp/Copilot.app/Contents/MacOS/Copilot',
      e2eMode: 'source-like',
      platform: 'darwin',
      nodeEnv: 'test',
      copilotE2E: '1',
    })).toEqual([appRoot, `--user-data-dir=${e2eUserData}`]);
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
});
