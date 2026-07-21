// @vitest-environment node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-ignore JavaScript release helpers are exercised directly by Vitest.
import { aggregateDirectPerformanceRuns, validateMetricsRecord } from '../scripts/direct-performance-config.mjs';
// @ts-ignore JavaScript release helpers are exercised directly by Vitest.
import { createStartupMilestoneReport } from '../scripts/performance-config.mjs';

type Json = Record<string, any>;

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aggregateCliPath = path.join(
  desktopRoot,
  'scripts/aggregate-electron-direct-performance.mjs',
);
const rawBasenames = [
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
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
    sha256: sha('r22-generated-entry'),
  };
}

function executedHarnessBinding(): Json {
  const files = [
    { logicalName: 'bundle.css', bytes: 3_832, sha256: sha('r22-bundle-css') },
    { logicalName: 'bundle.js', bytes: 1_484_112, sha256: sha('r22-bundle-js') },
    { logicalName: 'index.html', bytes: 154, sha256: sha('r22-index-html') },
  ];
  return { schemaVersion: 1, files, digest: digestExecutedFiles(files) };
}

function authoritativeExecutedBuild(): Json {
  const files = [
    { basename: 'bundle.css', bytes: 3_832, sha256: sha('r22-bundle-css') },
    { basename: 'bundle.js', bytes: 1_484_112, sha256: sha('r22-bundle-js') },
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
      sha256: sha('r22-kg-component'),
    },
    dependencies: {
      source: 'resolved-installed-inputs',
      inputCount: 29,
      digest: sha('r22-resolved-dependencies'),
    },
    buildInputs: {
      inputCount: 40,
      digest: sha('r22-build-inputs'),
      generatedEntry: entry,
    },
    snapshotPackageLock: {
      present: true,
      bytes: 481_226,
      sha256: sha('r22-snapshot-package-lock'),
    },
  };
}

function candidateBinding(candidate = 'v6.2-phase1-candidate-r22'): Json {
  return {
    candidate,
    executable: artifact('njx-copilot-v6', 'r22-executable', 50_472),
    appAsar: artifact('app.asar', 'r22-app-asar', 37_347_710),
    releaseIdentity: artifact('release-identity.exact.json', 'r22-release-identity', 223),
    sourceSnapshot: {
      ...artifact('source-snapshot', 'r22-source-snapshot', 3_053_393),
      fileCount: 304,
      algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
      manifest: artifact('source-snapshot-inputs.json', 'r22-source-manifest', 58_185),
      canonicalManifest: artifact('CANONICAL-MANIFEST.json', 'r22-canonical-manifest', 47_990),
    },
  };
}

function milestoneValues(readyToShowObserved = true): Json {
  return {
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
    readyToShow: readyToShowObserved
      ? { offsetMs: 17, reason: null }
      : { offsetMs: null, reason: 'ready-to-show-event-not-observed' },
    rendererShellCommit: { offsetMs: 18, reason: null },
    appRootVisible: { offsetMs: 19, reason: null },
    terminalReady: { offsetMs: 20, reason: null },
  };
}

function startupDiagnostics(readyToShowObserved = false): Json {
  return {
    clock: 'candidate-process-monotonic-diagnostic-only',
    milestones: milestoneValues(readyToShowObserved),
  };
}

