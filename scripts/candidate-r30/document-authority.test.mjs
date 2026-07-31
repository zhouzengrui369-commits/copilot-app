import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.env.COPILOT_R30_REPO_ROOT || defaultRoot);
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const mirrorFiles = [
  'docs/AI_HANDOVER.md',
  'docs/ARCHITECTURE.md',
  'docs/PROJECT_PROGRESS.json',
  'docs/PROJECT_STATUS.md',
  'docs/RISKS.md',
  'docs/TODO.md',
];

test('all six handoff surfaces are authoritative R31 mirrors, not placeholders', async () => {
  const values = await Promise.all(mirrorFiles.map(async (file) => [file, await read(file)]));
  for (const [file, content] of values) {
    assert.match(content, /MVP_NOT_COMPLETE/u, file);
    assert.match(content, /goal\.md|PROJECT_STATE\.yaml/u, file);
    assert.match(content, /R31|r31/u, file);
    assert.doesNotMatch(content, /^# (Architecture|Risks|TODO)\n\n(?:- .+\n?){1,4}$/u, file);
  }
});

test('architecture mirror preserves authority and the byte-preserved detailed history', async () => {
  const [architecture, history, stateHistory, statusHistory, todoHistory] = await Promise.all([
    read('docs/ARCHITECTURE.md'),
    read('docs/history/ARCHITECTURE_PRE_R30.md'),
    read('docs/history/PROJECT_STATE_PRE_R30.yaml'),
    read('docs/history/PROJECT_STATUS_PRE_R30.md'),
    read('docs/history/TODO_PRE_R30.md'),
  ]);
  assert.ok(architecture.length > 7000, `architecture mirror too short: ${architecture.length}`);
  assert.match(architecture, /history\/ARCHITECTURE_PRE_R30\.md/u);
  for (const token of [
    'Local-First Product Authority',
    'Fail-Closed Truth',
    'Embedded-Local Production Default',
    'Single-Model Vector Scope',
    'Electron Trust',
    'Twelve Candidate Gates',
    'Gate 2',
    'Gate 3',
    'Gates 8–10',
    'Gate 11',
    'Gate 12',
    'Deferred',
  ]) assert.match(architecture, new RegExp(token, 'iu'));
  assert.ok(history.length > 7000, `preserved architecture too short: ${history.length}`);
  for (const token of ['Grounded Ask', 'Candidate Receipt', 'Todo', 'fail-closed']) {
    assert.match(history, new RegExp(token, 'iu'));
  }
  assert.ok(stateHistory.length > 5000, `preserved project state too short: ${stateHistory.length}`);
  assert.ok(statusHistory.length > 9000, `preserved project status too short: ${statusHistory.length}`);
  assert.ok(todoHistory.length > 5000, `preserved TODO too short: ${todoHistory.length}`);
  assert.match(statusHistory, /R28|MVP_NOT_COMPLETE/iu);
});

test('project progress JSON is truthful machine-readable source completion without candidate inflation', async () => {
  const progress = JSON.parse(await read('docs/PROJECT_PROGRESS.json'));
  assert.equal(progress.confidence, 'authoritative_mirror');
  assert.equal(progress.status, 'BLOCKED');
  assert.equal(progress.mvp_status, 'MVP_NOT_COMPLETE');
  assert.equal(progress.github_source_status, 'SOURCE_COMPLETE');
  assert.equal(progress.candidate.established, false);
  assert.equal(progress.candidate.artifact_sha256, null);
  assert.equal(progress.candidate.runtime_id, null);
  assert.equal(progress.r30.local_execution, 'NOT_RUN');
  assert.deepEqual(progress.r30.gate_9.exact_discovery, { tests: 113, files: 9 });
  assert.equal(progress.r31.status, 'SOURCE_COMPLETE');
  assert.equal(progress.r31.source_features.candidate_gate_count, 12);
  assert.equal(progress.r31.source_features.deployment_authority_bootstrap, 'exact_git_object');
  assert.equal(progress.r31.source_validation_checkpoint.desktop_phase1_tests.passed, 1106);
  assert.equal(progress.r31.source_validation_checkpoint.local_knowledge_service_branch_percent, 90);
  assert.equal(progress.r31.source_validation_checkpoint.electron_list_only.exact, true);
});

test('handover and status force root v6.2 reading before docs mirrors', async () => {
  const [handover, status] = await Promise.all([
    read('docs/AI_HANDOVER.md'),
    read('docs/PROJECT_STATUS.md'),
  ]);
  for (const content of [handover, status]) {
    const rootIndex = content.indexOf('goal.md');
    const mirrorIndex = content.indexOf('docs/PROJECT_STATUS.md');
    assert.ok(rootIndex >= 0, 'goal.md missing');
    assert.ok(mirrorIndex < 0 || rootIndex < mirrorIndex, 'docs mirror precedes root authority');
    assert.match(content, /ChatGPT.*GitHub/su);
    assert.match(content, /MiniMax Code.*exact|MiniMax Code.*精确/su);
    assert.match(content, /Codex.*independent|Codex.*独立/su);
  }
});

test('risk and todo mirrors carry concrete blockers and the exact R31 handoff', async () => {
  const [risks, todo] = await Promise.all([read('docs/RISKS.md'), read('docs/TODO.md')]);
  for (const token of ['R28', 'SHA256', 'network', 'signing', 'Gate 11', 'SBOM']) {
    assert.match(risks, new RegExp(token, 'iu'));
  }
  assert.match(risks, /stale worktree|Git object/iu);
  assert.match(todo, /agent\/r31-source-completion/u);
  assert.match(todo, /113 tests in 9 files/u);
  assert.match(todo, /twelve|十二/iu);
  assert.match(todo, /minimax-authority\.mjs/u);
  assert.match(todo, /MiniMax Code/u);
  assert.match(todo, /Codex/u);
});

test('root governance remains blocked while marking GitHub source complete and local execution not run', async () => {
  const [state, status, todo, decisions, changelog] = await Promise.all([
    read('PROJECT_STATE.yaml'),
    read('PROJECT_STATUS.md'),
    read('TODO.md'),
    read('DECISIONS.md'),
    read('CHANGELOG.md'),
  ]);
  for (const content of [state, status, todo, changelog]) {
    assert.match(content, /MVP_NOT_COMPLETE/u);
    assert.match(content, /R31|r31/u);
  }
  assert.match(decisions, /R31|r31/u);
  assert.match(decisions, /Development Evidence Is Not Candidate Identity/u);
  assert.match(state, /github_source:\s*SOURCE_COMPLETE/u);
  assert.match(state, /local_execution:\s*NOT_RUN/u);
  assert.match(state, /artifact_sha256:\s*null/u);
  assert.match(state, /runtime_id:\s*null/u);
  assert.match(state, /gate_12:/u);
  assert.match(state, /deployment_authority_bootstrap:/u);
  assert.match(status, /BLOCKED/u);
  assert.match(status, /1106\/1106/u);
  assert.match(status, /exact Git commit object/iu);
  assert.match(todo, /scripts\/candidate-r30\/run-candidate\.mjs/u);
  assert.match(todo, /scripts\/candidate-r30\/minimax-authority\.mjs/u);
  assert.match(todo, /EXACT_FINAL_HEAD/u);
  assert.match(decisions, /Embedded-Local Is The Production Retrieval Embedding Default/u);
  assert.match(decisions, /Twelve-Gate Exact-Commit Candidate Contract/u);
  assert.match(decisions, /Deployment Authority Is Read From The Exact Git Object/u);
  assert.match(changelog, /Gate 2/u);
  assert.match(changelog, /Gate 3/u);
  assert.match(changelog, /Gate 9/u);
  assert.match(changelog, /Gate 11/u);
  assert.match(changelog, /Gate 12/u);
  assert.match(changelog, /exact Git object/iu);
  assert.match(changelog, /history\/CHANGELOG_PRE_R30\.md/u);
});

test('MiniMax deployment handoff bootstraps authority from the exact Git object and remains fail-closed', async () => {
  const [deploy, bootstrap] = await Promise.all([
    read('docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md'),
    read('scripts/candidate-r30/minimax-authority.mjs'),
  ]);
  for (const token of [
    'EXACT_FINAL_40_HEX_PR14_HEAD',
    'git -C "$REPO" fetch --no-tags --prune origin refs/pull/14/head',
    'git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${AUTHORITY_PATH}"',
    'git -C "$REPO" show "${SOURCE_COMMIT}:${BOOTSTRAP_PATH}"',
    'scripts/candidate-r30/minimax-authority.mjs',
    'git-object-at-exact-commit',
    'git -C "$REPO" worktree add --detach',
    'git status --porcelain=v1 --untracked-files=all',
    'sandbox-exec',
    'node --test scripts/candidate-r30/*.test.mjs',
    '--dry-run',
    'PLAN_ONLY_NOT_A_CANDIDATE',
    'BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED',
    'CANDIDATE-MANIFEST.json',
    'R30-COMPLETE.json',
  ]) assert.match(deploy, new RegExp(escapeRegExp(token), 'u'));
  assert.match(deploy, /Absence from a stale checkout is not proof/iu);
  assert.match(deploy, /Do not retry online|Do not.*online/su);
  assert.match(deploy, /unsigned diagnostic candidate/iu);

  for (const token of [
    'BLOCKED_EXACT_COMMIT_NOT_FETCHED',
    'BLOCKED_DEPLOYMENT_AUTHORITY_MISSING',
    'BLOCKED_DEPLOYMENT_AUTHORITY_INVALID',
    'BLOCKED_DEPLOYMENT_RUNNER_MISSING',
    'executionAuthority',
    'networkUsed: false',
    'worktreeCreated: false',
    'evidenceCreated: false',
  ]) assert.match(bootstrap, new RegExp(escapeRegExp(token), 'u'));
  assert.doesNotMatch(bootstrap, /npm\s+(?:ci|install)|fetch\(/u);
});
