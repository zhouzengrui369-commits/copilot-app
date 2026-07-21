#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 for packaged Electron without mutating the shared
 * Node runtime copy in root node_modules.
 *
 * Flow: copy package -> /private/tmp -> isolated npm rebuild for Electron ->
 * verify root SHA unchanged -> atomically replace only app.asar.unpacked ->
 * execute the packaged Electron binary in RUN_AS_NODE mode as an ABI smoke.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractAll } from '@electron/asar';
import { parse as parseYaml } from 'yaml';

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const DEFAULT_APP = path.join(
  desktopRoot,
  'release/mac-arm64/njx-copilot-v6.app',
);
const DEFAULT_ELECTRON_VERSION = String(
  parseYaml(await readFile(path.join(desktopRoot, 'electron-builder.yml'), 'utf8')).electronVersion ?? '',
);
if (!/^\d+\.\d+\.\d+$/.test(DEFAULT_ELECTRON_VERSION)) {
  throw new Error(`ELECTRON_VERSION_NOT_EXACT: ${DEFAULT_ELECTRON_VERSION || '<missing>'}`);
}
const NATIVE_RELATIVE = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';

export function resolveStagePaths(options = {}) {
  const appPath = path.resolve(options.appPath ?? DEFAULT_APP);
  const resources = path.join(appPath, 'Contents/Resources');
  return {
    appPath,
    executable: path.join(appPath, 'Contents/MacOS/njx-copilot-v6'),
    asarArchive: path.join(resources, 'app.asar'),
    asarPackage: path.join(resources, 'app.asar/node_modules/better-sqlite3'),
    packagedBinary: path.join(resources, 'app.asar.unpacked', NATIVE_RELATIVE),
    sourcePackage: path.join(repoRoot, 'node_modules/better-sqlite3'),
    rootBinary: path.join(repoRoot, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  };
}

export async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function atomicStageBinary(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const before = existsSync(destination) ? await stat(destination) : null;
  const temporary = `${destination}.stage-${process.pid}-${Date.now()}`;
  try {
    await copyFile(source, temporary);
    await chmod(temporary, before?.mode ?? 0o755);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function rebuildArgs(electronVersion, arch) {
  return [
    'rebuild',
    '--runtime=electron',
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
    '--build-from-source',
  ];
}

export async function assertRootShaUnchanged(rootBinary, expectedSha) {
  const actual = await sha256(rootBinary);
  if (actual !== expectedSha) {
    throw new Error(
      `ROOT_NATIVE_MUTATED: expected ${expectedSha}, got ${actual}; shared node_modules must not change`,
    );
  }
  return actual;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = resolveStagePaths({ appPath: options.appPath });
  await assertPaths(paths);

  if (options.verifyOnly) {
    const verifyRoot = await mkdtemp('/private/tmp/copilot-electron-verify-');
    try {
      const verification = await verifyPackagedRuntime(
        paths,
        verifyRoot,
        Math.min(options.timeoutMs, 120_000),
        options.electronVersion,
      );
      process.stdout.write(`${JSON.stringify({
        status: 'PASS',
        mode: 'verify-only',
        electronVersion: verification.electronVersion,
        targetAbi: verification.targetAbi,
        arch: verification.arch,
        packagedSha: await sha256(paths.packagedBinary),
        appPath: paths.appPath,
      }, null, 2)}\n`);
      return;
    } finally {
      await rm(verifyRoot, { recursive: true, force: true });
    }
  }

  const rootShaBefore = await sha256(paths.rootBinary);
  const packagedShaBefore = await sha256(paths.packagedBinary);
  const stageRoot = await mkdtemp('/private/tmp/copilot-electron-native-');
  const stagePackage = path.join(stageRoot, 'better-sqlite3');
  let succeeded = false;

  process.stdout.write(`NATIVE_ABI_STAGING stage=${stageRoot}\n`);
  process.stdout.write(`root_sha_before=${rootShaBefore}\n`);
  process.stdout.write(`packaged_sha_before=${packagedShaBefore}\n`);

  try {
    await cp(paths.sourcePackage, stagePackage, {
      recursive: true,
      dereference: true,
      filter: (source) => path.relative(paths.sourcePackage, source).split(path.sep)[0] !== 'build',
    });

    const python = selectBuildPython(options.python);
    process.stdout.write(`build_python=${python}\n`);

    const npmResult = spawnSync(
      'npm',
      rebuildArgs(options.electronVersion, options.arch),
      {
        cwd: stagePackage,
        env: {
          ...process.env,
          PATH: `${path.join(repoRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
          npm_config_runtime: 'electron',
          npm_config_target: options.electronVersion,
          npm_config_arch: options.arch,
          npm_config_disturl: 'https://electronjs.org/headers',
          npm_config_build_from_source: 'true',
          npm_config_devdir: path.join(stageRoot, 'electron-gyp'),
          npm_config_cache: path.join(stageRoot, 'npm-cache'),
          npm_config_python: python,
          PYTHON: python,
        },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: options.timeoutMs,
      },
    );
    process.stdout.write(npmResult.stdout ?? '');
    process.stderr.write(npmResult.stderr ?? '');
    if (npmResult.error || npmResult.status !== 0) {
      throw new Error(
        `ELECTRON_NATIVE_REBUILD_FAILED: ${JSON.stringify(spawnFailureEvidence(npmResult))}`,
      );
    }

    const stagedBinary = path.join(stagePackage, 'build/Release/better_sqlite3.node');
    await access(stagedBinary);
    const stagedSha = await sha256(stagedBinary);
    await assertRootShaUnchanged(paths.rootBinary, rootShaBefore);
    if (stagedSha === rootShaBefore) {
      throw new Error('ABI_STAGING_INVALID: staged binary SHA equals Node24 root binary SHA');
    }

    await atomicStageBinary(stagedBinary, paths.packagedBinary);
    const rootShaAfter = await assertRootShaUnchanged(paths.rootBinary, rootShaBefore);
    const packagedShaAfter = await sha256(paths.packagedBinary);
    if (packagedShaAfter !== stagedSha || packagedShaAfter === rootShaAfter) {
      throw new Error('PACKAGED_NATIVE_STAGE_FAILED: packaged binary hash mismatch');
    }

    const verification = await verifyPackagedRuntime(
      paths,
      stageRoot,
      Math.min(options.timeoutMs, 120_000),
      options.electronVersion,
    );

    succeeded = true;
    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      electronVersion: verification.electronVersion,
      targetAbi: verification.targetAbi,
      arch: verification.arch,
      rootShaBefore,
      rootShaAfter,
      packagedShaBefore,
      packagedShaAfter,
      stagedSha,
      appPath: paths.appPath,
      e2eRerun: packagedE2eCommand(paths.executable),
    }, null, 2)}\n`);
  } finally {
    if (succeeded && !options.keepStage) {
      await rm(stageRoot, { recursive: true, force: true });
    } else {
      process.stderr.write(`NATIVE_ABI_STAGING retained_stage=${stageRoot}\n`);
    }
  }
}

async function verifyPackagedRuntime(paths, stageRoot, timeoutMs, expectedElectronVersion) {
  const smoke = runElectronNativeSmoke(paths, timeoutMs);
  process.stdout.write(smoke.stdout ?? '');
  process.stderr.write(smoke.stderr ?? '');
  if (smoke.status !== 0) {
    throw new Error(
      `PACKAGED_ELECTRON_NATIVE_SMOKE_FAILED: ${JSON.stringify(spawnFailureEvidence(smoke))}`,
    );
  }
  const runtimeLine = (smoke.stdout ?? '')
    .split('\n')
    .find((line) => line.startsWith('ELECTRON_RUNTIME '));
  if (!runtimeLine) throw new Error('PACKAGED_ELECTRON_RUNTIME_EVIDENCE_MISSING');
  const runtime = JSON.parse(runtimeLine.slice('ELECTRON_RUNTIME '.length));
  if (
    runtime.electron !== expectedElectronVersion
    || !/^\d+$/.test(String(runtime.modules))
    || !['arm64', 'x64'].includes(runtime.arch)
  ) {
    throw new Error(
      `PACKAGED_ELECTRON_RUNTIME_MISMATCH: expected=${expectedElectronVersion} actual=${JSON.stringify(runtime)}`,
    );
  }

  const domainSmoke = await runPackagedDomainSmoke(paths, stageRoot, timeoutMs);
  process.stdout.write(domainSmoke.stdout ?? '');
  process.stderr.write(domainSmoke.stderr ?? '');
  if (domainSmoke.status !== 0) {
    throw new Error(
      `PACKAGED_ELECTRON_DOMAIN_SMOKE_FAILED: ${JSON.stringify(spawnFailureEvidence(domainSmoke))}`,
    );
  }
  return {
    electronVersion: runtime.electron,
    targetAbi: Number(runtime.modules),
    arch: runtime.arch,
  };
}

export function spawnFailureEvidence(result) {
  return {
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error ? {
      name: result.error.name,
      code: result.error.code ?? null,
      message: result.error.message,
      errno: result.error.errno ?? null,
      syscall: result.error.syscall ?? null,
    } : null,
  };
}

async function runPackagedDomainSmoke(paths, stageRoot, timeoutMs) {
  const extracted = path.join(stageRoot, 'app-extracted');
  extractAll(paths.asarArchive, extracted);
  const extractedNative = path.join(extracted, NATIVE_RELATIVE);
  await mkdir(path.dirname(extractedNative), { recursive: true });
  await copyFile(paths.packagedBinary, extractedNative);
  const smokeScript = path.join(stageRoot, 'domain-smoke.mjs');
  const kbIndex = pathToFileURL(
    path.join(extracted, 'node_modules/@copilot/kb/dist/index.js'),
  ).href;
  const smokeData = path.join(stageRoot, 'domain-data');
  await writeFile(smokeScript, `
    import { SqliteStore, MdFileStore, KbClient } from ${JSON.stringify(kbIndex)};
    const sqlite = new SqliteStore({ dbPath: ${JSON.stringify(path.join(smokeData, 'kb.sqlite'))} });
    const kb = new KbClient({ sqlite, md: new MdFileStore({ rootDir: ${JSON.stringify(path.join(smokeData, 'notes'))} }) });
    const notesResult = kb.listNotes({ limit: 10 });
    // Mirrors LocalKnowledgeService.todos.list: Todo/Schedule records are
    // note-backed until the package Todo export is frozen.
    const todoNotes = kb.listNotes({ type: 'todo', tags: ['__copilot_todo__'], limit: 1000 });
    const todosResult = todoNotes.items.map((note) => kb.readNote(note.path)).filter(Boolean);
    if (!Array.isArray(notesResult.items) || !Array.isArray(todosResult)) process.exit(3);
    console.log('PACKAGED_DOMAIN_SMOKE_OK', JSON.stringify({
      'notes.list': notesResult.items.length,
      'todos.list': todosResult.length,
      abi: process.versions.modules,
    }));
    sqlite.close();
  `, 'utf8');
  return spawnSync(paths.executable, [smokeScript], {
    cwd: stageRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
  });
}

function runElectronNativeSmoke(paths, timeoutMs) {
  const smokeSource = [
    "console.log('ELECTRON_RUNTIME', JSON.stringify({electron:process.versions.electron,modules:process.versions.modules,arch:process.arch}));",
    "console.log('ELECTRON_ABI', process.versions.modules);",
    'const Database = require(process.argv[1]);',
    "const db = new Database(':memory:');",
    "const value = db.prepare('select 1 as value').get().value;",
    'db.close();',
    "console.log('PACKAGED_NATIVE_LOAD_OK', value);",
  ].join(' ');
  return spawnSync(paths.executable, ['-e', smokeSource, paths.asarPackage], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
  });
}

function packagedE2eCommand(executable) {
  return [
    `COPILOT_E2E_EXECUTABLE_PATH=${JSON.stringify(executable)}`,
    'COPILOT_E2E_SKIP_BUILD=1',
    'node apps/copilot-desktop/scripts/run-electron-e2e.mjs',
  ].join(' ');
}

async function assertPaths(paths) {
  const realPaths = { ...paths };
  // app.asar paths are virtual and become readable only inside Electron.
  delete realPaths.asarPackage;
  for (const [label, target] of Object.entries(realPaths)) {
    if (!existsSync(target)) throw new Error(`MISSING_${label.toUpperCase()}: ${target}`);
  }
}

function parseArgs(args) {
  const options = {
    appPath: DEFAULT_APP,
    electronVersion: DEFAULT_ELECTRON_VERSION,
    arch: 'arm64',
    timeoutMs: 10 * 60 * 1000,
    keepStage: false,
    verifyOnly: false,
    python: undefined,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--app') options.appPath = args[++i];
    else if (arg === '--electron-version') options.electronVersion = args[++i];
    else if (arg === '--arch') options.arch = args[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++i]);
    else if (arg === '--keep-stage') options.keepStage = true;
    else if (arg === '--verify-only') options.verifyOnly = true;
    else if (arg === '--python') options.python = args[++i];
    else throw new Error(`UNKNOWN_ARGUMENT: ${arg}`);
  }
  if (!options.appPath || !options.electronVersion || !options.arch) {
    throw new Error('INVALID_ARGUMENT: --app/--electron-version/--arch require values');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error('INVALID_ARGUMENT: --timeout-ms must be >= 1000');
  }
  return options;
}

function selectBuildPython(explicit) {
  const candidates = [
    explicit,
    process.env.npm_config_python,
    '/usr/bin/python3',
    '/opt/homebrew/bin/python3.13',
    '/opt/homebrew/bin/python3.12',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, [
      '-c',
      "import plistlib, xml.parsers.expat; print('PYTHON_OK')",
    ], { encoding: 'utf8', stdio: 'pipe' });
    if (probe.status === 0 && probe.stdout.includes('PYTHON_OK')) return candidate;
  }
  throw new Error(
    'PYTHON_TOOLCHAIN_UNAVAILABLE: need a Python with plistlib + working pyexpat; use --python <path>',
  );
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
