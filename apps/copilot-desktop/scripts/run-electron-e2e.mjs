import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const cli = path.join(repoRoot, 'node_modules/@playwright/test/cli.js');
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const mode = process.env.COPILOT_E2E_MODE === 'release' ? 'release' : 'current-source';
const resultRoot = path.join(appRoot, 'test-results');
const jsonReportPath = absoluteEnvPath(
  'COPILOT_E2E_PLAYWRIGHT_JSON_PATH',
  path.join(resultRoot, 'electron-e2e-results.json'),
);
const evidencePath = absoluteEnvPath(
  'COPILOT_E2E_EVIDENCE_PATH',
  path.join(resultRoot, 'electron-e2e-evidence.json'),
);
const CURRENT_SOURCE_ELECTRON_VERSION = '38.8.6';
const CURRENT_SOURCE_ELECTRON_MODULE_ABI = '139';

function absoluteEnvPath(name, fallback) {
  const value = process.env[name] || fallback;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  return path.resolve(value);
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
}

function git(commandArgs) {
  const result = spawnSync('git', commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ${commandArgs.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trimEnd();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(file) {
  return digest(await readFile(file));
}

async function sha256Path(target) {
  const stat = await lstat(target);
  if (stat.isFile()) return sha256File(target);
  if (stat.isSymbolicLink()) return digest(`symlink\0${await readlink(target)}`);
  if (!stat.isDirectory()) return digest(`other\0${stat.mode}\0${stat.size}`);

  const hash = createHash('sha256');
  const visit = async (directory, relative = '') => {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const absolute = path.join(directory, name);
      const childRelative = path.posix.join(relative, name);
      const child = await lstat(absolute);
      if (child.isDirectory()) {
        hash.update(`dir\0${childRelative}\0`);
        await visit(absolute, childRelative);
      } else if (child.isSymbolicLink()) {
        hash.update(`symlink\0${childRelative}\0${await readlink(absolute)}\0`);
      } else if (child.isFile()) {
        hash.update(`file\0${childRelative}\0${child.size}\0${await sha256File(absolute)}\0`);
      }
    }
  };
  await visit(target);
  return hash.digest('hex');
}

export async function resolveDevelopmentElectronExecutable({
  electronPackageRoot = path.join(appRoot, 'node_modules/electron'),
  overrideDistPath = process.env.ELECTRON_OVERRIDE_DIST_PATH,
} = {}) {
  let packageRoot = electronPackageRoot;
  let distRoot = path.join(electronPackageRoot, 'dist');
  if (overrideDistPath) {
    if (!path.isAbsolute(overrideDistPath)) {
      throw new Error('BLOCKED_ELECTRON_OVERRIDE_DIST_PATH_NOT_ABSOLUTE');
    }
    distRoot = path.resolve(overrideDistPath);
    packageRoot = path.dirname(distRoot);
    let overrideStat;
    try {
      overrideStat = await lstat(distRoot);
    } catch {
      throw new Error(`BLOCKED_ELECTRON_OVERRIDE_DIST_PATH_MISSING: ${distRoot}`);
    }
    if (!overrideStat.isDirectory()) {
      throw new Error(`BLOCKED_ELECTRON_OVERRIDE_DIST_PATH_NOT_DIRECTORY: ${distRoot}`);
    }
  }

  const packageJson = path.join(packageRoot, 'package.json');
  let packageVersion;
  try {
    const parsed = JSON.parse(await readFile(packageJson, 'utf8'));
    packageVersion = parsed?.version;
  } catch {
    throw new Error(`BLOCKED_ELECTRON_PACKAGE_IDENTITY_MISSING: ${packageJson}`);
  }
  if (packageVersion !== CURRENT_SOURCE_ELECTRON_VERSION) {
    throw new Error(
      `BLOCKED_CURRENT_SOURCE_ELECTRON_PACKAGE_VERSION: ${String(packageVersion)} != ${CURRENT_SOURCE_ELECTRON_VERSION}`,
    );
  }

  const pathFile = path.join(packageRoot, 'path.txt');
  let relative;
  try {
    relative = (await readFile(pathFile, 'utf8')).trim();
  } catch {
    throw new Error(`BLOCKED_ELECTRON_PATH_FILE_MISSING: ${pathFile}`);
  }
  if (!relative || path.isAbsolute(relative)) {
    throw new Error(`BLOCKED_ELECTRON_PATH_FILE_INVALID: ${pathFile}`);
  }
  const executablePath = path.resolve(distRoot, relative);
  const relativeToDist = path.relative(distRoot, executablePath);
  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
    throw new Error(`BLOCKED_ELECTRON_EXECUTABLE_OUTSIDE_DIST: ${executablePath}`);
  }
  let executableStat;
  try {
    executableStat = await lstat(executablePath);
  } catch {
    throw new Error(`BLOCKED_ELECTRON_EXECUTABLE_MISSING: ${executablePath}`);
  }
  if (!executableStat.isFile()) {
    throw new Error(`BLOCKED_ELECTRON_EXECUTABLE_NOT_FILE: ${executablePath}`);
  }
  return executablePath;
}

export function validateElectronRuntimeIdentity(value, executionMode = mode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BLOCKED_ELECTRON_RUNTIME_IDENTITY_INVALID: object required');
  }
  const expectedKeys = [
    'arch', 'chrome', 'electron', 'modules', 'napi', 'node', 'platform', 'schemaVersion', 'source',
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || value.schemaVersion !== 1
    || value.source !== 'launched-electron-main-process'
    || !['darwin', 'win32'].includes(value.platform)
    || !['arm64', 'x64'].includes(value.arch)
    || !['electron', 'chrome', 'node', 'modules', 'napi'].every(
      (field) => typeof value[field] === 'string' && value[field].length > 0,
    )
  ) {
    throw new Error('BLOCKED_ELECTRON_RUNTIME_IDENTITY_INVALID: schema mismatch');
  }
  if (executionMode === 'current-source' && value.electron !== CURRENT_SOURCE_ELECTRON_VERSION) {
    throw new Error(
      `BLOCKED_CURRENT_SOURCE_ELECTRON_RUNTIME_VERSION: ${value.electron} != ${CURRENT_SOURCE_ELECTRON_VERSION}`,
    );
  }
  if (executionMode === 'current-source' && value.modules !== CURRENT_SOURCE_ELECTRON_MODULE_ABI) {
    throw new Error(
      `BLOCKED_CURRENT_SOURCE_ELECTRON_MODULE_ABI: ${value.modules} != ${CURRENT_SOURCE_ELECTRON_MODULE_ABI}`,
    );
  }
  return structuredClone(value);
}

