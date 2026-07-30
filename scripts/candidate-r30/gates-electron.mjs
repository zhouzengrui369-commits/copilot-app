import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { EXACT_FILES, EXACT_TESTS, block, cleanStatus, exactDiscovery, exactElectron } from './contract.mjs';
import {
  canonical, desktopRoot, e2eEnv, git, privateJson, readJson, recorded, screenshotManifest, sha256File,
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
async function testDataManifest({ sourceCommit, candidateId, discovery, evidenceDir }) {
  const directory = path.join(desktopRoot, 'tests/e2e');
  const specs = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => `apps/copilot-desktop/tests/e2e/${entry.name}`).sort();
  if (specs.length !== EXACT_FILES) block('BLOCKED_GATE_09_SPEC_FILE_SET', 9, `count=${specs.length}`);
  const manifest = { schemaVersion: 1, candidateId, sourceCommit, classification: 'SYNTHETIC_E2E_FIXTURE_ONLY',
    realUserDataUsed: false, discoveredTests: discovery.tests, discoveredFiles: discovery.files, specs };
  const file = path.join(evidenceDir, 'test-data-manifest.json'); await privateJson(file, manifest);
  return { path: file, sha256: await sha256File(file), manifest };
}

export async function runElectronGates({ sourceCommit, candidateId, evidenceDir, npm, sourceSnapshotPath, artifacts, identity }) {
  const focusedEnv = e2eEnv({ candidateId, sourceSnapshotPath, artifacts, evidenceDir, profile: 'exp-cop-008-009-focused' });
  await recorded({ gate: 8, name: 'focused-packaged-electron', command: npm,
    args: ['run', 'test:e2e:electron', '--workspace', '@copilot/desktop', '--', ...FOCUSED_SPECS], evidenceDir, env: focusedEnv });
  const focused = await readJson(focusedEnv.COPILOT_E2E_EVIDENCE_PATH);
  exactElectron(focused, 2); verifyIdentity(focused, sourceCommit, candidateId, identity);
  await privateJson(path.join(evidenceDir, 'gates/gate-08-focused-electron.json'), {
    schemaVersion: 1, gate: 8, counts: focused.counts, cleanProcessExit: focused.cleanProcessExit,
    evidencePath: focusedEnv.COPILOT_E2E_EVIDENCE_PATH, evidenceSha256: await sha256File(focusedEnv.COPILOT_E2E_EVIDENCE_PATH),
  });

  const listed = await recorded({ gate: 9, name: 'electron-list-exact', command: npm,
    args: ['run', 'test:e2e:electron', '--workspace', '@copilot/desktop', '--', '--list'], evidenceDir });
  const discovery = exactDiscovery(`${listed.stdout ?? ''}\n${listed.stderr ?? ''}`);
  const testData = await testDataManifest({ sourceCommit, candidateId, discovery, evidenceDir });
  await privateJson(path.join(evidenceDir, 'gates/gate-09-discovery.json'), {
    schemaVersion: 1, gate: 9, ...discovery, testDataManifestPath: testData.path, testDataManifestSha256: testData.sha256,
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
    evidencePath: fullEnv.COPILOT_E2E_EVIDENCE_PATH, evidenceSha256: await sha256File(fullEnv.COPILOT_E2E_EVIDENCE_PATH),
  });

  const screenshots = await screenshotManifest(evidenceDir);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  const manifest = {
    schemaVersion: 1, runner: 'copilot-r30-github-bound-candidate-runner', candidateId,
    status: 'PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE', mvpStatus: 'MVP_NOT_COMPLETE', releaseStatus: 'BLOCKED_UNSIGNED_NOT_NOTARIZED',
    source: { commit: sourceCommit, clean: true, snapshotPath: identity.sourceSnapshotPath, snapshotSha256: identity.sourceSnapshotSha256 },
    artifact: { zipPath: identity.zipPath, zipSha256: identity.zipSha256, dmgPath: identity.dmgPath, dmgSha256: identity.dmgSha256,
      appPath: identity.appPath, appSha256: identity.appSha256, executablePath: identity.executablePath,
      executableSha256: identity.executableSha256, signing: identity.signing },
    runtime: { runtimeId, identity: full.runtimeIdentity, processTerminalState: { clean: full.cleanProcessExit,
      exitCode: full.processExitCode, signalCode: full.processSignalCode } },
    testDataManifest: { path: testData.path, sha256: testData.sha256, classification: testData.manifest.classification },
    electron: { focused: focused.counts, discovery, full: full.counts }, screenshots,
    networkAuthority: 'offline-only', automaticRegistryFallback: false, completedAt: new Date().toISOString(),
  };
  const manifestPath = path.join(evidenceDir, 'CANDIDATE-MANIFEST.json'); await privateJson(manifestPath, manifest);
  await privateJson(path.join(evidenceDir, 'R30-COMPLETE.json'), { schemaVersion: 1, status: manifest.status,
    manifestPath, manifestSha256: await sha256File(manifestPath), mvpStatus: 'MVP_NOT_COMPLETE' });
  return { manifestPath, manifest };
}
