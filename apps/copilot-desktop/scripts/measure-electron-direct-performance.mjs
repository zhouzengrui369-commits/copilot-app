import { spawn, spawnSync } from 'node:child_process';
import { chmod, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPidScopedTreeGone,
  createCollectRecord,
  createDirectPerformanceChallenge,
  createR22DirectPerformanceRunBinding,
  createPidTreeTracker,
  createSanitizedDirectChildEnv,
  formatDirectPerformanceBlocker,
  prepareDirectPerformanceWorkspace,
  validateMetricsRecord,
  validateReadyRecord,
  waitForValidatedRecord,
  writePrivateJsonOnce,
} from './direct-performance-config.mjs';
import {
  bindExecutable,
  bindStartupCandidateArtifacts,
  createStartupMilestoneReport,
  createPerformanceTempWorkspace,
  createPublicEvidenceContext,
  resolvePerformanceConfig,
  resolveStartupCandidateBindingConfig,
  verifyEmittedBuildOutputs,
  verifyExecutableBinding,
  writePerformanceEvidence,
} from './performance-config.mjs';
import { buildKgHarness } from './performance-kg-harness.mjs';
import {
  bindExecutedKgHarness,
  preserveExecutedKgHarness,
  preserveThenCleanupExecutedKgHarness,
  verifyExecutedKgHarness,
} from './performance-kg-harness.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');

if (isMainModule()) {
  await main().catch((error) => {
    process.stderr.write(formatDirectPerformanceBlocker(error));
    for (const secondary of error?.finalizationErrors ?? []) {
      process.stderr.write(
        `DIRECT_PERF_SECONDARY_FINALIZATION: ${formatDirectPerformanceBlocker(secondary)}`,
      );
    }
    process.exitCode = 1;
  });
}

