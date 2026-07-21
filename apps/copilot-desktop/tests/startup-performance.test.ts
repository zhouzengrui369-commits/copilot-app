import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-ignore JavaScript helper is exercised directly by Vitest.
import * as performanceConfig from '../scripts/performance-config.mjs';

type StartupPerformanceApi = {
  STARTUP_MILESTONE_NAMES?: readonly string[];
  createStartupMilestoneReport?: (input: Record<string, unknown>) => unknown;
  isStartupLaunchComplete?: (input: {
    nativeWindowVisible: boolean;
    appRootVisible: boolean;
  }) => boolean;
  createStartupCandidateBinding?: (input: Record<string, unknown>) => unknown;
  aggregateStartupRuns?: (runs: Array<Record<string, unknown>>) => unknown;
  resolveStartupCandidateBindingConfig?: (input: { env: Record<string, string> }) => unknown;
  bindStartupCandidateArtifacts?: (input: Record<string, unknown>) => Promise<unknown>;
  bindAuthoritativeSnapshotFileSet?: (input: {
    snapshotRoot: string;
    manifest: Record<string, unknown>;
  }) => Promise<unknown>;
};

const api = performanceConfig as StartupPerformanceApi;
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedMilestones = [
  'processStart',
  'appWhenReady',
  'releaseIdentityStart',
  'releaseIdentityEnd',
  'directProbeInitStart',
  'directProbeInitEnd',
  'windowCreateStart',
  'windowCreated',
  'rendererLoadStart',
  'domReady',
  'readyToShow',
  'rendererShellCommit',
  'appRootVisible',
  'terminalReady',
] as const;
const tempRoots: string[] = [];

function sha256(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function snapshotAggregate(entries: Array<{ relativePath: string; contents: Buffer }>): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ))) {
    hash.update(`\0${entry.relativePath}\0`);
    hash.update(entry.contents);
  }
  return hash.digest('hex');
}

