import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_SCOPE } from './contract.mjs';
import { FOCUSED_SPECS } from './gates-electron.mjs';
import { GATE_ORDER, candidateId, parseArgs, staticPlan } from './run-candidate.mjs';

test('R30 identity is deterministic and bound to the full source commit', () => {
  assert.equal(candidateId('6aa6b8c0792c5549b818107a0f64e4f32651dacd'), 'copilot-r30-6aa6b8c0792c5549b818107a0f64e4f32651dacd');
});
test('runner requires exact source commit, absolute evidence path, and rejects online arguments', () => {
  assert.deepEqual(parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', '/tmp/r30']), {
    sourceCommit: 'a'.repeat(40), evidenceDir: path.resolve('/tmp/r30'), dryRun: false,
  });
  assert.throws(() => parseArgs([]), /BLOCKED_RUNNER_ARGUMENT/);
  assert.throws(() => parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', 'relative']), /BLOCKED_EVIDENCE_DIR_NOT_ABSOLUTE/);
  assert.throws(() => parseArgs(['--source-commit', 'a'.repeat(40), '--evidence-dir', '/tmp/x', '--online']), /BLOCKED_RUNNER_ARGUMENT_UNKNOWN/);
});
test('an existing evidence directory is not modified by blocker reporting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-owned-')); const evidence = path.join(root, 'existing');
  await mkdir(evidence); await writeFile(path.join(evidence, 'sentinel'), 'keep\n');
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-candidate.mjs');
  const result = spawnSync(process.execPath, [runner, '--source-commit', 'a'.repeat(40), '--evidence-dir', evidence], { encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stderr, /BLOCKED_EVIDENCE_DIR_ALREADY_EXISTS/);
  assert.deepEqual(await readdir(evidence), ['sentinel']);
});
test('runner gate order is complete and stable', () => assert.deepEqual(GATE_ORDER, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
test('static plan binds complete ledger, source quality, exact 113/9, and exact full result', () => {
  const plan = staticPlan({ sourceCommit: 'a'.repeat(40), evidenceDir: '/tmp/r30' });
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.networkAuthority, 'offline-only'); assert.equal(plan.automaticRegistryFallback, false);
  assert.match(plan.gates.find((gate) => gate.id === 2).command, /sandbox-exec.*deny network.*npm ci --offline/su);
  const ledger = plan.gates.find((gate) => gate.id === 3);
  assert.equal(ledger.scope, LEDGER_SCOPE);
  assert.equal(ledger.source, 'git ls-files -z');
  assert.ok(ledger.criticalControlFiles.includes('scripts/candidate-r30/gates-electron.mjs'));
  assert.match(plan.gates.find((gate) => gate.id === 4).name, /source-contracts/u);
  assert.match(plan.gates.find((gate) => gate.id === 5).name, /checks-tests-integration-coverage/u);
  assert.deepEqual(plan.gates.find((gate) => gate.id === 8).specs, FOCUSED_SPECS);
  assert.deepEqual(plan.gates.find((gate) => gate.id === 9).exactDiscovery, { tests: 113, files: 9 });
  assert.match(plan.gates.find((gate) => gate.id === 9).name, /test-data-manifest/u);
  assert.deepEqual(plan.gates.find((gate) => gate.id === 10).exactResult, { expected: 113, passed: 113,
    skipped: 0, unexpected: 0, flaky: 0, cleanProcessExit: true });
  assert.equal(JSON.stringify(plan).includes('registry.npmjs.org'), false);
});
test('dry-run remains plan-only and cannot be read as a candidate', () => {
  const options = parseArgs(['--source-commit', 'b'.repeat(40), '--evidence-dir', '/tmp/r30-plan', '--dry-run']);
  const plan = staticPlan(options); assert.equal(plan.executionStatus, 'PLAN_ONLY_NOT_A_CANDIDATE'); assert.equal(plan.mvpStatus, 'MVP_NOT_COMPLETE');
});
