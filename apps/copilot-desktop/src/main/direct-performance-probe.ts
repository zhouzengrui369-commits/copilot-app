import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, type App } from 'electron';
import type { PackagedReleaseIdentity } from './local-telemetry.js';

const PROTOCOL_VERSION = 1;
const READY_FILE = 'ready.json';
const COLLECT_FILE = 'collect.json';
const METRICS_FILE = 'metrics.json';
const CHALLENGE = /^[a-f0-9]{64}$/;
const CANDIDATE = /^v6\.2-phase1-candidate-r\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 8 * 1024;

interface DirectProbeConfig {
  challenge: string;
  harnessDigest: string;
  candidate: string;
  sourceSnapshotSha256: string;
  probeDir: string;
  readyPath: string;
  collectPath: string;
  metricsPath: string;
  harnessDir: string;
  harnessHtmlPath: string;
}

interface DirectProbeTerminal {
  nativeWindowVisible: boolean;
  rendererShellCommit: boolean;
  rendererAppRootVisible: boolean;
  completionSignal: boolean;
}

interface StartupMilestoneReport {
  clock: 'candidate-process-monotonic-diagnostic-only';
  milestones: Record<string, { offsetMs: number | null; reason: string | null }>;
}

interface KgMetrics {
  nodeCount: number;
  edgeCount: number;
  sampleMs: number;
  frames: number;
  fps: number;
}

interface ExecutedHarnessFileBinding {
  logicalName: 'bundle.css' | 'bundle.js' | 'index.html';
  bytes: number;
  sha256: string;
}

interface ExecutedHarnessBinding {
  schemaVersion: 1;
  files: ExecutedHarnessFileBinding[];
  digest: string;
}

export interface DirectPerformanceProbe {
  readonly active: boolean;
  reportTerminal(terminal: DirectProbeTerminal): void;
}

export interface StartupTerminalState {
  nativeWindowVisible: boolean;
  rendererShellCommit: boolean;
  rendererAppRootVisible: boolean;
}

export interface StartupCoordinator {
  start(): Promise<void>;
  reportTerminal(update: Partial<StartupTerminalState>): void;
}

interface StartupCoordinatorOptions {
  directMode: boolean;
  startWindow: () => Promise<void>;
  loadReleaseIdentity: () => Promise<unknown>;
  prepareDirectProbe: () => Promise<{
    reportTerminal(state: StartupTerminalState): void;
  }>;
  loadSettings: () => Promise<unknown>;
  applySettings: (settings: unknown) => void | Promise<void>;
  onTerminalReady: (state: StartupTerminalState) => void;
  recordDefaultTelemetry: () => void;
  failClosed: (code: string) => void;
}

type StartupLaneBlockerCode =
  | 'BLOCKED_DIRECT_PERF_STARTUP_WINDOW'
  | 'BLOCKED_DIRECT_PERF_STARTUP_RELEASE_IDENTITY'
  | 'BLOCKED_DIRECT_PERF_STARTUP_PROBE'
  | 'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_LOAD'
  | 'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_APPLY';

export interface RetryableStartupTelemetryLatch {
  run(): Promise<boolean>;
  isRecorded(): boolean;
}

/**
 * A write-once latch that does not consume its attempt until a real recorder
 * exists and that clears a failed attempt so a later product trigger can
 * retry. The selected task is captured before the in-flight lock is exposed.
 */
export function createRetryableStartupTelemetryLatch(
  getTask: () => (() => void | Promise<void>) | null,
): RetryableStartupTelemetryLatch {
  let recorded = false;
  let inFlight: Promise<boolean> | null = null;

  return {
    run() {
      if (recorded) return Promise.resolve(true);
      if (inFlight) return inFlight;
      const task = getTask();
      if (!task) return Promise.resolve(false);

      const attempt = Promise.resolve()
        .then(task)
        .then(() => {
          recorded = true;
          return true;
        })
        .catch(() => false)
        .finally(() => {
          inFlight = null;
        });
      inFlight = attempt;
      return attempt;
    },
    isRecorded: () => recorded,
  };
}

/**
 * Starts the independent startup lanes without serialising first-window work
 * behind release identity, direct-probe validation, or persisted settings.
 * Terminal signals are data-free and write-once; early signals are replayed
 * only after the safety lanes have resolved.
 */
