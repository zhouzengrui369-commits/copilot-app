import path from 'node:path';
import {
  EXPECTED_LIFECYCLE_PACKAGES,
  NATIVE_BUILD_MODE,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  blockNativeCache,
  nativeHydrationTransportPolicy,
  validateNativeHydrationReceipt,
} from './native-cache-policy.mjs';

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
  return summary?.requestCount === requests.length
    && summary?.allowedCount === requests.length
    && summary?.deniedCount === 0
    && summary?.completedCount === requests.length
    && summary?.transportErrorCount === 0
    && summary?.bytesClientToUpstream === bytesClientToUpstream
    && summary?.bytesUpstreamToClient === bytesUpstreamToClient
    && sameJson(summary?.socketPolicy, socketPolicy);
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

  requireProof(receipt?.onlineHydration?.status === 'PASS', 'onlineHydration.status');
  requireProof(
    successfulCommand(onlineInstall, 'bounded-native-toolchain-install'),
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
        '--prefer-online',
        '--registry https://registry.npmjs.org/',
        '--replace-registry-host=always',
        '--no-audit',
        '--no-fund',
      ],
      ['--offline', '--ignore-scripts'],
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
