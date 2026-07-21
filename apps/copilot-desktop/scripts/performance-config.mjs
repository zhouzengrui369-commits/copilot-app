import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KG_COMPONENT_RELATIVE_PATH = 'src/renderer/components/KnowledgeGraph/index.tsx';

export const STARTUP_MILESTONE_NAMES = Object.freeze([
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
]);

export const STARTUP_MILESTONE_VALIDATION_PROFILES = Object.freeze({
  FIXED_NULL_COMPATIBLE_V1: 'fixed-null-compatible-v1',
  R22_DIRECT_TERMINAL_V1: 'r22-direct-terminal-v1',
});

const STARTUP_NULL_REASONS = Object.freeze({
  processStart: Object.freeze([]),
  appWhenReady: Object.freeze(['not-reached']),
  releaseIdentityStart: Object.freeze(['not-reached', 'development-runtime']),
  releaseIdentityEnd: Object.freeze([
    'not-reached',
    'development-runtime',
    'release-identity-unavailable',
  ]),
  directProbeInitStart: Object.freeze(['not-reached', 'direct-performance-mode-disabled']),
  directProbeInitEnd: Object.freeze(['not-reached', 'direct-performance-mode-disabled']),
  windowCreateStart: Object.freeze(['not-reached']),
  windowCreated: Object.freeze(['not-reached']),
  rendererLoadStart: Object.freeze(['not-reached']),
  domReady: Object.freeze(['not-reached']),
  readyToShow: Object.freeze(['not-reached', 'ready-to-show-event-not-observed']),
  rendererShellCommit: Object.freeze(['not-reached']),
  appRootVisible: Object.freeze(['not-reached']),
  terminalReady: Object.freeze(['not-reached']),
});

const STARTUP_CAUSAL_PAIRS = Object.freeze([
  Object.freeze(['processStart', 'appWhenReady']),
  Object.freeze(['appWhenReady', 'releaseIdentityStart']),
  Object.freeze(['releaseIdentityStart', 'releaseIdentityEnd']),
  Object.freeze(['appWhenReady', 'directProbeInitStart']),
  Object.freeze(['directProbeInitStart', 'directProbeInitEnd']),
  Object.freeze(['appWhenReady', 'windowCreateStart']),
  Object.freeze(['windowCreateStart', 'windowCreated']),
  Object.freeze(['windowCreated', 'rendererLoadStart']),
  Object.freeze(['rendererLoadStart', 'domReady']),
  Object.freeze(['rendererLoadStart', 'readyToShow']),
  Object.freeze(['rendererLoadStart', 'rendererShellCommit']),
  Object.freeze(['rendererShellCommit', 'appRootVisible']),
  Object.freeze(['releaseIdentityEnd', 'terminalReady']),
  Object.freeze(['directProbeInitEnd', 'terminalReady']),
  Object.freeze(['windowCreated', 'terminalReady']),
  Object.freeze(['appRootVisible', 'terminalReady']),
]);

