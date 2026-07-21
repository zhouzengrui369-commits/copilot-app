#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { evaluatePostPackageEvidence } from './post-package-evidence.mjs';
import { bindAuthoritativeSnapshotFileSet } from './performance-config.mjs';
import { validatePmRunnerAnchor } from './private-replay-evidence.mjs';
import {
  assertCanonicalMacWorkDirectoriesAbsent,
  assertPrivateEvidenceAbsent,
  buildArtifactIdentityRecord,
  canonicalReleaseIdentity,
  cleanupCanonicalMacWorkDirectories,
  evaluateArtifactIdentityEvidence,
  inspectExtractedReleaseIdentity,
  inspectStableFinalArtifact,
  inspectWindowsArtifactReleaseIdentity,
  publishArtifactIdentityRecordCrashSafe,
  verifyFinalArtifactForIdentity,
} from './release-identity-evidence.mjs';
import {
  createSigningEnvironment,
  createWindowsSigningEnvironment,
  parseSigningModeArgs,
  publicSigningProfile,
  resolveReleaseChildEnvironment,
  resolveSigningProfile,
} from './release-signing-profile.mjs';
import {
  buildWindowsCryptographicSigningReport,
  assertWindowsMainExecutableIdentity,
  createOsslVerificationPlan,
  createWindowsBuilderConfig,
  parseOsslSigncodeVerification,
  publishWindowsSigningReportCrashSafe,
  resolveOsslSigncode,
} from './release-windows-signing.mjs';
import {
  assertMacSigningReportBinding,
  buildMacSigningReport,
  createMacDmgDistributionPlan,
  createMacDistributionPlan,
  executeMacAppDistributionSigning,
  executeMacDmgDistribution,
  formatRedactedCommandLog,
  parseCodesignDetails,
  publishSigningReportCrashSafe,
  verifyCanonicalCompletionIntegrity,
} from './release-macos-signing.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const releaseRoot = path.join(desktopRoot, 'release');
const defaultOutput = path.join(releaseRoot, 'v6.2-phase1-candidate');
const nativeRelative = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
const sevenZip = require('7zip-bin').path7za;
const prebuildInstall = path.join(repoRoot, 'node_modules/.bin/prebuild-install');
const electronBuilder = path.join(repoRoot, 'node_modules/.bin/electron-builder');
const electronOsxSign = require.resolve('@electron/osx-sign/bin/electron-osx-sign.js');
const nativePrebuildCache = path.join(os.tmpdir(), 'copilot-canonical-prebuild-cache');
const sourceScopes = [
  'apps/copilot-cloud',
  'apps/copilot-desktop',
  'packages',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
];
const snapshotAggregateAlgorithm = 'sha256-null-delimited-relative-path-and-bytes-v1';
const protectedNonReleasePaths = new Set([
  'packages/kb/src/api/todo.ts',
  'packages/kb/src/store/migration-v1-todo.sql',
  'packages/kb/tests/todo.test.ts',
]);

class ReleaseFailure extends Error {
  constructor(failureCode, message, result, overrides = {}) {
    super(`${failureCode}: ${message}`);
    this.name = 'ReleaseFailure';
    this.failureCode = failureCode;
    this.execution = executionEvidence(result, overrides);
    this.causeExecution = overrides.causeExecution ?? null;
  }
}

const options = parseArgs(process.argv.slice(2));
const signingProfile = resolveSigningProfile({ mode: options.signingMode, env: process.env });
const distributionGrade = signingProfile.mode === 'distribution'
  || signingProfile.mode === 'macos-distribution';
const pmRunnerConfiguration = resolvePmRunnerConfiguration(process.env);
const unsignedBuilderEnvironment = createSigningEnvironment(signingProfile, process.env);
const osslSigncode = signingProfile.mode === 'distribution'
  ? resolveOsslSigncode()
  : null;
const windowsBuilderEnvironment = signingProfile.mode === 'distribution'
  ? createWindowsSigningEnvironment(
    signingProfile,
    unsignedBuilderEnvironment,
    { osslSigncode },
  )
  : { ...unsignedBuilderEnvironment };
const automaticOutput = existsSync(defaultOutput)
  ? `${defaultOutput}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`
  : defaultOutput;
const outputRoot = path.resolve(options.output ?? automaticOutput);
if (!isInside(releaseRoot, outputRoot)) {
  throw new Error(`OUTPUT_OUTSIDE_RELEASE_ROOT: ${outputRoot}`);
}
await mkdir(releaseRoot, { recursive: true });
try {
  await mkdir(outputRoot);
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    throw new Error(`CANDIDATE_DIR_EXISTS: ${outputRoot}; choose --output <new-directory>`);
  }
  throw error;
}
const candidateLock = path.join(outputRoot, '.canonical-release.lock');
await writeFile(
  candidateLock,
  `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
  { encoding: 'utf8', flag: 'wx' },
);

const logsDir = path.join(outputRoot, 'logs');
const workDir = path.join(outputRoot, 'work');
const artifactsDir = path.join(outputRoot, 'artifacts');
await mkdir(logsDir);
await mkdir(workDir);
await mkdir(artifactsDir);

const source = await sourceIdentity();
const snapshot = await createImmutableSnapshot();
source.snapshot = snapshot.identity;
const buildRepoRoot = snapshot.root;
const buildDesktopRoot = path.join(buildRepoRoot, 'apps/copilot-desktop');
const northStarRunnerSha256 = await sha256(path.join(buildDesktopRoot, 'scripts/north-star-gates.mjs'));
const nativeStageScript = path.join(buildDesktopRoot, 'scripts/stage-electron-native.mjs');
const electronTarget = await resolveElectronTarget(buildDesktopRoot);
const electronVersion = electronTarget.version;
const electronAbi = electronTarget.abi;
let canonicalIdentity = null;
const manifest = {
  schemaVersion: 2,
  releaseMode: signingProfile.mode,
  candidate: path.basename(outputRoot),
  createdAt: new Date().toISOString(),
  status: 'building',
  signingProfile: publicSigningProfile(signingProfile),
  releaseIdentity: null,
  northStar: {
    required: true,
    runnerSha256: northStarRunnerSha256,
    pmRunner: pmRunnerConfiguration.anchor,
  },
  source,
  electronTarget,
  gates: [],
  artifacts: [],
  blockers: [],
  nonGatingRisks: [],
  postPackageGates: {
    status: 'NOT_EVALUATED',
    evidenceFile: null,
    binding: { passed: false, errors: ['packaging has not completed'] },
    gates: [],
  },
  artifactIdentityGate: {
    status: 'NOT_EVALUATED',
    requiredArtifacts: signingProfile.mode === 'macos-distribution' ? 4 : 8,
    verifiedArtifacts: 0,
    blockers: [],
  },
  notes: [
    'No GUI launch was used. Electron native smoke runs only with ELECTRON_RUN_AS_NODE=1.',
    'Old release artifacts are never overwritten; output directory must not exist.',
    'Protected untracked KB Todo experiments are excluded: the shipped app uses its tested note-backed Todo adapter and these files are not exported.',
    'Unsigned Windows cross-builds disable Wine-only executable metadata editing; PE architecture, exact Electron native target, artifact extraction and SHA checks remain mandatory.',
    ...(signingProfile.mode === 'macos-distribution'
      ? ['Windows is OWNER_DEFERRED to Phase 1.1 and is not built or claimed by this candidate.']
      : []),
  ],
};

try {
  if (distributionGrade && !pmRunnerConfiguration.anchor) {
    manifest.blockers.push({
      code: 'BLOCKED_PM_REPLAY_TRUST_ANCHOR',
      message: pmRunnerConfiguration.error
        ?? 'Distribution release requires a canonical Ed25519 PM runner trust anchor.',
    });
  } else {
    await runGates();
    await writePackagedReleaseIdentity();
    for (const arch of ['arm64', 'x64']) {
    try {
      await buildMac(arch);
    } catch (error) {
      const explicitCode = error && typeof error === 'object' && 'code' in error
        && [
          'BLOCKED_MAC_UNTRUSTED_IDENTITY',
          'BLOCKED_MAC_SIGNING_FAILED',
          'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING',
          'BLOCKED_MAC_NOTARIZATION_REJECTED',
          'BLOCKED_MAC_STAPLE_FAILED',
          'BLOCKED_SIGNING_EVIDENCE_BINDING',
          'BLOCKED_SIGNED_ARTIFACT_MUTATED',
          'BLOCKED_ARTIFACT_IDENTITY',
          'BLOCKED_PRIVATE_REPLAY_LEAK',
        ].includes(error.code) ? error.code : null;
      const message = error instanceof Error ? error.message : String(error);
      const signingCode = explicitCode
        ?? (error instanceof ReleaseFailure || /^(?:MAC_|NATIVE_|ELECTRON_)/.test(message)
          ? 'BLOCKED_MAC_BUILD' : null);
      if (!signingCode) throw error;
      const blocker = blockerFromError(signingCode, arch, error);
      manifest.blockers.push(blocker);
      await logText(`mac-${arch}-blocked`, JSON.stringify(blocker, null, 2));
    }
    }
    if (signingProfile.mode !== 'macos-distribution') {
      for (const arch of ['x64', 'arm64']) {
    try {
      await buildWindows(arch);
    } catch (error) {
      const failureCode = error instanceof ReleaseFailure ? error.failureCode : '';
      const message = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === 'object' && 'code' in error
        && (String(error.code).startsWith('BLOCKED_WINDOWS_')
          || error.code === 'BLOCKED_ARTIFACT_IDENTITY'
          || error.code === 'BLOCKED_PRIVATE_REPLAY_LEAK')
        ? error.code
        : failureCode.startsWith('WINDOWS_PREBUILD_')
        || message.startsWith('NATIVE_PLATFORM_MISMATCH')
        ? 'BLOCKED_WINDOWS_NATIVE_MODULE'
        : error instanceof ReleaseFailure || /^(?:WINDOWS_|NATIVE_)/.test(message)
          ? 'BLOCKED_WINDOWS_PACKAGING_TOOLCHAIN'
          : null;
      if (!code) throw error;
      const blocker = blockerFromError(code, arch, error);
      manifest.blockers.push(blocker);
      await logText(`windows-${arch}-blocked`, JSON.stringify(blocker, null, 2));
    }
    }
    }
    await verifySnapshotInputsUnchanged();
    await verifyArtifactInventory();
    await verifySourceUnchanged();
    await runPostPackageGates();
  }
  manifest.status = manifest.blockers.length === 0 ? 'PASS' : 'PARTIAL_BLOCKED';
} catch (error) {
  manifest.status = 'FAIL';
  manifest.blockers.push(blockerFromError('RELEASE_PIPELINE_FAILED', undefined, error));
} finally {
  if (manifest.postPackageGates.status === 'NOT_EVALUATED') {
    await runPostPackageGates();
  }
  try {
    await cleanupCanonicalMacWorkDirectories(workDir);
  } catch (error) {
    recordMacWorkCleanupFailure(error);
  }
  try {
    await runArtifactIdentityGate();
  } catch (error) {
    manifest.status = 'FAIL';
    manifest.blockers.push(blockerFromError('RELEASE_PIPELINE_FAILED', undefined, error));
  }
  if (manifest.status !== 'FAIL') {
    manifest.status = manifest.blockers.length === 0 ? 'PASS' : 'PARTIAL_BLOCKED';
  }
  let completionIntegrityPassed = false;
  if (manifest.blockers.some((blocker) => blocker.code === 'BLOCKED_PM_REPLAY_TRUST_ANCHOR')) {
    manifest.completionIntegrity = {
      status: 'BLOCKED',
      code: 'BLOCKED_PM_REPLAY_TRUST_ANCHOR',
    };
  } else try {
    manifest.completionIntegrity = await verifyCanonicalCompletionIntegrity({
      artifacts: manifest.artifacts,
      inspectPath: async (relativePath) => {
        const absolutePath = path.resolve(outputRoot, relativePath);
        if (!isInside(outputRoot, absolutePath)) {
          throw new Error(`COMPLETION_PATH_OUTSIDE_CANDIDATE: ${relativePath}`);
        }
        return inspectStableFinalArtifact(absolutePath);
      },
    });
    completionIntegrityPassed = true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      && [
        'BLOCKED_SIGNED_ARTIFACT_MUTATED',
        'BLOCKED_ARTIFACT_MUTATED',
        'BLOCKED_SIGNING_EVIDENCE_BINDING',
      ].includes(error.code)
      ? error.code
      : 'BLOCKED_ARTIFACT_MUTATED';
    manifest.status = 'FAIL';
    manifest.completionIntegrity = { status: 'FAIL', code };
    manifest.blockers.push(blockerFromError(code, undefined, error));
  }
  try {
    await assertCanonicalMacWorkDirectoriesAbsent(workDir);
  } catch (error) {
    recordMacWorkCleanupFailure(error);
  }
  await writeInstallGuide();
  await atomicJson(path.join(outputRoot, 'CANONICAL-MANIFEST.json'), manifest);
  const releaseCompleted = completionIntegrityPassed && manifest.status !== 'FAIL';
  await rename(candidateLock, path.join(
    outputRoot,
    releaseCompleted ? '.canonical-release.complete' : '.canonical-release.failed',
  ));
}

function resolvePmRunnerConfiguration(env) {
  const values = {
    runnerId: env.COPILOT_PM_RUNNER_ID,
    publicKeySpki: env.COPILOT_PM_PUBLIC_KEY_SPKI_BASE64,
    publicKeyFingerprintSha256: env.COPILOT_PM_PUBLIC_KEY_FINGERPRINT_SHA256,
  };
  if (Object.values(values).every((value) => value === undefined || value === '')) {
    return { anchor: null, error: null };
  }
  try {
    return { anchor: validatePmRunnerAnchor(values), error: null };
  } catch (error) {
    return {
      anchor: null,
      error: `Invalid PM runner trust anchor: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function writePackagedReleaseIdentity() {
  const identity = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    sourceHead: manifest.source.head,
    sourceSnapshotSha256: manifest.source.snapshot.sha256,
  };
  canonicalIdentity = canonicalReleaseIdentity(identity);
  const contents = canonicalIdentity.bytes;
  const packagedPath = path.join(buildDesktopRoot, 'dist/main/release-identity.json');
  const evidencePath = path.join(outputRoot, 'RELEASE-IDENTITY.json');
  await mkdir(path.dirname(packagedPath), { recursive: true });
  await writeFile(packagedPath, contents, { mode: 0o600, flag: 'wx' });
  await writeFile(evidencePath, contents, { mode: 0o600, flag: 'wx' });
  manifest.releaseIdentity = {
    schemaVersion: 1,
    packagedRelativePath: 'dist/main/release-identity.json',
    evidenceRelativePath: 'RELEASE-IDENTITY.json',
    sha256: canonicalIdentity.sha256,
    bytes: canonicalIdentity.bytes.length,
  };
}

