import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { computeCacheIdentity, inspectLockfileDocument } from './npm-cache-hydrate.mjs';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';
import {
  ELECTRON_ARTIFACT_MAX_BYTES,
  ELECTRON_ARTIFACT_PREFETCH_PHASE,
  ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
  ELECTRON_ARTIFACT_RANGE_BYTES,
  ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
  ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
  ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS,
} from './electron-artifact-prefetch.mjs';
export {
  ELECTRON_ARTIFACT_MAX_BYTES,
  ELECTRON_ARTIFACT_PREFETCH_PHASE,
  ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
  ELECTRON_ARTIFACT_RANGE_BYTES,
  ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
  ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
  ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS,
};

export const NATIVE_CACHE_HYDRATION_SCHEMA_VERSION = 2;
export const OWNER_NATIVE_CACHE_AUTHORITY =
  'OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION';
export const NPM_REGISTRY = 'https://registry.npmjs.org/';
export const NATIVE_TOOLCHAIN_PROFILE = 'macos-arm64-node24-electron38-v2';
export const NATIVE_BUILD_MODE = 'build-from-source-with-receipt-bound-headers';
export const NATIVE_PROXY_KEEPALIVE_MS = 30_000;
export const NATIVE_PROXY_IDLE_TIMEOUT_MS = 20 * 60 * 1_000;
export const NATIVE_PROXY_UPSTREAM_FAMILY = 4;
export const NATIVE_PROXY_GRACEFUL_CONTROL_HOST = 'github.com';
export const NATIVE_PROXY_GRACEFUL_CONTROL_ERROR = 'ETIMEDOUT';
export const NATIVE_PROXY_GRACEFUL_CONTROL_MAX_BYTES = 64 * 1_024;
export const NATIVE_NPM_FETCH_RETRIES = 0;
export const NATIVE_NPM_FETCH_TIMEOUT_MS = 15 * 60 * 1_000;
export const NATIVE_NPM_MAX_SOCKETS = 4;
export const NATIVE_ELECTRON_ASSET_HOSTS = Object.freeze([
  'artifacts.electronjs.org',
  'github-releases.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
export const NATIVE_ELECTRON_ASSET_RECOVERABLE_ERRORS = Object.freeze([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);
export const NATIVE_ELECTRON_ASSET_MAX_TUNNEL_BYTES =
  ELECTRON_ARTIFACT_RANGE_BYTES + 512 * 1_024;
export const NATIVE_PARTIAL_CACHE_MARKER = 'HYDRATION-FAILED.json';
export const NATIVE_HYDRATION_HOSTS = Object.freeze([
  'artifacts.electronjs.org',
  'electronjs.org',
  'github-releases.githubusercontent.com',
  'github.com',
  'nodejs.org',
  'objects.githubusercontent.com',
  'registry.npmjs.org',
  'release-assets.githubusercontent.com',
  'www.electronjs.org',
]);
export const EXPECTED_LIFECYCLE_PACKAGES = Object.freeze([
  ['apps/copilot-desktop/node_modules/electron', '38.8.6'],
  ['apps/copilot-desktop/node_modules/esbuild', '0.21.5'],
  ['node_modules/better-sqlite3', '11.10.0'],
  ['node_modules/electron', '33.4.11'],
  ['node_modules/esbuild', '0.25.12'],
  ['node_modules/msgpackr-extract', '3.0.4'],
  ['node_modules/tsx/node_modules/esbuild', '0.28.1'],
  ['node_modules/vite-node/node_modules/esbuild', '0.21.5'],
  ['node_modules/vitest/node_modules/esbuild', '0.21.5'],
  ['packages/llm-client/node_modules/fsevents', '2.3.2'],
]);

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXPECTED_REGISTRY_PREFETCH_STRATEGY =
  'lockfile-batched-name-version-npm-pack-v2';
const EXPECTED_REGISTRY_METADATA_MODE = 'name-version-packument-and-tarball';
const EXPECTED_REGISTRY_CLOSURE_STRATEGY =
  'deny-network-offline-ci-ignore-scripts-v1';
const EXPECTED_REGISTRY_MODE =
  'lockfile-name-version-prefetch-closure-then-offline-ci';
const EXPECTED_REGISTRY_BATCH_SIZE = 24;

export class NativeCacheHydrationBlocked extends Error {
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'NativeCacheHydrationBlocked';
    this.code = code;
    this.detail = detail;
    this.context = context;
  }
}

export function blockNativeCache(code, detail, context = {}) {
  throw new NativeCacheHydrationBlocked(code, detail, context);
}

export function nativeHydrationTransportPolicy() {
  return {
    automaticRetry: false,
    npmFetchRetries: NATIVE_NPM_FETCH_RETRIES,
    npmFetchTimeoutMs: NATIVE_NPM_FETCH_TIMEOUT_MS,
    npmMaxSockets: NATIVE_NPM_MAX_SOCKETS,
    proxyKeepAliveMs: NATIVE_PROXY_KEEPALIVE_MS,
    proxyIdleTimeoutMs: NATIVE_PROXY_IDLE_TIMEOUT_MS,
    proxyUpstreamFamily: NATIVE_PROXY_UPSTREAM_FAMILY,
    proxyGracefulControlHost: NATIVE_PROXY_GRACEFUL_CONTROL_HOST,
    proxyGracefulControlError: NATIVE_PROXY_GRACEFUL_CONTROL_ERROR,
    proxyGracefulControlMaxBytes: NATIVE_PROXY_GRACEFUL_CONTROL_MAX_BYTES,
    electronArtifactPrefetchPhase: ELECTRON_ARTIFACT_PREFETCH_PHASE,
    electronArtifactPrefetchStrategy: ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
    electronArtifactRangeBytes: ELECTRON_ARTIFACT_RANGE_BYTES,
    electronArtifactRangeConcurrency: ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
    electronArtifactRangeMaxAttempts: ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
    electronArtifactRangeTimeoutMs: ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS,
    electronArtifactMaxBytes: ELECTRON_ARTIFACT_MAX_BYTES,
    electronArtifactHosts: [...NATIVE_ELECTRON_ASSET_HOSTS],
    electronArtifactRecoverableErrors: [...NATIVE_ELECTRON_ASSET_RECOVERABLE_ERRORS],
    electronArtifactMaxTunnelBytes: NATIVE_ELECTRON_ASSET_MAX_TUNNEL_BYTES,
    partialCacheReuse: false,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_ARGUMENT', `missing value for ${flag}`);
  }
  return value;
}

export function parseNativeHydrationArgs(argv) {
  const parsed = {
    repository: process.cwd(),
    sourceCommit: null,
    cacheDir: null,
    receiptOutput: null,
    ownerAuthority: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--repository') parsed.repository = requiredValue(argv, ++index, token);
    else if (token === '--source-commit') parsed.sourceCommit = requiredValue(argv, ++index, token);
    else if (token === '--cache-dir') parsed.cacheDir = requiredValue(argv, ++index, token);
    else if (token === '--receipt-output') parsed.receiptOutput = requiredValue(argv, ++index, token);
    else if (token === '--owner-authority') parsed.ownerAuthority = requiredValue(argv, ++index, token);
    else blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_ARGUMENT', `unknown argument ${String(token)}`);
  }
  if (!FULL_COMMIT.test(parsed.sourceCommit ?? '')) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_COMMIT',
      'source commit must be exactly 40 lower-case hex characters',
    );
  }
  if (parsed.ownerAuthority !== OWNER_NATIVE_CACHE_AUTHORITY) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_OWNER_AUTHORITY',
      'exact bounded native-toolchain owner authority token is required',
    );
  }
  for (const [label, value] of [
    ['cache dir', parsed.cacheDir],
    ['receipt output', parsed.receiptOutput],
  ]) {
    if (!value || !path.isAbsolute(value)) {
      blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PATH', `${label} must be absolute`, { value });
    }
  }
  return {
    ...parsed,
    repository: path.resolve(parsed.repository),
    cacheDir: path.resolve(parsed.cacheDir),
    receiptOutput: path.resolve(parsed.receiptOutput),
  };
}

