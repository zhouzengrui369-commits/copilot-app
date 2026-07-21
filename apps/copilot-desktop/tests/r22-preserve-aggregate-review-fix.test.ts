// @vitest-environment node

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// @ts-ignore JavaScript release helpers are exercised directly by Vitest.
import { aggregateDirectPerformanceRuns } from '../scripts/direct-performance-config.mjs';
// @ts-ignore JavaScript release helpers are exercised directly by Vitest.
import { preserveThenCleanupExecutedKgHarness } from '../scripts/performance-kg-harness.mjs';

type Json = Record<string, any>;

const rawBasenames = [
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
] as const;

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function executedBinding(files: Json[]): Json {
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(JSON.stringify({
      logicalName: file.logicalName,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
    digest.update('\n');
  }
  return { schemaVersion: 1, files, digest: digest.digest('hex') };
}

function authoritativeBinding(executed: Json): Json {
  const files = executed.files
    .filter((file: Json) => file.logicalName !== 'index.html')
    .map((file: Json) => ({
      basename: file.logicalName,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
  const digest = createHash('sha256');
  const canonical = files.map((file: Json) => ({
    logicalPath: file.basename,
    bytes: file.bytes,
    sha256: file.sha256,
  })).sort((left: Json, right: Json) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const file of canonical) {
    digest.update(JSON.stringify(file));
    digest.update('\n');
  }
  return {
    authority: 'authoritative-executed-build-artifacts',
    source: 'esbuild-returned-output-bytes',
    files,
    digest: digest.digest('hex'),
  };
}

function generatedEntry(): Json {
  return {
    logicalName: 'copilot-kg-performance-entry.tsx',
    sourcefile: 'copilot-kg-performance-entry.tsx',
    bytes: 64,
    sha256: sha('generated-entry'),
  };
}

function validExecutedBinding(): Json {
  return executedBinding([
    { logicalName: 'bundle.css', bytes: 31, sha256: sha('css') },
    { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
    { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
  ]);
}

function artifact(basename: string, seed: string, bytes = 100 + seed.length): Json {
  return {
    basename,
    pathScope: 'host-local-redacted',
    bytes,
    sha256: sha(seed),
  };
}

function validRun(raw: string): Json {
  const rawIndex = rawBasenames.indexOf(raw as (typeof rawBasenames)[number]);
  const ordinal = rawIndex >= 0 ? rawIndex + 1 : 4;
  const entry = generatedEntry();
  const executed = validExecutedBinding();
  const binding = {
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
    authoritativeExecutedBuild: authoritativeBinding(executed),
    executedHarnessBinding: executed,
    generatedEntry: entry,
    inputProvenance: {
      authority: 'non-authoritative-post-build-provenance',
      note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
      component: {
        source: 'candidate-snapshot',
        logicalPath: 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx',
        bytes: 200,
        sha256: sha('component'),
      },
      dependencies: {
        source: 'resolved-installed-inputs',
        inputCount: 5,
        digest: sha('dependencies'),
      },
      buildInputs: {
        inputCount: 7,
        digest: sha('build-inputs'),
        generatedEntry: entry,
      },
      snapshotPackageLock: {
        present: true,
        bytes: 300,
        sha256: sha('package-lock'),
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
        executable: clone(binding.executable),
        skipBuild: true,
      },
      harness,
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
    },
  };
}

function threeBoundRuns(): Json[] {
  return rawBasenames.map(validRun);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type AggregateOutcome =
  | { status: 'returned'; pass: boolean }
  | { status: 'rejected'; code: string };

function aggregateOutcome(runs: Json[]): AggregateOutcome {
  try {
    return { status: 'returned', pass: aggregateDirectPerformanceRuns(runs).pass === true };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code !== 'string') throw error;
    return { status: 'rejected', code };
  }
}

function isExplicitAggregateRejection(outcome: AggregateOutcome): boolean {
  return outcome.status === 'returned'
    ? outcome.pass === false
    : outcome.code === 'BLOCKED_DIRECT_PERF_AGGREGATE_BINDING';
}

function withExecutedFiles(files: Json[]): Json[] {
  const runs = threeBoundRuns();
  for (const run of runs) {
    const binding = executedBinding(clone(files));
    run.record.harness.authoritativeExecutedBuild = authoritativeBinding(binding);
    run.record.harness.executedHarnessBinding = binding;
    run.record.evidence.preservedHarness.files = clone(binding.files);
    run.record.evidence.preservedHarness.binding = clone(binding);
  }
  return runs;
}

describe('r22 review fix RED-B preserve and strict aggregate', () => {
  it('retains the original preserve rejection and never invokes cleanup', async () => {
    const original = new Error('preserve-rebind-failed');
    const cleanup = vi.fn(async () => undefined);
    const observed = await preserveThenCleanupExecutedKgHarness({
      preserve: async () => { throw original; },
      cleanup,
    }).catch((error: unknown) => error);

    expect(observed).toBe(original);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('runs the sole cleanup only after successful preservation', async () => {
    const order: string[] = [];
    const cleanup = vi.fn(async () => { order.push('cleanup'); });
    await expect(preserveThenCleanupExecutedKgHarness({
      preserve: async () => { order.push('preserve'); return 'bound'; },
      cleanup,
    })).resolves.toBe('bound');
    expect(order).toEqual(['preserve', 'cleanup']);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly three identical complete bound r22 raws', () => {
    expect(aggregateOutcome(threeBoundRuns())).toEqual({ status: 'returned', pass: true });
  });

  it('accepts exactly three identical complete bound r22 raws without optional CSS', () => {
    const runs = withExecutedFiles([
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
    ]);
    expect(aggregateOutcome(runs)).toEqual({ status: 'returned', pass: true });
  });

  it.each([
    ['no executed files', () => withExecutedFiles([])],
    ['only bundle.js', () => withExecutedFiles([
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
    ])],
    ['only index.html', () => withExecutedFiles([
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
    ])],
    ['duplicate bundle.js', () => withExecutedFiles([
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
    ])],
    ['unsorted required files', () => withExecutedFiles([
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
    ])],
    ['repeated extra bundle.css', () => withExecutedFiles([
      { logicalName: 'bundle.css', bytes: 31, sha256: sha('css') },
      { logicalName: 'bundle.css', bytes: 31, sha256: sha('css') },
      { logicalName: 'bundle.js', bytes: 41, sha256: sha('js') },
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
    ])],
    ['unknown file key', () => {
      const runs = threeBoundRuns();
      for (const run of runs) {
        run.record.harness.executedHarnessBinding.files[0].privatePath = '/tmp/forbidden';
      }
      return runs;
    }],
    ['zero-byte required file', () => withExecutedFiles([
      { logicalName: 'bundle.js', bytes: 0, sha256: sha('') },
      { logicalName: 'index.html', bytes: 51, sha256: sha('html') },
    ])],
    ['digest mismatch', () => {
      const runs = threeBoundRuns();
      for (const run of runs) {
        run.record.harness.executedHarnessBinding.digest = sha('wrong-digest');
      }
      return runs;
    }],
    ['incomplete candidate artifact', () => {
      const runs = threeBoundRuns();
      for (const run of runs) delete run.record.candidateBinding.executable.pathScope;
      return runs;
    }],
    ['unknown candidate top-level key', () => {
      const runs = threeBoundRuns();
      for (const run of runs) run.record.candidateBinding.privatePath = '/tmp/forbidden';
      return runs;
    }],
    ['unknown candidate artifact key', () => {
      const runs = threeBoundRuns();
      for (const run of runs) run.record.candidateBinding.executable.privatePath = '/tmp/forbidden';
      return runs;
    }],
    ['incomplete generated entry', () => {
      const runs = threeBoundRuns();
      for (const run of runs) delete run.record.harness.generatedEntry.sourcefile;
      return runs;
    }],
    ['incomplete provenance', () => {
      const runs = threeBoundRuns();
      for (const run of runs) delete run.record.harness.inputProvenance.snapshotPackageLock;
      return runs;
    }],
    ['unknown provenance top-level key', () => {
      const runs = threeBoundRuns();
      for (const run of runs) run.record.harness.inputProvenance.privatePath = '/tmp/forbidden';
      return runs;
    }],
    ['unknown build-inputs key', () => {
      const runs = threeBoundRuns();
      for (const run of runs) run.record.harness.inputProvenance.buildInputs.privatePath = '/tmp/forbidden';
      return runs;
    }],
    ['mixed bound and unbound raws', () => {
      const runs = threeBoundRuns();
      runs[1].record.candidateBinding = undefined;
      runs[1].record.harness = undefined;
      return runs;
    }],
    ['three unbound raws', () => threeBoundRuns().map((run) => {
      const unbound = clone(run);
      unbound.record.candidateBinding = undefined;
      unbound.record.harness = undefined;
      return unbound;
    })],
  ])('rejects %s', (_name, makeRuns) => {
    expect(isExplicitAggregateRejection(aggregateOutcome(makeRuns()))).toBe(true);
  });
});
