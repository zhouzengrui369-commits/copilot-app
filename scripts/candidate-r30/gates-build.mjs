import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  NETWORK_PROFILE,
  bindCommit,
  block,
  buildLedger,
  classifyInstall,
  cleanStatus,
  generatedInputsAbsent,
  trackedFilesFromGit,
} from './contract.mjs';
import { runCanonicalReleaseR31 } from './canonical-release-r31.mjs';
import {
  findExecutable,
  git,
  privateJson,
  recorded,
  repoRoot,
  sha256File,
} from './io.mjs';
import { NPM_REGISTRY, getIsolatedNpmConfigFiles, validateHydrationReceipt } from './npm-cache-hydrate.mjs';
import { parseAndValidateCycloneDxSbom } from './sbom.mjs';

const CORE_WORKSPACES = Object.freeze([
  '@copilot/llm-client',
  '@copilot/kb',
  '@copilot/kg',
  '@copilot/rag',
]);
const CHECK_WORKSPACES = Object.freeze([...CORE_WORKSPACES, '@copilot/desktop']);

async function npmRun({ gate, name, script, workspace, npm, evidenceDir, extra = [] }) {
  return recorded({
    gate,
    name,
    command: npm,
    args: ['run', script, '--workspace', workspace, ...extra],
    evidenceDir,
  });
}

