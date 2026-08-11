#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment, computeCacheIdentity } from './npm-cache-hydrate.mjs';
import {
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
  NATIVE_PARTIAL_CACHE_MARKER,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NPM_REGISTRY,
  NativeCacheHydrationBlocked,
  blockNativeCache,
  findElectronNodedir,
  fullInstallArgs,
  inspectNativeLockfile,
  parseNativeHydrationArgs,
  validateNativeHydrationReceipt,
  candidateNativeBuildEnvironment,
  candidateNativeCacheEnvironment,
} from './native-cache-policy.mjs';
import {
  NATIVE_REGISTRY_CLOSURE_STRATEGY,
  NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
  NATIVE_REGISTRY_PREFETCH_STRATEGY,
  buildRegistryPrefetchManifest,
  registryCacheClosureArgs,
  registryPrefetchBatchArgs,
  registryPrefetchBatches,
} from './registry-prefetch.mjs';
import {
  OFFLINE_PROFILE,
  classifyNativeTransportFailure,
  findExecutableNative,
  gitNative,
  nativeHydrationProxyProfile,
  nativeHydrationPublicReceiptFields,
  offlineNativeEnvironment,
  onlineNativeEnvironment,
  prepareNativeCacheLayout,
  proxyTransportSummary,
  removeInstallTrees,
  requireNewExternalPath,
  runAsyncRecordedNative,
  runNativeRebuild,
  startAllowlistedConnectProxy,
  verifyProxyAudit,
  writeExclusiveNative,
} from './native-cache-runtime.mjs';

export {
  EXPECTED_LIFECYCLE_PACKAGES,
  NATIVE_BUILD_MODE,
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_NPM_FETCH_RETRIES,
  NATIVE_NPM_FETCH_TIMEOUT_MS,
  NATIVE_NPM_MAX_SOCKETS,
  NATIVE_PARTIAL_CACHE_MARKER,
  NATIVE_PROXY_IDLE_TIMEOUT_MS,
  NATIVE_PROXY_KEEPALIVE_MS,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NPM_REGISTRY,
  NativeCacheHydrationBlocked,
  candidateNativeBuildEnvironment,
  candidateNativeCacheEnvironment,
  fullInstallArgs,
  nativeHydrationTransportPolicy,
  parseNativeHydrationArgs,
  validateNativeHydrationReceipt,
} from './native-cache-policy.mjs';
export { nativeRebuildArgs } from './native-cache-policy.mjs';
export {
  classifyNativeTransportFailure,
  configureNativeTunnelSocket,
  nativeHydrationProxyProfile,
  proxyTransportSummary,
} from './native-cache-runtime.mjs';

function proxySince(proxy, startIndex = 0) {
  return {
    ...proxy,
    requests: (proxy?.requests ?? []).slice(startIndex),
  };
}

function failingProxyEndpoint(proxy, startIndex = 0) {
  const requests = Array.isArray(proxy?.requests) ? proxy.requests.slice(startIndex) : [];
  const request = requests.find((entry) => entry.transport?.fatal === true) ?? requests.at(-1) ?? null;
  return request
    ? {
      host: request.host ?? null,
      port: request.port ?? null,
      transportError: request.transport?.error ?? null,
      durationMs: request.transport?.durationMs ?? null,
      bytesClientToUpstream: request.transport?.bytesClientToUpstream ?? 0,
      bytesUpstreamToClient: request.transport?.bytesUpstreamToClient ?? 0,
    }
    : null;
}

export function partialHydrationFailureDocument({
  sourceCommit,
  blockerCode,
  phase,
  transport,
  proxy,
  commandReceipt,
  endedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    status: 'partial_failed_transport',
    reusable: false,
    passReceiptCreated: false,
    automaticRetry: false,
    sourceCommit,
    blockerCode,
    phase,
    transport,
    proxy: {
      allowedHosts: proxy?.allowedHosts ?? [],
      summary: proxyTransportSummary(proxy),
      failingEndpoint: failingProxyEndpoint(proxy),
    },
    command: commandReceipt
      ? {
        name: commandReceipt.name,
        startedAt: commandReceipt.startedAt,
        endedAt: commandReceipt.endedAt,
        exitCode: commandReceipt.exitCode,
        signal: commandReceipt.signal,
        stdoutPath: commandReceipt.stdoutPath,
        stderrPath: commandReceipt.stderrPath,
      }
      : null,
    endedAt,
  };
}

