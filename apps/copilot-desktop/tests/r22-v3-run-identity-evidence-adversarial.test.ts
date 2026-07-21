// @vitest-environment node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-ignore JavaScript release helpers are exercised directly by Vitest.
import * as directPerformanceConfig from '../scripts/direct-performance-config.mjs';

const { aggregateDirectPerformanceRuns } = directPerformanceConfig;

type Json = Record<string, any>;

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aggregateCliPath = path.join(
  desktopRoot,
  'scripts/aggregate-electron-direct-performance.mjs',
);
const directRunnerPath = path.join(
  desktopRoot,
  'scripts/measure-electron-direct-performance.mjs',
);
const rawBasenames = [
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
] as const;
const orderedCaptureTimes = [
  '2020-01-01T00:00:01.000Z',
  '2020-01-01T00:00:02.000Z',
  '2020-01-01T00:00:03.000Z',
] as const;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function artifact(basename: string, seed: string, bytes = 100): Json {
  return {
    basename,
    pathScope: 'host-local-redacted',
    bytes,
    sha256: sha(seed),
  };
}

function digestExecutedFiles(files: Json[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(JSON.stringify({
      logicalName: file.logicalName,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function digestAuthoritativeFiles(files: Json[]): string {
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

function generatedEntry(): Json {
  return {
    logicalName: 'copilot-kg-performance-entry.tsx',
    sourcefile: 'copilot-kg-performance-entry.tsx',
    bytes: 512,
    sha256: sha('r22-v3-generated-entry'),
  };
}

function executedHarnessBinding(): Json {
  const files = [
    { logicalName: 'bundle.css', bytes: 3_832, sha256: sha('r22-v3-bundle-css') },
    { logicalName: 'bundle.js', bytes: 1_484_112, sha256: sha('r22-v3-bundle-js') },
    { logicalName: 'index.html', bytes: 154, sha256: sha('r22-v3-index-html') },
  ];
  return { schemaVersion: 1, files, digest: digestExecutedFiles(files) };
}

function authoritativeExecutedBuild(): Json {
  const files = [
    { basename: 'bundle.css', bytes: 3_832, sha256: sha('r22-v3-bundle-css') },
    { basename: 'bundle.js', bytes: 1_484_112, sha256: sha('r22-v3-bundle-js') },
  ];
  return {
    authority: 'authoritative-executed-build-artifacts',
    source: 'esbuild-returned-output-bytes',
    files,
    digest: digestAuthoritativeFiles(files),
  };
}

function inputProvenance(entry: Json): Json {
  return {
    authority: 'non-authoritative-post-build-provenance',
    note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
    component: {
      source: 'candidate-snapshot',
      logicalPath: 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx',
      bytes: 5_205,
      sha256: sha('r22-v3-kg-component'),
    },
    dependencies: {
      source: 'resolved-installed-inputs',
      inputCount: 29,
      digest: sha('r22-v3-resolved-dependencies'),
    },
    buildInputs: {
      inputCount: 40,
      digest: sha('r22-v3-build-inputs'),
      generatedEntry: entry,
    },
    snapshotPackageLock: {
      present: true,
      bytes: 481_226,
      sha256: sha('r22-v3-snapshot-package-lock'),
    },
  };
}

function candidateBinding(executableBasename = 'njx-copilot-v6'): Json {
  return {
    candidate: 'v6.2-phase1-candidate-r22',
    executable: artifact(executableBasename, 'r22-v3-executable', 50_472),
    appAsar: artifact('app.asar', 'r22-v3-app-asar', 37_347_710),
    releaseIdentity: artifact(
      'release-identity.exact.json',
      'r22-v3-release-identity',
      223,
    ),
    sourceSnapshot: {
      ...artifact('source-snapshot', 'r22-v3-source-snapshot', 3_053_393),
      fileCount: 304,
      algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
      manifest: artifact(
        'source-snapshot-inputs.json',
        'r22-v3-source-manifest',
        58_185,
      ),
      canonicalManifest: artifact(
        'CANONICAL-MANIFEST.json',
        'r22-v3-canonical-manifest',
        47_990,
      ),
    },
  };
}

function startupDiagnostics(): Json {
  return {
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
  };
}

function realRecord({
  raw,
  index,
  v3,
  capturedAt = orderedCaptureTimes[index],
  executableBasename = 'njx-copilot-v6',
  kg = { sampleMs: 1_500, frames: 90, fps: 60 },
}: {
  raw: string;
  index: number;
  v3: boolean;
  capturedAt?: string;
  executableBasename?: string;
  kg?: { sampleMs: number; frames: number; fps: number };
}): Json {
  const binding = candidateBinding(executableBasename);
  const entry = generatedEntry();
  const executed = executedHarnessBinding();
  const runtimeProbe: Json = {
    collectPublishedAfterLaunchFreeze: true,
    appMetricsCollectedBeforeKg: true,
    sameCandidatePid: true,
    metricsObservedAfterGateMs: 481.34,
  };
  if (v3) {
    runtimeProbe.runBinding = {
      rawBasename: raw,
      ordinal: index + 1,
      challengeSha256: sha(`r22-v3-direct-run-challenge-${index + 1}`),
    };
  }
  return {
    schemaVersion: 3,
    capturedAt,
    source: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts',
    runtime: {
      mode: 'packaged',
      launchBinding: 'executablePath',
      executable: clone(binding.executable),
      skipBuild: true,
    },
    harness: {
      sourceMode: 'snapshot-component-with-resolved-installed-inputs',
      authoritativeExecutedBuild: authoritativeExecutedBuild(),
      executedHarnessBinding: executed,
      generatedEntry: entry,
      inputProvenance: inputProvenance(entry),
    },
    evidence: {
      outputTarget: { basename: raw, pathScope: 'host-local-redacted' },
      outputMode: 'external-non-overwriting',
      preservedHarness: {
        directoryBasename: raw,
        files: clone(executed.files),
        binding: clone(executed),
      },
    },
    candidateBinding: binding,
    app: {
      launchMs: 1_200,
      outerControllerLaunchMs: 1_200,
      directSpawnLaunchMs: 1_200,
      residentSetMb: 350,
      processCount: 4,
    },
    startup: {
      method: 'direct-spawn-write-once-v1',
      gateClock: 'controller-before-direct-spawn-through-first-validated-ready-observation',
      internalClockRole: 'diagnostic-only-never-gating',
      readyObservedAtControllerMs: 1_200,
      terminal: {
        nativeWindowVisible: true,
        rendererShellCommit: true,
        rendererAppRootVisible: true,
        completionSignal: true,
      },
      diagnostics: startupDiagnostics(),
      transport: {
        type: 'fresh-profile-write-once-files',
        challengeRedacted: true,
        pathsRedacted: true,
      },
    },
    runtimeProbe,
    knowledgeGraph100: {
      nodeCount: 100,
      edgeCount: 157,
      ...kg,
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
    pass: true,
  };
}

function triple({
  v3,
  captures = orderedCaptureTimes,
  executableBasename = 'njx-copilot-v6',
  kg,
}: {
  v3: boolean;
  captures?: readonly string[];
  executableBasename?: string;
  kg?: { sampleMs: number; frames: number; fps: number };
}): Json[] {
  return rawBasenames.map((raw, index) => ({
    raw,
    record: realRecord({
      raw,
      index,
      v3,
      capturedAt: captures[index],
      executableBasename,
      kg,
    }),
  }));
}

function replayedV2Triple(): Json[] {
  const seed = realRecord({ raw: rawBasenames[0], index: 0, v3: false });
  return rawBasenames.map((raw) => {
    const record = clone(seed);
    record.evidence.outputTarget.basename = raw;
    record.evidence.preservedHarness.directoryBasename = raw;
    return { raw, record };
  });
}

function aggregatePass(runs: Json[]): boolean {
  try {
    return aggregateDirectPerformanceRuns(runs)?.pass === true;
  } catch {
    return false;
  }
}

type RunBindingComposerOutcome =
  | { status: 'returned'; value: Json }
  | { status: 'rejected' }
  | { status: 'missing' };

function composeRunBindingOutcome(
  challenge: unknown,
  rawBasename: string,
): RunBindingComposerOutcome {
  const composer = (directPerformanceConfig as Record<string, unknown>)
    .createR22DirectPerformanceRunBinding;
  if (typeof composer !== 'function') return { status: 'missing' };
  try {
    return {
      status: 'returned',
      value: (composer as (input: Json) => Json)({
        challenge,
        outputPath: path.join(os.tmpdir(), rawBasename),
      }),
    };
  } catch {
    return { status: 'rejected' };
  }
}

function mutateAll(runs: Json[], mutate: (record: Json) => void): Json[] {
  for (const { record } of runs) mutate(record);
  return runs;
}

function canonicalBytes(record: Json): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('r22 V3 RED-A truthful distinct direct-run identity', () => {
  it('rejects one V2 execution replayed as three and accepts only a valid forward V3 triple', () => {
    const duplicateBinding = triple({ v3: true });
    duplicateBinding[1].record.runtimeProbe.runBinding.challengeSha256 =
      duplicateBinding[0].record.runtimeProbe.runBinding.challengeSha256;

    const wrongOrdinal = triple({ v3: true });
    wrongOrdinal[1].record.runtimeProbe.runBinding.ordinal = 1;

    const wrongBasename = triple({ v3: true });
    wrongBasename[1].record.runtimeProbe.runBinding.rawBasename = rawBasenames[0];

    const leakedOrUnknownBindingField = triple({ v3: true });
    leakedOrUnknownBindingField[1].record.runtimeProbe.runBinding.challenge = 'secret';

    const uppercaseHash = triple({ v3: true });
    uppercaseHash[1].record.runtimeProbe.runBinding.challengeSha256 = 'A'.repeat(64);

    const shortHash = triple({ v3: true });
    shortHash[1].record.runtimeProbe.runBinding.challengeSha256 = 'a'.repeat(63);

    const nonHexHash = triple({ v3: true });
    nonHexHash[1].record.runtimeProbe.runBinding.challengeSha256 = 'g'.repeat(64);

    const arrayCoercedDuplicateBinding = triple({ v3: true });
    const repeatedArrayElement = sha('r22-v3-array-coercion-duplicate');
    for (const { record } of arrayCoercedDuplicateBinding) {
      record.runtimeProbe.runBinding.challengeSha256 = [repeatedArrayElement];
    }

    const result = {
      replayedV2Accepted: aggregatePass(replayedV2Triple()),
      validV3Accepted: aggregatePass(triple({ v3: true })),
      duplicateBindingAccepted: aggregatePass(duplicateBinding),
      wrongOrdinalAccepted: aggregatePass(wrongOrdinal),
      wrongBasenameAccepted: aggregatePass(wrongBasename),
      leakedOrUnknownBindingFieldAccepted: aggregatePass(leakedOrUnknownBindingField),
      uppercaseHashAccepted: aggregatePass(uppercaseHash),
      shortHashAccepted: aggregatePass(shortHash),
      nonHexHashAccepted: aggregatePass(nonHexHash),
      arrayCoercedDuplicateBindingAccepted: aggregatePass(arrayCoercedDuplicateBinding),
    };
    expect(result).toEqual({
      replayedV2Accepted: false,
      validV3Accepted: true,
      duplicateBindingAccepted: false,
      wrongOrdinalAccepted: false,
      wrongBasenameAccepted: false,
      leakedOrUnknownBindingFieldAccepted: false,
      uppercaseHashAccepted: false,
      shortHashAccepted: false,
      nonHexHashAccepted: false,
      arrayCoercedDuplicateBindingAccepted: false,
    });
  });

  it('rejects identical, non-increasing, reverse, and future capture times', () => {
    const identical = ['2020-01-01T00:00:01.000Z', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:01.000Z'];
    const nonIncreasing = ['2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z', '2020-01-01T00:00:02.000Z'];
    const reverse = [...orderedCaptureTimes].reverse();
    const future = ['2099-01-01T00:00:01.000Z', '2099-01-01T00:00:02.000Z', '2099-01-01T00:00:03.000Z'];
    const clockObservedForward = triple({ v3: true });
    let capturedAtReadBeforeClock = false;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2020-01-01T00:00:10.000Z'),
    );
    for (const { record } of clockObservedForward) {
      const capturedAt = record.capturedAt;
      Object.defineProperty(record, 'capturedAt', {
        configurable: true,
        enumerable: true,
        get() {
          if (nowSpy.mock.calls.length === 0) capturedAtReadBeforeClock = true;
          return capturedAt;
        },
      });
    }
    let forwardV3ValidAccepted = false;
    let aggregateDateNowCalls = 0;
    try {
      forwardV3ValidAccepted = aggregatePass(clockObservedForward);
      aggregateDateNowCalls = nowSpy.mock.calls.length;
    } finally {
      nowSpy.mockRestore();
    }

    const result = {
      currentV2IdenticalAccepted: aggregatePass(triple({ v3: false, captures: identical })),
      currentV2ReverseAccepted: aggregatePass(triple({ v3: false, captures: reverse })),
      currentV2FutureAccepted: aggregatePass(triple({ v3: false, captures: future })),
      forwardV3ValidAccepted,
      aggregateDateNowCalls,
      capturedAtReadBeforeClock,
      forwardV3IdenticalAccepted: aggregatePass(triple({ v3: true, captures: identical })),
      forwardV3NonIncreasingAccepted: aggregatePass(triple({ v3: true, captures: nonIncreasing })),
      forwardV3ReverseAccepted: aggregatePass(triple({ v3: true, captures: reverse })),
      forwardV3FutureAccepted: aggregatePass(triple({ v3: true, captures: future })),
    };
    expect(result).toEqual({
      currentV2IdenticalAccepted: false,
      currentV2ReverseAccepted: false,
      currentV2FutureAccepted: false,
      forwardV3ValidAccepted: true,
      aggregateDateNowCalls: 1,
      capturedAtReadBeforeClock: false,
      forwardV3IdenticalAccepted: false,
      forwardV3NonIncreasingAccepted: false,
      forwardV3ReverseAccepted: false,
      forwardV3FutureAccepted: false,
    });
  });

  it('proves the real runner hashes its random challenge and binds it to the exact output basename', async () => {
    const zeroChallenge = '00'.repeat(32);
    const knownZeroChallengeSha256 =
      '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925';
    const composer = {
      raw1: composeRunBindingOutcome(zeroChallenge, rawBasenames[0]),
      raw2: composeRunBindingOutcome(zeroChallenge, rawBasenames[1]),
      raw3: composeRunBindingOutcome(zeroChallenge, rawBasenames[2]),
      unknownRaw: composeRunBindingOutcome(zeroChallenge, 'performance-raw4-r22.json'),
      uppercaseChallenge: composeRunBindingOutcome('AA'.repeat(32), rawBasenames[0]),
      shortChallenge: composeRunBindingOutcome('00'.repeat(31), rawBasenames[0]),
      nonHexChallenge: composeRunBindingOutcome('gg'.repeat(32), rawBasenames[0]),
      arrayChallenge: composeRunBindingOutcome([zeroChallenge], rawBasenames[0]),
    };
    const source = stripComments(await readFile(directRunnerPath, 'utf8'));
    const challengeCreationIndex = source.indexOf(
      'const challenge = createDirectPerformanceChallenge()',
    );
    const composerCallIndex = source.indexOf(
      'createR22DirectPerformanceRunBinding',
      challengeCreationIndex,
    );
    const candidateSpawnIndex = source.indexOf('child = spawn', composerCallIndex);
    const runtimeProbeStart = source.indexOf('runtimeProbe:');
    const knowledgeGraphStart = source.indexOf('knowledgeGraph100:', runtimeProbeStart);
    const publishedRuntimeProbe = source.slice(runtimeProbeStart, knowledgeGraphStart);
    const result = {
      composer,
      runnerDataflow: {
        challengeCreationPresent: challengeCreationIndex >= 0,
        composerAfterChallenge: composerCallIndex > challengeCreationIndex,
        spawnAfterComposer: composerCallIndex >= 0 && candidateSpawnIndex > composerCallIndex,
        exactComposerCall: /const\s+runBinding\s*=\s*createR22DirectPerformanceRunBinding\(\s*\{\s*challenge\s*,\s*outputPath\s*:\s*config\.outputPath\s*\}\s*\)/s
          .test(source.slice(challengeCreationIndex, candidateSpawnIndex)),
        publishesRunBinding: /\brunBinding\b/.test(publishedRuntimeProbe),
        publishesNoSensitiveSource: !/\bchallenge\b|userData|profile|outputPath/
          .test(publishedRuntimeProbe),
      },
    };
    expect(result).toEqual({
      composer: {
        raw1: {
          status: 'returned',
          value: {
            rawBasename: rawBasenames[0],
            ordinal: 1,
            challengeSha256: knownZeroChallengeSha256,
          },
        },
        raw2: {
          status: 'returned',
          value: {
            rawBasename: rawBasenames[1],
            ordinal: 2,
            challengeSha256: knownZeroChallengeSha256,
          },
        },
        raw3: {
          status: 'returned',
          value: {
            rawBasename: rawBasenames[2],
            ordinal: 3,
            challengeSha256: knownZeroChallengeSha256,
          },
        },
        unknownRaw: { status: 'rejected' },
        uppercaseChallenge: { status: 'rejected' },
        shortChallenge: { status: 'rejected' },
        nonHexChallenge: { status: 'rejected' },
        arrayChallenge: { status: 'rejected' },
      },
      runnerDataflow: {
        challengeCreationPresent: true,
        composerAfterChallenge: true,
        spawnAfterComposer: true,
        exactComposerCall: true,
        publishesRunBinding: true,
        publishesNoSensitiveSource: true,
      },
    });
  });
});

describe('r22 V3 RED-B producer-fixed candidate artifact identities', () => {
  it.each([
    ['executable', (record: Json) => {
      record.candidateBinding.executable.basename = 'renamed-client';
      record.runtime.executable.basename = 'renamed-client';
    }],
    ['app.asar', (record: Json) => { record.candidateBinding.appAsar.basename = 'renamed-app.bin'; }],
    ['release identity', (record: Json) => { record.candidateBinding.releaseIdentity.basename = 'identity.json'; }],
    ['source snapshot', (record: Json) => { record.candidateBinding.sourceSnapshot.basename = 'other-snapshot'; }],
    ['snapshot input manifest', (record: Json) => { record.candidateBinding.sourceSnapshot.manifest.basename = 'other-inputs.json'; }],
    ['canonical manifest', (record: Json) => { record.candidateBinding.sourceSnapshot.canonicalManifest.basename = 'other-manifest.json'; }],
  ])('rejects a cross-run-equal but semantically wrong %s basename', (_label, mutate) => {
    const currentV2Mutation = mutateAll(triple({ v3: false }), mutate as (record: Json) => void);
    const forwardV3Mutation = mutateAll(triple({ v3: true }), mutate as (record: Json) => void);
    expect({
      currentV2MutationAccepted: aggregatePass(currentV2Mutation),
      forwardValidMacAccepted: aggregatePass(triple({ v3: true })),
      forwardValidWindowsAccepted: aggregatePass(triple({
        v3: true,
        executableBasename: 'njx-copilot-v6.exe',
      })),
      forwardV3MutationAccepted: aggregatePass(forwardV3Mutation),
    }).toEqual({
      currentV2MutationAccepted: false,
      forwardValidMacAccepted: true,
      forwardValidWindowsAccepted: true,
      forwardV3MutationAccepted: false,
    });
  });
});

describe('r22 V3 RED-C producer-coherent frame, sample, and FPS evidence', () => {
  it('rejects the current impossible one-frame 60 FPS false PASS', () => {
    const impossible = { sampleMs: 1_500, frames: 1, fps: 60 };
    const result = {
      currentV2ImpossibleAccepted: aggregatePass(triple({
        v3: false,
        kg: impossible,
      })),
      forwardV3ImpossibleAccepted: aggregatePass(triple({
        v3: true,
        kg: impossible,
      })),
    };
    expect(result).toEqual({
      currentV2ImpossibleAccepted: false,
      forwardV3ImpossibleAccepted: false,
    });
  });

  it('requires canonical round2 values and enforces the exact 0.01 formula boundary', () => {
    const exact = { sampleMs: 1_500, frames: 90, fps: 60 };
    // For an actual elapsed value of 1500.082ms, the frozen producer yields
    // sampleMs=1500.08 and fps=30.66 while recomputing from sampleMs yields 30.67.
    const boundary = { sampleMs: 1_500.08, frames: 46, fps: 30.66 };
    const thirdDecimalSample = { sampleMs: 1_500.081, frames: 46, fps: 30.67 };
    const thirdDecimalFps = { sampleMs: 1_500.08, frames: 46, fps: 30.661 };
    const outside = { sampleMs: 1_500.08, frames: 46, fps: 30.65 };
    expect({
      exactAccepted: aggregatePass(triple({ v3: true, kg: exact })),
      boundaryAccepted: aggregatePass(triple({ v3: true, kg: boundary })),
      thirdDecimalSampleAccepted: aggregatePass(triple({ v3: true, kg: thirdDecimalSample })),
      thirdDecimalFpsAccepted: aggregatePass(triple({ v3: true, kg: thirdDecimalFps })),
      outsideAccepted: aggregatePass(triple({ v3: true, kg: outside })),
    }).toEqual({
      exactAccepted: true,
      boundaryAccepted: true,
      thirdDecimalSampleAccepted: false,
      thirdDecimalFpsAccepted: false,
      outsideAccepted: false,
    });
  });
});

type CliResult = { code: number | null; stdout: string; stderr: string };

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [aggregateCliPath, ...args], {
      cwd: desktopRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function createCliFixture({
  v3,
  bytesFor,
}: {
  v3: boolean;
  bytesFor?: (record: Json, index: number) => string;
}): Promise<{ root: string; output: string; raws: string[]; records: Json[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r22-v3-aggregate-cli-red-'));
  tempRoots.push(root);
  await chmod(root, 0o700);
  const records = triple({ v3 }).map(({ record }) => record);
  const raws = rawBasenames.map((raw) => path.join(root, raw));
  await Promise.all(records.map((record, index) => writeFile(
    raws[index],
    bytesFor?.(record, index) ?? canonicalBytes(record),
    { flag: 'wx', mode: 0o600 },
  )));
  return {
    root,
    output: path.join(root, 'performance-aggregate-r22.json'),
    raws,
    records,
  };
}

async function createHardlinkedCliFixture(v3: boolean): Promise<{
  output: string;
  raws: string[];
  nlinks: number[];
}> {
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'r22-v3-external-raw-'));
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'r22-v3-linked-evidence-'));
  tempRoots.push(externalRoot, evidenceRoot);
  await Promise.all([chmod(externalRoot, 0o700), chmod(evidenceRoot, 0o700)]);

  const records = triple({ v3 }).map(({ record }) => record);
  const raws: string[] = [];
  const nlinks: number[] = [];
  for (let index = 0; index < rawBasenames.length; index += 1) {
    const external = path.join(externalRoot, `external-${index + 1}.json`);
    const linked = path.join(evidenceRoot, rawBasenames[index]);
    await writeFile(external, canonicalBytes(records[index]), { flag: 'wx', mode: 0o600 });
    await link(external, linked);
    raws.push(linked);
    nlinks.push((await lstat(linked)).nlink);
  }
  return {
    output: path.join(evidenceRoot, 'performance-aggregate-r22.json'),
    raws,
    nlinks,
  };
}

function duplicateRootKeyBytes(record: Json): string {
  return canonicalBytes(record).replace(
    /\n  "pass": true\n}\n$/,
    '\n  "pass": false,\n  "pass": true\n}\n',
  );
}

function duplicateNestedKeyBytes(record: Json): string {
  return canonicalBytes(record).replace(
    '    "sameCandidatePid": true,\n',
    '    "sameCandidatePid": false,\n    "sameCandidatePid": true,\n',
  );
}

async function outputIsPass(output: string): Promise<boolean> {
  const contents = await readFile(output, 'utf8').catch(() => null);
  if (contents === null) return false;
  try {
    return JSON.parse(contents).pass === true;
  } catch {
    return false;
  }
}

describe('r22 V3 RED-D exact canonical private CLI evidence', () => {
  it.each([
    ['duplicate root key', duplicateRootKeyBytes],
    ['duplicate nested key', duplicateNestedKeyBytes],
  ])('rejects %s bytes before semantic aggregation', async (_label, duplicateBytes) => {
    const currentV2 = await createCliFixture({
      v3: false,
      bytesFor: (record, index) => index === 0
        ? (duplicateBytes as (value: Json) => string)(record)
        : canonicalBytes(record),
    });
    const currentResult = await runCli([currentV2.output, ...currentV2.raws]);

    const forwardControl = await createCliFixture({ v3: true });
    const forwardControlResult = await runCli([
      forwardControl.output,
      ...forwardControl.raws,
    ]);

    const forwardMutation = await createCliFixture({
      v3: true,
      bytesFor: (record, index) => index === 0
        ? (duplicateBytes as (value: Json) => string)(record)
        : canonicalBytes(record),
    });
    const forwardMutationResult = await runCli([
      forwardMutation.output,
      ...forwardMutation.raws,
    ]);

    expect({
      currentV2Exit: currentResult.code,
      currentV2PublishedPass: await outputIsPass(currentV2.output),
      forwardControlExit: forwardControlResult.code,
      forwardControlPublishedPass: await outputIsPass(forwardControl.output),
      forwardMutationExit: forwardMutationResult.code,
      forwardMutationPublishedPass: await outputIsPass(forwardMutation.output),
    }).toEqual({
      currentV2Exit: 1,
      currentV2PublishedPass: false,
      forwardControlExit: 0,
      forwardControlPublishedPass: true,
      forwardMutationExit: 1,
      forwardMutationPublishedPass: false,
    });
  });

  it('rejects semantically valid but noncanonical producer bytes', async () => {
    const currentV2 = await createCliFixture({
      v3: false,
      bytesFor: (record, index) => index === 1
        ? `${JSON.stringify(record)}\n`
        : canonicalBytes(record),
    });
    const currentResult = await runCli([currentV2.output, ...currentV2.raws]);

    const forwardControl = await createCliFixture({ v3: true });
    const forwardControlResult = await runCli([
      forwardControl.output,
      ...forwardControl.raws,
    ]);

    const forwardCompact = await createCliFixture({
      v3: true,
      bytesFor: (record, index) => index === 1
        ? `${JSON.stringify(record)}\n`
        : canonicalBytes(record),
    });
    const forwardCompactResult = await runCli([
      forwardCompact.output,
      ...forwardCompact.raws,
    ]);

    const runnerSource = stripComments(await readFile(directRunnerPath, 'utf8'));
    const runnerPrettyWriterBound = /writePerformanceEvidence\(\s*config\s*,\s*`\$\{JSON\.stringify\(resultToPublish,\s*null,\s*2\)\}\\n`\s*\)/s
      .test(runnerSource);

    const result = {
      currentV2Exit: currentResult.code,
      currentV2PublishedPass: await outputIsPass(currentV2.output),
      forwardControlExit: forwardControlResult.code,
      forwardControlPublishedPass: await outputIsPass(forwardControl.output),
      forwardCompactExit: forwardCompactResult.code,
      forwardCompactPublishedPass: await outputIsPass(forwardCompact.output),
      runnerPrettyWriterBound,
    };
    expect(result).toEqual({
      currentV2Exit: 1,
      currentV2PublishedPass: false,
      forwardControlExit: 0,
      forwardControlPublishedPass: true,
      forwardCompactExit: 1,
      forwardCompactPublishedPass: false,
      runnerPrettyWriterBound: true,
    });
  });

  it.skipIf(process.platform === 'win32')('rejects mode-0600 input paths hardlinked to external files', async () => {
    const currentV2Linked = await createHardlinkedCliFixture(false);
    const currentV2LinkedResult = await runCli([
      currentV2Linked.output,
      ...currentV2Linked.raws,
    ]);

    const forwardControl = await createCliFixture({ v3: true });
    const forwardControlResult = await runCli([
      forwardControl.output,
      ...forwardControl.raws,
    ]);
    const forwardControlOutputStat = await lstat(forwardControl.output).catch(() => null);

    const forwardLinked = await createHardlinkedCliFixture(true);
    const forwardLinkedResult = await runCli([
      forwardLinked.output,
      ...forwardLinked.raws,
    ]);

    const result = {
      currentV2InputNlinks: currentV2Linked.nlinks,
      currentV2LinkedExit: currentV2LinkedResult.code,
      currentV2LinkedPublishedPass: await outputIsPass(currentV2Linked.output),
      forwardControlExit: forwardControlResult.code,
      forwardControlPublishedPass: await outputIsPass(forwardControl.output),
      forwardControlOutputNlink: forwardControlOutputStat?.nlink ?? null,
      forwardLinkedInputNlinks: forwardLinked.nlinks,
      forwardLinkedExit: forwardLinkedResult.code,
      forwardLinkedPublishedPass: await outputIsPass(forwardLinked.output),
    };
    expect(result).toEqual({
      currentV2InputNlinks: [2, 2, 2],
      currentV2LinkedExit: 1,
      currentV2LinkedPublishedPass: false,
      forwardControlExit: 0,
      forwardControlPublishedPass: true,
      forwardControlOutputNlink: 1,
      forwardLinkedInputNlinks: [2, 2, 2],
      forwardLinkedExit: 1,
      forwardLinkedPublishedPass: false,
    });
  });

  it('requires explicit single-link checks on every input and output descriptor/path checkpoint', async () => {
    const source = stripComments(await readFile(aggregateCliPath, 'utf8'));
    const readPrivateRaw = source.slice(
      source.indexOf('async function readPrivateRaw'),
      source.indexOf('async function writePrivateAggregate'),
    );
    const writePrivateAggregate = source.slice(
      source.indexOf('async function writePrivateAggregate'),
      source.indexOf('async function requireAbsent'),
    );
    expect(readPrivateRaw).toMatch(/original\.nlink\s*!==\s*1/);
    expect(readPrivateRaw).toMatch(/before\.nlink\s*!==\s*1/);
    expect(readPrivateRaw).toMatch(/after\.nlink\s*!==\s*1/);
    expect(writePrivateAggregate).toMatch(/stat\.nlink\s*!==\s*1/);
    expect(writePrivateAggregate).toMatch(/published\.nlink\s*!==\s*1/);
    expect(writePrivateAggregate).toMatch(/published\.dev\s*!==\s*stat\.dev|stat\.dev\s*!==\s*published\.dev/);
    expect(writePrivateAggregate).toMatch(/published\.ino\s*!==\s*stat\.ino|stat\.ino\s*!==\s*published\.ino/);
  });
});
