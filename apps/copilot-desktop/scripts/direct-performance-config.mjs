import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import {
  createStartupMilestoneReport,
  STARTUP_MILESTONE_VALIDATION_PROFILES,
} from './performance-config.mjs';

export const DIRECT_PERFORMANCE_PROTOCOL_VERSION = 1;
export const DIRECT_PERFORMANCE_DIR = '.copilot-direct-performance-v1';
export const DIRECT_PERFORMANCE_READY_FILE = 'ready.json';
export const DIRECT_PERFORMANCE_COLLECT_FILE = 'collect.json';
export const DIRECT_PERFORMANCE_METRICS_FILE = 'metrics.json';

const CHALLENGE = /^[a-f0-9]{64}$/;
const CANDIDATE = /^v6\.2-phase1-candidate-r\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 8 * 1024;
const R22_AGGREGATE_RAW_BASENAMES = Object.freeze([
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
]);
const R22_EXECUTABLE_BASENAMES = Object.freeze([
  'njx-copilot-v6',
  'njx-copilot-v6.exe',
]);
const CANDIDATE_BOUND_CONTRACT_KEYS = Object.freeze([
  'contractVersion',
  'candidate',
  'rawSchemaVersion',
  'rawSource',
  'rawBasenames',
  'aggregateBasename',
  'executableBasenames',
  'bindingMode',
]);
const KG_FPS_MAX_DOUBLE_ROUNDING_DELTA = 0.01;

export function createDirectPerformanceChallenge(bytes = randomBytes(32)) {
  const value = Buffer.from(bytes);
  if (value.byteLength !== 32) {
    blocked('BLOCKED_DIRECT_PERF_CHALLENGE', 'Challenge entropy must be exactly 32 bytes');
  }
  return value.toString('hex');
}

export function createR22DirectPerformanceRunBinding({ challenge, outputPath } = {}) {
  if (!CHALLENGE.test(String(challenge ?? ''))) {
    blocked(
      'BLOCKED_DIRECT_PERF_RUN_BINDING',
      'Direct-run challenge must be exactly 32 lowercase-hex bytes',
    );
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    blocked('BLOCKED_DIRECT_PERF_RUN_BINDING', 'Direct-run output path is invalid');
  }
  const rawBasename = path.basename(outputPath);
  const rawIndex = R22_AGGREGATE_RAW_BASENAMES.indexOf(rawBasename);
  if (rawIndex < 0) {
    blocked('BLOCKED_DIRECT_PERF_RUN_BINDING', 'Direct-run output basename is not an exact r22 raw');
  }
  const challengeSha256 = createHash('sha256')
    .update(Buffer.from(challenge, 'hex'))
    .digest('hex');
  return {
    rawBasename,
    ordinal: rawIndex + 1,
    challengeSha256,
  };
}

export function validateDirectPerformanceContractDescriptor(value) {
  requireExactKeys(value, CANDIDATE_BOUND_CONTRACT_KEYS, 'BLOCKED_DIRECT_PERF_CONTRACT');
  if (!isPlainObject(value)) {
    blocked('BLOCKED_DIRECT_PERF_CONTRACT', 'Candidate-bound contract must be a plain object');
  }
  const revision = typeof value.contractVersion === 'string'
    ? /^r([1-9]\d*)-v([1-9]\d*)$/.exec(value.contractVersion)
    : null;
  const candidateRevision = typeof value.candidate === 'string'
    ? /^v6\.2-phase1-candidate-r([1-9]\d*)$/.exec(value.candidate)
    : null;
  if (
    !revision
    || !candidateRevision
    || revision[1] !== candidateRevision[1]
    || typeof value.rawSource !== 'string'
    || typeof value.bindingMode !== 'string'
    || !Number.isSafeInteger(value.rawSchemaVersion)
    || value.rawSchemaVersion < 4
    || value.rawSource
      !== `direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts-${value.contractVersion}`
    || value.bindingMode !== `${value.contractVersion}-complete-candidate-harness-provenance`
  ) {
    blocked('BLOCKED_DIRECT_PERF_CONTRACT', 'Candidate-bound contract identity is invalid');
  }
  if (
    !Array.isArray(value.rawBasenames)
    || value.rawBasenames.length !== 3
    || value.rawBasenames.some((basename, index) => (
      typeof basename !== 'string'
      || !isSafeBasename(basename)
      || basename !== `performance-raw${index + 1}-${value.contractVersion}.json`
    ))
    || new Set(value.rawBasenames).size !== value.rawBasenames.length
    || typeof value.aggregateBasename !== 'string'
    || !isSafeBasename(value.aggregateBasename)
    || value.aggregateBasename !== `performance-aggregate-${value.contractVersion}.json`
    || value.rawBasenames.includes(value.aggregateBasename)
    || !Array.isArray(value.executableBasenames)
    || value.executableBasenames.length !== R22_EXECUTABLE_BASENAMES.length
    || value.executableBasenames.some((basename, index) => (
      typeof basename !== 'string'
      || basename !== R22_EXECUTABLE_BASENAMES[index]
    ))
    || new Set(value.executableBasenames).size !== value.executableBasenames.length
  ) {
    blocked('BLOCKED_DIRECT_PERF_CONTRACT', 'Candidate-bound contract basenames are invalid');
  }
  return Object.freeze({
    contractVersion: value.contractVersion,
    candidate: value.candidate,
    rawSchemaVersion: value.rawSchemaVersion,
    rawSource: value.rawSource,
    rawBasenames: Object.freeze([...value.rawBasenames]),
    aggregateBasename: value.aggregateBasename,
    executableBasenames: Object.freeze([...value.executableBasenames]),
    bindingMode: value.bindingMode,
  });
}

export function createCandidateBoundDirectPerformanceRunBinding(contract, input = {}) {
  const descriptor = validateDirectPerformanceContractDescriptor(contract);
  const { challenge, outputPath } = input;
  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) {
    blocked(
      'BLOCKED_DIRECT_PERF_RUN_BINDING',
      'Direct-run challenge must be exactly 32 lowercase-hex bytes',
    );
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    blocked('BLOCKED_DIRECT_PERF_RUN_BINDING', 'Direct-run output path is invalid');
  }
  const rawBasename = path.basename(outputPath);
  const rawIndex = descriptor.rawBasenames.indexOf(rawBasename);
  if (rawIndex < 0) {
    blocked(
      'BLOCKED_DIRECT_PERF_RUN_BINDING',
      'Direct-run output basename is not an exact candidate-bound raw',
    );
  }
  return {
    rawBasename,
    ordinal: rawIndex + 1,
    challengeSha256: createHash('sha256')
      .update(Buffer.from(challenge, 'hex'))
      .digest('hex'),
  };
}