export async function runBuildGates({
  sourceCommit,
  candidateId,
  evidenceDir,
  npmCacheDir = null,
  npmCacheReceipt = null,
}) {
  const root = path.resolve(git(['rev-parse', '--show-toplevel']));
  if (root !== repoRoot) block('BLOCKED_REPO_ROOT_MISMATCH', 1, root);
  const actualCommit = bindCommit(sourceCommit, git(['rev-parse', 'HEAD']));
  const branch = git(['branch', '--show-current']);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await generatedInputsAbsent(repoRoot);
  await privateJson(path.join(evidenceDir, 'gates/gate-01-source.json'), {
    schemaVersion: 1,
    gate: 1,
    sourceCommit: actualCommit,
    branch,
    sourceClean: true,
    ignoredGeneratedInputsAbsent: true,
  });

  let hydratedCache = null;
  if (npmCacheDir || npmCacheReceipt) {
    if (!npmCacheDir || !npmCacheReceipt) {
      block(
        'BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT',
        2,
        '--npm-cache-dir and --npm-cache-receipt must be supplied together',
      );
    }
    try {
      hydratedCache = await validateHydrationReceipt({
        repository: repoRoot,
        sourceCommit,
        cacheDir: npmCacheDir,
        receiptPath: npmCacheReceipt,
      });
    } catch (error) {
      block(
        error?.code ?? 'BLOCKED_NPM_CACHE_RECEIPT_INVALID',
        2,
        error?.detail ?? (error instanceof Error ? error.message : String(error)),
        error?.context ?? {},
      );
    }
  }

  const npm = await findExecutable('npm');
  const npmConfigFiles = getIsolatedNpmConfigFiles();
  const effectiveRegistry = await recorded({
    gate: 2,
    name: 'npm-effective-registry-offline',
    command: npm,
    args: ['config', 'get', 'registry'],
    evidenceDir,
    allowFailure: true,
  });
  if ((effectiveRegistry.status ?? 1) !== 0 || effectiveRegistry.stdout.trim() !== NPM_REGISTRY) {
    block('BLOCKED_NPM_CANDIDATE_REGISTRY_MISMATCH', 2, effectiveRegistry.stdout.trim(), {
      expected: NPM_REGISTRY,
      automaticRetry: false,
    });
  }
  const installArgs = ['ci'];
  const installEnv = {};
  if (hydratedCache) {
    installArgs.push('--cache', hydratedCache.cacheIdentity.path);
    installEnv.npm_config_cache = hydratedCache.cacheIdentity.path;
  }
  const install = await recorded({
    gate: 2,
    name: hydratedCache ? 'npm-ci-approved-cache-offline' : 'npm-ci-offline',
    command: npm,
    args: installArgs,
    evidenceDir,
    env: installEnv,
    allowFailure: true,
  });
  const installFailure = classifyInstall(install.status ?? 1, install.stdout, install.stderr);
  if (installFailure) {
    if (
      hydratedCache
      && installFailure.code === 'BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED'
    ) {
      block(
        'BLOCKED_NPM_APPROVED_CACHE_INCOMPLETE',
        2,
        'receipt-bound npm cache did not satisfy npm ci --offline',
        {
          automaticRetry: false,
          cacheDir: hydratedCache.cacheIdentity.path,
          hydrationReceiptSha256: hydratedCache.receiptSha256,
          cacheAggregateSha256: hydratedCache.cacheIdentity.aggregateSha256,
        },
      );
    }
    block(installFailure.code, 2, 'npm ci --offline failed', installFailure);
  }
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await privateJson(path.join(evidenceDir, 'gates/gate-02-network.json'), {
    schemaVersion: 2,
    gate: 2,
    authority: 'offline-only',
    automaticRegistryFallback: false,
    sandbox: '/usr/bin/sandbox-exec',
    npmExecutable: npm,
    effectiveRegistry: NPM_REGISTRY,
    npmConfigIsolation: {
      userConfigPath: npmConfigFiles.userConfigPath,
      globalConfigPath: npmConfigFiles.globalConfigPath,
      inheritedConfigUsed: false,
    },
    profileSha256: createHash('sha256').update(NETWORK_PROFILE).digest('hex'),
    approvedCacheHydration: hydratedCache
      ? {
        ownerAuthority: hydratedCache.receipt.ownerAuthority,
        receiptPath: npmCacheReceipt,
        receiptSha256: hydratedCache.receiptSha256,
        cacheDir: hydratedCache.cacheIdentity.path,
        cacheScope: hydratedCache.cacheIdentity.scope,
        cacheFileCount: hydratedCache.cacheIdentity.fileCount,
        cacheTotalBytes: hydratedCache.cacheIdentity.totalBytes,
        cacheAggregateSha256: hydratedCache.cacheIdentity.aggregateSha256,
        lockfileSha256: hydratedCache.lockfile.sha256,
        candidateNetworkUsed: false,
      }
      : null,
    result: 'PASS',
  });

  const trackedFiles = trackedFilesFromGit(git(['ls-files', '-z']));
  const ledger = await buildLedger(repoRoot, sourceCommit, trackedFiles);
  const ledgerPath = path.join(evidenceDir, 'gates/gate-03-sha256-ledger.json');
  await privateJson(ledgerPath, ledger);

  const nodeTests = trackedFilesFromGit(git(['ls-files', '-z', 'scripts/candidate-r30/*.test.mjs']));
  await recorded({
    gate: 4,
    name: 'candidate-source-contracts',
    command: process.execPath,
    args: ['--test', ...nodeTests],
    evidenceDir,
  });
  await npmRun({
    gate: 4,
    name: 'workspace-deps-build',
    script: 'build:workspace-deps',
    workspace: '@copilot/desktop',
    npm,
    evidenceDir,
  });

  for (const workspace of CHECK_WORKSPACES) {
    await npmRun({ gate: 5, name: `check-${workspace}`, script: 'check', workspace, npm, evidenceDir });
  }
  for (const workspace of CORE_WORKSPACES) {
    await npmRun({ gate: 5, name: `unit-${workspace}`, script: 'test', workspace, npm, evidenceDir });
    await npmRun({ gate: 5, name: `integration-${workspace}`, script: 'test:integration', workspace, npm, evidenceDir });
    await npmRun({ gate: 5, name: `coverage-global-${workspace}`, script: 'test:coverage:global', workspace, npm, evidenceDir });
    await npmRun({ gate: 5, name: `coverage-critical-${workspace}`, script: 'test:coverage:critical', workspace, npm, evidenceDir });
  }
  await npmRun({ gate: 5, name: 'desktop-build', script: 'build', workspace: '@copilot/desktop', npm, evidenceDir });
  await npmRun({ gate: 5, name: 'desktop-phase1-release', script: 'test:phase1-release', workspace: '@copilot/desktop', npm, evidenceDir });
  await npmRun({ gate: 5, name: 'coverage-global-desktop', script: 'test:coverage:global', workspace: '@copilot/desktop', npm, evidenceDir });
  await npmRun({ gate: 5, name: 'coverage-critical-desktop', script: 'test:coverage:critical', workspace: '@copilot/desktop', npm, evidenceDir });

  const sbomResult = await recorded({
    gate: 5,
    name: 'production-cyclonedx-sbom',
    command: npm,
    args: ['sbom', '--sbom-format=cyclonedx', '--sbom-type=application', '--omit=dev'],
    evidenceDir,
  });
  const { parsed: sbomDocument, identity: sbomPublicIdentity } = parseAndValidateCycloneDxSbom(
    sbomResult.stdout ?? '',
  );
  const sbomPath = path.join(evidenceDir, 'software-bill-of-materials.cdx.json');
  await privateJson(sbomPath, sbomDocument);
  const sbom = {
    schemaVersion: 1,
    gate: 5,
    path: sbomPath,
    sha256: await sha256File(sbomPath, {
      gate: 5,
      code: 'BLOCKED_GATE_05_SBOM_FILE_NOT_REGULAR',
    }),
    ...sbomPublicIdentity,
  };
  await privateJson(path.join(evidenceDir, 'gates/gate-05-sbom.json'), sbom);
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  await privateJson(path.join(evidenceDir, 'gates/gate-05-source-quality.json'), {
    schemaVersion: 2,
    gate: 5,
    checkedWorkspaces: CHECK_WORKSPACES,
    fullyTestedWorkspaces: CORE_WORKSPACES,
    desktopReleaseSuite: 'test:phase1-release',
    checks: 'PASS',
    unit: 'PASS',
    integration: 'PASS',
    coverageGlobal: 'PASS',
    coverageCritical: 'PASS',
    desktopBuild: 'PASS',
    cyclonedxSbom: 'PASS',
    networkAuthority: 'offline-only',
  });

  const canonicalResult = await runCanonicalReleaseR31({ sourceCommit, candidateId, evidenceDir });
  cleanStatus(git(['status', '--porcelain=v1', '--untracked-files=all']));
  return {
    npm,
    ...canonicalResult,
    sbom,
    sourceLedger: {
      path: ledgerPath,
      sha256: await sha256File(ledgerPath, { gate: 7 }),
      aggregateSha256: ledger.aggregateSha256,
      fileCount: ledger.fileCount,
      scope: ledger.scope,
    },
  };
}
