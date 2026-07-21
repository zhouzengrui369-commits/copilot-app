import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type DirectPerformanceApi = {
  createReadyRecord?: (input: Record<string, unknown>) => unknown;
  validateReadyRecord?: (input: unknown, expected: Record<string, unknown>) => unknown;
  validateMetricsRecord?: (input: unknown, expected: Record<string, unknown>) => unknown;
};

type StartupPerformanceApi = {
  STARTUP_MILESTONE_NAMES?: readonly string[];
  createStartupMilestoneReport?: (input: Record<string, unknown>) => {
    clock: 'candidate-process-monotonic-diagnostic-only';
    milestones: Record<string, unknown>;
  };
};

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directConfigUrl = pathToFileURL(
  path.join(desktopRoot, 'scripts/direct-performance-config.mjs'),
).href;
const performanceConfigUrl = pathToFileURL(
  path.join(desktopRoot, 'scripts/performance-config.mjs'),
).href;

const challenge = 'a'.repeat(64);
const candidate = 'v6.2-phase1-candidate-r22';
const sourceSnapshotSha256 = 'b'.repeat(64);
const harnessDigest = 'c'.repeat(64);
const pid = 4242;

async function loadApis() {
  const [direct, startup] = await Promise.all([
    import(/* @vite-ignore */ directConfigUrl) as Promise<DirectPerformanceApi>,
    import(/* @vite-ignore */ performanceConfigUrl) as Promise<StartupPerformanceApi>,
  ]);
  return { direct, startup };
}

function milestoneValues() {
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
    readyToShow: { offsetMs: 17, reason: null },
    rendererShellCommit: { offsetMs: 18, reason: null },
    appRootVisible: { offsetMs: 19, reason: null },
    terminalReady: { offsetMs: 20, reason: null },
  };
}

function readyInput(overrides: Record<string, unknown> = {}) {
  return {
    challenge,
    candidate,
    sourceSnapshotSha256,
    pid,
    nativeWindowVisible: true,
    rendererShellCommit: true,
    rendererAppRootVisible: true,
    completionSignal: true,
    ...overrides,
  };
}

function expectedBinding() {
  return { challenge, candidate, sourceSnapshotSha256, pid };
}

function metricsInput(startupDiagnostics: unknown) {
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
    startupDiagnostics,
  };
}