async function commandOutput(receipt) {
  if (!receipt) return '';
  const [stdout, stderr] = await Promise.all([
    readFile(receipt.stdoutPath, 'utf8').catch(() => ''),
    readFile(receipt.stderrPath, 'utf8').catch(() => ''),
  ]);
  return `${stdout}\n${stderr}`;
}

async function writeTransportFailureMarker({
  layout,
  sourceCommit,
  blockerCode,
  phase,
  transport,
  proxy,
  commandReceipt,
}) {
  const markerPath = path.join(layout.root, NATIVE_PARTIAL_CACHE_MARKER);
  const document = partialHydrationFailureDocument({
    sourceCommit,
    blockerCode,
    phase,
    transport,
    proxy,
    commandReceipt,
  });
  await writeExclusiveNative(markerPath, `${JSON.stringify(document, null, 2)}\n`);
  return markerPath;
}

async function writeRegistryFailureMarker({
  layout,
  sourceCommit,
  blockerCode,
  phase,
  status,
  commandReceipt = null,
  context = {},
}) {
  const markerPath = path.join(layout.root, NATIVE_PARTIAL_CACHE_MARKER);
  const document = {
    schemaVersion: 1,
    status,
    reusable: false,
    passReceiptCreated: false,
    automaticRetry: false,
    sourceCommit,
    blockerCode,
    phase,
    command: commandReceipt
      ? {
        name: commandReceipt.name,
        startedAt: commandReceipt.startedAt,
        endedAt: commandReceipt.endedAt,
        exitCode: commandReceipt.exitCode,
        signal: commandReceipt.signal,
        stdoutPath: commandReceipt.stdoutPath,
        stderrPath: commandReceipt.stderrPath,
      }
      : null,
    context,
    endedAt: new Date().toISOString(),
  };
  await writeExclusiveNative(markerPath, `${JSON.stringify(document, null, 2)}\n`);
  return markerPath;
}

async function failOnlineStage({
  layout,
  sourceCommit,
  proxy,
  stage,
  fallbackCode,
  detail,
  requestStartIndex = 0,
}) {
  const output = await commandOutput(stage);
  const stageProxy = proxySince(proxy, requestStartIndex);
  const proxyErrors = (stageProxy.requests ?? [])
    .map((request) => request.transport?.error?.code)
    .filter(Boolean)
    .join('\n');
  const transport = classifyNativeTransportFailure(`${output}\n${proxyErrors}`);
  if (transport) {
    const markerPath = await writeTransportFailureMarker({
      layout,
      sourceCommit,
      blockerCode: transport.blockerCode,
      phase: stage?.name ?? 'online-hydration',
      transport,
      proxy: stageProxy,
      commandReceipt: stage,
    });
    blockNativeCache(transport.blockerCode, detail, {
      ...stage,
      transport,
      transportSummary: proxyTransportSummary(stageProxy),
      failingEndpoint: failingProxyEndpoint(stageProxy),
      cacheStatus: 'partial_failed_transport',
      cacheReusable: false,
      partialMarkerPath: markerPath,
      automaticRetry: false,
    });
  }
  blockNativeCache(fallbackCode, detail, {
    ...stage,
    requests: stageProxy.requests ?? [],
    automaticRetry: false,
  });
}

async function prefetchRegistryPackages({
  repository,
  npmExecutable,
  layout,
  proxy,
  onlineEnv,
  logRoot,
  sourceCommit,
  manifest,
}) {
  const batches = registryPrefetchBatches(manifest);
  const prefetchRoot = path.join(layout.root, 'registry-prefetch');
  await mkdir(prefetchRoot, { recursive: true, mode: 0o700 });
  const receipts = [];
  for (let index = 0; index < batches.length; index += 1) {
    const batchNumber = index + 1;
    const requestStartIndex = proxy.requests.length;
    const destination = path.join(
      prefetchRoot,
      `batch-${String(batchNumber).padStart(4, '0')}`,
    );
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const stage = await runAsyncRecordedNative({
      name: `bounded-registry-prefetch-${String(batchNumber).padStart(4, '0')}`,
      command: '/usr/bin/sandbox-exec',
      args: [
        '-p',
        nativeHydrationProxyProfile(proxy.port),
        ...registryPrefetchBatchArgs({
          npmExecutable,
          npmCacheDir: layout.npm,
          packDestination: destination,
          entries: batches[index],
        }),
      ],
      cwd: repository,
      env: onlineEnv,
      logRoot,
    });
    if (stage.exitCode !== 0) {
      await failOnlineStage({
        layout,
        sourceCommit,
        proxy,
        stage,
        fallbackCode: 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH',
        detail: `registry prefetch batch ${batchNumber}/${batches.length} failed`,
        requestStartIndex,
      });
    }
    receipts.push(stage);
    await rm(destination, { recursive: true, force: true });
  }
  await rm(prefetchRoot, { recursive: true, force: true });
  return {
    status: 'PASS',
    strategy: NATIVE_REGISTRY_PREFETCH_STRATEGY,
    metadataMode: manifest.metadataMode,
    batchSize: NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
    entryCount: manifest.entryCount,
    manifestSha256: manifest.manifestSha256,
    batchCount: batches.length,
    batches: receipts,
    automaticRetry: false,
  };
}

