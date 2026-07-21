import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  electronE2eJsonReportPath,
  summarizePlaywrightStats,
} from './support/playwright-reporting.js';
import { canonicalizeElectronUserDataPaths } from './support/electron-isolation.js';

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

const appRoot = resolveAppRoot();

describe('Electron Playwright evidence reporting', () => {
  it('keeps execution on a durable result path', () => {
    expect(electronE2eJsonReportPath(appRoot, ['node', 'playwright', 'test'], '/tmp', undefined)).toBe(
      path.join(appRoot, 'test-results/electron-e2e-results.json'),
    );
  });

  it('routes --list discovery away from durable evidence', () => {
    const actual = electronE2eJsonReportPath(
      appRoot,
      ['node', 'playwright', 'test', '--list'],
      '/tmp/codex-playwright',
      '/tmp/forbidden-durable.json',
    );
    expect(actual).not.toBe('/tmp/forbidden-durable.json');
    expect(actual).toMatch(/^\/tmp\/codex-playwright\/njx-copilot-e2e-list\//);
  });

  it('rejects a relative configured evidence path', () => {
    expect(() => electronE2eJsonReportPath(
      appRoot,
      ['node', 'playwright', 'test'],
      '/tmp',
      'relative/results.json',
    )).toThrow(/must be absolute/);
  });

  it('maps Playwright outcome stats without hiding failures', () => {
    expect(summarizePlaywrightStats({ expected: 51, skipped: 2, unexpected: 1, flaky: 1 })).toEqual({
      expected: 55,
      passed: 51,
      skipped: 2,
      unexpected: 1,
      flaky: 1,
    });
  });

  it('fails closed on malformed Playwright stats', () => {
    expect(() => summarizePlaywrightStats({ expected: 1, skipped: -1, unexpected: 0, flaky: 0 }))
      .toThrow(/stats.skipped/);
  });

  it('keeps the config wired to the safe routing helper', async () => {
    const config = await readFile(path.resolve(appRoot, 'playwright.electron.config.ts'), 'utf8');
    expect(config).toContain('electronE2eJsonReportPath(appRoot)');
    expect(config).not.toContain("outputFile: './test-results/electron-e2e-results.json'");
  });

  it('resolves an absolute Electron dist override through its package path.txt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'electron-override-test-'));
    const packageRoot = path.join(root, 'electron');
    const distRoot = path.join(packageRoot, 'dist');
    const executable = path.join(distRoot, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '38.8.6' }));
    await writeFile(path.join(packageRoot, 'path.txt'), 'Electron.app/Contents/MacOS/Electron\n');
    await writeFile(executable, 'test-electron');
    try {
      const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
      expect(await runner.resolveDevelopmentElectronExecutable({
        electronPackageRoot: path.join(root, 'unused-electron'),
        overrideDistPath: distRoot,
      })).toBe(executable);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('selects workspace Electron 38 when root Electron 33 also exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'electron-workspace-resolution-'));
    const rootPackage = path.join(root, 'node_modules/electron');
    const workspacePackage = path.join(root, 'apps/copilot-desktop/node_modules/electron');
    const makePackage = async (packageRoot: string, version: string, marker: string) => {
      const executable = path.join(packageRoot, 'dist', marker);
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ version }));
      await writeFile(path.join(packageRoot, 'path.txt'), `${marker}\n`);
      await writeFile(executable, version);
      return executable;
    };
    const root33 = await makePackage(rootPackage, '33.4.11', 'root-electron');
    const nested38 = await makePackage(workspacePackage, '38.8.6', 'workspace-electron');
    try {
      const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
      await expect(runner.resolveDevelopmentElectronExecutable({
        electronPackageRoot: workspacePackage,
      })).resolves.toBe(nested38);
      expect(nested38).not.toBe(root33);
      await expect(runner.resolveDevelopmentElectronExecutable({
        electronPackageRoot: rootPackage,
      })).rejects.toThrow('BLOCKED_CURRENT_SOURCE_ELECTRON_PACKAGE_VERSION: 33.4.11 != 38.8.6');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires Electron 38.8.6 and ABI 139 from the launched current-source process', async () => {
    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    const identity = {
      schemaVersion: 1,
      source: 'launched-electron-main-process',
      electron: '38.8.6',
      chrome: '140.0.7339.249',
      node: '22.22.0',
      modules: '139',
      napi: '10',
      arch: 'arm64',
      platform: 'darwin',
    };
    expect(runner.validateElectronRuntimeIdentity(identity, 'current-source')).toEqual(identity);
    expect(() => runner.validateElectronRuntimeIdentity({ ...identity, electron: '33.4.11' }, 'current-source'))
      .toThrow('BLOCKED_CURRENT_SOURCE_ELECTRON_RUNTIME_VERSION');
    expect(() => runner.validateElectronRuntimeIdentity({ ...identity, modules: '130' }, 'current-source'))
      .toThrow('BLOCKED_CURRENT_SOURCE_ELECTRON_MODULE_ABI');
    expect(() => runner.validateElectronRuntimeIdentity({ ...identity, extra: 'forbidden' }, 'current-source'))
      .toThrow('BLOCKED_ELECTRON_RUNTIME_IDENTITY_INVALID');
  });

  it('rejects a relative Electron dist override', async () => {
    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    await expect(runner.resolveDevelopmentElectronExecutable({
      overrideDistPath: 'relative/electron/dist',
    })).rejects.toThrow('BLOCKED_ELECTRON_OVERRIDE_DIST_PATH_NOT_ABSOLUTE');
  });

  it('rejects a missing absolute Electron dist override', async () => {
    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    await expect(runner.resolveDevelopmentElectronExecutable({
      overrideDistPath: path.join(os.tmpdir(), `missing-electron-${process.pid}`, 'dist'),
    })).rejects.toThrow('BLOCKED_ELECTRON_OVERRIDE_DIST_PATH_MISSING');
  });

  it('propagates the computed executable and mode to the Playwright child environment', async () => {
    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    const executablePath = path.join(os.tmpdir(), 'Electron.app', 'Contents', 'MacOS', 'Electron');
    const env = runner.createElectronExecutionEnv({
      baseEnv: { EXISTING: 'preserved' },
      identity: { executablePath },
      executionMode: 'current-source',
      playwrightJsonPath: '/tmp/electron-results.json',
      userDataPath: '/tmp/electron-user-data',
      processExitPath: '/tmp/electron-exit.json',
      runtimeIdentityPath: '/tmp/electron-runtime.json',
    });
    expect(env).toMatchObject({
      EXISTING: 'preserved',
      COPILOT_E2E_MODE: 'current-source',
      COPILOT_E2E_EXECUTABLE_PATH: executablePath,
      COPILOT_E2E_PLAYWRIGHT_JSON_PATH: '/tmp/electron-results.json',
      COPILOT_E2E_USER_DATA: '/tmp/electron-user-data',
      COPILOT_E2E_PROCESS_EXIT_PATH: '/tmp/electron-exit.json',
      COPILOT_E2E_RUNTIME_IDENTITY_PATH: '/tmp/electron-runtime.json',
    });
  });

  it('rejects a non-absolute computed executable identity', async () => {
    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    expect(() => runner.createElectronExecutionEnv({
      baseEnv: {},
      identity: { executablePath: 'relative/electron' },
      executionMode: 'release',
      playwrightJsonPath: '/tmp/electron-results.json',
      userDataPath: '/tmp/electron-user-data',
      processExitPath: '/tmp/electron-exit.json',
    })).toThrow('BLOCKED_ELECTRON_EXECUTABLE_IDENTITY_INVALID');
  });

  it('compares Electron user-data isolation through canonical paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'electron-user-data-realpath-'));
    const target = path.join(root, 'target');
    const alias = path.join(root, 'alias');
    await mkdir(target);
    await symlink(target, alias);
    try {
      const canonical = await canonicalizeElectronUserDataPaths(alias, target);
      expect(canonical.actual).toBe(canonical.expected);
      expect(canonical.actual).toBe(await realpath(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when an Electron user-data path cannot be canonicalized', async () => {
    const missing = path.join(os.tmpdir(), `missing-electron-user-data-${process.pid}`);
    await expect(canonicalizeElectronUserDataPaths(missing, missing))
      .rejects.toThrow('BLOCKED_ELECTRON_USER_DATA_REALPATH_FAILED');
  });
});