export function nativeCacheLayout(root) {
  const canonicalRoot = path.resolve(root);
  return {
    root: canonicalRoot,
    npm: path.join(canonicalRoot, 'npm'),
    electron: path.join(canonicalRoot, 'electron'),
    electronBuilder: path.join(canonicalRoot, 'electron-builder'),
    nodeGyp: path.join(canonicalRoot, 'node-gyp'),
    prebuild: path.join(canonicalRoot, 'prebuild'),
  };
}

export function validateNativeCacheLayout(root, layout) {
  const expected = nativeCacheLayout(root);
  for (const key of Object.keys(expected)) {
    if (path.resolve(layout?.[key] ?? '') !== expected[key]) {
      blockNativeCache('BLOCKED_NATIVE_CACHE_RECEIPT_INVALID', `cache layout mismatch: ${key}`);
    }
  }
  return expected;
}

export function candidateNativeCacheEnvironment(validated) {
  const layout = validated?.cacheLayout ?? validated?.receipt?.cacheLayout;
  const root = validated?.cacheIdentity?.path ?? validated?.receipt?.cacheIdentity?.path;
  const checked = validateNativeCacheLayout(root, layout);
  const electronNodedir = path.resolve(
    validated?.electronNodedir ?? validated?.receipt?.electronNodedir ?? '',
  );
  const relation = path.relative(checked.root, electronNodedir);
  if (relation === '' || relation.startsWith('..') || path.isAbsolute(relation)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
      'Electron nodedir must be a receipt-bound child of the cache root',
      { electronNodedir },
    );
  }
  return {
    npm_config_cache: checked.npm,
    npm_config_devdir: checked.nodeGyp,
    npm_config_offline: 'true',
    npm_config_fetch_retries: String(NATIVE_NPM_FETCH_RETRIES),
    npm_config_build_from_source: 'true',
    npm_config_python: '/usr/bin/python3',
    PYTHON: '/usr/bin/python3',
    HOME: path.join(checked.root, 'home'),
    XDG_CACHE_HOME: path.join(checked.root, 'xdg-cache'),
    ELECTRON_CACHE: checked.electron,
    electron_config_cache: checked.electron,
    ELECTRON_BUILDER_CACHE: checked.electronBuilder,
    PREBUILD_INSTALL_CACHE: checked.prebuild,
    COPILOT_NATIVE_NPM_CACHE: checked.npm,
    COPILOT_NATIVE_DEV_DIR: checked.nodeGyp,
    COPILOT_NATIVE_NODEDIR: electronNodedir,
    COPILOT_NATIVE_CACHE_PROFILE: NATIVE_TOOLCHAIN_PROFILE,
  };
}

