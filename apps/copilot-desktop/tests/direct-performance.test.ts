// @vitest-environment node

import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type DirectPerformanceApi = {
  createDirectPerformanceChallenge?: (bytes?: Buffer) => string;
  prepareDirectPerformanceWorkspace?: (userData: string) => Promise<{
    probeDir: string;
    readyPath: string;
    collectPath: string;
    metricsPath: string;
    harnessDir: string;
    harnessHtmlPath: string;
  }>;
  createReadyRecord?: (input: Record<string, unknown>) => unknown;
  validateReadyRecord?: (input: unknown, expected: Record<string, unknown>) => unknown;
  createCollectRecord?: (input: Record<string, unknown>) => unknown;
  validateCollectRecord?: (input: unknown, expected: Record<string, unknown>) => unknown;
  validateMetricsRecord?: (input: unknown, expected: Record<string, unknown>) => unknown;
  writePrivateJsonOnce?: (input: {
    filePath: string;
    containedBy: string;
    value: unknown;
  }) => Promise<{ bytes: number; sha256: string; mode: number }>;
  waitForValidatedRecord?: (input: {
    filePath: string;
    containedBy: string;
    timeoutMs: number;
    pollMs?: number;
    validate: (value: unknown) => unknown;
    childExited?: () => boolean;
  }) => Promise<{ value: unknown; observedAtMs: number }>;
  collectPidScopedTree?: (
    rows: Array<{ pid: number; ppid: number }>,
    rootPid: number,
  ) => number[];
  assertPidScopedTreeGone?: (input: {
    trackedPids: number[];
    rows: Array<{ pid: number; ppid: number }>;
  }) => { trackedPids: number[]; remainingPids: number[]; pass: boolean };
  createSanitizedDirectChildEnv?: (
    parentEnv: Record<string, string>,
    input: { challenge: string; harnessDigest: string },
  ) => Record<string, string>;
  aggregateDirectPerformanceRuns?: (runs: Array<Record<string, unknown>>) => unknown;
};

type DirectPerformanceControllerApi = {
  persistSpawnedChildOutputEvidence?: (input: {
    outputPath: string;
    childSpawned: boolean;
    stdoutChunks: Buffer[];
    stderrChunks: Buffer[];
  }) => Promise<{ written: boolean }>;
  selectDirectPerformanceFailure?: (
    primaryError: Error | null,
    finalizationErrors: Error[],
  ) => (Error & { code?: string; finalizationErrors?: Error[] }) | null;
};

type PerformanceConfigApi = {
  writePerformanceEvidence?: (
    config: { outputPath: string; outputMode: 'external-non-overwriting' },
    contents: string,
  ) => Promise<void>;
};

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directConfigUrl = pathToFileURL(
  path.join(desktopRoot, 'scripts/direct-performance-config.mjs'),
).href;
const directControllerUrl = pathToFileURL(
  path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'),
).href;
const performanceConfigUrl = pathToFileURL(
  path.join(desktopRoot, 'scripts/performance-config.mjs'),
).href;
const tempRoots: string[] = [];