export function createStartupMilestoneReport(
  input,
  profile = STARTUP_MILESTONE_VALIDATION_PROFILES.FIXED_NULL_COMPATIBLE_V1,
) {
  if (
    profile !== STARTUP_MILESTONE_VALIDATION_PROFILES.FIXED_NULL_COMPATIBLE_V1
    && profile !== STARTUP_MILESTONE_VALIDATION_PROFILES.R22_DIRECT_TERMINAL_V1
  ) {
    blocked('BLOCKED_STARTUP_MILESTONES_PROFILE', 'Startup milestone validation profile is invalid');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    blocked('BLOCKED_STARTUP_MILESTONES_INVALID', 'Startup milestones must be a fixed object');
  }
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !STARTUP_MILESTONE_NAMES.includes(key));
  const missing = STARTUP_MILESTONE_NAMES.filter((key) => !Object.hasOwn(input, key));
  if (unknown.length > 0) {
    blocked('BLOCKED_STARTUP_MILESTONES_PRIVACY', `Unknown milestone keys are forbidden: ${unknown.join(',')}`);
  }
  if (missing.length > 0) {
    blocked('BLOCKED_STARTUP_MILESTONES_INCOMPLETE', `Missing startup milestones: ${missing.join(',')}`);
  }

  const milestones = {};
  for (const name of STARTUP_MILESTONE_NAMES) {
    const value = input[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      blocked('BLOCKED_STARTUP_MILESTONES_INVALID', `${name} must contain offsetMs and reason`);
    }
    const valueKeys = Object.keys(value);
    if (
      valueKeys.length !== 2
      || !Object.hasOwn(value, 'offsetMs')
      || !Object.hasOwn(value, 'reason')
    ) {
      blocked('BLOCKED_STARTUP_MILESTONES_PRIVACY', `${name} may contain only offsetMs and reason`);
    }
    const { offsetMs, reason } = value;
    if (offsetMs === null) {
      if (
        typeof reason !== 'string'
        || !STARTUP_NULL_REASONS[name].includes(reason)
      ) {
        blocked('BLOCKED_STARTUP_MILESTONES_NULL_REASON', `${name} null offset requires a fixed reason`);
      }
      milestones[name] = { offsetMs: null, reason };
      continue;
    }
    if (!Number.isFinite(offsetMs) || offsetMs < 0 || reason !== null) {
      blocked('BLOCKED_STARTUP_MILESTONES_INVALID', `${name} reached offset must be finite, non-negative, and have null reason`);
    }
    milestones[name] = { offsetMs, reason: null };
  }

  const strictR22Direct = profile
    === STARTUP_MILESTONE_VALIDATION_PROFILES.R22_DIRECT_TERMINAL_V1;
  for (const [startName, endName] of STARTUP_CAUSAL_PAIRS) {
    const start = milestones[startName].offsetMs;
    const end = milestones[endName].offsetMs;
    if (strictR22Direct && start === null && end !== null) {
      blocked(
        'BLOCKED_STARTUP_MILESTONES_CAUSAL',
        `${endName} is reached while its causal milestone ${startName} is not reached`,
      );
    }
    if (start !== null && end !== null && end < start) {
      blocked(
        'BLOCKED_STARTUP_MILESTONES_CAUSAL',
        `${endName} precedes its causal milestone ${startName}`,
      );
    }
  }

  if (strictR22Direct) {
    for (const name of STARTUP_MILESTONE_NAMES) {
      const milestone = milestones[name];
      if (name === 'readyToShow') {
        if (
          milestone.offsetMs === null
          && milestone.reason !== 'ready-to-show-event-not-observed'
        ) {
          blocked(
            'BLOCKED_STARTUP_MILESTONES_STRICT_TERMINAL_PATH',
            'readyToShow may be null only when the fixed event-not-observed reason is recorded',
          );
        }
        continue;
      }
      if (milestone.offsetMs === null || milestone.reason !== null) {
        blocked(
          'BLOCKED_STARTUP_MILESTONES_STRICT_TERMINAL_PATH',
          `${name} must be reached in the r22 direct terminal profile`,
        );
      }
    }
  }

  return {
    clock: 'candidate-process-monotonic-diagnostic-only',
    milestones,
  };
}

export function isStartupLaunchComplete({ nativeWindowVisible, appRootVisible } = {}) {
  return nativeWindowVisible === true && appRootVisible === true;
}

export function createStartupCandidateBinding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', 'Candidate binding must be an object');
  }
  const expectedKeys = ['candidate', 'executable', 'appAsar', 'releaseIdentity', 'sourceSnapshot'];
  const unknown = Object.keys(input).filter((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.filter((key) => !Object.hasOwn(input, key));
  if (unknown.length > 0 || missing.length > 0) {
    blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', 'Candidate binding requires exactly four artifacts');
  }
  if (
    typeof input.candidate !== 'string'
    || !/^v6\.2-phase1-candidate-r\d+$/.test(input.candidate)
  ) {
    blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', 'Candidate id is invalid');
  }

  const result = { candidate: input.candidate };
  for (const key of expectedKeys.slice(1)) {
    const artifact = input[key];
    if (
      !artifact
      || typeof artifact !== 'object'
      || Array.isArray(artifact)
      || typeof artifact.basename !== 'string'
      || artifact.basename.length === 0
      || artifact.basename !== path.basename(artifact.basename)
      || !Number.isSafeInteger(artifact.bytes)
      || artifact.bytes < 0
      || typeof artifact.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', `${key} binding is invalid`);
    }
    result[key] = {
      basename: artifact.basename,
      pathScope: 'host-local-redacted',
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    };
  }
  return result;
}

const SNAPSHOT_AGGREGATE_ALGORITHM = 'sha256-null-delimited-relative-path-and-bytes-v1';

export async function bindAuthoritativeSnapshotFileSet({ snapshotRoot, manifest }) {
  validateAuthoritativeSnapshotManifest(manifest);
  let realRoot;
  try {
    realRoot = await realpath(snapshotRoot);
  } catch (error) {
    blocked(
      'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED',
      `Authoritative snapshot root is unavailable (${error?.code ?? 'unknown'})`,
    );
  }

  const aggregate = createHash('sha256');
  const seenLogicalPaths = new Set();
  const seenResolvedPaths = new Set();
  const seenFileIdentities = new Set();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    validateAuthoritativeSnapshotEntry(entry);
    if (seenLogicalPaths.has(entry.relativePath)) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Duplicate logical snapshot path');
    }
    seenLogicalPaths.add(entry.relativePath);
    const target = path.resolve(snapshotRoot, ...entry.relativePath.split('/'));
    if (!isWithin(snapshotRoot, target)) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Snapshot entry escapes its root');
    }

    let targetLstat;
    let resolvedTarget;
    try {
      targetLstat = await lstat(target);
      resolvedTarget = await realpath(target);
    } catch (error) {
      blocked(
        'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED',
        `Authoritative snapshot input is unavailable (${error?.code ?? 'unknown'})`,
      );
    }
    if (targetLstat.isSymbolicLink() || !targetLstat.isFile() || !isWithin(realRoot, resolvedTarget)) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Snapshot entry is not a contained regular file');
    }
    if (seenResolvedPaths.has(resolvedTarget)) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Duplicate resolved snapshot path');
    }
    seenResolvedPaths.add(resolvedTarget);

    let handle;
    let contents;
    let before;
    let after;
    try {
      handle = await open(target, 'r');
      before = await handle.stat();
      contents = await handle.readFile();
      after = await handle.stat();
    } catch (error) {
      blocked(
        'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED',
        `Cannot bind authoritative snapshot input (${error?.code ?? 'unknown'})`,
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
    const fileIdentity = `${before.dev}:${before.ino}`;
    if (seenFileIdentities.has(fileIdentity)) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Duplicate snapshot file identity');
    }
    seenFileIdentities.add(fileIdentity);
    const actualSha256 = createHash('sha256').update(contents).digest('hex');
    if (
      before.size !== after.size
      || before.dev !== after.dev
      || before.ino !== after.ino
      || contents.byteLength !== entry.bytes
      || actualSha256 !== entry.sha256
    ) {
      blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED', 'Authoritative snapshot input changed');
    }
    totalBytes += contents.byteLength;
    aggregate.update(`\0${entry.relativePath}\0`);
    aggregate.update(contents);
  }

  const aggregateSha256 = aggregate.digest('hex');
  if (
    manifest.fileCount !== manifest.entries.length
    || aggregateSha256 !== manifest.aggregateSha256
  ) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Snapshot manifest aggregate is invalid');
  }
  return {
    algorithm: SNAPSHOT_AGGREGATE_ALGORITHM,
    fileCount: manifest.fileCount,
    bytes: totalBytes,
    sha256: aggregateSha256,
  };
}

