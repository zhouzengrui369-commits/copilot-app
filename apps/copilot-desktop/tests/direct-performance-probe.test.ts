import { chmod, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-ignore JavaScript protocol helper is exercised directly by Vitest.
import * as directConfig from '../scripts/direct-performance-config.mjs';
import {
  bindExecutedHarnessFiles,
  createDirectPerformanceProbe,
  resolveDirectPerformanceProbeConfig,
} from '../src/main/direct-performance-probe.js';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  windows: [] as Array<{ destroyed: boolean }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow {
    destroyed = false;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      executeJavaScript: vi.fn(async () => {
        mocks.order.push('kg-sample');
        return {
          nodeCount: 100,
          edgeCount: 157,
          sampleMs: 1_501,
          frames: 90,
          fps: 59.96,
        };
      }),
      session: {
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      },
    };

    constructor() {
      mocks.order.push('kg-window');
      mocks.windows.push(this);
    }

    async loadFile() {
      mocks.order.push('kg-load');
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      mocks.order.push('kg-destroy');
    }
  },
}));

const tempRoots: string[] = [];
const challenge = 'a'.repeat(64);
const candidate = 'v6.2-phase1-candidate-r21';
const sourceSnapshotSha256 = 'b'.repeat(64);
const releaseIdentity = {
  schemaVersion: 1 as const,
  candidate,
  sourceHead: 'd'.repeat(40),
  sourceSnapshotSha256,
};

afterEach(async () => {
  mocks.order.splice(0);
  mocks.windows.splice(0);
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('r21 main direct-performance probe', () => {
  it('is a complete no-op unless all three test-only switches are present', async () => {
    for (const env of [
      {},
      { NODE_ENV: 'test' },
      { NODE_ENV: 'test', COPILOT_E2E: '1' },
      { NODE_ENV: 'production', COPILOT_E2E: '1', COPILOT_DIRECT_PERF: '1' },
    ]) {
      await expect(resolveDirectPerformanceProbeConfig({
        env,
        userDataPath: '/path/that/must/not/be-read',
        releaseIdentity: null,
      })).resolves.toBeNull();
    }
  });

  it('publishes ready once at the dual terminal, waits for collect, then measures RSS before KG', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'r21-main-probe-'));
    tempRoots.push(userData);
    await chmod(userData, 0o700);
    const workspace = await directConfig.prepareDirectPerformanceWorkspace(userData);
    await writeFile(workspace.harnessHtmlPath, '<!doctype html><div id="root"></div>', {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(workspace.harnessDir, 'bundle.js'), 'globalThis.__KG_PERF__={};', {
      flag: 'wx',
      mode: 0o600,
    });
    const harnessDigest = (await bindExecutedHarnessFiles(workspace.harnessDir)).digest;
    const env = {
      NODE_ENV: 'test',
      COPILOT_E2E: '1',
      COPILOT_DIRECT_PERF: '1',
      COPILOT_DIRECT_PERF_CHALLENGE: challenge,
      COPILOT_DIRECT_PERF_HARNESS_DIGEST: harnessDigest,
    };
    const quit = vi.fn(() => mocks.order.push('quit'));
    const getAppMetrics = vi.fn(() => {
      mocks.order.push('rss');
      return [
        { pid: process.pid, memory: { workingSetSize: 200_000 } },
        { pid: process.pid + 1, memory: { workingSetSize: 150_000 } },
      ];
    });
    const failure = vi.fn();
    const probe = await createDirectPerformanceProbe({
      app: { getAppMetrics, quit } as never,
      env,
      userDataPath: userData,
      releaseIdentity,
      onFailure: failure,
    });

    expect(probe.active).toBe(true);
    probe.reportTerminal({
      nativeWindowVisible: false,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
      completionSignal: true,
    });
    await expect(lstat(workspace.readyPath)).rejects.toMatchObject({ code: 'ENOENT' });

    probe.reportTerminal({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
      completionSignal: true,
    });
    probe.reportTerminal({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
      completionSignal: true,
    });
    const expected = { challenge, candidate, sourceSnapshotSha256, pid: process.pid };
    const ready = await directConfig.waitForValidatedRecord({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      timeoutMs: 1_000,
      pollMs: 1,
      validate: (value: unknown) => directConfig.validateReadyRecord(value, expected),
    });
    expect(ready.value).toMatchObject({
      nativeWindowVisible: true,
      rendererAppRootVisible: true,
      completionSignal: true,
    });
    expect(mocks.order).not.toContain('rss');
    expect(mocks.order).not.toContain('kg-window');

    await directConfig.writePrivateJsonOnce({
      filePath: workspace.collectPath,
      containedBy: workspace.probeDir,
      value: directConfig.createCollectRecord({ challenge, candidate, pid: process.pid }),
    });
    const metrics = await directConfig.waitForValidatedRecord({
      filePath: workspace.metricsPath,
      containedBy: workspace.probeDir,
      timeoutMs: 1_000,
      pollMs: 1,
      validate: (value: unknown) => directConfig.validateMetricsRecord(value, {
        ...expected,
        harnessDigest,
      }),
    });

    expect(metrics.value).toMatchObject({
      electronProcessPids: [process.pid, process.pid + 1],
      app: { residentSetKb: 350_000, processCount: 2 },
      knowledgeGraph100: { nodeCount: 100, fps: 59.96 },
      harness: { digest: harnessDigest },
    });
    expect(mocks.order.indexOf('rss')).toBeLessThan(mocks.order.indexOf('kg-window'));
    expect(mocks.order.indexOf('kg-window')).toBeLessThan(mocks.order.indexOf('kg-sample'));
    expect(mocks.order.filter((entry) => entry === 'rss')).toHaveLength(2);
    expect(mocks.order.lastIndexOf('rss')).toBeGreaterThan(mocks.order.indexOf('kg-sample'));
    expect(quit).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
    expect(mocks.windows).toHaveLength(1);
    expect(mocks.windows[0].destroyed).toBe(true);
    expect((await lstat(workspace.readyPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(workspace.metricsPath)).mode & 0o777).toBe(0o600);
  });
});
