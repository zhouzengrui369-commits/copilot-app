import path from 'node:path';
import {
  EXPECTED_LIFECYCLE_PACKAGES,
  NATIVE_BUILD_MODE,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  ELECTRON_ARTIFACT_PREFETCH_PHASE,
  ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
  ELECTRON_ARTIFACT_RANGE_BYTES,
  ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
  ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
  ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS,
  blockNativeCache,
  nativeHydrationTransportPolicy,
  validateNativeHydrationReceipt,
} from './native-cache-policy.mjs';
import {
  NATIVE_REGISTRY_CLOSURE_STRATEGY,
  NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
  NATIVE_REGISTRY_PREFETCH_STRATEGY,
} from './registry-prefetch.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validIso(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function successfulCommand(value, expectedName) {
  return value?.name === expectedName
    && typeof value.command === 'string'
    && value.command.length > 0
    && value.exitCode === 0
    && value.signal === null
    && validIso(value.startedAt)
    && validIso(value.endedAt)
    && path.isAbsolute(value.stdoutPath ?? '')
    && path.isAbsolute(value.stderrPath ?? '');
}

function commandShape(value, required, forbidden = []) {
  const command = value?.command ?? '';
  return required.every((token) => command.includes(token))
    && forbidden.every((token) => !command.includes(token));
}

function nativeBinary(value, electronVersion) {
  return value?.arch === 'arm64'
    && value?.electronVersion === electronVersion
    && Number.isSafeInteger(value?.binary?.bytes)
    && value.binary.bytes > 0
    && SHA256.test(value?.binary?.sha256 ?? '');
}

function expectedSocketPolicy(transportPolicy) {
  return {
    keepAlive: true,
    keepAliveMs: transportPolicy.proxyKeepAliveMs,
    noDelay: true,
    idleTimeoutMs: transportPolicy.proxyIdleTimeoutMs,
    upstreamFamily: transportPolicy.proxyUpstreamFamily,
  };
}

function validTransportReceipt(request, socketPolicy, transportPolicy) {
  const transport = request?.transport;
  const gracefulControlClose = request?.host === transportPolicy.proxyGracefulControlHost
    && transport?.error?.side === 'upstream'
    && transport?.error?.code === transportPolicy.proxyGracefulControlError
    && transport?.errorDisposition?.action === 'graceful-eof'
    && transport?.errorDisposition?.fatal === false
    && transport?.errorDisposition?.reason === 'late-github-control-response-timeout'
    && transport?.errorDisposition?.downstreamValidationRequired === true
    && Number.isSafeInteger(transport?.bytesUpstreamToClient)
    && transport.bytesUpstreamToClient > 0
    && transport.bytesUpstreamToClient <= transportPolicy.proxyGracefulControlMaxBytes;
  const boundedRangeRetry = request?.phase === transportPolicy.electronArtifactPrefetchPhase
    && transportPolicy.electronArtifactHosts.includes(request?.host)
    && ['client', 'upstream'].includes(transport?.error?.side)
    && transportPolicy.electronArtifactRecoverableErrors.includes(transport?.error?.code)
    && transport?.errorDisposition?.action === 'bounded-range-retry'
    && transport?.errorDisposition?.fatal === false
    && transport?.errorDisposition?.reason === 'integrity-verified-electron-range-retry'
    && transport?.errorDisposition?.downstreamValidationRequired === true
    && Number.isSafeInteger(transport?.bytesUpstreamToClient)
    && transport.bytesUpstreamToClient >= 0
    && transport.bytesUpstreamToClient <= transportPolicy.electronArtifactMaxTunnelBytes;
  return validIso(transport?.startedAt)
    && validIso(transport?.endedAt)
    && Number.isSafeInteger(transport?.durationMs)
    && transport.durationMs >= 0
    && Number.isSafeInteger(transport?.bytesClientToUpstream)
    && transport.bytesClientToUpstream >= 0
    && Number.isSafeInteger(transport?.bytesUpstreamToClient)
    && transport.bytesUpstreamToClient >= 0
    && transport?.fatal === false
    && (
      (
        transport?.error === null
        && (transport?.errorDisposition === null || transport?.errorDisposition === undefined)
      )
      || gracefulControlClose
      || boundedRangeRetry
    )
    && sameJson(transport?.socketPolicy, socketPolicy);
}