function validateAuthoritativeSnapshotManifest(manifest) {
  const keys = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? Object.keys(manifest)
    : [];
  const expectedKeys = ['schemaVersion', 'algorithm', 'fileCount', 'aggregateSha256', 'entries'];
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(manifest, key))
    || manifest.schemaVersion !== 1
    || manifest.algorithm !== SNAPSHOT_AGGREGATE_ALGORITHM
    || !Number.isSafeInteger(manifest.fileCount)
    || manifest.fileCount < 1
    || typeof manifest.aggregateSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(manifest.aggregateSha256)
    || !Array.isArray(manifest.entries)
    || manifest.entries.length !== manifest.fileCount
  ) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Authoritative snapshot manifest is invalid');
  }
  const paths = manifest.entries.map((entry) => entry?.relativePath);
  const sorted = [...paths].sort(compareLogicalPaths);
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Snapshot entries must be sorted');
  }
}

function compareLogicalPaths(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function validateAuthoritativeSnapshotEntry(entry) {
  const keys = entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.keys(entry)
    : [];
  const expectedKeys = ['relativePath', 'bytes', 'sha256'];
  const relativePath = entry?.relativePath;
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(entry, key))
    || typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || relativePath.normalize('NFC') !== relativePath
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || !Number.isSafeInteger(entry.bytes)
    || entry.bytes < 0
    || typeof entry.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.sha256)
  ) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Snapshot entry is invalid or noncanonical');
  }
}

export function resolveStartupCandidateBindingConfig({ env }) {
  const candidate = env.COPILOT_PERF_CANDIDATE_ID;
  if (typeof candidate !== 'string' || !/^v6\.2-phase1-candidate-r\d+$/.test(candidate)) {
    blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', 'COPILOT_PERF_CANDIDATE_ID is required');
  }
  const requiredPath = (envName) => {
    const filePath = optionalAbsolutePath(env[envName], 'BLOCKED_STARTUP_CANDIDATE_BINDING');
    if (!filePath) blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', `${envName} is required`);
    validateFile(
      filePath,
      'BLOCKED_STARTUP_CANDIDATE_BINDING',
      'BLOCKED_STARTUP_CANDIDATE_BINDING',
    );
    return filePath;
  };
  return {
    candidate,
    executablePath: requiredPath('COPILOT_PERF_EXECUTABLE_PATH'),
    appAsarPath: requiredPath('COPILOT_PERF_APP_ASAR_PATH'),
    releaseIdentityPath: requiredPath('COPILOT_PERF_RELEASE_IDENTITY_PATH'),
    canonicalManifestPath: requiredPath('COPILOT_PERF_CANONICAL_MANIFEST_PATH'),
    sourceSnapshotRoot: (() => {
      const root = optionalAbsolutePath(
        env.COPILOT_PERF_SOURCE_ROOT,
        'BLOCKED_STARTUP_CANDIDATE_BINDING',
      );
      if (!root) blocked('BLOCKED_STARTUP_CANDIDATE_BINDING', 'COPILOT_PERF_SOURCE_ROOT is required');
      validateDirectory(
        root,
        'BLOCKED_STARTUP_CANDIDATE_BINDING',
        'BLOCKED_STARTUP_CANDIDATE_BINDING',
      );
      return root;
    })(),
  };
}

