import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AUTHORITY_PATH,
  REQUIRED_AUTHORITY_MARKERS,
  RUNNER_PATH,
  DeploymentAuthorityBlocked,
  inspectDeploymentAuthority,
  materializeDeploymentAuthority,
  parseArgs,
  validateAuthorityDocument,
} from './minimax-authority.mjs';

function validAuthority({
  worktreeCommand = 'git worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"',
} = {}) {
  return `${REQUIRED_AUTHORITY_MARKERS.join('\n')}\n${worktreeCommand}\n${'authority-boundary\n'.repeat(300)}`;
}

function git(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

async function fixture({ withAuthority = true } = {}) {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'copilot-r31-authority-'));
  git(repository, ['init', '-q']);
  git(repository, ['config', 'user.email', 'candidate@example.invalid']);
  git(repository, ['config', 'user.name', 'Candidate Test']);

  await mkdir(path.join(repository, path.dirname(RUNNER_PATH)), { recursive: true });
  await writeFile(path.join(repository, RUNNER_PATH), '#!/usr/bin/env node\n', 'utf8');
  if (withAuthority) {
    await mkdir(path.join(repository, path.dirname(AUTHORITY_PATH)), { recursive: true });
    await writeFile(path.join(repository, AUTHORITY_PATH), validAuthority(), 'utf8');
  }

  git(repository, ['add', '.']);
  git(repository, ['commit', '-q', '-m', 'fixture']);
  return { repository, sourceCommit: git(repository, ['rev-parse', 'HEAD']) };
}

test('parses one exact commit and requires absolute optional outputs', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseArgs([
    '--repository', '/tmp/repo',
    '--source-commit', commit,
    '--authority-output', '/tmp/authority.md',
    '--receipt-output', '/tmp/authority.json',
  ]), {
    repository: '/tmp/repo',
    sourceCommit: commit,
    authorityOutput: '/tmp/authority.md',
    receiptOutput: '/tmp/authority.json',
  });
  assert.throws(
    () => parseArgs(['--source-commit', 'short']),
    /BLOCKED_DEPLOYMENT_AUTHORITY_COMMIT/u,
  );
  assert.throws(
    () => parseArgs(['--source-commit', commit, '--receipt-output', 'relative.json']),
    /BLOCKED_DEPLOYMENT_AUTHORITY_OUTPUT_PATH/u,
  );
});

test('validates a complete authority document and rejects missing markers', () => {
  const identity = validateAuthorityDocument(validAuthority());
  assert.match(identity.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(identity.bytes >= 4_000);

  const invalid = validAuthority().replace('Do not retry online', 'retry however desired');
  assert.throws(
    () => validateAuthorityDocument(invalid),
    (error) => error instanceof DeploymentAuthorityBlocked
      && error.code === 'BLOCKED_DEPLOYMENT_AUTHORITY_INVALID'
      && error.context.missingMarkers.includes('Do not retry online'),
  );

  const missingDetachedWorktree = validAuthority({
    worktreeCommand: 'git -C "$REPO" worktree add "$WORKTREE" "$SOURCE_COMMIT"',
  });
  assert.throws(
    () => validateAuthorityDocument(missingDetachedWorktree),
    (error) => error instanceof DeploymentAuthorityBlocked
      && error.code === 'BLOCKED_DEPLOYMENT_AUTHORITY_INVALID'
      && error.context.missingMarkers.includes('git worktree add --detach'),
  );
});

test('accepts direct and repository-scoped detached-worktree commands', () => {
  assert.doesNotThrow(() => validateAuthorityDocument(validAuthority()));
  assert.doesNotThrow(() => validateAuthorityDocument(validAuthority({
    worktreeCommand: 'git -C "$REPO" worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"',
  })));
});

test('validates the versioned MiniMax authority document used by the exact-object bootstrap', async () => {
  const authority = await readFile(
    new URL('../../docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md', import.meta.url),
    'utf8',
  );
  const identity = validateAuthorityDocument(authority);
  assert.match(identity.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(identity.bytes >= 4_000);
});

test('reads authority and runner from the exact Git object rather than the checked-out worktree', async () => {
  const { repository, sourceCommit } = await fixture();
  try {
    const checkoutAuthority = path.join(repository, AUTHORITY_PATH);
    await writeFile(
      checkoutAuthority,
      'stale checkout no longer contains usable authority\n',
      'utf8',
    );

    const receipt = await inspectDeploymentAuthority({ repository, sourceCommit });
    assert.equal(receipt.status, 'PASS');
    assert.equal(receipt.sourceCommit, sourceCommit);
    assert.equal(receipt.executionAuthority, 'git-object-at-exact-commit');
    assert.match(receipt.authoritySha256, /^[0-9a-f]{64}$/u);
    assert.equal(receipt.networkUsed, false);
    assert.equal(receipt.worktreeCreated, false);
    assert.equal(receipt.evidenceCreated, false);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test('fails closed when the exact commit or authority file is unavailable', async () => {
  const present = await fixture();
  const missing = await fixture({ withAuthority: false });
  try {
    await assert.rejects(
      inspectDeploymentAuthority({
        repository: present.repository,
        sourceCommit: 'f'.repeat(40),
      }),
      (error) => error.code === 'BLOCKED_EXACT_COMMIT_NOT_FETCHED',
    );
    await assert.rejects(
      inspectDeploymentAuthority({
        repository: missing.repository,
        sourceCommit: missing.sourceCommit,
      }),
      (error) => error.code === 'BLOCKED_DEPLOYMENT_AUTHORITY_MISSING',
    );
  } finally {
    await rm(present.repository, { recursive: true, force: true });
    await rm(missing.repository, { recursive: true, force: true });
  }
});

test('materializes one exclusive authority copy and receipt without creating candidate state', async () => {
  const { repository, sourceCommit } = await fixture();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-r31-authority-output-'));
  const authorityOutput = path.join(outputRoot, 'authority.md');
  const receiptOutput = path.join(outputRoot, 'authority.json');
  try {
    const receipt = await materializeDeploymentAuthority({
      repository,
      sourceCommit,
      authorityOutput,
      receiptOutput,
    });
    assert.equal(receipt.sourceCommit, sourceCommit);
    assert.equal(await readFile(authorityOutput, 'utf8'), validAuthority());
    const written = JSON.parse(await readFile(receiptOutput, 'utf8'));
    assert.equal(written.status, 'PASS');
    assert.equal(written.evidenceCreated, false);

    await assert.rejects(
      materializeDeploymentAuthority({ repository, sourceCommit, authorityOutput }),
      (error) => error.code === 'BLOCKED_DEPLOYMENT_AUTHORITY_OUTPUT_EXISTS',
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
