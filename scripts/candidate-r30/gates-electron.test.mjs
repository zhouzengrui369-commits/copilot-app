import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildTestDataManifestData } from './gates-electron.mjs';

async function fixtureTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-test-data-'));
  const e2eRoot = path.join(root, 'apps/copilot-desktop/tests/e2e');
  await mkdir(path.join(e2eRoot, 'helpers'), { recursive: true });
  for (let index = 1; index <= 9; index += 1) {
    await writeFile(path.join(e2eRoot, `case-${index}.spec.ts`), `export const case${index} = ${index};\n`);
  }
  await writeFile(path.join(e2eRoot, 'electron.fixture.ts'), 'export const fixture = true;\n');
  await writeFile(path.join(e2eRoot, 'helpers/fake-provider.ts'), 'export const provider = "synthetic";\n');
  return { root, e2eRoot };
}

test('Gate 9 hashes all nine specs plus every TypeScript fixture/helper', async () => {
  const { root, e2eRoot } = await fixtureTree();
  const input = { sourceCommit: 'a'.repeat(40), candidateId: `copilot-r30-${'a'.repeat(40)}`,
    discovery: { tests: 113, files: 9 }, repositoryRoot: root, e2eRoot };
  const first = await buildTestDataManifestData(input);
  const repeated = await buildTestDataManifestData(input);

  assert.equal(first.schemaVersion, 2);
  assert.equal(first.classification, 'SYNTHETIC_E2E_FIXTURE_ONLY');
  assert.equal(first.realUserDataUsed, false);
  assert.equal(first.specs.length, 9);
  assert.equal(first.supportFiles.length, 2);
  assert.equal(first.files.length, 11);
  assert.ok(first.supportFiles.some((value) => value.endsWith('/electron.fixture.ts')));
  assert.ok(first.supportFiles.some((value) => value.endsWith('/helpers/fake-provider.ts')));
  assert.ok(first.files.every((entry) => /^[0-9a-f]{64}$/u.test(entry.sha256)));
  assert.match(first.contentAggregateSha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.contentAggregateSha256, repeated.contentAggregateSha256);

  await writeFile(path.join(e2eRoot, 'helpers/fake-provider.ts'), 'export const provider = "changed";\n');
  const changed = await buildTestDataManifestData(input);
  assert.notEqual(changed.contentAggregateSha256, first.contentAggregateSha256);
});

test('Gate 9 rejects symlinked fixture inputs and non-exact discovery', async () => {
  const { root, e2eRoot } = await fixtureTree();
  await writeFile(path.join(root, 'outside.ts'), 'export const outside = true;\n');
  await symlink(path.join(root, 'outside.ts'), path.join(e2eRoot, 'helpers/alias.ts'));
  const base = { sourceCommit: 'b'.repeat(40), candidateId: `copilot-r30-${'b'.repeat(40)}`,
    repositoryRoot: root, e2eRoot };
  await assert.rejects(() => buildTestDataManifestData({ ...base, discovery: { tests: 113, files: 9 } }),
    /BLOCKED_GATE_09_TEST_DATA_SYMLINK/u);
  await assert.rejects(() => buildTestDataManifestData({ ...base, discovery: { tests: 112, files: 9 } }),
    /BLOCKED_GATE_09_DISCOVERY_NOT_EXACT/u);
});
