import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  NATIVE_BUILD_MODE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NativeCacheHydrationBlocked,
  candidateNativeBuildEnvironment,
  candidateNativeCacheEnvironment,
  fullInstallArgs,
  nativeHydrationProxyProfile,
  nativeRebuildArgs,
  parseNativeHydrationArgs,
  validateNativeHydrationReceipt,
} from './npm-native-cache-hydrate.mjs';
import { onlineNativeEnvironment } from './native-cache-runtime.mjs';
import {
  computeCacheIdentity,
  ensureIsolatedNpmConfigFiles,
  inspectLockfileDocument,
} from './npm-cache-hydrate.mjs';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';

function lifecycleLock() {
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      'apps/copilot-desktop/node_modules/electron': {
        version: '38.8.6',
        resolved: 'https://registry.npmjs.org/electron/-/electron-38.8.6.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'apps/copilot-desktop/node_modules/esbuild': {
        version: '0.21.5',
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/better-sqlite3': {
        version: '11.10.0',
        resolved: 'https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-11.10.0.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/electron': {
        version: '33.4.11',
        resolved: 'https://registry.npmjs.org/electron/-/electron-33.4.11.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/esbuild': {
        version: '0.25.12',
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.25.12.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/msgpackr-extract': {
        version: '3.0.4',
        resolved: 'https://registry.npmjs.org/msgpackr-extract/-/msgpackr-extract-3.0.4.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/tsx/node_modules/esbuild': {
        version: '0.28.1',
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/vite-node/node_modules/esbuild': {
        version: '0.21.5',
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'node_modules/vitest/node_modules/esbuild': {
        version: '0.21.5',
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
      'packages/llm-client/node_modules/fsevents': {
        version: '2.3.2',
        resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz',
        integrity: 'sha512-fixture',
        hasInstallScript: true,
      },
    },
  };
}

test('requires the new bounded native-toolchain owner token', () => {
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
});

test('online profile can reach only one localhost proxy and host policy is exact', () => {
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

test('native hydration strips inherited mirrors and credentials before bounded egress', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-env-'));
  try {
    await ensureIsolatedNpmConfigFiles({
      userConfigPath: path.join(root, 'user.npmrc'),
      globalConfigPath: path.join(root, 'global.npmrc'),
    });
    const previous = {
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      npm_config_disturl: process.env.npm_config_disturl,
    };
    try {
      process.env.ELECTRON_MIRROR = 'https://attacker.invalid/';
      process.env.GITHUB_TOKEN = 'secret';
      process.env.npm_config_disturl = 'https://attacker.invalid/headers';
      const env = onlineNativeEnvironment({
        layout: {
          root,
          npm: path.join(root, 'npm'),
          electron: path.join(root, 'electron'),
          electronBuilder: path.join(root, 'electron-builder'),
          nodeGyp: path.join(root, 'node-gyp'),
          prebuild: path.join(root, 'prebuild'),
        },
        proxyUrl: 'http://127.0.0.1:43123',
      });
      assert.equal(env.ELECTRON_MIRROR, undefined);
      assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.npm_config_disturl, undefined);
      assert.equal(env.npm_config_build_from_source, 'true');
      assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:43123');
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

test('candidate and offline proof keep lifecycle scripts enabled but deny network', () => {
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
  assert.ok(online.includes('https://registry.npmjs.org/'));
  assert.equal(online.includes('--ignore-scripts'), false);
});

test('native rebuild is exact Electron arm64 source-build work', () => {
  const args = nativeRebuildArgs({
    npmExecutable: '/usr/local/bin/npm',
    electronVersion: '38.8.6',
    arch: 'arm64',
  });
  assert.deepEqual(args, [
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
  assert.deepEqual(actual, Object.entries(lifecycleLock().packages)
    .filter(([, entry]) => entry?.hasInstallScript === true)
    .map(([packagePath, entry]) => [packagePath, String(entry.version ?? '')])
    .sort(([left], [right]) => left.localeCompare(right)));
});

test('candidate environment is receipt-bound and preserves native caches', () => {
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
  const environment = candidateNativeCacheEnvironment(input);
  assert.equal(environment.npm_config_cache, '/tmp/native-cache/npm');
  assert.equal(environment.npm_config_devdir, '/tmp/native-cache/node-gyp');
  assert.equal(environment.npm_config_nodedir, undefined);
  assert.equal(environment.ELECTRON_CACHE, '/tmp/native-cache/electron');
  assert.equal(environment.ELECTRON_BUILDER_CACHE, '/tmp/native-cache/electron-builder');
  assert.equal(environment.PREBUILD_INSTALL_CACHE, '/tmp/native-cache/prebuild');
  assert.equal(environment.npm_config_offline, 'true');
  assert.equal(environment.npm_config_build_from_source, 'true');
  assert.equal(environment.npm_config_python, '/usr/bin/python3');
  assert.equal(environment.COPILOT_NATIVE_CACHE_PROFILE, NATIVE_TOOLCHAIN_PROFILE);
  const buildEnvironment = candidateNativeBuildEnvironment(input);
  assert.equal(buildEnvironment.npm_config_nodedir, '/tmp/native-cache/node-gyp/38.8.6');
});

test('receipt validation rejects a lifecycle-disabled or unproved cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-native-receipt-'));
  const repository = path.join(root, 'repo');
  const cacheDir = path.join(root, 'cache');
  const receiptPath = path.join(root, 'receipt.json');
  const sourceCommit = 'b'.repeat(40);
  try {
    await mkdir(path.join(repository, 'apps/copilot-desktop'), { recursive: true });
    await mkdir(cacheDir);
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
    await writeFile(path.join(cacheDir, 'npm', 'entry'), 'cache\n');
    await ensureIsolatedNpmConfigFiles({
      userConfigPath: path.join(cacheDir, 'npm-config-user'),
      globalConfigPath: path.join(cacheDir, 'npm-config-global'),
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
    const lifecyclePackages = Object.entries(lock.packages)
      .filter(([, entry]) => entry?.hasInstallScript === true)
      .map(([packagePath, entry]) => [packagePath, String(entry.version ?? '')])
      .sort(([left], [right]) => left.localeCompare(right));
    const baseReceipt = {
      schemaVersion: NATIVE_CACHE_HYDRATION_SCHEMA_VERSION,
      status: 'PASS',
      ownerAuthority: OWNER_NATIVE_CACHE_AUTHORITY,
      sourceCommit,
      profile: NATIVE_TOOLCHAIN_PROFILE,
      registry: 'https://registry.npmjs.org/',
      lifecycleScriptsEnabled: true,
      nativeBuildMode: NATIVE_BUILD_MODE,
      candidateInstallMode: 'offline-lifecycle-scripts-enabled',
      automaticRetry: false,
      candidateCreated: false,
      evidenceCreated: false,
      cacheLayout: layout,
      electronNodedir,
      cacheIdentity,
      lockfile: { sha256: lockSha256, lifecyclePackages },
      onlineHydration: {
        status: 'PASS',
        proxy: {
          allowedHosts: [...NATIVE_HYDRATION_HOSTS].sort(),
          allRequestsAllowed: true,
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

    await writeFile(receiptPath, `${JSON.stringify({
      ...baseReceipt,
      lifecycleScriptsEnabled: false,
    }, null, 2)}\n`);
    await assert.rejects(
      validateNativeHydrationReceipt({ repository, sourceCommit, cacheDir, receiptPath }),
      (error) => error instanceof NativeCacheHydrationBlocked
        && error.code === 'BLOCKED_NATIVE_CACHE_RECEIPT_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