function auditedProxy(proxy, expectedHosts, transportPolicy) {
  const socketPolicy = expectedSocketPolicy(transportPolicy);
  const requests = proxy?.requests;
  if (
    proxy?.allRequestsAllowed !== true
    || !sameJson(proxy?.allowedHosts, expectedHosts)
    || !Array.isArray(requests)
    || requests.length === 0
    || !requests.every((request) => request?.method === 'CONNECT'
      && request?.allowed === true
      && request?.port === 443
      && ['native-hydration', transportPolicy.electronArtifactPrefetchPhase]
        .includes(request?.phase)
      && expectedHosts.includes(request?.host)
      && validTransportReceipt(request, socketPolicy, transportPolicy))
  ) return false;

  const summary = proxy?.transportSummary;
  const bytesClientToUpstream = requests.reduce(
    (sum, request) => sum + request.transport.bytesClientToUpstream,
    0,
  );
  const bytesUpstreamToClient = requests.reduce(
    (sum, request) => sum + request.transport.bytesUpstreamToClient,
    0,
  );
  const recoverableTransportErrorCount = requests.filter(
    (request) => request.transport?.fatal === false && request.transport?.error,
  ).length;
  const boundedRangeRetryCount = requests.filter(
    (request) => request.transport?.errorDisposition?.action === 'bounded-range-retry',
  ).length;
  return summary?.requestCount === requests.length
    && summary?.allowedCount === requests.length
    && summary?.deniedCount === 0
    && summary?.completedCount === requests.length
    && summary?.transportErrorCount === 0
    && summary?.recoverableTransportErrorCount === recoverableTransportErrorCount
    && summary?.boundedRangeRetryCount === boundedRangeRetryCount
    && summary?.bytesClientToUpstream === bytesClientToUpstream
    && summary?.bytesUpstreamToClient === bytesUpstreamToClient
    && sameJson(summary?.socketPolicy, socketPolicy);
}

function validRegistryClosureShape(receipt) {
  const prefetch = receipt?.registryPrefetch;
  const closure = receipt?.registryCacheClosure;
  return prefetch?.status === 'PASS'
    && prefetch?.strategy === NATIVE_REGISTRY_PREFETCH_STRATEGY
    && prefetch?.metadataMode === 'name-version-packument-and-tarball'
    && prefetch?.automaticRetry === false
    && prefetch?.batchSize === NATIVE_REGISTRY_PREFETCH_BATCH_SIZE
    && Number.isSafeInteger(prefetch?.entryCount)
    && prefetch.entryCount > 0
    && prefetch?.batchCount === Math.ceil(prefetch.entryCount / prefetch.batchSize)
    && SHA256.test(prefetch?.manifestSha256 ?? '')
    && closure?.status === 'PASS'
    && closure?.strategy === NATIVE_REGISTRY_CLOSURE_STRATEGY
    && closure?.networkAuthority === 'deny-network'
    && closure?.lifecycleScriptsEnabled === false
    && successfulCommand(closure, 'deny-network-registry-cache-closure-proof')
    && commandShape(closure, [
      '/usr/bin/sandbox-exec',
      '(deny network*)',
      'npm ci',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ], ['--prefer-online'])
    && receipt?.onlineHydration?.registryMode
      === 'lockfile-name-version-prefetch-closure-then-offline-ci'
    && receipt?.onlineHydration?.registryRequestCountAfterClosure === 0;
}