export async function hydrateNativeToolchainCache(options) {
  process.umask(0o077);
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PLATFORM', 'macOS arm64 is required', {
      platform: process.platform,
      arch: process.arch,
    });
  }
  await access('/usr/bin/sandbox-exec', fsConstants.X_OK).catch(() => {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_SANDBOX', '/usr/bin/sandbox-exec unavailable');
  });

  const repository = await realpath(options.repository);
  const insideWorktree = gitNative(repository, ['rev-parse', '--is-inside-work-tree'], {
    allowFailure: true,
  });
  const actualCommit = gitNative(repository, ['rev-parse', 'HEAD'], { allowFailure: true });
  const branch = gitNative(repository, ['branch', '--show-current'], { allowFailure: true });
  const sourceStatus = gitNative(
    repository,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { allowFailure: true },
  );
  if (
    insideWorktree.status !== 0
    || insideWorktree.stdout.trim() !== 'true'
    || actualCommit.status !== 0
    || actualCommit.stdout.trim() !== options.sourceCommit
    || branch.status !== 0
    || branch.stdout.trim() !== ''
    || sourceStatus.status !== 0
    || sourceStatus.stdout !== ''
  ) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_SOURCE', 'repository must be exact, detached and clean', {
      actualCommit: actualCommit.stdout.trim(),
      branch: branch.stdout.trim(),
      status: sourceStatus.stdout.replaceAll('\n', ' | '),
    });
  }
  try {
    await lstat(path.join(repository, '.npmrc'));
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_NPMRC', 'repository-local .npmrc is not allowed');
  } catch (error) {
    if (error instanceof NativeCacheHydrationBlocked) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }

  const cacheTarget = await requireNewExternalPath(repository, options.cacheDir, 'cache dir');
  options.receiptOutput = await requireNewExternalPath(
    repository,
    options.receiptOutput,
    'receipt output',
  );
  const layout = await prepareNativeCacheLayout(repository, cacheTarget);
  const lockfile = await inspectNativeLockfile(repository);
  const lockfileDocument = JSON.parse(
    await readFile(path.join(repository, 'package-lock.json'), 'utf8'),
  );
  const registryManifest = buildRegistryPrefetchManifest(lockfileDocument);
  const npmExecutable = await findExecutableNative('npm');
  const logRoot = options.receiptOutput.replace(/\.json$/u, '');
  const npmVersion = await runAsyncRecordedNative({
    name: 'npm-version',
    command: npmExecutable,
    args: ['--version'],
    cwd: repository,
    env: cleanEnvironment(),
    logRoot,
  });
  if (npmVersion.exitCode !== 0) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_EXECUTABLE', 'npm --version failed', npmVersion);
  }
  const npmVersionText = (await readFile(npmVersion.stdoutPath, 'utf8')).trim();

  const proxy = await startAllowlistedConnectProxy();
  const proxyUrl = `http://127.0.0.1:${proxy.port}`;
  const onlineEnv = onlineNativeEnvironment({ layout, proxyUrl });
  const lifecycleEnv = {
    ...onlineEnv,
    npm_config_offline: 'true',
    npm_config_prefer_online: 'false',
  };
  let registryPrefetch;
  let registryCacheClosure;
  let onlineInstall;
  let onlineNative;
  let registryRequestsAfterClosure = [];
  try {
    registryPrefetch = await prefetchRegistryPackages({
      repository,
      npmExecutable,
      layout,
      proxy,
      onlineEnv,
      logRoot,
      sourceCommit: options.sourceCommit,
      manifest: registryManifest,
    });

    registryCacheClosure = await runAsyncRecordedNative({
      name: 'deny-network-registry-cache-closure-proof',
      command: '/usr/bin/sandbox-exec',
      args: [
        '-p',
        OFFLINE_PROFILE,
        ...registryCacheClosureArgs({
          npmExecutable,
          npmCacheDir: layout.npm,
        }),
      ],
      cwd: repository,
      env: offlineNativeEnvironment(layout),
      logRoot,
    });
    if (registryCacheClosure.exitCode !== 0) {
      const markerPath = await writeRegistryFailureMarker({
        layout,
        sourceCommit: options.sourceCommit,
        blockerCode: 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE',
        phase: registryCacheClosure.name,
        status: 'partial_failed_registry_cache',
        commandReceipt: registryCacheClosure,
        context: {
          strategy: NATIVE_REGISTRY_PREFETCH_STRATEGY,
          closureStrategy: NATIVE_REGISTRY_CLOSURE_STRATEGY,
          manifestSha256: registryManifest.manifestSha256,
          entryCount: registryManifest.entryCount,
        },
      });
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE',
        'prefetched npm cache does not satisfy deny-network npm ci --ignore-scripts',
        {
          ...registryCacheClosure,
          cacheStatus: 'partial_failed_registry_cache',
          cacheReusable: false,
          partialMarkerPath: markerPath,
          automaticRetry: false,
        },
      );
    }
    await removeInstallTrees(repository);

    const postClosureRequestStart = proxy.requests.length;
    const lifecycleRequestStart = proxy.requests.length;
    onlineInstall = await runAsyncRecordedNative({
      name: 'bounded-native-toolchain-lifecycle-install',
      command: '/usr/bin/sandbox-exec',
      args: [
        '-p',
        nativeHydrationProxyProfile(proxy.port),
        ...fullInstallArgs({ npmExecutable, npmCacheDir: layout.npm, online: false }),
      ],
      cwd: repository,
      env: lifecycleEnv,
      logRoot,
    });
    if (onlineInstall.exitCode !== 0) {
      await failOnlineStage({
        layout,
        sourceCommit: options.sourceCommit,
        proxy,
        stage: onlineInstall,
        fallbackCode: 'BLOCKED_NATIVE_CACHE_HYDRATION_ONLINE_INSTALL',
        detail: 'metadata-complete registry-offline lifecycle install failed',
        requestStartIndex: lifecycleRequestStart,
      });
    }

    const nativeRequestStart = proxy.requests.length;
    onlineNative = await runNativeRebuild({
      repository,
      npmExecutable,
      electronVersion: lockfile.electronVersion,
      arch: 'arm64',
      env: lifecycleEnv,
      sandboxProfile: nativeHydrationProxyProfile(proxy.port),
      logRoot,
      name: 'bounded-electron-native-arm64-hydration',
    });
    if (onlineNative?.exitCode !== 0 || !onlineNative?.binary) {
      await failOnlineStage({
        layout,
        sourceCommit: options.sourceCommit,
        proxy,
        stage: onlineNative,
        fallbackCode: 'BLOCKED_NATIVE_CACHE_HYDRATION_ONLINE_NATIVE',
        detail: 'Electron native hydration failed',
        requestStartIndex: nativeRequestStart,
      });
    }

    registryRequestsAfterClosure = proxy.requests
      .slice(postClosureRequestStart)
      .filter((request) => request.host === 'registry.npmjs.org');
    if (registryRequestsAfterClosure.length > 0) {
      const markerPath = await writeRegistryFailureMarker({
        layout,
        sourceCommit: options.sourceCommit,
        blockerCode: 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH',
        phase: 'post-prefetch-lifecycle-assets',
        status: 'partial_failed_registry_leak',
        context: {
          requestCount: registryRequestsAfterClosure.length,
          requests: registryRequestsAfterClosure,
        },
      });
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH',
        'registry network access occurred after deny-network cache closure proof',
        {
          requestCount: registryRequestsAfterClosure.length,
          requests: registryRequestsAfterClosure,
          cacheStatus: 'partial_failed_registry_leak',
          cacheReusable: false,
          partialMarkerPath: markerPath,
          automaticRetry: false,
        },
      );
    }
  } finally {
    await proxy.close();
  }

  const transportSummary = verifyProxyAudit(proxy);
  const electronNodedir = await findElectronNodedir(layout.nodeGyp, lockfile.electronVersion);
  await removeInstallTrees(repository);
  const offlineInstall = await runAsyncRecordedNative({
    name: 'deny-network-full-install-proof',
    command: '/usr/bin/sandbox-exec',
    args: [
      '-p',
      OFFLINE_PROFILE,
      ...fullInstallArgs({ npmExecutable, npmCacheDir: layout.npm, online: false }),
    ],
    cwd: repository,
    env: offlineNativeEnvironment(layout),
    logRoot,
  });
  if (offlineInstall.exitCode !== 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_OFFLINE_INSTALL_PROOF',
      'cache does not satisfy full lifecycle npm ci under deny-network',
      offlineInstall,
    );
  }
  const offlineNative = await runNativeRebuild({
    repository,
    npmExecutable,
    electronVersion: lockfile.electronVersion,
    arch: 'arm64',
    env: offlineNativeEnvironment(layout, electronNodedir),
    sandboxProfile: OFFLINE_PROFILE,
    logRoot,
    name: 'deny-network-electron-native-arm64-proof',
  });
  if (offlineNative.exitCode !== 0 || !offlineNative.binary) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_OFFLINE_NATIVE_PROOF',
      'cache does not satisfy Electron native arm64 rebuild under deny-network',
      offlineNative,
    );
  }

  const electronExecutable = path.join(
    repository,
    'apps/copilot-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  );
  const electronStat = await stat(electronExecutable).catch(() => null);
  if (!electronStat?.isFile() || electronStat.size < 1) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_ELECTRON_BINARY',
      'offline install did not restore the desktop Electron executable',
      { electronExecutable },
    );
  }

  await removeInstallTrees(repository);
  const finalStatus = gitNative(
    repository,
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ).stdout;
  if (finalStatus !== '') {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_SOURCE', 'hydration changed source', {
      status: finalStatus.replaceAll('\n', ' | '),
    });
  }

  const cacheIdentity = await computeCacheIdentity(layout.root);
  const receipt = {
    schemaVersion: NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
    status: 'PASS',
    ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
    authorityScope: 'single-exact-commit-bounded-native-toolchain-cache-hydration',
    sourceCommit: options.sourceCommit,
    registry: NPM_REGISTRY,
    ...nativeHydrationPublicReceiptFields(),
    lifecycleScriptsEnabled: true,
    reviewedLifecyclePackages: lockfile.lifecyclePackages,
    candidateInstallMode: 'offline-lifecycle-scripts-enabled',
    automaticRetry: false,
    candidateCreated: false,
    evidenceCreated: false,
    npmExecutable,
    npmVersion: npmVersionText,
    lockfile,
    registryPrefetch,
    registryCacheClosure: {
      status: 'PASS',
      strategy: NATIVE_REGISTRY_CLOSURE_STRATEGY,
      networkAuthority: 'deny-network',
      lifecycleScriptsEnabled: false,
      ...registryCacheClosure,
    },
    cacheLayout: layout,
    electronNodedir,
    cacheIdentity,
    onlineHydration: {
      status: 'PASS',
      registryMode: 'lockfile-name-version-prefetch-closure-then-offline-ci',
      registryRequestCountAfterClosure: registryRequestsAfterClosure.length,
      install: onlineInstall,
      nativeArm64: onlineNative,
      proxy: {
        allowedHosts: proxy.allowedHosts,
        requests: proxy.requests,
        transportSummary,
        allRequestsAllowed: proxy.requests.length > 0
          && proxy.requests.every((request) => request.allowed === true),
      },
    },
    offlineInstallProof: {
      status: 'PASS',
      networkAuthority: 'deny-network',
      lifecycleScriptsEnabled: true,
      electronExecutableBytes: electronStat.size,
      ...offlineInstall,
    },
    offlineNativeProof: {
      status: 'PASS',
      networkAuthority: 'deny-network',
      ...offlineNative,
    },
    endedAt: new Date().toISOString(),
  };
  await writeExclusiveNative(options.receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function main() {
  try {
    const options = parseNativeHydrationArgs(process.argv.slice(2));
    const receipt = await hydrateNativeToolchainCache(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const blocked = error instanceof NativeCacheHydrationBlocked
      ? error
      : new NativeCacheHydrationBlocked(
        'BLOCKED_NATIVE_CACHE_HYDRATION_UNEXPECTED',
        error instanceof Error ? error.message : String(error),
      );
    process.stderr.write(`${JSON.stringify({
      schemaVersion: NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
      status: 'BLOCKED',
      code: blocked.code,
      detail: blocked.detail,
      context: blocked.context,
      automaticRetry: false,
      candidateCreated: false,
      evidenceCreated: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const currentScript = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentScript) await main();
