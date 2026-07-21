// @vitest-environment node

import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuildBuild, type BuildOptions, type BuildResult } from 'esbuild';
import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-ignore JavaScript release helper is exercised directly by Vitest.
import * as directConfig from '../scripts/direct-performance-config.mjs';
// @ts-ignore JavaScript release helper is exercised directly by Vitest.
import * as harnessApi from '../scripts/performance-kg-harness.mjs';
// @ts-ignore JavaScript release helper is exercised directly by Vitest.
import * as performanceConfig from '../scripts/performance-config.mjs';

type BuiltHarness = Awaited<ReturnType<typeof harnessApi.buildKgHarness>>;
type PreservedHarness = {
  directoryBasename: string;
  files: Array<{ logicalName: string; bytes: number; sha256: string }>;
  binding: { schemaVersion: number; files: unknown[]; digest: string };
};

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const rawBasenames = [
  'performance-raw1-r22.json',
  'performance-raw2-r22.json',
  'performance-raw3-r22.json',
] as const;
const tempRoots: string[] = [];
let firstRoot = '';
let secondRoot = '';
let firstBuild: BuiltHarness;
let secondBuild: BuiltHarness;

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function executedBinding(contents: {
  bundleJs: string;
  indexHtml: string;
  bundleCss?: string;
} = {
  bundleJs: 'console.log("bound");\n',
  indexHtml: '<!doctype html><script src="bundle.js"></script>\n',
  bundleCss: '.root{display:block}\n',
}) {
  const named = [
    ['bundle.js', contents.bundleJs],
    ['index.html', contents.indexHtml],
    ...(contents.bundleCss === undefined ? [] : [['bundle.css', contents.bundleCss]]),
  ] as Array<[string, string]>;
  const files = named.map(([logicalName, value]) => ({
    logicalName,
    bytes: Buffer.byteLength(value),
    sha256: sha(value),
  })).sort((left, right) => left.logicalName.localeCompare(right.logicalName));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(JSON.stringify(file));
    hash.update('\n');
  }
  return { schemaVersion: 1, files, digest: hash.digest('hex') };
}