export function createStartupCoordinator(
  options: StartupCoordinatorOptions,
): StartupCoordinator {
  const terminal: StartupTerminalState = {
    nativeWindowVisible: false,
    rendererShellCommit: false,
    rendererAppRootVisible: false,
  };
  let started = false;
  let windowReady = false;
  let identityReady = false;
  let probeReady = !options.directMode;
  let terminalPublished = false;
  let failedClosed = false;
  let probe: Awaited<ReturnType<StartupCoordinatorOptions['prepareDirectProbe']>> | null = null;
  let resolveShellCommit!: () => void;
  const shellCommitted = new Promise<void>((resolve) => {
    resolveShellCommit = resolve;
  });

  const publishTerminalIfReady = (): void => {
    if (
      terminalPublished
      || !windowReady
      || !identityReady
      || !probeReady
      || terminal.nativeWindowVisible !== true
      || terminal.rendererShellCommit !== true
      || terminal.rendererAppRootVisible !== true
    ) return;
    terminalPublished = true;
    options.onTerminalReady({ ...terminal });
    probe?.reportTerminal({ ...terminal });
  };

  const failClosedOnce = (error: unknown): void => {
    if (!options.directMode || failedClosed) return;
    failedClosed = true;
    const code = blockerCode(error);
    options.failClosed(
      code === 'BLOCKED_DIRECT_PERF_PROBE_UNEXPECTED'
        ? 'BLOCKED_DIRECT_PERF_STARTUP_ANCILLARY'
        : code,
    );
  };

  return {
    reportTerminal(update) {
      if (update.nativeWindowVisible === true) terminal.nativeWindowVisible = true;
      if (update.rendererShellCommit === true && !terminal.rendererShellCommit) {
        terminal.rendererShellCommit = true;
        resolveShellCommit();
      }
      if (update.rendererAppRootVisible === true) terminal.rendererAppRootVisible = true;
      publishTerminalIfReady();
    },

    async start() {
      if (started) throw new Error('BLOCKED_STARTUP_COORDINATOR_ALREADY_STARTED');
      started = true;

      let windowLane: Promise<void>;
      let identityLane: Promise<unknown>;
      let probeLane: Promise<unknown>;
      let settingsLane: Promise<unknown>;
      // Keep this invocation order stable: tests and runtime evidence use it
      // to prove all safe lanes start before any one of them is awaited. Each
      // invocation is captured independently so a synchronous failure cannot
      // prevent the remaining safe lanes from starting.
      windowLane = invokeStartupLane(
        options.directMode,
        'BLOCKED_DIRECT_PERF_STARTUP_WINDOW',
        options.startWindow,
      );
      identityLane = invokeStartupLane(
        options.directMode,
        'BLOCKED_DIRECT_PERF_STARTUP_RELEASE_IDENTITY',
        options.loadReleaseIdentity,
      );
      probeLane = options.directMode
        ? invokeStartupLane(
          true,
          'BLOCKED_DIRECT_PERF_STARTUP_PROBE',
          options.prepareDirectProbe,
        )
        : Promise.resolve(null);
      settingsLane = invokeStartupLane(
        options.directMode,
        'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_LOAD',
        options.loadSettings,
      );

      const trackedWindow = windowLane.then(() => {
        windowReady = true;
        publishTerminalIfReady();
      });
      const trackedIdentity = identityLane.then(() => {
        identityReady = true;
        publishTerminalIfReady();
      });
      const trackedProbe = probeLane.then((prepared) => {
        if (options.directMode) {
          probe = prepared as Awaited<ReturnType<StartupCoordinatorOptions['prepareDirectProbe']>>;
        }
        probeReady = true;
        publishTerminalIfReady();
      });
      const trackedSettings = settingsLane.then(async (settings) => {
        await shellCommitted;
        await invokeStartupLane(
          options.directMode,
          'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_APPLY',
          () => options.applySettings(settings),
        );
      });

      try {
        await Promise.all([
          trackedWindow,
          trackedIdentity,
          trackedProbe,
          trackedSettings,
        ]);
        publishTerminalIfReady();
        if (!options.directMode) options.recordDefaultTelemetry();
      } catch (error: unknown) {
        failClosedOnce(error);
        throw error;
      }
    },
  };
}