export function candidateNativeBuildEnvironment(validated) {
  const base = candidateNativeCacheEnvironment(validated);
  return { ...base, npm_config_nodedir: base.COPILOT_NATIVE_NODEDIR };
}

async function regularFileBytes(file, code) {
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    blockNativeCache(code, 'file cannot be opened without following links', {
      file,
      fsCode: error?.code ?? null,
    });
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.nlink !== 1) {
      blockNativeCache(code, 'path is not a single-link regular file', {
        file,
        nlink: fileStat.nlink,
      });
    }
    return { bytes: await handle.readFile(), size: fileStat.size };
  } finally {
    await handle.close();
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function inspectNativeLockfile(repository) {
  const file = path.join(repository, 'package-lock.json');
  const { bytes, size } = await regularFileBytes(
    file,
    'BLOCKED_NATIVE_CACHE_HYDRATION_LOCKFILE',
  );
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_LOCKFILE', 'package-lock.json is invalid JSON');
  }
  const identity = inspectLockfileDocument(document);
  const lifecyclePackages = Object.entries(document.packages ?? {})
    .filter(([, entry]) => entry?.hasInstallScript === true)
    .map(([packagePath, entry]) => [packagePath, String(entry.version ?? '')])
    .sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(lifecyclePackages) !== JSON.stringify(EXPECTED_LIFECYCLE_PACKAGES)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_LIFECYCLE_SET',
      'package-lock install-script set differs from the reviewed exact set',
      { expected: EXPECTED_LIFECYCLE_PACKAGES, actual: lifecyclePackages },
    );
  }
  const desktopPackage = JSON.parse(
    await readFile(path.join(repository, 'apps/copilot-desktop/package.json'), 'utf8'),
  );
  const electronVersion = String(desktopPackage.devDependencies?.electron ?? '');
  if (!/^\d+\.\d+\.\d+$/u.test(electronVersion)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_ELECTRON_VERSION',
      'desktop Electron version is not exact',
      { electronVersion },
    );
  }
  const builderConfig = await readFile(
    path.join(repository, 'apps/copilot-desktop/electron-builder.yml'),
    'utf8',
  );
  const builderVersion = /^electronVersion:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/mu.exec(
    builderConfig,
  )?.[1];
  if (builderVersion !== electronVersion) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_ELECTRON_VERSION',
      'package and electron-builder Electron versions differ',
      { packageVersion: electronVersion, builderVersion: builderVersion ?? null },
    );
  }
  return {
    path: 'package-lock.json',
    bytes: size,
    sha256: sha256(bytes),
    ...identity,
    lifecyclePackages,
    electronVersion,
  };
}