function authoritativeBinding(executed: ReturnType<typeof executedBinding>) {
  const files = executed.files
    .filter((file) => file.logicalName !== 'index.html')
    .map((file) => ({
      basename: file.logicalName,
      bytes: file.bytes,
      sha256: file.sha256,
    }));
  const hash = createHash('sha256');
  const canonical = files.map((file) => ({
    logicalPath: file.basename,
    bytes: file.bytes,
    sha256: file.sha256,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const file of canonical) {
    hash.update(JSON.stringify(file));
    hash.update('\n');
  }
  return {
    authority: 'authoritative-executed-build-artifacts',
    source: 'esbuild-returned-output-bytes',
    files,
    digest: hash.digest('hex'),
  };
}

function passingRun(raw: string) {
  const rawIndex = rawBasenames.indexOf(raw as (typeof rawBasenames)[number]);
  const ordinal = rawIndex >= 0 ? rawIndex + 1 : 4;
  const generatedEntrySource = 'import React from "react";\nexport const generated = true;\n';
  const generatedEntry = {
    logicalName: 'copilot-kg-performance-entry.tsx',
    sourcefile: 'copilot-kg-performance-entry.tsx',
    bytes: Buffer.byteLength(generatedEntrySource),
    sha256: sha(generatedEntrySource),
  };
  const artifact = (basename: string, seed: string, bytes: number) => ({
    basename,
    pathScope: 'host-local-redacted',
    bytes,
    sha256: sha(seed),
  });
  const executed = executedBinding();
  const candidateBinding = {
    candidate: 'v6.2-phase1-candidate-r22',
    executable: artifact('njx-copilot-v6', 'executable', 101),
    appAsar: artifact('app.asar', 'asar', 102),
    releaseIdentity: artifact('release-identity.exact.json', 'identity', 103),
    sourceSnapshot: {
      ...artifact('source-snapshot', 'source', 104),
      fileCount: 304,
      algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
      manifest: artifact('source-snapshot-inputs.json', 'manifest', 105),
      canonicalManifest: artifact('CANONICAL-MANIFEST.json', 'canonical-manifest', 106),
    },
  };
  const harness = {
    sourceMode: 'snapshot-component-with-resolved-installed-inputs',
    authoritativeExecutedBuild: authoritativeBinding(executed),
    executedHarnessBinding: executed,
    generatedEntry,
    inputProvenance: {
      authority: 'non-authoritative-post-build-provenance',
      note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
      component: { source: 'candidate-snapshot', logicalPath: 'apps/copilot-desktop/src/renderer/components/KnowledgeGraph/index.tsx', bytes: 10, sha256: sha('component') },
      dependencies: { source: 'resolved-installed-inputs', inputCount: 5, digest: sha('dependencies') },
      buildInputs: { inputCount: 7, digest: sha('build-inputs'), generatedEntry },
      snapshotPackageLock: { present: true, bytes: 30, sha256: sha('lock') },
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
          files: structuredClone(executed.files),
          binding: structuredClone(executed),
        },
      },
      candidateBinding,
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

type AggregateOutcome =
  | { status: 'returned'; pass: boolean }
  | { status: 'rejected'; code: string };

function aggregateOutcome(runs: Array<ReturnType<typeof passingRun>>): AggregateOutcome {
  try {
    const value = directConfig.aggregateDirectPerformanceRuns(runs);
    return { status: 'returned', pass: value.pass === true };
  } catch (error) {
    return {
      status: 'rejected',
      code: typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : 'UNCLASSIFIED_REJECTION',
    };
  }
}

function accepted(outcome: AggregateOutcome): boolean {
  return outcome.status === 'returned' && outcome.pass;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setExecutedHarnessBinding(
  run: ReturnType<typeof passingRun>,
  binding: ReturnType<typeof executedBinding>,
): void {
  run.record.harness.authoritativeExecutedBuild = authoritativeBinding(binding);
  run.record.harness.executedHarnessBinding = binding;
  run.record.evidence.preservedHarness.files = clone(binding.files);
  run.record.evidence.preservedHarness.binding = clone(binding);
}

function collectAst<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function namedObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = object.properties.find((candidate) => candidate.name?.getText() === name);
  if (property && ts.isPropertyAssignment(property)) return property.initializer;
  if (property && ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
}

function callIdentifier(node: ts.CallExpression): string | undefined {
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

function expressionDependsOn(
  expression: ts.Expression,
  source: ts.SourceFile,
  expectedText: string,
  visited = new Set<string>(),
): boolean {
  if (expression.getText(source) === expectedText) return true;
  if (ts.isIdentifier(expression) && !visited.has(expression.text)) {
    visited.add(expression.text);
    const declarations = collectAst(source, (node): node is ts.VariableDeclaration => (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === expression.text
      && node.initializer !== undefined
    ));
    return declarations.length === 1 && expressionDependsOn(
      declarations[0]!.initializer!, source, expectedText, visited,
    );
  }
  let found = false;
  ts.forEachChild(expression, (child) => {
    if (!found && ts.isExpression(child)) {
      found = expressionDependsOn(child, source, expectedText, new Set(visited));
    }
  });
  return found;
}

function nearestFunctionAncestor(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current as ts.FunctionLikeDeclaration;
    current = current.parent;
  }
  return undefined;
}

function isAwaitedOrReturnedWithin(
  call: ts.CallExpression,
  closure: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  if (ts.isArrowFunction(closure) && closure.body === call) return true;
  let current: ts.Node | undefined = call.parent;
  while (current && current !== closure) {
    if (ts.isAwaitExpression(current) || ts.isReturnStatement(current)) return true;
    if (ts.isFunctionLike(current)) return false;
    current = current.parent;
  }
  return false;
}

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'r22-harness-roots-'));
  tempRoots.push(base);
  firstRoot = await mkdtemp(path.join(base, 'root-a-'));
  secondRoot = await mkdtemp(path.join(base, 'root-b-'));
  await chmod(firstRoot, 0o700);
  await chmod(secondRoot, 0o700);
  const config = performanceConfig.resolvePerformanceConfig({ env: {}, appRoot: desktopRoot, repoRoot });
  [firstBuild, secondBuild] = await Promise.all([
    harnessApi.buildKgHarness(firstRoot, config),
    harnessApi.buildKgHarness(secondRoot, config),
  ]);
}, 30_000);

