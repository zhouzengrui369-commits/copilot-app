import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_LIFECYCLE_PACKAGES,
  NATIVE_BUILD_MODE,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NativeCacheHydrationBlocked,
} from './npm-native-cache-hydrate.mjs';
import { auditNativeHydrationReceiptShape } from './native-cache-receipt-audit.mjs';

const ELECTRON_VERSION = '38.8.6';
const NOW = '2026-08-03T06:00:00.000Z';
const SHA = 'a'.repeat(64);
const OFFLINE_PROFILE = "'(version 1)\n(allow default)\n(deny network*)\n'";
const ONLINE_PROFILE = "'(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote tcp \"localhost:43123\"))\n'";

function commandReceipt(name, command) {
  return {
    name,
    command,
    startedAt: NOW,
    endedAt: NOW,
    exitCode: 0,
    signal: null,
    stdoutPath: `/tmp/${name}.stdout.log`,
    stderrPath: `/tmp/${name}.stderr.log`,
  };
}

function nativeProof(name, command) {
  return {
    ...commandReceipt(name, command),
    arch: 'arm64',
    electronVersion: ELECTRON_VERSION,
    binary: { bytes: 4096, sha256: SHA },
  };
}

function canonicalReceipt() {
  const hosts = [...NATIVE_HYDRATION_HOSTS].sort();
  const npm = '/opt/homebrew/bin/npm';
  const installOnline = `/usr/bin/sandbox-exec -p ${ONLINE_PROFILE} ${npm} ci --cache /tmp/cache/npm --replace-registry-host=always --no-audit --no-fund --prefer-online --registry https://registry.npmjs.org/`;
  const installOffline = `/usr/bin/sandbox-exec -p ${OFFLINE_PROFILE} ${npm} ci --cache /tmp/cache/npm --replace-registry-host=always --no-audit --no-fund --offline`;
  const rebuildOnline = `/usr/bin/sandbox-exec -p ${ONLINE_PROFILE} ${npm} rebuild --runtime=electron --target=${ELECTRON_VERSION} --arch=arm64 --dist-url=https://electronjs.org/headers --build-from-source`;
  const rebuildOffline = `/usr/bin/sandbox-exec -p ${OFFLINE_PROFILE} ${npm} rebuild --runtime=electron --target=${ELECTRON_VERSION} --arch=arm64 --dist-url=https://electronjs.org/headers --build-from-source`;
  return {
    status: 'PASS',
    ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
    authorityScope: 'single-exact-commit-bounded-native-toolchain-cache-hydration',
    profile: NATIVE_TOOLCHAIN_PROFILE,
    nativeBuildMode: NATIVE_BUILD_MODE,
    allowedHosts: hosts,
    reviewedLifecyclePackages: EXPECTED_LIFECYCLE_PACKAGES,
    npmExecutable: npm,
    npmVersion: '11.8.0',
    lockfile: {
      electronVersion: ELECTRON_VERSION,
      lifecyclePackages: EXPECTED_LIFECYCLE_PACKAGES,
    },
    onlineHydration: {
      status: 'PASS',
      install: commandReceipt('bounded-native-toolchain-install', installOnline),
      nativeArm64: nativeProof('bounded-electron-native-arm64-hydration', rebuildOnline),
      proxy: {
        allowedHosts: hosts,
        allRequestsAllowed: true,
        requests: [
          { method: 'CONNECT', host: 'registry.npmjs.org', port: 443, allowed: true },
          { method: 'CONNECT', host: 'nodejs.org', port: 443, allowed: true },
          { method: 'CONNECT', host: 'electronjs.org', port: 443, allowed: true },
        ],
      },
    },
    offlineInstallProof: {
      status: 'PASS',
      networkAuthority: 'deny-network',
      lifecycleScriptsEnabled: true,
      electronExecutableBytes: 8192,
      ...commandReceipt('deny-network-full-install-proof', installOffline),
    },
    offlineNativeProof: {
      status: 'PASS',
      networkAuthority: 'deny-network',
      ...nativeProof('deny-network-electron-native-arm64-proof', rebuildOffline),
    },
    endedAt: NOW,
  };
}

function audit(receipt) {
  return auditNativeHydrationReceiptShape({
    receipt,
    electronVersion: ELECTRON_VERSION,
    lifecyclePackages: EXPECTED_LIFECYCLE_PACKAGES,
  });
}

function expectInvalid(receipt, expectedFailure) {
  assert.throws(
    () => audit(receipt),
    (error) => error instanceof NativeCacheHydrationBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID'
      && error.context.failures.includes(expectedFailure),
  );
}

test('strict receipt audit accepts the complete hydrator proof shape', () => {
  const result = audit(canonicalReceipt());
  assert.equal(result.status, 'PASS');
  assert.equal(result.proxyRequestCount, 3);
  assert.equal(result.offlineNativeExitCode, 0);
});

test('strict receipt audit rejects a claimed proxy PASS without request evidence', () => {
  const receipt = canonicalReceipt();
  receipt.onlineHydration.proxy.requests = [];
  expectInvalid(receipt, 'onlineHydration.proxy');
});

test('strict receipt audit rejects an unreviewed proxy destination', () => {
  const receipt = canonicalReceipt();
  receipt.onlineHydration.proxy.requests[0].host = 'attacker.invalid';
  expectInvalid(receipt, 'onlineHydration.proxy');
});

test('strict receipt audit rejects online work outside the localhost sandbox', () => {
  const receipt = canonicalReceipt();
  receipt.onlineHydration.install.command = receipt.onlineHydration.install.command
    .replace('/usr/bin/sandbox-exec -p ', '')
    .replace(ONLINE_PROFILE, '');
  expectInvalid(receipt, 'onlineHydration.install.command');
});

test('strict receipt audit rejects a failed offline install hidden behind PASS', () => {
  const receipt = canonicalReceipt();
  receipt.offlineInstallProof.exitCode = 1;
  expectInvalid(receipt, 'offlineInstallProof.commandReceipt');
});

test('strict receipt audit rejects missing Electron native binary identity', () => {
  const receipt = canonicalReceipt();
  receipt.offlineNativeProof.binary = null;
  expectInvalid(receipt, 'offlineNativeProof.binary');
});

test('strict receipt audit rejects lifecycle-set and command contradictions', () => {
  const receipt = canonicalReceipt();
  receipt.reviewedLifecyclePackages = [];
  receipt.onlineHydration.install.command += ' --ignore-scripts';
  assert.throws(
    () => audit(receipt),
    (error) => error instanceof NativeCacheHydrationBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID'
      && error.context.failures.includes('reviewedLifecyclePackages')
      && error.context.failures.includes('onlineHydration.install.command'),
  );
});
