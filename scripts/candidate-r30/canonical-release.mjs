import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';
import { block, fullCommit } from './contract.mjs';
import {
  desktopRoot,
  privateJson,
  recorded,
  sha256File,
  sha256Path,
  walk,
} from './io.mjs';

export const CANONICAL_CANDIDATE_ALIAS = 'v6.2-phase1-candidate-r31';
export const CANONICAL_RELEASE_MODE = 'unsigned';

const SHA256 = /^[0-9a-f]{64}$/u;
const ALLOWED_UNSIGNED_BLOCKERS = new Set([
  'BLOCKED_UNSIGNED',
  'BLOCKED_POST_PACKAGE_E2E',
  'BLOCKED_POST_PACKAGE_PERFORMANCE',
  'BLOCKED_POST_PACKAGE_SCREENSHOTS',
  'BLOCKED_POST_PACKAGE_SIGNING_NOTARIZATION',
  'BLOCKED_POST_PACKAGE_PLATFORM_RUNTIME',
  'BLOCKED_POST_PACKAGE_NORTH_STAR',
  'BLOCKED_MAC_DMG_DEVICE',
  'BLOCKED_WINDOWS_NATIVE_MODULE',
  'BLOCKED_WINDOWS_PACKAGING_TOOLCHAIN',
  'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING',
  'BLOCKED_WINDOWS_TRUST_ANCHOR_MISSING',
]);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRelative(value, code = 'BLOCKED_CANONICAL_PATH_INVALID') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || path.isAbsolute(value)
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || path.posix.normalize(value) !== value
  ) block(code, 6, String(value));
  return value;
}

function resolveContained(root, relative, code = 'BLOCKED_CANONICAL_PATH_INVALID') {
  const target = path.resolve(root, safeRelative(relative, code));
  if (!isInside(root, target)) block(code, 6, relative);
  return target;
}

async function readJson(file, code) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    block(code, 6, path.basename(file), { code: error?.code ?? null });
  }
}

async function requireAbsent(target, code) {
  try {
    await lstat(target);
    block(code, 6, target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    if (error?.code === code) throw error;
    if (error?.name === 'CandidateBlocked') throw error;
    block(code, 6, target, { code: error?.code ?? null });
  }
}

async function requireRegularFile(file, gate, code) {
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    block(code, gate, file, { code: error?.code ?? null });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) block(code, gate, file, { nlink: stat.nlink });
    return stat;
  } finally {
    await handle.close();
  }
}

function selectArtifact(manifest, kind, arch = 'arm64') {
  const matches = manifest.artifacts.filter((artifact) => (
    artifact?.platform === 'darwin'
    && artifact?.arch === arch
    && artifact?.kind === kind
  ));
  if (matches.length !== 1) {
    block('BLOCKED_CANONICAL_ARTIFACT_SET', 6, `${kind}/${arch}=${matches.length}`);
  }
  return matches[0];
}

export function validateCanonicalManifestData(manifest, sourceCommit) {
  fullCommit(sourceCommit, 'canonical-source');
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.schemaVersion !== 2
    || manifest.releaseMode !== CANONICAL_RELEASE_MODE
    || manifest.candidate !== CANONICAL_CANDIDATE_ALIAS
    || (manifest.status !== 'PARTIAL_BLOCKED' && manifest.status !== 'PASS')
    || manifest.source?.head !== sourceCommit
    || manifest.source?.dirty !== false
    || !manifest.source?.snapshot?.immutableInputs
    || !Number.isSafeInteger(manifest.source?.snapshot?.fileCount)
    || manifest.source.snapshot.fileCount < 1
    || !SHA256.test(manifest.source?.snapshot?.sha256 ?? '')
    || !Array.isArray(manifest.artifacts)
    || !Array.isArray(manifest.blockers)
  ) block('BLOCKED_CANONICAL_MANIFEST', 6);

  const snapshot = manifest.source.snapshot;
  safeRelative(snapshot.relativeRoot, 'BLOCKED_CANONICAL_SNAPSHOT_PATH');
  const authoritative = snapshot.authoritativeInputs;
  if (
    !authoritative
    || !Number.isSafeInteger(authoritative.bytes)
    || authoritative.bytes < 1
    || authoritative.fileCount !== snapshot.fileCount
    || authoritative.aggregateSha256 !== snapshot.sha256
    || !SHA256.test(authoritative.sha256 ?? '')
  ) block('BLOCKED_CANONICAL_SNAPSHOT_BINDING', 6);
  safeRelative(authoritative.relativePath, 'BLOCKED_CANONICAL_SNAPSHOT_PATH');

  if (
    !manifest.releaseIdentity
    || !Number.isSafeInteger(manifest.releaseIdentity.bytes)
    || manifest.releaseIdentity.bytes < 1
    || !SHA256.test(manifest.releaseIdentity.sha256 ?? '')
  ) block('BLOCKED_CANONICAL_RELEASE_IDENTITY', 6);
  safeRelative(manifest.releaseIdentity.evidenceRelativePath, 'BLOCKED_CANONICAL_RELEASE_IDENTITY');

  for (const blocker of manifest.blockers) {
    if (!ALLOWED_UNSIGNED_BLOCKERS.has(blocker?.code)) {
      block('BLOCKED_CANONICAL_UNEXPECTED_BLOCKER', 6, String(blocker?.code ?? '<missing>'));
    }
    if (blocker.code === 'BLOCKED_MAC_DMG_DEVICE' && blocker.arch === 'arm64') {
      block('BLOCKED_CANONICAL_ARM64_DMG', 6);
    }
  }

  const zip = selectArtifact(manifest, 'macOS ZIP');
  const dmg = selectArtifact(manifest, 'macOS DMG');
  for (const artifact of [zip, dmg]) {
    safeRelative(artifact.relativePath, 'BLOCKED_CANONICAL_ARTIFACT_PATH');
    if (
      artifact.signing !== 'unsigned'
      || !Number.isSafeInteger(artifact.bytes)
      || artifact.bytes < 1
      || !SHA256.test(artifact.sha256 ?? '')
    ) block('BLOCKED_CANONICAL_ARTIFACT_IDENTITY', 6, artifact.relativePath);
  }
  return { zip, dmg, snapshot, authoritative };
}

