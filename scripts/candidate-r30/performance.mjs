import { lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { block, fullCommit } from './contract.mjs';
import { CANONICAL_CANDIDATE_ALIAS } from './canonical-release.mjs';
import { desktopRoot, privateJson, recorded, sha256File } from './io.mjs';

export const PERFORMANCE_CONTRACT_VERSION = 'r31-v1';
export const PERFORMANCE_RAW_BASENAMES = Object.freeze([
  'performance-raw1-r31-v1.json',
  'performance-raw2-r31-v1.json',
  'performance-raw3-r31-v1.json',
]);
export const PERFORMANCE_AGGREGATE_BASENAME = 'performance-aggregate-r31-v1.json';

const SHA256 = /^[0-9a-f]{64}$/u;

async function requireAbsent(file, code) {
  try {
    await lstat(file);
    block(code, 11, file);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    if (error?.name === 'CandidateBlocked') throw error;
    block(code, 11, file, { code: error?.code ?? null });
  }
}

async function readJson(file, code) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    block(code, 11, path.basename(file), { code: error?.code ?? null });
  }
}

export function validatePerformanceRawData(raw, basename, ordinal) {
  if (
    !PERFORMANCE_RAW_BASENAMES.includes(basename)
    || PERFORMANCE_RAW_BASENAMES.indexOf(basename) !== ordinal - 1
    || !raw
    || typeof raw !== 'object'
    || Array.isArray(raw)
    || raw.schemaVersion !== 4
    || raw.source !== `direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts-${PERFORMANCE_CONTRACT_VERSION}`
    || raw.candidateBinding?.candidate !== CANONICAL_CANDIDATE_ALIAS
    || raw.runtimeProbe?.runBinding?.rawBasename !== basename
    || raw.runtimeProbe?.runBinding?.ordinal !== ordinal
    || !SHA256.test(raw.runtimeProbe?.runBinding?.challengeSha256 ?? '')
    || raw.startup?.terminal?.nativeWindowVisible !== true
    || raw.startup?.terminal?.rendererShellCommit !== true
    || raw.startup?.terminal?.rendererAppRootVisible !== true
    || raw.startup?.terminal?.completionSignal !== true
    || raw.knowledgeGraph100?.nodeCount !== 100
    || !Number.isFinite(raw.knowledgeGraph100?.fps)
    || raw.knowledgeGraph100.fps < 30
    || !Number.isFinite(raw.app?.directSpawnLaunchMs)
    || raw.app.directSpawnLaunchMs >= 2_000
    || !Number.isFinite(raw.app?.residentSetMb)
    || raw.app.residentSetMb >= 500
    || raw.processCleanup?.pass !== true
    || raw.processCleanup?.remainingPidCount !== 0
    || raw.pass !== true
  ) block('BLOCKED_GATE_11_PERFORMANCE_RAW', 11, basename);
  return raw;
}

export function validatePerformanceAggregateData(aggregate) {
  if (
    !aggregate
    || typeof aggregate !== 'object'
    || Array.isArray(aggregate)
    || aggregate.schemaVersion !== 1
    || aggregate.contractVersion !== PERFORMANCE_CONTRACT_VERSION
    || aggregate.candidate !== CANONICAL_CANDIDATE_ALIAS
    || aggregate.method !== 'direct-spawn-write-once-v1'
    || aggregate.runCount !== 3
    || aggregate.bindingMode !== `${PERFORMANCE_CONTRACT_VERSION}-complete-candidate-harness-provenance`
    || aggregate.bindingsStable !== true
    || aggregate.binding?.candidateBinding?.candidate !== CANONICAL_CANDIDATE_ALIAS
    || !Array.isArray(aggregate.rawByteBindings)
    || aggregate.rawByteBindings.length !== 3
    || !Array.isArray(aggregate.rawRuns)
    || aggregate.rawRuns.length !== 3
    || aggregate.thresholdExclusiveMs !== 2_000
    || !Number.isFinite(aggregate.maxDirectSpawnLaunchMs)
    || aggregate.maxDirectSpawnLaunchMs >= 2_000
    || aggregate.pass !== true
  ) block('BLOCKED_GATE_11_PERFORMANCE_AGGREGATE', 11);
  for (let index = 0; index < 3; index += 1) {
    const expected = PERFORMANCE_RAW_BASENAMES[index];
    const binding = aggregate.rawByteBindings[index];
    const run = aggregate.rawRuns[index];
    if (
      binding?.basename !== expected
      || binding?.ordinal !== index + 1
      || !Number.isSafeInteger(binding?.bytes)
      || binding.bytes < 2
      || !SHA256.test(binding?.sha256 ?? '')
      || run?.raw !== expected
      || run?.runBinding?.rawBasename !== expected
      || run?.runBinding?.ordinal !== index + 1
      || !SHA256.test(run?.runBinding?.challengeSha256 ?? '')
      || run?.pass !== true
    ) block('BLOCKED_GATE_11_PERFORMANCE_AGGREGATE_BINDING', 11, expected);
  }
  const challenges = new Set(aggregate.rawRuns.map((run) => run.runBinding.challengeSha256));
  const captures = aggregate.rawRuns.map((run) => Date.parse(run.capturedAt));
  if (
    challenges.size !== 3
    || captures.some((value) => !Number.isFinite(value))
    || !(captures[0] < captures[1] && captures[1] < captures[2])
  ) block('BLOCKED_GATE_11_PERFORMANCE_DISTINCT_RUNS', 11);
  return aggregate;
}

