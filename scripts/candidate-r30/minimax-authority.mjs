#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTHORITY_SCHEMA_VERSION = 1;
export const AUTHORITY_PATH = 'docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md';
export const RUNNER_PATH = 'scripts/candidate-r30/run-candidate.mjs';
export const REQUIRED_AUTHORITY_MARKERS = Object.freeze([
  '# MiniMax Code Local Deployment',
  'BLOCKED / MVP_NOT_COMPLETE / LOCAL_CANDIDATE_NOT_RUN',
  'Use the exact supplied commit SHA',
  'node --test scripts/candidate-r30/*.test.mjs',
  '--dry-run',
  'BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED',
  'CANDIDATE-MANIFEST.json',
  'R30-COMPLETE.json',
  'Do not retry online',
  'Only after this package is complete may Codex',
]);
export const REQUIRED_AUTHORITY_COMMANDS = Object.freeze([
  Object.freeze({
    marker: 'git worktree add --detach',
    pattern: /\bgit(?:\s+-C\s+(?:"[^"\n]+"|'[^'\n]+'|[^\s\n]+))?\s+worktree\s+add\s+--detach(?:\s|$)/u,
  }),
]);

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const MIN_AUTHORITY_BYTES = 4_000;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

export class DeploymentAuthorityBlocked extends Error {
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'DeploymentAuthorityBlocked';
    this.code = code;
    this.detail = detail;
    this.context = context;
  }
}

function block(code, detail, context) {
  throw new DeploymentAuthorityBlocked(code, detail, context);
}

export function parseArgs(argv) {
  const parsed = {
    repository: process.cwd(),
    sourceCommit: null,
    authorityOutput: null,
    receiptOutput: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--repository') parsed.repository = requiredValue(argv, ++index, token);
    else if (token === '--source-commit') parsed.sourceCommit = requiredValue(argv, ++index, token);
    else if (token === '--authority-output') parsed.authorityOutput = requiredValue(argv, ++index, token);
    else if (token === '--receipt-output') parsed.receiptOutput = requiredValue(argv, ++index, token);
    else block('BLOCKED_DEPLOYMENT_AUTHORITY_ARGUMENT', `unknown argument ${String(token)}`);
  }
  if (!parsed.sourceCommit || !FULL_COMMIT.test(parsed.sourceCommit)) {
    block(
      'BLOCKED_DEPLOYMENT_AUTHORITY_COMMIT',
      'source commit must be exactly 40 lower-case hexadecimal characters',
    );
  }
  for (const [name, value] of [
    ['authority output', parsed.authorityOutput],
    ['receipt output', parsed.receiptOutput],
  ]) {
    if (value !== null && !path.isAbsolute(value)) {
      block('BLOCKED_DEPLOYMENT_AUTHORITY_OUTPUT_PATH', `${name} must be absolute`, { value });
    }
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    block('BLOCKED_DEPLOYMENT_AUTHORITY_ARGUMENT', `missing value for ${flag}`);
  }
  return value;
}