function invokeStartupLane<T>(
  directMode: boolean,
  laneCode: StartupLaneBlockerCode,
  invoke: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return Promise.resolve(invoke()).catch((error: unknown) => {
      throw attributeStartupLaneError(error, directMode, laneCode);
    });
  } catch (error: unknown) {
    return Promise.reject(attributeStartupLaneError(error, directMode, laneCode));
  }
}

function attributeStartupLaneError(
  error: unknown,
  directMode: boolean,
  laneCode: StartupLaneBlockerCode,
): unknown {
  if (!directMode) return error;
  const existingCode = blockerCode(error);
  const code = existingCode === 'BLOCKED_DIRECT_PERF_PROBE_UNEXPECTED'
    ? laneCode
    : existingCode;
  const attributed = new Error(code) as Error & { code: string };
  attributed.code = code;
  return attributed;
}

export async function createDirectPerformanceProbe(options: {
  app: App;
  env: NodeJS.ProcessEnv;
  userDataPath: string;
  releaseIdentity: PackagedReleaseIdentity | null;
  getStartupMilestoneReport?: () => StartupMilestoneReport;
  onFailure: (code: string) => void;
}): Promise<DirectPerformanceProbe> {
  const config = await resolveDirectPerformanceProbeConfig(options);
  if (!config) {
    return { active: false, reportTerminal: () => undefined };
  }
  if (isR22OrNewerCandidate(config.candidate) && !options.getStartupMilestoneReport) {
    blocked('BLOCKED_DIRECT_PERF_STARTUP_DIAGNOSTICS');
  }
  const getStartupMilestoneReport = options.getStartupMilestoneReport ?? (() => {
    blocked('BLOCKED_DIRECT_PERF_STARTUP_DIAGNOSTICS');
  });
  let started = false;
  return {
    active: true,
    reportTerminal(terminal) {
      if (started) return;
      if (
        terminal.nativeWindowVisible !== true
        || terminal.rendererShellCommit !== true
        || terminal.rendererAppRootVisible !== true
        || terminal.completionSignal !== true
      ) return;
      started = true;
      void runProbe(
        config,
        options.app,
        terminal,
        getStartupMilestoneReport,
      ).catch((error: unknown) => {
        options.onFailure(blockerCode(error));
      });
    },
  };
}

export async function resolveDirectPerformanceProbeConfig(options: {
  env: NodeJS.ProcessEnv;
  userDataPath: string;
  releaseIdentity: PackagedReleaseIdentity | null;
}): Promise<DirectProbeConfig | null> {
  const { env, userDataPath, releaseIdentity } = options;
  const active = env.NODE_ENV === 'test'
    && env.COPILOT_E2E === '1'
    && env.COPILOT_DIRECT_PERF === '1';
  if (!active) return null;
  const challenge = env.COPILOT_DIRECT_PERF_CHALLENGE;
  const harnessDigest = env.COPILOT_DIRECT_PERF_HARNESS_DIGEST;
  if (!CHALLENGE.test(String(challenge ?? '')) || !SHA256.test(String(harnessDigest ?? ''))) {
    blocked('BLOCKED_DIRECT_PERF_PROBE_CONFIG');
  }
  if (
    !releaseIdentity
    || releaseIdentity.schemaVersion !== 1
    || !CANDIDATE.test(releaseIdentity.candidate)
    || !SHA256.test(releaseIdentity.sourceSnapshotSha256)
  ) {
    blocked('BLOCKED_DIRECT_PERF_RELEASE_IDENTITY');
  }
  const realUserData = await realpath(userDataPath).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA');
  });
  const userDataStat = await lstat(realUserData);
  if (userDataStat.isSymbolicLink() || !userDataStat.isDirectory()) {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA');
  }
  if (process.platform !== 'win32' && (userDataStat.mode & 0o777) !== 0o700) {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA_MODE');
  }
  const probeDir = path.join(userDataPath, '.copilot-direct-performance-v1');
  const realProbeDir = await realpath(probeDir).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_PROBE_DIR');
  });
  const probeStat = await lstat(realProbeDir);
  if (
    probeStat.isSymbolicLink()
    || !probeStat.isDirectory()
    || path.dirname(realProbeDir) !== realUserData
  ) {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE');
  }
  if (process.platform !== 'win32' && (probeStat.mode & 0o777) !== 0o700) {
    blocked('BLOCKED_DIRECT_PERF_PROBE_DIR_MODE');
  }
  return {
    challenge: challenge as string,
    harnessDigest: harnessDigest as string,
    candidate: releaseIdentity.candidate,
    sourceSnapshotSha256: releaseIdentity.sourceSnapshotSha256,
    probeDir: realProbeDir,
    readyPath: path.join(realProbeDir, READY_FILE),
    collectPath: path.join(realProbeDir, COLLECT_FILE),
    metricsPath: path.join(realProbeDir, METRICS_FILE),
    harnessDir: path.join(realProbeDir, 'harness'),
    harnessHtmlPath: path.join(realProbeDir, 'harness', 'index.html'),
  };
}

