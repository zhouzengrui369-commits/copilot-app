import { createHash } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import {
  bindHarnessProvenance,
  writeEmittedBuildOutputs,
} from './performance-config.mjs';

const GENERATED_ENTRY_SOURCEFILE = 'copilot-kg-performance-entry.tsx';

export function createKgHarnessGeneratedEntrySource(componentPath) {
  return `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { KnowledgeGraph, FixtureKgDataSource } from ${JSON.stringify(componentPath)};
    const source = new FixtureKgDataSource(100);
    const mount = document.getElementById('root');
    createRoot(mount).render(React.createElement(KnowledgeGraph, { dataSource: source, width: 1000, height: 650 }));
    const started = performance.now();
    let frames = 0;
    function sample(now) {
      frames += 1;
      const root = document.querySelector('[data-testid="kg-root"]');
      const count = Number(root?.getAttribute('data-visible-count') || 0);
      const elapsed = now - started;
      if (count === 100 && elapsed >= 1500) {
        source.getSubgraph(100).then((graph) => {
          window.__KG_PERF__ = {
            nodeCount: count,
            edgeCount: graph.edges.length,
            sampleMs: Math.round(elapsed * 100) / 100,
            frames,
            fps: Math.round((frames * 1000 / elapsed) * 100) / 100,
          };
        });
        return;
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  `;
}

export async function buildKgHarness(root, performanceConfig, dependencies = {}) {
  const componentPath = performanceConfig.componentPath;
  const bundlePath = path.join(root, 'bundle.js');
  const htmlPath = path.join(root, 'index.html');
  const source = createKgHarnessGeneratedEntrySource(componentPath);
  const sourceBytes = Buffer.from(source, 'utf8');
  const generatedEntry = {
    logicalName: GENERATED_ENTRY_SOURCEFILE,
    sourcefile: GENERATED_ENTRY_SOURCEFILE,
    bytes: sourceBytes.byteLength,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  };
  const buildExecutor = dependencies.buildExecutor ?? build;
  const buildResult = await buildExecutor({
    stdin: {
      contents: source,
      sourcefile: GENERATED_ENTRY_SOURCEFILE,
      resolveDir: performanceConfig.harnessAppRoot,
      loader: 'tsx',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    sourcemap: false,
    logLevel: 'silent',
    metafile: true,
    write: false,
    absWorkingDir: performanceConfig.harnessAppRoot,
    nodePaths: [
      path.join(performanceConfig.harnessAppRoot, 'node_modules'),
      path.join(performanceConfig.harnessSourceRoot, 'node_modules'),
      path.join(performanceConfig.appRoot, 'node_modules'),
      path.join(performanceConfig.repoRoot, 'node_modules'),
    ],
  });
  const authoritativeExecutedBuild = await writeEmittedBuildOutputs(root, buildResult.outputFiles);
  const inputPaths = Object.keys(buildResult.metafile.inputs)
    .filter((inputPath) => inputPath !== GENERATED_ENTRY_SOURCEFILE)
    .map((inputPath) => (
      path.isAbsolute(inputPath)
        ? inputPath
        : path.resolve(performanceConfig.harnessAppRoot, inputPath)
    ));
  const inputProvenance = await bindHarnessProvenance({
    inputPaths,
    componentPath,
    sourceRoot: performanceConfig.harnessSourceRoot,
    generatedEntry,
  });
  const cssPath = path.join(root, 'bundle.css');
  const cssTag = existsSync(cssPath) ? '<link rel="stylesheet" href="bundle.css">' : '';
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8">${cssTag}</head><body><div id="root"></div><script src="bundle.js"></script></body></html>`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  const executedHarnessBinding = await bindExecutedKgHarness(root);
  return {
    htmlPath,
    provenance: {
      authoritativeExecutedBuild,
      executedHarnessBinding,
      generatedEntry,
      inputProvenance,
    },
  };
}

export async function preserveExecutedKgHarness({
  sourceRoot,
  evidenceRoot,
  runId,
  expectedBinding,
}) {
  validateExecutedHarnessBinding(expectedBinding);
  await verifyExecutedKgHarness(sourceRoot, expectedBinding);
  if (
    typeof evidenceRoot !== 'string'
    || !path.isAbsolute(evidenceRoot)
    || typeof runId !== 'string'
    || runId.length === 0
    || runId !== path.basename(runId)
    || runId.includes('\0')
  ) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_PATH');
  }

  try {
    await mkdir(evidenceRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') blocked('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_PATH');
  }
  const evidenceStat = await lstat(evidenceRoot).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_PATH');
  });
  if (evidenceStat.isSymbolicLink() || !evidenceStat.isDirectory()) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_PATH');
  }
  await chmod(evidenceRoot, 0o700);

  const destinationRoot = path.join(evidenceRoot, runId);
  try {
    await mkdir(destinationRoot, { mode: 0o700 });
  } catch (error) {
    blocked(error?.code === 'EEXIST'
      ? 'BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_EXISTS'
      : 'BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_PATH');
  }
  await chmod(destinationRoot, 0o700);

  const sourceContext = await validateHarnessRoot(sourceRoot);
  for (const file of expectedBinding.files) {
    const { contents, binding } = await stableReadHarnessFile(sourceContext, file.logicalName);
    if (JSON.stringify({ logicalName: file.logicalName, ...binding }) !== JSON.stringify(file)) {
      blocked('BLOCKED_DIRECT_PERF_HARNESS_CHANGED');
    }
    const destinationPath = path.join(destinationRoot, file.logicalName);
    let handle;
    try {
      handle = await open(
        destinationPath,
        fsConstants.O_WRONLY
          | fsConstants.O_CREAT
          | fsConstants.O_EXCL
          | (fsConstants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(contents);
      await handle.sync();
      await handle.chmod(0o600);
    } catch (error) {
      blocked(error?.code === 'EEXIST'
        ? 'BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_EXISTS'
        : 'BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_WRITE');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  await verifyExecutedKgHarness(sourceRoot, expectedBinding);
  const preservedBinding = await bindExecutedKgHarness(destinationRoot);
  if (JSON.stringify(preservedBinding) !== JSON.stringify(expectedBinding)) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_EVIDENCE_BINDING');
  }
  return {
    directoryBasename: runId,
    files: preservedBinding.files,
    binding: preservedBinding,
  };
}

export async function preserveThenCleanupExecutedKgHarness({ preserve, cleanup }) {
  const result = await preserve();
  await cleanup();
  return result;
}

export async function bindExecutedKgHarness(root) {
  const context = await validateHarnessRoot(root);
  const names = ['bundle.js', 'index.html'];
  if (await optionalRegularFile(path.join(context.root, 'bundle.css'))) names.push('bundle.css');
  const files = await Promise.all(names.sort().map(async (logicalName) => {
    const binding = await stableBindHarnessFile(context, logicalName);
    return { logicalName, bytes: binding.bytes, sha256: binding.sha256 };
  }));
  return {
    schemaVersion: 1,
    files,
    digest: digestExecutedHarnessFiles(files),
  };
}

export async function verifyExecutedKgHarness(root, expected) {
  validateExecutedHarnessBinding(expected);
  const actual = await bindExecutedKgHarness(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_DRIFT');
  }
  return expected;
}

async function validateHarnessRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  }
  const originalStat = await lstat(root).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  if (originalStat.isSymbolicLink() || !originalStat.isDirectory()) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  }
  const realRoot = await realpath(root).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  return { root: realRoot };
}

