// @vitest-environment node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type DirectPerformanceContract = Readonly<{
  contractVersion: string;
  candidate: string;
  rawSchemaVersion: number;
  rawSource: string;
  rawBasenames: readonly string[];
  aggregateBasename: string;
  executableBasenames: readonly string[];
  bindingMode: string;
}>;

type DirectPerformanceAggregate = {
  contractVersion: string;
  candidate: string;
  bindingMode: string;
  pass: boolean;
  rawByteBindings: Array<{
    basename: string;
    ordinal: number;
    bytes: number;
    sha256: string;
  }>;
};

interface DirectPerformanceConfigModule {
  aggregateCandidateBoundDirectPerformanceRawBytes(
    contract: object,
    inputs: ReadonlyArray<{ basename: string; bytes: Buffer }>,
  ): DirectPerformanceAggregate;
  aggregateDirectPerformanceRuns(
    inputs: ReadonlyArray<{ raw: string; record: object }>,
  ): DirectPerformanceAggregate;
  createCandidateBoundDirectPerformanceRunBinding(
    contract: object,
    input: { challenge: string | readonly string[]; outputPath: string },
  ): { rawBasename: string; ordinal: number; challengeSha256: string };
  createR22DirectPerformanceRunBinding(
    input: { challenge: string | readonly string[]; outputPath: string },
  ): { rawBasename: string; ordinal: number; challengeSha256: string };
  validateDirectPerformanceContractDescriptor(
    descriptor: object,
  ): DirectPerformanceContract;
}

interface DirectPerformanceContractModule {
  DIRECT_PERFORMANCE_CONTRACT_R31_V1: DirectPerformanceContract;
}

interface PerformanceConfigModule {
  writePerformanceEvidence(
    options: { outputPath: string; outputMode: 'external-non-overwriting' },
    contents: string,
  ): Promise<void>;
}

async function loadDynamicModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

const {
  aggregateCandidateBoundDirectPerformanceRawBytes,
  aggregateDirectPerformanceRuns,
  createCandidateBoundDirectPerformanceRunBinding,
  createR22DirectPerformanceRunBinding,
  validateDirectPerformanceContractDescriptor,
} = await loadDynamicModule<DirectPerformanceConfigModule>(
  '../scripts/direct-performance-config.mjs',
);
const {
  DIRECT_PERFORMANCE_CONTRACT_R31_V1: CONTRACT,
} = await loadDynamicModule<DirectPerformanceContractModule>(
  '../scripts/direct-performance-contract-r31-v1.mjs',
);
const {
  writePerformanceEvidence,
} = await loadDynamicModule<PerformanceConfigModule>(
  '../scripts/performance-config.mjs',
);

