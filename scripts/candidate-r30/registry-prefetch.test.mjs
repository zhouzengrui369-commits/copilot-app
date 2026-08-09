import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  NATIVE_REGISTRY_CLOSURE_STRATEGY,
  NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
  NATIVE_REGISTRY_PREFETCH_STRATEGY,
  buildRegistryPrefetchManifest,
  registryCacheClosureArgs,
  registryPrefetchBatchArgs,
  registryPrefetchBatches,
} from './registry-prefetch.mjs';
import { NativeCacheHydrationBlocked } from './native-cache-policy.mjs';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';

function lockfileFixture() {
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
        integrity: 'sha512-QUJDRA==',
      },
      'node_modules/a-duplicate': {
        version: '1.0.0',
        resolved: 'https://registry.yarnpkg.com/a/-/a-1.0.0.tgz',
        integrity: 'sha512-QUJDRA==',
      },
      'node_modules/b': {
        version: '2.0.0',
        resolved: 'https://registry.npmmirror.com/b/-/b-2.0.0.tgz',
        integrity: 'sha512-RUZHSA==',
      },
      'packages/local': {
        version: '1.0.0',
        resolved: 'packages/local',
      },
    },
  };
}

test('registry prefetch manifest is deterministic, metadata-complete, canonical and deduplicated', () => {
  const first = buildRegistryPrefetchManifest(lockfileFixture());
  const second = buildRegistryPrefetchManifest(lockfileFixture());
  assert.equal(first.strategy, NATIVE_REGISTRY_PREFETCH_STRATEGY);
  assert.equal(first.metadataMode, 'name-version-packument-and-tarball');
  assert.equal(first.entryCount, 2);
  assert.equal(first.supplementalLockfileCount, 0);
  assert.equal(first.supplementalIdentityCount, 0);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.match(first.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(first.entries.map((entry) => ({
    spec: entry.spec,
    resolved: entry.resolved,
  })), [
    {
      spec: 'a@1.0.0',
      resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
    },
    {
      spec: 'b@2.0.0',
      resolved: 'https://registry.npmjs.org/b/-/b-2.0.0.tgz',
    },
  ]);
});

test('registry prefetch supplements only exact unresolved root specs from tracked nested lock identities', () => {
  const root = lockfileFixture();
  root.packages['apps/mobile/node_modules/typescript'] = {
    version: '6.0.3',
    dev: true,
    license: 'Apache-2.0',
  };
  const nested = {
    name: '@fixture/mobile',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: '@fixture/mobile', version: '1.0.0' },
      'node_modules/typescript': {
        version: '6.0.3',
        resolved: 'https://registry.npmmirror.com/typescript/-/typescript-6.0.3.tgz',
        integrity: 'sha512-VFlQRVNUUkNJUFRZUEU=',
        dev: true,
      },
      'node_modules/unrelated': {
        version: '9.9.9',
        resolved: 'https://registry.npmjs.org/unrelated/-/unrelated-9.9.9.tgz',
        integrity: 'sha512-VU5SRUxBVEVE',
      },
    },
  };

  const manifest = buildRegistryPrefetchManifest(root, [nested]);
  assert.equal(manifest.supplementalLockfileCount, 1);
  assert.equal(manifest.supplementalIdentityCount, 1);
  assert.equal(manifest.entryCount, 3);
  assert.deepEqual(
    manifest.entries.filter((entry) => entry.spec.startsWith('typescript@')),
    [{
      name: 'typescript',
      version: '6.0.3',
      spec: 'typescript@6.0.3',
      resolved: 'https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz',
      integrity: 'sha512-VFlQRVNUUkNJUFRZUEU=',
    }],
  );
  assert.equal(manifest.entries.some((entry) => entry.spec === 'unrelated@9.9.9'), false);
});

test('current repository root closure manifest includes mobile typescript 6.0.3 exact registry identity', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const [rootLock, mobileLock] = await Promise.all([
    readFile(path.join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'apps/mobile/package-lock.json'), 'utf8').then(JSON.parse),
  ]);
  const manifest = buildRegistryPrefetchManifest(rootLock, [mobileLock]);
  const typescript = manifest.entries.find((entry) => entry.spec === 'typescript@6.0.3');
  assert.ok(typescript, 'typescript@6.0.3 must be prefetched for root npm ci closure');
  assert.equal(
    typescript.resolved,
    'https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz',
  );
  assert.match(typescript.integrity, /^sha512-/u);
  assert.ok(manifest.supplementalIdentityCount >= 1);
});