async function main() {
  const config = resolvePerformanceConfig({ env: process.env, appRoot, repoRoot });
  if (config.runtimeMode !== 'packaged' || !config.executablePath) {
    throw blocker('BLOCKED_DIRECT_PERF_PACKAGED_REQUIRED');
  }
  if (!config.skipBuild) throw blocker('BLOCKED_DIRECT_PERF_SKIP_BUILD_REQUIRED');
  const candidateBindingConfig = resolveStartupCandidateBindingConfig({ env: process.env });
  const { tempRoot, userData } = await createPerformanceTempWorkspace(os.tmpdir());
  await chmod(userData, 0o700);
  let child;
  let childExit = null;
  let childPid = null;
  let pidTracker = null;
  let pidObserver = null;
  let finalProcessZeroProved = false;
  let workspace = null;
  let preExecutedHarnessBinding = null;
  let resultToPublish = null;
  let preservedHarness = null;
  let childSpawned = false;
  let primaryError = null;
  const finalizationErrors = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  try {
    workspace = await prepareDirectPerformanceWorkspace(userData);
    const harness = await buildKgHarness(workspace.harnessDir, config);
    preExecutedHarnessBinding = await bindExecutedKgHarness(workspace.harnessDir);
    if (
      JSON.stringify(preExecutedHarnessBinding)
      !== JSON.stringify(harness.provenance.executedHarnessBinding)
    ) throw blocker('BLOCKED_DIRECT_PERF_HARNESS_BINDING');
    const harnessDigest = harness.provenance.executedHarnessBinding.digest;
    const challenge = createDirectPerformanceChallenge();
    const runBinding = createR22DirectPerformanceRunBinding({ challenge, outputPath: config.outputPath });
    const executableBinding = await bindExecutable(config.executablePath);
    const candidateBinding = await bindStartupCandidateArtifacts(candidateBindingConfig);
    const launchArgs = [`--user-data-dir=${userData}`];
    const childEnv = createSanitizedDirectChildEnv(process.env, { challenge, harnessDigest });

    const controllerStartedAt = performance.now();
    child = spawn(config.executablePath, launchArgs, {
      shell: false,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitPromise = observeChild(child, stdoutChunks, stderrChunks).then((exit) => {
      childExit = exit;
      return exit;
    });
    await waitForSpawn(child);
    childSpawned = true;
    const pid = child.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw blocker('BLOCKED_DIRECT_PERF_CHILD_PID');
    childPid = pid;
    pidTracker = createPidTreeTracker(pid);
    pidTracker.observe(readProcessTable());
    pidObserver = startPidTreeObserver(pidTracker);
    const expected = {
      challenge,
      candidate: candidateBinding.candidate,
      sourceSnapshotSha256: candidateBinding.sourceSnapshot.sha256,
      pid,
    };
    const readyObservation = await waitForValidatedRecord({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      timeoutMs: 15_000,
      validate: (value) => validateReadyRecord(value, expected),
      childExited: () => childExit !== null,
    });
    const directSpawnLaunchMs = readyObservation.observedAtMs - controllerStartedAt;

    await writePrivateJsonOnce({
      filePath: workspace.collectPath,
      containedBy: workspace.probeDir,
      value: createCollectRecord({ challenge, candidate: candidateBinding.candidate, pid }),
    });
    const metricsObservation = await waitForValidatedRecord({
      filePath: workspace.metricsPath,
      containedBy: workspace.probeDir,
      timeoutMs: 30_000,
      validate: (value) => validateMetricsRecord(value, { ...expected, harnessDigest }),
      childExited: () => childExit !== null,
    });
    const metrics = metricsObservation.value;
    const startupDiagnostics = createStartupMilestoneReport(metrics.startupDiagnostics.milestones);
    pidTracker.include(metrics.electronProcessPids);
    pidTracker.observe(readProcessTable());
    const exit = await withTimeout(exitPromise, 5_000, 'BLOCKED_DIRECT_PERF_CHILD_EXIT_TIMEOUT');
    if (exit.code !== 0 || exit.signal !== null) {
      throw blocker('BLOCKED_DIRECT_PERF_CHILD_EXIT');
    }

    pidObserver.stop();
    pidObserver = null;
    const cleanup = await proveFinalPidTreeZero({ pidTracker, rootPid: pid });
    finalProcessZeroProved = true;

    const postCandidateBinding = await bindStartupCandidateArtifacts(candidateBindingConfig);
    if (JSON.stringify(postCandidateBinding) !== JSON.stringify(candidateBinding)) {
      throw blocker('BLOCKED_DIRECT_PERF_CANDIDATE_DRIFT');
    }
    await verifyExecutableBinding(config.executablePath, executableBinding);
    await verifyEmittedBuildOutputs(
      workspace.harnessDir,
      harness.provenance.authoritativeExecutedBuild,
    );
    const postExecutedHarnessBinding = await bindExecutedKgHarness(workspace.harnessDir);
    if (JSON.stringify(postExecutedHarnessBinding) !== JSON.stringify(preExecutedHarnessBinding)) {
      throw blocker('BLOCKED_DIRECT_PERF_HARNESS_DRIFT');
    }
    await verifyExecutedKgHarness(workspace.harnessDir, preExecutedHarnessBinding);

    const residentSetMb = round(metrics.app.residentSetKb / 1024);
    const launchMs = round(directSpawnLaunchMs);
    const publicContext = createPublicEvidenceContext(config, executableBinding, harness.provenance);
    resultToPublish = {
      schemaVersion: 3,
      capturedAt: new Date().toISOString(),
      source: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts',
      ...publicContext,
      candidateBinding,
      app: {
        launchMs,
        outerControllerLaunchMs: launchMs,
        directSpawnLaunchMs: launchMs,
        residentSetMb,
        processCount: metrics.app.processCount,
      },
      startup: {
        method: 'direct-spawn-write-once-v1',
        gateClock: 'controller-before-direct-spawn-through-first-validated-ready-observation',
        internalClockRole: 'diagnostic-only-never-gating',
        readyObservedAtControllerMs: round(readyObservation.observedAtMs - controllerStartedAt),
        terminal: {
          nativeWindowVisible: readyObservation.value.nativeWindowVisible,
          rendererShellCommit: readyObservation.value.rendererShellCommit,
          rendererAppRootVisible: readyObservation.value.rendererAppRootVisible,
          completionSignal: readyObservation.value.completionSignal,
        },
        diagnostics: startupDiagnostics,
        transport: {
          type: 'fresh-profile-write-once-files',
          challengeRedacted: true,
          pathsRedacted: true,
        },
      },
      runtimeProbe: {
        runBinding,
        collectPublishedAfterLaunchFreeze: true,
        appMetricsCollectedBeforeKg: true,
        sameCandidatePid: true,
        metricsObservedAfterGateMs: round(metricsObservation.observedAtMs - readyObservation.observedAtMs),
      },
      knowledgeGraph100: metrics.knowledgeGraph100,
      thresholds: {
        launchUnderMs: 2_000,
        memoryUnderMb: 500,
        kgFpsAtLeast: 30,
        kgNodeCount: 100,
      },
      processCleanup: {
        trackedPidCount: cleanup.trackedPids.length,
        remainingPidCount: cleanup.remainingPids.length,
        pass: cleanup.pass,
      },
      pass: launchMs < 2_000
        && residentSetMb < 500
        && metrics.knowledgeGraph100.nodeCount === 100
        && metrics.knowledgeGraph100.fps >= 30
        && cleanup.pass,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      pidObserver?.stop();
    } catch (error) {
      finalizationErrors.push(error);
    }
    try {
      if (child && Number.isSafeInteger(childPid ?? child.pid) && !finalProcessZeroProved) {
        const rootPid = childPid ?? child.pid;
        const tracker = pidTracker ?? createPidTreeTracker(rootPid);
        tracker.observe(readProcessTable());
        await proveFinalPidTreeZero({ pidTracker: tracker, rootPid });
      }
    } catch (error) {
      finalizationErrors.push(error);
    }
    try {
      await persistSpawnedChildOutputEvidence({
        outputPath: config.outputPath,
        childSpawned,
        stdoutChunks,
        stderrChunks,
      });
    } catch (error) {
      finalizationErrors.push(error);
    }
    const evidenceRoot = path.resolve(config.outputPath + '.harness');
    const runId = path.basename(config.outputPath);
    try {
      preservedHarness = await preserveThenCleanupExecutedKgHarness({
        preserve: async () => {
          if (!workspace || !preExecutedHarnessBinding) return null;
          return preserveExecutedKgHarness({
            sourceRoot: workspace.harnessDir,
            evidenceRoot,
            runId,
            expectedBinding: preExecutedHarnessBinding,
          });
        },
        cleanup: async () => {
          await rm(tempRoot, { recursive: true, force: true });
        },
      });
    } catch (error) {
      finalizationErrors.push(error);
    }
    try {
      await rm(userData, { recursive: true, force: true });
    } catch (error) {
      finalizationErrors.push(error);
    }
  }
  const completionError = selectDirectPerformanceFailure(primaryError, finalizationErrors);
  if (completionError) throw completionError;
  if (!resultToPublish || !preservedHarness) {
    throw blocker('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_BINDING');
  }
  resultToPublish.evidence.preservedHarness = preservedHarness;
  await writePerformanceEvidence(config, `${JSON.stringify(resultToPublish, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(resultToPublish, null, 2)}\n`);
  if (!resultToPublish.pass) process.exitCode = 2;
}

function observeChild(child, stdoutChunks, stderrChunks) {
  child.stdout?.on('data', (chunk) => boundedPush(stdoutChunks, chunk));
  child.stderr?.on('data', (chunk) => boundedPush(stderrChunks, chunk));
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function waitForSpawn(child) {
  if (child.pid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

function readProcessTable() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', shell: false, windowsHide: true });
    if (result.status !== 0) throw blocker('BLOCKED_DIRECT_PERF_PROCESS_TABLE');
    const parsed = JSON.parse(result.stdout || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
    }));
  }
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) throw blocker('BLOCKED_DIRECT_PERF_PROCESS_TABLE');
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [pid, ppid] = line.trim().split(/\s+/, 2).map(Number);
    return { pid, ppid };
  });
}

