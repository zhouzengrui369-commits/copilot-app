import { createHash } from 'node:crypto';
import path from 'node:path';
import { EXACT_FILES, EXACT_TESTS, block, cleanStatus, exactDiscovery, exactElectron, fullCommit } from './contract.mjs';
import {
  canonical, desktopRoot, e2eEnv, git, privateJson, readJson, recorded, repoRoot, screenshotManifest, sha256File, walk,
} from './io.mjs';

export const FOCUSED_SPECS = Object.freeze([
  'apps/copilot-desktop/tests/e2e/ask-source-back-continuity.spec.ts',
  'apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts',
]);

function verifyIdentity(evidence, sourceCommit, candidateId, identity) {
  if (evidence?.sourceHead !== sourceCommit || evidence?.sourceDirty !== false
    || evidence?.candidateId !== candidateId || evidence?.artifactSha256 !== identity.zipSha256
    || evidence?.sourceSnapshotSha256 !== identity.sourceSnapshotSha256) {
    block('BLOCKED_ELECTRON_IDENTITY_DRIFT', 10);
  }
}

export async function buildTestDataManifestData({
  sourceCommit,
  candidateId,
  discovery,
  repositoryRoot = repoRoot,
  e2eRoot = path.join(desktopRoot, 'tests/e2e'),
}) {
  fullCommit(sourceCommit, 'test-data');
  if (discovery?.tests !== EXACT_TESTS || discovery?.files !== EXACT_FILES) {
    block('BLOCKED_GATE_09_DISCOVERY_NOT_EXACT', 9);
  }
  const entries = await walk(e2eRoot);
  const files = [];
  for (const { absolute, entry } of entries) {
    if (entry.isSymbolicLink()) block('BLOCKED_GATE_09_TEST_DATA_SYMLINK', 9, absolute);
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const relative = path.relative(repositoryRoot, absolute).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) block('BLOCKED_GATE_09_TEST_DATA_OUTSIDE_REPO', 9, relative);
    files.push({ path: relative, sha256: await sha256File(absolute, {
      gate: 9, code: 'BLOCKED_GATE_09_TEST_DATA_FILE_NOT_REGULAR',
    }) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const specs = files.filter((entry) => entry.path.endsWith('.spec.ts'));
  const supportFiles = files.filter((entry) => !entry.path.endsWith('.spec.ts'));
  if (specs.length !== EXACT_FILES) block('BLOCKED_GATE_09_SPEC_FILE_SET', 9, `count=${specs.length}`);
  if (supportFiles.length === 0) block('BLOCKED_GATE_09_SUPPORT_FILE_SET_EMPTY', 9);
  const contentAggregateSha256 = createHash('sha256').update(canonical(files)).digest('hex');
  return {
    schemaVersion: 2,
    candidateId,
    sourceCommit,
    classification: 'SYNTHETIC_E2E_FIXTURE_ONLY',
    realUserDataUsed: false,
    discoveredTests: discovery.tests,
    discoveredFiles: discovery.files,
    contentAggregateSha256,
    files,
    specs: specs.map((entry) => entry.path),
    supportFiles: supportFiles.map((entry) => entry.path),
  };
}

async function testDataManifest({ sourceCommit, candidateId, discovery, evidenceDir }) {
  const manifest = await buildTestDataManifestData({ sourceCommit, candidateId, discovery });
  const file = path.join(evidenceDir, 'test-data-manifest.json'); await privateJson(file, manifest);
  return { path: file, sha256: await sha256File(file, { gate: 9 }), manifest };
}

export async function runElectronGates({ sourceCommit, candidateId, evidenceDir, npm, sourceSnapshotPath, artifacts, identity }) {
  const focusedEnv = e2eEnv({ candidateId, sourceSnapshotPath, artifacts, evidenceDir, profile: 'exp-cop-008-009-focused' });
  await recorded({ gate: 8, name: 'focused-packaged-electron', command: npm,
    args: ['run', 'test:e2e:electron', '--workspace', '@copilot/desktop', '--', ...FOCUSED_SPECS], evidenceDir, env: focusedEnv });
  const focused = await readJson(focusedEnv.COPILOT_E2E_EVIDENCE_PATH);
  exactElectron(focused, 2); verifyIdentity(focused, sourceCommit, candidateId, identity);
  await privateJson(path.join(evidenceDir, 'gates/gate-08-focused-electron.json'), {
    schemaVersion: 1, gate: 8, counts: focused.counts, cleanProcessExit: focused.cleanProcessExit,
    evidencePath: focusedEnv.COPILOT_E2E_EVIDENCE_PATH, evidenceSha256: await sha256File(focusedEnv.COPILOT_E2E_EVIDENCE_PATH, { gate: 8 }),
  });

  const listed = await recorded({ gate: 9, name: 'electron-list-exact', command: npm,
    args: ['run', 'test:e2e:electron', '--workspace', '@copilot/desktop', '--', '--list'], evidenceDir });
  const discovery = exactDiscovery(`${listed.stdout ?? ''}\n${listed.stderr ?? ''}`);
  const testData = await testDataManifest({ sourceCommit, candidateId, discovery, evidenceDir });
  await privateJson(path.join(evidenceDir, 'gates/gate-09-discovery.json'), {
    schemaVersion: 2, gate: 9, ...discovery, testDataManifestPath: testData.path,
    testDataManifestSha256: testData.sha256, testDataContentAggregateSha256: testData.manifest.contentAggregateSha256,
    testDataFileCount: testData.manifest.files.length,
  });

  const fullEnv = e2eEnv({ candidateId, sourceSnapshotPath, artifacts, evidenceDir, profile: 'full' });
  await recorded({ gate: 10, name: 'full-packaged-electron', command: npm,
    args: ['run', 'test:e2e:electron', '--workspace', '@copilot/desktop'], evidenceDir, env: fullEnv });
  const full = await readJson(fullEnv.COPILOT_E2E_EVIDENCE_PATH);
  exactElectron(full, EXACT_TESTS); verifyIdentity(full, sourceCommit, candidateId, identity);
  const runtimeId = createHash('sha256').update(canonical({ candidateId, sourceCommit, artifactSha256: identity.zipSha256,
    runtimeIdentity: full.runtimeIdentity })).digest('hex');
  await privateJson(path.join(evidenceDir, 'gates/gate-10-full-electron.json'), {
    schemaVersion: 1, gate: 10, counts: full.counts, cleanProcessExit: full.cleanProcessExit, runtimeId,
    evidencePath: fullEnv.COPILOT_E2E_EVIDENCE_PATH, evidenceSha256: await sha256File(fullEnv.COPILOT_E2E_EVIDENCE_PATH, { gate: 10 }),
  });

  const screenshots = await screenshotManifest(evidenceDir);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  const manifest = {
    schemaVersion: 2, runner: 'copilot-r30-github-bound-candidate-runner', candidateId,
    status: 'PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE', mvpStatus: 'MVP_NOT_COMPLETE', releaseStatus: 'BLOCKED_UNSIGNED_NOT_NOTARIZED',
    source: { commit: sourceCommit, clean: true, snapshotPath: identity.sourceSnapshotPath,
      snapshotSha256: identity.sourceSnapshotSha256, ledgerPath: identity.sourceLedgerPath,
      ledgerAggregateSha256: identity.sourceLedgerAggregateSha256, ledgerFileCount: identity.sourceLedgerFileCount },
    artifact: { zipPath: identity.zipPath, zipSha256: identity.zipSha256, dmgPath: identity.dmgPath, dmgSha256: identity.dmgSha256,
      appPath: identity.appPath, appSha256: identity.appSha256, executablePath: identity.executablePath,
      executableSha256: identity.executableSha256, signing: identity.signing },
    runtime: { runtimeId, identity: full.runtimeIdentity, processTerminalState: { clean: full.cleanProcessExit,
      exitCode: full.processExitCode, signalCode: full.processSignalCode } },
    testDataManifest: { path: testData.path, sha256: testData.sha256, contentAggregateSha256: testData.manifest.contentAggregateSha256,
      fileCount: testData.manifest.files.length, classification: testData.manifest.classification, realUserDataUsed: false },
    electron: { focused: focused.counts, discovery, full: full.counts }, screenshots,
    networkAuthority: 'offline-only', automaticRegistryFallback: false, completedAt: new Date().toISOString(),
  };
  const manifestPath = path.join(evidenceDir, 'CANDIDATE-MANIFEST.json'); await privateJson(manifestPath, manifest);
  await privateJson(path.join(evidenceDir, 'R30-COMPLETE.json'), { schemaVersion: 2, status: manifest.status,
    manifestPath, manifestSha256: await sha256File(manifestPath, { gate: 11 }), mvpStatus: 'MVP_NOT_COMPLETE' });
  return { manifestPath, manifest };
}
