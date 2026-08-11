import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CONTROL_FILES, GENERATED_INPUTS, LEDGER_SCOPE, NETWORK_PROFILE, NPM_CACHE_KEY_ALIGNMENT_FLAG, bindCommit, buildLedger, classifyInstall, cleanStatus,
  configureCandidateNpmIsolation,
  exactDiscovery, fullCommit, generatedInputsAbsent, offlineEnv, resolveEvidenceTarget, sandboxPlan, trackedFilesFromGit,
  validateLedger,
} from './contract.mjs';

test('Gate 1 rejects abbreviated, uppercase, malformed, and mismatched commit identities', () => {
  for (const value of ['', '6aa6b8c', 'A'.repeat(40), 'g'.repeat(40)]) assert.throws(() => fullCommit(value), /BLOCKED_SOURCE_COMMIT_INVALID/);
  assert.throws(() => bindCommit('a'.repeat(40), 'b'.repeat(40)), /BLOCKED_SOURCE_COMMIT_MISMATCH/);
  assert.equal(bindCommit('a'.repeat(40), 'a'.repeat(40)), 'a'.repeat(40));
});
test('Gate 1 rejects tracked and untracked source drift', () => {
  assert.throws(() => cleanStatus(' M package.json\n'), /BLOCKED_SOURCE_DIRTY/);
  assert.throws(() => cleanStatus('?? stray.txt\n'), /BLOCKED_SOURCE_DIRTY/);
  assert.equal(cleanStatus(''), true);
});
test('Gate 2 is macOS-only, denies network, forces npm offline flags, and has no registry URL', () => {
  const plan = sandboxPlan('/usr/local/bin/npm', ['ci'], 'darwin');
  assert.equal(plan.command, '/usr/bin/sandbox-exec');
  assert.deepEqual(plan.args.slice(0, 2), ['-p', NETWORK_PROFILE]);
  for (const value of ['--offline', '--no-audit', '--no-fund', NPM_CACHE_KEY_ALIGNMENT_FLAG]) assert.ok(plan.args.includes(value));
  assert.equal(plan.args.some((value) => /https?:\/\/|registry\.npmjs/iu.test(value)), false);
  assert.throws(() => sandboxPlan('npm', ['ci'], 'linux'), /BLOCKED_NETWORK_SANDBOX_UNAVAILABLE/);
});
test('Gate 2 strips inherited proxy, registry, and npm config authority while installing candidate isolation', () => {
  const env = offlineEnv(
    {
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy.invalid',
      npm_config_registry: 'https://registry.invalid',
      NODE_AUTH_TOKEN: 'host-node-token',
      NPM_TOKEN: 'host-npm-token',
      NPM_CONFIG_USERCONFIG: '/tmp/host-user.npmrc',
      NPM_CONFIG_GLOBALCONFIG: '/tmp/host-global.npmrc',
    },
    {
      userConfigPath: '/tmp/candidate-user.npmrc',
      globalConfigPath: '/tmp/candidate-global.npmrc',
    },
  );
  assert.equal(env.PATH, '/usr/bin'); assert.equal(env.npm_config_offline, 'true');
  assert.equal(Object.hasOwn(env, 'HTTPS_PROXY'), false); assert.equal(Object.hasOwn(env, 'npm_config_registry'), false);
  assert.equal(Object.hasOwn(env, 'NODE_AUTH_TOKEN'), false); assert.equal(Object.hasOwn(env, 'NPM_TOKEN'), false);
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/candidate-user.npmrc');
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, '/tmp/candidate-global.npmrc');
});
test('Gate 2 ignores a mirror registry in HOME and resolves the isolated npm default registry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r41-host-npmrc-'));
  const home = path.join(root, 'home');
  const isolated = path.join(root, 'isolated');
  await mkdir(home);
  await mkdir(isolated);
  await writeFile(path.join(home, '.npmrc'), 'registry=https://registry.npmmirror.com/\n');
  const userConfigPath = path.join(isolated, 'user.npmrc');
  const globalConfigPath = path.join(isolated, 'global.npmrc');
  await writeFile(userConfigPath, '');
  await writeFile(globalConfigPath, '');
  const env = offlineEnv(
    { ...process.env, HOME: home },
    { userConfigPath, globalConfigPath },
  );
  const result = spawnSync('npm', ['config', 'get', 'registry'], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout.trim(), 'https://registry.npmjs.org/');
  await rm(root, { recursive: true, force: true });
});
test('configured candidate npm isolation applies to every later offline child environment', () => {
  configureCandidateNpmIsolation({
    userConfigPath: '/tmp/candidate-global-user.npmrc',
    globalConfigPath: '/tmp/candidate-global-global.npmrc',
  });
  const env = offlineEnv({
    NPM_CONFIG_USERCONFIG: '/tmp/host-user.npmrc',
    NPM_CONFIG_GLOBALCONFIG: '/tmp/host-global.npmrc',
  });
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/candidate-global-user.npmrc');
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, '/tmp/candidate-global-global.npmrc');
});
test('Gate 2 cache miss requires separate approval and never retries automatically', () => {
  assert.deepEqual(classifyInstall(1, '', 'npm error ENOTCACHED request mode is offline'), {
    code: 'BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED', automaticRetry: false,
    requestedAuthority: 'OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS',
  });
  assert.equal(classifyInstall(0), null);
});
test('Gate 3 parses one complete NUL-delimited git tracked-file set', () => {
  assert.deepEqual(trackedFilesFromGit('b.txt\0a.txt\0'), ['a.txt', 'b.txt']);
  for (const value of ['', 'a.txt', 'a.txt\0a.txt\0', '../escape\0', 'bad\nname\0']) {
    assert.throws(() => trackedFilesFromGit(value), /BLOCKED_GATE_3_/);
  }
});
test('Gate 3 critical controls include exact-object deployment authority and active arm64 wrapper', () => {
  for (const value of [
    'docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md',
    'scripts/candidate-r30/canonical-release-r31.mjs',
    'scripts/candidate-r30/document-authority.test.mjs',
    'scripts/candidate-r30/minimax-authority.mjs',
    'scripts/candidate-r30/minimax-authority.test.mjs',
  ]) assert.ok(CONTROL_FILES.includes(value), value);
});
test('Gate 3 builds a sorted all-byte ledger with exact aggregate identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-ledger-'));
  for (const relative of CONTROL_FILES) { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${relative}\n`); }
  const ledger = await buildLedger(root, 'a'.repeat(40), CONTROL_FILES);
  assert.equal(ledger.schemaVersion, 2);
  assert.equal(ledger.scope, LEDGER_SCOPE);
  assert.equal(ledger.fileCount, CONTROL_FILES.length);
  assert.deepEqual(ledger.files.map((entry) => entry.path), [...CONTROL_FILES].sort());
  assert.equal(ledger.files.every((entry) => Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^[0-9a-f]{64}$/u.test(entry.sha256)), true);
  assert.match(ledger.aggregateSha256, /^[0-9a-f]{64}$/u);
  assert.equal(validateLedger(ledger, CONTROL_FILES), true);

  const shortDigest = structuredClone(ledger); shortDigest.files[0].sha256 = 'a'.repeat(63);
  assert.throws(() => validateLedger(shortDigest, CONTROL_FILES), /BLOCKED_GATE_3_SHA256_INVALID/);
  const duplicate = structuredClone(ledger); duplicate.files.push({ ...duplicate.files[0] }); duplicate.fileCount += 1;
  assert.throws(() => validateLedger(duplicate, CONTROL_FILES), /BLOCKED_GATE_3_LEDGER_DUPLICATE/);
  const missing = structuredClone(ledger); missing.files.pop(); missing.fileCount -= 1;
  assert.throws(() => validateLedger(missing, CONTROL_FILES), /BLOCKED_GATE_3_LEDGER_FILE_SET/);
  const tamperedAggregate = structuredClone(ledger); tamperedAggregate.aggregateSha256 = 'b'.repeat(64);
  assert.throws(() => validateLedger(tamperedAggregate, CONTROL_FILES), /BLOCKED_GATE_3_AGGREGATE_INVALID/);
});
test('Gate 3 rejects symlinked tracked files through no-follow open', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-ledger-link-'));
  for (const relative of CONTROL_FILES) { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'ok\n'); }
  const first = path.join(root, CONTROL_FILES[0]); await chmod(first, 0o600); await rm(first); await writeFile(path.join(root, 'outside'), 'x');
  await symlink(path.join(root, 'outside'), first);
  await assert.rejects(() => buildLedger(root, 'a'.repeat(40), CONTROL_FILES), /BLOCKED_GATE_3_CONTROL_FILE_(?:OPEN|NOT_REGULAR)/u);
});
test('Gate 9 accepts only exactly 113 tests in 9 files', () => {
  assert.deepEqual(exactDiscovery('Listing tests:\nTotal: 113 tests in 9 files\n'), { tests: 113, files: 9 });
  for (const value of ['Total: 50 tests in 9 files', 'Total: 112 tests in 9 files', 'Total: 113 tests in 8 files',
    'Total: 114 tests in 9 files', '113 tests in 9 files', 'Total: 113 tests in 9 files\nTotal: 113 tests in 9 files']) {
    assert.throws(() => exactDiscovery(value), /BLOCKED_GATE_9_/);
  }
});
test('evidence path resolution rejects symlink aliases that land inside the repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-evidence-')); const repo = path.join(root, 'repo'); const outside = path.join(root, 'outside');
  await mkdir(repo); await mkdir(outside);
  const canonicalOutside = await realpath(outside);
  assert.equal(await resolveEvidenceTarget(repo, path.join(outside, 'receipt')), path.join(canonicalOutside, 'receipt'));
  const alias = path.join(root, 'alias'); await symlink(repo, alias);
  await assert.rejects(() => resolveEvidenceTarget(repo, path.join(alias, 'receipt')), /BLOCKED_EVIDENCE_DIR_INSIDE_REPO/);
});
test('Gate 1 rejects pre-existing ignored generated inputs', async () => {
  assert.ok(GENERATED_INPUTS.includes('apps/copilot-desktop/dist')); assert.ok(GENERATED_INPUTS.includes('packages/rag/dist'));
  const root = await mkdtemp(path.join(os.tmpdir(), 'r30-generated-'));
  assert.equal(await generatedInputsAbsent(root, ['apps/copilot-desktop/dist']), true);
  await mkdir(path.join(root, 'apps/copilot-desktop/dist'), { recursive: true });
  await assert.rejects(() => generatedInputsAbsent(root, ['apps/copilot-desktop/dist']), /BLOCKED_GENERATED_INPUT_PRESENT/);
});