export async function prepareDirectPerformanceWorkspace(userData) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA', 'Fresh userData must be an absolute path');
  }
  const userDataStat = await safeLstat(userData, 'BLOCKED_DIRECT_PERF_USER_DATA');
  if (userDataStat.isSymbolicLink() || !userDataStat.isDirectory()) {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA', 'Fresh userData must be a real directory');
  }
  if (process.platform !== 'win32' && (userDataStat.mode & 0o777) !== 0o700) {
    blocked('BLOCKED_DIRECT_PERF_USER_DATA_MODE', 'Fresh userData must have mode 0700');
  }
  const realUserData = await realpath(userData);
  const probeDir = path.join(realUserData, DIRECT_PERFORMANCE_DIR);
  try {
    await mkdir(probeDir, { mode: 0o700 });
  } catch (error) {
    blocked(
      error?.code === 'EEXIST'
        ? 'BLOCKED_DIRECT_PERF_WORKSPACE_EXISTS'
        : 'BLOCKED_DIRECT_PERF_WORKSPACE_CREATE',
      'Direct-performance workspace must be newly created',
    );
  }
  await chmod(probeDir, 0o700);
  const harnessDir = path.join(probeDir, 'harness');
  await mkdir(harnessDir, { mode: 0o700 });
  await chmod(harnessDir, 0o700);
  const workspace = {
    userData: realUserData,
    probeDir,
    readyPath: path.join(probeDir, DIRECT_PERFORMANCE_READY_FILE),
    collectPath: path.join(probeDir, DIRECT_PERFORMANCE_COLLECT_FILE),
    metricsPath: path.join(probeDir, DIRECT_PERFORMANCE_METRICS_FILE),
    harnessDir,
    harnessHtmlPath: path.join(harnessDir, 'index.html'),
  };
  for (const target of [workspace.readyPath, workspace.collectPath, workspace.metricsPath]) {
    await assertAbsent(target);
  }
  return workspace;
}

export function createReadyRecord(input) {
  return validateReadyRecord({
    schemaVersion: DIRECT_PERFORMANCE_PROTOCOL_VERSION,
    kind: 'copilot-direct-performance-ready',
    challenge: input?.challenge,
    candidate: input?.candidate,
    sourceSnapshotSha256: input?.sourceSnapshotSha256,
    pid: input?.pid,
    nativeWindowVisible: input?.nativeWindowVisible,
    rendererShellCommit: input?.rendererShellCommit ?? true,
    rendererAppRootVisible: input?.rendererAppRootVisible,
    completionSignal: input?.completionSignal,
  }, input);
}

export function validateReadyRecord(value, expected) {
  requireExactKeys(value, [
    'schemaVersion',
    'kind',
    'challenge',
    'candidate',
    'sourceSnapshotSha256',
    'pid',
    'nativeWindowVisible',
    'rendererShellCommit',
    'rendererAppRootVisible',
    'completionSignal',
  ], 'BLOCKED_DIRECT_PERF_READY_SCHEMA');
  requireProtocolIdentity(value, expected, 'BLOCKED_DIRECT_PERF_READY_BINDING');
  if (
    value.schemaVersion !== DIRECT_PERFORMANCE_PROTOCOL_VERSION
    || value.kind !== 'copilot-direct-performance-ready'
    || value.nativeWindowVisible !== true
    || value.rendererShellCommit !== true
    || value.rendererAppRootVisible !== true
    || value.completionSignal !== true
  ) {
    blocked('BLOCKED_DIRECT_PERF_READY_TERMINAL', 'Ready requires the fixed dual-visible terminal');
  }
  return value;
}

export function createCollectRecord(input) {
  return validateCollectRecord({
    schemaVersion: DIRECT_PERFORMANCE_PROTOCOL_VERSION,
    kind: 'copilot-direct-performance-collect',
    challenge: input?.challenge,
    candidate: input?.candidate,
    pid: input?.pid,
  }, input);
}

export function validateCollectRecord(value, expected) {
  requireExactKeys(value, [
    'schemaVersion', 'kind', 'challenge', 'candidate', 'pid',
  ], 'BLOCKED_DIRECT_PERF_COLLECT_SCHEMA');
  requireChallengeCandidatePid(value, expected, 'BLOCKED_DIRECT_PERF_COLLECT_BINDING');
  if (
    value.schemaVersion !== DIRECT_PERFORMANCE_PROTOCOL_VERSION
    || value.kind !== 'copilot-direct-performance-collect'
  ) {
    blocked('BLOCKED_DIRECT_PERF_COLLECT_SCHEMA', 'Collect command identity is invalid');
  }
  return value;
}

export function validateMetricsRecord(value, expected) {
  const startupDiagnosticsRequired = isR22OrNewerCandidate(expected?.candidate);
  requireExactKeys(value, [
    'schemaVersion',
    'kind',
    'challenge',
    'candidate',
    'sourceSnapshotSha256',
    'pid',
    'electronProcessPids',
    'app',
    'knowledgeGraph100',
    'harness',
    ...(startupDiagnosticsRequired ? ['startupDiagnostics'] : []),
  ], 'BLOCKED_DIRECT_PERF_METRICS_SCHEMA');
  requireProtocolIdentity(value, expected, 'BLOCKED_DIRECT_PERF_METRICS_BINDING');
  if (
    value.schemaVersion !== DIRECT_PERFORMANCE_PROTOCOL_VERSION
    || value.kind !== 'copilot-direct-performance-metrics'
  ) {
    blocked('BLOCKED_DIRECT_PERF_METRICS_SCHEMA', 'Metrics record identity is invalid');
  }
  const electronProcessPids = requireSortedUniquePids(
    value.electronProcessPids,
    'BLOCKED_DIRECT_PERF_METRICS_SCHEMA',
  );
  if (!electronProcessPids.includes(value.pid)) {
    blocked('BLOCKED_DIRECT_PERF_METRICS_SCHEMA', 'Metrics PIDs must include the candidate main PID');
  }
  requireExactKeys(
    value.app,
    ['residentSetKb', 'processCount'],
    'BLOCKED_DIRECT_PERF_METRICS_SCHEMA',
  );
  if (
    !Number.isFinite(value.app.residentSetKb)
    || value.app.residentSetKb < 0
    || !Number.isSafeInteger(value.app.processCount)
    || value.app.processCount < 1
  ) {
    blocked('BLOCKED_DIRECT_PERF_METRICS_SCHEMA', 'App metrics are invalid');
  }
  requireExactKeys(value.knowledgeGraph100, [
    'nodeCount', 'edgeCount', 'sampleMs', 'frames', 'fps',
  ], 'BLOCKED_DIRECT_PERF_METRICS_SCHEMA');
  const kg = value.knowledgeGraph100;
  if (
    kg.nodeCount !== 100
    || !Number.isSafeInteger(kg.edgeCount)
    || kg.edgeCount < 0
    || !Number.isFinite(kg.sampleMs)
    || kg.sampleMs < 1_500
    || !Number.isSafeInteger(kg.frames)
    || kg.frames < 1
    || !Number.isFinite(kg.fps)
    || kg.fps < 0
  ) {
    blocked('BLOCKED_DIRECT_PERF_METRICS_SCHEMA', 'KG100 metrics are invalid');
  }
  validateProducerCoherentKnowledgeGraph(kg, 'BLOCKED_DIRECT_PERF_METRICS_SCHEMA');
  requireExactKeys(value.harness, ['digest'], 'BLOCKED_DIRECT_PERF_METRICS_SCHEMA');
  if (!SHA256.test(String(value.harness.digest ?? '')) || value.harness.digest !== expected?.harnessDigest) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_BINDING', 'Metrics harness digest does not match');
  }
  if (startupDiagnosticsRequired) {
    requireExactKeys(
      value.startupDiagnostics,
      ['clock', 'milestones'],
      'BLOCKED_DIRECT_PERF_METRICS_SCHEMA',
    );
    const validatedDiagnostics = createStartupMilestoneReport(
      value.startupDiagnostics.milestones,
      STARTUP_MILESTONE_VALIDATION_PROFILES.R22_DIRECT_TERMINAL_V1,
    );
    if (canonicalJson(validatedDiagnostics) !== canonicalJson(value.startupDiagnostics)) {
      blocked('BLOCKED_DIRECT_PERF_METRICS_SCHEMA', 'Startup diagnostics are invalid');
    }
  }
  return value;
}

