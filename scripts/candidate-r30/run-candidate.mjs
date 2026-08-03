#!/usr/bin/env node
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_FILES,
  EXACT_FILES,
  EXACT_TESTS,
  LEDGER_SCOPE,
  NETWORK_PROFILE,
  NPM_CACHE_KEY_ALIGNMENT_FLAG,
  block,
  configureCandidateNpmIsolation,
  fullCommit,
  resolveEvidenceTarget,
} from './contract.mjs';
import { CANONICAL_CANDIDATE_ALIAS } from './canonical-release-r31.mjs';
import { ensureIsolatedNpmConfigFiles } from './npm-cache-hydrate.mjs';
import {
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
} from './npm-native-cache-hydrate.mjs';
import { asBlocked, privateJson, repoRoot } from './io.mjs';
import { runBuildGates } from './gates-build.mjs';
import { FOCUSED_SPECS, runElectronGates } from './gates-electron.mjs';
import {
  PERFORMANCE_AGGREGATE_BASENAME,
  PERFORMANCE_CONTRACT_VERSION,
  PERFORMANCE_RAW_BASENAMES,
} from './performance.mjs';

const currentScript = fileURLToPath(import.meta.url);
const ownedEvidenceDirectories = new Set();
export const GATE_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

export function candidateId(sourceCommit) {
  return `copilot-r30-${fullCommit(sourceCommit)}`;
}

export function candidateNpmConfigPaths(evidenceDir) {
  return {
    userConfigPath: path.join(path.resolve(evidenceDir), 'npm-config/user.npmrc'),
    globalConfigPath: path.join(path.resolve(evidenceDir), 'npm-config/global.npmrc'),
  };
}

export function parseArgs(argv) {
  const result = {
    sourceCommit: null,
    evidenceDir: null,
    npmCacheDir: null,
    npmCacheReceipt: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--source-commit') result.sourceCommit = argv[++index] ?? null;
    else if (token === '--evidence-dir') result.evidenceDir = argv[++index] ?? null;
    else if (token === '--npm-cache-dir') result.npmCacheDir = argv[++index] ?? null;
    else if (token === '--npm-cache-receipt') result.npmCacheReceipt = argv[++index] ?? null;
    else if (token === '--dry-run') result.dryRun = true;
    else block('BLOCKED_RUNNER_ARGUMENT_UNKNOWN', 0, String(token));
  }
  if (!result.sourceCommit || !result.evidenceDir) {
    block('BLOCKED_RUNNER_ARGUMENT', 0, '--source-commit and --evidence-dir are required');
  }
  if (Boolean(result.npmCacheDir) !== Boolean(result.npmCacheReceipt)) {
    block(
      'BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT',
      0,
      '--npm-cache-dir and --npm-cache-receipt must be supplied together',
    );
  }
  fullCommit(result.sourceCommit);
  for (const [label, value, code] of [
    ['evidence dir', result.evidenceDir, 'BLOCKED_EVIDENCE_DIR_NOT_ABSOLUTE'],
    ['npm cache dir', result.npmCacheDir, 'BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT'],
    ['npm cache receipt', result.npmCacheReceipt, 'BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT'],
  ]) {
    if (value !== null && !path.isAbsolute(value)) block(code, 0, `${label}: ${value}`);
  }
  result.evidenceDir = path.resolve(result.evidenceDir);
  if (result.npmCacheDir) result.npmCacheDir = path.resolve(result.npmCacheDir);
  if (result.npmCacheReceipt) result.npmCacheReceipt = path.resolve(result.npmCacheReceipt);
  return result;
}

