import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.env.COPILOT_R30_REPO_ROOT || defaultRoot);
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const mirrorFiles = [
  'docs/AI_HANDOVER.md',
  'docs/ARCHITECTURE.md',
  'docs/PROJECT_PROGRESS.json',
  'docs/PROJECT_STATUS.md',
  'docs/RISKS.md',
  'docs/TODO.md',
];

test('all six former low-confidence handoff surfaces are authoritative mirrors, not placeholders', async () => {
  const values = await Promise.all(mirrorFiles.map(async (file) => [file, await read(file)]));
  for (const [file, content] of values) {
    assert.match(content, /MVP_NOT_COMPLETE/u, file);
    assert.match(content, /goal\.md|PROJECT_STATE\.yaml/u, file);
    assert.doesNotMatch(content, /^# (Architecture|Risks|TODO)\n\n(?:- .+\n?){1,4}$/u, file);
  }
});

test('architecture wrapper preserves authority and routes to the byte-preserved detailed architecture', async () => {
  const [architecture, history, stateHistory, statusHistory, todoHistory] = await Promise.all([
    read('docs/ARCHITECTURE.md'),
    read('docs/history/ARCHITECTURE_PRE_R30.md'),
    read('docs/history/PROJECT_STATE_PRE_R30.yaml'),
    read('docs/history/PROJECT_STATUS_PRE_R30.md'),
    read('docs/history/TODO_PRE_R30.md'),
  ]);
  assert.ok(architecture.length > 3000, `architecture wrapper too short: ${architecture.length}`);
  assert.match(architecture, /history\/ARCHITECTURE_PRE_R30\.md/u);
  for (const token of ['Local-First Product Authority', 'Electron Trust', 'R30 GitHub-Bound Successor', 'Gate 2', 'Gate 3', 'Gate 9', 'Deferred']) {
    assert.match(architecture, new RegExp(token, 'iu'));
  }
  assert.ok(history.length > 7000, `preserved architecture too short: ${history.length}`);
  for (const token of ['Grounded Ask', 'Candidate Receipt', 'Todo', 'fail-closed']) assert.match(history, new RegExp(token, 'iu'));
  assert.ok(stateHistory.length > 5000, `preserved project state too short: ${stateHistory.length}`);
  assert.ok(statusHistory.length > 9000, `preserved project status too short: ${statusHistory.length}`);
  assert.ok(todoHistory.length > 5000, `preserved TODO too short: ${todoHistory.length}`);
  assert.match(statusHistory, /R28|MVP_NOT_COMPLETE/iu);
});

test('project progress JSON is a truthful machine mirror with no candidate inflation', async () => {
  const progress = JSON.parse(await read('docs/PROJECT_PROGRESS.json'));
  assert.equal(progress.confidence, 'authoritative_mirror');
  assert.equal(progress.status, 'BLOCKED');
  assert.equal(progress.mvp_status, 'MVP_NOT_COMPLETE');
  assert.equal(progress.candidate.established, false);
  assert.equal(progress.candidate.artifact_sha256, null);
  assert.equal(progress.candidate.runtime_id, null);
  assert.deepEqual(progress.r30.gate_9.exact_discovery, { tests: 113, files: 9 });
  assert.equal(progress.r30.local_execution, 'NOT_RUN');
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

test('risk and todo mirrors carry concrete blockers and the exact next handoff', async () => {
  const [risks, todo] = await Promise.all([read('docs/RISKS.md'), read('docs/TODO.md')]);
  for (const token of ['R28', 'SHA256', 'network', 'signing']) assert.match(risks, new RegExp(token, 'iu'));
  assert.match(todo, /agent\/r30-github-bound-candidate-runner/u);
  assert.match(todo, /113 tests in 9 files/u);
  assert.match(todo, /MiniMax Code/u);
  assert.match(todo, /Codex/u);
});

test('root governance files remain blocked and describe the R30 handoff without runtime claims', async () => {
  const [state, status, todo, changelog] = await Promise.all([
    read('PROJECT_STATE.yaml'),
    read('PROJECT_STATUS.md'),
    read('TODO.md'),
    read('CHANGELOG.md'),
  ]);
  for (const content of [state, status, todo, changelog]) {
    assert.match(content, /MVP_NOT_COMPLETE/u);
    assert.match(content, /R30/u);
  }
  assert.match(state, /local_execution:\s*NOT_RUN/u);
  assert.match(state, /artifact_sha256:\s*null/u);
  assert.match(state, /runtime_id:\s*null/u);
  assert.match(status, /BLOCKED/u);
  assert.match(todo, /MiniMax Code/u);
  assert.match(changelog, /Gate 2/u);
  assert.match(changelog, /Gate 3/u);
  assert.match(changelog, /Gate 9/u);
  assert.match(changelog, /history\/CHANGELOG_PRE_R30\.md/u);
});
