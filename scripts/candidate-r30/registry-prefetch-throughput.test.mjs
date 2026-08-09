import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_REGISTRY_PREFETCH_MAX_SOCKETS,
  registryPrefetchBatchArgs,
} from './registry-prefetch.mjs';

test('registry prefetch uses a higher but still bounded npm socket cap without retry', () => {
  assert.equal(NATIVE_REGISTRY_PREFETCH_MAX_SOCKETS, 12);
  const args = registryPrefetchBatchArgs({
    npmExecutable: '/usr/local/bin/npm',
    npmCacheDir: '/tmp/native-cache/npm',
    packDestination: '/tmp/native-cache/prefetch/batch-0001',
    entries: [{
      name: 'typescript',
      version: '6.0.3',
      spec: 'typescript@6.0.3',
      resolved: 'https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz',
      integrity: 'sha512-QUJDRA==',
    }],
  });
  assert.ok(args.includes('--maxsockets=12'));
  assert.equal(args.some((value) => value === '--fetch-retries' || value.startsWith('--fetch-retries=')), false);
  assert.equal(args.includes('--offline'), false);
});