export async function findElectronNodedir(nodeGypRoot, electronVersion) {
  const candidates = [];
  async function visit(directory, depth = 0) {
    if (depth > 5) return;
    const hasHeader = await stat(path.join(directory, 'include/node/node.h'))
      .then((value) => value.isFile())
      .catch(() => false);
    const hasGypi = await Promise.all([
      path.join(directory, 'common.gypi'),
      path.join(directory, 'include/node/common.gypi'),
    ].map(async (file) => stat(file).then((value) => value.isFile()).catch(() => false)));
    if (hasHeader && hasGypi.some(Boolean)) {
      candidates.push(await realpath(directory));
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(path.join(directory, entry.name), depth + 1);
      }
    }
  }
  await visit(nodeGypRoot);
  const versionMatches = candidates.filter((candidate) => candidate
    .split(path.sep)
    .some((part) => part === electronVersion || part === `v${electronVersion}`));
  const selected = versionMatches.length === 1
    ? versionMatches[0]
    : candidates.length === 1
      ? candidates[0]
      : null;
  if (!selected) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_ELECTRON_NODEDIR',
      'could not identify exactly one hydrated Electron header root',
      { electronVersion, candidates },
    );
  }
  return selected;
}

export function fullInstallArgs({ npmExecutable, npmCacheDir, online }) {
  const args = [
    npmExecutable,
    'ci',
    '--cache',
    npmCacheDir,
    NPM_CACHE_KEY_ALIGNMENT_FLAG,
    '--no-audit',
    '--no-fund',
  ];
  if (online) args.push('--prefer-online', '--registry', NPM_REGISTRY);
  else args.push('--offline');
  return args;
}

export function nativeRebuildArgs({ npmExecutable, electronVersion, arch }) {
  return [
    npmExecutable,
    'rebuild',
    '--runtime=electron',
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
    '--build-from-source',
  ];
}