afterAll(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('r22 RED-5..7 deterministic and audit-preserved KG harness', () => {
  it('builds byte-identical JS/CSS/HTML in two distinct temporary roots', async () => {
    const names = ['bundle.js', 'index.html'];
    if (await readFile(path.join(firstRoot, 'bundle.css')).then(() => true, () => false)) names.push('bundle.css');
    const mismatchedFiles: string[] = [];
    for (const name of names) {
      const [left, right] = await Promise.all([
        readFile(path.join(firstRoot, name)),
        readFile(path.join(secondRoot, name)),
      ]);
      if (!left.equals(right)) mismatchedFiles.push(name);
    }
    expect(mismatchedFiles).toEqual([]);
  });

  it('binds authoritative generated-entry source bytes and includes them in build-input provenance', async () => {
    const createGeneratedEntrySource = (harnessApi as unknown as {
      createKgHarnessGeneratedEntrySource?: (componentPath: string) => string | Uint8Array;
    }).createKgHarnessGeneratedEntrySource;
    const config = performanceConfig.resolvePerformanceConfig({ env: {}, appRoot: desktopRoot, repoRoot });
    const firstSource = typeof createGeneratedEntrySource === 'function'
      ? Buffer.from(createGeneratedEntrySource(config.componentPath))
      : Buffer.alloc(0);
    const secondSource = typeof createGeneratedEntrySource === 'function'
      ? Buffer.from(createGeneratedEntrySource(config.componentPath))
      : Buffer.alloc(0);
    const expected = {
      logicalName: 'copilot-kg-performance-entry.tsx',
      sourcefile: 'copilot-kg-performance-entry.tsx',
      bytes: firstSource.byteLength,
      sha256: createHash('sha256').update(firstSource).digest('hex'),
    };
    expect({
      sourceFactoryAvailable: typeof createGeneratedEntrySource === 'function',
      sourceBytesEqual: firstSource.equals(secondSource),
      firstGeneratedEntry: firstBuild.provenance.generatedEntry,
      secondGeneratedEntry: secondBuild.provenance.generatedEntry,
      firstBuildInput: firstBuild.provenance.inputProvenance.buildInputs.generatedEntry,
      secondBuildInput: secondBuild.provenance.inputProvenance.buildInputs.generatedEntry,
    }).toEqual({
      sourceFactoryAvailable: true,
      sourceBytesEqual: true,
      firstGeneratedEntry: expect.objectContaining(expected),
      secondGeneratedEntry: expect.objectContaining(expected),
      firstBuildInput: expect.objectContaining(expected),
      secondBuildInput: expect.objectContaining(expected),
    });
  });

  it('passes the authoritative stable virtual entry to an injectable esbuild executor', async () => {
    const config = performanceConfig.resolvePerformanceConfig({ env: {}, appRoot: desktopRoot, repoRoot });
    const createGeneratedEntrySource = (harnessApi as unknown as {
      createKgHarnessGeneratedEntrySource?: (componentPath: string) => string | Uint8Array;
    }).createKgHarnessGeneratedEntrySource;
    const captureRoot = await mkdtemp(path.join(path.dirname(firstRoot), 'capture-'));
    let capturedOptions: BuildOptions | undefined;
    let capturedResult: BuildResult | undefined;
    const buildExecutor = async (options: BuildOptions): Promise<BuildResult> => {
      capturedOptions = options;
      capturedResult = await esbuildBuild(options);
      return capturedResult;
    };
    const built = await (harnessApi.buildKgHarness as unknown as (
      root: string,
      resolvedConfig: typeof config,
      dependencies: { buildExecutor: typeof buildExecutor },
    ) => Promise<BuiltHarness>)(captureRoot, config, { buildExecutor });
    const authoritativeSource = typeof createGeneratedEntrySource === 'function'
      ? Buffer.from(createGeneratedEntrySource(config.componentPath))
      : Buffer.alloc(0);
    const capturedSource = capturedOptions?.stdin?.contents;
    const capturedBytes = typeof capturedSource === 'string'
      ? Buffer.from(capturedSource)
      : Buffer.from(capturedSource ?? []);
    const expectedBinding = {
      logicalName: 'copilot-kg-performance-entry.tsx',
      sourcefile: 'copilot-kg-performance-entry.tsx',
      bytes: authoritativeSource.byteLength,
      sha256: createHash('sha256').update(authoritativeSource).digest('hex'),
    };
    expect({
      executorCalled: capturedOptions !== undefined && capturedResult !== undefined,
      authoritativeSourceNonEmpty: authoritativeSource.byteLength > 0,
      entryPointsAbsent: capturedOptions?.entryPoints === undefined,
      contentsEqual: capturedBytes.equals(authoritativeSource),
      sourcefile: capturedOptions?.stdin?.sourcefile,
      resolveDir: capturedOptions?.stdin?.resolveDir,
      metafileHasAuthoritativeEntry: Object.prototype.hasOwnProperty.call(
        capturedResult?.metafile?.inputs ?? {},
        'copilot-kg-performance-entry.tsx',
      ),
      metafileEntryBytes: capturedResult?.metafile?.inputs['copilot-kg-performance-entry.tsx']?.bytes,
      generatedEntry: built.provenance.generatedEntry,
      buildInputGeneratedEntry: built.provenance.inputProvenance.buildInputs.generatedEntry,
    }).toEqual({
      executorCalled: true,
      authoritativeSourceNonEmpty: true,
      entryPointsAbsent: true,
      contentsEqual: true,
      sourcefile: 'copilot-kg-performance-entry.tsx',
      resolveDir: config.harnessAppRoot,
      metafileHasAuthoritativeEntry: true,
      metafileEntryBytes: authoritativeSource.byteLength,
      generatedEntry: expectedBinding,
      buildInputGeneratedEntry: expectedBinding,
    });
  });

  it('binds complete executed files and every provenance group identically across roots', () => {
    expect({
      executedHarness: firstBuild.provenance.executedHarnessBinding,
      authoritativeBuild: firstBuild.provenance.authoritativeExecutedBuild,
      inputProvenance: firstBuild.provenance.inputProvenance,
      generatedEntry: firstBuild.provenance.generatedEntry,
    }).toEqual({
      executedHarness: secondBuild.provenance.executedHarnessBinding,
      authoritativeBuild: secondBuild.provenance.authoritativeExecutedBuild,
      inputProvenance: secondBuild.provenance.inputProvenance,
      generatedEntry: secondBuild.provenance.generatedEntry,
    });
  });

  it('never emits either temporary root as an absolute path in executable JS', async () => {
    const [firstJs, secondJs] = await Promise.all([
      readFile(path.join(firstRoot, 'bundle.js'), 'utf8'),
      readFile(path.join(secondRoot, 'bundle.js'), 'utf8'),
    ]);
    expect(firstJs).not.toContain(firstRoot);
    expect(firstJs).not.toContain(secondRoot);
    expect(secondJs).not.toContain(firstRoot);
    expect(secondJs).not.toContain(secondRoot);
  });

  it('publishes complete executed and generated-entry bindings in safe public evidence', () => {
    const config = performanceConfig.resolvePerformanceConfig({ env: {}, appRoot: desktopRoot, repoRoot });
    const publicContext = performanceConfig.createPublicEvidenceContext(
      config,
      null,
      firstBuild.provenance,
    );
    expect({
      executedHarnessBinding: publicContext.harness.executedHarnessBinding,
      generatedEntry: publicContext.harness.generatedEntry,
    }).toEqual({
      executedHarnessBinding: firstBuild.provenance.executedHarnessBinding,
      generatedEntry: firstBuild.provenance.generatedEntry,
    });
    expect(JSON.stringify(publicContext)).not.toContain(firstRoot);
    expect(JSON.stringify(publicContext)).not.toContain(secondRoot);
  });

  it('rejects every cross-run complete candidate/harness/provenance drift', () => {
    const base = rawBasenames.map(passingRun);
    expect(aggregateOutcome(base)).toEqual({ status: 'returned', pass: true });

    const drifts: Array<[string, (run: ReturnType<typeof passingRun>) => void]> = [
      ['bundle.js complete binding', (run) => {
        setExecutedHarnessBinding(run, executedBinding({
          bundleJs: 'console.log("changed-js");\n',
          indexHtml: '<!doctype html><script src="bundle.js"></script>\n',
          bundleCss: '.root{display:block}\n',
        }));
      }],
      ['index.html complete binding', (run) => {
        setExecutedHarnessBinding(run, executedBinding({
          bundleJs: 'console.log("bound");\n',
          indexHtml: '<!doctype html><main>changed</main><script src="bundle.js"></script>\n',
          bundleCss: '.root{display:block}\n',
        }));
      }],
      ['optional bundle.css complete binding', (run) => {
        setExecutedHarnessBinding(run, executedBinding({
          bundleJs: 'console.log("bound");\n',
          indexHtml: '<!doctype html><script src="bundle.js"></script>\n',
          bundleCss: '.root{display:grid}\n',
        }));
      }],
      ['generated entry', (run) => {
        run.record.harness.generatedEntry.sha256 = sha('different-entry');
        run.record.harness.inputProvenance.buildInputs.generatedEntry.sha256 = sha('different-entry');
      }],
      ['component', (run) => { run.record.harness.inputProvenance.component.sha256 = sha('different-component'); }],
      ['dependencies', (run) => { run.record.harness.inputProvenance.dependencies.digest = sha('different-dependencies'); }],
      ['build inputs', (run) => { run.record.harness.inputProvenance.buildInputs.digest = sha('different-inputs'); }],
      ['package lock', (run) => { run.record.harness.inputProvenance.snapshotPackageLock.sha256 = sha('different-lock'); }],
      ['candidate id', (run) => { run.record.candidateBinding.candidate = 'v6.2-phase1-candidate-r23'; }],
      ['candidate executable', (run) => {
        run.record.candidateBinding.executable.sha256 = sha('different-executable');
        run.record.runtime.executable.sha256 = sha('different-executable');
      }],
      ['candidate app.asar', (run) => { run.record.candidateBinding.appAsar.sha256 = sha('different-asar'); }],
      ['candidate release identity', (run) => { run.record.candidateBinding.releaseIdentity.sha256 = sha('different-identity'); }],
      ['candidate source snapshot', (run) => { run.record.candidateBinding.sourceSnapshot.sha256 = sha('different-source'); }],
    ];
    const driftOutcomes = drifts.map(([name, mutate]) => {
      const runs = clone(base);
      mutate(runs[1]!);
      const outcome = aggregateOutcome(runs);
      return { name, accepted: accepted(outcome), outcome };
    });
    expect(driftOutcomes.map(({ name, accepted: wasAccepted }) => ({ name, accepted: wasAccepted })))
      .toEqual(drifts.map(([name]) => ({ name, accepted: false })));
  });

  it('fails or rejects every strict threshold predicate without swallowing assertions', () => {
    const base = rawBasenames.map(passingRun);
    expect(aggregateOutcome(base)).toEqual({ status: 'returned', pass: true });
    const thresholdCases: Array<[string, (run: ReturnType<typeof passingRun>) => void]> = [
      ['launch at 2000', (run) => {
        run.record.app.launchMs = 2_000;
        run.record.app.outerControllerLaunchMs = 2_000;
        run.record.app.directSpawnLaunchMs = 2_000;
        run.record.startup.readyObservedAtControllerMs = 2_000;
        run.record.pass = false;
      }],
      ['rss at 500', (run) => {
        run.record.app.residentSetMb = 500;
        run.record.pass = false;
      }],
      ['node count 99', (run) => {
        run.record.knowledgeGraph100.nodeCount = 99;
        run.record.pass = false;
      }],
      ['fps below 30', (run) => {
        run.record.knowledgeGraph100.fps = 29.99;
        run.record.pass = false;
      }],
      ['terminal false', (run) => { run.record.startup.terminal.rendererShellCommit = false; }],
      ['candidate unstable', (run) => {
        run.record.candidateBinding.sourceSnapshot.canonicalManifest.sha256 = sha('candidate-unstable');
      }],
      ['harness unstable', (run) => {
        run.record.harness.inputProvenance.component.sha256 = sha('harness-unstable');
      }],
      ['process tree nonzero', (run) => {
        run.record.processCleanup.remainingPidCount = 1;
        run.record.processCleanup.pass = false;
        run.record.pass = false;
      }],
      ['raw pass false', (run) => { run.record.pass = false; }],
    ];
    const thresholdOutcomes = thresholdCases.map(([name, mutate]) => {
      const runs = clone(base);
      mutate(runs[1]!);
      const outcome = aggregateOutcome(runs);
      return { name, accepted: accepted(outcome), outcome };
    });
    expect(thresholdOutcomes.map(({ name, accepted: wasAccepted }) => ({ name, accepted: wasAccepted })))
      .toEqual(thresholdCases.map(([name]) => ({ name, accepted: false })));
  });

  it('requires the runner to preserve exact emitted files before temporary cleanup', async () => {
    const preserve = (harnessApi as unknown as {
      preserveExecutedKgHarness?: (input: {
        sourceRoot: string;
        evidenceRoot: string;
        runId: string;
        expectedBinding: unknown;
      }) => Promise<PreservedHarness>;
    }).preserveExecutedKgHarness;
    expect(typeof preserve).toBe('function');

    const evidenceRoot = path.join(path.dirname(firstRoot), 'evidence');
    await mkdir(evidenceRoot, { mode: 0o700 });
    await chmod(evidenceRoot, 0o700);
    const preserved = await preserve!({
      sourceRoot: firstRoot,
      evidenceRoot,
      runId: 'run-1',
      expectedBinding: firstBuild.provenance.executedHarnessBinding,
    });
    const runRoot = path.join(evidenceRoot, 'run-1');
    const runStat = await lstat(runRoot);
    expect(runStat.isDirectory()).toBe(true);
    expect(runStat.isSymbolicLink()).toBe(false);
    if (process.platform !== 'win32') expect(runStat.mode & 0o777).toBe(0o700);
    for (const file of firstBuild.provenance.executedHarnessBinding.files) {
      const stat = await lstat(path.join(runRoot, file.logicalName));
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600);
    }
    const reboundBeforeCleanup = await harnessApi.bindExecutedKgHarness(runRoot);
    expect(reboundBeforeCleanup).toEqual(firstBuild.provenance.executedHarnessBinding);
    expect(preserved.binding).toEqual(firstBuild.provenance.executedHarnessBinding);
    expect(preserved.binding).toEqual(reboundBeforeCleanup);
    expect(preserved.files).toEqual(firstBuild.provenance.executedHarnessBinding.files);
    expect(preserved.directoryBasename).toBe('run-1');
    expect(JSON.stringify(preserved)).not.toContain(firstRoot);
    expect(JSON.stringify(preserved)).not.toContain(evidenceRoot);
    await expect(preserve!({
      sourceRoot: firstRoot,
      evidenceRoot,
      runId: 'run-1',
      expectedBinding: firstBuild.provenance.executedHarnessBinding,
    })).rejects.toBeDefined();
    await rm(firstRoot, { recursive: true, force: true });
    await expect(harnessApi.bindExecutedKgHarness(runRoot))
      .resolves.toEqual(firstBuild.provenance.executedHarnessBinding);
  });

  it('awaits an injected preserve operation before injected cleanup', async () => {
    const preserveThenCleanup = (harnessApi as unknown as {
      preserveThenCleanupExecutedKgHarness?: <T>(input: {
        preserve: () => Promise<T>;
        cleanup: () => Promise<void>;
      }) => Promise<T>;
    }).preserveThenCleanupExecutedKgHarness;
    expect(typeof preserveThenCleanup).toBe('function');
    const order: string[] = [];
    let resolvePreserve!: () => void;
    const preserveGate = new Promise<void>((resolve) => { resolvePreserve = resolve; });
    const running = preserveThenCleanup!({
      preserve: async () => {
        order.push('preserve-start');
        await preserveGate;
        order.push('preserve-complete');
        return { digest: 'preserved' };
      },
      cleanup: async () => { order.push('cleanup'); },
    });
    await Promise.resolve();
    expect(order).toEqual(['preserve-start']);
    resolvePreserve();
    await expect(running).resolves.toEqual({ digest: 'preserved' });
    expect(order).toEqual(['preserve-start', 'preserve-complete', 'cleanup']);
  });

  it('AST-proves the runner preserves the real harness before its sole tempRoot cleanup', async () => {
    const runnerSource = await readFile(
      path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'),
      'utf8',
    );
    const source = ts.createSourceFile(
      'measure-electron-direct-performance.mjs',
      runnerSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    expect((source as ts.SourceFile & {
      readonly parseDiagnostics: readonly ts.Diagnostic[];
    }).parseDiagnostics).toEqual([]);
    const harnessImports = source.statements.filter((statement): statement is ts.ImportDeclaration => (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === './performance-kg-harness.mjs'
    ));
    const importedNames = harnessImports.flatMap((declaration) => {
      const bindings = declaration.importClause?.namedBindings;
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => element.name.text)
        : [];
    });
    expect(importedNames).toEqual(expect.arrayContaining([
      'preserveExecutedKgHarness',
      'preserveThenCleanupExecutedKgHarness',
    ]));

    const helperCalls = collectAst(source, (node): node is ts.CallExpression => (
      ts.isCallExpression(node) && callIdentifier(node) === 'preserveThenCleanupExecutedKgHarness'
    ));
    expect(helperCalls).toHaveLength(1);
    const helperCall = helperCalls[0]!;
    expect(ts.isAwaitExpression(helperCall.parent)).toBe(true);
    const helperInput = helperCall.arguments[0];
    expect(helperInput && ts.isObjectLiteralExpression(helperInput)).toBe(true);
    const helperObject = helperInput as ts.ObjectLiteralExpression;
    const preserveClosure = namedObjectProperty(helperObject, 'preserve');
    const cleanupClosure = namedObjectProperty(helperObject, 'cleanup');
    expect(preserveClosure && (ts.isArrowFunction(preserveClosure) || ts.isFunctionExpression(preserveClosure))).toBe(true);
    expect(cleanupClosure && (ts.isArrowFunction(cleanupClosure) || ts.isFunctionExpression(cleanupClosure))).toBe(true);

    const preserveCalls = collectAst(preserveClosure!, (node): node is ts.CallExpression => (
      ts.isCallExpression(node) && callIdentifier(node) === 'preserveExecutedKgHarness'
    ));
    expect(preserveCalls).toHaveLength(1);
    expect(nearestFunctionAncestor(preserveCalls[0]!)).toBe(preserveClosure);
    expect(isAwaitedOrReturnedWithin(
      preserveCalls[0]!, preserveClosure as ts.ArrowFunction | ts.FunctionExpression,
    )).toBe(true);
    const preserveInput = preserveCalls[0]!.arguments[0];
    expect(preserveInput && ts.isObjectLiteralExpression(preserveInput)).toBe(true);
    const preserveObject = preserveInput as ts.ObjectLiteralExpression;
    const sourceRoot = namedObjectProperty(preserveObject, 'sourceRoot');
    const evidenceRoot = namedObjectProperty(preserveObject, 'evidenceRoot');
    const runId = namedObjectProperty(preserveObject, 'runId');
    const expectedBinding = namedObjectProperty(preserveObject, 'expectedBinding');
    expect(sourceRoot && expressionDependsOn(sourceRoot, source, 'workspace.harnessDir')).toBe(true);
    expect(evidenceRoot && expressionDependsOn(evidenceRoot, source, 'config.outputPath')).toBe(true);
    expect(runId && expressionDependsOn(runId, source, 'config.outputPath')).toBe(true);
    expect(expectedBinding && expressionDependsOn(
      expectedBinding, source, 'preExecutedHarnessBinding',
    )).toBe(true);

    const tempRootRemovals = collectAst(source, (node): node is ts.CallExpression => (
      ts.isCallExpression(node)
      && /^(?:.*\.)?(?:rm|rmdir)(?:Sync)?$/.test(node.expression.getText(source))
      && node.arguments[0]?.getText(source) === 'tempRoot'
    ));
    expect(tempRootRemovals).toHaveLength(1);
    const cleanupCalls = collectAst(cleanupClosure!, (node): node is ts.CallExpression => ts.isCallExpression(node));
    expect(cleanupCalls).toContain(tempRootRemovals[0]);
    expect(nearestFunctionAncestor(tempRootRemovals[0]!)).toBe(cleanupClosure);
    expect(isAwaitedOrReturnedWithin(
      tempRootRemovals[0]!, cleanupClosure as ts.ArrowFunction | ts.FunctionExpression,
    )).toBe(true);
  });
});
