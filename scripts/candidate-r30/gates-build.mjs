import { createHash } from 'node:crypto';
import { access, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import {
  NETWORK_PROFILE, bindCommit, block, buildLedger, classifyInstall, cleanStatus, generatedInputsAbsent,
  trackedFilesFromGit,
} from './contract.mjs';
import {
  artifactSet, desktopRoot, findExecutable, git, privateJson, recorded, repoRoot, sha256File, sha256Path,
} from './io.mjs';

const WORKSPACES = Object.freeze([
  '@copilot/llm-client',
  '@copilot/kb',
  '@copilot/kg',
  '@copilot/rag',
  '@copilot/desktop',
]);

async function npmRun({ gate, name, script, workspace, npm, evidenceDir, extra = [] }) {
  return recorded({ gate, name, command: npm,
    args: ['run', script, '--workspace', workspace, ...extra], evidenceDir });
}

export async function runBuildGates({ sourceCommit, candidateId, evidenceDir }) {
  const root = path.resolve(git(['rev-parse', '--show-toplevel']));
  if (root !== repoRoot) block('BLOCKED_REPO_ROOT_MISMATCH', 1, root);
  const actualCommit = bindCommit(sourceCommit, git(['rev-parse', 'HEAD']));
  const branch = git(['branch', '--show-current']);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await generatedInputsAbsent(repoRoot);
  await privateJson(path.join(evidenceDir, 'gates/gate-01-source.json'), {
    schemaVersion: 1, gate: 1, sourceCommit: actualCommit, branch, sourceClean: true,
    ignoredGeneratedInputsAbsent: true,
  });

  const npm = await findExecutable('npm');
  const install = await recorded({ gate: 2, name: 'npm-ci-offline', command: npm, args: ['ci'], evidenceDir, allowFailure: true });
  const installFailure = classifyInstall(install.status ?? 1, install.stdout, install.stderr);
  if (installFailure) block(installFailure.code, 2, 'npm ci --offline failed', installFailure);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await privateJson(path.join(evidenceDir, 'gates/gate-02-network.json'), {
    schemaVersion: 1, gate: 2, authority: 'offline-only', automaticRegistryFallback: false,
    sandbox: '/usr/bin/sandbox-exec', profileSha256: createHash('sha256').update(NETWORK_PROFILE).digest('hex'), result: 'PASS',
  });

  const trackedFiles = trackedFilesFromGit(git(['ls-files', '-z']));
  const ledger = await buildLedger(repoRoot, sourceCommit, trackedFiles);
  await privateJson(path.join(evidenceDir, 'gates/gate-03-sha256-ledger.json'), ledger);

  const nodeTests = trackedFilesFromGit(git(['ls-files', '-z', 'scripts/candidate-r30/*.test.mjs']));
  await recorded({ gate: 4, name: 'candidate-source-contracts', command: process.execPath,
    args: ['--test', ...nodeTests], evidenceDir });
  await npmRun({ gate: 4, name: 'workspace-deps-build', script: 'build:workspace-deps',
    workspace: '@copilot/desktop', npm, evidenceDir });

  for (const workspace of WORKSPACES) {
    await npmRun({ gate: 5, name: `check-${workspace}`, script: 'check', workspace, npm, evidenceDir });
  }
  for (const workspace of WORKSPACES) {
    await npmRun({ gate: 5, name: `unit-${workspace}`, script: 'test', workspace, npm, evidenceDir });
  }
  for (const workspace of WORKSPACES) {
    await npmRun({ gate: 5, name: `integration-${workspace}`, script: 'test:integration', workspace, npm, evidenceDir });
  }
  for (const workspace of WORKSPACES) {
    await npmRun({ gate: 5, name: `coverage-global-${workspace}`, script: 'test:coverage:global', workspace, npm, evidenceDir });
    await npmRun({ gate: 5, name: `coverage-critical-${workspace}`, script: 'test:coverage:critical', workspace, npm, evidenceDir });
  }
  await npmRun({ gate: 5, name: 'desktop-build', script: 'build', workspace: '@copilot/desktop', npm, evidenceDir });
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await privateJson(path.join(evidenceDir, 'gates/gate-05-source-quality.json'), {
    schemaVersion: 1, gate: 5, workspaces: WORKSPACES, checks: 'PASS', unit: 'PASS', integration: 'PASS',
    coverageGlobal: 'PASS', coverageCritical: 'PASS', desktopBuild: 'PASS', networkAuthority: 'offline-only',
  });

  const packageOutput = path.join(evidenceDir, 'package-output');
  try { await lstat(packageOutput); block('BLOCKED_GATE_06_PACKAGE_OUTPUT_EXISTS', 6, packageOutput); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const electronDist = path.join(repoRoot, 'node_modules/electron/dist');
  if (!(await lstat(electronDist).catch(() => null))?.isDirectory()) block('BLOCKED_GATE_06_ELECTRON_DIST_MISSING', 6, electronDist);
  const builder = path.join(repoRoot, 'node_modules/.bin/electron-builder');
  try { await access(builder, fsConstants.X_OK); } catch { block('BLOCKED_GATE_06_ELECTRON_BUILDER_MISSING', 6, builder); }
  await recorded({ gate: 6, name: 'package-macos-arm64', command: builder, cwd: desktopRoot, evidenceDir,
    env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, args: ['--mac', '--arm64', '--config', path.join(desktopRoot, 'electron-builder.yml'),
      `--config.directories.output=${packageOutput}`, `--config.electronDist=${electronDist}`] });

  const sourceSnapshotPath = path.join(evidenceDir, 'source-snapshot.tar');
  const gitExecutable = await findExecutable('git');
  await recorded({ gate: 7, name: 'source-snapshot', command: gitExecutable,
    args: ['archive', '--format=tar', `--output=${sourceSnapshotPath}`, sourceCommit], evidenceDir });
  const artifacts = await artifactSet(packageOutput);
  const identity = {
    schemaVersion: 1, gate: 7, candidateId, sourceCommit, sourceLedgerPath: path.join(evidenceDir, 'gates/gate-03-sha256-ledger.json'),
    sourceLedgerAggregateSha256: ledger.aggregateSha256, sourceLedgerFileCount: ledger.fileCount,
    sourceSnapshotPath, sourceSnapshotSha256: await sha256File(sourceSnapshotPath),
    zipPath: artifacts.zipPath, zipSha256: await sha256File(artifacts.zipPath),
    dmgPath: artifacts.dmgPath, dmgSha256: await sha256File(artifacts.dmgPath),
    appPath: artifacts.appPath, appSha256: await sha256Path(artifacts.appPath),
    executablePath: artifacts.executablePath, executableSha256: await sha256Path(artifacts.executablePath),
    signing: 'UNSIGNED_DIAGNOSTIC_ONLY',
  };
  await privateJson(path.join(evidenceDir, 'gates/gate-07-artifact-identity.json'), identity);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  return { npm, sourceSnapshotPath, artifacts, identity };
}