export async function runPerformanceGate({
  sourceCommit,
  candidateId,
  evidenceDir,
  canonical,
  artifacts,
}) {
  fullCommit(sourceCommit, 'performance-source');
  if (
    canonical?.candidateAlias !== CANONICAL_CANDIDATE_ALIAS
    || canonical?.sourceCommit !== sourceCommit
    || !artifacts?.executablePath
    || !artifacts?.appAsarPath
  ) block('BLOCKED_GATE_11_PERFORMANCE_INPUT', 11);

  const performanceRoot = path.join(evidenceDir, 'performance');
  await mkdir(performanceRoot, { mode: 0o700 });
  const runner = path.join(desktopRoot, 'scripts/measure-electron-direct-performance-r31-v1.mjs');
  const aggregateCli = path.join(desktopRoot, 'scripts/aggregate-electron-direct-performance-r31-v1.mjs');
  const baseEnv = {
    COPILOT_PERF_CANDIDATE_ID: CANONICAL_CANDIDATE_ALIAS,
    COPILOT_PERF_EXECUTABLE_PATH: artifacts.executablePath,
    COPILOT_PERF_APP_ASAR_PATH: artifacts.appAsarPath,
    COPILOT_PERF_RELEASE_IDENTITY_PATH: canonical.releaseIdentityPath,
    COPILOT_PERF_CANONICAL_MANIFEST_PATH: canonical.manifestPath,
    COPILOT_PERF_SOURCE_ROOT: canonical.sourceSnapshotRoot,
    COPILOT_PERF_SKIP_BUILD: '1',
  };
  const raws = [];
  for (let index = 0; index < PERFORMANCE_RAW_BASENAMES.length; index += 1) {
    const basename = PERFORMANCE_RAW_BASENAMES[index];
    const outputPath = path.join(performanceRoot, basename);
    await requireAbsent(outputPath, 'BLOCKED_GATE_11_PERFORMANCE_RAW_EXISTS');
    await recorded({
      gate: 11,
      name: `direct-performance-run-${index + 1}`,
      command: process.execPath,
      args: [runner],
      evidenceDir,
      env: { ...baseEnv, COPILOT_PERF_OUTPUT_PATH: outputPath },
    });
    const document = validatePerformanceRawData(
      await readJson(outputPath, 'BLOCKED_GATE_11_PERFORMANCE_RAW'),
      basename,
      index + 1,
    );
    raws.push({
      path: outputPath,
      basename,
      sha256: await sha256File(outputPath, { gate: 11 }),
      document,
    });
  }

  const aggregatePath = path.join(performanceRoot, PERFORMANCE_AGGREGATE_BASENAME);
  await requireAbsent(aggregatePath, 'BLOCKED_GATE_11_PERFORMANCE_AGGREGATE_EXISTS');
  await recorded({
    gate: 11,
    name: 'direct-performance-aggregate',
    command: process.execPath,
    args: [aggregateCli, aggregatePath, ...raws.map((raw) => raw.path)],
    evidenceDir,
  });
  const aggregate = validatePerformanceAggregateData(
    await readJson(aggregatePath, 'BLOCKED_GATE_11_PERFORMANCE_AGGREGATE'),
  );
  for (let index = 0; index < raws.length; index += 1) {
    if (aggregate.rawByteBindings[index].sha256 !== raws[index].sha256) {
      block('BLOCKED_GATE_11_PERFORMANCE_RAW_HASH', 11, raws[index].basename);
    }
  }
  const receipt = {
    schemaVersion: 1,
    gate: 11,
    candidateId,
    candidateAlias: CANONICAL_CANDIDATE_ALIAS,
    sourceCommit,
    contractVersion: PERFORMANCE_CONTRACT_VERSION,
    raws: raws.map(({ path: rawPath, basename, sha256 }) => ({ path: rawPath, basename, sha256 })),
    aggregatePath,
    aggregateSha256: await sha256File(aggregatePath, { gate: 11 }),
    runCount: aggregate.runCount,
    medianDirectSpawnLaunchMs: aggregate.medianDirectSpawnLaunchMs,
    maxDirectSpawnLaunchMs: aggregate.maxDirectSpawnLaunchMs,
    bindingsStable: aggregate.bindingsStable,
    pass: aggregate.pass,
  };
  await privateJson(path.join(evidenceDir, 'gates/gate-11-performance.json'), receipt);
  return receipt;
}