process.stdout.write(`${JSON.stringify({
  status: manifest.status,
  outputRoot,
  artifacts: manifest.artifacts.map((artifact) => artifact.relativePath),
  blockers: manifest.blockers,
}, null, 2)}\n`);
if (manifest.status !== 'PASS') process.exitCode = 2;

async function createImmutableSnapshot() {
  const root = path.join(workDir, 'source-snapshot');
  const filesBefore = releaseSourceFiles();
  const sourceShaBefore = await hashFileSet(repoRoot, filesBefore);
  await mkdir(root);
  for (const relative of filesBefore) {
    const sourcePath = path.join(repoRoot, relative);
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }
  const snapshotSha = await hashFileSet(root, filesBefore);
  const filesAfter = releaseSourceFiles();
  const sourceShaAfter = await hashFileSet(repoRoot, filesAfter);
  if (
    JSON.stringify(filesBefore) !== JSON.stringify(filesAfter)
    || sourceShaBefore !== sourceShaAfter
    || sourceShaBefore !== snapshotSha
  ) {
    throw new Error(
      `SOURCE_CHANGED_DURING_SNAPSHOT: before=${sourceShaBefore} snapshot=${snapshotSha} after=${sourceShaAfter}`,
    );
  }
  const authoritativeInputs = await writeAuthoritativeSnapshotInputs(
    root,
    filesBefore,
    snapshotSha,
  );
  await createSnapshotNodeModules(root, filesBefore);
  return {
    root,
    files: filesBefore,
    authoritativeInputs,
    identity: {
      fileCount: filesBefore.length,
      sha256: snapshotSha,
      relativeRoot: path.relative(outputRoot, root),
      immutableInputs: true,
      authoritativeInputs: authoritativeInputs.binding,
    },
  };
}

