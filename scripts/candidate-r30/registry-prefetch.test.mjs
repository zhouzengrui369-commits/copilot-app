import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
  NATIVE_REGISTRY_PREFETCH_STRATEGY,
  buildRegistryPrefetchManifest,
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

test('registry prefetch manifest is deterministic, canonical and deduplicated', () => {
  const first = buildRegistryPrefetchManifest(lockfileFixture());
  const second = buildRegistryPrefetchManifest(lockfileFixture());
  assert.equal(first.strategy, NATIVE_REGISTRY_PREFETCH_STRATEGY);
  assert.equal(first.entryCount, 2);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.match(first.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(first.entries.map((entry) => entry.resolved), [
    'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
    'https://registry.npmjs.org/b/-/b-2.0.0.tgz',
  ]);
});

test('registry prefetch rejects unreviewed origins and missing integrity', () => {
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
});

test('registry prefetch splits one exact manifest into bounded ordered batches', () => {
  const entries = Array.from({ length: NATIVE_REGISTRY_PREFETCH_BATCH_SIZE * 2 + 1 }, (_, index) => ({
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

test('each prefetch batch uses npm pack, disables scripts, and targets the isolated cache', () => {
  const args = registryPrefetchBatchArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
    packDestination: '/tmp/native-cache/prefetch/batch-0001',
    entries: [{
      resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
      integrity: 'sha512-QUJDRA==',
    }],
  });
  assert.deepEqual(args.slice(0, 3), ['/usr/local/bin/npm', 'pack', '--ignore-scripts']);
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--cache'));
  assert.ok(args.includes('/tmp/native-cache/npm'));
  assert.ok(args.includes(NPM_CACHE_KEY_ALIGNMENT_FLAG));
  assert.ok(args.includes('--pack-destination'));
  assert.ok(args.includes('/tmp/native-cache/prefetch/batch-0001'));
  assert.ok(args.includes('https://registry.npmjs.org/'));
  assert.ok(args.includes('https://registry.npmjs.org/a/-/a-1.0.0.tgz'));
  assert.equal(args.includes('--offline'), false);
});

test('hydrator integration prefetches in bounded batches and makes lifecycle npm ci registry-offline', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const source = await readFile(
    path.join(root, 'scripts/candidate-r30/npm-native-cache-hydrate.mjs'),
    'utf8',
  );
  assert.match(source, /buildRegistryPrefetchManifest/u);
  assert.match(source, /registryPrefetchBatches/u);
  assert.match(source, /registryPrefetchBatchArgs/u);
  assert.match(source, /bounded-registry-prefetch-/u);
  assert.match(source, /registryMode:\s*'lockfile-batched-prefetch-then-offline-ci'/u);
  assert.match(
    source,
    /fullInstallArgs\(\{ npmExecutable, npmCacheDir: layout\.npm, online: false \}\)/u,
  );
  assert.doesNotMatch(
    source,
    /fullInstallArgs\(\{ npmExecutable, npmCacheDir: layout\.npm, online: true \}\)/u,
  );
});