const challenge = 'a'.repeat(64);
const candidate = 'v6.2-phase1-candidate-r21';
const sourceSnapshotSha256 = 'b'.repeat(64);
const harnessDigest = 'c'.repeat(64);
const r22RawBasenames = [
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function completeAggregatePair(raw: string, launchMs: number) {
  const rawIndex = r22RawBasenames.indexOf(raw as (typeof r22RawBasenames)[number]);
  const ordinal = rawIndex >= 0 ? rawIndex + 1 : 4;
  const generatedEntry = {
    logicalName: 'copilot-kg-performance-entry.tsx',
    sourcefile: 'copilot-kg-performance-entry.tsx',
    bytes: 64,
    sha256: sha256('generated-entry'),
  };
  const files = [
    { logicalName: 'bundle.js', bytes: 41, sha256: sha256('js') },
    { logicalName: 'index.html', bytes: 51, sha256: sha256('html') },
  ];
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(JSON.stringify(file));
    digest.update('\n');
  }
  const executedHarnessBinding = {
    schemaVersion: 1,
    files,
    digest: digest.digest('hex'),
  };
  const authoritativeFiles = files
    .filter((file) => file.logicalName !== 'index.html')
    .map((file) => ({ basename: file.logicalName, bytes: file.bytes, sha256: file.sha256 }));
  const authoritativeDigest = createHash('sha256');
  for (const file of authoritativeFiles
    .map(({ basename, bytes, sha256 }) => ({ logicalPath: basename, bytes, sha256 }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))) {
    authoritativeDigest.update(JSON.stringify(file));
    authoritativeDigest.update('\n');
  }
  const artifact = (basename: string, seed: string) => ({
    basename,
    pathScope: 'host-local-redacted',
    bytes: 100 + seed.length,
    sha256: sha256(seed),
  });
  const candidateBinding = {
    candidate: 'v6.2-phase1-candidate-r22',
    executable: artifact('njx-copilot-v6', 'executable'),
    appAsar: artifact('app.asar', 'asar'),
    releaseIdentity: artifact('release-identity.exact.json', 'identity'),
    sourceSnapshot: {
      ...artifact('source-snapshot', 'snapshot'),
      fileCount: 304,
      algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
      manifest: artifact('source-snapshot-inputs.json', 'manifest'),
      canonicalManifest: artifact('CANONICAL-MANIFEST.json', 'canonical-manifest'),
    },
  };
  const harness = {
    sourceMode: 'snapshot-component-with-resolved-installed-inputs',
    authoritativeExecutedBuild: {
      authority: 'authoritative-executed-build-artifacts',
      source: 'esbuild-returned-output-bytes',
      files: authoritativeFiles,
      digest: authoritativeDigest.digest('hex'),
    },
    executedHarnessBinding,
    generatedEntry,
    inputProvenance: {
      authority: 'non-authoritative-post-build-provenance',
      note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
      component: {
        source: 'candidate-snapshot',
        logicalPath: 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx',
        bytes: 200,
        sha256: sha256('component'),
      },
      dependencies: {
        source: 'resolved-installed-inputs',
        inputCount: 5,
        digest: sha256('dependencies'),
      },
      buildInputs: {
        inputCount: 7,
        digest: sha256('build-inputs'),
        generatedEntry,
      },
      snapshotPackageLock: {
        present: true,
        bytes: 300,
        sha256: sha256('package-lock'),
      },
    },
  };
  return {
    raw,
    record: {
      schemaVersion: 3,
      capturedAt: `2026-07-13T01:00:0${ordinal}.000Z`,
      source: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts',
      runtime: {
        mode: 'packaged',
        launchBinding: 'executablePath',
        executable: structuredClone(candidateBinding.executable),
        skipBuild: true,
      },
      harness,
      evidence: {
        outputTarget: { basename: raw, pathScope: 'host-local-redacted' },
        outputMode: 'external-non-overwriting',
        preservedHarness: {
          directoryBasename: raw,
          files: structuredClone(executedHarnessBinding.files),
          binding: structuredClone(executedHarnessBinding),
        },
      },
      candidateBinding,
      app: {
        launchMs,
        outerControllerLaunchMs: launchMs,
        directSpawnLaunchMs: launchMs,
        residentSetMb: 350,
        processCount: 4,
      },
      startup: {
        method: 'direct-spawn-write-once-v1',
        gateClock: 'controller-before-direct-spawn-through-first-validated-ready-observation',
        internalClockRole: 'diagnostic-only-never-gating',
        readyObservedAtControllerMs: launchMs,
        terminal: {
          nativeWindowVisible: true,
          rendererShellCommit: true,
          rendererAppRootVisible: true,
          completionSignal: true,
        },
        diagnostics: {
          clock: 'candidate-process-monotonic-diagnostic-only',
          milestones: {
            processStart: { offsetMs: 0, reason: null },
            appWhenReady: { offsetMs: 10, reason: null },
            releaseIdentityStart: { offsetMs: 11, reason: null },
            releaseIdentityEnd: { offsetMs: 12, reason: null },
            directProbeInitStart: { offsetMs: 11, reason: null },
            directProbeInitEnd: { offsetMs: 13, reason: null },
            windowCreateStart: { offsetMs: 11, reason: null },
            windowCreated: { offsetMs: 14, reason: null },
            rendererLoadStart: { offsetMs: 15, reason: null },
            domReady: { offsetMs: 16, reason: null },
            readyToShow: { offsetMs: null, reason: 'ready-to-show-event-not-observed' },
            rendererShellCommit: { offsetMs: 18, reason: null },
            appRootVisible: { offsetMs: 19, reason: null },
            terminalReady: { offsetMs: 20, reason: null },
          },
        },
        transport: {
          type: 'fresh-profile-write-once-files',
          challengeRedacted: true,
          pathsRedacted: true,
        },
      },
      runtimeProbe: {
        runBinding: {
          rawBasename: raw,
          ordinal,
          challengeSha256: sha256(`r22-direct-run-challenge-${ordinal}`),
        },
        collectPublishedAfterLaunchFreeze: true,
        appMetricsCollectedBeforeKg: true,
        sameCandidatePid: true,
        metricsObservedAfterGateMs: 1_681.34,
      },
      knowledgeGraph100: {
        nodeCount: 100,
        edgeCount: 157,
        sampleMs: 1_500,
        frames: 45,
        fps: 30,
      },
      thresholds: {
        launchUnderMs: 2_000,
        memoryUnderMb: 500,
        kgFpsAtLeast: 30,
        kgNodeCount: 100,
      },
      processCleanup: {
        trackedPidCount: 5,
        remainingPidCount: 0,
        pass: true,
      },
      pass: launchMs < 2_000,
    },
  };
}