function validElectronArtifactPrefetch(receipt, layout) {
  const value = receipt?.electronArtifactPrefetch;
  const artifacts = value?.artifacts;
  const expectedPackages = EXPECTED_LIFECYCLE_PACKAGES
    .filter(([packagePath]) => packagePath.endsWith('/electron') || packagePath === 'node_modules/electron')
    .map(([packagePath, version]) => ({ packagePath, version }));
  const command = value?.command;
  const requests = receipt?.onlineHydration?.proxy?.requests;
  const start = value?.proxyRequestStartIndex;
  const end = value?.proxyRequestEndIndex;
  if (
    value?.schemaVersion !== 1
    || value?.status !== 'PASS'
    || value?.strategy !== ELECTRON_ARTIFACT_PREFETCH_STRATEGY
    || value?.platform !== 'darwin'
    || value?.arch !== 'arm64'
    || value?.rangeBytes !== ELECTRON_ARTIFACT_RANGE_BYTES
    || value?.concurrency !== ELECTRON_ARTIFACT_RANGE_CONCURRENCY
    || value?.maxAttemptsPerRange !== ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS
    || value?.requestTimeoutMs !== ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS
    || value?.automaticHydrationRetry !== false
    || value?.partialCacheReuse !== false
    || !Array.isArray(artifacts)
    || artifacts.length !== expectedPackages.length
    || command?.name !== 'bounded-electron-artifact-range-prefetch'
    || command?.exitCode !== 0
    || command?.signal !== null
    || typeof command?.command !== 'string'
    || !command.command.includes('electron-artifact-prefetch.mjs')
    || !path.isAbsolute(command?.stdoutPath ?? '')
    || !path.isAbsolute(command?.stderrPath ?? '')
    || !Array.isArray(requests)
    || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end <= start
    || end > requests.length
    || requests.slice(start, end).some((request) => request?.phase !== ELECTRON_ARTIFACT_PREFETCH_PHASE)
    || requests.some((request, index) => request?.phase === ELECTRON_ARTIFACT_PREFETCH_PHASE
      && (index < start || index >= end))
  ) return false;
  let retryCount = 0;
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const expected = expectedPackages[index];
    const expectedFile = `electron-v${expected.version}-darwin-arm64.zip`;
    const expectedUrl =
      `https://github.com/electron/electron/releases/download/v${expected.version}/${expectedFile}`;
    const relation = path.relative(layout.electron, artifact?.cachePath ?? '');
    const baseRequests = Number(artifact?.rangeCount) + 1;
    if (
      artifact?.packagePath !== expected.packagePath
      || artifact?.version !== expected.version
      || artifact?.fileName !== expectedFile
      || artifact?.sourceUrl !== expectedUrl
      || relation === ''
      || relation.startsWith('..')
      || path.isAbsolute(relation)
      || !Number.isSafeInteger(artifact?.bytes)
      || artifact.bytes < 1
      || !SHA256.test(artifact?.sha256 ?? '')
      || !Number.isSafeInteger(artifact?.rangeCount)
      || artifact.rangeCount !== Math.ceil(artifact.bytes / ELECTRON_ARTIFACT_RANGE_BYTES)
      || !Number.isSafeInteger(artifact?.requestCount)
      || artifact.requestCount < baseRequests
      || artifact.requestCount > baseRequests * ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS
      || artifact?.retryCount !== artifact.requestCount - baseRequests
    ) return false;
    retryCount += artifact.retryCount;
  }
  return receipt?.onlineHydration?.proxy?.transportSummary?.boundedRangeRetryCount === retryCount;
}