async function writeAuthoritativeSnapshotInputs(snapshotRoot, relativeFiles, aggregateSha256) {
  const entries = [];
  for (const relativePath of [...relativeFiles].sort(compareCanonicalPaths)) {
    const contents = await readFile(path.join(snapshotRoot, relativePath));
    entries.push({
      relativePath: relativePath.split(path.sep).join('/'),
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }
  const document = {
    schemaVersion: 1,
    algorithm: snapshotAggregateAlgorithm,
    fileCount: entries.length,
    aggregateSha256,
    entries,
  };
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  const manifestPath = path.join(workDir, 'source-snapshot-inputs.json');
  await writeFile(manifestPath, bytes, { flag: 'wx', mode: 0o600 });
  return {
    path: manifestPath,
    document,
    binding: {
      relativePath: path.relative(outputRoot, manifestPath).split(path.sep).join('/'),
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      fileCount: entries.length,
      aggregateSha256,
    },
  };
}

function releaseSourceFiles() {
  const result = inspect(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sourceScopes],
    { cwd: repoRoot, maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error('GIT_SOURCE_FILE_LIST_UNAVAILABLE');
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relative) => !protectedNonReleasePaths.has(relative))
    .sort(compareCanonicalPaths);
}

async function hashFileSet(root, relativeFiles) {
  const hash = createHash('sha256');
  for (const relative of [...relativeFiles].sort(compareCanonicalPaths)) {
    hash.update(`\0${relative}\0`);
    hash.update(await readFile(path.join(root, relative)));
  }
  return hash.digest('hex');
}

function compareCanonicalPaths(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

async function createSnapshotNodeModules(snapshotRoot, snapshotFiles) {
  const sourceModules = path.join(repoRoot, 'node_modules');
  const targetModules = path.join(snapshotRoot, 'node_modules');
  await mkdir(targetModules);
  for (const entry of await readdir(sourceModules, { withFileTypes: true })) {
    if (entry.name === '@copilot') continue;
    await symlink(path.join(sourceModules, entry.name), path.join(targetModules, entry.name));
  }
  const sourceCopilot = path.join(sourceModules, '@copilot');
  const targetCopilot = path.join(targetModules, '@copilot');
  await mkdir(targetCopilot);
  const snapshotWorkspaces = new Map();
  const workspacePackageFiles = snapshotFiles
    .filter((relative) => /^(?:apps\/(?:copilot-desktop|copilot-cloud)|packages\/[^/]+)\/package\.json$/.test(relative));
  for (const relative of workspacePackageFiles) {
    const packageJson = JSON.parse(await readFile(path.join(snapshotRoot, relative), 'utf8'));
    if (typeof packageJson.name === 'string') {
      snapshotWorkspaces.set(packageJson.name, path.dirname(path.join(snapshotRoot, relative)));
    }
    // npm hoists most dependencies but keeps version-conflicting packages
    // (notably desktop Vite) in each workspace. Preserve that exact lookup
    // boundary so TypeScript sees the same plugin type identity as the frozen
    // live tree, while all workspace source still resolves to the snapshot.
    const liveWorkspaceModules = path.join(repoRoot, path.dirname(relative), 'node_modules');
    const snapshotWorkspaceModules = path.join(snapshotRoot, path.dirname(relative), 'node_modules');
    if (existsSync(liveWorkspaceModules)) {
      await symlink(liveWorkspaceModules, snapshotWorkspaceModules);
    }
  }
  for (const entry of await readdir(sourceCopilot, { withFileTypes: true })) {
    const packageName = `@copilot/${entry.name}`;
    const target = snapshotWorkspaces.get(packageName) ?? path.join(sourceCopilot, entry.name);
    await symlink(target, path.join(targetCopilot, entry.name));
  }
}

async function resolveElectronTarget(snapshotDesktopRoot) {
  const config = parseYaml(await readFile(path.join(snapshotDesktopRoot, 'electron-builder.yml'), 'utf8'));
  const version = String(config.electronVersion ?? '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`ELECTRON_VERSION_NOT_EXACT: ${version || '<missing>'}`);
  }
  const executable = require('electron');
  const runtime = inspect(
    executable,
    ['-e', "console.log(JSON.stringify({electron:process.versions.electron,modules:process.versions.modules,arch:process.arch}))"],
    {
      cwd: snapshotDesktopRoot,
      envOverrides: { ELECTRON_RUN_AS_NODE: '1' },
      timeout: 120_000,
    },
  );
  if (runtime.status !== 0) {
    throw releaseFailure('ELECTRON_RUNTIME_PROBE_FAILED', runtime.stderr, runtime);
  }
  const details = JSON.parse(runtime.stdout.trim().split('\n').at(-1));
  if (details.electron !== version || !/^\d+$/.test(String(details.modules))) {
    throw new Error(
      `ELECTRON_RUNTIME_TARGET_MISMATCH: config=${version} runtime=${details.electron} abi=${details.modules}`,
    );
  }
  return { version, abi: Number(details.modules), hostArch: details.arch };
}

async function verifySourceUnchanged() {
  const current = await sourceIdentity();
  if (
    current.head !== manifest.source.head
    || current.dirtyDiffSha256 !== manifest.source.dirtyDiffSha256
  ) {
    throw new Error(
      `SOURCE_CHANGED_DURING_BUILD: start=${manifest.source.dirtyDiffSha256} end=${current.dirtyDiffSha256}`,
    );
  }
}

async function verifySnapshotInputsUnchanged() {
  const actual = await hashFileSet(snapshot.root, snapshot.files);
  if (actual !== snapshot.identity.sha256) {
    throw new Error(
      `IMMUTABLE_SNAPSHOT_MUTATED: expected=${snapshot.identity.sha256} actual=${actual}`,
    );
  }
  await verifyAuthoritativeSnapshotInputs(snapshot);
}

async function verifyAuthoritativeSnapshotInputs(currentSnapshot) {
  const manifestBytes = await readFile(currentSnapshot.authoritativeInputs.path);
  const manifestBinding = currentSnapshot.authoritativeInputs.binding;
  if (
    manifestBytes.byteLength !== manifestBinding.bytes
    || createHash('sha256').update(manifestBytes).digest('hex') !== manifestBinding.sha256
  ) {
    throw new Error('AUTHORITATIVE_SNAPSHOT_INPUT_MANIFEST_MUTATED');
  }
  const document = JSON.parse(manifestBytes.toString('utf8'));
  const actual = await bindAuthoritativeSnapshotFileSet({
    snapshotRoot: currentSnapshot.root,
    manifest: document,
  });
  if (
    actual.fileCount !== manifestBinding.fileCount
    || actual.sha256 !== manifestBinding.aggregateSha256
    || actual.sha256 !== currentSnapshot.identity.sha256
  ) {
    throw new Error('AUTHORITATIVE_SNAPSHOT_INPUT_SET_MUTATED');
  }
  return actual;
}

async function verifyArtifactInventory() {
  const actual = (await listFiles(artifactsDir))
    .map((file) => path.relative(outputRoot, file))
    .sort();
  const expected = manifest.artifacts.map((artifact) => artifact.relativePath).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `ARTIFACT_INVENTORY_MISMATCH: manifest=${JSON.stringify(expected)} disk=${JSON.stringify(actual)}`,
    );
  }
}

async function runGates() {
  const kbReleaseConfig = await writeKbReleaseTsconfig();
  const protectedWipCheck = run(
    'kb-protected-wip-non-gating',
    'npm',
    ['run', 'check', '--workspace', '@copilot/kb'],
    // The immutable release snapshot intentionally excludes this protected
    // experiment. Run the evidence-only check against the live frozen source
    // so the manifest retains its exact known errors without shipping it.
    { cwd: repoRoot, allowedStatuses: [0, 2] },
  );
  if (protectedWipCheck.status !== 0) {
    const errors = `${protectedWipCheck.stdout}\n${protectedWipCheck.stderr}`
      .split('\n')
      .filter((line) => /error TS\d+:/.test(line));
    manifest.nonGatingRisks.push({
      code: 'NON_GATING_PROTECTED_KB_TODO_WIP',
      paths: [...protectedNonReleasePaths],
      errorCount: errors.length,
      errors,
      mitigation: 'Excluded from release source; current desktop uses note-backed Todo and packaged KB domain smoke is mandatory.',
    });
  }
  const vitest = path.join(buildRepoRoot, 'node_modules/.bin/vitest');
  const tsc = path.join(buildRepoRoot, 'node_modules/.bin/tsc');
  const gates = [
    commandGate('cloud-check', 'npm', ['run', 'check', '--workspace', '@copilot/cloud']),
    coverageGate(
      'cloud-coverage', 'npm', ['run', 'test:coverage', '--workspace', '@copilot/cloud'],
      'apps/copilot-cloud/coverage/coverage-summary.json',
      { statements: 70, branches: 60, functions: 70, lines: 70 },
    ),
    commandGate('cloud-build', 'npm', ['run', 'build', '--workspace', '@copilot/cloud']),
    commandGate('llm-check', 'npm', ['run', 'check', '--workspace', '@copilot/llm-client']),
    coverageGate(
      'llm-coverage', 'npm', ['run', 'test:coverage', '--workspace', '@copilot/llm-client'],
      'packages/llm-client/coverage/coverage-summary.json',
      { statements: 90, branches: 85, functions: 90, lines: 90 },
    ),
    commandGate('llm-build', 'npm', ['run', 'build', '--workspace', '@copilot/llm-client']),
    commandGate('kb-release-check', tsc, ['-p', kbReleaseConfig, '--noEmit']),
    coverageGate(
      'kb-release-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'packages/kb/vitest.release-coverage.config.ts')],
      'packages/kb/coverage/release/coverage-summary.json',
      { statements: 70, branches: 70, functions: 70, lines: 70 },
    ),
    coverageGate(
      'kb-critical-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'packages/kb/vitest.critical-coverage.config.ts')],
      'packages/kb/coverage/critical/coverage-summary.json',
      { statements: 90, branches: 90, functions: 90, lines: 90 },
      true,
    ),
    commandGate('kb-release-build', tsc, ['-p', kbReleaseConfig]),
    commandGate('kg-check', 'npm', ['run', 'check', '--workspace', '@copilot/kg']),
    coverageGate(
      'kg-coverage', 'npm', ['run', 'test:coverage', '--workspace', '@copilot/kg'],
      'packages/kg/coverage/coverage-summary.json',
      { statements: 90, branches: 85, functions: 90, lines: 90 },
    ),
    commandGate('kg-build', 'npm', ['run', 'build', '--workspace', '@copilot/kg']),
    commandGate('rag-check', 'npm', ['run', 'check', '--workspace', '@copilot/rag']),
    coverageGate(
      'rag-global-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'packages/rag/vitest.coverage.config.ts')],
      'packages/rag/coverage/global/coverage-summary.json',
      { statements: 70, branches: 70, functions: 70, lines: 70 },
    ),
    coverageGate(
      'rag-critical-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'packages/rag/vitest.critical.config.ts')],
      'packages/rag/coverage/critical/coverage-summary.json',
      { branches: 90, lines: 90 },
      true,
    ),
    commandGate('rag-build', 'npm', ['run', 'build', '--workspace', '@copilot/rag']),
    commandGate('desktop-check', 'npm', ['run', 'check', '--workspace', '@copilot/desktop']),
    coverageGate(
      'desktop-global-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'apps/copilot-desktop/tests/vitest.desktop-coverage.config.ts')],
      'apps/copilot-desktop/coverage/desktop/coverage-summary.json',
      { statements: 70, branches: 70, functions: 70, lines: 70 },
    ),
    coverageGate(
      'desktop-critical-coverage', vitest,
      ['run', '--coverage', '--config', path.join(buildRepoRoot, 'apps/copilot-desktop/tests/vitest.critical-coverage.config.ts')],
      'apps/copilot-desktop/coverage/critical/coverage-summary.json',
      { statements: 90, branches: 90, functions: 90, lines: 90 },
      true,
    ),
    commandGate('desktop-build', 'npm', ['run', 'build', '--workspace', '@copilot/desktop']),
  ];
  for (const gate of gates) await executeGate(gate);
}

function commandGate(label, command, args) {
  return { label, command, args };
}

function coverageGate(label, command, args, summary, thresholds, perFile = false) {
  return { label, command, args, coverage: { summary, thresholds, perFile } };
}

async function executeGate(gate) {
  const result = run(gate.label, gate.command, gate.args, { cwd: buildRepoRoot });
  const record = {
    label: gate.label,
    command: gate.command,
    args: gate.args,
    cwd: path.relative(outputRoot, buildRepoRoot),
    log: path.relative(outputRoot, path.join(logsDir, `${safeLabel(gate.label)}.log`)),
    exitCode: result.status,
    execution: executionEvidence(result),
    passed: false,
  };
  if (result.status !== 0) {
    manifest.gates.push(record);
    throw releaseFailure('GATE_FAILED', gate.label, result);
  }
  if (gate.coverage) {
    try {
      record.coverage = await readCoverageEvidence(gate.coverage);
    } catch (error) {
      record.coverage = {
        summary: gate.coverage.summary,
        thresholds: gate.coverage.thresholds,
        perFile: gate.coverage.perFile,
        error: error instanceof Error ? error.message : String(error),
      };
      manifest.gates.push(record);
      throw releaseFailure('COVERAGE_EVIDENCE_FAILED', gate.label, result);
    }
  }
  record.passed = true;
  manifest.gates.push(record);
}