async function runProbe(
  config: DirectProbeConfig,
  app: App,
  terminal: DirectProbeTerminal,
  getStartupMilestoneReport: () => StartupMilestoneReport,
): Promise<void> {
  const identity = protocolIdentity(config);
  await writeOncePrivateJson(config.readyPath, config.probeDir, {
    schemaVersion: PROTOCOL_VERSION,
    kind: 'copilot-direct-performance-ready',
    ...identity,
    nativeWindowVisible: terminal.nativeWindowVisible,
    rendererShellCommit: terminal.rendererShellCommit,
    rendererAppRootVisible: terminal.rendererAppRootVisible,
    completionSignal: terminal.completionSignal,
  });

  await waitForCollectCommand(config, identity);
  const startupDiagnostics = isR22OrNewerCandidate(config.candidate)
    ? getStartupMilestoneReport()
    : undefined;
  const processMetrics = app.getAppMetrics();
  const residentSetKb = processMetrics.reduce(
    (sum, metric) => sum + Number(metric.memory.workingSetSize ?? 0),
    0,
  );
  const preKgElectronProcessPids = collectElectronProcessPids(processMetrics);
  const preHarnessBinding = await bindExecutedHarnessFiles(config.harnessDir);
  if (preHarnessBinding.digest !== config.harnessDigest) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_BINDING');
  }
  const kgMeasurement = await measureKnowledgeGraph100(config, app);
  const electronProcessPids = [...new Set([
    ...preKgElectronProcessPids,
    ...kgMeasurement.electronProcessPids,
  ])].sort((left, right) => left - right);
  const postHarnessBinding = await bindExecutedHarnessFiles(config.harnessDir);
  if (
    postHarnessBinding.digest !== preHarnessBinding.digest
    || JSON.stringify(postHarnessBinding) !== JSON.stringify(preHarnessBinding)
  ) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_DRIFT');
  }
  const measuredHarnessDigest = postHarnessBinding.digest;
  await writeOncePrivateJson(config.metricsPath, config.probeDir, {
    schemaVersion: PROTOCOL_VERSION,
    kind: 'copilot-direct-performance-metrics',
    ...identity,
    electronProcessPids,
    app: {
      residentSetKb,
      processCount: processMetrics.length,
    },
    knowledgeGraph100: kgMeasurement.knowledgeGraph100,
    harness: { digest: measuredHarnessDigest },
    ...(startupDiagnostics ? { startupDiagnostics } : {}),
  });
  app.quit();
}

function isR22OrNewerCandidate(candidate: string): boolean {
  const match = /^v6\.2-phase1-candidate-r(\d+)$/.exec(candidate);
  return match !== null && Number(match[1]) >= 22;
}