export async function bindStartupCandidateArtifacts(config) {
  const [executable, appAsar, releaseIdentity, canonicalManifest] = await Promise.all([
    bindFile(config.executablePath),
    bindFile(config.appAsarPath),
    bindFile(config.releaseIdentityPath),
    bindFile(config.canonicalManifestPath),
  ]).catch((error) => {
    blocked(
      'BLOCKED_STARTUP_CANDIDATE_BINDING',
      `Unable to bind candidate artifacts (${error?.code ?? 'unknown'})`,
    );
  });

  let releaseIdentityDocument;
  let canonicalManifestDocument;
  try {
    releaseIdentityDocument = JSON.parse(await readFile(config.releaseIdentityPath, 'utf8'));
    canonicalManifestDocument = JSON.parse(await readFile(config.canonicalManifestPath, 'utf8'));
  } catch (error) {
    blocked(
      'BLOCKED_STARTUP_CANDIDATE_BINDING',
      `Candidate identity JSON is unreadable (${error?.code ?? 'invalid-json'})`,
    );
  }
  const snapshot = canonicalManifestDocument?.source?.snapshot;
  const authoritativeInputs = snapshot?.authoritativeInputs;
  if (
    releaseIdentityDocument?.candidate !== config.candidate
    || canonicalManifestDocument?.candidate !== config.candidate
    || typeof snapshot?.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(snapshot.sha256)
    || !Number.isSafeInteger(snapshot.fileCount)
    || snapshot.fileCount < 1
    || releaseIdentityDocument?.sourceSnapshotSha256 !== snapshot.sha256
    || !authoritativeInputs
    || typeof authoritativeInputs.relativePath !== 'string'
    || !Number.isSafeInteger(authoritativeInputs.bytes)
    || authoritativeInputs.bytes < 1
    || typeof authoritativeInputs.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(authoritativeInputs.sha256)
    || authoritativeInputs.fileCount !== snapshot.fileCount
    || authoritativeInputs.aggregateSha256 !== snapshot.sha256
  ) {
    blocked(
      'BLOCKED_STARTUP_CANDIDATE_BINDING',
      'Candidate, release identity, and source snapshot do not agree',
    );
  }

  const authoritativeManifestPath = resolveBoundCandidatePath(
    path.dirname(config.canonicalManifestPath),
    authoritativeInputs.relativePath,
  );
  let authoritativeManifestBinding;
  let authoritativeManifestDocument;
  try {
    authoritativeManifestBinding = await bindFile(authoritativeManifestPath);
    if (
      authoritativeManifestBinding.bytes !== authoritativeInputs.bytes
      || authoritativeManifestBinding.sha256 !== authoritativeInputs.sha256
    ) {
      blocked(
        'BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST',
        'Authoritative snapshot manifest does not match canonical binding',
      );
    }
    authoritativeManifestDocument = JSON.parse(
      await readFile(authoritativeManifestPath, 'utf8'),
    );
  } catch (error) {
    if (isBlocker(error)) throw error;
    blocked(
      'BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST',
      `Authoritative snapshot manifest is unreadable (${error?.code ?? 'invalid-json'})`,
    );
  }
  const actualSnapshot = await bindAuthoritativeSnapshotFileSet({
    snapshotRoot: config.sourceSnapshotRoot,
    manifest: authoritativeManifestDocument,
  });
  if (
    actualSnapshot.fileCount !== snapshot.fileCount
    || actualSnapshot.sha256 !== snapshot.sha256
  ) {
    blocked(
      'BLOCKED_STARTUP_SOURCE_SNAPSHOT_CHANGED',
      'Actual snapshot input set does not match canonical source identity',
    );
  }

  const binding = createStartupCandidateBinding({
    candidate: config.candidate,
    executable: { basename: path.basename(executable.path), bytes: executable.bytes, sha256: executable.sha256 },
    appAsar: { basename: path.basename(appAsar.path), bytes: appAsar.bytes, sha256: appAsar.sha256 },
    releaseIdentity: {
      basename: path.basename(releaseIdentity.path),
      bytes: releaseIdentity.bytes,
      sha256: releaseIdentity.sha256,
    },
    sourceSnapshot: {
      basename: 'source-snapshot',
      bytes: actualSnapshot.bytes,
      sha256: actualSnapshot.sha256,
    },
  });
  binding.sourceSnapshot.fileCount = actualSnapshot.fileCount;
  binding.sourceSnapshot.algorithm = actualSnapshot.algorithm;
  binding.sourceSnapshot.manifest = {
    basename: path.basename(authoritativeManifestBinding.path),
    pathScope: 'host-local-redacted',
    bytes: authoritativeManifestBinding.bytes,
    sha256: authoritativeManifestBinding.sha256,
  };
  binding.sourceSnapshot.canonicalManifest = {
    basename: path.basename(canonicalManifest.path),
    pathScope: 'host-local-redacted',
    bytes: canonicalManifest.bytes,
    sha256: canonicalManifest.sha256,
  };
  return binding;
}