async function readCoverageEvidence(config) {
  const summaryPath = path.join(buildRepoRoot, config.summary);
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  const total = coverageMetrics(summary.total, 'total');
  assertCoverageThresholds(total, config.thresholds, 'total');
  const fileMetrics = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([file, value]) => ({ file: path.relative(buildRepoRoot, file), ...coverageMetrics(value, file) }));
  if (config.perFile && fileMetrics.length === 0) {
    throw new Error(`COVERAGE_PER_FILE_EVIDENCE_MISSING: ${config.summary}`);
  }
  if (config.perFile) {
    for (const metrics of fileMetrics) assertCoverageThresholds(metrics, config.thresholds, metrics.file);
  }
  const minimumPerFile = {};
  for (const metric of Object.keys(config.thresholds)) {
    minimumPerFile[metric] = fileMetrics.length
      ? Math.min(...fileMetrics.map((entry) => entry[metric]))
      : null;
  }
  return {
    summary: path.relative(outputRoot, summaryPath),
    thresholds: config.thresholds,
    perFile: config.perFile,
    total,
    fileCount: fileMetrics.length,
    minimumPerFile,
    files: config.perFile ? fileMetrics : undefined,
  };
}

function coverageMetrics(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`COVERAGE_METRICS_MISSING: ${label}`);
  const metrics = {};
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const pct = Number(value[metric]?.pct);
    if (!Number.isFinite(pct)) throw new Error(`COVERAGE_METRIC_INVALID: ${label}/${metric}`);
    metrics[metric] = pct;
  }
  return metrics;
}

function assertCoverageThresholds(metrics, thresholds, label) {
  for (const [metric, threshold] of Object.entries(thresholds)) {
    if (metrics[metric] < threshold) {
      throw new Error(
        `COVERAGE_THRESHOLD_FAILED: ${label}/${metric}=${metrics[metric]} required=${threshold}`,
      );
    }
  }
}

async function runPostPackageGates() {
  const result = await evaluatePostPackageEvidence({
    evidencePath: options.externalEvidence,
    candidate: manifest.candidate,
    source: manifest.source,
    artifacts: manifest.artifacts,
    releaseMode: manifest.releaseMode,
    // A candidate-local manifest is not an independent trust root. Only the
    // finalizer may enable PM verification after matching an external anchor.
    northStar: { ...manifest.northStar, pmRunner: null },
  });
  manifest.postPackageGates = {
    ...result,
    evidenceFile: result.evidenceFile ? {
      ...result.evidenceFile,
      path: path.relative(outputRoot, result.evidenceFile.path),
    } : null,
  };
  for (const blocker of result.blockers) {
    if (!manifest.blockers.some((existing) => existing.code === blocker.code)) {
      manifest.blockers.push(blocker);
    }
  }
}

async function writeKbReleaseTsconfig() {
  const configPath = path.join(workDir, 'kb-release-tsconfig.json');
  const config = {
    extends: path.join(buildRepoRoot, 'packages/kb/tsconfig.json'),
    compilerOptions: {
      rootDir: path.join(buildRepoRoot, 'packages/kb/src'),
      outDir: path.join(buildRepoRoot, 'packages/kb/dist'),
    },
    include: [path.join(buildRepoRoot, 'packages/kb/src/**/*.ts')],
    exclude: [
      path.join(buildRepoRoot, 'packages/kb/src/api/todo.ts'),
      path.join(buildRepoRoot, 'packages/kb/tests'),
      path.join(buildRepoRoot, 'packages/kb/dist'),
      path.join(buildRepoRoot, 'packages/kb/node_modules'),
    ],
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

async function buildMac(arch) {
  const buildOutput = path.join(workDir, `mac-${arch}`);
  const configPath = await writeBuilderConfig(`mac-${arch}`, buildOutput);
  const packed = run(
    `mac-${arch}-unpacked`,
    electronBuilder,
    ['--mac', '--dir', `--${arch}`, '--config', configPath, '--publish', 'never'],
    { cwd: buildDesktopRoot },
  );
  if (packed.status !== 0) throw releaseFailure('MAC_UNPACKED_FAILED', arch, packed);
  const appPath = await findFirst(buildOutput, (entry) => entry.endsWith('.app'));
  if (!appPath) throw new Error(`MAC_APP_MISSING: ${arch}`);

  const staged = run(
    `mac-${arch}-native-stage`,
    process.execPath,
    [
      nativeStageScript,
      '--app', appPath,
      '--arch', arch,
      '--electron-version', electronVersion,
      '--python', '/usr/bin/python3',
    ],
    { cwd: buildRepoRoot },
  );
  if (staged.status !== 0 || !staged.stdout.includes('PACKAGED_NATIVE_LOAD_OK')) {
    const causeExecution = parseNestedSpawnEvidence(staged.stderr);
    throw releaseFailure('MAC_NATIVE_STAGE_FAILED', arch, staged, {
      timedOut: causeExecution?.timedOut ?? staged.timedOut,
      causeExecution,
    });
  }
  assertElectronRuntimeEvidence(staged.stdout, arch);
  const nativePath = path.join(appPath, 'Contents/Resources/app.asar.unpacked', nativeRelative);
  const stagedNative = await inspectNative(nativePath, 'darwin', arch);

  const zipName = `njx-copilot-v6-0.1.0-mac-${arch}.zip`;
  const zipWork = path.join(workDir, zipName);
  const zipPath = path.join(artifactsDir, zipName);
  const distributionVerification = distributionGrade
    ? await signMacAppForDistribution({ arch, appPath, zipWork })
    : null;
  await verifyMacWorkAppIdentity(buildOutput);
  const zipped = run(
    `mac-${arch}-zip`,
    '/usr/bin/ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipWork],
    { cwd: repoRoot },
  );
  if (zipped.status !== 0) throw releaseFailure('MAC_ZIP_FAILED', arch, zipped);
  await rename(zipWork, zipPath);
  let zipArtifact;
  await verifyFinalArtifactForIdentity({
    filePath: zipPath,
    inspectExtracted: ({ snapshotPath }) => verifyMacZip(
      snapshotPath, arch, stagedNative.sha256, distributionVerification,
    ),
    publishRecord: async ({ outer, inspection: zipVerification }) => {
      zipArtifact = await addArtifact(
        zipPath, 'macOS ZIP', 'darwin', arch, zipVerification.signed,
        zipVerification.native, outer,
      );
      await writeArtifactIdentityRecord(zipArtifact, zipVerification.releaseIdentity);
    },
  });
  if (distributionVerification) {
    await writeMacSigningReport(zipArtifact, distributionVerification);
  }
  if (process.env.CANONICAL_SKIP_DMG === '1') {
    manifest.blockers.push({
      code: 'BLOCKED_MAC_DMG_DEVICE',
      arch,
      message: 'hdiutil requires device access unavailable in the active sandbox; ZIP remains verified.',
    });
    return;
  }
  const dmgName = `njx-copilot-v6-0.1.0-mac-${arch}.dmg`;
  const dmgWork = path.join(workDir, dmgName);
  const dmgPath = path.join(artifactsDir, dmgName);
  let dmgDistributionVerification = null;
  if (distributionVerification) {
    const dmgCertificateRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-mac-dmg-cert-${arch}-`));
    const dmgCertificatePrefix = path.join(dmgCertificateRoot, 'developer-id-chain-');
    try {
      const dmgPlan = createMacDmgDistributionPlan({
        mode: 'distribution',
        arch,
        appPath,
        dmgPath: dmgWork,
        volumeName: `NJX Copilot ${arch}`,
        notaryProfile: signingProfile.mac.notaryProfile,
        identity: signingProfile.mac.identity,
        teamId: signingProfile.mac.teamId,
        certificatePrefix: dmgCertificatePrefix,
      });
      dmgDistributionVerification = await executeMacDmgDistribution(
        { plan: dmgPlan, stapledAppVerified: distributionVerification.staplerValid },
        {
          runStep: async (step) => run(
            `mac-${arch}-${step.id}`,
            step.command,
            step.args,
            { cwd: buildRepoRoot, displayArgs: step.displayArgs },
          ),
        },
      );
    } finally {
      await removeExtractedCertificateChain(dmgCertificatePrefix);
      await rm(dmgCertificateRoot, { recursive: true, force: true });
    }
  } else {
    const dmg = run(
      `mac-${arch}-dmg`,
      '/usr/bin/hdiutil',
      ['create', '-volname', `NJX Copilot ${arch}`, '-srcfolder', appPath, '-format', 'UDZO', dmgWork],
      { cwd: repoRoot },
    );
    if (dmg.status !== 0) {
      manifest.blockers.push(blockerFromError(
        'BLOCKED_MAC_DMG_DEVICE',
        arch,
        releaseFailure(
          'MAC_DMG_CREATE_FAILED',
          `see logs/mac-${arch}-dmg.log; ZIP remains verified`,
          dmg,
        ),
      ));
      return;
    }
  }
  await rename(dmgWork, dmgPath);
  let dmgArtifact;
  let dmgVerification;
  await verifyFinalArtifactForIdentity({
    filePath: dmgPath,
    inspectExtracted: ({ snapshotPath }) => verifyMacDmg(
      snapshotPath, arch, stagedNative.sha256, distributionVerification,
    ),
    publishRecord: async ({ outer, inspection }) => {
      dmgVerification = inspection;
      dmgArtifact = await addArtifact(
        dmgPath, 'macOS DMG', 'darwin', arch, dmgVerification.signed,
        dmgVerification.native, outer,
      );
      await writeArtifactIdentityRecord(dmgArtifact, dmgVerification.releaseIdentity);
    },
  });
  if (distributionVerification) {
    await writeMacSigningReport(dmgArtifact, {
      ...distributionVerification,
      notarization: dmgDistributionVerification.notarization,
      staplerValid: dmgDistributionVerification.staplerValid,
      containerCodesignValid: dmgVerification.containerCodesignValid === true
        && dmgDistributionVerification.containerCodesignValid === true,
      containerTrustedTimestamp: dmgVerification.containerTrustedTimestamp === true
        && dmgDistributionVerification.containerTrustedTimestamp === true,
      containerCertificateSha256Fingerprint:
        dmgDistributionVerification.containerCertificateSha256Fingerprint,
      payloadCertificateSha256Fingerprint: distributionVerification.certificateSha256Fingerprint,
    });
  }
}

async function verifyMacWorkAppIdentity(buildOutput) {
  return inspectExtractedReleaseIdentity({
    root: buildOutput,
    platform: 'darwin',
    canonicalIdentity,
  });
}

async function signMacAppForDistribution({ arch, appPath, zipWork }) {
  const certificateRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-mac-cert-${arch}-`));
  const certificatePrefix = path.join(certificateRoot, 'developer-id-chain-');
  const temporaryNotaryZip = path.join(workDir, `mac-${arch}-notary-submission.zip`);
  const plan = createMacDistributionPlan({
    mode: 'distribution',
    arch,
    appPath,
    electronVersion,
    osxSignPath: electronOsxSign,
    identity: signingProfile.mac.identity,
    teamId: signingProfile.mac.teamId,
    notaryProfile: signingProfile.mac.notaryProfile,
    certificatePrefix,
    temporaryNotaryZip,
    finalZipPath: zipWork,
  });
  try {
    return await executeMacAppDistributionSigning(
      { plan, nativeStageVerified: true },
      {
        runStep: async (step) => run(
          `mac-${arch}-${step.id}`,
          step.command,
          step.args,
          { cwd: buildRepoRoot, displayArgs: step.displayArgs },
        ),
      },
    );
  } finally {
    await removeExtractedCertificateChain(certificatePrefix);
    await rm(certificateRoot, { recursive: true, force: true });
    await rm(temporaryNotaryZip, { force: true });
  }
}

async function removeExtractedCertificateChain(certificatePrefix) {
  const directory = path.dirname(certificatePrefix);
  const prefix = path.basename(certificatePrefix);
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && new RegExp(`^${escapeRegExp(prefix)}\\d+$`).test(entry.name)) {
      await rm(path.join(directory, entry.name), { force: true });
    }
  }
}