function validateAuthoritativeManifest(document, snapshot) {
  if (
    !document
    || typeof document !== 'object'
    || Array.isArray(document)
    || document.schemaVersion !== 1
    || document.algorithm !== 'sha256-null-delimited-relative-path-and-bytes-v1'
    || document.fileCount !== snapshot.fileCount
    || document.aggregateSha256 !== snapshot.sha256
    || !Array.isArray(document.entries)
    || document.entries.length !== document.fileCount
  ) block('BLOCKED_CANONICAL_SNAPSHOT_MANIFEST', 6);
  const paths = document.entries.map((entry) => safeRelative(
    entry?.relativePath,
    'BLOCKED_CANONICAL_SNAPSHOT_ENTRY',
  ));
  const sorted = [...paths].sort();
  if (JSON.stringify(paths) !== JSON.stringify(sorted) || new Set(paths).size !== paths.length) {
    block('BLOCKED_CANONICAL_SNAPSHOT_ENTRY_SET', 6);
  }
  for (const entry of document.entries) {
    if (
      !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0
      || !SHA256.test(entry.sha256 ?? '')
    ) block('BLOCKED_CANONICAL_SNAPSHOT_ENTRY', 6, entry.relativePath);
  }
  return document;
}

async function copyBoundFile(source, destination, expected, gate = 6) {
  const stat = await requireRegularFile(source, gate, 'BLOCKED_CANONICAL_COPY_SOURCE');
  if (expected && (stat.size !== expected.bytes || await sha256File(source, { gate }) !== expected.sha256)) {
    block('BLOCKED_CANONICAL_COPY_SOURCE_IDENTITY', gate, source);
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  await chmod(destination, stat.mode & 0o777);
  const copied = await requireRegularFile(destination, gate, 'BLOCKED_CANONICAL_COPY_DESTINATION');
  if (copied.size !== stat.size || await sha256File(destination, { gate }) !== await sha256File(source, { gate })) {
    block('BLOCKED_CANONICAL_COPY_DESTINATION_IDENTITY', gate, destination);
  }
}

async function copyRegularTree(sourceRoot, destinationRoot, gate = 6) {
  let sourceStat;
  try {
    sourceStat = await lstat(sourceRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    block('BLOCKED_CANONICAL_TREE_SOURCE', gate, sourceRoot);
  }
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) block('BLOCKED_CANONICAL_TREE_SYMLINK', gate, source);
    if (entry.isDirectory()) await copyRegularTree(source, destination, gate);
    else if (entry.isFile()) await copyBoundFile(source, destination, null, gate);
    else block('BLOCKED_CANONICAL_TREE_ENTRY', gate, source);
  }
}