function isR22OrNewerCandidate(candidate) {
  const match = /^v6\.2-phase1-candidate-r(\d+)$/.exec(String(candidate ?? ''));
  return match !== null && Number(match[1]) >= 22;
}

export async function writePrivateJsonOnce({ filePath, containedBy, value }) {
  const context = await validateContainedTarget(filePath, containedBy);
  await assertAbsent(context.target);
  const contents = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (contents.byteLength > MAX_RECORD_BYTES) {
    blocked('BLOCKED_DIRECT_PERF_RECORD_TOO_LARGE', 'Protocol record exceeds the fixed size limit');
  }
  const temporary = path.join(
    context.parent,
    `.${path.basename(context.target)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, privateCreateFlags(), 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    await link(temporary, context.target);
    await unlink(temporary);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      blocked('BLOCKED_DIRECT_PERF_OUTPUT_EXISTS', 'Protocol output is not a fresh regular file');
    }
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_WRITE', 'Cannot publish private protocol output');
  }
  const stat = await safeLstat(context.target, 'BLOCKED_DIRECT_PERF_OUTPUT_WRITE');
  if (stat.isSymbolicLink() || !stat.isFile()) {
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_WRITE', 'Published protocol output is not a regular file');
  }
  const mode = stat.mode & 0o777;
  if (process.platform !== 'win32' && mode !== 0o600) {
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_MODE', 'Protocol output must have mode 0600');
  }
  return {
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
    mode: process.platform === 'win32' ? 0o600 : mode,
  };
}

export async function waitForValidatedRecord({
  filePath,
  containedBy,
  timeoutMs,
  pollMs = 5,
  validate,
  childExited = () => false,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    blocked('BLOCKED_DIRECT_PERF_OBSERVER_CONFIG', 'Record observer timeout is invalid');
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const value = await readPrivateJson({ filePath, containedBy });
      const validated = validate(value);
      return { value: validated, observedAtMs: performance.now() };
    } catch (error) {
      if (error?.code !== 'BLOCKED_DIRECT_PERF_RECORD_MISSING') throw error;
    }
    if (childExited()) {
      blocked('BLOCKED_DIRECT_PERF_CHILD_EXITED', 'Candidate exited before the terminal record');
    }
    await delay(pollMs);
  }
  blocked('BLOCKED_DIRECT_PERF_RECORD_TIMEOUT', 'Timed out waiting for a terminal protocol record');
}

export function collectPidScopedTree(rows, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || !Array.isArray(rows)) {
    blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'PID tree input is invalid');
  }
  const normalized = rows.map((row) => {
    if (!Number.isSafeInteger(row?.pid) || row.pid <= 0 || !Number.isSafeInteger(row?.ppid) || row.ppid < 0) {
      blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'Process-table row is invalid');
    }
    return { pid: row.pid, ppid: row.ppid };
  });
  const result = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of normalized) {
      if (result.has(row.ppid) && !result.has(row.pid)) {
        result.add(row.pid);
        changed = true;
      }
    }
  }
  return [...result].sort((left, right) => left - right);
}

export function createPidTreeTracker(rootPid) {
  const tracked = new Set(requireSortedUniquePids([rootPid], 'BLOCKED_DIRECT_PERF_PID_TREE'));
  return Object.freeze({
    observe(rows) {
      if (!Array.isArray(rows)) {
        blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'Process-table rows are invalid');
      }
      const normalized = rows.map((row) => {
        if (
          !Number.isSafeInteger(row?.pid)
          || row.pid <= 0
          || !Number.isSafeInteger(row?.ppid)
          || row.ppid < 0
        ) {
          blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'Process-table row is invalid');
        }
        return { pid: row.pid, ppid: row.ppid };
      });
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of normalized) {
          if (tracked.has(row.ppid) && !tracked.has(row.pid)) {
            tracked.add(row.pid);
            changed = true;
          }
        }
      }
      return [...tracked].sort((left, right) => left - right);
    },
    include(pids) {
      for (const pid of requireSortedUniquePids(pids, 'BLOCKED_DIRECT_PERF_PID_TREE')) {
        tracked.add(pid);
      }
      return [...tracked].sort((left, right) => left - right);
    },
    snapshot() {
      return [...tracked].sort((left, right) => left - right);
    },
  });
}

export function assertPidScopedTreeGone({ trackedPids, rows }) {
  if (!Array.isArray(trackedPids) || !Array.isArray(rows)) {
    blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'PID cleanup evidence is invalid');
  }
  const tracked = requireSortedUniquePids(
    [...new Set(trackedPids)].sort((left, right) => left - right),
    'BLOCKED_DIRECT_PERF_PID_TREE',
  );
  const alive = new Set(rows.map((row) => {
    if (!Number.isSafeInteger(row?.pid) || row.pid <= 0) {
      blocked('BLOCKED_DIRECT_PERF_PID_TREE', 'Process-table row is invalid');
    }
    return row.pid;
  }));
  const remainingPids = tracked.filter((pid) => alive.has(pid));
  return { trackedPids: tracked, remainingPids, pass: remainingPids.length === 0 };
}

const R22_CANDIDATE = 'v6.2-phase1-candidate-r22';
const R22_RAW_SOURCE = 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts';
const AGGREGATE_RECORD_CODE = 'BLOCKED_DIRECT_PERF_AGGREGATE_RUN';
const AGGREGATE_BINDING_CODE = 'BLOCKED_DIRECT_PERF_AGGREGATE_BINDING';
const R22_VALIDATION_DESCRIPTOR = Object.freeze({
  contractVersion: 'r22-v3',
  candidate: R22_CANDIDATE,
  rawSchemaVersion: 3,
  rawSource: R22_RAW_SOURCE,
  rawBasenames: R22_AGGREGATE_RAW_BASENAMES,
  aggregateBasename: 'performance-aggregate-r22.json',
  executableBasenames: R22_EXECUTABLE_BASENAMES,
  bindingMode: 'r22-complete-candidate-harness-provenance',
});

export function aggregateDirectPerformanceRuns(runs) {
  const composedAtMs = Date.now();
  if (!Array.isArray(runs) || runs.length !== R22_AGGREGATE_RAW_BASENAMES.length) {
    blocked('BLOCKED_DIRECT_PERF_AGGREGATE_COUNT', 'Direct performance aggregate requires exactly three runs');
  }

  const validatedRuns = runs.map((pair, index) => (
    validateRealAggregatePair(
      pair,
      R22_AGGREGATE_RAW_BASENAMES[index],
      composedAtMs,
      R22_VALIDATION_DESCRIPTOR,
    )
  ));
  const challengeHashes = new Set(
    validatedRuns.map(({ runBinding }) => runBinding.challengeSha256),
  );
  const captureTimesStrictlyIncrease = validatedRuns.every((run, index) => (
    index === 0 || validatedRuns[index - 1].capturedAtMs < run.capturedAtMs
  ));
  if (
    challengeHashes.size !== R22_AGGREGATE_RAW_BASENAMES.length
    || !captureTimesStrictlyIncrease
  ) {
    blocked(
      AGGREGATE_BINDING_CODE,
      'Direct performance runs require distinct challenges and strictly increasing capture times',
    );
  }
  const candidateStable = validatedRuns.every(({ candidateBinding }) => (
    canonicalJson(candidateBinding) === canonicalJson(validatedRuns[0].candidateBinding)
  ));
  const harnessStable = validatedRuns.every(({ harness }) => (
    canonicalJson(harness) === canonicalJson(validatedRuns[0].harness)
  ));
  const bindingsStable = candidateStable && harnessStable;
  const rawRuns = validatedRuns.map(({ raw, capturedAt, runBinding, derived }) => ({
    raw,
    capturedAt,
    runBinding,
    ...derived,
  }));
  const durations = rawRuns
    .map((run) => run.directSpawnLaunchMs)
    .sort((left, right) => left - right);
  const thresholdExclusiveMs = 2_000;

  return {
    method: 'direct-spawn-write-once-v1',
    runCount: R22_AGGREGATE_RAW_BASENAMES.length,
    rawRuns,
    bindingMode: 'r22-complete-candidate-harness-provenance',
    binding: {
      candidateBinding: validatedRuns[0].candidateBinding,
      harness: validatedRuns[0].harness,
    },
    bindingsStable,
    medianDirectSpawnLaunchMs: durations[1],
    maxDirectSpawnLaunchMs: durations[2],
    thresholdExclusiveMs,
    pass: bindingsStable && rawRuns.every((run) => run.pass),
  };
}

export function aggregateCandidateBoundDirectPerformanceRawBytes(contract, rawInputs) {
  const descriptor = validateDirectPerformanceContractDescriptor(contract);
  const composedAtMs = Date.now();
  if (!Array.isArray(rawInputs) || rawInputs.length !== descriptor.rawBasenames.length) {
    blocked(
      'BLOCKED_DIRECT_PERF_AGGREGATE_COUNT',
      'Candidate-bound performance aggregate requires exactly three raw byte inputs',
    );
  }
  const rawByteBindings = [];
  const validatedRuns = rawInputs.map((input, index) => {
    requireExactKeys(input, ['basename', 'bytes'], AGGREGATE_RECORD_CODE);
    const expectedBasename = descriptor.rawBasenames[index];
    if (input.basename !== expectedBasename || !Buffer.isBuffer(input.bytes)) {
      blocked(
        AGGREGATE_RECORD_CODE,
        'Candidate-bound raw bytes must use exact ordered basenames and Buffer authority',
      );
    }
    const parsed = parseCanonicalAggregateRawBytes(input.bytes);
    rawByteBindings.push({
      basename: expectedBasename,
      ordinal: index + 1,
      bytes: input.bytes.byteLength,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
    });
    return {
      raw: expectedBasename,
      ...validateRealAggregateRecord(
        parsed,
        expectedBasename,
        composedAtMs,
        descriptor,
      ),
    };
  });
  const challengeHashes = new Set(
    validatedRuns.map(({ runBinding }) => runBinding.challengeSha256),
  );
  const captureTimesStrictlyIncrease = validatedRuns.every((run, index) => (
    index === 0 || validatedRuns[index - 1].capturedAtMs < run.capturedAtMs
  ));
  if (
    challengeHashes.size !== descriptor.rawBasenames.length
    || !captureTimesStrictlyIncrease
  ) {
    blocked(
      AGGREGATE_BINDING_CODE,
      'Direct performance runs require distinct challenges and strictly increasing capture times',
    );
  }
  const candidateStable = validatedRuns.every(({ candidateBinding }) => (
    canonicalJson(candidateBinding) === canonicalJson(validatedRuns[0].candidateBinding)
  ));
  const harnessStable = validatedRuns.every(({ harness }) => (
    canonicalJson(harness) === canonicalJson(validatedRuns[0].harness)
  ));
  const bindingsStable = candidateStable && harnessStable;
  const rawRuns = validatedRuns.map(({ raw, capturedAt, runBinding, derived }) => ({
    raw,
    capturedAt,
    runBinding,
    ...derived,
  }));
  const durations = rawRuns
    .map((run) => run.directSpawnLaunchMs)
    .sort((left, right) => left - right);
  const thresholdExclusiveMs = 2_000;
  return {
    schemaVersion: 1,
    contractVersion: descriptor.contractVersion,
    candidate: descriptor.candidate,
    method: 'direct-spawn-write-once-v1',
    runCount: descriptor.rawBasenames.length,
    rawByteBindings,
    rawRuns,
    bindingMode: descriptor.bindingMode,
    binding: {
      candidateBinding: validatedRuns[0].candidateBinding,
      harness: validatedRuns[0].harness,
    },
    bindingsStable,
    medianDirectSpawnLaunchMs: durations[1],
    maxDirectSpawnLaunchMs: durations[2],
    thresholdExclusiveMs,
    pass: bindingsStable && rawRuns.every((run) => run.pass),
  };
}

function parseCanonicalAggregateRawBytes(bytes) {
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    blocked(AGGREGATE_RECORD_CODE, 'Candidate-bound raw bytes are not valid JSON');
  }
  const canonical = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  if (!canonical.equals(bytes)) {
    blocked(AGGREGATE_RECORD_CODE, 'Candidate-bound raw bytes are not canonical pretty JSON');
  }
  return record;
}

function validateRealAggregatePair(pair, expectedRaw, composedAtMs, descriptor) {
  requireExactKeys(pair, ['raw', 'record'], AGGREGATE_RECORD_CODE);
  if (pair.raw !== expectedRaw || !isSafeBasename(pair.raw)) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct performance raw names must be exact, ordered r22 basenames');
  }
  const validated = validateRealAggregateRecord(
    pair.record,
    pair.raw,
    composedAtMs,
    descriptor,
  );
  return { raw: pair.raw, ...validated };
}

function validateRealAggregateRecord(record, raw, composedAtMs, descriptor) {
  requireExactKeys(record, [
    'schemaVersion',
    'capturedAt',
    'source',
    'runtime',
    'harness',
    'evidence',
    'candidateBinding',
    'app',
    'startup',
    'runtimeProbe',
    'knowledgeGraph100',
    'thresholds',
    'processCleanup',
    'pass',
  ], AGGREGATE_RECORD_CODE);
  const capturedAt = record.capturedAt;
  const capturedAtMs = parseCanonicalIsoTimestamp(capturedAt);
  if (
    record.schemaVersion !== descriptor.rawSchemaVersion
    || record.source !== descriptor.rawSource
    || capturedAtMs === null
    || capturedAtMs > composedAtMs
    || typeof record.pass !== 'boolean'
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct performance real record identity is invalid');
  }

  const candidateBinding = validateAggregateCandidateBinding(
    record.candidateBinding,
    descriptor,
  );
  const harness = validateAggregateHarness(record.harness);
  validateAggregateRuntime(record.runtime, candidateBinding);
  validateAggregateEvidence(record.evidence, raw, harness.executedHarnessBinding);
  const app = validateAggregateApp(record.app);
  const startup = validateAggregateStartup(record.startup, app.directSpawnLaunchMs);
  const runBinding = validateAggregateRuntimeProbe(record.runtimeProbe, raw, descriptor);
  const kg = validateAggregateKnowledgeGraph(record.knowledgeGraph100);
  validateAggregateThresholds(record.thresholds);
  const cleanup = validateAggregateProcessCleanup(record.processCleanup);

  const truthfulRunnerPass = app.directSpawnLaunchMs < 2_000
    && app.residentSetMb < 500
    && kg.nodeCount === 100
    && kg.fps >= 30
    && cleanup.pass;
  if (record.pass !== truthfulRunnerPass) {
    blocked(AGGREGATE_RECORD_CODE, 'Nested direct performance PASS is not derived from its real record');
  }

  const terminal = Object.values(startup.terminal).every((value) => value === true);
  const processTreeZero = cleanup.remainingPidCount === 0 && cleanup.pass;
  const sampleComplete = kg.sampleMs >= 1_500;
  return {
    candidateBinding,
    harness,
    capturedAt,
    capturedAtMs,
    runBinding,
    derived: {
      directSpawnLaunchMs: app.directSpawnLaunchMs,
      residentSetMb: app.residentSetMb,
      nodeCount: kg.nodeCount,
      fps: kg.fps,
      sampleMs: kg.sampleMs,
      terminal,
      processTreeZero,
      rawPass: record.pass,
      pass: app.directSpawnLaunchMs < 2_000
        && app.residentSetMb < 500
        && kg.nodeCount === 100
        && kg.fps >= 30
        && sampleComplete
        && terminal
        && processTreeZero
        && record.pass,
    },
  };
}

function validateAggregateRuntime(runtime, candidateBinding) {
  requireExactKeys(runtime, [
    'mode', 'launchBinding', 'executable', 'skipBuild',
  ], AGGREGATE_RECORD_CODE);
  if (
    runtime.mode !== 'packaged'
    || runtime.launchBinding !== 'executablePath'
    || runtime.skipBuild !== true
    || canonicalJson(runtime.executable) !== canonicalJson(candidateBinding.executable)
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct performance runtime is not the bound packaged skip-build candidate');
  }
}

function validateAggregateEvidence(evidence, raw, executedHarnessBinding) {
  requireExactKeys(evidence, [
    'outputTarget', 'outputMode', 'preservedHarness',
  ], AGGREGATE_BINDING_CODE);
  requireExactKeys(evidence.outputTarget, [
    'basename', 'pathScope',
  ], AGGREGATE_BINDING_CODE);
  requireExactKeys(evidence.preservedHarness, [
    'directoryBasename', 'files', 'binding',
  ], AGGREGATE_BINDING_CODE);
  if (
    evidence.outputTarget.basename !== raw
    || evidence.outputTarget.pathScope !== 'host-local-redacted'
    || evidence.outputMode !== 'external-non-overwriting'
    || evidence.preservedHarness.directoryBasename !== raw
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'External raw evidence is not rebound to the exact ordered basename');
  }
  const preservedBinding = validateAggregateExecutedHarness(
    evidence.preservedHarness.binding,
  );
  if (
    canonicalJson(evidence.preservedHarness.files) !== canonicalJson(executedHarnessBinding.files)
    || canonicalJson(preservedBinding) !== canonicalJson(executedHarnessBinding)
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Preserved harness evidence does not rebind to the executed files');
  }
}

function validateAggregateApp(app) {
  requireExactKeys(app, [
    'launchMs',
    'outerControllerLaunchMs',
    'directSpawnLaunchMs',
    'residentSetMb',
    'processCount',
  ], AGGREGATE_RECORD_CODE);
  if (
    !isNonnegativeFinite(app.launchMs)
    || app.outerControllerLaunchMs !== app.launchMs
    || app.directSpawnLaunchMs !== app.launchMs
    || !isNonnegativeFinite(app.residentSetMb)
    || !Number.isSafeInteger(app.processCount)
    || app.processCount < 1
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct performance app metrics or launch mirrors are invalid');
  }
  return app;
}

function validateAggregateStartup(startup, directSpawnLaunchMs) {
  requireExactKeys(startup, [
    'method',
    'gateClock',
    'internalClockRole',
    'readyObservedAtControllerMs',
    'terminal',
    'diagnostics',
    'transport',
  ], AGGREGATE_RECORD_CODE);
  requireExactKeys(startup.terminal, [
    'nativeWindowVisible',
    'rendererShellCommit',
    'rendererAppRootVisible',
    'completionSignal',
  ], AGGREGATE_RECORD_CODE);
  requireExactKeys(startup.diagnostics, [
    'clock', 'milestones',
  ], AGGREGATE_RECORD_CODE);
  requireExactKeys(startup.transport, [
    'type', 'challengeRedacted', 'pathsRedacted',
  ], AGGREGATE_RECORD_CODE);
  if (
    startup.method !== 'direct-spawn-write-once-v1'
    || startup.gateClock !== 'controller-before-direct-spawn-through-first-validated-ready-observation'
    || startup.internalClockRole !== 'diagnostic-only-never-gating'
    || startup.readyObservedAtControllerMs !== directSpawnLaunchMs
    || startup.transport.type !== 'fresh-profile-write-once-files'
    || startup.transport.challengeRedacted !== true
    || startup.transport.pathsRedacted !== true
    || Object.values(startup.terminal).some((value) => typeof value !== 'boolean')
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct startup method, mirrors, terminal, or transport is invalid');
  }
  const diagnostics = createStartupMilestoneReport(
    startup.diagnostics.milestones,
    STARTUP_MILESTONE_VALIDATION_PROFILES.R22_DIRECT_TERMINAL_V1,
  );
  if (canonicalJson(diagnostics) !== canonicalJson(startup.diagnostics)) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct startup diagnostics are invalid');
  }
  return startup;
}

function validateAggregateRuntimeProbe(runtimeProbe, expectedRaw, descriptor) {
  requireExactKeys(runtimeProbe, [
    'collectPublishedAfterLaunchFreeze',
    'appMetricsCollectedBeforeKg',
    'sameCandidatePid',
    'metricsObservedAfterGateMs',
    'runBinding',
  ], AGGREGATE_RECORD_CODE);
  requireExactKeys(runtimeProbe.runBinding, [
    'rawBasename', 'ordinal', 'challengeSha256',
  ], AGGREGATE_RECORD_CODE);
  const expectedOrdinal = descriptor.rawBasenames.indexOf(expectedRaw) + 1;
  const challengeSha256 = runtimeProbe.runBinding.challengeSha256;
  const challengeSha256Invalid = descriptor === R22_VALIDATION_DESCRIPTOR
    ? !SHA256.test(String(challengeSha256 ?? ''))
    : typeof challengeSha256 !== 'string' || !SHA256.test(challengeSha256);
  if (
    runtimeProbe.collectPublishedAfterLaunchFreeze !== true
    || runtimeProbe.appMetricsCollectedBeforeKg !== true
    || runtimeProbe.sameCandidatePid !== true
    || !isNonnegativeFinite(runtimeProbe.metricsObservedAfterGateMs)
    || runtimeProbe.runBinding.rawBasename !== expectedRaw
    || runtimeProbe.runBinding.ordinal !== expectedOrdinal
    || challengeSha256Invalid
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct runtime probe ordering or candidate binding is invalid');
  }
  return {
    rawBasename: runtimeProbe.runBinding.rawBasename,
    ordinal: runtimeProbe.runBinding.ordinal,
    challengeSha256,
  };
}

function validateAggregateKnowledgeGraph(kg) {
  requireExactKeys(kg, [
    'nodeCount', 'edgeCount', 'sampleMs', 'frames', 'fps',
  ], AGGREGATE_RECORD_CODE);
  if (
    !Number.isSafeInteger(kg.nodeCount)
    || kg.nodeCount < 0
    || !Number.isSafeInteger(kg.edgeCount)
    || kg.edgeCount < 0
    || !isNonnegativeFinite(kg.sampleMs)
    || !Number.isSafeInteger(kg.frames)
    || kg.frames < 1
    || !isNonnegativeFinite(kg.fps)
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Knowledge Graph metrics are invalid');
  }
  validateProducerCoherentKnowledgeGraph(kg, AGGREGATE_RECORD_CODE);
  return kg;
}

function validateAggregateThresholds(thresholds) {
  requireExactKeys(thresholds, [
    'launchUnderMs', 'memoryUnderMb', 'kgFpsAtLeast', 'kgNodeCount',
  ], AGGREGATE_RECORD_CODE);
  if (
    thresholds.launchUnderMs !== 2_000
    || thresholds.memoryUnderMb !== 500
    || thresholds.kgFpsAtLeast !== 30
    || thresholds.kgNodeCount !== 100
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Direct performance thresholds are not the fixed release thresholds');
  }
}

function validateAggregateProcessCleanup(cleanup) {
  requireExactKeys(cleanup, [
    'trackedPidCount', 'remainingPidCount', 'pass',
  ], AGGREGATE_RECORD_CODE);
  if (
    !Number.isSafeInteger(cleanup.trackedPidCount)
    || cleanup.trackedPidCount < 1
    || !Number.isSafeInteger(cleanup.remainingPidCount)
    || cleanup.remainingPidCount < 0
    || cleanup.remainingPidCount > cleanup.trackedPidCount
    || cleanup.pass !== (cleanup.remainingPidCount === 0)
  ) {
    blocked(AGGREGATE_RECORD_CODE, 'Final process-tree evidence is invalid');
  }
  return cleanup;
}

function validateAggregateCandidateBinding(candidateBinding, descriptor) {
  requireExactKeys(candidateBinding, [
    'candidate', 'executable', 'appAsar', 'releaseIdentity', 'sourceSnapshot',
  ], AGGREGATE_BINDING_CODE);
  if (candidateBinding.candidate !== descriptor.candidate) {
    blocked(
      AGGREGATE_BINDING_CODE,
      descriptor === R22_VALIDATION_DESCRIPTOR
        ? 'Aggregate requires the exact r22 candidate'
        : 'Aggregate requires the exact candidate-bound contract candidate',
    );
  }
  for (const name of ['executable', 'appAsar', 'releaseIdentity']) {
    validateAggregateArtifact(candidateBinding[name], name);
  }
  requireExactKeys(candidateBinding.sourceSnapshot, [
    'basename',
    'pathScope',
    'bytes',
    'sha256',
    'fileCount',
    'algorithm',
    'manifest',
    'canonicalManifest',
  ], AGGREGATE_BINDING_CODE);
  validateAggregateArtifact(
    {
      basename: candidateBinding.sourceSnapshot.basename,
      pathScope: candidateBinding.sourceSnapshot.pathScope,
      bytes: candidateBinding.sourceSnapshot.bytes,
      sha256: candidateBinding.sourceSnapshot.sha256,
    },
    'sourceSnapshot',
  );
  if (
    !Number.isSafeInteger(candidateBinding.sourceSnapshot.fileCount)
    || candidateBinding.sourceSnapshot.fileCount < 1
    || candidateBinding.sourceSnapshot.algorithm !== 'sha256-null-delimited-relative-path-and-bytes-v1'
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Source snapshot binding is incomplete');
  }
  validateAggregateArtifact(candidateBinding.sourceSnapshot.manifest, 'sourceSnapshot manifest');
  validateAggregateArtifact(
    candidateBinding.sourceSnapshot.canonicalManifest,
    'sourceSnapshot canonical manifest',
  );
  if (
    !descriptor.executableBasenames.includes(candidateBinding.executable.basename)
    || candidateBinding.appAsar.basename !== 'app.asar'
    || candidateBinding.releaseIdentity.basename !== 'release-identity.exact.json'
    || candidateBinding.sourceSnapshot.basename !== 'source-snapshot'
    || candidateBinding.sourceSnapshot.manifest.basename !== 'source-snapshot-inputs.json'
    || candidateBinding.sourceSnapshot.canonicalManifest.basename !== 'CANONICAL-MANIFEST.json'
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Candidate artifact basenames are not the exact reviewed identities');
  }
  return candidateBinding;
}

function validateAggregateArtifact(artifact, name) {
  requireExactKeys(artifact, [
    'basename', 'pathScope', 'bytes', 'sha256',
  ], AGGREGATE_BINDING_CODE);
  if (
    !isSafeBasename(artifact.basename)
    || artifact.pathScope !== 'host-local-redacted'
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes < 1
    || !SHA256.test(String(artifact.sha256 ?? ''))
  ) {
    blocked(AGGREGATE_BINDING_CODE, `Candidate ${name} binding is invalid`);
  }
  return artifact;
}

function validateAggregateHarness(harness) {
  requireExactKeys(harness, [
    'sourceMode',
    'authoritativeExecutedBuild',
    'executedHarnessBinding',
    'generatedEntry',
    'inputProvenance',
  ], AGGREGATE_BINDING_CODE);
  if (harness.sourceMode !== 'snapshot-component-with-resolved-installed-inputs') {
    blocked(AGGREGATE_BINDING_CODE, 'Aggregate harness must use the immutable snapshot component');
  }
  const authoritative = validateAggregateAuthoritativeBuild(
    harness.authoritativeExecutedBuild,
  );
  const executed = validateAggregateExecutedHarness(harness.executedHarnessBinding);
  const generatedEntry = validateAggregateGeneratedEntry(harness.generatedEntry);
  validateAggregateProvenance(harness.inputProvenance, generatedEntry);
  rebindAuthoritativeHarness(authoritative, executed);
  return harness;
}

function validateAggregateAuthoritativeBuild(binding) {
  requireExactKeys(binding, [
    'authority', 'source', 'files', 'digest',
  ], AGGREGATE_BINDING_CODE);
  if (
    binding.authority !== 'authoritative-executed-build-artifacts'
    || binding.source !== 'esbuild-returned-output-bytes'
    || !Array.isArray(binding.files)
    || !SHA256.test(String(binding.digest ?? ''))
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Authoritative executed build binding is invalid');
  }
  const names = binding.files.map((file) => file?.basename);
  const expectedNames = names.includes('bundle.css')
    ? ['bundle.css', 'bundle.js']
    : ['bundle.js'];
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    blocked(AGGREGATE_BINDING_CODE, 'Authoritative build files are incomplete or noncanonical');
  }
  for (const file of binding.files) {
    requireExactKeys(file, ['basename', 'bytes', 'sha256'], AGGREGATE_BINDING_CODE);
    if (
      !expectedNames.includes(file.basename)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1
      || !SHA256.test(String(file.sha256 ?? ''))
    ) {
      blocked(AGGREGATE_BINDING_CODE, 'Authoritative build file is invalid');
    }
  }
  if (digestAuthoritativeHarnessFiles(binding.files) !== binding.digest) {
    blocked(AGGREGATE_BINDING_CODE, 'Authoritative build digest is not self-consistent');
  }
  return binding;
}

function validateAggregateGeneratedEntry(generatedEntry) {
  requireExactKeys(generatedEntry, [
    'logicalName', 'sourcefile', 'bytes', 'sha256',
  ], AGGREGATE_BINDING_CODE);
  if (
    generatedEntry.logicalName !== 'copilot-kg-performance-entry.tsx'
    || generatedEntry.sourcefile !== generatedEntry.logicalName
    || !Number.isSafeInteger(generatedEntry.bytes)
    || generatedEntry.bytes < 1
    || !SHA256.test(String(generatedEntry.sha256 ?? ''))
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Generated entry binding is invalid');
  }
  return generatedEntry;
}

function validateAggregateProvenance(provenance, generatedEntry) {
  requireExactKeys(provenance, [
    'authority',
    'note',
    'component',
    'dependencies',
    'buildInputs',
    'snapshotPackageLock',
  ], AGGREGATE_BINDING_CODE);
  requireExactKeys(provenance.component, [
    'source', 'logicalPath', 'bytes', 'sha256',
  ], AGGREGATE_BINDING_CODE);
  requireExactKeys(provenance.dependencies, [
    'source', 'inputCount', 'digest',
  ], AGGREGATE_BINDING_CODE);
  requireExactKeys(provenance.buildInputs, [
    'inputCount', 'digest', 'generatedEntry',
  ], AGGREGATE_BINDING_CODE);
  const packageLockKeys = provenance.snapshotPackageLock?.present === true
    ? ['present', 'bytes', 'sha256']
    : ['present'];
  requireExactKeys(
    provenance.snapshotPackageLock,
    packageLockKeys,
    AGGREGATE_BINDING_CODE,
  );

  const expectedNote = 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild';
  if (
    provenance.authority !== 'non-authoritative-post-build-provenance'
    || provenance.note !== expectedNote
    || provenance.component.source !== 'candidate-snapshot'
    || provenance.component.logicalPath
      !== 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx'
    || !Number.isSafeInteger(provenance.component.bytes)
    || provenance.component.bytes < 1
    || !SHA256.test(String(provenance.component.sha256 ?? ''))
    || provenance.dependencies.source !== 'resolved-installed-inputs'
    || !Number.isSafeInteger(provenance.dependencies.inputCount)
    || provenance.dependencies.inputCount < 1
    || !SHA256.test(String(provenance.dependencies.digest ?? ''))
    || !Number.isSafeInteger(provenance.buildInputs.inputCount)
    || provenance.buildInputs.inputCount < 1
    || !SHA256.test(String(provenance.buildInputs.digest ?? ''))
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Harness provenance binding is invalid');
  }
  const buildGeneratedEntry = validateAggregateGeneratedEntry(
    provenance.buildInputs.generatedEntry,
  );
  if (canonicalJson(buildGeneratedEntry) !== canonicalJson(generatedEntry)) {
    blocked(AGGREGATE_BINDING_CODE, 'Generated entry provenance does not match');
  }
  const packageLock = provenance.snapshotPackageLock;
  if (
    typeof packageLock.present !== 'boolean'
    || (packageLock.present === true && (
      !Number.isSafeInteger(packageLock.bytes)
      || packageLock.bytes < 1
      || !SHA256.test(String(packageLock.sha256 ?? ''))
    ))
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Package-lock provenance binding is invalid');
  }
}

function validateAggregateExecutedHarness(binding) {
  requireExactKeys(binding, [
    'schemaVersion', 'files', 'digest',
  ], AGGREGATE_BINDING_CODE);
  if (
    binding.schemaVersion !== 1
    || !Array.isArray(binding.files)
    || !SHA256.test(String(binding.digest ?? ''))
  ) {
    blocked(AGGREGATE_BINDING_CODE, 'Executed harness binding is invalid');
  }
  const names = binding.files.map((file) => file?.logicalName);
  const expectedNames = names.includes('bundle.css')
    ? ['bundle.css', 'bundle.js', 'index.html']
    : ['bundle.js', 'index.html'];
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    blocked(AGGREGATE_BINDING_CODE, 'Executed harness files are incomplete or noncanonical');
  }
  const hash = createHash('sha256');
  for (const file of binding.files) {
    requireExactKeys(file, [
      'logicalName', 'bytes', 'sha256',
    ], AGGREGATE_BINDING_CODE);
    if (
      !expectedNames.includes(file.logicalName)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1
      || !SHA256.test(String(file.sha256 ?? ''))
    ) {
      blocked(AGGREGATE_BINDING_CODE, 'Executed harness file is invalid');
    }
    hash.update(JSON.stringify({
      logicalName: file.logicalName,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
    hash.update('\n');
  }
  if (hash.digest('hex') !== binding.digest) {
    blocked(AGGREGATE_BINDING_CODE, 'Executed harness digest is not self-consistent');
  }
  return binding;
}

function rebindAuthoritativeHarness(authoritative, executed) {
  const executedByName = new Map(
    executed.files.map((file) => [file.logicalName, file]),
  );
  for (const file of authoritative.files) {
    const executedFile = executedByName.get(file.basename);
    if (
      !executedFile
      || executedFile.bytes !== file.bytes
      || executedFile.sha256 !== file.sha256
    ) {
      blocked(AGGREGATE_BINDING_CODE, 'Authoritative build bytes do not rebind to executed harness files');
    }
  }
}

function digestAuthoritativeHarnessFiles(files) {
  const hash = createHash('sha256');
  const bindings = files.map((file) => ({
    logicalPath: file.basename,
    bytes: file.bytes,
    sha256: file.sha256,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const binding of bindings) {
    hash.update(JSON.stringify(binding));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function validateProducerCoherentKnowledgeGraph(kg, code) {
  if (kg.sampleMs !== round2(kg.sampleMs) || kg.fps !== round2(kg.fps)) {
    blocked(code, 'Knowledge Graph sample and FPS must be producer-canonical round2 values');
  }
  const expectedFps = round2(kg.frames * 1_000 / kg.sampleMs);
  const delta = Math.abs(kg.fps - expectedFps);
  const comparisonEpsilon = Number.EPSILON * Math.max(
    1,
    Math.abs(kg.fps),
    Math.abs(expectedFps),
  );
  if (
    !Number.isFinite(expectedFps)
    || !Number.isFinite(delta)
    || delta - KG_FPS_MAX_DOUBLE_ROUNDING_DELTA > comparisonEpsilon
  ) {
    blocked(code, 'Knowledge Graph FPS is not coherent with frames and sample duration');
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function isSafeBasename(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('/')
    && !value.includes('\\')
    && value !== '.'
    && value !== '..'
    && path.posix.basename(value) === value
    && path.win32.basename(value) === value;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonnegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createSanitizedDirectChildEnv(parentEnv, input) {
  if (
    !CHALLENGE.test(String(input?.challenge ?? ''))
    || !SHA256.test(String(input?.harnessDigest ?? ''))
  ) {
    blocked('BLOCKED_DIRECT_PERF_CHILD_ENV', 'Direct child bindings are invalid');
  }
  const allowed = [
    'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
    'SystemRoot', 'WINDIR', 'ComSpec',
  ];
  const env = {};
  for (const key of allowed) {
    if (typeof parentEnv?.[key] === 'string') env[key] = parentEnv[key];
  }
  return {
    ...env,
    NODE_ENV: 'test',
    COPILOT_E2E: '1',
    COPILOT_DIRECT_PERF: '1',
    COPILOT_DIRECT_PERF_CHALLENGE: input.challenge,
    COPILOT_DIRECT_PERF_HARNESS_DIGEST: input.harnessDigest,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  };
}

export function formatDirectPerformanceBlocker(error) {
  const code = typeof error?.code === 'string' && /^BLOCKED_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'BLOCKED_DIRECT_PERF_UNEXPECTED';
  return `${code}: direct-performance lane failed\n`;
}

async function readPrivateJson({ filePath, containedBy }) {
  const context = await validateContainedTarget(filePath, containedBy);
  let stat;
  try {
    stat = await lstat(context.target);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      blocked('BLOCKED_DIRECT_PERF_RECORD_MISSING', 'Protocol record is not present');
    }
    blocked('BLOCKED_DIRECT_PERF_RECORD_READ', 'Cannot inspect protocol record');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > MAX_RECORD_BYTES) {
    blocked('BLOCKED_DIRECT_PERF_RECORD_INVALID', 'Protocol record must be a bounded regular file');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) {
    blocked('BLOCKED_DIRECT_PERF_RECORD_MODE', 'Protocol record must have mode 0600');
  }
  let handle;
  try {
    handle = await open(context.target, privateReadFlags());
    const before = await handle.stat();
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || contents.byteLength !== before.size
    ) {
      blocked('BLOCKED_DIRECT_PERF_RECORD_CHANGED', 'Protocol record changed while reading');
    }
    return JSON.parse(contents.toString('utf8'));
  } catch (error) {
    if (isBlocked(error)) throw error;
    blocked('BLOCKED_DIRECT_PERF_RECORD_INVALID', 'Protocol record JSON is invalid');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function validateContainedTarget(filePath, containedBy) {
  if (
    typeof filePath !== 'string'
    || typeof containedBy !== 'string'
    || !path.isAbsolute(filePath)
    || !path.isAbsolute(containedBy)
  ) {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE', 'Protocol paths must be absolute');
  }
  const realRoot = await realpath(containedBy).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE', 'Protocol root is unavailable');
  });
  const target = path.resolve(filePath);
  const parent = path.dirname(target);
  const realParent = await realpath(parent).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE', 'Protocol parent is unavailable');
  });
  if (realParent !== realRoot || parent !== realRoot || path.dirname(target) !== realRoot) {
    blocked('BLOCKED_DIRECT_PERF_PATH_ESCAPE', 'Protocol target must be directly contained');
  }
  return { target, parent: realParent };
}

function requireProtocolIdentity(value, expected, code) {
  requireChallengeCandidatePid(value, expected, code);
  if (
    !SHA256.test(String(value?.sourceSnapshotSha256 ?? ''))
    || value.sourceSnapshotSha256 !== expected?.sourceSnapshotSha256
  ) {
    blocked(code, 'Source snapshot binding mismatch');
  }
}

function requireChallengeCandidatePid(value, expected, code) {
  if (
    !CHALLENGE.test(String(value?.challenge ?? ''))
    || value.challenge !== expected?.challenge
    || !CANDIDATE.test(String(value?.candidate ?? ''))
    || value.candidate !== expected?.candidate
    || !Number.isSafeInteger(value?.pid)
    || value.pid <= 0
    || value.pid !== expected?.pid
  ) {
    blocked(code, 'Challenge, candidate, or PID binding mismatch');
  }
}

function requireExactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    blocked(code, 'Protocol value must be a fixed object');
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    blocked(code, 'Protocol object contains unknown or missing fields');
  }
}

function requireSortedUniquePids(value, code) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  ) {
    blocked(code, 'PID list must contain positive safe integers');
  }
  const normalized = [...value].sort((left, right) => left - right);
  if (
    new Set(value).size !== value.length
    || JSON.stringify(value) !== JSON.stringify(normalized)
  ) {
    blocked(code, 'PID list must be sorted and unique');
  }
  return normalized;
}

async function assertAbsent(filePath) {
  try {
    await lstat(filePath);
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_EXISTS', 'Protocol output already exists');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    if (isBlocked(error)) throw error;
    blocked('BLOCKED_DIRECT_PERF_OUTPUT_INSPECT', 'Cannot inspect protocol output');
  }
}

async function safeLstat(filePath, code) {
  try {
    return await lstat(filePath);
  } catch {
    blocked(code, 'Required filesystem object is unavailable');
  }
}

function privateCreateFlags() {
  return fsConstants.O_WRONLY
    | fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | (fsConstants.O_NOFOLLOW ?? 0);
}

function privateReadFlags() {
  return fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blocked(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isBlocked(error) {
  return typeof error?.code === 'string' && error.code.startsWith('BLOCKED_');
}
