#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs';
import { access, lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment, computeCacheIdentity } from './npm-cache-hydrate.mjs';
import {
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
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
  OFFLINE_PROFILE,
  findExecutableNative,
  gitNative,
  nativeHydrationProxyProfile,
  nativeHydrationPublicReceiptFields,
  offlineNativeEnvironment,
  onlineNativeEnvironment,
  prepareNativeCacheLayout,
  removeInstallTrees,
  requireNewExternalPath,
  runAsyncRecordedNative,
  runNativeRebuild,
  startAllowlistedConnectProxy,
  verifyProxyAudit,
  writeExclusiveNative,
} from './native-cache-runtime.mjs';

export {
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  NATIVE_BUILD_MODE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NPM_REGISTRY,
  NativeCacheHydrationBlocked,
  candidateNativeBuildEnvironment,
  candidateNativeCacheEnvironment,
  fullInstallArgs,
  parseNativeHydrationArgs,
  validateNativeHydrationReceipt,
} from './native-cache-policy.mjs';
export { nativeRebuildArgs } from './native-cache-policy.mjs';
export { nativeHydrationProxyProfile } from './native-cache-runtime.mjs';

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
  let onlineInstall;
  let onlineNative;
  try {
    onlineInstall = await runAsyncRecordedNative({
      name: 'bounded-native-toolchain-install',
      command: '/usr/bin/sandbox-exec',
      args: [
        '-p',
        nativeHydrationProxyProfile(proxy.port),
        ...fullInstallArgs({ npmExecutable, npmCacheDir: layout.npm, online: true }),
      ],
      cwd: repository,
      env: onlineEnv,
      logRoot,
    });
    if (onlineInstall.exitCode === 0) {
      onlineNative = await runNativeRebuild({
        repository,
        npmExecutable,
        electronVersion: lockfile.electronVersion,
        arch: 'arm64',
        env: onlineEnv,
        sandboxProfile: nativeHydrationProxyProfile(proxy.port),
        logRoot,
        name: 'bounded-electron-native-arm64-hydration',
      });
    }
  } finally {
    await proxy.close();
  }
  verifyProxyAudit(proxy);
  if (onlineInstall?.exitCode !== 0) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_ONLINE_INSTALL', 'bounded lifecycle install failed', {
      ...onlineInstall,
      requests: proxy.requests,
    });
  }
  if (onlineNative?.exitCode !== 0 || !onlineNative?.binary) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_ONLINE_NATIVE', 'Electron native hydration failed', {
      ...onlineNative,
      requests: proxy.requests,
    });
  }

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
    cacheLayout: layout,
    electronNodedir,
    cacheIdentity,
    onlineHydration: {
      status: 'PASS',
      install: onlineInstall,
      nativeArm64: onlineNative,
      proxy: {
        allowedHosts: proxy.allowedHosts,
        requests: proxy.requests,
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
