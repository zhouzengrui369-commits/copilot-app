import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_LIFECYCLE_PACKAGES,
  NATIVE_BUILD_MODE,
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_NPM_FETCH_RETRIES,
  NATIVE_NPM_FETCH_TIMEOUT_MS,
  NATIVE_NPM_MAX_SOCKETS,
  NATIVE_PARTIAL_CACHE_MARKER,
  NATIVE_TOOLCHAIN_PROFILE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NativeCacheHydrationBlocked,
  candidateNativeBuildEnvironment,
  candidateNativeCacheEnvironment,
  fullInstallArgs,
  nativeHydrationProxyProfile,
  nativeHydrationTransportPolicy,
  nativeRebuildArgs,
  parseNativeHydrationArgs,
  validateNativeHydrationReceipt,
} from './npm-native-cache-hydrate.mjs';
import { offlineNativeEnvironment, onlineNativeEnvironment } from './native-cache-runtime.mjs';
import {
  computeCacheIdentity,
  ensureIsolatedNpmConfigFiles,
  inspectLockfileDocument,
} from './npm-cache-hydrate.mjs';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';

const REGISTRY = 'https://registry.npmjs.org/';

function lifecycleLock() {
  const packages = { '': { name: 'fixture', version: '1.0.0' } };
  for (const [packagePath, version] of EXPECTED_LIFECYCLE_PACKAGES) {
    const packageName = packagePath.split('/node_modules/').at(-1) ?? packagePath;
    packages[packagePath] = {
      version,
      resolved: `${REGISTRY}${packageName}/-/${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`,
      integrity: `sha512-${packagePath.replaceAll('/', '-')}`,
      hasInstallScript: true,
    };
  }
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}

test('requires the exact bounded native-toolchain owner token and absolute paths', () => {
  const parsed = parseNativeHydrationArgs([
    '--repository', '/tmp/repo',
    '--source-commit', 'a'.repeat(40),
    '--cache-dir', '/tmp/native-cache',
    '--receipt-output', '/tmp/native-receipt.json',
    '--owner-authority', OWNER_NATIVE_CACHE_AUTHORITY,
  ]);
  assert.equal(parsed.sourceCommit, 'a'.repeat(40));
  assert.throws(
    () => parseNativeHydrationArgs([
      '--source-commit', 'a'.repeat(40),
      '--cache-dir', '/tmp/native-cache',
      '--receipt-output', '/tmp/native-receipt.json',
      '--owner-authority', 'OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS',
    ]),
    /BLOCKED_NATIVE_CACHE_HYDRATION_OWNER_AUTHORITY/u,
  );
  assert.throws(
    () => parseNativeHydrationArgs([
      '--source-commit', 'a'.repeat(40),
      '--cache-dir', 'relative',
      '--receipt-output', '/tmp/native-receipt.json',
      '--owner-authority', OWNER_NATIVE_CACHE_AUTHORITY,
    ]),
    /BLOCKED_NATIVE_CACHE_HYDRATION_PATH/u,
  );
});

test('online child sees only one localhost proxy while host policy remains exact', () => {
  const profile = nativeHydrationProxyProfile(43123);
  assert.match(profile, /deny network\*/u);
  assert.match(profile, /localhost:43123/u);
  assert.doesNotMatch(profile, /github\.com|nodejs\.org|electronjs\.org|registry\.npmjs\.org/u);
  assert.deepEqual([...NATIVE_HYDRATION_HOSTS].sort(), [
    'artifacts.electronjs.org',
    'electronjs.org',
    'github-releases.githubusercontent.com',
    'github.com',
    'nodejs.org',
    'objects.githubusercontent.com',
    'registry.npmjs.org',
    'release-assets.githubusercontent.com',
  ]);
});