export async function validateNativeHydrationReceipt({
  repository,
  sourceCommit,
  cacheDir,
  receiptPath,
}) {
  if (!FULL_COMMIT.test(sourceCommit ?? '')) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_RECEIPT_SOURCE', 'candidate source commit is invalid');
  }
  const canonicalRepository = await realpath(repository);
  const canonicalCache = await realpath(cacheDir);
  const partialMarker = await stat(path.join(canonicalCache, NATIVE_PARTIAL_CACHE_MARKER))
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
  if (partialMarker) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_RECEIPT_PARTIAL_CACHE',
      'cache contains a fail-closed partial hydration marker and cannot be reused',
    );
  }
  const { bytes: receiptBytes } = await regularFileBytes(
    receiptPath,
    'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
  );
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    blockNativeCache('BLOCKED_NATIVE_CACHE_RECEIPT_INVALID', 'receipt is not valid JSON');
  }
  const lockfile = await inspectNativeLockfile(canonicalRepository);
  const cacheIdentity = await computeCacheIdentity(canonicalCache);
  const layout = validateNativeCacheLayout(canonicalCache, receipt?.cacheLayout);
  const electronNodedir = await findElectronNodedir(layout.nodeGyp, lockfile.electronVersion);
  const expectedHosts = [...NATIVE_HYDRATION_HOSTS].sort();
  const expectedTransportPolicy = nativeHydrationTransportPolicy();
  const prefetchEntryCount = Number(receipt?.registryPrefetch?.entryCount ?? 0);
  const prefetchBatchCount = Number(receipt?.registryPrefetch?.batchCount ?? 0);
  if (
    receipt?.schemaVersion !== NATIVE_CACHE_HYDRATION_SCHEMA_VERSION
    || receipt?.status !== 'PASS'
    || receipt?.ownerAuthority !== OWNER_NATIVE_CACHE_AUTHORITY
    || receipt?.sourceCommit !== sourceCommit
    || receipt?.profile !== NATIVE_TOOLCHAIN_PROFILE
    || receipt?.registry !== NPM_REGISTRY
    || receipt?.lifecycleScriptsEnabled !== true
    || receipt?.nativeBuildMode !== NATIVE_BUILD_MODE
    || receipt?.candidateInstallMode !== 'offline-lifecycle-scripts-enabled'
    || receipt?.automaticRetry !== false
    || JSON.stringify(receipt?.transportPolicy) !== JSON.stringify(expectedTransportPolicy)
    || receipt?.candidateCreated !== false
    || receipt?.evidenceCreated !== false
    || receipt?.registryPrefetch?.status !== 'PASS'
    || receipt?.registryPrefetch?.strategy !== EXPECTED_REGISTRY_PREFETCH_STRATEGY
    || receipt?.registryPrefetch?.metadataMode !== EXPECTED_REGISTRY_METADATA_MODE
    || receipt?.registryPrefetch?.automaticRetry !== false
    || receipt?.registryPrefetch?.batchSize !== EXPECTED_REGISTRY_BATCH_SIZE
    || !Number.isInteger(prefetchEntryCount)
    || prefetchEntryCount < 1
    || !Number.isInteger(prefetchBatchCount)
    || prefetchBatchCount !== Math.ceil(prefetchEntryCount / EXPECTED_REGISTRY_BATCH_SIZE)
    || !SHA256.test(receipt?.registryPrefetch?.manifestSha256 ?? '')
    || receipt?.registryCacheClosure?.status !== 'PASS'
    || receipt?.registryCacheClosure?.strategy !== EXPECTED_REGISTRY_CLOSURE_STRATEGY
    || receipt?.registryCacheClosure?.networkAuthority !== 'deny-network'
    || receipt?.registryCacheClosure?.lifecycleScriptsEnabled !== false
    || !validElectronArtifactPrefetch(receipt, layout)
    || receipt?.onlineHydration?.status !== 'PASS'
    || receipt?.onlineHydration?.registryMode !== EXPECTED_REGISTRY_MODE
    || receipt?.onlineHydration?.registryRequestCountAfterClosure !== 0
    || receipt?.onlineHydration?.proxy?.allRequestsAllowed !== true
    || receipt?.onlineHydration?.proxy?.transportSummary?.transportErrorCount !== 0
    || JSON.stringify(receipt?.onlineHydration?.proxy?.allowedHosts) !== JSON.stringify(expectedHosts)
    || receipt?.offlineInstallProof?.status !== 'PASS'
    || receipt?.offlineInstallProof?.networkAuthority !== 'deny-network'
    || receipt?.offlineNativeProof?.status !== 'PASS'
    || receipt?.offlineNativeProof?.arch !== 'arm64'
    || receipt?.electronNodedir !== electronNodedir
    || receipt?.lockfile?.sha256 !== lockfile.sha256
    || JSON.stringify(receipt?.lockfile?.lifecyclePackages) !== JSON.stringify(lockfile.lifecyclePackages)
    || receipt?.cacheIdentity?.path !== canonicalCache
    || receipt?.cacheIdentity?.scope !== cacheIdentity.scope
    || receipt?.cacheIdentity?.fileCount !== cacheIdentity.fileCount
    || receipt?.cacheIdentity?.totalBytes !== cacheIdentity.totalBytes
    || receipt?.cacheIdentity?.aggregateSha256 !== cacheIdentity.aggregateSha256
  ) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
      'receipt, source, registry closure, transport policy, lifecycle set, offline proofs, lockfile, or cache identity mismatch',
    );
  }
  return {
    receipt,
    receiptSha256: sha256(receiptBytes),
    lockfile,
    cacheIdentity,
    cacheLayout: layout,
    electronNodedir,
  };
}
