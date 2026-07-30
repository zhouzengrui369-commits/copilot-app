import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const EXACT_TESTS = 113;
export const EXACT_FILES = 9;
export const NETWORK_PROFILE = '(version 1)\n(allow default)\n(deny network*)\n';
export const CONTROL_FILES = Object.freeze([
  'apps/copilot-desktop/electron-builder.yml',
  'apps/copilot-desktop/package.json',
  'apps/copilot-desktop/playwright.electron.config.ts',
  'apps/copilot-desktop/scripts/run-electron-e2e.mjs',
  'package-lock.json',
  'package.json',
  'scripts/candidate-r30/contract.mjs',
  'scripts/candidate-r30/gates-build.mjs',
  'scripts/candidate-r30/gates-electron.mjs',
  'scripts/candidate-r30/io.mjs',
  'scripts/candidate-r30/run-candidate.mjs',
]);
export const GENERATED_INPUTS = Object.freeze([
  'apps/copilot-desktop/.vite', 'apps/copilot-desktop/coverage',
  'apps/copilot-desktop/dist', 'apps/copilot-desktop/playwright-report',
  'apps/copilot-desktop/release', 'apps/copilot-desktop/test-results',
  'coverage', 'playwright-report', 'test-results',
  'packages/kb/coverage', 'packages/kb/dist',
  'packages/kg/coverage', 'packages/kg/dist',
  'packages/llm-client/coverage', 'packages/llm-client/dist',
  'packages/rag/coverage', 'packages/rag/dist',
]);

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ENV_KEYS = [
  'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy',
  'NPM_CONFIG_PROXY', 'NPM_CONFIG_HTTPS_PROXY', 'NPM_CONFIG_REGISTRY',
  'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_registry',
  'COPILOT_CANDIDATE_REGISTRY_ORIGIN',
];

