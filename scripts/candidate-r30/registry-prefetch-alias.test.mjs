import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRegistryPrefetchManifest } from './registry-prefetch.mjs';

function aliasLockfileFixture() {
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      'node_modules/string-width-cjs': {
        name: 'string-width',
        version: '4.2.3',
        dev: true,
      },
      'node_modules/strip-ansi-cjs': {
        name: 'strip-ansi',
        version: '6.0.1',
        dev: true,
      },
      'node_modules/wrap-ansi-cjs': {
        name: 'wrap-ansi',
        version: '7.0.0',
        dev: true,
      },
    },
  };
}

test('exact-version-only lock aliases use the lock entry name instead of the node_modules alias path', () => {
  const manifest = buildRegistryPrefetchManifest(aliasLockfileFixture(), []);

  assert.deepEqual(
    manifest.entries.map((entry) => entry.spec),
    [
      'string-width@4.2.3',
      'strip-ansi@6.0.1',
      'wrap-ansi@7.0.0',
    ],
  );
  assert.equal(manifest.entries.some((entry) => entry.spec.includes('-cjs@')), false);
  assert.ok(manifest.entries.every((entry) => entry.identitySource === 'root-lock-exact-version-only'));
  assert.equal(manifest.rootClosureSpecCount, 3);
  assert.equal(manifest.coveredRootClosureSpecCount, 3);
});

test('current repository manifest never turns npm alias install paths into fake registry package names', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const rootLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const manifest = buildRegistryPrefetchManifest(rootLock, undefined, { repositoryRoot: root });

  for (const spec of [
    'string-width@4.2.3',
    'strip-ansi@6.0.1',
    'wrap-ansi@7.0.0',
  ]) {
    assert.ok(manifest.entries.some((entry) => entry.spec === spec), `${spec} must be prefetched`);
  }

  for (const invalidAliasSpec of [
    'string-width-cjs@4.2.3',
    'strip-ansi-cjs@6.0.1',
    'wrap-ansi-cjs@7.0.0',
  ]) {
    assert.equal(
      manifest.entries.some((entry) => entry.spec === invalidAliasSpec),
      false,
      `${invalidAliasSpec} must not be treated as an npm registry identity`,
    );
  }

  assert.equal(manifest.coveredRootClosureSpecCount, manifest.rootClosureSpecCount);
  assert.equal(manifest.entryCount, manifest.rootClosureSpecCount);
});