test('native hydration strips inherited authority and applies explicit no-retry transport policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-env-'));
  try {
    await ensureIsolatedNpmConfigFiles({
      userConfigPath: path.join(root, 'user.npmrc'),
      globalConfigPath: path.join(root, 'global.npmrc'),
    });
    const previous = {
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR,
      ELECTRON_GET_USE_PROXY: process.env.ELECTRON_GET_USE_PROXY,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      npm_config_disturl: process.env.npm_config_disturl,
    };
    try {
      process.env.ELECTRON_MIRROR = 'https://attacker.invalid/';
      process.env.ELECTRON_GET_USE_PROXY = 'attacker-controlled';
      process.env.GITHUB_TOKEN = 'secret';
      process.env.npm_config_disturl = 'https://attacker.invalid/headers';
      const layout = {
        root,
        npm: path.join(root, 'npm'),
        electron: path.join(root, 'electron'),
        electronBuilder: path.join(root, 'electron-builder'),
        nodeGyp: path.join(root, 'node-gyp'),
        prebuild: path.join(root, 'prebuild'),
      };
      const env = onlineNativeEnvironment({
        layout,
        proxyUrl: 'http://127.0.0.1:43123',
      });
      assert.equal(env.ELECTRON_MIRROR, undefined);
      assert.equal(env.ELECTRON_GET_USE_PROXY, 'true');
      assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.npm_config_disturl, undefined);
      assert.equal(env.NO_PROXY, undefined);
      assert.equal(env.no_proxy, undefined);
      assert.equal(env.npm_config_build_from_source, 'true');
      assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:43123');
      assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:43123');
      assert.equal(env.npm_config_fetch_retries, String(NATIVE_NPM_FETCH_RETRIES));
      assert.equal(env.npm_config_fetch_timeout, String(NATIVE_NPM_FETCH_TIMEOUT_MS));
      assert.equal(env.npm_config_maxsockets, String(NATIVE_NPM_MAX_SOCKETS));
      assert.equal(env.npm_config_fetch_retry_factor, '0');
      assert.equal(env.npm_config_progress, 'false');

      const offlineEnv = offlineNativeEnvironment(layout);
      assert.equal(offlineEnv.ELECTRON_GET_USE_PROXY, undefined);
      assert.equal(offlineEnv.HTTP_PROXY, undefined);
      assert.equal(offlineEnv.HTTPS_PROXY, undefined);
      assert.equal(offlineEnv.NO_PROXY, undefined);
      assert.equal(offlineEnv.no_proxy, undefined);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate install and offline proof keep lifecycle scripts enabled', () => {
  const offline = fullInstallArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
    online: false,
  });
  assert.ok(offline.includes('--offline'));
  assert.ok(offline.includes(NPM_CACHE_KEY_ALIGNMENT_FLAG));
  assert.equal(offline.includes('--ignore-scripts'), false);
  assert.equal(offline.some((value) => /https?:\/\//u.test(value)), false);

  const online = fullInstallArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
    online: true,
  });
  assert.ok(online.includes('--prefer-online'));
  assert.ok(online.includes(REGISTRY));
  assert.equal(online.includes('--ignore-scripts'), false);
});

test('native rebuild is exact Electron arm64 source-build work', () => {
  assert.deepEqual(nativeRebuildArgs({
    npmExecutable: '/usr/local/bin/npm',
    electronVersion: '38.8.6',
    arch: 'arm64',
  }), [
    '/usr/local/bin/npm',
    'rebuild',
    '--runtime=electron',
    '--target=38.8.6',
    '--arch=arm64',
    '--dist-url=https://electronjs.org/headers',
    '--build-from-source',
  ]);
});

test('the exact package lock has only the reviewed lifecycle script set', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  inspectLockfileDocument(lock);
  const actual = Object.entries(lock.packages)
    .filter(([, entry]) => entry?.hasInstallScript === true)
    .map(([packagePath, entry]) => [packagePath, String(entry.version ?? '')])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(actual, EXPECTED_LIFECYCLE_PACKAGES);
});