function validElectronArtifactPrefetchShape(value, proxy, lifecyclePackages) {
  const expected = lifecyclePackages
    .filter(([packagePath]) => packagePath.endsWith('/electron') || packagePath === 'node_modules/electron')
    .map(([packagePath, version]) => ({ packagePath, version }));
  const artifacts = value?.artifacts;
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
    || !successfulCommand(value?.command, 'bounded-electron-artifact-range-prefetch')
    || !commandShape(value?.command, [
      '/usr/bin/sandbox-exec',
      '(deny network*)',
      'localhost:',
      'electron-artifact-prefetch.mjs',
      '--repository',
      '--cache-root',
    ])
    || !Array.isArray(artifacts)
    || artifacts.length !== expected.length
    || !Array.isArray(proxy?.requests)
    || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end <= start
    || end > proxy.requests.length
    || proxy.requests.slice(start, end).some(
      (request) => request?.phase !== ELECTRON_ARTIFACT_PREFETCH_PHASE,
    )
    || proxy.requests.some((request, index) => request?.phase === ELECTRON_ARTIFACT_PREFETCH_PHASE
      && (index < start || index >= end))
  ) return false;
  let retries = 0;
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const item = expected[index];
    const fileName = `electron-v${item.version}-darwin-arm64.zip`;
    const sourceUrl =
      `https://github.com/electron/electron/releases/download/v${item.version}/${fileName}`;
    const baseRequests = Number(artifact?.rangeCount) + 1;
    if (
      artifact?.packagePath !== item.packagePath
      || artifact?.version !== item.version
      || artifact?.fileName !== fileName
      || artifact?.sourceUrl !== sourceUrl
      || !path.isAbsolute(artifact?.cachePath ?? '')
      || path.basename(artifact.cachePath) !== fileName
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
    retries += artifact.retryCount;
  }
  return proxy?.transportSummary?.boundedRangeRetryCount === retries;
}