async function optionalRegularFile(filePath) {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function stableBindHarnessFile(context, logicalName) {
  const { binding } = await stableReadHarnessFile(context, logicalName);
  return binding;
}

async function stableReadHarnessFile(context, logicalName) {
  if (!['index.html', 'bundle.js', 'bundle.css'].includes(logicalName)) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_SCHEMA');
  }
  const filePath = path.join(context.root, logicalName);
  const originalStat = await lstat(filePath).catch(() => {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  });
  if (originalStat.isSymbolicLink() || !originalStat.isFile()) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  }
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || contents.byteLength !== before.size
    ) {
      blocked('BLOCKED_DIRECT_PERF_HARNESS_CHANGED');
    }
    return {
      contents,
      binding: {
        bytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      },
    };
  } catch (error) {
    if (error?.code?.startsWith?.('BLOCKED_')) throw error;
    blocked('BLOCKED_DIRECT_PERF_HARNESS_PATH');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function digestExecutedHarnessFiles(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(JSON.stringify(file));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function validateExecutedHarnessBinding(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['digest', 'files', 'schemaVersion'])
    || value.schemaVersion !== 1
    || !Array.isArray(value.files)
    || !/^[a-f0-9]{64}$/.test(String(value.digest ?? ''))
  ) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_SCHEMA');
  }
  const names = value.files.map((file) => file?.logicalName);
  const expectedNames = names.includes('bundle.css')
    ? ['bundle.css', 'bundle.js', 'index.html']
    : ['bundle.js', 'index.html'];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_SCHEMA');
  }
  for (const file of value.files) {
    if (
      !file
      || typeof file !== 'object'
      || Array.isArray(file)
      || JSON.stringify(Object.keys(file).sort()) !== JSON.stringify(['bytes', 'logicalName', 'sha256'])
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0
      || !/^[a-f0-9]{64}$/.test(String(file.sha256 ?? ''))
    ) blocked('BLOCKED_DIRECT_PERF_HARNESS_SCHEMA');
  }
  if (digestExecutedHarnessFiles(value.files) !== value.digest) {
    blocked('BLOCKED_DIRECT_PERF_HARNESS_BINDING');
  }
}

function blocked(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