function requireAbsoluteExistingFile(name) {
  const value = process.env[name];
  if (!value) throw new Error(`BLOCKED_RELEASE_IDENTITY_MISSING: ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`BLOCKED_RELEASE_IDENTITY_NOT_ABSOLUTE: ${name}`);
  return path.resolve(value);
}

async function buildIdentity(sourceHead, sourceDirty, sourceStatusSha256) {
  if (mode === 'release') {
    const candidateId = process.env.COPILOT_E2E_CANDIDATE_ID?.trim();
    if (!candidateId) throw new Error('BLOCKED_RELEASE_IDENTITY_MISSING: COPILOT_E2E_CANDIDATE_ID');
    const executablePath = requireAbsoluteExistingFile('COPILOT_E2E_EXECUTABLE_PATH');
    const artifactPath = requireAbsoluteExistingFile('COPILOT_E2E_ARTIFACT_PATH');
    const sourceSnapshotPath = requireAbsoluteExistingFile('COPILOT_E2E_SOURCE_SNAPSHOT_PATH');
    await Promise.all([lstat(executablePath), lstat(artifactPath), lstat(sourceSnapshotPath)]);
    return {
      mode,
      candidateId,
      sourceHead,
      sourceDirty,
      sourceStatusSha256,
      sourceSnapshotPath,
      sourceSnapshotSha256: await sha256Path(sourceSnapshotPath),
      executablePath,
      executableSha256: await sha256Path(executablePath),
      artifactPath,
      artifactSha256: await sha256Path(artifactPath),
      artifactKind: 'release-candidate',
    };
  }

  const executablePath = await resolveDevelopmentElectronExecutable();
  const artifactPath = path.join(appRoot, 'dist');
  await Promise.all([lstat(executablePath), lstat(artifactPath)]);
  return {
    mode,
    candidateId: process.env.COPILOT_E2E_CANDIDATE_ID?.trim() || `current-source:${sourceHead}`,
    sourceHead,
    sourceDirty,
    sourceStatusSha256,
    sourceSnapshotPath: null,
    sourceSnapshotSha256: null,
    executablePath,
    executableSha256: await sha256Path(executablePath),
    artifactPath,
    artifactSha256: await sha256Path(artifactPath),
    artifactKind: 'unpackaged-build-directory',
  };
}

export function createElectronExecutionEnv({
  baseEnv = process.env,
  identity,
  executionMode,
  playwrightJsonPath,
  userDataPath,
  processExitPath,
  runtimeIdentityPath,
}) {
  if (!identity?.executablePath || !path.isAbsolute(identity.executablePath)) {
    throw new Error('BLOCKED_ELECTRON_EXECUTABLE_IDENTITY_INVALID');
  }
  return {
    ...baseEnv,
    COPILOT_E2E_MODE: executionMode,
    COPILOT_E2E_EXECUTABLE_PATH: identity.executablePath,
    COPILOT_E2E_PLAYWRIGHT_JSON_PATH: playwrightJsonPath,
    COPILOT_E2E_USER_DATA: userDataPath,
    COPILOT_E2E_PROCESS_EXIT_PATH: processExitPath,
    COPILOT_E2E_RUNTIME_IDENTITY_PATH: runtimeIdentityPath,
  };
}

async function main() {
  if (listOnly) {
    const listed = run(process.execPath, [
      cli,
      'test',
      '--config',
      path.join(appRoot, 'playwright.electron.config.ts'),
      ...args,
    ]);
    process.exit(listed.status ?? 1);
  }

  const startedAt = new Date().toISOString();
  if (process.env.COPILOT_E2E_SKIP_BUILD !== '1' && mode !== 'release') {
    const build = run('npm', ['run', 'build', '--workspace', '@copilot/desktop']);
    if (build.status !== 0) {
      process.stderr.write('BLOCKED_ELECTRON_BUILD_FAILED\n');
      process.exit(build.status ?? 1);
    }
  }

  const sourceHead = git(['rev-parse', 'HEAD']);
  const sourceStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const sourceDirty = sourceStatus.length > 0;
  const sourceStatusSha256 = digest(sourceStatus);
  let identity;
  try {
    identity = await buildIdentity(sourceHead, sourceDirty, sourceStatusSha256);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  await mkdir(path.dirname(jsonReportPath), { recursive: true });
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await rm(jsonReportPath, { force: true });
  await rm(evidencePath, { force: true });
  const executionRoot = await mkdtemp(path.join(os.tmpdir(), 'njx-copilot-e2e-run-'));
  const userDataPath = path.join(executionRoot, 'user-data');
  const processExitPath = path.join(executionRoot, 'process-exit.json');
  const runtimeIdentityPath = path.join(executionRoot, 'runtime-identity.json');
  await mkdir(userDataPath, { recursive: true });

  const executionEnv = createElectronExecutionEnv({
    identity,
    executionMode: mode,
    playwrightJsonPath: jsonReportPath,
    userDataPath,
    processExitPath,
    runtimeIdentityPath,
  });
  const runResult = spawnSync(process.execPath, [
    cli,
    'test',
    '--config',
    path.join(appRoot, 'playwright.electron.config.ts'),
    ...args,
  ], {
    cwd: repoRoot,
    env: executionEnv,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  const hardFailures = [];
  let counts = { expected: 0, passed: 0, skipped: 0, unexpected: 0, flaky: 0 };
  try {
    const report = JSON.parse(await readFile(jsonReportPath, 'utf8'));
    const stats = report?.stats;
    for (const field of ['expected', 'skipped', 'unexpected', 'flaky']) {
      if (!Number.isInteger(stats?.[field]) || stats[field] < 0) {
        throw new Error(`invalid Playwright stats.${field}`);
      }
    }
    counts = {
      expected: stats.expected + stats.skipped + stats.unexpected + stats.flaky,
      passed: stats.expected,
      skipped: stats.skipped,
      unexpected: stats.unexpected,
      flaky: stats.flaky,
    };
  } catch (error) {
    hardFailures.push(`BLOCKED_ELECTRON_REPORT_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }

  let processExit = null;
  try {
    processExit = JSON.parse(await readFile(processExitPath, 'utf8'));
  } catch (error) {
    hardFailures.push(`BLOCKED_ELECTRON_PROCESS_EXIT_EVIDENCE_MISSING: ${error instanceof Error ? error.message : String(error)}`);
  }

  let runtimeIdentity = null;
  try {
    runtimeIdentity = validateElectronRuntimeIdentity(
      JSON.parse(await readFile(runtimeIdentityPath, 'utf8')),
      mode,
    );
  } catch (error) {
    hardFailures.push(
      `BLOCKED_ELECTRON_RUNTIME_IDENTITY: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const minimumTests = Number(process.env.COPILOT_E2E_MIN_TESTS || 50);
  if (!Number.isInteger(minimumTests) || minimumTests < 50) {
    hardFailures.push('COPILOT_E2E_MIN_TESTS must be an integer >= 50');
  }
  if (counts.expected < minimumTests) hardFailures.push(`ELECTRON_E2E_TEST_COUNT_TOO_LOW: ${counts.expected} < ${minimumTests}`);
  if (counts.skipped !== 0) hardFailures.push(`ELECTRON_E2E_SKIPPED: ${counts.skipped}`);
  if (counts.unexpected !== 0) hardFailures.push(`ELECTRON_E2E_UNEXPECTED: ${counts.unexpected}`);
  if (counts.flaky !== 0) hardFailures.push(`ELECTRON_E2E_FLAKY: ${counts.flaky}`);
  if (counts.passed !== counts.expected) hardFailures.push(`ELECTRON_E2E_NOT_ALL_PASSED: ${counts.passed}/${counts.expected}`);
  if (processExit?.clean !== true || processExit?.exitCode !== 0 || processExit?.signalCode !== null) {
    hardFailures.push(`ELECTRON_PROCESS_NOT_CLEAN: ${JSON.stringify(processExit)}`);
  }
  if ((runResult.status ?? 1) !== 0) hardFailures.push(`PLAYWRIGHT_EXIT_NONZERO: ${runResult.status ?? 'signal'}`);

  const evidence = {
    schemaVersion: 1,
    lane: 'electron-playwright',
    ...identity,
    os: process.platform,
    arch: process.arch,
    runtimeIdentity,
    playwrightReportPath: jsonReportPath,
    counts,
    startedAt,
    endedAt: new Date().toISOString(),
    cleanProcessExit: processExit?.clean === true,
    processExitCode: processExit?.exitCode ?? null,
    processSignalCode: processExit?.signalCode ?? null,
    playwrightExitCode: runResult.status ?? null,
    hardFailures,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await rm(executionRoot, { recursive: true, force: true });

  if (hardFailures.length > 0) {
    process.stderr.write(`${hardFailures.join('\n')}\n`);
    process.stderr.write(`Electron E2E evidence: ${evidencePath}\n`);
    process.exit(runResult.status && runResult.status !== 0 ? runResult.status : 1);
  }
  process.stdout.write(`Electron E2E evidence: ${evidencePath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