test('registry prefetch rejects unreviewed origins, missing integrity and non-exact specs', () => {
  const badOrigin = lockfileFixture();
  badOrigin.packages['node_modules/c'] = {
    version: '1.0.0',
    resolved: 'https://attacker.invalid/c.tgz',
    integrity: 'sha512-Q0NDQw==',
  };
  assert.throws(
    () => buildRegistryPrefetchManifest(badOrigin),
    (error) => error instanceof NativeCacheHydrationBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ORIGIN',
  );

  const noIntegrity = lockfileFixture();
  noIntegrity.packages['node_modules/c'] = {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/c/-/c-1.0.0.tgz',
  };
  assert.throws(
    () => buildRegistryPrefetchManifest(noIntegrity),
    (error) => error instanceof NativeCacheHydrationBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_INTEGRITY',
  );

  const noVersion = lockfileFixture();
  noVersion.packages['node_modules/c'] = {
    resolved: 'https://registry.npmjs.org/c/-/c-1.0.0.tgz',
    integrity: 'sha512-Q0NDQw==',
  };
  assert.throws(
    () => buildRegistryPrefetchManifest(noVersion),
    (error) => error instanceof NativeCacheHydrationBlocked
      && error.code === 'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
  );
});

test('registry prefetch splits one exact manifest into bounded ordered batches', () => {
  const entries = Array.from({ length: NATIVE_REGISTRY_PREFETCH_BATCH_SIZE * 2 + 1 }, (_, index) => ({
    name: `pkg-${String(index).padStart(3, '0')}`,
    version: '1.0.0',
    spec: `pkg-${String(index).padStart(3, '0')}@1.0.0`,
    resolved: `https://registry.npmjs.org/pkg-${String(index).padStart(3, '0')}/-/pkg-${index}-1.0.0.tgz`,
    integrity: 'sha512-QUJDRA==',
  }));
  const batches = registryPrefetchBatches({
    entries,
    entryCount: entries.length,
  });
  assert.deepEqual(batches.map((batch) => batch.length), [
    NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
    NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
    1,
  ]);
  assert.deepEqual(batches.flat(), entries);
});

test('each prefetch batch uses exact name@version npm pack to cache packument and tarball', () => {
  const args = registryPrefetchBatchArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
    packDestination: '/tmp/native-cache/prefetch/batch-0001',
    entries: [{
      name: 'a',
      version: '1.0.0',
      spec: 'a@1.0.0',
      resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
      integrity: 'sha512-QUJDRA==',
    }],
  });
  assert.deepEqual(args.slice(0, 3), ['/usr/local/bin/npm', 'pack', '--ignore-scripts']);
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--cache'));
  assert.ok(args.includes('/tmp/native-cache/npm'));
  assert.ok(args.includes(NPM_CACHE_KEY_ALIGNMENT_FLAG));
  assert.ok(args.includes('--prefer-online'));
  assert.ok(args.includes('--pack-destination'));
  assert.ok(args.includes('/tmp/native-cache/prefetch/batch-0001'));
  assert.ok(args.includes('https://registry.npmjs.org/'));
  assert.ok(args.includes('a@1.0.0'));
  assert.equal(args.includes('https://registry.npmjs.org/a/-/a-1.0.0.tgz'), false);
  assert.equal(args.includes('--offline'), false);
});

test('registry cache closure proof is strict deny-network npm ci with scripts disabled', () => {
  const args = registryCacheClosureArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
  });
  assert.deepEqual(args.slice(0, 2), ['/usr/local/bin/npm', 'ci']);
  assert.ok(args.includes('--offline'));
  assert.ok(args.includes('--ignore-scripts'));
  assert.ok(args.includes(NPM_CACHE_KEY_ALIGNMENT_FLAG));
  assert.equal(args.some((value) => /https?:\/\//u.test(value)), false);
  assert.equal(NATIVE_REGISTRY_CLOSURE_STRATEGY, 'deny-network-offline-ci-ignore-scripts-v1');
});

test('hydrator integration proves registry closure before lifecycle assets and forbids later registry access', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const source = await readFile(
    path.join(root, 'scripts/candidate-r30/npm-native-cache-hydrate.mjs'),
    'utf8',
  );
  assert.match(source, /buildRegistryPrefetchManifest/u);
  assert.match(source, /supplementalPackageLockDocuments/u);
  assert.match(source, /:\(glob\)\*\*\/package-lock\.json/u);
  assert.match(source, /registryPrefetchBatches/u);
  assert.match(source, /registryPrefetchBatchArgs/u);
  assert.match(source, /registryCacheClosureArgs/u);
  assert.match(source, /bounded-registry-prefetch-/u);
  assert.match(source, /deny-network-registry-cache-closure-proof/u);
  assert.match(source, /BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE/u);
  assert.match(source, /BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH/u);
  assert.match(
    source,
    /registryMode:\s*'lockfile-name-version-prefetch-closure-then-offline-ci'/u,
  );
  assert.match(source, /registryRequestCountAfterClosure/u);
  assert.match(
    source,
    /fullInstallArgs\(\{ npmExecutable, npmCacheDir: layout\.npm, online: false \}\)/u,
  );
  assert.doesNotMatch(
    source,
    /fullInstallArgs\(\{ npmExecutable, npmCacheDir: layout\.npm, online: true \}\)/u,
  );
});