export function aggregateStartupRuns(runs) {
  if (!Array.isArray(runs) || runs.length !== 3) {
    blocked('BLOCKED_STARTUP_AGGREGATE_RUN_COUNT', 'Startup aggregate requires exactly three raw runs');
  }
  const rawRuns = runs.map((run) => {
    if (
      !run
      || typeof run !== 'object'
      || typeof run.raw !== 'string'
      || run.raw.length === 0
      || run.raw !== path.basename(run.raw)
      || !Number.isFinite(run.outerControllerLaunchMs)
      || run.outerControllerLaunchMs < 0
    ) {
      blocked('BLOCKED_STARTUP_AGGREGATE_RUN_INVALID', 'Each raw run needs a safe basename and outer duration');
    }
    return { raw: run.raw, outerControllerLaunchMs: run.outerControllerLaunchMs };
  });
  const durations = rawRuns
    .map((run) => run.outerControllerLaunchMs)
    .sort((left, right) => left - right);
  const thresholdExclusiveMs = 2_000;
  return {
    runCount: rawRuns.length,
    rawRuns,
    medianOuterControllerLaunchMs: durations[1],
    maxOuterControllerLaunchMs: durations[2],
    thresholdExclusiveMs,
    pass: rawRuns.every((run) => run.outerControllerLaunchMs < thresholdExclusiveMs),
  };
}

export function resolvePerformanceConfig({ env, appRoot, repoRoot }) {
  const executablePath = optionalAbsolutePath(
    env.COPILOT_PERF_EXECUTABLE_PATH,
    'BLOCKED_ELECTRON_PERF_EXECUTABLE_PATH_NOT_ABSOLUTE',
  );
  if (executablePath) validateFile(
    executablePath,
    'BLOCKED_ELECTRON_PERF_EXECUTABLE_PATH_MISSING',
    'BLOCKED_ELECTRON_PERF_EXECUTABLE_PATH_NOT_FILE',
  );

  const configuredSourceRoot = optionalAbsolutePath(
    env.COPILOT_PERF_SOURCE_ROOT,
    'BLOCKED_ELECTRON_PERF_SOURCE_ROOT_NOT_ABSOLUTE',
  );
  if (configuredSourceRoot) validateDirectory(
    configuredSourceRoot,
    'BLOCKED_ELECTRON_PERF_SOURCE_ROOT_MISSING',
    'BLOCKED_ELECTRON_PERF_SOURCE_ROOT_NOT_DIRECTORY',
  );
  const harnessAppRoot = configuredSourceRoot
    ? path.join(configuredSourceRoot, 'apps/copilot-desktop')
    : appRoot;
  const componentPath = path.join(harnessAppRoot, KG_COMPONENT_RELATIVE_PATH);
  if (configuredSourceRoot && !isFile(componentPath)) {
    blocked(
      'BLOCKED_ELECTRON_PERF_HARNESS_COMPONENT_MISSING',
      `Expected immutable harness component at ${componentPath}`,
    );
  }

  const configuredOutputPath = optionalAbsolutePath(
    env.COPILOT_PERF_OUTPUT_PATH,
    'BLOCKED_ELECTRON_PERF_OUTPUT_PATH_NOT_ABSOLUTE',
  );
  if (configuredOutputPath && existsSync(configuredOutputPath)) {
    blocked(
      'BLOCKED_ELECTRON_PERF_OUTPUT_PATH_ALREADY_EXISTS',
      `Refusing to overwrite ${configuredOutputPath}`,
    );
  }

  return {
    appRoot,
    repoRoot,
    runtimeMode: executablePath ? 'packaged' : 'development',
    executablePath,
    skipBuild: env.COPILOT_PERF_SKIP_BUILD === '1',
    harnessSourceMode: configuredSourceRoot
      ? 'snapshot-component-with-resolved-installed-inputs'
      : 'live-component-with-resolved-installed-inputs',
    harnessSourceRoot: configuredSourceRoot ?? appRoot,
    harnessAppRoot,
    componentPath,
    outputPath: configuredOutputPath ?? path.join(appRoot, 'test-results/performance.json'),
    outputMode: configuredOutputPath ? 'external-non-overwriting' : 'default',
  };
}

export function createElectronLaunchTarget(config, userDataPath) {
  const args = [`--user-data-dir=${userDataPath}`];
  if (config.runtimeMode === 'packaged') {
    return { executablePath: config.executablePath, args };
  }
  return { args: [config.appRoot, ...args] };
}