type Json = Record<string, any>;

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const taskDir = path.join(
  repoRoot,
  'tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover',
);
const aggregateCli = path.join(
  desktopRoot,
  'scripts/aggregate-electron-direct-performance-r31-v1.mjs',
);
const runnerPath = path.join(
  desktopRoot,
  'scripts/measure-electron-direct-performance-r31-v1.mjs',
);
const readinessChecker = path.join(
  taskDir,
  'scripts/check-final-candidate-readiness-r31-v1.mjs',
);
const captures = [
  '2020-01-01T00:00:01.000Z',
  '2020-01-01T00:00:02.000Z',
  '2020-01-01T00:00:03.000Z',
] as const;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function artifact(basename: string, seed: string, bytes = 100): Json {
  return { basename, pathScope: 'host-local-redacted', bytes, sha256: sha(seed) };
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

function executedHarnessBinding(seed: string): Json {
  const files = [
    { logicalName: 'bundle.css', bytes: 3_832, sha256: sha(`${seed}-css`) },
    { logicalName: 'bundle.js', bytes: 1_484_112, sha256: sha(`${seed}-js`) },
    { logicalName: 'index.html', bytes: 154, sha256: sha(`${seed}-html`) },
  ];
  return { schemaVersion: 1, files, digest: digestExecutedFiles(files) };
}

function authoritativeExecutedBuild(seed: string): Json {
  const files = [
    { basename: 'bundle.css', bytes: 3_832, sha256: sha(`${seed}-css`) },
    { basename: 'bundle.js', bytes: 1_484_112, sha256: sha(`${seed}-js`) },
  ];
  return {
    authority: 'authoritative-executed-build-artifacts',
    source: 'esbuild-returned-output-bytes',
    files,
    digest: digestAuthoritativeFiles(files),
  };
}

function generatedEntry(seed: string): Json {
  return {
    logicalName: 'copilot-kg-performance-entry.tsx',
    sourcefile: 'copilot-kg-performance-entry.tsx',
    bytes: 512,
    sha256: sha(`${seed}-entry`),
  };
}

function candidateBinding(candidate: string, seed: string): Json {
  return {
    candidate,
    executable: artifact('njx-copilot-v6', `${seed}-executable`, 50_472),
    appAsar: artifact('app.asar', `${seed}-app-asar`, 37_347_710),
    releaseIdentity: artifact(
      'release-identity.exact.json',
      `${seed}-release-identity`,
      223,
    ),
    sourceSnapshot: {
      ...artifact('source-snapshot', `${seed}-snapshot`, 3_053_393),
      fileCount: 304,
      algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
      manifest: artifact('source-snapshot-inputs.json', `${seed}-manifest`, 58_185),
      canonicalManifest: artifact(
        'CANONICAL-MANIFEST.json',
        `${seed}-canonical-manifest`,
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

function record({
  contract,
  raw,
  index,
  capturedAt = captures[index],
  thresholdPass = true,
}: {
  contract: Json;
  raw: string;
  index: number;
  capturedAt?: string;
  thresholdPass?: boolean;
}): Json {
  const seed = contract.contractVersion ?? 'r22-v3';
  const binding = candidateBinding(contract.candidate, seed);
  const entry = generatedEntry(seed);
  const executed = executedHarnessBinding(seed);
  const launchMs = thresholdPass ? 1_200 : 2_000;
  return {
    schemaVersion: contract.rawSchemaVersion,
    capturedAt,
    source: contract.rawSource,
    runtime: {
      mode: 'packaged',
      launchBinding: 'executablePath',
      executable: clone(binding.executable),
      skipBuild: true,
    },
    harness: {
      sourceMode: 'snapshot-component-with-resolved-installed-inputs',
      authoritativeExecutedBuild: authoritativeExecutedBuild(seed),
      executedHarnessBinding: executed,
      generatedEntry: entry,
      inputProvenance: {
        authority: 'non-authoritative-post-build-provenance',
        note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
        component: {
          source: 'candidate-snapshot',
          logicalPath: 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx',
          bytes: 5_205,
          sha256: sha(`${seed}-component`),
        },
        dependencies: {
          source: 'resolved-installed-inputs',
          inputCount: 29,
          digest: sha(`${seed}-dependencies`),
        },
        buildInputs: {
          inputCount: 40,
          digest: sha(`${seed}-build-inputs`),
          generatedEntry: entry,
        },
        snapshotPackageLock: {
          present: true,
          bytes: 481_226,
          sha256: sha(`${seed}-package-lock`),
        },
      },
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
      diagnostics: startupDiagnostics(),
      transport: {
        type: 'fresh-profile-write-once-files',
        challengeRedacted: true,
        pathsRedacted: true,
      },
    },
    runtimeProbe: {
      collectPublishedAfterLaunchFreeze: true,
      appMetricsCollectedBeforeKg: true,
      sameCandidatePid: true,
      metricsObservedAfterGateMs: 481.34,
      runBinding: {
        rawBasename: raw,
        ordinal: index + 1,
        challengeSha256: sha(`${seed}-challenge-${index + 1}`),
      },
    },
    knowledgeGraph100: {
      nodeCount: 100,
      edgeCount: 157,
      sampleMs: 1_500,
      frames: 90,
      fps: 60,
    },
    thresholds: {
      launchUnderMs: 2_000,
      memoryUnderMb: 500,
      kgFpsAtLeast: 30,
      kgNodeCount: 100,
    },
    processCleanup: { trackedPidCount: 5, remainingPidCount: 0, pass: true },
    pass: thresholdPass,
  };
}

const R22 = {
  candidate: 'v6.2-phase1-candidate-r22',
  rawSchemaVersion: 3,
  rawSource: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts',
  rawBasenames: [
    'performance-raw1-r22.json',
    'performance-raw2-r22.json',
    'performance-raw3-r22.json',
  ],
};

function candidateBoundContract(revision: number): Json {
  const contractVersion = `r${revision}-v1`;
  return validateDirectPerformanceContractDescriptor({
    contractVersion,
    candidate: `v6.2-phase1-candidate-r${revision}`,
    rawSchemaVersion: 4,
    rawSource:
      `direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts-${contractVersion}`,
    rawBasenames: [1, 2, 3].map((ordinal) => (
      `performance-raw${ordinal}-${contractVersion}.json`
    )),
    aggregateBasename: `performance-aggregate-${contractVersion}.json`,
    executableBasenames: [...CONTRACT.executableBasenames],
    bindingMode: `${contractVersion}-complete-candidate-harness-provenance`,
  });
}

const WRONG_REVISION_CONTRACT = candidateBoundContract(32);

function rawInputs(
  mutator?: (records: Json[]) => void,
  contract: Json = CONTRACT,
): Array<{ basename: string; bytes: Buffer }> {
  const records = contract.rawBasenames.map((raw: string, index: number) => (
    record({ contract, raw, index })
  ));
  mutator?.(records);
  return records.map((value: Json, index: number) => ({
    basename: contract.rawBasenames[index],
    bytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
  }));
}

function acceptsR31(inputs: Array<{ basename: string; bytes: Buffer }>): boolean {
  try {
    return aggregateCandidateBoundDirectPerformanceRawBytes(CONTRACT, inputs)?.pass === true;
  } catch {
    return false;
  }
}

async function runNode(args: string[], cwd = repoRoot) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const authorizationRelativePath =
  'tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/protected-performance-contract-r31-authorization-proposal.md';
const authorizationSha256 = '25f2deeb2e3cdf0fd8fd28c4763fcfcaad8b07c1645b85ac3c3ca957cddc4fe9';
const protectedPreimageSha256 = '58213a6d690e76f9abea8b0d06ea1bf6cbf30a24de9e801d052295bdac6cd275';
const performanceMarkerKeys = [
  'schemaVersion',
  'status',
  'ownerApproved',
  'candidate',
  'contractVersion',
  'authorizationPath',
  'authorizationSha256',
  'protectedPreimageSha256',
].sort();

function performanceMarker(overrides: Json = {}): Json {
  return {
    schemaVersion: 'r31-v1',
    status: 'APPROVED',
    ownerApproved: true,
    candidate: CONTRACT.candidate,
    contractVersion: CONTRACT.contractVersion,
    authorizationPath: authorizationRelativePath,
    authorizationSha256,
    protectedPreimageSha256,
    ...overrides,
  };
}

function wrongRevisionMarkerFixture() {
  const protectedPreimageBytes = Buffer.from(
    `${WRONG_REVISION_CONTRACT.contractVersion}:synthetic-protected-preimage:test-only\n`,
  );
  const wrongProtectedPreimageSha256 = sha(protectedPreimageBytes);
  const wrongAuthorizationPath =
    `tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/protected-performance-contract-${WRONG_REVISION_CONTRACT.contractVersion}-synthetic-authorization.json`;
  const authorizationProposal = {
    schemaVersion: WRONG_REVISION_CONTRACT.contractVersion,
    authorizationType: 'synthetic-wrong-revision-readiness-marker-test-only',
    status: 'APPROVED',
    ownerApproved: true,
    candidate: WRONG_REVISION_CONTRACT.candidate,
    contractVersion: WRONG_REVISION_CONTRACT.contractVersion,
    protectedPreimageSha256: wrongProtectedPreimageSha256,
  };
  const authorizationBytes = Buffer.from(`${JSON.stringify(authorizationProposal, null, 2)}\n`);
  return {
    marker: {
      schemaVersion: WRONG_REVISION_CONTRACT.contractVersion,
      status: authorizationProposal.status,
      ownerApproved: authorizationProposal.ownerApproved,
      candidate: WRONG_REVISION_CONTRACT.candidate,
      contractVersion: WRONG_REVISION_CONTRACT.contractVersion,
      authorizationPath: wrongAuthorizationPath,
      authorizationSha256: sha(authorizationBytes),
      protectedPreimageSha256: wrongProtectedPreimageSha256,
    },
    authorizationProposal,
    authorizationBytes,
    protectedPreimageBytes,
  };
}

function isSelfConsistentRevisionMarkerFixture(fixture: Json, contract: Json): boolean {
  const marker = fixture.marker;
  const proposal = JSON.parse(fixture.authorizationBytes.toString('utf8'));
  return JSON.stringify(Object.keys(marker).sort()) === JSON.stringify(performanceMarkerKeys)
    && marker.schemaVersion === contract.contractVersion
    && marker.status === 'APPROVED'
    && marker.ownerApproved === true
    && marker.candidate === contract.candidate
    && marker.contractVersion === contract.contractVersion
    && marker.authorizationPath.endsWith(
      `protected-performance-contract-${contract.contractVersion}-synthetic-authorization.json`,
    )
    && marker.authorizationSha256 === sha(fixture.authorizationBytes)
    && marker.protectedPreimageSha256 === sha(fixture.protectedPreimageBytes)
    && JSON.stringify(proposal) === JSON.stringify(fixture.authorizationProposal)
    && proposal.schemaVersion === contract.contractVersion
    && proposal.authorizationType === 'synthetic-wrong-revision-readiness-marker-test-only'
    && proposal.status === marker.status
    && proposal.ownerApproved === marker.ownerApproved
    && proposal.candidate === marker.candidate
    && proposal.contractVersion === marker.contractVersion
    && proposal.protectedPreimageSha256 === marker.protectedPreimageSha256;
}

async function readinessWorkspace({
  marker = performanceMarker(),
  markerSymlink = false,
  authorizationBytes,
  authorizationTargetRelativePath = authorizationRelativePath,
  authorizationMissing = false,
  authorizationSymlink = false,
  consumeCandidate = false,
  consumeEvidence = false,
}: {
  marker?: Json | null;
  markerSymlink?: boolean;
  authorizationBytes?: Buffer;
  authorizationTargetRelativePath?: string;
  authorizationMissing?: boolean;
  authorizationSymlink?: boolean;
  consumeCandidate?: boolean;
  consumeEvidence?: boolean;
} = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'r31-readiness-current-'));
  tempRoots.push(workspace);
  const localTaskDir = path.join(
    workspace,
    'tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover',
  );
  const inputDir = path.join(localTaskDir, 'readiness-inputs');
  await mkdir(inputDir, { recursive: true });
  const authorizationPath = path.join(workspace, authorizationTargetRelativePath);
  if (!authorizationMissing) {
    await mkdir(path.dirname(authorizationPath), { recursive: true });
    const proposalBytes = authorizationBytes ?? await readFile(path.join(repoRoot, authorizationRelativePath));
    if (authorizationSymlink) {
      const target = path.join(path.dirname(authorizationPath), 'authorization-target.md');
      await writeFile(target, proposalBytes);
      await symlink(target, authorizationPath);
    } else {
      await writeFile(authorizationPath, proposalBytes);
    }
  }
  if (marker !== null) {
    const markerPath = path.join(inputDir, 'PERFORMANCE_BINDING_R31_V1.json');
    if (markerSymlink) {
      const target = path.join(inputDir, 'marker-target.json');
      await writeFile(target, `${JSON.stringify(marker, null, 2)}\n`);
      await symlink(target, markerPath);
    } else {
      await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    }
  }
  if (consumeCandidate) {
    await mkdir(path.join(
      workspace,
      'apps/copilot-desktop/release',
      CONTRACT.candidate,
    ), { recursive: true });
  }
  if (consumeEvidence) {
    const evidenceDir = path.join(localTaskDir, 'evidence/r31-v1-performance');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, CONTRACT.rawBasenames[0]), '{}\n');
  }
  const output = path.join(localTaskDir, `readiness-${Date.now()}-${Math.random()}.json`);
  const result = await runNode([
    readinessChecker,
    '--task-dir', localTaskDir,
    '--workspace', workspace,
    '--output', output,
  ], workspace);
  return { result, report: JSON.parse(await readFile(output, 'utf8')) };
}

function performanceCheck(report: Json): Json {
  return report.checks.find((check: Json) => check.id === 'performanceBinding');
}

describe('r31-v1 candidate-bound performance contract', () => {
  it('freezes one exact descriptor and rejects coercion, unknown fields, unsafe or duplicate names', () => {
    expect(Object.isFrozen(CONTRACT)).toBe(true);
    expect(Object.isFrozen(CONTRACT.rawBasenames)).toBe(true);
    expect(() => validateDirectPerformanceContractDescriptor({
      ...CONTRACT,
      contractVersion: ['r31-v1'],
    })).toThrow();
    expect(() => validateDirectPerformanceContractDescriptor({ ...CONTRACT, extra: true })).toThrow();
    expect(() => validateDirectPerformanceContractDescriptor({
      ...CONTRACT,
      rawBasenames: [CONTRACT.rawBasenames[0], CONTRACT.rawBasenames[0], CONTRACT.rawBasenames[2]],
    })).toThrow();
    expect(() => validateDirectPerformanceContractDescriptor({
      ...CONTRACT,
      rawBasenames: [...CONTRACT.rawBasenames].reverse(),
    })).toThrow();
    expect(() => validateDirectPerformanceContractDescriptor({
      ...CONTRACT,
      aggregateBasename: 'performance-aggregate-r31-v2.json',
    })).toThrow();
    const wrongRevisionInputs = rawInputs(undefined, WRONG_REVISION_CONTRACT);
    expect(aggregateCandidateBoundDirectPerformanceRawBytes(
      WRONG_REVISION_CONTRACT,
      wrongRevisionInputs,
    ).pass).toBe(true);
    expect(() => aggregateCandidateBoundDirectPerformanceRawBytes(
      CONTRACT,
      wrongRevisionInputs,
    )).toThrow();
  });

  it('keeps r22 and r31 mutually exclusive while r31 hashes the actual canonical bytes', () => {
    const inputs = rawInputs();
    const aggregate = aggregateCandidateBoundDirectPerformanceRawBytes(CONTRACT, inputs);
    expect(aggregate).toMatchObject({
      contractVersion: 'r31-v1',
      candidate: 'v6.2-phase1-candidate-r31',
      bindingMode: 'r31-v1-complete-candidate-harness-provenance',
      pass: true,
    });
    expect(aggregate.rawByteBindings).toEqual(inputs.map((input, index) => ({
      basename: input.basename,
      ordinal: index + 1,
      bytes: input.bytes.byteLength,
      sha256: sha(input.bytes),
    })));
    const r22Pairs = R22.rawBasenames.map((raw, index) => ({
      raw,
      record: record({ contract: R22, raw, index }),
    }));
    expect(aggregateDirectPerformanceRuns(r22Pairs).pass).toBe(true);
    expect(() => aggregateDirectPerformanceRuns(inputs.map((input) => ({
      raw: input.basename,
      record: JSON.parse(input.bytes.toString('utf8')),
    })))).toThrow();
    expect(() => aggregateCandidateBoundDirectPerformanceRawBytes(CONTRACT, r22Pairs.map((pair) => ({
      basename: pair.raw,
      bytes: Buffer.from(`${JSON.stringify(pair.record, null, 2)}\n`),
    })))).toThrow();
  });

  it('binds primitive challenges, exact ordered names, ordinals, distinct hashes and increasing clocks', () => {
    const challenge = '01'.repeat(32);
    expect(createCandidateBoundDirectPerformanceRunBinding(CONTRACT, {
      challenge,
      outputPath: path.join(os.tmpdir(), CONTRACT.rawBasenames[0]),
    })).toEqual({
      rawBasename: CONTRACT.rawBasenames[0],
      ordinal: 1,
      challengeSha256: sha(Buffer.from(challenge, 'hex')),
    });
    expect(() => createCandidateBoundDirectPerformanceRunBinding(CONTRACT, {
      challenge: [challenge],
      outputPath: path.join(os.tmpdir(), CONTRACT.rawBasenames[0]),
    })).toThrow();
    expect(() => createR22DirectPerformanceRunBinding({
      challenge,
      outputPath: path.join(os.tmpdir(), CONTRACT.rawBasenames[0]),
    })).toThrow();
    expect(acceptsR31(rawInputs((records) => {
      records[1].runtimeProbe.runBinding.challengeSha256 =
        records[0].runtimeProbe.runBinding.challengeSha256;
    }))).toBe(false);
    expect(acceptsR31(rawInputs((records) => {
      records[1].runtimeProbe.runBinding.ordinal = 1;
    }))).toBe(false);
    expect(acceptsR31(rawInputs((records) => {
      records[1].runtimeProbe.runBinding.challengeSha256 = ['a'.repeat(64)];
    }))).toBe(false);
    for (const invalidHash of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(acceptsR31(rawInputs((records) => {
        records[1].runtimeProbe.runBinding.challengeSha256 = invalidHash;
      }))).toBe(false);
    }
    expect(acceptsR31(rawInputs((records) => {
      records[1].runtimeProbe.runBinding.rawBasename = CONTRACT.rawBasenames[0];
    }))).toBe(false);
    const wrongOrder = rawInputs();
    [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];
    expect(acceptsR31(wrongOrder)).toBe(false);
    expect(acceptsR31(rawInputs((records) => {
      records[1].capturedAt = records[0].capturedAt;
    }))).toBe(false);
    expect(acceptsR31(rawInputs((records) => {
      records[2].capturedAt = '2999-01-01T00:00:00.000Z';
    }))).toBe(false);
  });

  it('fails closed on candidate, artifact, manifest and complete harness provenance drift', () => {
    const mutations = [
      (record: Json) => { record.candidateBinding.candidate = 'v6.2-phase1-candidate-r30'; },
      (record: Json) => { record.candidateBinding.executable.sha256 = sha('drift'); },
      (record: Json) => { record.candidateBinding.appAsar.bytes += 1; },
      (record: Json) => { record.candidateBinding.releaseIdentity.basename = 'other.json'; },
      (record: Json) => { record.candidateBinding.sourceSnapshot.fileCount += 1; },
      (record: Json) => { record.candidateBinding.sourceSnapshot.algorithm = 'sha256-other'; },
      (record: Json) => { record.candidateBinding.sourceSnapshot.manifest.sha256 = sha('drift'); },
      (record: Json) => { record.candidateBinding.sourceSnapshot.canonicalManifest.sha256 = sha('drift'); },
      (record: Json) => { record.harness.authoritativeExecutedBuild.files[0].sha256 = sha('drift'); },
      (record: Json) => { record.harness.authoritativeExecutedBuild.digest = sha('drift'); },
      (record: Json) => { record.harness.executedHarnessBinding.files[0].bytes += 1; },
      (record: Json) => { record.harness.executedHarnessBinding.digest = sha('drift'); },
      (record: Json) => { record.harness.generatedEntry.sourcefile = 'other.tsx'; },
      (record: Json) => { record.harness.inputProvenance.component.sha256 = sha('drift'); },
      (record: Json) => { record.harness.inputProvenance.dependencies.digest = sha('drift'); },
      (record: Json) => { record.harness.inputProvenance.buildInputs.digest = sha('drift'); },
      (record: Json) => { record.harness.inputProvenance.buildInputs.generatedEntry.bytes += 1; },
      (record: Json) => { record.harness.inputProvenance.snapshotPackageLock.sha256 = sha('drift'); },
      (record: Json) => { record.harness.inputProvenance.snapshotPackageLock.present = false; },
    ];
    for (const mutate of mutations) {
      expect(acceptsR31(rawInputs((records) => mutate(records[1])))).toBe(false);
    }
  });

  it('rejects compact, CRLF, missing/extra LF, trailing space, duplicate field and byte substitution', () => {
    const variants = rawInputs();
    const parsed = JSON.parse(variants[0].bytes.toString('utf8'));
    const invalidBytes = [
      Buffer.from(JSON.stringify(parsed)),
      Buffer.from(`${JSON.stringify(parsed, null, 2).replace(/\n/g, '\r\n')}\r\n`),
      Buffer.from(JSON.stringify(parsed, null, 2)),
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n\n`),
      Buffer.from(`${JSON.stringify(parsed, null, 2)} \n`),
      Buffer.from(`{"schemaVersion":4,"schemaVersion":4,"capturedAt":"${captures[0]}"}\n`),
    ];
    for (const bytes of invalidBytes) {
      const mutated = rawInputs();
      mutated[0] = { ...mutated[0], bytes };
      expect(acceptsR31(mutated)).toBe(false);
    }
    const substituted = rawInputs();
    substituted[0] = { ...substituted[0], bytes: Buffer.from(substituted[1].bytes) };
    expect(acceptsR31(substituted)).toBe(false);
  });

  it('publishes production-writer raws as private single-link canonical inputs and keeps no-overwrite', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'r31-writer-'));
    tempRoots.push(root);
    const inputs = rawInputs();
    const originalUmask = process.platform === 'win32' ? null : process.umask(0o022);
    try {
      for (let index = 0; index < inputs.length; index += 1) {
        const outputPath = path.join(root, CONTRACT.rawBasenames[index]);
        await writePerformanceEvidence({
          outputPath,
          outputMode: 'external-non-overwriting',
        }, inputs[index].bytes.toString('utf8'));
        const stat = await lstat(outputPath);
        expect(stat.isFile()).toBe(true);
        expect(stat.nlink).toBe(1);
        if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600);
        expect(await readFile(outputPath)).toEqual(inputs[index].bytes);
      }
      await expect(writePerformanceEvidence({
        outputPath: path.join(root, CONTRACT.rawBasenames[0]),
        outputMode: 'external-non-overwriting',
      }, '{}\n')).rejects.toMatchObject({
        code: 'BLOCKED_ELECTRON_PERF_OUTPUT_PATH_ALREADY_EXISTS',
      });
    } finally {
      if (originalUmask !== null) process.umask(originalUmask);
    }
  });

  it('CLI accepts only private ordered raws and publishes one private canonical aggregate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'r31-cli-'));
    tempRoots.push(root);
    const inputs = rawInputs();
    const rawPaths = [];
    for (const input of inputs) {
      const filePath = path.join(root, input.basename);
      await writeFile(filePath, input.bytes, { mode: 0o600 });
      await chmod(filePath, 0o600);
      rawPaths.push(filePath);
    }
    const output = path.join(root, CONTRACT.aggregateBasename);
    const success = await runNode([aggregateCli, output, ...rawPaths]);
    expect(success.code).toBe(0);
    const outputStat = await lstat(output);
    expect(outputStat.nlink).toBe(1);
    if (process.platform !== 'win32') expect(outputStat.mode & 0o777).toBe(0o600);
    expect(await readFile(output, 'utf8')).toBe(
      `${JSON.stringify(JSON.parse(await readFile(output, 'utf8')), null, 2)}\n`,
    );
    const original = await readFile(output);
    const duplicate = await runNode([aggregateCli, output, ...rawPaths]);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT_EXISTS');
    expect(await readFile(output)).toEqual(original);
  });

  it('CLI rejects public, symlink, hardlink and directory raws without modifying them', async () => {
    if (process.platform === 'win32') return;
    const attacks = ['public', 'symlink', 'hardlink', 'directory'] as const;
    for (const attack of attacks) {
      const root = await mkdtemp(path.join(os.tmpdir(), `r31-${attack}-`));
      tempRoots.push(root);
      const inputs = rawInputs();
      const rawPaths = [];
      for (const input of inputs) {
        const filePath = path.join(root, input.basename);
        await writeFile(filePath, input.bytes, { mode: 0o600 });
        await chmod(filePath, 0o600);
        rawPaths.push(filePath);
      }
      if (attack === 'public') await chmod(rawPaths[0], 0o644);
      if (attack === 'symlink') {
        const target = path.join(root, 'target.json');
        await writeFile(target, inputs[0].bytes, { mode: 0o600 });
        await rm(rawPaths[0]);
        await symlink(target, rawPaths[0]);
      }
      if (attack === 'hardlink') {
        await link(rawPaths[0], path.join(root, 'extra-link.json'));
      }
      if (attack === 'directory') {
        await rm(rawPaths[0]);
        await (await import('node:fs/promises')).mkdir(rawPaths[0]);
      }
      const before = attack === 'directory' ? null : await readFile(rawPaths[0]);
      const result = await runNode([
        aggregateCli,
        path.join(root, CONTRACT.aggregateBasename),
        ...rawPaths,
      ]);
      expect(result.code).toBe(1);
      if (before) expect(await readFile(rawPaths[0])).toEqual(before);
    }
  });

  it('CLI rejects oversize raws plus aggregate-output symlink/hardlink attacks without overwrite', async () => {
    if (process.platform === 'win32') return;
    const oversizeRoot = await mkdtemp(path.join(os.tmpdir(), 'r31-oversize-'));
    tempRoots.push(oversizeRoot);
    const oversizeInputs = rawInputs();
    const oversizePaths = [];
    for (let index = 0; index < oversizeInputs.length; index += 1) {
      const filePath = path.join(oversizeRoot, oversizeInputs[index].basename);
      const bytes = index === 0 ? Buffer.alloc(1024 * 1024 + 1, 0x20) : oversizeInputs[index].bytes;
      await writeFile(filePath, bytes, { mode: 0o600 });
      await chmod(filePath, 0o600);
      oversizePaths.push(filePath);
    }
    const oversizeOutput = path.join(oversizeRoot, CONTRACT.aggregateBasename);
    const oversizeBefore = await readFile(oversizePaths[0]);
    const oversizeResult = await runNode([aggregateCli, oversizeOutput, ...oversizePaths]);
    expect(oversizeResult.code).toBe(1);
    expect(oversizeResult.stderr).toContain('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW');
    expect(await readFile(oversizePaths[0])).toEqual(oversizeBefore);
    await expect(lstat(oversizeOutput)).rejects.toMatchObject({ code: 'ENOENT' });

    for (const attack of ['symlink', 'hardlink'] as const) {
      const root = await mkdtemp(path.join(os.tmpdir(), `r31-output-${attack}-`));
      tempRoots.push(root);
      const inputs = rawInputs();
      const rawPaths = [];
      for (const input of inputs) {
        const filePath = path.join(root, input.basename);
        await writeFile(filePath, input.bytes, { mode: 0o600 });
        await chmod(filePath, 0o600);
        rawPaths.push(filePath);
      }
      const output = path.join(root, CONTRACT.aggregateBasename);
      const protectedTarget = path.join(root, 'protected-target.json');
      const protectedBytes = Buffer.from('{"protected":true}\n');
      await writeFile(protectedTarget, protectedBytes, { mode: 0o600 });
      if (attack === 'symlink') await symlink(protectedTarget, output);
      else await link(protectedTarget, output);
      const result = await runNode([aggregateCli, output, ...rawPaths]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT_EXISTS');
      expect(await readFile(protectedTarget)).toEqual(protectedBytes);
      expect(await readFile(output)).toEqual(protectedBytes);
    }
  });

  it('statically requires bounded complete reads and before/after metadata equality for mid-read mutation', async () => {
    const cli = await readFile(aggregateCli, 'utf8');
    expect(cli).toContain('const MAX_RAW_BYTES = 1024 * 1024;');
    expect(cli).toContain('while (offset < contents.byteLength)');
    for (const field of ['dev', 'ino', 'size', 'mode', 'mtimeMs', 'ctimeMs']) {
      expect(cli).toContain(`before.${field} !== after.${field}`);
    }
    expect(cli).toContain("fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_CHANGED')");
  });

  it('detects a raw whose metadata changes while the CLI is opening/reading it', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'r31-mid-read-'));
    tempRoots.push(root);
    const inputs = rawInputs();
    const rawPaths: string[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const filePath = path.join(root, inputs[index].basename);
      const bytes = index === 0 ? Buffer.alloc(900_000, 0x20) : inputs[index].bytes;
      await writeFile(filePath, bytes, { mode: 0o600 });
      await chmod(filePath, 0o600);
      rawPaths.push(filePath);
    }
    const child = spawn(process.execPath, [
      aggregateCli,
      path.join(root, CONTRACT.aggregateBasename),
      ...rawPaths,
    ], { cwd: repoRoot, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    let tick = 0;
    const mutations = new Set<Promise<unknown>>();
    const timer = setInterval(() => {
      tick += 1;
      const time = new Date(Date.now() + tick * 1_000);
      const mutation = utimes(rawPaths[0], time, time).catch(() => undefined);
      mutations.add(mutation);
      void mutation.finally(() => mutations.delete(mutation));
    }, 1);
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    clearInterval(timer);
    await Promise.all(mutations);
    expect(code).toBe(1);
    expect(stderr).toContain('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_CHANGED');
  });

  it('creates pass:false with exit 2 for truthful threshold failure but no aggregate for structure failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'r31-threshold-'));
    tempRoots.push(root);
    const thresholdInputs = rawInputs((records) => {
      records[1].app.launchMs = 2_000;
      records[1].app.outerControllerLaunchMs = 2_000;
      records[1].app.directSpawnLaunchMs = 2_000;
      records[1].startup.readyObservedAtControllerMs = 2_000;
      records[1].pass = false;
    });
    const rawPaths = [];
    for (const input of thresholdInputs) {
      const filePath = path.join(root, input.basename);
      await writeFile(filePath, input.bytes, { mode: 0o600 });
      await chmod(filePath, 0o600);
      rawPaths.push(filePath);
    }
    const thresholdOutput = path.join(root, CONTRACT.aggregateBasename);
    expect((await runNode([aggregateCli, thresholdOutput, ...rawPaths])).code).toBe(2);
    expect(JSON.parse(await readFile(thresholdOutput, 'utf8')).pass).toBe(false);

    const structuralRoot = await mkdtemp(path.join(os.tmpdir(), 'r31-structural-'));
    tempRoots.push(structuralRoot);
    const structuralInputs = rawInputs((records) => {
      records[1].candidateBinding.candidate = 'v6.2-phase1-candidate-r30';
    });
    const structuralPaths = [];
    for (const input of structuralInputs) {
      const filePath = path.join(structuralRoot, input.basename);
      await writeFile(filePath, input.bytes, { mode: 0o600 });
      await chmod(filePath, 0o600);
      structuralPaths.push(filePath);
    }
    const structuralOutput = path.join(structuralRoot, CONTRACT.aggregateBasename);
    expect((await runNode([aggregateCli, structuralOutput, ...structuralPaths])).code).toBe(1);
    await expect(lstat(structuralOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('versioned readiness fixtures prove BLOCKED, READY, duplicate output and private mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'r31-readiness-'));
    tempRoots.push(root);
    const blockedOutput = path.join(root, 'blocked.json');
    const readyOutput = path.join(root, 'ready.json');
    const blocked = await runNode([
      readinessChecker,
      '--task-dir', root,
      '--workspace', repoRoot,
      '--fixture', path.join(taskDir, 'fixtures/final-candidate-readiness-r31-v1/blocked-case.json'),
      '--output', blockedOutput,
    ]);
    const ready = await runNode([
      readinessChecker,
      '--task-dir', root,
      '--workspace', repoRoot,
      '--fixture', path.join(taskDir, 'fixtures/final-candidate-readiness-r31-v1/ready-case.json'),
      '--output', readyOutput,
    ]);
    expect(blocked.code).toBe(2);
    expect(ready.code).toBe(0);
    expect(JSON.parse(await readFile(blockedOutput, 'utf8')).status).toBe('BLOCKED');
    expect(JSON.parse(await readFile(readyOutput, 'utf8')).status).toBe('READY');
    if (process.platform !== 'win32') {
      expect((await lstat(blockedOutput)).mode & 0o777).toBe(0o600);
      expect((await lstat(readyOutput)).mode & 0o777).toBe(0o600);
    }
    expect((await runNode([
      readinessChecker,
      '--task-dir', root,
      '--workspace', repoRoot,
      '--fixture', path.join(taskDir, 'fixtures/final-candidate-readiness-r31-v1/ready-case.json'),
      '--output', readyOutput,
    ])).code).toBe(1);
  });

  it('current readiness binds authorization/hash/preimage/path/marker and rejects consumed targets', async () => {
    const valid = await readinessWorkspace();
    expect(valid.result.code).toBe(2);
    expect(performanceCheck(valid.report)).toMatchObject({ state: 'PASS' });

    const wrongRevision = wrongRevisionMarkerFixture();
    expect(isSelfConsistentRevisionMarkerFixture(
      wrongRevision,
      WRONG_REVISION_CONTRACT,
    )).toBe(true);
    const wrongRevisionRejectedByExactR31 = await readinessWorkspace({
      marker: wrongRevision.marker,
      authorizationBytes: wrongRevision.authorizationBytes,
      authorizationTargetRelativePath: wrongRevision.marker.authorizationPath,
    });

    const cases = [
      await readinessWorkspace({ marker: null }),
      await readinessWorkspace({ authorizationMissing: true }),
      await readinessWorkspace({ authorizationSymlink: true }),
      await readinessWorkspace({ authorizationBytes: Buffer.from('drifted authorization\n') }),
      await readinessWorkspace({ marker: performanceMarker({ authorizationSha256: 'a'.repeat(64) }) }),
      await readinessWorkspace({ marker: performanceMarker({ protectedPreimageSha256: 'b'.repeat(64) }) }),
      await readinessWorkspace({ marker: performanceMarker({ authorizationPath: '../escape.md' }) }),
      await readinessWorkspace({ markerSymlink: true }),
      await readinessWorkspace({ marker: performanceMarker({ candidate: 'v6.2-phase1-candidate-r30' }) }),
      wrongRevisionRejectedByExactR31,
      await readinessWorkspace({ consumeCandidate: true }),
      await readinessWorkspace({ consumeEvidence: true }),
    ];
    for (const item of cases) {
      expect(item.result.code).toBe(2);
      expect(performanceCheck(item.report)).toMatchObject({ state: 'BLOCKED' });
    }
  });

  it('statically binds the new runner/CLI and preserves all protected legacy files byte-identical', async () => {
    const [runner, cli] = await Promise.all([
      readFile(runnerPath, 'utf8'),
      readFile(aggregateCli, 'utf8'),
    ]);
    expect(runner).toContain('createCandidateBoundDirectPerformanceRunBinding(CONTRACT');
    expect(runner).toContain('await writePerformanceEvidence(');
    expect(runner).toContain('schemaVersion: CONTRACT.rawSchemaVersion');
    expect(cli).toContain('aggregateCandidateBoundDirectPerformanceRawBytes(CONTRACT, rawInputs)');
    const legacyHashes = {
      runner: sha(await readFile(path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'))),
      cli: sha(await readFile(path.join(desktopRoot, 'scripts/aggregate-electron-direct-performance.mjs'))),
      test: sha(await readFile(path.join(desktopRoot, 'tests/r22-v3-run-identity-evidence-adversarial.test.ts'))),
      checker: sha(await readFile(path.join(taskDir, 'scripts/check-final-candidate-readiness.mjs'))),
    };
    expect(legacyHashes).toEqual({
      runner: '5d31d651be00cda48edabdefa2bdd1edc9e319e20bb0c8af61ed2e4de0fab61f',
      cli: 'fa8c312582a8eeafb01c6ae9cb307521ec54a016b2c59159b06b4c43c001e9d8',
      test: '040f46df0f27679e24e5e4db7f68a2eef4ec98ea53b71ad3fee5e5a0ea4d6bf9',
      checker: '4c5011a6b377f4c0833a24c6865276c9ff286c08f194af09b4dd0060cb8da892',
    });
  });
});