export function staticPlan({
  sourceCommit,
  evidenceDir,
  npmCacheDir = null,
  npmCacheReceipt = null,
  dryRun = false,
}) {
  const hydratedCache = npmCacheDir && npmCacheReceipt
    ? {
      ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
      profile: NATIVE_TOOLCHAIN_PROFILE,
      cacheDir: path.resolve(npmCacheDir),
      receipt: path.resolve(npmCacheReceipt),
      hydrationAuthority:
        'bounded official-host lifecycle and native-toolchain hydration outside candidate',
      candidateInstallAuthority:
        'full lifecycle install and native rebuild proved offline before candidate',
    }
    : null;
  return {
    schemaVersion: 4,
    runner: 'copilot-r30-github-bound-candidate-runner',
    sourceCommit,
    candidateId: candidateId(sourceCommit),
    canonicalCandidateAlias: CANONICAL_CANDIDATE_ALIAS,
    evidenceDir: path.resolve(evidenceDir),
    executionStatus: dryRun ? 'PLAN_ONLY_NOT_A_CANDIDATE' : 'NOT_RUN',
    mvpStatus: 'MVP_NOT_COMPLETE',
    networkAuthority: 'candidate-deny-network-only',
    automaticRegistryFallback: false,
    approvedNpmCacheHydration: hydratedCache,
    distributionTruth: 'UNSIGNED_DIAGNOSTIC_ONLY',
    gates: [
      {
        id: 1,
        name: 'source-and-clean-preimage',
        assertion: 'exact full commit; no tracked/untracked drift or stale ignored generated inputs',
      },
      {
        id: 2,
        name: 'receipt-bound-offline-lifecycle-install',
        command:
          `/usr/bin/sandbox-exec -p '${NETWORK_PROFILE.trim()}' `
          + `npm ci --offline --cache <receipt-bound-native-cache/npm> `
          + `${NPM_CACHE_KEY_ALIGNMENT_FLAG} --no-audit --no-fund`,
        lifecycleScripts: 'enabled-and-required',
        npmConfigIsolation: 'candidate-owned-distinct-regular-files',
        nativeCacheProfile: NATIVE_TOOLCHAIN_PROFILE,
        cacheAuthority: hydratedCache
          ? 'exact owner-approved native-toolchain receipt; candidate remains deny-network'
          : 'required before execution; no unbound local cache is accepted',
      },
      {
        id: 3,
        name: 'sha256-ledger',
        scope: LEDGER_SCOPE,
        source: 'git ls-files -z',
        criticalControlFiles: [
          ...CONTROL_FILES,
          'scripts/candidate-r30/native-cache-policy.mjs',
          'scripts/candidate-r30/native-cache-runtime.mjs',
          'scripts/candidate-r30/npm-native-cache-hydrate.mjs',
        ],
        digest: '64 lower-case hex per file plus aggregate SHA256',
      },
      { id: 4, name: 'candidate-source-contracts-and-ordered-workspace-builds' },
      {
        id: 5,
        name: 'phase1-source-quality-and-sbom',
        assertion: 'all local-first checks; core unit/integration/coverage; desktop Phase 1 suite and strict coverage',
      },
      {
        id: 6,
        name: 'r31-macos-arm64-authority-over-legacy-canonical-builder',
        authorityWrapper: 'scripts/candidate-r30/canonical-release-r31.mjs',
        legacyBuilder: 'apps/copilot-desktop/scripts/build-canonical-release.mjs',
        authority: 'macos-arm64-only',
        canonicalCandidateAlias: CANONICAL_CANDIDATE_ALIAS,
        assertion: 'selected arm64 ZIP/DMG, release identity, artifact reports, source snapshot, bytes and SHA256 must pass independently; arm64 blockers are fatal',
      },
      { id: 7, name: 'canonical-source-artifact-and-runtime-identity' },
      { id: 8, name: 'focused-packaged-electron', expectedTests: 2, specs: [...FOCUSED_SPECS] },
      {
        id: 9,
        name: 'exact-discovery-and-complete-test-data-manifest',
        exactDiscovery: { tests: EXACT_TESTS, files: EXACT_FILES },
      },
      {
        id: 10,
        name: 'full-packaged-electron',
        exactResult: {
          expected: EXACT_TESTS,
          passed: EXACT_TESTS,
          skipped: 0,
          unexpected: 0,
          flaky: 0,
          cleanProcessExit: true,
        },
      },
      {
        id: 11,
        name: 'candidate-bound-three-run-performance',
        contractVersion: PERFORMANCE_CONTRACT_VERSION,
        raws: [...PERFORMANCE_RAW_BASENAMES],
        aggregate: PERFORMANCE_AGGREGATE_BASENAME,
        thresholds: { launchMsExclusive: 2_000, residentSetMbExclusive: 500, kg100FpsAtLeast: 30 },
      },
      {
        id: 12,
        name: 'candidate-receipt',
        assertion: 'canonical manifest; all-tracked ledger; artifact/app.asar identities; E2E; three-run performance; SBOM; screenshots; terminal state',
      },
    ],
  };
}