function realRecord(
  raw: string,
  candidate = 'v6.2-phase1-candidate-r22',
): Json {
  const rawIndex = rawBasenames.indexOf(raw as (typeof rawBasenames)[number]);
  const ordinal = rawIndex >= 0 ? rawIndex + 1 : 4;
  const binding = candidateBinding(candidate);
  const entry = generatedEntry();
  const executed = executedHarnessBinding();
  return {
    schemaVersion: 3,
    capturedAt: `2026-07-13T01:00:0${ordinal}.000Z`,
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
    runtimeProbe: {
      runBinding: {
        rawBasename: raw,
        ordinal,
        challengeSha256: sha(`r22-direct-run-challenge-${ordinal}`),
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
    pass: true,
  };
}

function realPair(raw: string, candidate = 'v6.2-phase1-candidate-r22'): Json {
  return { raw, record: realRecord(raw, candidate) };
}

function threeRealPairs(candidate = 'v6.2-phase1-candidate-r22'): Json[] {
  return rawBasenames.map((raw) => realPair(raw, candidate));
}

function slimCandidateBinding(candidate = 'v6.2-phase1-candidate-r22'): Json {
  const binding = candidateBinding(candidate);
  binding.sourceSnapshot = artifact('source-snapshot', 'r22-source-snapshot', 3_053_393);
  return binding;
}

function slimHarness(): Json {
  const entry = generatedEntry();
  return {
    executedHarnessBinding: executedHarnessBinding(),
    generatedEntry: entry,
    inputProvenance: inputProvenance(entry),
  };
}

function oldFlatRun(
  raw: string,
  candidate = 'v6.2-phase1-candidate-r22',
): Json {
  return {
    raw,
    directSpawnLaunchMs: 1_200,
    residentSetMb: 350,
    nodeCount: 100,
    fps: 60,
    terminal: true,
    candidateStable: true,
    harnessStable: true,
    processTreeZero: true,
    pass: true,
    candidateBinding: slimCandidateBinding(candidate),
    harness: slimHarness(),
  };
}

function threeOldFlatRuns(candidate = 'v6.2-phase1-candidate-r22'): Json[] {
  return rawBasenames.map((raw) => oldFlatRun(raw, candidate));
}

type AggregateOutcome =
  | { status: 'returned'; pass: boolean; value: Json }
  | { status: 'rejected'; code: string };

function aggregateOutcome(runs: Json[]): AggregateOutcome {
  try {
    const value = aggregateDirectPerformanceRuns(runs) as Json;
    return { status: 'returned', pass: value.pass === true, value };
  } catch (error) {
    return {
      status: 'rejected',
      code: typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'UNCLASSIFIED_REJECTION',
    };
  }
}

function expectRejected(runs: Json[]): void {
  expect(aggregateOutcome(runs).status).toBe('rejected');
}

function expectNotPass(runs: Json[]): void {
  const outcome = aggregateOutcome(runs);
  expect(outcome.status === 'returned' && outcome.pass).toBe(false);
}

const challenge = 'a'.repeat(64);
const sourceSnapshotSha256 = 'b'.repeat(64);
const harnessDigest = 'c'.repeat(64);
const candidate = 'v6.2-phase1-candidate-r22';
const pid = 4242;

function metricsInput(diagnostics: Json): Json {
  return {
    schemaVersion: 1,
    kind: 'copilot-direct-performance-metrics',
    challenge,
    candidate,
    sourceSnapshotSha256,
    pid,
    electronProcessPids: [pid, pid + 1],
    app: { residentSetKb: 350_000, processCount: 4 },
    knowledgeGraph100: {
      nodeCount: 100,
      edgeCount: 157,
      sampleMs: 1_501,
      frames: 90,
      fps: 59.95,
    },
    harness: { digest: harnessDigest },
    startupDiagnostics: diagnostics,
  };
}

function expectedMetricsBinding(): Json {
  return { challenge, candidate, sourceSnapshotSha256, pid, harnessDigest };
}

describe('r22 V2 RED-A fixed strict direct causal diagnostics profile', () => {
  it('accepts the complete strict terminal path with the fixed optional readyToShow null reason', () => {
    const diagnostics = createStartupMilestoneReport(milestoneValues(false));
    expect(validateMetricsRecord(metricsInput(diagnostics), expectedMetricsBinding()))
      .toEqual(metricsInput(diagnostics));
  });

  it.each([
    ['appWhenReady', 'not-reached'],
    ['releaseIdentityStart', 'not-reached'],
    ['releaseIdentityEnd', 'not-reached'],
    ['directProbeInitStart', 'not-reached'],
    ['directProbeInitEnd', 'not-reached'],
    ['windowCreateStart', 'not-reached'],
    ['windowCreated', 'not-reached'],
    ['rendererLoadStart', 'not-reached'],
    ['domReady', 'not-reached'],
    ['rendererShellCommit', 'not-reached'],
    ['appRootVisible', 'not-reached'],
    ['terminalReady', 'not-reached'],
  ])('rejects r22 direct %s=null/%s while its strict terminal path continues', (name, reason) => {
    const milestones = milestoneValues();
    milestones[name] = { offsetMs: null, reason };
    const genericReport = createStartupMilestoneReport(milestones);
    expect(() => validateMetricsRecord(
      metricsInput(genericReport),
      expectedMetricsBinding(),
    )).toThrow();
  });

  it('rejects a reached child earlier than its reached causal parent', () => {
    const milestones = milestoneValues();
    milestones.appRootVisible = { offsetMs: 17, reason: null };
    expect(() => validateMetricsRecord(
      metricsInput({
        clock: 'candidate-process-monotonic-diagnostic-only',
        milestones,
      }),
      expectedMetricsBinding(),
    )).toThrow();
  });

  it('retains fixed development/non-direct null semantics in the default profile', () => {
    const milestones = milestoneValues();
    milestones.releaseIdentityStart = { offsetMs: null, reason: 'development-runtime' };
    milestones.releaseIdentityEnd = { offsetMs: null, reason: 'development-runtime' };
    expect(createStartupMilestoneReport(milestones)).toEqual({
      clock: 'candidate-process-monotonic-diagnostic-only',
      milestones,
    });
  });
});

describe('r22 V2 RED-B exact complete real-raw aggregate contract', () => {
  it('accepts exactly three ordered complete real r22 public raw pairs', () => {
    expect(aggregateOutcome(threeRealPairs())).toMatchObject({
      status: 'returned',
      pass: true,
    });
  });

  it('rejects the obsolete hand-asserted flat summary shape', () => {
    expectRejected(threeOldFlatRuns());
  });

  it.each([
    'v6.2-phase1-candidate-r21',
    'v6.2-phase1-candidate-r23',
  ])('rejects a complete %s real triple instead of labeling it r22', (wrongCandidate) => {
    const legacyFlat = aggregateOutcome(threeOldFlatRuns(wrongCandidate));
    const realPair = aggregateOutcome(threeRealPairs(wrongCandidate));
    expect({
      legacyFlatAccepted: legacyFlat.status === 'returned' && legacyFlat.pass,
      realPairAccepted: realPair.status === 'returned' && realPair.pass,
    }).toEqual({
      legacyFlatAccepted: false,
      realPairAccepted: false,
    });
  });

  it.each([
    ['two inputs', () => threeRealPairs().slice(0, 2)],
    ['four inputs', () => [...threeRealPairs(), realPair('performance-raw4-r22.json')]],
    ['duplicate names', () => {
      const pairs = threeRealPairs();
      pairs[1].raw = pairs[0].raw;
      pairs[1].record.evidence.outputTarget.basename = pairs[0].raw;
      return pairs;
    }],
    ['reordered names', () => {
      const pairs = threeRealPairs();
      return [pairs[1], pairs[0], pairs[2]];
    }],
    ['unsafe raw path', () => {
      const pairs = threeRealPairs();
      pairs[0].raw = `nested/${pairs[0].raw}`;
      return pairs;
    }],
    ['raw/evidence basename mismatch', () => {
      const pairs = threeRealPairs();
      pairs[1].record.evidence.outputTarget.basename = 'other.json';
      return pairs;
    }],
    ['unknown pair field', () => {
      const pairs = threeRealPairs();
      pairs[0].callerPass = true;
      return pairs;
    }],
    ['unknown real record field', () => {
      const pairs = threeRealPairs();
      pairs[0].record.privatePath = '/Users/private/profile';
      return pairs;
    }],
  ])('rejects %s', (_label, mutate) => {
    expectRejected((mutate as () => Json[])());
  });

  it.each([
    ['launch >= 2000', (record: Json) => {
      record.app.launchMs = 2_000;
      record.app.outerControllerLaunchMs = 2_000;
      record.app.directSpawnLaunchMs = 2_000;
      record.startup.readyObservedAtControllerMs = 2_000;
    }],
    ['RSS >= 500', (record: Json) => { record.app.residentSetMb = 500; }],
    ['node count other than 100', (record: Json) => {
      record.knowledgeGraph100.nodeCount = 99;
    }],
    ['FPS below 30', (record: Json) => { record.knowledgeGraph100.fps = 29.99; }],
    ['KG sample below 1500ms', (record: Json) => {
      record.knowledgeGraph100.sampleMs = 1_499.99;
    }],
    ['false terminal', (record: Json) => {
      record.startup.terminal.rendererShellCommit = false;
    }],
    ['malformed diagnostics', (record: Json) => {
      record.startup.diagnostics.milestones.rendererShellCommit = {
        offsetMs: null,
        reason: 'not-reached',
      };
    }],
    ['non-zero final process tree', (record: Json) => {
      record.processCleanup.remainingPidCount = 1;
      record.processCleanup.pass = false;
    }],
    ['false raw pass', (record: Json) => { record.pass = false; }],
    ['candidate binding drift', (record: Json) => {
      record.candidateBinding.executable.sha256 = sha('drifted-executable');
    }],
    ['harness binding drift', (record: Json) => {
      record.harness.executedHarnessBinding.files[1].sha256 = sha('drifted-bundle');
    }],
  ])('cannot be overridden by caller-supplied flat PASS claims: %s', (_label, mutate) => {
    const legacyHybrid = threeOldFlatRuns();
    for (let index = 0; index < legacyHybrid.length; index += 1) {
      legacyHybrid[index].record = realRecord(rawBasenames[index]);
    }
    const exactRealPair = threeRealPairs();
    (mutate as (record: Json) => void)(legacyHybrid[1].record);
    (mutate as (record: Json) => void)(exactRealPair[1].record);

    const legacyOutcome = aggregateOutcome(legacyHybrid);
    const exactOutcome = aggregateOutcome(exactRealPair);
    expect({
      legacyHybridAccepted: legacyOutcome.status === 'returned' && legacyOutcome.pass,
      exactRealPairAccepted: exactOutcome.status === 'returned' && exactOutcome.pass,
    }).toEqual({
      legacyHybridAccepted: false,
      exactRealPairAccepted: false,
    });
  });

  it.each([
    ['extended source snapshot', (record: Json) => {
      delete record.candidateBinding.sourceSnapshot.canonicalManifest;
    }],
    ['harness sourceMode', (record: Json) => {
      record.harness.sourceMode = 'live-component-with-resolved-installed-inputs';
    }],
    ['authoritative executed build', (record: Json) => {
      record.harness.authoritativeExecutedBuild.digest = sha('bad-authoritative-digest');
    }],
    ['executed harness binding', (record: Json) => {
      record.harness.executedHarnessBinding.digest = sha('bad-executed-digest');
    }],
    ['generated entry', (record: Json) => {
      record.harness.generatedEntry.sha256 = sha('bad-generated-entry');
    }],
    ['input provenance', (record: Json) => {
      record.harness.inputProvenance.buildInputs.digest = sha('bad-input-provenance');
    }],
    ['preserved files rebind', (record: Json) => {
      record.evidence.preservedHarness.files[0].sha256 = sha('bad-preserved-file');
    }],
    ['preserved binding rebind', (record: Json) => {
      record.evidence.preservedHarness.binding.digest = sha('bad-preserved-binding');
    }],
  ])('fails closed on incomplete or drifted full real binding: %s', (_label, mutate) => {
    const pairs = threeRealPairs();
    (mutate as (record: Json) => void)(pairs[1].record);
    expectNotPass(pairs);
  });

  it('requires complete candidate and harness bindings to be byte-identical across all three raws', () => {
    const pairs = threeRealPairs();
    pairs[2].record.candidateBinding.sourceSnapshot.manifest.sha256 = sha('candidate-drift');
    pairs[2].record.harness.inputProvenance.dependencies.digest = sha('harness-drift');
    expectNotPass(pairs);
  });
});

type CliResult = { code: number | null; stdout: string; stderr: string };

async function runCli(args: string[], cwd = desktopRoot): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [aggregateCliPath, ...args], {
      cwd,
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

async function createCliEvidenceDirectory(
  mutate?: (records: Json[]) => void,
): Promise<{ root: string; output: string; raws: string[]; records: Json[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r22-aggregate-cli-red-'));
  tempRoots.push(root);
  await chmod(root, 0o700);
  const records = rawBasenames.map((raw) => realRecord(raw));
  mutate?.(records);
  const raws = rawBasenames.map((raw) => path.join(root, raw));
  await Promise.all(records.map((record, index) => writeFile(
    raws[index],
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  )));
  return {
    root,
    output: path.join(root, 'performance-aggregate-r22.json'),
    raws,
    records,
  };
}

describe('r22 V2 RED-C one-shot non-overwriting production aggregate CLI', () => {
  it('exists and contains exactly one real aggregate invocation without directory scanning or runtime launch', async () => {
    const source = await readFile(aggregateCliPath, 'utf8').catch(() => null);
    expect(source).not.toBeNull();
    if (source === null) return;
    expect(source.match(/aggregateDirectPerformanceRuns\s*\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\breaddir(?:Sync)?\s*\(|\bglob\s*\(|\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync)?\s*\(|\bfetch\s*\(/);
  });

  it('reads only three explicit ordered raws and exclusively creates one private PASS aggregate', async () => {
    const fixture = await createCliEvidenceDirectory();
    await writeFile(
      path.join(fixture.root, 'performance-raw4-r22.json'),
      `${JSON.stringify(realRecord('performance-raw4-r22.json'))}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    const result = await runCli([fixture.output, ...fixture.raws]);
    expect(result.code).toBe(0);
    const aggregate = JSON.parse(await readFile(fixture.output, 'utf8'));
    expect(aggregate).toMatchObject({ runCount: 3, pass: true });
    const outputStat = await lstat(fixture.output);
    expect(outputStat.isFile()).toBe(true);
    expect(outputStat.isSymbolicLink()).toBe(false);
    if (process.platform !== 'win32') expect(outputStat.mode & 0o777).toBe(0o600);
  });

  it('writes truthful FAIL evidence before returning exit 2', async () => {
    const fixture = await createCliEvidenceDirectory((records) => {
      records[1].app.launchMs = 2_000;
      records[1].app.outerControllerLaunchMs = 2_000;
      records[1].app.directSpawnLaunchMs = 2_000;
      records[1].startup.readyObservedAtControllerMs = 2_000;
      records[1].pass = false;
    });
    const result = await runCli([fixture.output, ...fixture.raws]);
    expect(result.code).toBe(2);
    const aggregate = JSON.parse(await readFile(fixture.output, 'utf8'));
    expect(aggregate).toMatchObject({ runCount: 3, pass: false });
  });

  it.each([
    ['two raw arguments', async () => {
      const fixture = await createCliEvidenceDirectory();
      return { output: fixture.output, args: [fixture.output, ...fixture.raws.slice(0, 2)] };
    }],
    ['four raw arguments', async () => {
      const fixture = await createCliEvidenceDirectory();
      const fourth = path.join(fixture.root, 'performance-raw4-r22.json');
      await writeFile(fourth, `${JSON.stringify(realRecord(path.basename(fourth)))}\n`, { flag: 'wx', mode: 0o600 });
      return { output: fixture.output, args: [fixture.output, ...fixture.raws, fourth] };
    }],
    ['reordered raws', async () => {
      const fixture = await createCliEvidenceDirectory();
      return { output: fixture.output, args: [fixture.output, fixture.raws[1], fixture.raws[0], fixture.raws[2]] };
    }],
    ['relative raw paths', async () => {
      const fixture = await createCliEvidenceDirectory();
      return {
        output: fixture.output,
        args: [fixture.output, ...fixture.raws.map((raw) => path.basename(raw))],
        cwd: fixture.root,
      };
    }],
    ['wrong output basename', async () => {
      const fixture = await createCliEvidenceDirectory();
      const output = path.join(fixture.root, 'other-aggregate.json');
      return { output, args: [output, ...fixture.raws] };
    }],
    ['existing output', async () => {
      const fixture = await createCliEvidenceDirectory();
      await writeFile(fixture.output, 'sentinel\n', { flag: 'wx', mode: 0o600 });
      return { output: fixture.output, args: [fixture.output, ...fixture.raws], sentinel: 'sentinel\n' };
    }],
    ['raw in another directory', async () => {
      const fixture = await createCliEvidenceDirectory();
      const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'r22-aggregate-cli-other-'));
      tempRoots.push(otherRoot);
      const moved = path.join(otherRoot, rawBasenames[2]);
      await writeFile(moved, `${JSON.stringify(fixture.records[2])}\n`, { flag: 'wx', mode: 0o600 });
      return { output: fixture.output, args: [fixture.output, fixture.raws[0], fixture.raws[1], moved] };
    }],
    ['symlink raw input', async () => {
      const fixture = await createCliEvidenceDirectory();
      const target = path.join(fixture.root, 'raw-target.json');
      await writeFile(target, await readFile(fixture.raws[0]), { flag: 'wx', mode: 0o600 });
      await rm(fixture.raws[0]);
      await symlink(target, fixture.raws[0]);
      return { output: fixture.output, args: [fixture.output, ...fixture.raws] };
    }],
    ['malformed JSON evidence', async () => {
      const fixture = await createCliEvidenceDirectory();
      await rm(fixture.raws[1]);
      await writeFile(fixture.raws[1], '{not-json\n', { flag: 'wx', mode: 0o600 });
      return { output: fixture.output, args: [fixture.output, ...fixture.raws] };
    }],
    ['malformed real-record evidence', async () => {
      const fixture = await createCliEvidenceDirectory();
      const malformed = clone(fixture.records[1]);
      delete malformed.candidateBinding.sourceSnapshot.manifest;
      await rm(fixture.raws[1]);
      await writeFile(fixture.raws[1], `${JSON.stringify(malformed, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      return { output: fixture.output, args: [fixture.output, ...fixture.raws] };
    }],
  ])('fails closed for %s without creating a PASS document', async (_label, setup) => {
    const fixture = await (setup as () => Promise<{
      output: string;
      args: string[];
      cwd?: string;
      sentinel?: string;
    }>)();
    const result = await runCli(fixture.args, fixture.cwd);
    expect(result.code).not.toBe(0);
    const contents = await readFile(fixture.output, 'utf8').catch(() => null);
    if (fixture.sentinel !== undefined) {
      expect(contents).toBe(fixture.sentinel);
    } else {
      expect(contents === null || JSON.parse(contents).pass !== true).toBe(true);
    }
  });
});