function authoritativeManifest(entries: Array<{ relativePath: string; contents: Buffer }>) {
  const sorted = [...entries].sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  return {
    schemaVersion: 1,
    algorithm: 'sha256-null-delimited-relative-path-and-bytes-v1',
    fileCount: sorted.length,
    aggregateSha256: snapshotAggregate(sorted),
    entries: sorted.map((entry) => ({
      relativePath: entry.relativePath,
      bytes: entry.contents.byteLength,
      sha256: sha256(entry.contents),
    })),
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('r19 startup performance contract', () => {
  it('requires fixed privacy-safe causal milestones with field-specific null reasons', () => {
    expect(api.STARTUP_MILESTONE_NAMES).toEqual(expectedMilestones);
    expect(typeof api.createStartupMilestoneReport).toBe('function');

    const overlappingParallelMilestones = {
      processStart: { offsetMs: 0, reason: null },
      appWhenReady: { offsetMs: 10, reason: null },
      releaseIdentityStart: { offsetMs: 11, reason: null },
      releaseIdentityEnd: { offsetMs: 50, reason: null },
      directProbeInitStart: { offsetMs: 12, reason: null },
      directProbeInitEnd: { offsetMs: 40, reason: null },
      windowCreateStart: { offsetMs: 11.5, reason: null },
      windowCreated: { offsetMs: 20, reason: null },
      rendererLoadStart: { offsetMs: 21, reason: null },
      domReady: { offsetMs: 30, reason: null },
      readyToShow: { offsetMs: 36, reason: null },
      rendererShellCommit: { offsetMs: 32, reason: null },
      appRootVisible: { offsetMs: 35, reason: null },
      terminalReady: { offsetMs: 51, reason: null },
    };
    const report = api.createStartupMilestoneReport!(overlappingParallelMilestones);

    expect(report).toEqual({
      clock: 'candidate-process-monotonic-diagnostic-only',
      milestones: overlappingParallelMilestones,
    });
    expect(JSON.stringify(report)).not.toMatch(/\/Users\/|file:\/\/|api[_-]?key|note content/i);

    const developmentReport = api.createStartupMilestoneReport!({
      ...overlappingParallelMilestones,
      releaseIdentityStart: { offsetMs: null, reason: 'development-runtime' },
      releaseIdentityEnd: { offsetMs: null, reason: 'development-runtime' },
      directProbeInitStart: { offsetMs: null, reason: 'direct-performance-mode-disabled' },
      directProbeInitEnd: { offsetMs: null, reason: 'direct-performance-mode-disabled' },
    });
    expect(developmentReport).toMatchObject({
      milestones: {
        releaseIdentityStart: { offsetMs: null, reason: 'development-runtime' },
        releaseIdentityEnd: { offsetMs: null, reason: 'development-runtime' },
        directProbeInitStart: { offsetMs: null, reason: 'direct-performance-mode-disabled' },
        directProbeInitEnd: { offsetMs: null, reason: 'direct-performance-mode-disabled' },
      },
    });

    expect(() => api.createStartupMilestoneReport!({
      ...overlappingParallelMilestones,
      releaseIdentityEnd: { offsetMs: 9, reason: null },
    })).toThrow(/causal/i);

    expect(() => api.createStartupMilestoneReport!({
      ...overlappingParallelMilestones,
      appWhenReady: { offsetMs: null, reason: null },
    })).toThrow(/reason/i);

    expect(() => api.createStartupMilestoneReport!({
      ...overlappingParallelMilestones,
      privatePath: '/Users/private/notes',
    })).toThrow(/unknown milestone/i);
  });

  it('registers ready-to-show before renderer loading begins', async () => {
    const source = await readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    const readyListener = source.indexOf("mainWindow.once('ready-to-show'");
    const firstLoad = Math.min(
      ...[source.indexOf('await mainWindow.loadURL('), source.indexOf('await mainWindow.loadFile(')]
        .filter((index) => index >= 0),
    );

    expect(readyListener).toBeGreaterThanOrEqual(0);
    expect(readyListener).toBeLessThan(firstLoad);
  });

  it('fails closed unless native BrowserWindow and DOM app-root are both visible', () => {
    expect(typeof api.isStartupLaunchComplete).toBe('function');
    expect(api.isStartupLaunchComplete!({ nativeWindowVisible: false, appRootVisible: true })).toBe(false);
    expect(api.isStartupLaunchComplete!({ nativeWindowVisible: true, appRootVisible: false })).toBe(false);
    expect(api.isStartupLaunchComplete!({ nativeWindowVisible: true, appRootVisible: true })).toBe(true);
  });

  it('keeps the outer controller clock authoritative and captures internal milestones diagnostically', async () => {
    const source = await readFile(path.join(desktopRoot, 'scripts/measure-electron-performance.mjs'), 'utf8');
    const controllerStart = source.indexOf('const controllerStartedAt = performance.now()');
    const electronLaunch = source.indexOf('await electron.launch(');

    expect(controllerStart).toBeGreaterThanOrEqual(0);
    expect(controllerStart).toBeLessThan(electronLaunch);
    expect(source).toContain('isStartupLaunchComplete');
    expect(source).toContain('BrowserWindow.getAllWindows()');
    expect(source).toContain('startup.getMilestones()');
    expect(source).toContain('outerControllerLaunchMs');
    expect(source.match(/bindStartupCandidateArtifacts/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('freezes the outer gate at dual visibility before diagnostic IPC readback', async () => {
    const source = await readFile(path.join(desktopRoot, 'scripts/measure-electron-performance.mjs'), 'utf8');
    const waitStart = source.indexOf('async function waitForStartupCompletion');
    const waitEnd = source.indexOf('\nasync function ', waitStart + 1);
    const waitBody = source.slice(waitStart, waitEnd < 0 ? source.length : waitEnd);
    const freeze = source.indexOf('const outerControllerLaunchMs = startupCompletion.completedAtMs;');
    const diagnosticRead = source.indexOf('await readStartupMilestoneReport(');

    expect(waitStart).toBeGreaterThanOrEqual(0);
    expect(waitBody).not.toContain('startup.getMilestones()');
    expect(waitBody).not.toContain('internalAppRootReached');
    expect(freeze).toBeGreaterThanOrEqual(0);
    expect(diagnosticRead).toBeGreaterThan(freeze);
  });

  it('uses a renderer-local completion event so observer RPC cannot delay the gate', async () => {
    const [runner, main, preload] = await Promise.all([
      readFile(path.join(desktopRoot, 'scripts/measure-electron-performance.mjs'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/preload.ts'), 'utf8'),
    ]);
    const freeze = runner.indexOf(
      'const outerControllerLaunchMs = startupCompletion.completedAtMs;',
    );
    const postGateNativeAssertion = runner.indexOf(
      'const postGateNativeWindowVisible = await electronApp.evaluate(',
    );

    expect(main).toContain('IPC_CHANNELS.STARTUP_COMPLETE');
    expect(main).toContain("mainWindow.webContents.send(IPC_CHANNELS.STARTUP_COMPLETE)");
    expect(preload).toContain("ipcRenderer.on(IPC_CHANNELS.STARTUP_COMPLETE");
    expect(preload).toContain('isComplete: () => startupComplete');
    expect(runner).toContain('startup.isComplete()');
    expect(freeze).toBeGreaterThanOrEqual(0);
    expect(postGateNativeAssertion).toBeGreaterThan(freeze);
  });

  it('persists and re-verifies the canonical authoritative source-input manifest', async () => {
    const builder = await readFile(
      path.join(desktopRoot, 'scripts/build-canonical-release.mjs'),
      'utf8',
    );

    expect(builder).toContain("'source-snapshot-inputs.json'");
    expect(builder).toContain('authoritativeInputs: authoritativeInputs.binding');
    expect(builder).toContain('await verifyAuthoritativeSnapshotInputs(');
    expect(builder).toContain(
      "const snapshotAggregateAlgorithm = 'sha256-null-delimited-relative-path-and-bytes-v1'",
    );
    expect(builder).toContain('algorithm: snapshotAggregateAlgorithm');
  });

  it('uses one locale-independent code-unit order for uppercase and lowercase paths', async () => {
    const builder = await readFile(
      path.join(desktopRoot, 'scripts/build-canonical-release.mjs'),
      'utf8',
    );
    const binder = await readFile(
      path.join(desktopRoot, 'scripts/performance-config.mjs'),
      'utf8',
    );
    expect(builder).toContain('.sort(compareCanonicalPaths)');
    expect(binder).toContain('.sort(compareLogicalPaths)');

    const root = await mkdtemp(path.join(os.tmpdir(), 'r20-source-snapshot-order-'));
    tempRoots.push(root);
    const entries = [
      { relativePath: 'apps/copilot-cloud/cloudbaserc.json', contents: Buffer.from('lower') },
      { relativePath: 'apps/copilot-cloud/Dockerfile', contents: Buffer.from('upper') },
    ];
    for (const entry of entries) {
      const target = path.join(root, entry.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.contents);
    }
    const manifest = authoritativeManifest(entries);
    expect(manifest.entries.map((entry) => entry.relativePath)).toEqual([
      'apps/copilot-cloud/Dockerfile',
      'apps/copilot-cloud/cloudbaserc.json',
    ]);
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest }))
      .resolves.toMatchObject({ sha256: manifest.aggregateSha256, fileCount: 2 });
  });

  it('binds executable, app.asar, release identity, and immutable source snapshot', () => {
    expect(typeof api.createStartupCandidateBinding).toBe('function');
    const binding = api.createStartupCandidateBinding!({
      candidate: 'v6.2-phase1-candidate-r19',
      executable: { basename: 'njx-copilot-v6', bytes: 50_472, sha256: 'a'.repeat(64) },
      appAsar: { basename: 'app.asar', bytes: 123_456, sha256: 'b'.repeat(64) },
      releaseIdentity: { basename: 'release-identity.json', bytes: 223, sha256: 'c'.repeat(64) },
      sourceSnapshot: { basename: 'source-snapshot.json', bytes: 4_096, sha256: 'd'.repeat(64) },
    });

    expect(binding).toMatchObject({
      candidate: 'v6.2-phase1-candidate-r19',
      executable: { sha256: 'a'.repeat(64), pathScope: 'host-local-redacted' },
      appAsar: { sha256: 'b'.repeat(64), pathScope: 'host-local-redacted' },
      releaseIdentity: { sha256: 'c'.repeat(64), pathScope: 'host-local-redacted' },
      sourceSnapshot: { sha256: 'd'.repeat(64), pathScope: 'host-local-redacted' },
    });
    expect(JSON.stringify(binding)).not.toContain('/Users/');
  });

  it('fails closed unless packaged artifact paths agree on candidate and snapshot identity', async () => {
    expect(typeof api.resolveStartupCandidateBindingConfig).toBe('function');
    expect(typeof api.bindStartupCandidateArtifacts).toBe('function');
    const root = await mkdtemp(path.join(os.tmpdir(), 'r19-startup-binding-'));
    tempRoots.push(root);
    const executablePath = path.join(root, 'njx-copilot-v6');
    const appAsarPath = path.join(root, 'app.asar');
    const releaseIdentityPath = path.join(root, 'RELEASE-IDENTITY.json');
    const canonicalManifestPath = path.join(root, 'CANONICAL-MANIFEST.json');
    const sourceSnapshotRoot = path.join(root, 'work/source-snapshot');
    const sourceInputManifestPath = path.join(root, 'work/source-snapshot-inputs.json');
    const sourceEntry = {
      relativePath: 'apps/copilot-desktop/src/main/main.ts',
      contents: Buffer.from('candidate-r20-main'),
    };
    await mkdir(path.dirname(path.join(sourceSnapshotRoot, sourceEntry.relativePath)), {
      recursive: true,
    });
    await writeFile(path.join(sourceSnapshotRoot, sourceEntry.relativePath), sourceEntry.contents);
    const sourceInputManifest = authoritativeManifest([sourceEntry]);
    const sourceInputManifestBytes = Buffer.from(`${JSON.stringify(sourceInputManifest, null, 2)}\n`);
    await writeFile(sourceInputManifestPath, sourceInputManifestBytes);
    const snapshotSha256 = sourceInputManifest.aggregateSha256;
    await writeFile(executablePath, 'executable', 'utf8');
    await writeFile(appAsarPath, 'asar', 'utf8');
    await writeFile(releaseIdentityPath, JSON.stringify({
      candidate: 'v6.2-phase1-candidate-r20',
      sourceSnapshotSha256: snapshotSha256,
    }), 'utf8');
    await writeFile(canonicalManifestPath, JSON.stringify({
      candidate: 'v6.2-phase1-candidate-r20',
      source: { snapshot: {
        fileCount: 1,
        sha256: snapshotSha256,
        authoritativeInputs: {
          relativePath: 'work/source-snapshot-inputs.json',
          bytes: sourceInputManifestBytes.byteLength,
          sha256: sha256(sourceInputManifestBytes),
          fileCount: 1,
          aggregateSha256: snapshotSha256,
        },
      } },
    }), 'utf8');

    const config = api.resolveStartupCandidateBindingConfig!({ env: {
      COPILOT_PERF_CANDIDATE_ID: 'v6.2-phase1-candidate-r20',
      COPILOT_PERF_EXECUTABLE_PATH: executablePath,
      COPILOT_PERF_APP_ASAR_PATH: appAsarPath,
      COPILOT_PERF_RELEASE_IDENTITY_PATH: releaseIdentityPath,
      COPILOT_PERF_CANONICAL_MANIFEST_PATH: canonicalManifestPath,
      COPILOT_PERF_SOURCE_ROOT: sourceSnapshotRoot,
    } }) as Record<string, unknown>;
    const binding = await api.bindStartupCandidateArtifacts!(config);

    expect(binding).toMatchObject({
      candidate: 'v6.2-phase1-candidate-r20',
      executable: { basename: 'njx-copilot-v6' },
      appAsar: { basename: 'app.asar' },
      releaseIdentity: { basename: 'RELEASE-IDENTITY.json' },
      sourceSnapshot: {
        basename: 'source-snapshot',
        sha256: snapshotSha256,
        fileCount: 1,
      },
    });
    expect(JSON.stringify(binding)).not.toContain(root);

    await writeFile(
      path.join(sourceSnapshotRoot, sourceEntry.relativePath),
      'candidate-r20-main-mutated',
      'utf8',
    );
    await expect(api.bindStartupCandidateArtifacts!(config))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED' });
    await writeFile(path.join(sourceSnapshotRoot, sourceEntry.relativePath), sourceEntry.contents);

    await writeFile(releaseIdentityPath, JSON.stringify({
      candidate: 'v6.2-phase1-candidate-r18',
      sourceSnapshotSha256: snapshotSha256,
    }), 'utf8');
    await expect(api.bindStartupCandidateArtifacts!(config))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_CANDIDATE_BINDING' });
  });

  it('rehashes authoritative snapshot inputs and detects changed or missing files', async () => {
    expect(typeof api.bindAuthoritativeSnapshotFileSet).toBe('function');
    const root = await mkdtemp(path.join(os.tmpdir(), 'r20-source-snapshot-'));
    tempRoots.push(root);
    const entries = [
      { relativePath: 'apps/copilot-desktop/src/main/main.ts', contents: Buffer.from('main-v1') },
      { relativePath: 'packages/kg/src/index.ts', contents: Buffer.from('kg-v1') },
    ];
    for (const entry of entries) {
      const target = path.join(root, entry.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.contents);
    }
    const manifest = authoritativeManifest(entries);

    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest }))
      .resolves.toMatchObject({
        fileCount: 2,
        bytes: entries.reduce((sum, entry) => sum + entry.contents.byteLength, 0),
        sha256: manifest.aggregateSha256,
      });
    await writeFile(path.join(root, entries[0].relativePath), 'main-mutated', 'utf8');
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest }))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED' });
    await rm(path.join(root, entries[1].relativePath));
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest }))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED' });
  });

  it('rejects traversal, duplicate logical paths, and symlink escape in snapshot inputs', async () => {
    expect(typeof api.bindAuthoritativeSnapshotFileSet).toBe('function');
    const root = await mkdtemp(path.join(os.tmpdir(), 'r20-source-snapshot-hostile-'));
    tempRoots.push(root);
    const file = { relativePath: 'src/main.ts', contents: Buffer.from('safe') };
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, file.relativePath), file.contents);

    const traversal = authoritativeManifest([file]);
    traversal.entries[0].relativePath = '../outside.ts';
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest: traversal }))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST' });

    const duplicate = authoritativeManifest([file]);
    duplicate.entries.push({ ...duplicate.entries[0] });
    duplicate.fileCount = 2;
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest: duplicate }))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST' });

    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`);
    tempRoots.push(outside);
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, path.join(root, 'escape.ts'));
    const escaped = authoritativeManifest([
      { relativePath: 'escape.ts', contents: Buffer.from('outside') },
    ]);
    await expect(api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest: escaped }))
      .rejects.toMatchObject({ code: 'BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST' });
  });

  it('ignores explicitly non-authoritative generated extras while preserving the input digest', async () => {
    expect(typeof api.bindAuthoritativeSnapshotFileSet).toBe('function');
    const root = await mkdtemp(path.join(os.tmpdir(), 'r20-source-snapshot-extras-'));
    tempRoots.push(root);
    const entry = { relativePath: 'src/main.ts', contents: Buffer.from('source') };
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, entry.relativePath), entry.contents);
    const manifest = authoritativeManifest([entry]);
    const before = await api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest });
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist/generated.js'), 'generated', 'utf8');
    const withExtra = await api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest });
    await rm(path.join(root, 'dist/generated.js'));
    const afterExtraRemoved = await api.bindAuthoritativeSnapshotFileSet!({ snapshotRoot: root, manifest });

    expect(withExtra).toEqual(before);
    expect(afterExtraRemoved).toEqual(before);
  });

  it('retains exactly three raw runs and fails when any outer duration is at least 2000ms', () => {
    expect(typeof api.aggregateStartupRuns).toBe('function');
    const aggregate = api.aggregateStartupRuns!([
      { raw: 'run-1.json', outerControllerLaunchMs: 1_100 },
      { raw: 'run-2.json', outerControllerLaunchMs: 2_000 },
      { raw: 'run-3.json', outerControllerLaunchMs: 1_300 },
    ]);

    expect(aggregate).toMatchObject({
      runCount: 3,
      rawRuns: [
        { raw: 'run-1.json', outerControllerLaunchMs: 1_100 },
        { raw: 'run-2.json', outerControllerLaunchMs: 2_000 },
        { raw: 'run-3.json', outerControllerLaunchMs: 1_300 },
      ],
      medianOuterControllerLaunchMs: 1_300,
      maxOuterControllerLaunchMs: 2_000,
      thresholdExclusiveMs: 2_000,
      pass: false,
    });
    expect(() => api.aggregateStartupRuns!([
      { raw: 'run-1.json', outerControllerLaunchMs: 1_100 },
      { raw: 'run-2.json', outerControllerLaunchMs: 1_200 },
    ])).toThrow(/exactly three/i);
  });
});