export async function bindExecutable(executablePath) {
  let handle;
  try {
    handle = await open(executablePath, 'r');
    const before = await handle.stat();
    const hash = createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size) {
      blocked(
        'BLOCKED_ELECTRON_PERF_EXECUTABLE_CHANGED',
        `Executable size changed while binding ${path.basename(executablePath)}`,
      );
    }
    return { path: executablePath, bytes: before.size, sha256: hash.digest('hex') };
  } catch (error) {
    if (isBlocker(error)) throw error;
    blocked(
      'BLOCKED_ELECTRON_PERF_EXECUTABLE_BINDING_FAILED',
      `Cannot bind ${executablePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function verifyExecutableBinding(executablePath, expectedBinding) {
  let actualBinding;
  try {
    actualBinding = await bindExecutable(executablePath);
  } catch (error) {
    blocked(
      'BLOCKED_ELECTRON_PERF_EXECUTABLE_CHANGED',
      `Executable unavailable during post-measure verification: ${path.basename(executablePath)} (${error?.code ?? 'unknown'})`,
    );
  }
  if (
    actualBinding.bytes !== expectedBinding.bytes
    || actualBinding.sha256 !== expectedBinding.sha256
  ) {
    blocked(
      'BLOCKED_ELECTRON_PERF_EXECUTABLE_CHANGED',
      `Executable changed after launch binding: ${path.basename(executablePath)}`,
    );
  }
  return actualBinding;
}

export function bindEmittedBuildOutputs(outputFiles) {
  if (!Array.isArray(outputFiles) || outputFiles.length === 0) {
    blocked('BLOCKED_ELECTRON_PERF_HARNESS_BUILD_BINDING', 'esbuild returned no output bytes');
  }
  const files = outputFiles.map((outputFile) => {
    const basename = path.basename(outputFile.path);
    const contents = Buffer.from(outputFile.contents);
    return {
      basename,
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  }).sort((left, right) => left.basename.localeCompare(right.basename));
  if (new Set(files.map((file) => file.basename)).size !== files.length) {
    blocked('BLOCKED_ELECTRON_PERF_HARNESS_BUILD_BINDING', 'esbuild output basenames are not unique');
  }
  return {
    authority: 'authoritative-executed-build-artifacts',
    source: 'esbuild-returned-output-bytes',
    files,
    digest: digestBindings(files.map((file) => ({ ...file, logicalPath: file.basename }))),
  };
}

export async function writeEmittedBuildOutputs(root, outputFiles) {
  await mkdir(root, { recursive: true });
  const binding = bindEmittedBuildOutputs(outputFiles);
  const bytesByBasename = new Map(
    outputFiles.map((outputFile) => [path.basename(outputFile.path), outputFile.contents]),
  );
  await Promise.all(binding.files.map((file) => (
    writeFile(path.join(root, file.basename), bytesByBasename.get(file.basename), { flag: 'wx' })
  )));
  return binding;
}

export async function verifyEmittedBuildOutputs(root, expectedBinding) {
  try {
    const outputFiles = await Promise.all(expectedBinding.files.map(async (file) => ({
      path: path.join(root, file.basename),
      contents: await readFile(path.join(root, file.basename)),
    })));
    const actualBinding = bindEmittedBuildOutputs(outputFiles);
    if (
      actualBinding.digest !== expectedBinding.digest
      || JSON.stringify(actualBinding.files) !== JSON.stringify(expectedBinding.files)
    ) {
      blocked('BLOCKED_ELECTRON_PERF_HARNESS_CHANGED', 'Emitted harness artifacts changed after build');
    }
    return expectedBinding;
  } catch (error) {
    if (error?.code === 'BLOCKED_ELECTRON_PERF_HARNESS_CHANGED') throw error;
    blocked(
      'BLOCKED_ELECTRON_PERF_HARNESS_CHANGED',
      `Cannot verify emitted harness artifacts (${error?.code ?? 'unknown'})`,
    );
  }
}

export async function createPerformanceTempWorkspace(tempBase, makeTemp = mkdtemp) {
  let tempRoot;
  try {
    tempRoot = await makeTemp(path.join(tempBase, 'copilot-kg100-perf-'));
    const userData = await makeTemp(path.join(tempBase, 'copilot-electron-perf-'));
    return { tempRoot, userData };
  } catch (error) {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function bindHarnessProvenance({
  inputPaths,
  componentPath,
  sourceRoot,
  generatedEntry,
}) {
  const uniqueInputs = [...new Set(inputPaths.map((inputPath) => path.resolve(inputPath)))];
  const boundInputs = await Promise.all(uniqueInputs.map(async (inputPath) => {
    const binding = await bindFile(inputPath);
    return {
      ...binding,
      logicalPath: logicalBuildInputPath(inputPath, componentPath, sourceRoot),
      dependency: isDependencyInput(inputPath),
    };
  }));
  const componentInput = boundInputs.find((input) => path.resolve(input.path) === path.resolve(componentPath));
  if (!componentInput) {
    blocked(
      'BLOCKED_ELECTRON_PERF_HARNESS_COMPONENT_NOT_IN_BUILD',
      'The configured KnowledgeGraph component was not present in esbuild inputs',
    );
  }
  const dependencyInputs = boundInputs.filter((input) => input.dependency);
  const packageLockPath = path.join(sourceRoot, 'package-lock.json');
  const packageLock = existsSync(packageLockPath) ? await bindFile(packageLockPath) : undefined;
  const candidateComponent = componentInput.logicalPath.startsWith('apps/copilot-desktop/');
  const generatedEntryBinding = generatedEntry === undefined
    ? undefined
    : validateGeneratedEntryBinding(generatedEntry);
  const buildInputBindings = generatedEntryBinding
    ? [
        ...boundInputs,
        {
          logicalPath: generatedEntryBinding.logicalName,
          bytes: generatedEntryBinding.bytes,
          sha256: generatedEntryBinding.sha256,
        },
      ]
    : boundInputs;

  return {
    authority: 'non-authoritative-post-build-provenance',
    note: 'Inputs were re-read after build and are not claimed as the exact bytes consumed by esbuild',
    component: {
      source: candidateComponent ? 'candidate-snapshot' : 'live-repo',
      logicalPath: componentInput.logicalPath,
      bytes: componentInput.bytes,
      sha256: componentInput.sha256,
    },
    dependencies: {
      source: 'resolved-installed-inputs',
      inputCount: dependencyInputs.length,
      digest: digestBindings(dependencyInputs),
    },
    buildInputs: {
      inputCount: buildInputBindings.length,
      digest: digestBindings(buildInputBindings),
      ...(generatedEntryBinding ? { generatedEntry: generatedEntryBinding } : {}),
    },
    snapshotPackageLock: packageLock
      ? { present: true, bytes: packageLock.bytes, sha256: packageLock.sha256 }
      : { present: false },
  };
}

export function createPublicEvidenceContext(config, executableBinding, harnessBinding) {
  return {
    runtime: {
      mode: config.runtimeMode,
      launchBinding: config.runtimeMode === 'packaged' ? 'executablePath' : 'development-app-root',
      executable: executableBinding
        ? {
            basename: path.basename(executableBinding.path),
            pathScope: 'host-local-redacted',
            bytes: executableBinding.bytes,
            sha256: executableBinding.sha256,
          }
        : null,
      skipBuild: config.skipBuild,
    },
    harness: {
      sourceMode: config.harnessSourceMode,
      authoritativeExecutedBuild: harnessBinding.authoritativeExecutedBuild,
      executedHarnessBinding: harnessBinding.executedHarnessBinding,
      generatedEntry: harnessBinding.generatedEntry,
      inputProvenance: harnessBinding.inputProvenance,
    },
    evidence: {
      outputTarget: {
        basename: path.basename(config.outputPath),
        pathScope: 'host-local-redacted',
      },
      outputMode: config.outputMode,
    },
  };
}

function validateGeneratedEntryBinding(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(['bytes', 'logicalName', 'sha256', 'sourcefile'])
    || value.logicalName !== 'copilot-kg-performance-entry.tsx'
    || value.sourcefile !== value.logicalName
    || !Number.isSafeInteger(value.bytes)
    || value.bytes < 1
    || !/^[a-f0-9]{64}$/.test(String(value.sha256 ?? ''))
  ) {
    blocked(
      'BLOCKED_ELECTRON_PERF_HARNESS_GENERATED_ENTRY',
      'Generated harness entry binding is invalid',
    );
  }
  return {
    logicalName: value.logicalName,
    sourcefile: value.sourcefile,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

export function formatPerformanceBlocker(error) {
  const code = typeof error?.code === 'string' && error.code.startsWith('BLOCKED_')
    ? error.code
    : 'BLOCKED_ELECTRON_PERF_UNEXPECTED_FAILURE';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.startsWith(`${code}: `) ? rawMessage : `${code}: ${rawMessage}`;
  return `${code}\n${message}\n`;
}

export async function publishCompletedEvidence(completedSiblingPath, outputPath, linkImpl = link) {
  try {
    await linkImpl(completedSiblingPath, outputPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      blocked(
        'BLOCKED_ELECTRON_PERF_OUTPUT_PATH_ALREADY_EXISTS',
        `Refusing to overwrite ${outputPath}`,
      );
    }
    if (['EXDEV', 'EPERM', 'EOPNOTSUPP', 'ENOTSUP'].includes(error?.code)) {
      blocked(
        'BLOCKED_ELECTRON_PERF_OUTPUT_HARD_LINK_UNSUPPORTED',
        `Atomic no-overwrite hard-link publication is unavailable (${error.code})`,
      );
    }
    blocked(
      'BLOCKED_ELECTRON_PERF_OUTPUT_PUBLISH_FAILED',
      `Cannot publish ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function writePerformanceEvidence(config, contents) {
  const completedSiblingPath = path.join(
    path.dirname(config.outputPath),
    `.${path.basename(config.outputPath)}.tmp-${randomUUID()}`,
  );
  let handle;
  let siblingCreated = false;
  let completedStat;
  const expectedBytes = Buffer.byteLength(contents, 'utf8');
  try {
    await mkdir(path.dirname(config.outputPath), { recursive: true });
    handle = await open(completedSiblingPath, 'wx', 0o600);
    siblingCreated = true;
    await handle.writeFile(contents, { encoding: 'utf8' });
    await handle.sync();
    if (process.platform !== 'win32') await handle.chmod(0o600);
    completedStat = await handle.stat();
    assertPrivatePerformanceEvidence(completedStat, {
      expectedBytes,
      expectedLinks: 1,
      code: 'BLOCKED_ELECTRON_PERF_OUTPUT_WRITE_FAILED',
    });
    await handle.close();
    handle = undefined;
    if (config.outputMode === 'external-non-overwriting') {
      await publishCompletedEvidence(completedSiblingPath, config.outputPath);
      await unlink(completedSiblingPath);
    } else {
      await rename(completedSiblingPath, config.outputPath);
    }
    siblingCreated = false;
    const publishedStat = await lstat(config.outputPath);
    assertPrivatePerformanceEvidence(publishedStat, {
      expectedBytes,
      expectedLinks: 1,
      expectedIdentity: completedStat,
      code: 'BLOCKED_ELECTRON_PERF_OUTPUT_WRITE_FAILED',
    });
  } catch (error) {
    if (isBlocker(error)) throw error;
    blocked(
      'BLOCKED_ELECTRON_PERF_OUTPUT_WRITE_FAILED',
      `Cannot write ${config.outputPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await handle?.close().catch(() => undefined);
    if (siblingCreated) {
      await unlink(completedSiblingPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }
}

function assertPrivatePerformanceEvidence(stat, {
  expectedBytes,
  expectedLinks,
  expectedIdentity,
  code,
}) {
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== expectedLinks
    || stat.size !== expectedBytes
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
    || (expectedIdentity && (
      stat.dev !== expectedIdentity.dev
      || stat.ino !== expectedIdentity.ino
    ))
  ) {
    blocked(code, 'Completed performance evidence is not a private single-link regular file');
  }
}

function optionalAbsolutePath(value, blockerCode) {
  if (!value) return undefined;
  if (!path.isAbsolute(value)) blocked(blockerCode, `Path must be absolute: ${value}`);
  return path.normalize(value);
}

function resolveBoundCandidatePath(candidateRoot, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || relativePath.normalize('NFC') !== relativePath
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Canonical manifest path is invalid');
  }
  const resolved = path.resolve(candidateRoot, ...relativePath.split('/'));
  if (!isWithin(candidateRoot, resolved)) {
    blocked('BLOCKED_STARTUP_SOURCE_SNAPSHOT_MANIFEST', 'Canonical manifest path escapes candidate');
  }
  return resolved;
}

function validateFile(filePath, missingCode, notFileCode) {
  if (!existsSync(filePath)) blocked(missingCode, `Path does not exist: ${filePath}`);
  if (!isFile(filePath)) blocked(notFileCode, `Path is not a file: ${filePath}`);
}

function validateDirectory(directoryPath, missingCode, notDirectoryCode) {
  if (!existsSync(directoryPath)) blocked(missingCode, `Path does not exist: ${directoryPath}`);
  if (!statSync(directoryPath).isDirectory()) {
    blocked(notDirectoryCode, `Path is not a directory: ${directoryPath}`);
  }
}

function isFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function blocked(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isBlocker(error) {
  return typeof error?.code === 'string' && error.code.startsWith('BLOCKED_');
}

async function bindFile(filePath) {
  const contents = await readFile(filePath);
  return {
    path: filePath,
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function isDependencyInput(inputPath) {
  return inputPath.split(path.sep).includes('node_modules');
}

function logicalBuildInputPath(inputPath, componentPath, sourceRoot) {
  if (path.resolve(inputPath) === path.resolve(componentPath)) {
    return normalizeLogicalPath(path.relative(sourceRoot, inputPath));
  }
  const segments = path.resolve(inputPath).split(path.sep);
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex >= 0) {
    return `node_modules/${segments.slice(nodeModulesIndex + 1).join('/')}`;
  }
  if (isWithin(sourceRoot, inputPath)) {
    return `snapshot/${normalizeLogicalPath(path.relative(sourceRoot, inputPath))}`;
  }
  return `generated-or-host/${path.basename(inputPath)}`;
}

function digestBindings(bindings) {
  const hash = createHash('sha256');
  const stable = bindings
    .map((binding) => ({
      logicalPath: binding.logicalPath,
      bytes: binding.bytes,
      sha256: binding.sha256,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const binding of stable) {
    hash.update(JSON.stringify(binding));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function normalizeLogicalPath(value) {
  return value.split(path.sep).join('/');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
