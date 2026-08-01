import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_SCOPE, NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';
import { CANONICAL_CANDIDATE_ALIAS } from './canonical-release.mjs';
import { FOCUSED_SPECS } from './gates-electron.mjs';
import { OWNER_CACHE_AUTHORITY } from './npm-cache-hydrate.mjs';
import { PERFORMANCE_RAW_BASENAMES } from './performance.mjs';
import { GATE_ORDER, candidateId, candidateNpmConfigPaths, parseArgs, staticPlan } from './run-candidate.mjs';

test('R30 identity is deterministic and bound to the full source commit', () => {
  assert.equal(
    candidateId('6aa6b8c0792c5549b818107a0f64e4f32651dacd'),
    'copilot-r30-6aa6b8c0792c5549b818107a0f64e4f32651dacd',
  );
});

test('runner requires exact source commit, absolute evidence path, and rejects online arguments', () => {
  assert.deepEqual(parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', '/tmp/r30']), {
    sourceCommit: 'a'.repeat(40),
    evidenceDir: path.resolve('/tmp/r30'),
    npmCacheDir: null,
    npmCacheReceipt: null,
    dryRun: false,
  });
  assert.throws(() => parseArgs([]), /BLOCKED_RUNNER_ARGUMENT/);
  assert.throws(
    () => parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', 'relative']),
    /BLOCKED_EVIDENCE_DIR_NOT_ABSOLUTE/,
  );
  assert.throws(
    () => parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', '/tmp/x', '--online']),
    /BLOCKED_RUNNER_ARGUMENT_UNKNOWN/,
  );
});

test('runner accepts only a paired absolute owner-approved cache and receipt', () => {
  const parsed = parseArgs([
    '--source-commit', 'a'.repeat(40),
    '--evidence-dir', '/tmp/r30',
    '--npm-cache-dir', '/tmp/r31-cache',
    '--npm-cache-receipt', '/tmp/r31-cache-receipt.json',
  ]);
  assert.equal(parsed.npmCacheDir, path.resolve('/tmp/r31-cache'));
  assert.equal(parsed.npmCacheReceipt, path.resolve('/tmp/r31-cache-receipt.json'));

  assert.throws(
    () => parseArgs([
      '--source-commit', 'a'.repeat(40),
      '--evidence-dir', '/tmp/r30',
      '--npm-cache-dir', '/tmp/r31-cache',
    ]),
    /BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT/u,
  );
  assert.throws(
    () => parseArgs([
      '--source-commit', 'a'.repeat(40),
      '--evidence-dir', '/tmp/r30',
      '--npm-cache-dir', 'relative',
      '--npm-cache-receipt', '/tmp/r31-cache-receipt.json',
    ]),
    /BLOCKED_NPM_CACHE_RECEIPT_ARGUMENT/u,
  );
});

test('an existing evidence directory is not modified by blocker reporting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-owned-'));
  const evidence = path.join(root, 'existing');
  await mkdir(evidence);
  await writeFile(path.join(evidence, 'sentinel'), 'keep\n');
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-candidate.mjs');
  const result = spawnSync(
    process.execPath,
    [runner, '--source-commit', 'a'.repeat(40), '--evidence-dir', evidence],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCKED_EVIDENCE_DIR_ALREADY_EXISTS/);
  assert.deepEqual(await readdir(evidence), ['sentinel']);
});

