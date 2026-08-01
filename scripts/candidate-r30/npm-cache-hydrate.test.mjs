import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_HYDRATION_SCHEMA_VERSION,
  NPM_REGISTRY,
  OWNER_CACHE_AUTHORITY,
  NpmCacheHydrationBlocked,
  cleanEnvironment,
  computeCacheIdentity,
  ensureIsolatedNpmConfigFiles,
  getIsolatedNpmConfigFiles,
  inspectLockfileDocument,
  parseHydrationArgs,
  registryProxyProfile,
  validateHydrationReceipt,
} from './npm-cache-hydrate.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');

function validLock() {
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      'node_modules/a': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
        integrity: 'sha512-fixture',
      },
      'node_modules/b': {
        version: '1.0.0',
        resolved: 'https://registry.npmmirror.com/b/-/b-1.0.0.tgz',
        integrity: 'sha512-fixture',
      },
      'node_modules/c': {
        version: '1.0.0',
        resolved: 'https://registry.yarnpkg.com/c/-/c-1.0.0.tgz',
        integrity: 'sha512-fixture',
      },
    },
  };
}

function lockWithWorkspace(resolved = 'apps/cloud') {
  const lock = validLock();
  lock.packages['apps/cloud'] = {
    name: '@fixture/cloud',
    version: '1.0.0',
  };
  lock.packages['node_modules/@fixture/cloud'] = {
    resolved,
    link: true,
  };
  return lock;
}

test('requires the exact owner token, source commit, and new absolute outputs', () => {
  const parsed = parseHydrationArgs([
    '--repository', '/tmp/repo',
    '--source-commit', 'a'.repeat(40),
    '--cache-dir', '/tmp/cache',
    '--receipt-output', '/tmp/cache-receipt.json',
    '--owner-authority', OWNER_CACHE_AUTHORITY,
  ]);
  assert.equal(parsed.sourceCommit, 'a'.repeat(40));
  assert.equal(parsed.cacheDir, path.resolve('/tmp/cache'));
  assert.equal(parsed.receiptOutput, path.resolve('/tmp/cache-receipt.json'));

  assert.throws(
    () => parseHydrationArgs([
      '--source-commit', 'a'.repeat(40),
      '--cache-dir', '/tmp/cache',
      '--receipt-output', '/tmp/receipt.json',
      '--owner-authority', 'not-approved',
    ]),
    /BLOCKED_NPM_CACHE_HYDRATION_OWNER_AUTHORITY/u,
  );
  assert.throws(
    () => parseHydrationArgs([
      '--source-commit', 'short',
      '--cache-dir', '/tmp/cache',
      '--receipt-output', '/tmp/receipt.json',
      '--owner-authority', OWNER_CACHE_AUTHORITY,
    ]),
    /BLOCKED_NPM_CACHE_HYDRATION_COMMIT/u,
  );
  assert.throws(
    () => parseHydrationArgs([
      '--source-commit', 'a'.repeat(40),
      '--cache-dir', 'relative',
      '--receipt-output', '/tmp/receipt.json',
      '--owner-authority', OWNER_CACHE_AUTHORITY,
    ]),
    /BLOCKED_NPM_CACHE_HYDRATION_PATH/u,
  );
});

test('the online sandbox can reach only the localhost registry proxy', () => {
  const profile = registryProxyProfile(43123);
  assert.match(profile, /deny network\*/u);
  assert.match(profile, /localhost:43123/u);
  assert.match(profile, /127\.0\.0\.1:43123/u);
  assert.doesNotMatch(profile, /\*:443|registry\.npmjs\.org/u);
});

test('accepts only reviewed HTTPS registry origins and rejects arbitrary egress', () => {
  const identity = inspectLockfileDocument(validLock());
  assert.equal(identity.lockfileVersion, 3);
  assert.deepEqual(identity.resolvedOrigins, [
    'https://registry.npmjs.org',
    'https://registry.npmmirror.com',
    'https://registry.yarnpkg.com',
  ].sort());
  assert.deepEqual(identity.workspaceResolutions, []);

  for (const resolved of [
    'http://registry.npmjs.org/a/-/a-1.0.0.tgz',
    'https://user:secret@registry.npmjs.org/a/-/a-1.0.0.tgz',
    'https://github.com/example/a/archive/main.tar.gz',
    'git+ssh://git@github.com/example/a.git',
  ]) {
    const invalid = validLock();
    invalid.packages['node_modules/a'].resolved = resolved;
    assert.throws(
      () => inspectLockfileDocument(invalid),
      (error) => error instanceof NpmCacheHydrationBlocked
        && error.code === 'BLOCKED_NPM_CACHE_HYDRATION_LOCK_ORIGIN',
    );
  }
});