async function waitForCollectCommand(
  config: DirectProbeConfig,
  identity: ReturnType<typeof protocolIdentity>,
): Promise<void> {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    try {
      const command = await readPrivateJson(config.collectPath, config.probeDir);
      requireExactKeys(command, [
        'schemaVersion', 'kind', 'challenge', 'candidate', 'pid',
      ], 'BLOCKED_DIRECT_PERF_COLLECT_SCHEMA');
      if (
        command.schemaVersion !== PROTOCOL_VERSION
        || command.kind !== 'copilot-direct-performance-collect'
        || command.challenge !== identity.challenge
        || command.candidate !== identity.candidate
        || command.pid !== identity.pid
      ) {
        blocked('BLOCKED_DIRECT_PERF_COLLECT_BINDING');
      }
      return;
    } catch (error: unknown) {
      if (blockerCode(error) !== 'BLOCKED_DIRECT_PERF_RECORD_MISSING') throw error;
    }
    await delay(5);
  }
  blocked('BLOCKED_DIRECT_PERF_COLLECT_TIMEOUT');
}

async function measureKnowledgeGraph100(
  config: DirectProbeConfig,
  app: App,
): Promise<{ knowledgeGraph100: KgMetrics; electronProcessPids: number[] }> {
  const harnessPath = config.harnessHtmlPath;
  const perfWindow = new BrowserWindow({
    width: 1_100,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'copilot-direct-performance',
    },
  });
  perfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  perfWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(harnessPath).href) event.preventDefault();
  });
  perfWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  perfWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  try {
    await perfWindow.loadFile(harnessPath);
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      const value: unknown = await perfWindow.webContents.executeJavaScript(
        `(() => {
          const value = globalThis.__KG_PERF__;
          if (!value || typeof value !== 'object') return null;
          return {
            nodeCount: Number(value.nodeCount),
            edgeCount: Number(value.edgeCount),
            sampleMs: Number(value.sampleMs),
            frames: Number(value.frames),
            fps: Number(value.fps),
          };
        })()`,
        true,
      );
      if (value !== null) {
        const knowledgeGraph100 = validateKgMetrics(value);
        return {
          knowledgeGraph100,
          electronProcessPids: collectElectronProcessPids(app.getAppMetrics()),
        };
      }
      await delay(10);
    }
    blocked('BLOCKED_DIRECT_PERF_KG_TIMEOUT');
  } finally {
    if (!perfWindow.isDestroyed()) perfWindow.destroy();
  }
  return blocked('BLOCKED_DIRECT_PERF_KG_UNREACHABLE');
}

function collectElectronProcessPids(processMetrics: ReturnType<App['getAppMetrics']>): number[] {
  return [...new Set([
    process.pid,
    ...processMetrics.map((metric) => Number(metric.pid)),
  ].filter((pid) => Number.isSafeInteger(pid) && pid > 0))].sort((left, right) => left - right);
}

export async function bindExecutedHarnessFiles(root: string): Promise<ExecutedHarnessBinding> {
  if (!path.isAbsolute(root)) blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  const rootOriginalStat = await lstat(root).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  if (rootOriginalStat.isSymbolicLink() || !rootOriginalStat.isDirectory()) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  }
  const realRoot = await realpath(root).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  const names: ExecutedHarnessFileBinding['logicalName'][] = ['bundle.js', 'index.html'];
  const cssPath = path.join(realRoot, 'bundle.css');
  try {
    const cssStat = await lstat(cssPath);
    if (cssStat.isSymbolicLink() || !cssStat.isFile()) {
      blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
    }
    names.push('bundle.css');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = await Promise.all(names.sort().map(async (logicalName) => (
    stableBindExecutedHarnessFile(realRoot, logicalName)
  )));
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(JSON.stringify(file));
    digest.update('\n');
  }
  return { schemaVersion: 1, files, digest: digest.digest('hex') };
}