async function writeMacSigningReport(artifact, verification) {
  const artifactPath = path.join(outputRoot, artifact.relativePath);
  const current = await stat(artifactPath);
  const currentSha = await sha256(artifactPath);
  if (current.size !== artifact.bytes || currentSha !== artifact.sha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNED_ARTIFACT_MUTATED: macOS artifact changed before report binding'),
      { code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED' },
    );
  }
  const built = buildMacSigningReport({
    candidate: manifest.candidate,
    sourceHead: manifest.source.head,
    snapshotSha256: manifest.source.snapshot.sha256,
    artifact,
    verification,
  });
  assertMacSigningReportBinding({ artifact, ...built });
  const signingDir = path.join(outputRoot, 'evidence/signing');
  await mkdir(signingDir, { recursive: true });
  const reportPath = path.join(signingDir, `${path.basename(artifact.relativePath)}.signing.json`);
  await publishSigningReportCrashSafe({ target: reportPath, contents: built.reportText });
  const reportSha = await sha256(reportPath);
  if (reportSha !== built.reportSha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNING_EVIDENCE_BINDING: written macOS report SHA is invalid'),
      { code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' },
    );
  }
  const after = await stat(artifactPath);
  const afterSha = await sha256(artifactPath);
  if (after.size !== artifact.bytes || afterSha !== artifact.sha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNED_ARTIFACT_MUTATED: macOS artifact changed after report binding'),
      { code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED' },
    );
  }
  artifact.signature = {
    ...built.signature,
    signingReport: {
      relativePath: path.relative(outputRoot, reportPath),
      sha256: reportSha,
    },
  };
}

async function verifyMacZip(archive, arch, expectedNativeSha, expectedSigning = null) {
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-mac-zip-${arch}-`));
  try {
    const extracted = run(
      `mac-${arch}-zip-extract`,
      '/usr/bin/ditto',
      ['-x', '-k', archive, extractRoot],
      { cwd: buildRepoRoot },
    );
    if (extracted.status !== 0) throw releaseFailure('MAC_ZIP_EXTRACT_FAILED', arch, extracted);
    const apps = await findDirectApps(extractRoot);
    if (apps.length !== 1) throw new Error(`MAC_ZIP_APP_COUNT_INVALID: ${arch} count=${apps.length}`);
    return await verifyFinalMacApp(
      apps[0], arch, expectedNativeSha, `mac-${arch}-zip-final`, expectedSigning, extractRoot,
    );
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

async function verifyMacDmg(archive, arch, expectedNativeSha, expectedSigning = null) {
  const mountRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-mac-dmg-${arch}-`));
  const label = `mac-${arch}-dmg-final`;
  let mounted = false;
  try {
    const containerSign = run(
      `${label}-container-codesign-verify`,
      '/usr/bin/codesign',
      ['--verify', '--strict', '--verbose=4', archive],
      { cwd: buildRepoRoot, allowedStatuses: expectedSigning ? [0] : [0, 1] },
    );
    const containerDetails = run(
      `${label}-container-codesign-details`,
      '/usr/bin/codesign',
      ['-dvvv', '--verbose=4', archive],
      { cwd: buildRepoRoot, allowedStatuses: expectedSigning ? [0] : [0, 1] },
    );
    let containerCodesign = null;
    if (expectedSigning) {
      if (containerSign.status !== 0 || containerDetails.status !== 0) {
        throw Object.assign(
          new Error(`BLOCKED_MAC_SIGNING_FAILED: ${label} outer codesign verification failed`),
          { code: 'BLOCKED_MAC_SIGNING_FAILED' },
        );
      }
      containerCodesign = parseCodesignDetails(
        `${containerDetails.stdout}\n${containerDetails.stderr}`,
        {
          identity: signingProfile.mac.identity,
          teamId: expectedSigning.teamId,
          requireHardenedRuntime: false,
        },
      );
    }
    const attached = run(
      `mac-${arch}-dmg-attach`,
      '/usr/bin/hdiutil',
      ['attach', '-readonly', '-nobrowse', '-mountpoint', mountRoot, archive],
      { cwd: buildRepoRoot },
    );
    if (attached.status !== 0) throw releaseFailure('MAC_DMG_ATTACH_FAILED', arch, attached);
    mounted = true;
    const apps = await findDirectApps(mountRoot);
    if (apps.length !== 1) throw new Error(`MAC_DMG_APP_COUNT_INVALID: ${arch} count=${apps.length}`);
    const payload = await verifyFinalMacApp(
      apps[0], arch, expectedNativeSha, `${label}-payload`, expectedSigning, mountRoot,
    );
    const containerSigned = containerSign.status === 0
      && containerDetails.status === 0
      && /Authority=/.test(`${containerDetails.stdout}\n${containerDetails.stderr}`)
      && !/Signature=adhoc/i.test(`${containerDetails.stdout}\n${containerDetails.stderr}`);
    return {
      ...payload,
      signed: expectedSigning ? containerSigned && Boolean(containerCodesign) : containerSigned,
      containerCodesignValid: expectedSigning ? containerSigned && Boolean(containerCodesign) : containerSigned,
      containerTrustedTimestamp: expectedSigning ? containerCodesign?.trustedTimestamp === true : false,
    };
  } finally {
    if (mounted) {
      run(`mac-${arch}-dmg-detach`, '/usr/bin/hdiutil', ['detach', mountRoot], { cwd: buildRepoRoot });
    }
    await rm(mountRoot, { recursive: true, force: true });
  }
}

async function findDirectApps(root) {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(root, entry.name));
}