test('accepts only package-graph-bound plain workspace resolutions', () => {
  const identity = inspectLockfileDocument(lockWithWorkspace());
  assert.deepEqual(identity.workspaceResolutions, ['apps/cloud']);

  for (const resolved of [
    '../apps/cloud',
    '/apps/cloud',
    'apps\\cloud',
    'apps/missing',
    'tools/cloud',
  ]) {
    assert.throws(
      () => inspectLockfileDocument(lockWithWorkspace(resolved)),
      (error) => error instanceof NpmCacheHydrationBlocked
        && error.code === 'BLOCKED_NPM_CACHE_HYDRATION_LOCK_ORIGIN',
      resolved,
    );
  }
});

test('the real package lock contains only reviewed registry-resolved dependencies', async () => {
  const lock = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const identity = inspectLockfileDocument(lock);
  assert.equal(identity.lockfileVersion, 3);
  assert.ok(identity.resolvedOrigins.length >= 1);
  assert.equal(
    identity.resolvedOrigins.every((origin) => [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
      'https://registry.yarnpkg.com',
    ].includes(origin)),
    true,
  );
  assert.ok(identity.workspaceResolutions.includes('apps/copilot-cloud'));
});

test('binds an exclusive hydration receipt to source, lockfile, and immutable cache bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-r31-cache-receipt-'));
  const repository = path.join(root, 'repo');
  const cacheDir = path.join(root, 'cache');
  const receiptPath = path.join(root, 'receipt.json');
  const sourceCommit = 'b'.repeat(40);
  try {
    await mkdir(repository);
    await mkdir(cacheDir);
    await mkdir(path.join(cacheDir, '_cacache'), { recursive: true });
    await writeFile(path.join(cacheDir, '_cacache', 'entry'), 'cached-bytes\n');
    const lockText = `${JSON.stringify(validLock(), null, 2)}\n`;
    await writeFile(path.join(repository, 'package-lock.json'), lockText);
    const cacheIdentity = await computeCacheIdentity(cacheDir);
    const lockSha256 = (await import('node:crypto'))
      .createHash('sha256')
      .update(Buffer.from(lockText))
      .digest('hex');
    await writeFile(receiptPath, `${JSON.stringify({
      schemaVersion: CACHE_HYDRATION_SCHEMA_VERSION,
      status: 'PASS',
      ownerAuthority: OWNER_CACHE_AUTHORITY,
      sourceCommit,
      registry: NPM_REGISTRY,
      lifecycleScriptsDisabled: true,
      automaticRetry: false,
      candidateCreated: false,
      evidenceCreated: false,
      offlineProbe: { status: 'PASS' },
      onlineHydration: {
        proxy: {
          allowedHost: 'registry.npmjs.org',
          allowedPort: 443,
          allRequestsAllowed: true,
        },
      },
      lockfile: { sha256: lockSha256 },
      cacheIdentity,
    }, null, 2)}\n`);

    const validated = await validateHydrationReceipt({
      repository,
      sourceCommit,
      cacheDir,
      receiptPath,
    });
    assert.match(validated.receiptSha256, /^[0-9a-f]{64}$/u);
    assert.equal(validated.cacheIdentity.aggregateSha256, cacheIdentity.aggregateSha256);

    await writeFile(path.join(cacheDir, '_cacache', 'entry'), 'tampered\n');
    await assert.rejects(
      validateHydrationReceipt({ repository, sourceCommit, cacheDir, receiptPath }),
      /BLOCKED_NPM_CACHE_RECEIPT_INVALID/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('npm 11.8.0 fails closed when NPM_CONFIG_USERCONFIG and NPM_CONFIG_GLOBALCONFIG both point at /dev/null (RED reproduction)', async () => {
  const reproduction = spawnSync('npm', ['--version'], {
    env: {
      ...process.env,
      NPM_CONFIG_USERCONFIG: '/dev/null',
      NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(reproduction.error, undefined, reproduction.error?.message);
  assert.notEqual(reproduction.status ?? 1, 0, 'npm 11.8.0 must fail when both config paths collapse to /dev/null');
  const combined = `${reproduction.stdout ?? ''}${reproduction.stderr ?? ''}`;
  assert.match(
    combined,
    /double-loading config|Exit prior to config file resolving/u,
    'npm 11.8.0 must report the double-load failure mode we are repairing',
  );
});

test('cleanEnvironment uses distinct isolated npm config files and never reuses /dev/null (GREEN contract)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-r33-iso-'));
  try {
    const userConfigPath = path.join(root, 'user', '.npmrc-user');
    const globalConfigPath = path.join(root, 'global', '.npmrc-global');
    const prepared = await ensureIsolatedNpmConfigFiles({ userConfigPath, globalConfigPath });
    assert.equal(prepared.userConfigPath, await realpath(userConfigPath));
    assert.equal(prepared.globalConfigPath, await realpath(globalConfigPath));
    assert.notEqual(prepared.userConfigPath, prepared.globalConfigPath);
    assert.equal(getIsolatedNpmConfigFiles().userConfigPath, prepared.userConfigPath);
    assert.equal(getIsolatedNpmConfigFiles().globalConfigPath, prepared.globalConfigPath);

    const userStat = await lstat(prepared.userConfigPath);
    const globalStat = await lstat(prepared.globalConfigPath);
    assert.equal(userStat.isFile(), true);
    assert.equal(globalStat.isFile(), true);
    assert.equal(userStat.size, 0);
    assert.equal(globalStat.size, 0);

    const env = cleanEnvironment();
    assert.equal(env.NPM_CONFIG_USERCONFIG, prepared.userConfigPath);
    assert.equal(env.NPM_CONFIG_GLOBALCONFIG, prepared.globalConfigPath);
    assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
    for (const forbidden of ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/stdin', '/dev/zero']) {
      assert.notEqual(env.NPM_CONFIG_USERCONFIG, forbidden);
      assert.notEqual(env.NPM_CONFIG_GLOBALCONFIG, forbidden);
    }
    assert.equal(env.NPM_CONFIG_PROXY, undefined, 'inherited proxy authority must remain stripped');
    for (const key of [
      'NPM_CONFIG_REGISTRY',
      'NODE_AUTH_TOKEN',
      'NPM_TOKEN',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'http_proxy',
      'https_proxy',
      'npm_config_proxy',
      'npm_config_https_proxy',
      'npm_config_registry',
      'npm_config_userconfig',
      'npm_config_globalconfig',
    ]) {
      assert.equal(env[key], undefined, `${key} must not survive cleanEnvironment`);
    }
    const verification = spawnSync('npm', ['--version'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(verification.error, undefined, verification.error?.message);
    assert.equal(
      verification.status,
      0,
      `${verification.stdout ?? ''}${verification.stderr ?? ''}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureIsolatedNpmConfigFiles rejects identical, relative, or /dev/* config paths (fail-closed)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-r33-iso-bad-'));
  try {
    const absolute = path.join(root, 'user.npmrc');
    const same = path.join(root, 'user.npmrc');
    const absolute2 = path.join(root, 'global.npmrc');
    await assert.rejects(
      ensureIsolatedNpmConfigFiles({ userConfigPath: absolute, globalConfigPath: same }),
      /BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION/u,
    );
    await assert.rejects(
      ensureIsolatedNpmConfigFiles({ userConfigPath: 'relative.npmrc', globalConfigPath: absolute2 }),
      /BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION/u,
    );
    await assert.rejects(
      ensureIsolatedNpmConfigFiles({ userConfigPath: '/dev/null', globalConfigPath: absolute2 }),
      /BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION/u,
    );
    await assert.rejects(
      ensureIsolatedNpmConfigFiles({ userConfigPath: absolute, globalConfigPath: '/dev/zero' }),
      /BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