async function stableBindExecutedHarnessFile(
  root: string,
  logicalName: ExecutedHarnessFileBinding['logicalName'],
): Promise<ExecutedHarnessFileBinding> {
  const filePath = path.join(root, logicalName);
  const originalStat = await lstat(filePath).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  if (originalStat.isSymbolicLink() || !originalStat.isFile()) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  }
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || contents.byteLength !== before.size
    ) blocked('BLOCKED_DIRECT_PERF_HARNESS_CHANGED');
    return {
      logicalName,
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  } catch (error: unknown) {
    if (isBlocked(error)) throw error;
    return blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validateKgMetrics(value: unknown): KgMetrics {
  requireExactKeys(value, ['nodeCount', 'edgeCount', 'sampleMs', 'frames', 'fps'], 'BLOCKED_DIRECT_PERF_KG_SCHEMA');
  const kg = value as Record<string, unknown>;
  if (
    kg.nodeCount !== 100
    || !Number.isSafeInteger(kg.edgeCount)
    || Number(kg.edgeCount) < 0
    || !Number.isFinite(kg.sampleMs)
    || Number(kg.sampleMs) < 1_500
    || !Number.isSafeInteger(kg.frames)
    || Number(kg.frames) < 1
    || !Number.isFinite(kg.fps)
    || Number(kg.fps) < 0
  ) {
    blocked('BLOCKED_DIRECT_PERF_KG_SCHEMA');
  }
  return {
    nodeCount: Number(kg.nodeCount),
    edgeCount: Number(kg.edgeCount),
    sampleMs: Number(kg.sampleMs),
    frames: Number(kg.frames),
    fps: Number(kg.fps),
  };
}

async function writeOncePrivateJson(
  filePath: string,
  containedBy: string,
  value: Record<string, unknown>,
): Promise<void> {
  const target = await validateContainedTarget(filePath, containedBy);
  await assertAbsent(target);
  const contents = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (contents.byteLength > MAX_RECORD_BYTES) blocked('BLOCKED_DIRECT_PERF_RECORD_TOO_LARGE');
  const temporary = path.join(
    containedBy,
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, privateCreateFlags(), 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    await link(temporary, target);
    await unlink(temporary);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      blocked('BLOCKED_DIRECT_PERF_OUTPUT_EXISTS');
    }
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_WRITE');
  }
  await chmod(target, 0o600);
}

async function readPrivateJson(filePath: string, containedBy: string): Promise<Record<string, unknown>> {
  const target = await validateContainedTarget(filePath, containedBy);
  let stat;
  try {
    stat = await lstat(target);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      blocked('BLOCKED_DIRECT_PERF_RECORD_MISSING');
    }
    blocked('BLOCKED_DIRECT_PERF_RECORD_READ');
  }
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.size < 2
    || stat.size > MAX_RECORD_BYTES
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
  ) {
    blocked('BLOCKED_DIRECT_PERF_RECORD_INVALID');
  }
  let handle;
  try {
    handle = await open(target, privateReadFlags());
    const before = await handle.stat();
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || contents.byteLength !== before.size
    ) blocked('BLOCKED_DIRECT_PERF_RECORD_CHANGED');
    const value: unknown = JSON.parse(contents.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      blocked('BLOCKED_DIRECT_PERF_RECORD_INVALID');
    }
    return value as Record<string, unknown>;
  } catch (error: unknown) {
    if (isBlocked(error)) throw error;
    blocked('BLOCKED_DIRECT_PERF_RECORD_INVALID');
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return blocked('BLOCKED_DIRECT_PERF_RECORD_UNREACHABLE');
}

async function validateContainedTarget(filePath: string, containedBy: string): Promise<string> {
  const realRoot = await realpath(containedBy).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE');
  });
  const target = path.resolve(filePath);
  if (path.dirname(target) !== realRoot) blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE');
  return target;
}

async function assertAbsent(filePath: string): Promise<void> {
  try {
    await lstat(filePath);
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_EXISTS');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    if (isBlocked(error)) throw error;
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_INSPECT');
  }
}

function protocolIdentity(config: DirectProbeConfig) {
  return {
    challenge: config.challenge,
    candidate: config.candidate,
    sourceSnapshotSha256: config.sourceSnapshotSha256,
    pid: process.pid,
  };
}

function requireExactKeys(value: unknown, keys: string[], code: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) blocked(code);
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) blocked(code);
}

function privateCreateFlags(): number {
  return fsConstants.O_WRONLY
    | fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | (fsConstants.O_NOFOLLOW ?? 0);
}

function privateReadFlags(): number {
  return fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blocked(code: string): never {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  throw error;
}

function blockerCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^BLOCKED_[A-Z0-9_]+$/.test(code)
    ? code
    : 'BLOCKED_DIRECT_PERF_PROBE_UNEXPECTED';
}

function isBlocked(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^BLOCKED_[A-Z0-9_]+$/.test(code);
}

export function hashDirectProbeRecord(value: Record<string, unknown>): string {
  return createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
}