test('candidate environment is receipt-bound and separates host and Electron headers', () => {
  const input = {
    cacheIdentity: { path: '/tmp/native-cache' },
    cacheLayout: {
      root: '/tmp/native-cache',
      npm: '/tmp/native-cache/npm',
      electron: '/tmp/native-cache/electron',
      electronBuilder: '/tmp/native-cache/electron-builder',
      nodeGyp: '/tmp/native-cache/node-gyp',
      prebuild: '/tmp/native-cache/prebuild',
    },
    electronNodedir: '/tmp/native-cache/node-gyp/38.8.6',
  };
  const install = candidateNativeCacheEnvironment(input);
  assert.equal(install.npm_config_cache, '/tmp/native-cache/npm');
  assert.equal(install.npm_config_devdir, '/tmp/native-cache/node-gyp');
  assert.equal(install.npm_config_nodedir, undefined);
  assert.equal(install.ELECTRON_CACHE, '/tmp/native-cache/electron');
  assert.equal(install.ELECTRON_BUILDER_CACHE, '/tmp/native-cache/electron-builder');
  assert.equal(install.PREBUILD_INSTALL_CACHE, '/tmp/native-cache/prebuild');
  assert.equal(install.ELECTRON_GET_USE_PROXY, undefined);
  assert.equal(install.npm_config_offline, 'true');
  assert.equal(install.npm_config_fetch_retries, '0');
  assert.equal(install.npm_config_build_from_source, 'true');
  assert.equal(install.COPILOT_NATIVE_CACHE_PROFILE, NATIVE_TOOLCHAIN_PROFILE);
  const build = candidateNativeBuildEnvironment(input);
  assert.equal(build.npm_config_nodedir, '/tmp/native-cache/node-gyp/38.8.6');
});