export async function execute(options) {
  process.umask(0o077);
  const evidenceDir = await resolveEvidenceTarget(repoRoot, options.evidenceDir);
  options.evidenceDir = evidenceDir;
  await mkdir(path.dirname(evidenceDir), { recursive: true, mode: 0o700 });
  try {
    await mkdir(evidenceDir, { mode: 0o700 });
    ownedEvidenceDirectories.add(evidenceDir);
  } catch (error) {
    if (error?.code === 'EEXIST') block('BLOCKED_EVIDENCE_DIR_ALREADY_EXISTS', 0, evidenceDir);
    throw error;
  }
  const id = candidateId(options.sourceCommit);
  const npmConfigFiles = await ensureIsolatedNpmConfigFiles(candidateNpmConfigPaths(evidenceDir));
  configureCandidateNpmIsolation(npmConfigFiles);
  const plan = staticPlan(options);
  await privateJson(path.join(evidenceDir, 'R30-PLAN.json'), plan);
  await privateJson(path.join(evidenceDir, 'R30-START.json'), {
    schemaVersion: 4,
    candidateId: id,
    canonicalCandidateAlias: CANONICAL_CANDIDATE_ALIAS,
    sourceCommit: options.sourceCommit,
    status: 'IN_PROGRESS',
    mvpStatus: 'MVP_NOT_COMPLETE',
    approvedNpmCacheHydration: options.npmCacheDir
      ? {
        cacheDir: options.npmCacheDir,
        receipt: options.npmCacheReceipt,
        ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
        profile: NATIVE_TOOLCHAIN_PROFILE,
      }
      : null,
    npmConfigIsolation: {
      userConfigPath: npmConfigFiles.userConfigPath,
      globalConfigPath: npmConfigFiles.globalConfigPath,
      inheritedConfigUsed: false,
    },
    startedAt: new Date().toISOString(),
  });
  if (process.platform !== 'darwin') {
    block('BLOCKED_NETWORK_SANDBOX_UNAVAILABLE', 2, process.platform);
  }
  try {
    await access('/usr/bin/sandbox-exec', fsConstants.X_OK);
  } catch {
    block('BLOCKED_NETWORK_SANDBOX_UNAVAILABLE', 2, '/usr/bin/sandbox-exec');
  }
  const build = await runBuildGates({
    sourceCommit: options.sourceCommit,
    candidateId: id,
    evidenceDir,
    npmCacheDir: options.npmCacheDir,
    npmCacheReceipt: options.npmCacheReceipt,
  });
  return runElectronGates({
    sourceCommit: options.sourceCommit,
    candidateId: id,
    evidenceDir,
    ...build,
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.dryRun) {
      process.stdout.write(`${JSON.stringify(staticPlan(options), null, 2)}\n`);
      return;
    }
    const result = await execute(options);
    process.stdout.write(`R30 candidate receipt: ${result.manifestPath}\n`);
  } catch (error) {
    const blocked = asBlocked(error);
    const evidenceDir = options?.evidenceDir;
    if (evidenceDir && ownedEvidenceDirectories.has(evidenceDir)) {
      try {
        await privateJson(path.join(evidenceDir, 'R30-BLOCKED.json'), {
          schemaVersion: 4,
          status: 'BLOCKED',
          mvpStatus: 'MVP_NOT_COMPLETE',
          code: blocked.code,
          gate: blocked.gate,
          detail: blocked.detail,
          context: blocked.context,
          automaticRetry: false,
          endedAt: new Date().toISOString(),
        });
      } catch {
        // Preserve the original blocker.
      }
    }
    process.stderr.write(`${blocked.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentScript) await main();