function terminateExactPidTree(rootPid, pids) {
  if (process.platform === 'win32') {
    const targets = [...new Set([rootPid, ...pids])];
    for (const pid of targets) {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
    }
    return;
  }
  for (const pid of [...new Set(pids)].sort((left, right) => right - left)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

function startPidTreeObserver(pidTracker) {
  let observerError = null;
  const observe = () => {
    if (observerError) return;
    try {
      pidTracker.observe(readProcessTable());
    } catch (error) {
      observerError = error;
    }
  };
  observe();
  const timer = setInterval(observe, 100);
  timer.unref();
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      observe();
      if (observerError) throw observerError;
    },
  };
}

async function proveFinalPidTreeZero({ pidTracker, rootPid }) {
  pidTracker.observe(readProcessTable());
  await delay(100);
  let rows = readProcessTable();
  pidTracker.observe(rows);
  let cleanup = assertPidScopedTreeGone({ trackedPids: pidTracker.snapshot(), rows });
  if (!cleanup.pass) {
    terminateExactPidTree(rootPid, cleanup.remainingPids);
    await delay(250);
    rows = readProcessTable();
    pidTracker.observe(rows);
    cleanup = assertPidScopedTreeGone({ trackedPids: pidTracker.snapshot(), rows });
  }
  if (!cleanup.pass && process.platform !== 'win32') {
    for (const pid of [...cleanup.remainingPids].sort((left, right) => right - left)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await delay(250);
    rows = readProcessTable();
    pidTracker.observe(rows);
    cleanup = assertPidScopedTreeGone({ trackedPids: pidTracker.snapshot(), rows });
  }
  if (!cleanup.pass) throw blocker('BLOCKED_DIRECT_PERF_PROCESS_LEAK');
  return cleanup;
}

export async function persistSpawnedChildOutputEvidence({
  outputPath,
  childSpawned,
  stdoutChunks,
  stderrChunks,
}) {
  const capturedOutput = stdoutChunks.length > 0 || stderrChunks.length > 0;
  if (!childSpawned && !capturedOutput) return { written: false };
  try {
    await writePrivateProcessOutput(outputPath, stdoutChunks, stderrChunks);
  } catch (cause) {
    const error = blocker('BLOCKED_DIRECT_PERF_PROCESS_OUTPUT_EVIDENCE');
    error.cause = cause;
    throw error;
  }
  return { written: true };
}

async function writePrivateProcessOutput(outputPath, stdoutChunks, stderrChunks) {
  const outputs = [
    [`${outputPath}.stdout.log`, Buffer.concat(stdoutChunks)],
    [`${outputPath}.stderr.log`, Buffer.concat(stderrChunks)],
  ];
  for (const [filePath, contents] of outputs) {
    await writeFile(filePath, contents, { flag: 'wx', mode: 0o600 });
    await chmod(filePath, 0o600);
  }
}

function attachFinalizationErrors(error, finalizationErrors) {
  if (!error || finalizationErrors.length === 0) return;
  Object.defineProperty(error, 'finalizationErrors', {
    value: [...finalizationErrors],
    configurable: true,
    enumerable: false,
  });
}

export function selectDirectPerformanceFailure(primaryError, finalizationErrors) {
  if (primaryError) {
    attachFinalizationErrors(primaryError, finalizationErrors);
    return primaryError;
  }
  if (finalizationErrors.length === 0) return null;
  const [finalizationError, ...secondaryErrors] = finalizationErrors;
  attachFinalizationErrors(finalizationError, secondaryErrors);
  return finalizationError;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function boundedPush(chunks, chunk) {
  const current = chunks.reduce((sum, item) => sum + item.byteLength, 0);
  if (current >= 64 * 1024) return;
  chunks.push(Buffer.from(chunk).subarray(0, 64 * 1024 - current));
}

function withTimeout(promise, timeoutMs, code) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(blocker(code)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function blocker(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
