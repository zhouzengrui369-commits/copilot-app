import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_NPM_FETCH_RETRIES,
  NATIVE_NPM_FETCH_TIMEOUT_MS,
  NATIVE_NPM_MAX_SOCKETS,
  NATIVE_PROXY_IDLE_TIMEOUT_MS,
  NATIVE_PROXY_KEEPALIVE_MS,
  NATIVE_PROXY_GRACEFUL_CONTROL_ERROR,
  NATIVE_PROXY_GRACEFUL_CONTROL_HOST,
  NATIVE_PROXY_GRACEFUL_CONTROL_MAX_BYTES,
  NATIVE_PROXY_UPSTREAM_FAMILY,
  nativeHydrationTransportPolicy,
  partialHydrationFailureDocument,
} from './npm-native-cache-hydrate.mjs';
import {
  classifyNativeTransportFailure,
  configureNativeTunnelSocket,
  nativeHydrationUpstreamErrorDisposition,
  nativeHydrationUpstreamConnectOptions,
  proxyTransportSummary,
} from './native-cache-runtime.mjs';

function transport({
  bytesClientToUpstream = 128,
  bytesUpstreamToClient = 256,
  fatal = false,
  error = null,
} = {}) {
  return {
    startedAt: '2026-08-03T12:00:00.000Z',
    endedAt: '2026-08-03T12:00:01.000Z',
    durationMs: 1000,
    bytesClientToUpstream,
    bytesUpstreamToClient,
    fatal,
    error,
    socketPolicy: {
      keepAlive: true,
      keepAliveMs: NATIVE_PROXY_KEEPALIVE_MS,
      noDelay: true,
      idleTimeoutMs: NATIVE_PROXY_IDLE_TIMEOUT_MS,
      upstreamFamily: NATIVE_PROXY_UPSTREAM_FAMILY,
    },
  };
}

