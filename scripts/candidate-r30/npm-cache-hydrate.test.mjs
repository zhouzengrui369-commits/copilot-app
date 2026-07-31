import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_HYDRATION_SCHEMA_VERSION,
  NPM_REGISTRY,
  OWNER_CACHE_AUTHORITY,
  NpmCacheHydrationBlocked,
  computeCacheIdentity,
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