async function verifyFinalMacApp(
  appPath,
  arch,
  expectedNativeSha,
  label,
  expectedSigning = null,
  inventoryRoot = appPath,
) {
  const nativePath = path.join(appPath, 'Contents/Resources/app.asar.unpacked', nativeRelative);
  const native = await inspectNative(nativePath, 'darwin', arch);
  if (native.sha256 !== expectedNativeSha) {
    throw new Error(`${label.toUpperCase()}_NATIVE_SHA_MISMATCH: expected=${expectedNativeSha} actual=${native.sha256}`);
  }
  const runtime = run(
    `${label}-runtime`,
    process.execPath,
    [
      nativeStageScript,
      '--verify-only',
      '--app', appPath,
      '--arch', arch,
      '--electron-version', electronVersion,
    ],
    { cwd: buildRepoRoot },
  );
  if (
    runtime.status !== 0
    || !runtime.stdout.includes('PACKAGED_NATIVE_LOAD_OK')
    || !runtime.stdout.includes('PACKAGED_DOMAIN_SMOKE_OK')
  ) {
    throw releaseFailure(`${label.toUpperCase()}_RUNTIME_SMOKE_FAILED`, arch, runtime);
  }
  assertElectronRuntimeEvidence(runtime.stdout, arch);
  const releaseIdentity = await inspectExtractedReleaseIdentity({
    root: inventoryRoot,
    platform: 'darwin',
    canonicalIdentity,
  });
  const sign = run(
    `${label}-codesign-verify`,
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', appPath],
    { cwd: buildRepoRoot, allowedStatuses: expectedSigning ? [0] : [0, 1] },
  );
  const signDetails = run(
    `${label}-codesign-details`,
    '/usr/bin/codesign',
    ['-dv', '--verbose=4', appPath],
    { cwd: buildRepoRoot, allowedStatuses: expectedSigning ? [0] : [0, 1] },
  );
  const signatureText = `${signDetails.stdout}\n${signDetails.stderr}`;
  let signed = sign.status === 0
    && /Authority=/.test(signatureText)
    && !/Signature=adhoc/i.test(signatureText);
  if (expectedSigning) {
    if (sign.status !== 0 || signDetails.status !== 0) {
      throw Object.assign(
        new Error(`BLOCKED_MAC_SIGNING_FAILED: ${label} codesign verification failed`),
        { code: 'BLOCKED_MAC_SIGNING_FAILED' },
      );
    }
    parseCodesignDetails(signatureText, {
      identity: signingProfile.mac.identity,
      teamId: expectedSigning.teamId,
    });
    const staple = run(
      `${label}-stapler-validate`,
      '/usr/bin/xcrun',
      ['stapler', 'validate', appPath],
      { cwd: buildRepoRoot },
    );
    const stapleText = `${staple.stdout}\n${staple.stderr}`;
    if (staple.status !== 0 || !/validate action worked/i.test(stapleText)) {
      throw Object.assign(
        new Error(`BLOCKED_MAC_STAPLE_FAILED: ${label} stapler verification failed`),
        { code: 'BLOCKED_MAC_STAPLE_FAILED' },
      );
    }
    const gatekeeper = run(
      `${label}-gatekeeper`,
      '/usr/sbin/spctl',
      ['--assess', '--type', 'execute', '--verbose=4', appPath],
      { cwd: buildRepoRoot },
    );
    const gatekeeperText = `${gatekeeper.stdout}\n${gatekeeper.stderr}`;
    if (
      gatekeeper.status !== 0
      || !/accepted/i.test(gatekeeperText)
      || !/Notarized Developer ID/i.test(gatekeeperText)
    ) {
      throw Object.assign(
        new Error(`BLOCKED_MAC_STAPLE_FAILED: ${label} Gatekeeper verification failed`),
        { code: 'BLOCKED_MAC_STAPLE_FAILED' },
      );
    }
    signed = true;
  }
  return {
    signed,
    native: { ...native, verification: 'final-archive-runtime-domain-and-static' },
    releaseIdentity,
  };
}

function assertElectronRuntimeEvidence(stdout, arch) {
  const line = stdout.split('\n').find((value) => value.startsWith('ELECTRON_RUNTIME '));
  if (!line) throw new Error(`ELECTRON_RUNTIME_EVIDENCE_MISSING: ${arch}`);
  const runtime = JSON.parse(line.slice('ELECTRON_RUNTIME '.length));
  if (
    runtime.electron !== electronVersion
    || Number(runtime.modules) !== electronAbi
    || runtime.arch !== arch
  ) {
    throw new Error(
      `ELECTRON_RUNTIME_EVIDENCE_MISMATCH: expected=${electronVersion}/${electronAbi}/${arch} actual=${JSON.stringify(runtime)}`,
    );
  }
  return runtime;
}

async function buildWindows(arch) {
  const native = await acquireWindowsNative(arch);
  const buildOutput = path.join(workDir, `win-${arch}-unpacked-build`);
  const configPath = await writeBuilderConfig(`win-${arch}-unpacked`, buildOutput, {
    windowsMode: signingProfile.mode,
  });
  let unpackedBuild;
  try {
    unpackedBuild = run(
      `win-${arch}-unpacked`,
      electronBuilder,
      ['--win', '--dir', `--${arch}`, '--config', configPath, '--publish', 'never'],
      {
        cwd: buildDesktopRoot,
        childEnvironment: signingProfile.mode === 'distribution'
          ? 'windows-electron-builder'
          : 'default',
        redactValues: windowsSigningRedactValues(),
      },
    );
  } finally {
    if (signingProfile.mode === 'distribution') await rm(configPath, { force: true });
  }
  if (unpackedBuild.status !== 0) {
    throw releaseFailure('WINDOWS_UNPACKED_FAILED', arch, unpackedBuild);
  }
  const unpacked = await findFirst(
    buildOutput,
    (entry) => path.basename(entry) === 'njx-copilot-v6.exe',
  );
  if (!unpacked) throw new Error(`WINDOWS_UNPACKED_APP_MISSING: ${arch}`);
  const unpackedRoot = path.dirname(unpacked);
  const packagedNative = path.join(unpackedRoot, 'resources/app.asar.unpacked', nativeRelative);
  await atomicCopy(native.path, packagedNative);
  const packagedEvidence = await inspectNative(packagedNative, 'win32', arch);
  if (packagedEvidence.sha256 !== native.sha256) {
    throw new Error(`WINDOWS_NATIVE_PATCH_SHA_MISMATCH: ${arch}`);
  }
  const mainExecutableVerification = signingProfile.mode === 'distribution'
    ? await verifyWindowsAuthenticode(unpacked, `win-${arch}-main-executable`)
    : null;
  const mainInfo = await stat(unpacked);
  const mainExecutable = mainExecutableVerification ? {
    relativePath: path.relative(unpackedRoot, unpacked).split(path.sep).join('/'),
    sha256: await sha256(unpacked),
    bytes: mainInfo.size,
    ...mainExecutableVerification,
  } : null;

  const artifactOutput = path.join(workDir, `win-${arch}-artifacts`);
  const artifactConfig = await writeBuilderConfig(`win-${arch}-artifacts`, artifactOutput, {
    windowsMode: signingProfile.mode,
  });
  let installerBuild;
  try {
    installerBuild = run(
      `win-${arch}-installers`,
      electronBuilder,
      [
        '--win', 'nsis', 'portable', `--${arch}`, '--prepackaged', unpackedRoot,
        '--config', artifactConfig, '--publish', 'never',
      ],
      {
        cwd: buildDesktopRoot,
        childEnvironment: signingProfile.mode === 'distribution'
          ? 'windows-electron-builder'
          : 'default',
        redactValues: windowsSigningRedactValues(),
      },
    );
  } finally {
    if (signingProfile.mode === 'distribution') await rm(artifactConfig, { force: true });
  }
  if (installerBuild.status !== 0) {
    throw releaseFailure('WINDOWS_INSTALLERS_FAILED', arch, installerBuild);
  }
  const executables = (await listFiles(artifactOutput)).filter((file) => file.endsWith('.exe'));
  const setups = executables.filter((file) => file.endsWith(`-${arch}-setup.exe`));
  const portables = executables.filter((file) => file.endsWith(`-${arch}-portable.exe`));
  if (setups.length !== 1 || portables.length !== 1) {
    throw new Error(
      `WINDOWS_ARTIFACTS_INVALID: ${arch} setup=${setups.length} portable=${portables.length}`,
    );
  }

  for (const [kind, source] of [['Windows NSIS', setups[0]], ['Windows Portable', portables[0]]]) {
    const destination = path.join(
      artifactsDir,
      `njx-copilot-v6-0.1.0-win-${arch}-${kind === 'Windows NSIS' ? 'setup' : 'portable'}.exe`,
    );
    await rename(source, destination);
    let artifact;
    let outerVerification = null;
    await verifyFinalArtifactForIdentity({
      filePath: destination,
      inspectExtracted: async ({ snapshotPath }) => {
        outerVerification = signingProfile.mode === 'distribution'
          ? await verifyWindowsAuthenticode(snapshotPath, `win-${arch}-${kind === 'Windows NSIS' ? 'setup' : 'portable'}-signature`)
          : null;
        return inspectNativeInsideWindowsArtifact(
          snapshotPath, arch, native.sha256, mainExecutable,
        );
      },
      publishRecord: async ({ outer, inspection: extractedEvidence }) => {
        const { releaseIdentity, ...nativeEvidence } = extractedEvidence;
        artifact = await addArtifact(
          destination, kind, 'win32', arch, Boolean(outerVerification), nativeEvidence, outer,
        );
        await writeArtifactIdentityRecord(artifact, releaseIdentity);
      },
    });
    if (outerVerification) {
      await writeWindowsSigningReport(artifact, outerVerification, mainExecutable);
    }
  }
}

async function verifyWindowsAuthenticode(filePath, label) {
  if (!osslSigncode) {
    throw Object.assign(
      new Error('BLOCKED_WINDOWS_SIGNING_VERIFIER_MISSING: osslsigncode is unavailable'),
      { code: 'BLOCKED_WINDOWS_SIGNING_VERIFIER_MISSING' },
    );
  }
  const verificationRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-windows-signature-'));
  try {
    const plan = createOsslVerificationPlan({
      osslSigncode,
      filePath,
      signaturePath: path.join(verificationRoot, 'authenticode-signature.pem'),
      certificatesPath: path.join(verificationRoot, 'signer-certificates.pem'),
      cmsContentPath: path.join(verificationRoot, 'authenticode-content.der'),
    });
    const outputs = [];
    for (const step of plan) {
      const result = run(`${label}-${step.id}`, step.command, step.args, {
        cwd: buildRepoRoot,
        redactValues: windowsSigningRedactValues(),
      });
      if (result.status !== 0) {
        throw Object.assign(
          new Error(`BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED: ${label}/${step.id} failed`),
          { code: 'BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED' },
        );
      }
      outputs.push(`---${step.id}---`, result.stdout, result.stderr);
    }
    return parseOsslSigncodeVerification(outputs.join('\n'));
  } finally {
    await rm(verificationRoot, { recursive: true, force: true });
  }
}