test('native transport policy keeps retries disabled and bounds concurrency', () => {
  assert.equal(NATIVE_NPM_FETCH_RETRIES, 0);
  assert.equal(NATIVE_NPM_FETCH_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(NATIVE_NPM_MAX_SOCKETS, 4);
  assert.deepEqual(nativeHydrationTransportPolicy(), {
    automaticRetry: false,
    npmFetchRetries: 0,
    npmFetchTimeoutMs: 15 * 60 * 1000,
    npmMaxSockets: 4,
    proxyKeepAliveMs: 30_000,
    proxyIdleTimeoutMs: 20 * 60 * 1000,
    proxyUpstreamFamily: 4,
    proxyGracefulControlHost: 'github.com',
    proxyGracefulControlError: 'ETIMEDOUT',
    proxyGracefulControlMaxBytes: 64 * 1024,
    electronArtifactPrefetchPhase: 'electron-artifact-range-prefetch',
    electronArtifactPrefetchStrategy: 'official-electron-embedded-sha256-bounded-range-v1',
    electronArtifactRangeBytes: 1024 * 1024,
    electronArtifactRangeConcurrency: 4,
    electronArtifactRangeMaxAttempts: 3,
    electronArtifactRangeTimeoutMs: 10 * 60 * 1000,
    electronArtifactMaxBytes: 512 * 1024 * 1024,
    electronArtifactHosts: [
      'artifacts.electronjs.org',
      'github-releases.githubusercontent.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ],
    electronArtifactRecoverableErrors: [
      'ECONNABORTED',
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
    ],
    electronArtifactMaxTunnelBytes: 1024 * 1024 + 512 * 1024,
    partialCacheReuse: false,
  });
});

test('only a late GitHub control-response timeout receives graceful EOF', () => {
  assert.equal(NATIVE_PROXY_GRACEFUL_CONTROL_HOST, 'github.com');
  assert.equal(NATIVE_PROXY_GRACEFUL_CONTROL_ERROR, 'ETIMEDOUT');
  assert.equal(NATIVE_PROXY_GRACEFUL_CONTROL_MAX_BYTES, 64 * 1024);
  assert.deepEqual(nativeHydrationUpstreamErrorDisposition({
    host: 'github.com',
    errorCode: 'ETIMEDOUT',
    bytesUpstreamToClient: 3_088,
  }), {
    action: 'graceful-eof',
    fatal: false,
    reason: 'late-github-control-response-timeout',
    downstreamValidationRequired: true,
  });
});

test('asset, zero-byte, oversized and non-timeout upstream errors remain fail-closed', () => {
  for (const input of [
    { host: 'release-assets.githubusercontent.com', errorCode: 'ETIMEDOUT', bytesUpstreamToClient: 121_555_082 },
    { host: 'github.com', errorCode: 'ETIMEDOUT', bytesUpstreamToClient: 0 },
    { host: 'github.com', errorCode: 'ETIMEDOUT', bytesUpstreamToClient: 64 * 1024 + 1 },
    { host: 'github.com', errorCode: 'ECONNRESET', bytesUpstreamToClient: 3_088 },
  ]) {
    assert.deepEqual(nativeHydrationUpstreamErrorDisposition(input), {
      action: 'fail-closed-destroy',
      fatal: true,
      reason: 'untrusted-or-incomplete-upstream-termination',
      downstreamValidationRequired: false,
    });
  }
});

test('only the explicit Electron range phase can classify a bounded asset reset for checksum-gated retry', () => {
  assert.deepEqual(nativeHydrationUpstreamErrorDisposition({
    host: 'release-assets.githubusercontent.com',
    errorCode: 'ECONNRESET',
    bytesUpstreamToClient: 503_434,
    phase: 'electron-artifact-range-prefetch',
  }), {
    action: 'bounded-range-retry',
    fatal: false,
    reason: 'integrity-verified-electron-range-retry',
    downstreamValidationRequired: true,
  });
  assert.equal(nativeHydrationUpstreamErrorDisposition({
    host: 'release-assets.githubusercontent.com',
    errorCode: 'ECONNRESET',
    bytesUpstreamToClient: 503_434,
  }).fatal, true);
});

test('native proxy uses one receipt-bound IPv4 upstream connection without hydration retry', () => {
  assert.equal(NATIVE_PROXY_UPSTREAM_FAMILY, 4);
  assert.deepEqual(nativeHydrationUpstreamConnectOptions('registry.npmjs.org'), {
    host: 'registry.npmjs.org',
    port: 443,
    allowHalfOpen: true,
    family: 4,
  });
  assert.throws(
    () => nativeHydrationUpstreamConnectOptions(''),
    /native hydration upstream host is required/u,
  );
  assert.equal(nativeHydrationTransportPolicy().automaticRetry, false);
  assert.equal(nativeHydrationTransportPolicy().npmFetchRetries, 0);
});

test('native tunnel sockets receive keepalive, no-delay and long idle timeout', () => {
  const calls = [];
  const socket = {
    setKeepAlive(enabled, delay) { calls.push(['keepAlive', enabled, delay]); },
    setNoDelay(enabled) { calls.push(['noDelay', enabled]); },
    setTimeout(timeout) { calls.push(['timeout', timeout]); },
  };
  assert.deepEqual(configureNativeTunnelSocket(socket), {
    keepAlive: true,
    keepAliveMs: NATIVE_PROXY_KEEPALIVE_MS,
    noDelay: true,
    idleTimeoutMs: NATIVE_PROXY_IDLE_TIMEOUT_MS,
  });
  assert.deepEqual(calls, [
    ['keepAlive', true, NATIVE_PROXY_KEEPALIVE_MS],
    ['noDelay', true],
    ['timeout', NATIVE_PROXY_IDLE_TIMEOUT_MS],
  ]);
});

test('ECONNRESET is classified as a stable no-retry hydration blocker', () => {
  assert.deepEqual(
    classifyNativeTransportFailure('npm error code ECONNRESET\nnpm error network aborted'),
    {
      blockerCode: 'BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET',
      transportCode: 'ECONNRESET',
      automaticRetry: false,
      retryAllowed: false,
    },
  );
  assert.equal(classifyNativeTransportFailure('ordinary npm lifecycle failure'), null);
});

test('proxy summary preserves request counts, bytes and fatal transport errors', () => {
  const proxy = {
    socketPolicy: transport().socketPolicy,
    requests: [
      {
        allowed: true,
        transport: transport(),
      },
      {
        allowed: true,
        transport: transport({
          bytesClientToUpstream: 32,
          bytesUpstreamToClient: 64,
          fatal: true,
          error: { side: 'upstream', code: 'ECONNRESET' },
        }),
      },
    ],
  };
  assert.deepEqual(proxyTransportSummary(proxy), {
    requestCount: 2,
    allowedCount: 2,
    deniedCount: 0,
    completedCount: 2,
    transportErrorCount: 1,
    recoverableTransportErrorCount: 0,
    boundedRangeRetryCount: 0,
    bytesClientToUpstream: 160,
    bytesUpstreamToClient: 320,
    socketPolicy: proxy.socketPolicy,
  });
});

test('partial transport failure document is diagnostic-only and cannot be a PASS receipt', () => {
  const proxy = {
    allowedHosts: ['registry.npmjs.org'],
    socketPolicy: transport().socketPolicy,
    requests: [{
      method: 'CONNECT',
      host: 'registry.npmjs.org',
      port: 443,
      allowed: true,
      transport: transport({
        fatal: true,
        error: { side: 'upstream', code: 'ECONNRESET' },
      }),
    }],
  };
  const result = partialHydrationFailureDocument({
    sourceCommit: 'a'.repeat(40),
    blockerCode: 'BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET',
    phase: 'bounded-native-toolchain-install',
    transport: classifyNativeTransportFailure('ECONNRESET'),
    proxy,
    commandReceipt: {
      name: 'bounded-native-toolchain-install',
      startedAt: '2026-08-03T12:00:00.000Z',
      endedAt: '2026-08-03T12:00:01.000Z',
      exitCode: 1,
      signal: null,
      stdoutPath: '/tmp/install.stdout.log',
      stderrPath: '/tmp/install.stderr.log',
    },
    endedAt: '2026-08-03T12:00:02.000Z',
  });
  assert.equal(result.status, 'partial_failed_transport');
  assert.equal(result.reusable, false);
  assert.equal(result.passReceiptCreated, false);
  assert.equal(result.automaticRetry, false);
  assert.equal(result.proxy.summary.transportErrorCount, 1);
});