test('receipt validation requires metadata-complete registry closure and canonical transport proof', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-receipt-'));
  const repository = path.join(root, 'repo');
  const requestedCacheDir = path.join(root, 'cache');
  const receiptPath = path.join(root, 'receipt.json');
  const sourceCommit = 'b'.repeat(40);
  try {
    await mkdir(path.join(repository, 'apps/copilot-desktop'), { recursive: true });
    await mkdir(requestedCacheDir);
    const cacheDir = await realpath(requestedCacheDir);
    const layout = {
      root: cacheDir,
      npm: path.join(cacheDir, 'npm'),
      electron: path.join(cacheDir, 'electron'),
      electronBuilder: path.join(cacheDir, 'electron-builder'),
      nodeGyp: path.join(cacheDir, 'node-gyp'),
      prebuild: path.join(cacheDir, 'prebuild'),
    };
    for (const target of Object.values(layout)) await mkdir(target, { recursive: true });
    const electronNodedir = path.join(layout.nodeGyp, '38.8.6');
    await mkdir(path.join(electronNodedir, 'include/node'), { recursive: true });
    await writeFile(path.join(electronNodedir, 'include/node/node.h'), 'header\n');
    await writeFile(path.join(electronNodedir, 'common.gypi'), '{}\n');
    await writeFile(path.join(layout.npm, 'entry'), 'cache\n');
    await ensureIsolatedNpmConfigFiles({
      userConfigPath: path.join(cacheDir, 'npm-config/user.npmrc'),
      globalConfigPath: path.join(cacheDir, 'npm-config/global.npmrc'),
    });

    const lock = lifecycleLock();
    const lockText = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(path.join(repository, 'package-lock.json'), lockText);
    await writeFile(path.join(repository, 'apps/copilot-desktop/package.json'), JSON.stringify({
      devDependencies: { electron: '38.8.6' },
    }));
    await writeFile(
      path.join(repository, 'apps/copilot-desktop/electron-builder.yml'),
      'electronVersion: 38.8.6\n',
    );

    const cacheIdentity = await computeCacheIdentity(cacheDir);
    const lockSha256 = createHash('sha256').update(Buffer.from(lockText)).digest('hex');
    const baseReceipt = {
      schemaVersion: NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
      status: 'PASS',
      ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
      sourceCommit,
      profile: NATIVE_TOOLCHAIN_PROFILE,
      registry: REGISTRY,
      lifecycleScriptsEnabled: true,
      nativeBuildMode: NATIVE_BUILD_MODE,
      candidateInstallMode: 'offline-lifecycle-scripts-enabled',
      automaticRetry: false,
      transportPolicy: nativeHydrationTransportPolicy(),
      candidateCreated: false,
      evidenceCreated: false,
      registryPrefetch: {
        status: 'PASS',
        strategy: 'lockfile-batched-name-version-npm-pack-v2',
        metadataMode: 'name-version-packument-and-tarball',
        automaticRetry: false,
        batchSize: 24,
        entryCount: 1,
        batchCount: 1,
        manifestSha256: 'a'.repeat(64),
      },
      registryCacheClosure: {
        status: 'PASS',
        strategy: 'deny-network-offline-ci-ignore-scripts-v1',
        networkAuthority: 'deny-network',
        lifecycleScriptsEnabled: false,
      },
      cacheLayout: layout,
      electronNodedir,
      cacheIdentity,
      lockfile: {
        sha256: lockSha256,
        lifecyclePackages: EXPECTED_LIFECYCLE_PACKAGES,
      },
      onlineHydration: {
        status: 'PASS',
        registryMode: 'lockfile-name-version-prefetch-closure-then-offline-ci',
        registryRequestCountAfterClosure: 0,
        proxy: {
          allowedHosts: [...NATIVE_HYDRATION_HOSTS].sort(),
          allRequestsAllowed: true,
          transportSummary: { transportErrorCount: 0 },
        },
      },
      offlineInstallProof: { status: 'PASS', networkAuthority: 'deny-network' },
      offlineNativeProof: { status: 'PASS', arch: 'arm64' },
    };
    await writeFile(receiptPath, `${JSON.stringify(baseReceipt, null, 2)}\n`);
    const validated = await validateNativeHydrationReceipt({
      repository,
      sourceCommit,
      cacheDir,
      receiptPath,
    });
    assert.match(validated.receiptSha256, /^[0-9a-f]{64}$/u);

    for (const mutated of [
      { ...baseReceipt, lifecycleScriptsEnabled: false },
      {
        ...baseReceipt,
        transportPolicy: { ...baseReceipt.transportPolicy, npmFetchRetries: 1 },
      },
      {
        ...baseReceipt,
        registryCacheClosure: { ...baseReceipt.registryCacheClosure, status: 'BLOCKED' },
      },
      {
        ...baseReceipt,
        onlineHydration: { ...baseReceipt.onlineHydration, registryRequestCountAfterClosure: 1 },
      },
    ]) {
      await writeFile(receiptPath, `${JSON.stringify(mutated, null, 2)}\n`);
      await assert.rejects(
        validateNativeHydrationReceipt({ repository, sourceCommit, cacheDir, receiptPath }),
        (error) => error instanceof NativeCacheHydrationBlocked
          && error.code === 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt validation rejects any cache marked as partial hydration failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-partial-'));
  const repository = path.join(root, 'repo');
  const cacheDir = path.join(root, 'cache');
  const receiptPath = path.join(root, 'receipt.json');
  try {
    await mkdir(path.join(repository, 'apps/copilot-desktop'), { recursive: true });
    await mkdir(cacheDir);
    await writeFile(path.join(cacheDir, NATIVE_PARTIAL_CACHE_MARKER), JSON.stringify({
      status: 'partial_failed_registry_cache',
      reusable: false,
    }));
    await writeFile(receiptPath, '{}\n');
    await assert.rejects(
      validateNativeHydrationReceipt({
        repository,
        sourceCommit: 'c'.repeat(40),
        cacheDir,
        receiptPath,
      }),
      (error) => error instanceof NativeCacheHydrationBlocked
        && error.code === 'BLOCKED_NATIVE_CACHE_RECEIPT_PARTIAL_CACHE',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