export function validateAuthorityDocument(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) < MIN_AUTHORITY_BYTES) {
    block(
      'BLOCKED_DEPLOYMENT_AUTHORITY_INVALID',
      'authority document is missing or implausibly short',
    );
  }
  if (content.includes('\u0000')) {
    block('BLOCKED_DEPLOYMENT_AUTHORITY_INVALID', 'authority document contains a NUL byte');
  }
  const missingMarkers = [
    ...REQUIRED_AUTHORITY_MARKERS.filter((marker) => !content.includes(marker)),
    ...REQUIRED_AUTHORITY_COMMANDS
      .filter(({ pattern }) => !pattern.test(content))
      .map(({ marker }) => marker),
  ];
  if (missingMarkers.length > 0) {
    block(
      'BLOCKED_DEPLOYMENT_AUTHORITY_INVALID',
      'authority document is missing required markers',
      { missingMarkers },
    );
  }
  const bytes = Buffer.from(content, 'utf8');
  return {
    bytes: bytes.byteLength,
    lines: content.split('\n').length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function runGit(repository, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  const status = result.status ?? (result.error ? 1 : 0);
  if (!allowFailure && status !== 0) {
    block('BLOCKED_DEPLOYMENT_AUTHORITY_GIT', `git ${args.join(' ')} failed`, {
      status,
      stderr: (result.stderr ?? result.error?.message ?? '').trim(),
    });
  }
  return {
    status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

export async function inspectDeploymentAuthority({ repository, sourceCommit }) {
  if (!FULL_COMMIT.test(String(sourceCommit ?? ''))) {
    block(
      'BLOCKED_DEPLOYMENT_AUTHORITY_COMMIT',
      'source commit must be exactly 40 lower-case hexadecimal characters',
    );
  }

  let canonicalRepository;
  try {
    canonicalRepository = await realpath(path.resolve(repository));
  } catch (error) {
    block('BLOCKED_DEPLOYMENT_AUTHORITY_REPOSITORY', 'repository path cannot be resolved', {
      repository,
      code: error?.code ?? null,
    });
  }

  const inside = runGit(
    canonicalRepository,
    ['rev-parse', '--is-inside-work-tree'],
    { allowFailure: true },
  );
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    block('BLOCKED_DEPLOYMENT_AUTHORITY_REPOSITORY', 'path is not a Git worktree', {
      repository: canonicalRepository,
    });
  }

  const commit = runGit(
    canonicalRepository,
    ['cat-file', '-e', `${sourceCommit}^{commit}`],
    { allowFailure: true },
  );
  if (commit.status !== 0) {
    block(
      'BLOCKED_EXACT_COMMIT_NOT_FETCHED',
      'exact source commit is not available in the local object database',
      { sourceCommit },
    );
  }

  const authority = runGit(
    canonicalRepository,
    ['show', `${sourceCommit}:${AUTHORITY_PATH}`],
    { allowFailure: true },
  );
  if (authority.status !== 0) {
    block(
      'BLOCKED_DEPLOYMENT_AUTHORITY_MISSING',
      'authority document is absent from the exact source commit',
      { sourceCommit, authorityPath: AUTHORITY_PATH },
    );
  }

  const runner = runGit(
    canonicalRepository,
    ['cat-file', '-e', `${sourceCommit}:${RUNNER_PATH}`],
    { allowFailure: true },
  );
  if (runner.status !== 0) {
    block(
      'BLOCKED_DEPLOYMENT_RUNNER_MISSING',
      'candidate runner is absent from the exact source commit',
      { sourceCommit, runnerPath: RUNNER_PATH },
    );
  }

  const identity = validateAuthorityDocument(authority.stdout);
  return {
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    status: 'PASS',
    sourceCommit,
    repository: canonicalRepository,
    authorityPath: AUTHORITY_PATH,
    authoritySha256: identity.sha256,
    authorityBytes: identity.bytes,
    authorityLines: identity.lines,
    runnerPath: RUNNER_PATH,
    executionAuthority: 'git-object-at-exact-commit',
    networkUsed: false,
    worktreeCreated: false,
    evidenceCreated: false,
    content: authority.stdout,
  };
}

async function writeExclusive(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(
      file,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      block(
        'BLOCKED_DEPLOYMENT_AUTHORITY_OUTPUT_EXISTS',
        'refusing to overwrite an existing output',
        { file },
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function materializeDeploymentAuthority(options) {
  const inspected = await inspectDeploymentAuthority(options);
  const receipt = { ...inspected };
  delete receipt.content;

  if (options.authorityOutput) {
    await writeExclusive(options.authorityOutput, Buffer.from(inspected.content, 'utf8'));
    receipt.authorityOutput = options.authorityOutput;
  }
  if (options.receiptOutput) {
    await writeExclusive(
      options.receiptOutput,
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
    );
    receipt.receiptOutput = options.receiptOutput;
  }
  return receipt;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const receipt = await materializeDeploymentAuthority(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const blocked = error instanceof DeploymentAuthorityBlocked
      ? error
      : new DeploymentAuthorityBlocked(
        'BLOCKED_DEPLOYMENT_AUTHORITY_UNEXPECTED',
        error instanceof Error ? error.message : String(error),
      );
    process.stderr.write(`${JSON.stringify({
      schemaVersion: AUTHORITY_SCHEMA_VERSION,
      status: 'BLOCKED',
      code: blocked.code,
      detail: blocked.detail,
      context: blocked.context,
      networkUsed: false,
      worktreeCreated: false,
      evidenceCreated: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const currentScript = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentScript) await main();