describe('r22 review-fix RED-A direct diagnostics transport', () => {
  it('requires the exact write-once ready schema to include the shell terminal', async () => {
    const { direct } = await loadApis();
    expect(typeof direct.createReadyRecord).toBe('function');
    expect(typeof direct.validateReadyRecord).toBe('function');

    const ready = direct.createReadyRecord!(readyInput());
    expect(ready).toEqual({
      schemaVersion: 1,
      kind: 'copilot-direct-performance-ready',
      ...readyInput(),
    });
    expect(direct.validateReadyRecord!(ready, expectedBinding())).toEqual(ready);

    for (const hostile of [
      { ...(ready as object), rendererShellCommit: false },
      Object.fromEntries(Object.entries(ready as object).filter(([key]) => key !== 'rendererShellCommit')),
      { ...(ready as object), rendererShellCommit: true, note: 'private' },
    ]) {
      expect(() => direct.validateReadyRecord!(hostile, expectedBinding())).toThrow();
    }
  });

  it('carries one exact validated 14-field candidate diagnostic in post-ready metrics', async () => {
    const { direct, startup } = await loadApis();
    expect(startup.STARTUP_MILESTONE_NAMES).toHaveLength(14);
    expect(typeof startup.createStartupMilestoneReport).toBe('function');
    const report = startup.createStartupMilestoneReport!(milestoneValues());
    expect(report).toEqual({
      clock: 'candidate-process-monotonic-diagnostic-only',
      milestones: milestoneValues(),
    });

    const metrics = metricsInput(report);
    expect(direct.validateMetricsRecord!(metrics, {
      ...expectedBinding(),
      harnessDigest,
    })).toEqual(metrics);
  });

  it('freezes the outer launch value before collect, metrics wait, and diagnostic validation, then publishes the full tuple and unchanged report', async () => {
    const source = await readFile(
      path.join(desktopRoot, 'scripts/measure-electron-direct-performance.mjs'),
      'utf8',
    );
    const freeze = source.indexOf(
      'const directSpawnLaunchMs = readyObservation.observedAtMs - controllerStartedAt;',
    );
    const collect = source.indexOf('await writePrivateJsonOnce({', freeze);
    const metricsWait = source.indexOf('const metricsObservation = await waitForValidatedRecord({', freeze);
    const diagnosticValidation = source.indexOf(
      'const startupDiagnostics = createStartupMilestoneReport(metrics.startupDiagnostics.milestones);',
      freeze,
    );

    expect(source).toContain('createStartupMilestoneReport,');
    expect(freeze).toBeGreaterThanOrEqual(0);
    expect(collect).toBeGreaterThan(freeze);
    expect(metricsWait).toBeGreaterThan(collect);
    expect(diagnosticValidation).toBeGreaterThan(metricsWait);
    expect(source.slice(
      freeze + 'const directSpawnLaunchMs = readyObservation.observedAtMs - controllerStartedAt;'.length,
      diagnosticValidation,
    )).not.toMatch(
      /directSpawnLaunchMs\s*[+\-*/]?=|directSpawnLaunchMs\s*[<>]=?/,
    );
    expect(source).toContain('rendererShellCommit: readyObservation.value.rendererShellCommit');
    expect(source).toContain('diagnostics: startupDiagnostics,');
  });

  it('rejects malformed diagnostics after a caller has frozen the outer clock without mutating that value', async () => {
    const { direct, startup } = await loadApis();
    const frozenDirectSpawnLaunchMs = 1_234.5;
    const mutate = (change: (value: Record<string, any>) => void) => {
      const value = structuredClone(milestoneValues()) as Record<string, any>;
      change(value);
      return value;
    };
    const invalidMilestones = [
      mutate((value) => { value.unknown = { offsetMs: 1, reason: null }; }),
      mutate((value) => { delete value.terminalReady; }),
      mutate((value) => { value.readyToShow = { offsetMs: null, reason: 'arbitrary' }; }),
      mutate((value) => { value.domReady.offsetMs = Number.NaN; }),
      mutate((value) => { value.domReady.offsetMs = Number.POSITIVE_INFINITY; }),
      mutate((value) => { value.domReady.offsetMs = -1; }),
      mutate((value) => { value.appRootVisible.offsetMs = 17; }),
      mutate((value) => { value.path = '/Users/private/profile'; }),
      mutate((value) => { value.domReady.apiKey = 'sk-private'; }),
    ];

    for (const malformed of invalidMilestones) {
      expect(() => startup.createStartupMilestoneReport!(malformed)).toThrow();
      expect(frozenDirectSpawnLaunchMs).toBe(1_234.5);
    }

    const valid = startup.createStartupMilestoneReport!(milestoneValues());
    const malformedReports = [
      { ...valid, clock: 'wall-clock' },
      { ...valid, extra: true },
      { clock: valid.clock },
    ];
    for (const malformed of malformedReports) {
      expect(() => direct.validateMetricsRecord!(metricsInput(malformed), {
        ...expectedBinding(),
        harnessDigest,
      })).toThrow();
      expect(frozenDirectSpawnLaunchMs).toBe(1_234.5);
    }
  });

  it('wires the real main milestone callback and shell terminal through the probe ready and post-ready metrics records', async () => {
    const [mainSource, probeSource] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/direct-performance-probe.ts'), 'utf8'),
    ]);

    const probeCallStart = mainSource.indexOf(
      'directPerformanceProbe = await createDirectPerformanceProbe({',
    );
    const probeCallEnd = mainSource.indexOf('\n  });', probeCallStart);
    expect(probeCallStart).toBeGreaterThanOrEqual(0);
    expect(probeCallEnd).toBeGreaterThan(probeCallStart);
    const probeCall = mainSource.slice(probeCallStart, probeCallEnd);
    expect(probeCall).toMatch(
      /getStartupMilestoneReport\s*(?:,|:\s*\(\)\s*=>\s*getStartupMilestoneReport\(\))/, 
    );
    expect(mainSource).toContain('rendererShellCommit: state.rendererShellCommit');

    const terminalStart = probeSource.indexOf('interface DirectProbeTerminal {');
    const terminalEnd = probeSource.indexOf('\n}', terminalStart);
    expect(terminalStart).toBeGreaterThanOrEqual(0);
    expect(probeSource.slice(terminalStart, terminalEnd)).toContain(
      'rendererShellCommit: boolean;',
    );

    const readyWriteStart = probeSource.indexOf(
      'await writeOncePrivateJson(config.readyPath, config.probeDir, {',
    );
    const readyWriteEnd = probeSource.indexOf('\n  });', readyWriteStart);
    const readyWrite = probeSource.slice(readyWriteStart, readyWriteEnd);
    expect(readyWrite).toContain('rendererShellCommit: terminal.rendererShellCommit');

    const postReady = probeSource.indexOf('await waitForCollectCommand(config, identity);');
    const metricsWriteStart = probeSource.indexOf(
      'await writeOncePrivateJson(config.metricsPath, config.probeDir, {',
      postReady,
    );
    const metricsWriteEnd = probeSource.indexOf('\n  });', metricsWriteStart);
    const callbackCall = probeSource.indexOf('getStartupMilestoneReport()', postReady);
    expect(postReady).toBeGreaterThan(readyWriteEnd);
    expect(metricsWriteStart).toBeGreaterThan(postReady);
    expect(callbackCall).toBeGreaterThan(postReady);
    expect(callbackCall).toBeLessThan(metricsWriteEnd);
    expect(probeSource.slice(metricsWriteStart, metricsWriteEnd)).toContain(
      'startupDiagnostics',
    );
  });
});