export class CandidateBlocked extends Error {
  constructor(code, gate = 0, detail = '', context = {}) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'CandidateBlocked';
    this.code = code;
    this.gate = gate;
    this.detail = detail;
    this.context = context;
  }
}
export function block(code, gate = 0, detail = '', context = {}) {
  throw new CandidateBlocked(code, gate, detail, context);
}
export function fullCommit(value, label = 'commit') {
  if (typeof value !== 'string' || !COMMIT.test(value)) block('BLOCKED_SOURCE_COMMIT_INVALID', 1, label);
  return value;
}
export function bindCommit(expected, actual) {
  fullCommit(expected, 'expected'); fullCommit(actual, 'actual');
  if (expected !== actual) block('BLOCKED_SOURCE_COMMIT_MISMATCH', 1, `${actual} != ${expected}`);
  return actual;
}
export function cleanStatus(value) {
  if (typeof value !== 'string') block('BLOCKED_SOURCE_STATUS_INVALID', 1);
  if (value) block('BLOCKED_SOURCE_DIRTY', 1, value.replaceAll('\n', ' | '));
  return true;
}
export function offlineEnv(base = {}) {
  const result = { ...base };
  for (const key of ENV_KEYS) delete result[key];
  Object.assign(result, {
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', COPILOT_CANDIDATE_NETWORK_AUTHORITY: 'offline-only',
  });
  return result;
}
export function sandboxPlan(command, args = [], platform = process.platform) {
  if (platform !== 'darwin') block('BLOCKED_NETWORK_SANDBOX_UNAVAILABLE', 2, platform);
  if (!command) block('BLOCKED_CANDIDATE_COMMAND_INVALID', 0);
  const finalArgs = [...args];
  if (path.basename(command) === 'npm' && finalArgs[0] === 'ci') {
    for (const value of ['--offline', '--no-audit', '--no-fund']) if (!finalArgs.includes(value)) finalArgs.push(value);
  }
  if ([command, ...finalArgs].some((value) => /https?:\/\/|registry\.npmjs/iu.test(String(value)))) {
    block('BLOCKED_NETWORK_AUTHORITY_UNAPPROVED', 2);
  }
  return { command: '/usr/bin/sandbox-exec', args: ['-p', NETWORK_PROFILE, command, ...finalArgs] };
}
export function classifyInstall(status, stdout = '', stderr = '') {
  if (status === 0) return null;
  if (/ENOTCACHED|cache\s+miss|not\s+in\s+cache|mode\s+is\s+offline/iu.test(`${stdout}\n${stderr}`)) {
    return { code: 'BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED', automaticRetry: false,
      requestedAuthority: 'OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS' };
  }
  return { code: 'BLOCKED_NPM_OFFLINE_INSTALL_FAILED', automaticRetry: false, requestedAuthority: null };
}
function inside(parent, child) {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
}
async function futureRealpath(target) {
  let cursor = path.resolve(target); const suffix = [];
  while (true) {
    try { return path.join(await realpath(cursor), ...suffix); }
    catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor); if (parent === cursor) throw error;
      suffix.unshift(path.basename(cursor)); cursor = parent;
    }
  }
}
export async function resolveEvidenceTarget(repoRoot, evidenceDir) {
  if (!path.isAbsolute(repoRoot) || !path.isAbsolute(evidenceDir)) block('BLOCKED_EVIDENCE_DIR_NOT_ABSOLUTE', 0);
  const [repo, target] = await Promise.all([realpath(repoRoot), futureRealpath(evidenceDir)]);
  if (inside(repo, target)) block('BLOCKED_EVIDENCE_DIR_INSIDE_REPO', 0, target);
  return target;
}
function relativeFile(value) {
  if (!value || path.isAbsolute(value) || value.includes('\\') || value.split('/').includes('..')) {
    block('BLOCKED_GATE_3_LEDGER_PATH_INVALID', 3, String(value));
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.') block('BLOCKED_GATE_3_LEDGER_PATH_INVALID', 3, value);
  return normalized;
}
export async function generatedInputsAbsent(repoRoot, paths = GENERATED_INPUTS) {
  for (const value of paths) {
    const relative = relativeFile(value); const absolute = path.resolve(repoRoot, relative);
    if (!inside(repoRoot, absolute)) block('BLOCKED_GENERATED_INPUT_PATH_OUTSIDE_REPO', 1, relative);
    try { await lstat(absolute); block('BLOCKED_GENERATED_INPUT_PRESENT', 1, relative); }
    catch (error) {
      if (error instanceof CandidateBlocked) throw error;
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
  }
  return true;
}
async function fileDigest(repoRoot, relative) {
  const absolute = path.resolve(repoRoot, relative); const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) block('BLOCKED_GATE_3_CONTROL_FILE_NOT_REGULAR', 3, relative);
  return createHash('sha256').update(await readFile(absolute)).digest('hex');
}
export function validateLedger(ledger, expected = CONTROL_FILES) {
  if (ledger?.schemaVersion !== 1 || ledger?.algorithm !== 'sha256' || !Array.isArray(ledger.files)) {
    block('BLOCKED_GATE_3_LEDGER_SCHEMA', 3);
  }
  fullCommit(ledger.sourceCommit, 'ledger');
  const paths = []; const seen = new Set();
  for (const entry of ledger.files) {
    const relative = relativeFile(entry?.path);
    if (seen.has(relative)) block('BLOCKED_GATE_3_LEDGER_DUPLICATE', 3, relative);
    if (!SHA256.test(entry?.sha256 ?? '')) block('BLOCKED_GATE_3_SHA256_INVALID', 3, relative);
    seen.add(relative); paths.push(relative);
  }
  const wanted = expected.map(relativeFile).sort(); paths.sort();
  if (JSON.stringify(paths) !== JSON.stringify(wanted)) block('BLOCKED_GATE_3_LEDGER_FILE_SET', 3);
  return true;
}
export async function buildLedger(repoRoot, sourceCommit, expected = CONTROL_FILES) {
  fullCommit(sourceCommit, 'ledger');
  if (new Set(expected).size !== expected.length) block('BLOCKED_GATE_3_LEDGER_DUPLICATE', 3);
  const files = [];
  for (const relative of [...expected].map(relativeFile).sort()) files.push({ path: relative, sha256: await fileDigest(repoRoot, relative) });
  const ledger = { schemaVersion: 1, algorithm: 'sha256', sourceCommit, files };
  validateLedger(ledger, expected); return ledger;
}
export function exactDiscovery(output) {
  const matches = [...String(output).matchAll(/^\s*Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?\s*$/gimu)];
  if (matches.length !== 1) block('BLOCKED_GATE_9_SUMMARY_NOT_UNIQUE', 9, `matches=${matches.length}`);
  const tests = Number(matches[0][1]); const files = Number(matches[0][2]);
  if (tests !== EXACT_TESTS || files !== EXACT_FILES) block('BLOCKED_GATE_9_DISCOVERY_NOT_EXACT', 9, `${tests}/${files}`);
  return { tests, files };
}
export function exactElectron(evidence, expected) {
  const counts = evidence?.counts;
  if (!counts || counts.expected !== expected || counts.passed !== expected || counts.skipped !== 0
    || counts.unexpected !== 0 || counts.flaky !== 0 || evidence.cleanProcessExit !== true
    || evidence.processExitCode !== 0 || evidence.processSignalCode !== null
    || evidence.playwrightExitCode !== 0 || !Array.isArray(evidence.hardFailures) || evidence.hardFailures.length) {
    block(expected === EXACT_TESTS ? 'BLOCKED_GATE_10_FULL_ELECTRON_NOT_EXACT' : 'BLOCKED_GATE_08_FOCUSED_ELECTRON', expected === EXACT_TESTS ? 10 : 8);
  }
  return true;
}