export function auditNativeHydrationReceiptShape({
  receipt,
  electronVersion,
  lifecyclePackages = EXPECTED_LIFECYCLE_PACKAGES,
}) {
  const expectedHosts = [...NATIVE_HYDRATION_HOSTS].sort();
  const transportPolicy = nativeHydrationTransportPolicy();
  const onlineInstall = receipt?.onlineHydration?.install;
  const onlineNative = receipt?.onlineHydration?.nativeArm64;
  const offlineInstall = receipt?.offlineInstallProof;
  const offlineNative = receipt?.offlineNativeProof;
  const failures = [];
  const requireProof = (condition, label) => {
    if (!condition) failures.push(label);
  };

  requireProof(receipt?.ownerAuthority === OWNER_NATIVE_CACHE_AUTHORITY, 'ownerAuthority');
  requireProof(
    receipt?.authorityScope === 'single-exact-commit-bounded-native-toolchain-cache-hydration',
    'authorityScope',
  );
  requireProof(receipt?.profile === NATIVE_TOOLCHAIN_PROFILE, 'profile');
  requireProof(receipt?.nativeBuildMode === NATIVE_BUILD_MODE, 'nativeBuildMode');
  requireProof(sameJson(receipt?.allowedHosts, expectedHosts), 'allowedHosts');
  requireProof(sameJson(receipt?.transportPolicy, transportPolicy), 'transportPolicy');
  requireProof(
    receipt?.transportPolicy?.automaticRetry === false
      && receipt?.transportPolicy?.npmFetchRetries === 0
      && receipt?.transportPolicy?.partialCacheReuse === false,
    'transportPolicy.failClosed',
  );
  requireProof(
    sameJson(receipt?.reviewedLifecyclePackages, lifecyclePackages),
    'reviewedLifecyclePackages',
  );
  requireProof(
    receipt?.lockfile?.electronVersion === electronVersion,
    'lockfile.electronVersion',
  );
  requireProof(
    path.isAbsolute(receipt?.npmExecutable ?? '')
      && path.basename(receipt.npmExecutable) === 'npm',
    'npmExecutable',
  );
  requireProof(SEMVER.test(receipt?.npmVersion ?? ''), 'npmVersion');
  requireProof(validIso(receipt?.endedAt), 'endedAt');
  requireProof(validRegistryClosureShape(receipt), 'registryCacheClosure');

  requireProof(receipt?.onlineHydration?.status === 'PASS', 'onlineHydration.status');
  requireProof(
    validElectronArtifactPrefetchShape(
      receipt?.electronArtifactPrefetch,
      receipt?.onlineHydration?.proxy,
      lifecyclePackages,
    ),
    'electronArtifactPrefetch',
  );
  requireProof(
    successfulCommand(onlineInstall, 'bounded-native-toolchain-lifecycle-install'),
    'onlineHydration.install',
  );
  requireProof(
    commandShape(
      onlineInstall,
      [
        '/usr/bin/sandbox-exec',
        '(deny network*)',
        'localhost:',
        'npm ci',
        '--offline',
        '--replace-registry-host=always',
        '--no-audit',
        '--no-fund',
      ],
      ['--prefer-online', '--registry', '--ignore-scripts'],
    ),
    'onlineHydration.install.command',
  );
  requireProof(
    successfulCommand(onlineNative, 'bounded-electron-native-arm64-hydration'),
    'onlineHydration.nativeArm64',
  );
  requireProof(nativeBinary(onlineNative, electronVersion), 'onlineHydration.nativeArm64.binary');
  requireProof(
    commandShape(
      onlineNative,
      [
        '/usr/bin/sandbox-exec',
        '(deny network*)',
        'localhost:',
        'npm rebuild',
        '--runtime=electron',
        `--target=${electronVersion}`,
        '--arch=arm64',
        '--dist-url=https://electronjs.org/headers',
        '--build-from-source',
      ],
      ['--ignore-scripts'],
    ),
    'onlineHydration.nativeArm64.command',
  );
  requireProof(
    auditedProxy(receipt?.onlineHydration?.proxy, expectedHosts, transportPolicy),
    'onlineHydration.proxy',
  );

  requireProof(offlineInstall?.status === 'PASS', 'offlineInstallProof.status');
  requireProof(
    offlineInstall?.networkAuthority === 'deny-network',
    'offlineInstallProof.networkAuthority',
  );
  requireProof(
    offlineInstall?.lifecycleScriptsEnabled === true,
    'offlineInstallProof.lifecycleScriptsEnabled',
  );
  requireProof(
    Number.isSafeInteger(offlineInstall?.electronExecutableBytes)
      && offlineInstall.electronExecutableBytes > 0,
    'offlineInstallProof.electronExecutableBytes',
  );
  requireProof(
    successfulCommand(offlineInstall, 'deny-network-full-install-proof'),
    'offlineInstallProof.commandReceipt',
  );
  requireProof(
    commandShape(
      offlineInstall,
      [
        '/usr/bin/sandbox-exec',
        '(deny network*)',
        'npm ci',
        '--offline',
        '--replace-registry-host=always',
        '--no-audit',
        '--no-fund',
      ],
      ['--prefer-online', '--ignore-scripts'],
    ),
    'offlineInstallProof.command',
  );

  requireProof(offlineNative?.status === 'PASS', 'offlineNativeProof.status');
  requireProof(
    offlineNative?.networkAuthority === 'deny-network',
    'offlineNativeProof.networkAuthority',
  );
  requireProof(
    successfulCommand(offlineNative, 'deny-network-electron-native-arm64-proof'),
    'offlineNativeProof.commandReceipt',
  );
  requireProof(nativeBinary(offlineNative, electronVersion), 'offlineNativeProof.binary');
  requireProof(
    commandShape(
      offlineNative,
      [
        '/usr/bin/sandbox-exec',
        '(deny network*)',
        'npm rebuild',
        '--runtime=electron',
        `--target=${electronVersion}`,
        '--arch=arm64',
        '--dist-url=https://electronjs.org/headers',
        '--build-from-source',
      ],
      ['--ignore-scripts'],
    ),
    'offlineNativeProof.command',
  );

  if (failures.length > 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
      'native hydration receipt proof shape is incomplete or contradictory',
      { failures },
    );
  }

  return {
    schemaVersion: 2,
    status: 'PASS',
    expectedHosts,
    transportPolicy,
    proxyRequestCount: receipt.onlineHydration.proxy.requests.length,
    onlineInstallExitCode: onlineInstall.exitCode,
    onlineNativeExitCode: onlineNative.exitCode,
    offlineInstallExitCode: offlineInstall.exitCode,
    offlineNativeExitCode: offlineNative.exitCode,
    electronVersion,
  };
}

export async function validateAuditedNativeHydrationReceipt(options) {
  const validated = await validateNativeHydrationReceipt(options);
  const receiptAudit = auditNativeHydrationReceiptShape({
    receipt: validated.receipt,
    electronVersion: validated.lockfile.electronVersion,
    lifecyclePackages: validated.lockfile.lifecyclePackages,
  });
  return { ...validated, receiptAudit };
}