async function copyCanonicalOutput({ internalRoot, externalRoot, manifest, selected }) {
  await requireAbsent(externalRoot, 'BLOCKED_CANONICAL_EXTERNAL_EXISTS');
  await mkdir(externalRoot, { mode: 0o700 });
  await copyBoundFile(
    path.join(internalRoot, 'CANONICAL-MANIFEST.json'),
    path.join(externalRoot, 'CANONICAL-MANIFEST.json'),
    null,
  );
  await copyBoundFile(
    resolveContained(internalRoot, manifest.releaseIdentity.evidenceRelativePath),
    resolveContained(externalRoot, manifest.releaseIdentity.evidenceRelativePath),
    manifest.releaseIdentity,
  );
  await copyBoundFile(
    path.join(internalRoot, '.canonical-release.complete'),
    path.join(externalRoot, '.canonical-release.complete'),
    null,
  );

  for (const artifact of [selected.zip, selected.dmg]) {
    await copyBoundFile(
      resolveContained(internalRoot, artifact.relativePath),
      resolveContained(externalRoot, artifact.relativePath),
      artifact,
    );
  }
  for (const directory of ['evidence', 'logs']) {
    await copyRegularTree(path.join(internalRoot, directory), path.join(externalRoot, directory));
  }

  const authoritativePath = resolveContained(internalRoot, selected.authoritative.relativePath);
  const authoritativeDocument = validateAuthoritativeManifest(
    await readJson(authoritativePath, 'BLOCKED_CANONICAL_SNAPSHOT_MANIFEST'),
    selected.snapshot,
  );
  if (
    (await requireRegularFile(authoritativePath, 6, 'BLOCKED_CANONICAL_SNAPSHOT_MANIFEST')).size
      !== selected.authoritative.bytes
    || await sha256File(authoritativePath, { gate: 6 }) !== selected.authoritative.sha256
  ) block('BLOCKED_CANONICAL_SNAPSHOT_MANIFEST_BINDING', 6);
  await copyBoundFile(
    authoritativePath,
    resolveContained(externalRoot, selected.authoritative.relativePath),
    selected.authoritative,
  );

  const sourceSnapshotRoot = resolveContained(internalRoot, selected.snapshot.relativeRoot);
  const destinationSnapshotRoot = resolveContained(externalRoot, selected.snapshot.relativeRoot);
  for (const entry of authoritativeDocument.entries) {
    await copyBoundFile(
      resolveContained(sourceSnapshotRoot, entry.relativePath),
      resolveContained(destinationSnapshotRoot, entry.relativePath),
      entry,
    );
  }
  return {
    authoritativeDocument,
    sourceSnapshotRoot: destinationSnapshotRoot,
    authoritativeManifestPath: resolveContained(externalRoot, selected.authoritative.relativePath),
  };
}