async function loadApi(): Promise<DirectPerformanceApi> {
  return import(/* @vite-ignore */ directConfigUrl) as Promise<DirectPerformanceApi>;
}

async function loadControllerApi(): Promise<DirectPerformanceControllerApi> {
  return import(/* @vite-ignore */ directControllerUrl) as Promise<DirectPerformanceControllerApi>;
}

async function loadPerformanceConfigApi(): Promise<PerformanceConfigApi> {
  return import(/* @vite-ignore */ performanceConfigUrl) as Promise<PerformanceConfigApi>;
}

function readyInput(overrides: Record<string, unknown> = {}) {
  return {
    challenge,
    candidate,
    sourceSnapshotSha256,
    pid: 4242,
    nativeWindowVisible: true,
    rendererAppRootVisible: true,
    completionSignal: true,
    ...overrides,
  };
}

function expectedBinding() {
  return { challenge, candidate, sourceSnapshotSha256, pid: 4242 };
}

function metricsInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: 'copilot-direct-performance-metrics',
    challenge,
    candidate,
    sourceSnapshotSha256,
    pid: 4242,
    electronProcessPids: [4242, 4243, 4244],
    app: { residentSetKb: 350_000, processCount: 4 },
    knowledgeGraph100: {
      nodeCount: 100,
      edgeCount: 157,
      sampleMs: 1_501.2,
      frames: 90,
      fps: 59.95,
    },
    harness: { digest: harnessDigest },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('r21 direct-spawn performance RED contract', () => {
  it('publishes the final external raw as a private single-link file without weakening no-overwrite', async () => {
    const api = await loadPerformanceConfigApi();
    const root = await mkdtemp(path.join(os.tmpdir(), 'direct-perf-private-raw-'));
    tempRoots.push(root);
    const outputPath = path.join(root, 'performance-raw1-r22.json');
    const contents = '{"schemaVersion":3,"pass":true}\n';
    const originalUmask = process.platform === 'win32' ? null : process.umask(0o022);

    expect(typeof api.writePerformanceEvidence).toBe('function');
    try {
      await api.writePerformanceEvidence!({
        outputPath,
        outputMode: 'external-non-overwriting',
      }, contents);
    } finally {
      if (originalUmask !== null) process.umask(originalUmask);
    }

    const published = await lstat(outputPath);
    expect(published.isFile()).toBe(true);
    expect(published.isSymbolicLink()).toBe(false);
    expect(published.nlink).toBe(1);
    if (process.platform !== 'win32') expect(published.mode & 0o777).toBe(0o600);
    expect(await readFile(outputPath, 'utf8')).toBe(contents);

    await expect(api.writePerformanceEvidence!({
      outputPath,
      outputMode: 'external-non-overwriting',
    }, '{"replacement":true}\n')).rejects.toMatchObject({
      code: 'BLOCKED_ELECTRON_PERF_OUTPUT_PATH_ALREADY_EXISTS',
    });
    expect(await readFile(outputPath, 'utf8')).toBe(contents);
    expect(await readdir(root)).toEqual([path.basename(outputPath)]);
  });

  it('persists spawned child stdout and stderr from finally instead of only the success path', async () => {
    const source = await readFile(
      path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'),
      'utf8',
    );
    const finallyStart = source.indexOf('} finally {');
    const helper = 'persistSpawnedChildOutputEvidence';

    expect(source).toContain(`export async function ${helper}`);
    expect(finallyStart).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(`await ${helper}({`, finallyStart)).toBeGreaterThan(finallyStart);
    expect(source.slice(0, finallyStart)).not.toContain('await writePrivateProcessOutput(');
  });

  it('durably writes early-exit child output once with private mode and never overwrites it', async () => {
    const api = await loadControllerApi();
    const root = await mkdtemp(path.join(os.tmpdir(), 'direct-perf-output-'));
    tempRoots.push(root);
    const outputPath = path.join(root, 'performance-raw1-r27.json');
    const stdoutPath = `${outputPath}.stdout.log`;
    const stderrPath = `${outputPath}.stderr.log`;

    expect(typeof api.persistSpawnedChildOutputEvidence).toBe('function');
    await expect(api.persistSpawnedChildOutputEvidence!({
      outputPath,
      childSpawned: true,
      stdoutChunks: [Buffer.from('candidate stdout before early exit\n')],
      stderrChunks: [Buffer.from('candidate stderr before early exit\n')],
    })).resolves.toEqual({ written: true });
    expect(await readFile(stdoutPath, 'utf8')).toBe('candidate stdout before early exit\n');
    expect(await readFile(stderrPath, 'utf8')).toBe('candidate stderr before early exit\n');
    if (process.platform !== 'win32') {
      expect((await lstat(stdoutPath)).mode & 0o777).toBe(0o600);
      expect((await lstat(stderrPath)).mode & 0o777).toBe(0o600);
    }

    await expect(api.persistSpawnedChildOutputEvidence!({
      outputPath,
      childSpawned: true,
      stdoutChunks: [Buffer.from('replacement stdout')],
      stderrChunks: [Buffer.from('replacement stderr')],
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_PROCESS_OUTPUT_EVIDENCE' });
    expect(await readFile(stdoutPath, 'utf8')).toBe('candidate stdout before early exit\n');
    expect(await readFile(stderrPath, 'utf8')).toBe('candidate stderr before early exit\n');

    const capturedOnlyPath = path.join(root, 'performance-raw2-r27.json');
    await expect(api.persistSpawnedChildOutputEvidence!({
      outputPath: capturedOnlyPath,
      childSpawned: false,
      stdoutChunks: [Buffer.from('captured before the spawn waiter resumed\n')],
      stderrChunks: [],
    })).resolves.toEqual({ written: true });
    expect(await readFile(`${capturedOnlyPath}.stdout.log`, 'utf8'))
      .toBe('captured before the spawn waiter resumed\n');
    expect(await readFile(`${capturedOnlyPath}.stderr.log`, 'utf8')).toBe('');
  });

  it('does not create misleading output logs when child spawn never completed', async () => {
    const api = await loadControllerApi();
    const root = await mkdtemp(path.join(os.tmpdir(), 'direct-perf-no-spawn-'));
    tempRoots.push(root);
    const outputPath = path.join(root, 'performance-raw1-r27.json');

    await expect(api.persistSpawnedChildOutputEvidence!({
      outputPath,
      childSpawned: false,
      stdoutChunks: [],
      stderrChunks: [],
    })).resolves.toEqual({ written: false });
    await expect(lstat(`${outputPath}.stdout.log`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(`${outputPath}.stderr.log`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the primary blocker while surfacing process-output evidence failure as secondary', async () => {
    const api = await loadControllerApi();
    const primary = Object.assign(new Error('child exited'), {
      code: 'BLOCKED_DIRECT_PERF_CHILD_EXITED',
    });
    const evidence = Object.assign(new Error('output evidence failed'), {
      code: 'BLOCKED_DIRECT_PERF_PROCESS_OUTPUT_EVIDENCE',
    });

    expect(typeof api.selectDirectPerformanceFailure).toBe('function');
    const selected = api.selectDirectPerformanceFailure!(primary, [evidence]);
    expect(selected).toBe(primary);
    expect(selected?.code).toBe('BLOCKED_DIRECT_PERF_CHILD_EXITED');
    expect(selected?.finalizationErrors).toEqual([evidence]);
  });

  it('starts the parent monotonic clock immediately before argument-vector spawn and excludes Playwright from the gate', async () => {
    const runnerPath = path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs');
    const source = await readFile(runnerPath, 'utf8');
    const clock = source.indexOf('const controllerStartedAt = performance.now();');
    const spawn = source.indexOf('spawn(config.executablePath, launchArgs, {');
    const freeze = source.indexOf(
      'const directSpawnLaunchMs = readyObservation.observedAtMs - controllerStartedAt;',
    );

    expect(clock).toBeGreaterThanOrEqual(0);
    expect(spawn).toBeGreaterThan(clock);
    expect(source.slice(clock, spawn)).not.toContain('await');
    expect(source.slice(clock, freeze)).not.toContain('_electron.launch');
    expect(source.slice(clock, freeze)).toContain('shell: false');
    expect(source.match(/bindStartupCandidateArtifacts/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('await verifyExecutableBinding(');
    expect(source).toContain('await verifyEmittedBuildOutputs(');
  });

  it('creates a fresh contained mode-0700 workspace with fixed absent ready/collect/metrics targets', async () => {
    const api = await loadApi();
    const userData = await mkdtemp(path.join(os.tmpdir(), 'r21-direct-profile-'));
    tempRoots.push(userData);
    await chmod(userData, 0o700);

    expect(typeof api.prepareDirectPerformanceWorkspace).toBe('function');
    const workspace = await api.prepareDirectPerformanceWorkspace!(userData);
    expect((await lstat(userData)).mode & 0o777).toBe(0o700);
    expect(path.dirname(workspace.probeDir)).toBe(await realpath(userData));
    expect(path.dirname(workspace.readyPath)).toBe(workspace.probeDir);
    expect(path.dirname(workspace.collectPath)).toBe(workspace.probeDir);
    expect(path.dirname(workspace.metricsPath)).toBe(workspace.probeDir);
    await expect(lstat(workspace.readyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(workspace.collectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(workspace.metricsPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('activates the main probe only for the three test switches and derives every path from userData', async () => {
    const [probeSource, mainSource] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/main/direct-performance-probe.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8'),
    ]);
    expect(probeSource).toContain("env.NODE_ENV === 'test'");
    expect(probeSource).toContain("env.COPILOT_E2E === '1'");
    expect(probeSource).toContain("env.COPILOT_DIRECT_PERF === '1'");
    expect(probeSource).toContain("path.join(userDataPath, '.copilot-direct-performance-v1')");
    expect(probeSource).not.toContain('COPILOT_DIRECT_PERF_READY_PATH');
    expect(probeSource).not.toContain('COPILOT_DIRECT_PERF_METRICS_PATH');
    const completionStart = mainSource.indexOf('function markAppRootVisibleIfComplete()');
    const completionEnd = mainSource.indexOf('\nfunction ', completionStart + 1);
    const completionBody = mainSource.slice(completionStart, completionEnd);
    expect(completionBody).toContain('rendererAppRootReported');
    expect(completionBody).toContain('mainWindow?.isVisible() === true');
    expect(completionBody).toContain('directPerformanceProbe?.reportTerminal({');
    expect(completionBody.indexOf('directPerformanceProbe?.reportTerminal({')).toBeGreaterThan(
      completionBody.indexOf('startupCompletionSent = true'),
    );
  });

  it('accepts only an exact privacy-safe ready schema bound to challenge, candidate, source and PID', async () => {
    const api = await loadApi();
    expect(typeof api.createReadyRecord).toBe('function');
    expect(typeof api.validateReadyRecord).toBe('function');
    const ready = api.createReadyRecord!(readyInput());
    expect(api.validateReadyRecord!(ready, expectedBinding())).toEqual(ready);
    expect(JSON.stringify(ready)).not.toMatch(/\/Users\/|[A-Z]:\\|note|token|api.?key|profile|path|url/i);

    for (const hostile of [
      { ...(ready as object), challenge: 'd'.repeat(64) },
      { ...(ready as object), pid: 1 },
      { ...(ready as object), candidate: 'v6.2-phase1-candidate-r20' },
      { ...(ready as object), nativeWindowVisible: false },
      { ...(ready as object), rendererAppRootVisible: false },
      { ...(ready as object), completionSignal: false },
      { ...(ready as object), note: 'private body' },
      { ...(ready as object), path: '/Users/private/profile' },
    ]) {
      expect(() => api.validateReadyRecord!(hostile, expectedBinding())).toThrow();
    }
    const childEnv = api.createSanitizedDirectChildEnv!({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-private-value',
      COPILOT_PERF_SOURCE_ROOT: '/Users/private/source',
    }, { challenge, harnessDigest });
    expect(childEnv).toMatchObject({
      PATH: '/usr/bin',
      NODE_ENV: 'test',
      COPILOT_E2E: '1',
      COPILOT_DIRECT_PERF: '1',
      COPILOT_DIRECT_PERF_CHALLENGE: challenge,
      COPILOT_DIRECT_PERF_HARNESS_DIGEST: harnessDigest,
    });
    expect(childEnv).not.toHaveProperty('OPENAI_API_KEY');
    expect(childEnv).not.toHaveProperty('COPILOT_PERF_SOURCE_ROOT');
  });

  it('publishes private JSON once with no-follow containment and rejects existing or symlink targets', async () => {
    const api = await loadApi();
    const userData = await mkdtemp(path.join(os.tmpdir(), 'r21-direct-write-'));
    tempRoots.push(userData);
    await chmod(userData, 0o700);
    const workspace = await api.prepareDirectPerformanceWorkspace!(userData);
    const value = api.createReadyRecord!(readyInput());

    expect(typeof api.writePrivateJsonOnce).toBe('function');
    const binding = await api.writePrivateJsonOnce!({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      value,
    });
    expect(binding.mode).toBe(0o600);
    await expect(api.writePrivateJsonOnce!({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      value,
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_OUTPUT_EXISTS' });

    const outside = path.join(path.dirname(userData), `${path.basename(userData)}-outside.json`);
    tempRoots.push(outside);
    await writeFile(outside, '{}', { mode: 0o600 });
    const linked = path.join(workspace.probeDir, 'linked.json');
    await symlink(outside, linked);
    await expect(api.writePrivateJsonOnce!({
      filePath: linked,
      containedBy: workspace.probeDir,
      value,
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_OUTPUT_EXISTS' });
    await expect(api.writePrivateJsonOnce!({
      filePath: outside,
      containedBy: workspace.probeDir,
      value,
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_PATH_ESCAPE' });
  });

  it('freezes only after first valid ready observation and fails closed on timeout or child exit', async () => {
    const api = await loadApi();
    const userData = await mkdtemp(path.join(os.tmpdir(), 'r21-direct-observe-'));
    tempRoots.push(userData);
    await chmod(userData, 0o700);
    const workspace = await api.prepareDirectPerformanceWorkspace!(userData);
    const ready = api.createReadyRecord!(readyInput());

    expect(typeof api.waitForValidatedRecord).toBe('function');
    const waiting = api.waitForValidatedRecord!({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      timeoutMs: 1_000,
      pollMs: 1,
      validate: (value) => api.validateReadyRecord!(value, expectedBinding()),
    });
    await api.writePrivateJsonOnce!({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      value: ready,
    });
    await expect(waiting).resolves.toMatchObject({ value: ready });
    await expect(api.waitForValidatedRecord!({
      filePath: workspace.readyPath,
      containedBy: workspace.probeDir,
      timeoutMs: 50,
      pollMs: 1,
      validate: (value) => api.validateReadyRecord!(value, expectedBinding()),
      childExited: () => true,
    })).resolves.toMatchObject({ value: ready });

    await expect(api.waitForValidatedRecord!({
      filePath: workspace.metricsPath,
      containedBy: workspace.probeDir,
      timeoutMs: 5,
      pollMs: 1,
      validate: (value) => value,
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_RECORD_TIMEOUT' });
    await expect(api.waitForValidatedRecord!({
      filePath: workspace.metricsPath,
      containedBy: workspace.probeDir,
      timeoutMs: 1_000,
      pollMs: 1,
      validate: (value) => value,
      childExited: () => true,
    })).rejects.toMatchObject({ code: 'BLOCKED_DIRECT_PERF_CHILD_EXITED' });
  });

  it('requires collect after the gate freeze and keeps RSS before authoritative KG work', async () => {
    const [runnerSource, probeSource] = await Promise.all([
      readFile(path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/direct-performance-probe.ts'), 'utf8'),
    ]);
    const freeze = runnerSource.indexOf(
      'const directSpawnLaunchMs = readyObservation.observedAtMs - controllerStartedAt;',
    );
    const collect = runnerSource.indexOf('await writePrivateJsonOnce({', freeze);
    const collectWait = probeSource.indexOf('await waitForCollectCommand(');
    const appMetrics = probeSource.indexOf('app.getAppMetrics()', collectWait);
    const kgWindow = probeSource.indexOf('new BrowserWindow(', appMetrics);

    expect(freeze).toBeGreaterThanOrEqual(0);
    expect(collect).toBeGreaterThan(freeze);
    expect(collectWait).toBeGreaterThanOrEqual(0);
    expect(appMetrics).toBeGreaterThan(collectWait);
    expect(kgWindow).toBeGreaterThan(appMetrics);
    expect(runnerSource).toContain("import { buildKgHarness } from './performance-kg-harness.mjs';");
    const legacyRunner = await readFile(
      path.join(desktopRoot, 'scripts/measure-electron-performance.mjs'),
      'utf8',
    );
    expect(legacyRunner).toContain("import { buildKgHarness } from './performance-kg-harness.mjs';");
  });

  it('strictly validates collect and post-gate metrics with authoritative harness binding', async () => {
    const api = await loadApi();
    const collect = api.createCollectRecord!({ challenge, candidate, pid: 4242 });
    expect(api.validateCollectRecord!(collect, { challenge, candidate, pid: 4242 })).toEqual(collect);
    expect(() => api.validateCollectRecord!({ ...(collect as object), extra: true }, {
      challenge,
      candidate,
      pid: 4242,
    })).toThrow();

    const metrics = metricsInput();
    expect(api.validateMetricsRecord!(metrics, {
      ...expectedBinding(),
      harnessDigest,
    })).toEqual(metrics);
    for (const hostile of [
      { ...metrics, app: { residentSetKb: -1, processCount: 4 } },
      { ...metrics, knowledgeGraph100: { ...metrics.knowledgeGraph100, nodeCount: 99 } },
      { ...metrics, harness: { digest: 'd'.repeat(64) } },
      { ...metrics, apiKey: 'sk-private-value' },
    ]) {
      expect(() => api.validateMetricsRecord!(hostile, {
        ...expectedBinding(),
        harnessDigest,
      })).toThrow();
    }
  });

  it('tracks and proves cleanup of only the exact child PID tree', async () => {
    const api = await loadApi();
    const rows = [
      { pid: 100, ppid: 1 },
      { pid: 101, ppid: 100 },
      { pid: 102, ppid: 101 },
      { pid: 999, ppid: 1 },
    ];
    expect(api.collectPidScopedTree!(rows, 100)).toEqual([100, 101, 102]);
    expect(api.assertPidScopedTreeGone!({ trackedPids: [100, 101, 102], rows: [] })).toEqual({
      trackedPids: [100, 101, 102],
      remainingPids: [],
      pass: true,
    });
    expect(api.assertPidScopedTreeGone!({ trackedPids: [100, 101, 102], rows: [
      { pid: 102, ppid: 1 },
      { pid: 999, ppid: 1 },
    ] })).toEqual({
      trackedPids: [100, 101, 102],
      remainingPids: [102],
      pass: false,
    });
  });

  it('accepts exactly three sequential complete runs and rejects any-fail, fourth-run and median override', async () => {
    const api = await loadApi();
    const passing = (raw: string, launchMs: number) => completeAggregatePair(raw, launchMs);
    const aggregate = api.aggregateDirectPerformanceRuns!([
      passing(r22RawBasenames[0], 1_100),
      passing(r22RawBasenames[1], 1_300),
      passing(r22RawBasenames[2], 1_500),
    ]);
    expect(aggregate).toMatchObject({
      runCount: 3,
      maxDirectSpawnLaunchMs: 1_500,
      thresholdExclusiveMs: 2_000,
      pass: true,
    });
    expect(api.aggregateDirectPerformanceRuns!([
      passing(r22RawBasenames[0], 1_100),
      passing(r22RawBasenames[1], 2_000),
      passing(r22RawBasenames[2], 1_300),
    ])).toMatchObject({ pass: false, maxDirectSpawnLaunchMs: 2_000 });
    const failedRun = passing(r22RawBasenames[1], 1_200);
    failedRun.record.processCleanup.remainingPidCount = 1;
    failedRun.record.processCleanup.pass = false;
    failedRun.record.pass = false;
    expect(api.aggregateDirectPerformanceRuns!([
      passing(r22RawBasenames[0], 1_100),
      failedRun,
      passing(r22RawBasenames[2], 1_300),
    ])).toMatchObject({ pass: false });
    expect(() => api.aggregateDirectPerformanceRuns!([
      passing(r22RawBasenames[0], 1_100),
      passing(r22RawBasenames[1], 1_200),
    ])).toThrow(/exactly three/i);
    expect(() => api.aggregateDirectPerformanceRuns!([
      passing(r22RawBasenames[0], 1_100),
      passing(r22RawBasenames[1], 1_200),
      passing(r22RawBasenames[2], 1_300),
      passing('performance-raw4-r22.json', 1_400),
    ])).toThrow(/exactly three/i);
  });
});