test('runner gate order is complete and stable', () => {
  assert.deepEqual(GATE_ORDER, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('static plan binds canonical packaging, exact Electron and three-run performance', () => {
  const plan = staticPlan({ sourceCommit: 'a'.repeat(40), evidenceDir: '/tmp/r30' });
  assert.equal(plan.schemaVersion, 3);
  assert.equal(plan.canonicalCandidateAlias, CANONICAL_CANDIDATE_ALIAS);
  assert.equal(plan.networkAuthority, 'offline-only');
  assert.equal(plan.automaticRegistryFallback, false);
  assert.equal(plan.approvedNpmCacheHydration, null);
  assert.match(
    plan.gates.find((gate) => gate.id === 2).command,
    /sandbox-exec.*deny network.*npm ci --offline/su,
  );
  assert.match(plan.gates.find((gate) => gate.id === 2).command, new RegExp(NPM_CACHE_KEY_ALIGNMENT_FLAG));
  assert.equal(plan.gates.find((gate) => gate.id === 2).npmConfigIsolation, 'candidate-owned-distinct-regular-files');
  const ledger = plan.gates.find((gate) => gate.id === 3);
  assert.equal(ledger.scope, LEDGER_SCOPE);
  assert.equal(ledger.source, 'git ls-files -z');
  assert.ok(ledger.criticalControlFiles.includes('scripts/candidate-r30/gates-electron.mjs'));
  assert.match(plan.gates.find((gate) => gate.id === 4).name, /source-contracts/u);
  assert.match(plan.gates.find((gate) => gate.id === 5).name, /source-quality/u);
  assert.equal(
    plan.gates.find((gate) => gate.id === 6).canonicalCandidateAlias,
    CANONICAL_CANDIDATE_ALIAS,
  );
  assert.deepEqual(plan.gates.find((gate) => gate.id === 8).specs, FOCUSED_SPECS);
  assert.deepEqual(plan.gates.find((gate) => gate.id === 9).exactDiscovery, {
    tests: 113,
    files: 9,
  });
  assert.match(plan.gates.find((gate) => gate.id === 9).name, /test-data-manifest/u);
  assert.deepEqual(plan.gates.find((gate) => gate.id === 10).exactResult, {
    expected: 113,
    passed: 113,
    skipped: 0,
    unexpected: 0,
    flaky: 0,
    cleanProcessExit: true,
  });
  assert.deepEqual(plan.gates.find((gate) => gate.id === 11).raws, PERFORMANCE_RAW_BASENAMES);
  assert.match(plan.gates.find((gate) => gate.id === 12).assertion, /canonical manifest/u);
  assert.equal(JSON.stringify(plan).includes('registry.npmjs.org'), false);
});

test('candidate npm config paths are distinct and evidence-bound', () => {
  const paths = candidateNpmConfigPaths('/tmp/r30');
  assert.equal(paths.userConfigPath, '/tmp/r30/npm-config/user.npmrc');
  assert.equal(paths.globalConfigPath, '/tmp/r30/npm-config/global.npmrc');
  assert.notEqual(paths.userConfigPath, paths.globalConfigPath);
});

test('static plan keeps candidate offline while binding a separately hydrated cache receipt', () => {
  const plan = staticPlan({
    sourceCommit: 'a'.repeat(40),
    evidenceDir: '/tmp/r30',
    npmCacheDir: '/tmp/r31-cache',
    npmCacheReceipt: '/tmp/r31-cache-receipt.json',
  });
  assert.equal(plan.networkAuthority, 'offline-only');
  assert.equal(plan.automaticRegistryFallback, false);
  assert.equal(plan.approvedNpmCacheHydration.ownerAuthority, OWNER_CACHE_AUTHORITY);
  assert.equal(
    plan.approvedNpmCacheHydration.candidateInstallAuthority,
    'offline-only-after-exact-receipt-validation',
  );
  assert.match(plan.gates.find((gate) => gate.id === 2).command, /--cache/u);
  assert.equal(JSON.stringify(plan).includes('https://registry.npmjs.org/'), false);
});

test('dry-run remains plan-only and cannot be read as a candidate', () => {
  const options = parseArgs([
    '--source-commit',
    'b'.repeat(40),
    '--evidence-dir',
    '/tmp/r30-plan',
    '--dry-run',
  ]);
  const plan = staticPlan(options);
  assert.equal(plan.executionStatus, 'PLAN_ONLY_NOT_A_CANDIDATE');
  assert.equal(plan.mvpStatus, 'MVP_NOT_COMPLETE');
});