async function findRuntimePaths(runtimeRoot) {
  const entries = await walk(runtimeRoot);
  const apps = entries.filter(({ entry }) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (apps.length !== 1) block('BLOCKED_CANONICAL_RUNTIME_APP_SET', 7, `count=${apps.length}`);
  const appPath = apps[0].absolute;
  const macosRoot = path.join(appPath, 'Contents/MacOS');
  const executables = (await readdir(macosRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() || entry.isSymbolicLink());
  if (executables.length !== 1) block('BLOCKED_CANONICAL_RUNTIME_EXECUTABLE_SET', 7, `count=${executables.length}`);
  const executablePath = path.join(macosRoot, executables[0].name);
  const appAsarPath = path.join(appPath, 'Contents/Resources/app.asar');
  await requireRegularFile(appAsarPath, 7, 'BLOCKED_CANONICAL_RUNTIME_ASAR');
  return { appPath, executablePath, appAsarPath };
}

export async function runCanonicalRelease({ sourceCommit, candidateId, evidenceDir }) {
  fullCommit(sourceCommit, 'canonical-source');
  const internalRoot = path.join(desktopRoot, 'release', CANONICAL_CANDIDATE_ALIAS);
  await requireAbsent(internalRoot, 'BLOCKED_CANONICAL_INTERNAL_EXISTS');
  const builder = path.join(desktopRoot, 'scripts/build-canonical-release.mjs');
  const result = await recorded({
    gate: 6,
    name: 'canonical-release-unsigned',
    command: process.execPath,
    args: [builder, '--signing-mode', CANONICAL_RELEASE_MODE, '--output', internalRoot],
    evidenceDir,
    allowFailure: true,
  });
  if (result.status !== 0 && result.status !== 2) {
    block('BLOCKED_CANONICAL_BUILDER_EXIT', 6, String(result.status ?? 'signal'), result.receipt);
  }

  const internalManifestPath = path.join(internalRoot, 'CANONICAL-MANIFEST.json');
  const manifest = await readJson(internalManifestPath, 'BLOCKED_CANONICAL_MANIFEST');
  const selected = validateCanonicalManifestData(manifest, sourceCommit);
  const externalRoot = path.join(evidenceDir, 'canonical-release');
  const copied = await copyCanonicalOutput({ internalRoot, externalRoot, manifest, selected });
  const copiedManifestPath = path.join(externalRoot, 'CANONICAL-MANIFEST.json');
  const copiedManifest = await readJson(copiedManifestPath, 'BLOCKED_CANONICAL_MANIFEST');
  validateCanonicalManifestData(copiedManifest, sourceCommit);

  const zipPath = resolveContained(externalRoot, selected.zip.relativePath);
  const dmgPath = resolveContained(externalRoot, selected.dmg.relativePath);
  const releaseIdentityPath = resolveContained(externalRoot, manifest.releaseIdentity.evidenceRelativePath);
  const runtimeRoot = path.join(evidenceDir, 'runtime');
  await requireAbsent(runtimeRoot, 'BLOCKED_CANONICAL_RUNTIME_EXISTS');
  await mkdir(runtimeRoot, { mode: 0o700 });
  await recorded({
    gate: 7,
    name: 'extract-canonical-arm64-zip',
    command: '/usr/bin/ditto',
    args: ['-x', '-k', zipPath, runtimeRoot],
    evidenceDir,
  });
  const runtime = await findRuntimePaths(runtimeRoot);

  const sourceSnapshotPath = path.join(evidenceDir, 'canonical-source-snapshot.tar');
  await recorded({
    gate: 7,
    name: 'canonical-source-snapshot-tar',
    command: '/usr/bin/tar',
    args: ['-cf', sourceSnapshotPath, '-C', copied.sourceSnapshotRoot, '.'],
    evidenceDir,
  });

  const canonical = {
    schemaVersion: 1,
    candidateAlias: CANONICAL_CANDIDATE_ALIAS,
    r30CandidateId: candidateId,
    sourceCommit,
    root: externalRoot,
    manifestPath: copiedManifestPath,
    manifestSha256: await sha256File(copiedManifestPath, { gate: 7 }),
    releaseIdentityPath,
    releaseIdentitySha256: await sha256File(releaseIdentityPath, { gate: 7 }),
    sourceSnapshotRoot: copied.sourceSnapshotRoot,
    sourceSnapshotAggregateSha256: selected.snapshot.sha256,
    sourceSnapshotFileCount: selected.snapshot.fileCount,
    authoritativeManifestPath: copied.authoritativeManifestPath,
    authoritativeManifestSha256: selected.authoritative.sha256,
  };
  const artifacts = {
    zipPath,
    dmgPath,
    appPath: runtime.appPath,
    executablePath: runtime.executablePath,
    appAsarPath: runtime.appAsarPath,
  };
  const identity = {
    schemaVersion: 2,
    gate: 7,
    candidateId,
    candidateAlias: CANONICAL_CANDIDATE_ALIAS,
    sourceCommit,
    canonicalManifestPath: canonical.manifestPath,
    canonicalManifestSha256: canonical.manifestSha256,
    canonicalSourceSnapshotAggregateSha256: canonical.sourceSnapshotAggregateSha256,
    canonicalSourceSnapshotFileCount: canonical.sourceSnapshotFileCount,
    sourceSnapshotPath,
    sourceSnapshotSha256: await sha256File(sourceSnapshotPath, { gate: 7 }),
    zipPath,
    zipSha256: await sha256File(zipPath, { gate: 7 }),
    dmgPath,
    dmgSha256: await sha256File(dmgPath, { gate: 7 }),
    appPath: runtime.appPath,
    appSha256: await sha256Path(runtime.appPath),
    executablePath: runtime.executablePath,
    executableSha256: await sha256Path(runtime.executablePath),
    appAsarPath: runtime.appAsarPath,
    appAsarSha256: await sha256File(runtime.appAsarPath, { gate: 7 }),
    signing: 'UNSIGNED_DIAGNOSTIC_ONLY',
  };
  await privateJson(path.join(evidenceDir, 'gates/gate-06-canonical-release.json'), {
    schemaVersion: 1,
    gate: 6,
    status: manifest.status,
    releaseMode: manifest.releaseMode,
    candidateAlias: CANONICAL_CANDIDATE_ALIAS,
    blockers: manifest.blockers,
    artifactCount: manifest.artifacts.length,
  });
  await privateJson(path.join(evidenceDir, 'gates/gate-07-artifact-identity.json'), identity);

  await rm(internalRoot, { recursive: true, force: true });
  await rmdir(path.dirname(internalRoot)).catch((error) => {
    if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') throw error;
  });
  await requireAbsent(internalRoot, 'BLOCKED_CANONICAL_INTERNAL_RESIDUE');
  return { canonical, artifacts, identity };
}