async function writeWindowsSigningReport(artifact, verification, mainExecutable) {
  const artifactPath = path.join(outputRoot, artifact.relativePath);
  const before = await stat(artifactPath);
  const beforeSha = await sha256(artifactPath);
  if (before.size !== artifact.bytes || beforeSha !== artifact.sha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNED_ARTIFACT_MUTATED: Windows artifact changed before report binding'),
      { code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED' },
    );
  }
  const built = buildWindowsCryptographicSigningReport({
    candidate: manifest.candidate,
    sourceHead: manifest.source.head,
    snapshotSha256: manifest.source.snapshot.sha256,
    artifact,
    verification,
    mainExecutable,
    windowsTrustAttestation: signingProfile.windows.trust,
  });
  const signingDir = path.join(outputRoot, 'evidence/signing');
  await mkdir(signingDir, { recursive: true });
  const reportPath = path.join(signingDir, `${path.basename(artifact.relativePath)}.cryptographic.json`);
  await publishWindowsSigningReportCrashSafe({ target: reportPath, contents: built.reportText });
  const reportSha = await sha256(reportPath);
  if (reportSha !== built.reportSha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNING_EVIDENCE_BINDING: written Windows report SHA is invalid'),
      { code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' },
    );
  }
  const after = await stat(artifactPath);
  if (after.size !== artifact.bytes || await sha256(artifactPath) !== artifact.sha256) {
    throw Object.assign(
      new Error('BLOCKED_SIGNED_ARTIFACT_MUTATED: Windows artifact changed after report binding'),
      { code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED' },
    );
  }
  artifact.signature = {
    ...built.signature,
    signingReport: {
      relativePath: path.relative(outputRoot, reportPath),
      sha256: reportSha,
    },
  };
}

async function acquireWindowsNative(arch) {
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-win-native-${arch}-`));
  const packagePath = path.join(stageRoot, 'better-sqlite3');
  await cp(path.join(buildRepoRoot, 'node_modules/better-sqlite3'), packagePath, {
    recursive: true,
    dereference: true,
    filter: (source) => path.relative(path.join(buildRepoRoot, 'node_modules/better-sqlite3'), source).split(path.sep)[0] !== 'build',
  });
  const acquired = run(
    `win-${arch}-native-prebuild`,
    prebuildInstall,
    [
      '--runtime', 'electron', '--target', electronVersion, '--platform', 'win32',
      '--arch', arch, '--force', '--verbose',
    ],
    // prebuild-install derives the GitHub package name from cwd. Passing only
    // --path while staying at the workspace root incorrectly probes an
    // `openclaw-workbench` prebuild instead of better-sqlite3.
    {
      cwd: packagePath,
      envOverrides: { npm_config_cache: nativePrebuildCache },
    },
  );
  if (acquired.status !== 0) {
    const output = `${acquired.stdout}\n${acquired.stderr}`;
    const timedOut = /timed out|ETIMEDOUT/i.test(output) || acquired.timedOut;
    throw releaseFailure(
      timedOut ? 'WINDOWS_PREBUILD_NETWORK_TIMEOUT' : 'WINDOWS_PREBUILD_UNAVAILABLE',
      `electron=${electronVersion} arch=${arch}`,
      acquired,
      { timedOut },
    );
  }
  const prebuildEvidence = `${acquired.stdout}\n${acquired.stderr}`;
  if (!prebuildEvidence.includes(`electron-v${electronAbi}-win32-${arch}`)) {
    throw releaseFailure(
      'WINDOWS_PREBUILD_ABI_EVIDENCE_MISSING',
      `electron=${electronVersion} abi=${electronAbi} arch=${arch}`,
      acquired,
    );
  }
  const binary = path.join(packagePath, 'build/Release/better_sqlite3.node');
  const evidence = await inspectNative(binary, 'win32', arch);
  return { path: binary, sha256: evidence.sha256, stageRoot, evidence };
}

async function inspectNativeInsideWindowsArtifact(artifact, arch, expectedSha, expectedMainExecutable = null) {
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), `copilot-win-artifact-${arch}-`));
  try {
    const extracted = run(
      `inspect-${path.basename(artifact)}`,
      sevenZip,
      ['x', '-y', `-o${extractRoot}`, artifact],
      { cwd: repoRoot, allowedStatuses: [0] },
    );
    if (extracted.status !== 0) {
      throw releaseFailure('WINDOWS_ARTIFACT_EXTRACT_FAILED', artifact, extracted);
    }

    const releaseIdentity = await inspectWindowsArtifactReleaseIdentity({
      root: extractRoot,
      canonicalIdentity,
      expandPayload: async ({ archive: nestedArchive, destination, index }) => {
        const nested = run(
          `inspect-${path.basename(artifact)}-nested-${index}`,
          sevenZip,
          ['x', '-y', `-o${destination}`, nestedArchive],
          { cwd: repoRoot, allowedStatuses: [0] },
        );
        if (nested.status !== 0) {
          throw releaseFailure(
            'WINDOWS_NESTED_ARTIFACT_EXTRACT_FAILED',
            path.basename(artifact),
            nested,
          );
        }
      },
    });

    const expectedSuffix = path.join('resources', 'app.asar.unpacked', nativeRelative);
    const candidates = (await listFiles(extractRoot)).filter((entry) =>
      path.relative(extractRoot, entry).endsWith(expectedSuffix));
    if (candidates.length !== 1) {
      throw new Error(
        `WINDOWS_ARTIFACT_NATIVE_COUNT_INVALID: ${path.basename(artifact)} count=${candidates.length}`,
      );
    }
    const evidence = await inspectNative(candidates[0], 'win32', arch);
    if (evidence.sha256 !== expectedSha) {
      throw new Error(`WINDOWS_ARTIFACT_NATIVE_SHA_MISMATCH: ${path.basename(artifact)}`);
    }
    if (expectedMainExecutable) {
      const mainCandidates = (await listFiles(extractRoot)).filter((entry) => (
        path.basename(entry).toLowerCase() === expectedMainExecutable.relativePath.toLowerCase()
      ));
      if (mainCandidates.length !== 1) {
        throw Object.assign(
          new Error(
            `BLOCKED_WINDOWS_INNER_SIGNATURE_MISMATCH: ${path.basename(artifact)} main executable count=${mainCandidates.length}`,
          ),
          { code: 'BLOCKED_WINDOWS_INNER_SIGNATURE_MISMATCH' },
        );
      }
      const mainInfo = await stat(mainCandidates[0]);
      const actualMainExecutable = {
        relativePath: expectedMainExecutable.relativePath,
        sha256: await sha256(mainCandidates[0]),
        bytes: mainInfo.size,
        ...await verifyWindowsAuthenticode(
          mainCandidates[0],
          `win-${arch}-${path.basename(artifact)}-inner-signature`,
        ),
      };
      assertWindowsMainExecutableIdentity(actualMainExecutable, expectedMainExecutable);
    }
    return { ...evidence, releaseIdentity };
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

async function inspectNative(filePath, platform, arch) {
  await access(filePath);
  const fileResult = inspect('/usr/bin/file', [filePath], { cwd: repoRoot });
  const description = fileResult.stdout.trim();
  const expected = platform === 'win32'
    ? arch === 'x64' ? /PE32\+.*x86-64|PE32\+.*AMD64/i : /PE32\+.*ARM64|Aarch64/i
    : arch === 'x64' ? /Mach-O.*x86_64/i : /Mach-O.*arm64/i;
  if (!expected.test(description)) {
    throw new Error(`NATIVE_PLATFORM_MISMATCH: expected ${platform}/${arch}; got ${description}`);
  }
  return {
    platform,
    arch,
    electronVersion,
    targetAbi: electronAbi,
    verification: platform === 'darwin' ? 'runtime-smoke-and-static' : 'prebuild-target-static-and-artifact-sha',
    file: description,
    sha256: await sha256(filePath),
  };
}

async function writeBuilderConfig(label, output, { windowsMode = 'unsigned' } = {}) {
  const source = await readFile(path.join(buildDesktopRoot, 'electron-builder.yml'), 'utf8');
  const config = createWindowsBuilderConfig({
    baseConfig: parseYaml(source),
    output,
    mode: windowsMode,
    timestampUrl: windowsMode === 'distribution'
      ? signingProfile.windows.timestampUrl
      : undefined,
    signHookPath: windowsMode === 'distribution'
      ? path.join(buildDesktopRoot, 'scripts/electron-builder-windows-sign.cjs')
      : undefined,
  });
  const target = path.join(workDir, `electron-builder-${label}.json`);
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}

async function addArtifact(filePath, kind, platform, arch, signed, native, outerEvidence) {
  if (!outerEvidence || !Number.isSafeInteger(outerEvidence.bytes)
      || outerEvidence.bytes < 1 || !/^[a-f0-9]{64}$/.test(String(outerEvidence.sha256 ?? ''))) {
    throw Object.assign(new Error('BLOCKED_ARTIFACT_IDENTITY: stable outer artifact evidence is required'), {
      code: 'BLOCKED_ARTIFACT_IDENTITY',
    });
  }
  const artifact = {
    relativePath: path.relative(outputRoot, filePath),
    kind,
    platform,
    arch,
    bytes: outerEvidence.bytes,
    sha256: outerEvidence.sha256,
    signing: signed ? 'verified' : 'unsigned',
    native,
  };
  manifest.artifacts.push(artifact);
  if (!signed && !manifest.blockers.some((blocker) =>
    blocker.code === 'BLOCKED_UNSIGNED' && blocker.platform === platform && blocker.arch === arch)) {
    manifest.blockers.push({
      code: 'BLOCKED_UNSIGNED',
      platform,
      arch,
      message: 'Artifact signature is absent, ad-hoc, or not verifiable by the platform signing tool.',
    });
  }
  return artifact;
}

async function writeArtifactIdentityRecord(artifact, inspection) {
  if (!canonicalIdentity) {
    throw Object.assign(
      new Error('BLOCKED_ARTIFACT_IDENTITY: canonical identity was not initialized'),
      { code: 'BLOCKED_ARTIFACT_IDENTITY' },
    );
  }
  const record = buildArtifactIdentityRecord({
    candidate: manifest.candidate,
    sourceHead: manifest.source.head,
    sourceSnapshotSha256: manifest.source.snapshot.sha256,
    artifact,
    canonicalIdentity,
    inspection,
  });
  const reportRelativePath = `evidence/artifact-identity/${path.basename(artifact.relativePath)}.json`;
  const published = await publishArtifactIdentityRecordCrashSafe({
    target: path.join(outputRoot, reportRelativePath),
    record,
  });
  artifact.releaseIdentityVerification = {
    reportRelativePath,
    reportSha256: published.sha256,
  };
}

async function runArtifactIdentityGate() {
  try {
    await assertPrivateEvidenceAbsent(outputRoot);
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'BLOCKED_PRIVATE_REPLAY_LEAK') throw error;
    if (!manifest.blockers.some((existing) => existing.code === 'BLOCKED_PRIVATE_REPLAY_LEAK')) {
      manifest.blockers.push({
        code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
        message: 'Private replay evidence must remain outside candidate artifacts and delivery packages.',
      });
    }
  }
  const result = await evaluateArtifactIdentityEvidence({ candidateRoot: outputRoot, manifest });
  manifest.artifactIdentityGate = result;
  for (const blocker of result.blockers) {
    if (!manifest.blockers.some((existing) => existing.code === blocker.code)) {
      manifest.blockers.push(blocker);
    }
  }
}

function recordMacWorkCleanupFailure(error) {
  manifest.status = 'FAIL';
  const code = error && typeof error === 'object' && error.code === 'BLOCKED_MAC_WORK_CLEANUP'
    ? error.code
    : 'BLOCKED_MAC_WORK_CLEANUP';
  if (!manifest.blockers.some((existing) => existing.code === code)) {
    manifest.blockers.push(blockerFromError(code, undefined, error));
  }
}

async function sourceIdentity() {
  const head = inspect('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  if (head.status !== 0) throw new Error('GIT_HEAD_UNAVAILABLE');
  const diff = inspect('git', ['diff', '--binary', 'HEAD', '--', ...sourceScopes], {
    cwd: repoRoot,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (diff.status !== 0) throw new Error('GIT_DIFF_UNAVAILABLE');
  const untrackedResult = inspect(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', ...sourceScopes],
    { cwd: repoRoot },
  );
  const excludedDirtyPaths = untrackedResult.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => protectedNonReleasePaths.has(value))
    .sort();
  const untracked = untrackedResult.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value && !protectedNonReleasePaths.has(value))
    .sort();
  const hash = createHash('sha256').update(diff.stdout);
  for (const relative of untracked) {
    hash.update(`\0${relative}\0`);
    hash.update(await readFile(path.join(repoRoot, relative)));
  }
  const status = inspect(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...sourceScopes],
    { cwd: repoRoot },
  );
  const dirtyPaths = status.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => ![...protectedNonReleasePaths].some((excluded) => value.endsWith(excluded)));
  return {
    head: head.stdout.trim(),
    scope: sourceScopes,
    dirty: dirtyPaths.length > 0,
    dirtyDiffSha256: hash.digest('hex'),
    dirtyPaths,
    excludedDirtyPaths,
  };
}

function run(label, command, args, opts = {}) {
  const result = inspect(command, args, opts);
  const displayArgs = opts.displayArgs ?? args;
  let log = formatRedactedCommandLog({
    command,
    args,
    displayArgs,
    result,
    execution: executionEvidence(result),
  });
  for (const secret of opts.redactValues ?? []) {
    if (typeof secret === 'string' && secret.length > 0) log = log.split(secret).join('<redacted>');
  }
  const logPath = path.join(logsDir, `${safeLabel(label)}.log`);
  requireSyncWrite(logPath, log);
  const allowed = opts.allowedStatuses ?? [0];
  if (!allowed.includes(result.status)) {
    process.stderr.write(`${label} failed; see ${logPath}\n`);
  }
  return result;
}

function windowsSigningRedactValues() {
  if (signingProfile.mode !== 'distribution') return [];
  return [
    signingProfile.windows.cscLink,
    signingProfile.windows.cscPassword,
    signingProfile.windows.timestampUrl,
  ];
}

function inspect(command, args, opts = {}) {
  const env = resolveReleaseChildEnvironment({
    scope: opts.childEnvironment ?? 'default',
    cleanEnvironment: unsignedBuilderEnvironment,
    windowsBuilderEnvironment,
    overrides: opts.envOverrides ?? {},
  });
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? repoRoot,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    timeout: opts.timeout ?? 30 * 60 * 1000,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error ? {
      name: result.error.name,
      code: result.error.code ?? null,
      message: result.error.message,
      errno: result.error.errno ?? null,
      syscall: result.error.syscall ?? null,
    } : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error?.message ?? ''),
  };
}

function executionEvidence(result, overrides = {}) {
  return {
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    timedOut: overrides.timedOut ?? result?.timedOut ?? false,
    error: result?.error ?? null,
  };
}

function releaseFailure(failureCode, message, result, overrides) {
  return new ReleaseFailure(failureCode, message, result, overrides);
}

function blockerFromError(code, arch, error) {
  const blocker = {
    code,
    arch,
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof ReleaseFailure) {
    blocker.failureCode = error.failureCode;
    blocker.execution = error.execution;
    if (error.causeExecution) blocker.causeExecution = error.causeExecution;
  }
  return blocker;
}

function parseNestedSpawnEvidence(value) {
  for (const line of value.split('\n')) {
    if (!line.includes('_FAILED: {')) continue;
    const start = line.indexOf('{');
    try {
      const parsed = JSON.parse(line.slice(start));
      if ('exitCode' in parsed && 'signal' in parsed && 'timedOut' in parsed) return parsed;
    } catch {
      // Keep scanning; the outer structured execution evidence remains valid.
    }
  }
  return null;
}

function requireSyncWrite(target, value) {
  writeFileSync(target, value, 'utf8');
}

async function atomicCopy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.candidate-${process.pid}-${Date.now()}`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function atomicJson(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function logText(label, value) {
  await writeFile(path.join(logsDir, `${safeLabel(label)}.log`), `${value}\n`, 'utf8');
}

async function writeInstallGuide() {
  const statusLine = manifest.status === 'PASS'
    ? 'All canonical artifacts passed their declared static/runtime gates.'
    : `Candidate is not complete: ${manifest.blockers.map((blocker) => `${blocker.code}(${blocker.arch ?? 'all'})`).join(', ')}.`;
  const artifacts = manifest.artifacts.length
    ? manifest.artifacts.map((artifact) => `- \`${artifact.relativePath}\` — ${artifact.platform}/${artifact.arch}, SHA256 \`${artifact.sha256}\`, signing: ${artifact.signing}`).join('\n')
    : '- No installable artifacts were completed.';
  const postPackageStatus = manifest.postPackageGates.status;
  const macOnly = signingProfile.mode === 'macos-distribution';
  const windowsInstall = macOnly
    ? '- Windows: OWNER_DEFERRED to Phase 1.1; this candidate contains and claims no Windows artifact.'
    : '- Windows: run the architecture-matching setup or portable executable. Unsigned builds may trigger SmartScreen.';
  const nativeBoundary = macOnly
    ? `macOS native modules are rebuilt and runtime-smoked under Electron ${electronVersion} ABI ${electronAbi}. Windows native packaging is OWNER_DEFERRED to Phase 1.1.`
    : `macOS native modules are rebuilt and runtime-smoked under Electron ${electronVersion} ABI ${electronAbi}. Windows native modules are accepted only when a win32 prebuild for the exact Electron target is found, statically identified as PE for the target architecture, patched into unpacked app staging, and re-extracted from each final artifact with matching SHA.`;
  const evidenceContract = macOnly
    ? 'schemaVersion 2 and exact releaseMode macos-distribution, the exact candidate name, source HEAD, source snapshot SHA256, the complete four-artifact macOS SHA256 map, and hashed evidence references for: >=50 real packaged Electron E2E on darwin, candidate-bound performance, >=9 macOS screenshots, >=3 verify-fix rounds, macOS signing/notarization, darwin runtime, north-star/private replay, and PM trust'
    : 'schemaVersion 1, the exact candidate name, source HEAD, source snapshot SHA256, the complete artifact SHA256 map, and hashed evidence references for: packaged Electron E2E (>=50, macOS + Windows), performance, 9+9 screenshots with 3 verify-fix rounds, signing/notarization, and macOS + Windows runtime';
  const text = `# NJX Copilot v6.2 Phase 1 candidate\n\n${statusLine}\n\n## Install\n\n${artifacts}\n\n- macOS: open the DMG or unzip the ZIP, then move the app manually. This pipeline never copies to /Applications.\n${windowsInstall}\n- Verify every artifact against CANONICAL-MANIFEST.json before installation.\n\n## Native module boundary\n\n${nativeBoundary}\n\n## Post-package acceptance\n\nStatus: **${postPackageStatus}**. Packaging alone cannot produce a release PASS. Use \`--external-evidence <json>\` with ${evidenceContract}. Missing, stale, self-asserted, or hash-mismatched evidence remains blocking.\n`;
  await writeFile(path.join(outputRoot, 'INSTALL.md'), text, 'utf8');
}

async function findFirst(root, predicate) {
  if (!existsSync(root)) return null;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (predicate(target)) return target;
    if (entry.isDirectory()) {
      const nested = await findFirst(target, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

async function listFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(target));
    else output.push(target);
  }
  return output;
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function safeLabel(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseArgs(args) {
  const parsed = { signingMode: parseSigningModeArgs(args) };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output') parsed.output = requiredArgValue(args, ++index, '--output');
    else if (args[index] === '--external-evidence') {
      parsed.externalEvidence = requiredArgValue(args, ++index, '--external-evidence');
    }
    else if (args[index] === '--signing-mode') {
      requiredArgValue(args, ++index, '--signing-mode');
    }
    else throw new Error(`UNKNOWN_ARGUMENT: ${args[index]}`);
  }
  return parsed;
}

function requiredArgValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`MISSING_ARGUMENT_VALUE: ${flag}`);
  return value;
}
