import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import {
  bindExecutable,
  bindStartupCandidateArtifacts,
  createStartupMilestoneReport,
  createElectronLaunchTarget,
  createPerformanceTempWorkspace,
  createPublicEvidenceContext,
  formatPerformanceBlocker,
  isStartupLaunchComplete,
  resolvePerformanceConfig,
  resolveStartupCandidateBindingConfig,
  verifyEmittedBuildOutputs,
  verifyExecutableBinding,
  writePerformanceEvidence,
} from './performance-config.mjs';
import { buildKgHarness } from './performance-kg-harness.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');

await main().catch((error) => {
  process.stderr.write(formatPerformanceBlocker(error));
  process.exitCode = 1;
});

async function main() {
  const config = resolvePerformanceConfig({ env: process.env, appRoot, repoRoot });
  const candidateBindingConfig = config.runtimeMode === 'packaged'
    ? resolveStartupCandidateBindingConfig({ env: process.env })
    : undefined;
  const { tempRoot, userData } = await createPerformanceTempWorkspace(os.tmpdir());
  try {
    if (!config.skipBuild) buildDesktop();
    const harness = await buildKgHarness(tempRoot, config);

    // Bind the exact executable immediately before launch, after all preparation work.
    const executableBinding = config.executablePath
      ? await bindExecutable(config.executablePath)
      : undefined;
    const candidateBinding = candidateBindingConfig
      ? await bindStartupCandidateArtifacts(candidateBindingConfig)
      : undefined;
    const controllerStartedAt = performance.now();
    const controllerMilestones = {
      electronLaunchResolvedMs: null,
      firstWindowResolvedMs: null,
      domContentLoadedObservedMs: null,
      domAppRootVisibleObservedMs: null,
      nativeWindowVisibleObservedMs: null,
      launchCompleteMs: null,
    };
    const electronApp = await electron.launch({
      ...createElectronLaunchTarget(config, userData),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        COPILOT_E2E: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
    });
    controllerMilestones.electronLaunchResolvedMs = round(performance.now() - controllerStartedAt);
    try {
      const appPage = await electronApp.firstWindow();
      controllerMilestones.firstWindowResolvedMs = round(performance.now() - controllerStartedAt);
      await appPage.waitForLoadState('domcontentloaded');
      controllerMilestones.domContentLoadedObservedMs = round(performance.now() - controllerStartedAt);
      const startupCompletion = await waitForStartupCompletion({
        appPage,
        controllerStartedAt,
        controllerMilestones,
      });
      const outerControllerLaunchMs = startupCompletion.completedAtMs;
      controllerMilestones.launchCompleteMs = round(outerControllerLaunchMs);
      const postGateNativeWindowVisible = await electronApp.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      ));
      const postGateAppRootVisible = await appPage.getByTestId('app-root').isVisible();
      if (!isStartupLaunchComplete({
        nativeWindowVisible: postGateNativeWindowVisible,
        appRootVisible: postGateAppRootVisible,
      })) {
        throw performanceBlocker(
          'BLOCKED_ELECTRON_STARTUP_TERMINAL_ASSERTION',
          'Post-gate native and DOM visibility assertion failed',
        );
      }
      const internalReport = await readStartupMilestoneReport(appPage);
      const internalMilestones = createStartupMilestoneReport(
        internalReport.milestones,
      );

      const metrics = await electronApp.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
        type: metric.type,
        residentSetKb: Number(metric.memory.workingSetSize ?? 0),
        privateKb: Number(metric.memory.privateBytes ?? 0),
      })));
      const residentSetKb = metrics.reduce((sum, metric) => sum + metric.residentSetKb, 0);
      const privateKb = metrics.reduce((sum, metric) => sum + metric.privateKb, 0);

      const perfWindowPromise = electronApp.waitForEvent('window');
      await electronApp.evaluate(async ({ BrowserWindow }, htmlPath) => {
        const window = new BrowserWindow({
          width: 1100,
          height: 760,
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        await window.loadFile(htmlPath);
      }, harness.htmlPath);
      const perfPage = await perfWindowPromise;
      await perfPage.waitForFunction(() => Boolean((window).__KG_PERF__), null, { timeout: 20_000 });
      const kg = await perfPage.evaluate(() => (window).__KG_PERF__);

      const publicContext = createPublicEvidenceContext(config, executableBinding, harness.provenance);
      const result = {
        schemaVersion: 2,
        capturedAt: new Date().toISOString(),
        source: 'real-electron-app-plus-authoritative-emitted-knowledgegraph-artifacts',
        ...publicContext,
        candidateBinding: candidateBinding ?? null,
        app: {
          launchMs: round(outerControllerLaunchMs),
          outerControllerLaunchMs: round(outerControllerLaunchMs),
          residentSetMb: round(residentSetKb / 1024),
          privateMb: privateKb > 0 ? round(privateKb / 1024) : undefined,
          processCount: metrics.length,
        },
        startup: {
          gateClock: 'outer-controller-before-electron-launch-through-native-and-dom-visible',
          internalClockRole: 'diagnostic-only-never-gating',
          controllerMilestones,
          internal: internalMilestones,
          terminal: {
            completionSignal: startupCompletion.completionSignal,
            nativeWindowVisible: postGateNativeWindowVisible,
            appRootVisible: postGateAppRootVisible,
            assertionTiming: 'after-outer-duration-frozen',
          },
        },
        knowledgeGraph100: {
          nodeCount: kg.nodeCount,
          edgeCount: kg.edgeCount,
          sampleMs: kg.sampleMs,
          frames: kg.frames,
          fps: kg.fps,
          dataSource: 'FixtureKgDataSource(100) explicit benchmark seed; production default remains disabled',
        },
        thresholds: {
          launchUnderMs: 2000,
          memoryUnderMb: 500,
          kgFpsAtLeast: 30,
        },
        pass: outerControllerLaunchMs < 2000
          && postGateNativeWindowVisible
          && postGateAppRootVisible
          && residentSetKb / 1024 < 500
          && kg.fps >= 30
          && kg.nodeCount === 100,
      };

      // Evidence is publishable only if the executable is unchanged since launch binding.
      if (config.executablePath && executableBinding) {
        await verifyExecutableBinding(config.executablePath, executableBinding);
      }
      if (candidateBindingConfig && candidateBinding) {
        const postLaunchCandidateBinding = await bindStartupCandidateArtifacts(candidateBindingConfig);
        if (JSON.stringify(postLaunchCandidateBinding) !== JSON.stringify(candidateBinding)) {
          throw performanceBlocker(
            'BLOCKED_STARTUP_CANDIDATE_CHANGED',
            'Candidate executable, app.asar, release identity, or source snapshot changed during measurement',
          );
        }
      }
      await verifyEmittedBuildOutputs(
        tempRoot,
        harness.provenance.authoritativeExecutedBuild,
      );
      await writePerformanceEvidence(config, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 2;
    } finally {
      await electronApp.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
}

async function waitForStartupCompletion({
  appPage,
  controllerStartedAt,
  controllerMilestones,
}) {
  await appPage.waitForFunction(() => {
    const appRoot = document.querySelector('[data-testid="app-root"]');
    if (!(appRoot instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(appRoot);
    const appRootVisible = style.display !== 'none' && style.visibility !== 'hidden';
    return window.copilot?.startup.isComplete() === true && appRootVisible;
  }, null, { timeout: 15_000, polling: 'raf' });
  const completedAtMs = round(performance.now() - controllerStartedAt);
  controllerMilestones.nativeWindowVisibleObservedMs = completedAtMs;
  controllerMilestones.domAppRootVisibleObservedMs = completedAtMs;
  return {
    completionSignal: true,
    completedAtMs,
  };
}

async function readStartupMilestoneReport(appPage) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const report = await appPage.evaluate(
      async () => window.copilot?.startup.getMilestones(),
    ).catch(() => undefined);
    if (Number.isFinite(report?.milestones?.appRootVisible?.offsetMs)) return report;
    await appPage.waitForTimeout(10);
  }
  throw performanceBlocker(
    'BLOCKED_ELECTRON_STARTUP_MILESTONES_UNAVAILABLE',
    'Diagnostic startup milestones were unavailable after the outer launch duration was frozen',
  );
}

function buildDesktop() {
  const built = spawnSync('npm', ['run', 'build', '--workspace', '@copilot/desktop'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (built.status !== 0) {
    const detail = `${built.stdout ?? ''}${built.stderr ?? ''}`.trim();
    throw performanceBlocker(
      'BLOCKED_ELECTRON_PERF_BUILD_FAILED',
      detail || `Desktop build exited ${built.status ?? 'without status'}`,
    );
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function performanceBlocker(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
