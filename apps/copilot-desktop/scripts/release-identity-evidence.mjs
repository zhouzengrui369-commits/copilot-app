import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, getRawHeader, listPackage, statFile } from '@electron/asar';

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDENTITY_PATH = 'dist/main/release-identity.json';
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_TREE_ENTRIES = 100_000;
const MAX_WINDOWS_PAYLOADS = 64;
const MAX_WINDOWS_PAYLOAD_DEPTH = 4;
const MAX_WINDOWS_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const WINDOWS_PAYLOAD_EXTENSIONS = new Set(['.7z', '.zip', '.nupkg']);
const MAX_PRIVACY_DEPTH = 64;
const MAX_PRIVACY_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PRIVACY_STREAM_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PRIVACY_SCAN_BYTES = 512 * 1024 * 1024;
const PRIVATE_REPORT_TYPES = new Set([
  'north-star-private-replay-bundle',
  'north-star-pm-replay-attestation',
  'north-star-private-telemetry',
  'north-star-private-ns2',
  'north-star-private-kg',
  'north-star-private-rag',
  'north-star-private-question-set',
  'north-star-private-owner-acceptance',
]);
const FIXED_REPO_ROOT = fixedRepoRoot();
const MACOS_REQUIRED_MATRIX = Object.freeze([
  ['darwin', 'arm64', 'macOS ZIP'],
  ['darwin', 'arm64', 'macOS DMG'],
  ['darwin', 'x64', 'macOS ZIP'],
  ['darwin', 'x64', 'macOS DMG'],
]);
const REQUIRED_MATRIX = Object.freeze([
  ...MACOS_REQUIRED_MATRIX,
  ['win32', 'x64', 'Windows NSIS'],
  ['win32', 'x64', 'Windows Portable'],
  ['win32', 'arm64', 'Windows NSIS'],
  ['win32', 'arm64', 'Windows Portable'],
]);

function fixedRepoRoot() {
  if (import.meta.url.startsWith('file:')) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  }
  // Vitest rewrites import.meta.url to its jsdom origin. Keep that exception
  // explicit and fail closed for every non-test non-file execution surface.
  if (process.env.VITEST) return path.resolve(process.cwd(), '../..');
  throw new Error('BLOCKED_ARTIFACT_IDENTITY: release helper module URL is not file-backed');
}

export function canonicalReleaseIdentity(value) {
  const errors = [];
  if (!plainObject(value)) throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'release identity must be an object');
  const allowed = ['schemaVersion', 'candidate', 'sourceHead', 'sourceSnapshotSha256'];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) errors.push(`unknown release identity fields: ${unknown.join(',')}`);
  if (value.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!CANDIDATE.test(String(value.candidate ?? ''))) errors.push('candidate is invalid');
  if (!SOURCE_HEAD.test(String(value.sourceHead ?? ''))) errors.push('sourceHead is invalid');
  if (!SHA256.test(String(value.sourceSnapshotSha256 ?? ''))) {
    errors.push('sourceSnapshotSha256 is invalid');
  }
  if (errors.length > 0) throw blocked('BLOCKED_ARTIFACT_IDENTITY', errors.join('; '));
  const identity = {
    schemaVersion: 1,
    candidate: value.candidate,
    sourceHead: value.sourceHead,
    sourceSnapshotSha256: value.sourceSnapshotSha256,
  };
  const bytes = Buffer.from(`${JSON.stringify(identity, null, 2)}\n`);
  return { value: identity, bytes, sha256: sha256Bytes(bytes) };
}

/** Verify identity from the app.asar found in an already-extracted final artifact. */
export async function inspectExtractedReleaseIdentity({
  root,
  platform,
  canonicalIdentity,
  hooks = {},
}) {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'unsupported artifact platform');
  }
  assertCanonicalIdentity(canonicalIdentity);
  await assertPrivateEvidenceAbsent(path.resolve(root), { mode: 'extracted', platform });
  const files = await listRegularFilesNoLinks(path.resolve(root));
  const appAsars = files.filter((file) => path.basename(file).toLowerCase() === 'app.asar');
  if (appAsars.length !== 1) {
    throw blocked(
      'BLOCKED_ARTIFACT_IDENTITY',
      `final extracted artifact must contain exactly one app.asar; got ${appAsars.length}`,
    );
  }
  const asarPath = appAsars[0];
  const { handle: sourceHandle, baseline: sourceBaseline } = await openStableArtifact(asarPath);
  let snapshotRoot;
  let snapshotHandle;
  try {
    const sourceFirst = await hashOpenFile(sourceHandle, sourceBaseline.size);
    const sourceSecond = await hashOpenFile(sourceHandle, sourceBaseline.size);
    assertMatchingHashes(sourceFirst, sourceSecond, 'before app.asar snapshot');
    await assertOpenArtifactStable(asarPath, sourceHandle, sourceBaseline);

    const snapshot = await createPrivateArtifactSnapshot(asarPath, sourceHandle, sourceFirst);
    snapshotRoot = snapshot.root;
    const openedSnapshot = await openStableArtifact(snapshot.path);
    snapshotHandle = openedSnapshot.handle;
    const snapshotBaseline = openedSnapshot.baseline;
    const snapshotFirst = await hashOpenFile(snapshotHandle, snapshotBaseline.size);
    const snapshotSecond = await hashOpenFile(snapshotHandle, snapshotBaseline.size);
    assertMatchingHashes(snapshotFirst, snapshotSecond, 'private app.asar snapshot');
    assertMatchingHashes(sourceFirst, snapshotFirst, 'source/private app.asar snapshot');
    await assertOpenArtifactStable(snapshot.path, snapshotHandle, snapshotBaseline);

    await hooks.afterAsarSnapshotCreated?.({
      root: snapshot.root,
      snapshotPath: snapshot.path,
      sourcePath: asarPath,
    });
    await assertOpenArtifactStable(asarPath, sourceHandle, sourceBaseline);

    // Every ASAR API call and every offset/content scan targets the immutable
    // 0700/0400 private snapshot, never the attacker-controlled source path.
    await scanAsarPrivacy(snapshot.path);
    let identityBytes;
    try {
      identityBytes = Buffer.from(extractFile(snapshot.path, IDENTITY_PATH));
    } catch {
      throw blocked(
        'BLOCKED_ARTIFACT_IDENTITY',
        `final app.asar is missing ${IDENTITY_PATH}`,
      );
    }
    if (!identityBytes.equals(canonicalIdentity.bytes)) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'packaged release identity bytes differ from canonical identity');
    }

    await assertOpenArtifactStable(snapshot.path, snapshotHandle, snapshotBaseline);
    const snapshotAfterFirst = await hashOpenFile(snapshotHandle, snapshotBaseline.size);
    const snapshotAfterSecond = await hashOpenFile(snapshotHandle, snapshotBaseline.size);
    assertMatchingHashes(snapshotAfterFirst, snapshotAfterSecond, 'after app.asar inspection');
    assertMatchingHashes(snapshotFirst, snapshotAfterFirst, 'across app.asar inspection');

    const sourceAfterFirst = await hashOpenFile(sourceHandle, sourceBaseline.size);
    const sourceAfterSecond = await hashOpenFile(sourceHandle, sourceBaseline.size);
    assertMatchingHashes(sourceAfterFirst, sourceAfterSecond, 'after app.asar inspection');
    assertMatchingHashes(sourceFirst, sourceAfterFirst, 'across app.asar inspection');
    await assertOpenArtifactStable(asarPath, sourceHandle, sourceBaseline);

    return {
      asarRelativePath: normalizeRelative(path.relative(path.resolve(root), asarPath)),
      asarSha256: snapshotAfterFirst.sha256,
      asarBytes: snapshotAfterFirst.bytes,
      identityRelativePath: IDENTITY_PATH,
      identitySha256: sha256Bytes(identityBytes),
      identityBytes: identityBytes.length,
      privacyScan: {
        status: 'PASS',
        scope: 'complete-extracted-root-and-app-asar',
        contentBased: true,
        symlinks: 'fail-closed',
      },
    };
  } finally {
    await snapshotHandle?.close().catch(() => {});
    await sourceHandle.close().catch(() => {});
    if (snapshotRoot) await rm(snapshotRoot, { recursive: true, force: true });
  }
}

/** Stable O_NOFOLLOW, same-handle, double-SHA inspection for final artifacts. */
export async function inspectStableFinalArtifact(filePath, { hooks = {} } = {}) {
  const absolute = path.resolve(filePath);
  const { handle, baseline } = await openStableArtifact(absolute);
  try {
    const first = await hashOpenFile(handle, baseline.size);
    await hooks.afterFirstHash?.();
    const second = await hashOpenFile(handle, baseline.size);
    if (first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact double SHA mismatch');
    }
    await assertOpenArtifactStable(absolute, handle, baseline);
    return { bytes: first.bytes, sha256: first.sha256 };
  } finally {
    await handle.close();
  }
}

/**
 * Keep the final destination open while it is re-unpacked and until its record
 * has been published. Deterministic hooks exist only for adversarial race tests.
 */
export async function verifyFinalArtifactForIdentity({
  filePath,
  inspectExtracted,
  publishRecord,
  hooks = {},
}) {
  if (typeof inspectExtracted !== 'function' || typeof publishRecord !== 'function') {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final artifact verifier callbacks are required');
  }
  const absolute = path.resolve(filePath);
  const { handle, baseline } = await openStableArtifact(absolute);
  let privateRoot;
  let parentHandle;
  try {
    const beforeFirst = await hashOpenFile(handle, baseline.size);
    await hooks.afterFirstHash?.();
    const beforeSecond = await hashOpenFile(handle, baseline.size);
    assertMatchingHashes(beforeFirst, beforeSecond, 'before extraction');
    await assertOpenArtifactStable(absolute, handle, baseline);
    const snapshot = await createPrivateArtifactSnapshot(absolute, handle, beforeFirst);
    privateRoot = snapshot.root;
    await hooks.afterSnapshotCreated?.({ root: snapshot.root, snapshotPath: snapshot.path });
    parentHandle = await open(path.dirname(absolute), fsConstants.O_RDONLY);
    const parentBaseline = await parentHandle.stat({ bigint: true });
    const inspection = await inspectExtracted({ snapshotPath: snapshot.path });
    const parentAfterInspection = await parentHandle.stat({ bigint: true });
    if (!sameStableFile(parentBaseline, parentAfterInspection)) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact directory changed during inspection');
    }
    const afterFirst = await hashOpenFile(handle, baseline.size);
    const afterSecond = await hashOpenFile(handle, baseline.size);
    assertMatchingHashes(afterFirst, afterSecond, 'after extraction');
    assertMatchingHashes(beforeFirst, afterFirst, 'across extraction');
    await assertOpenArtifactStable(absolute, handle, baseline);
    await hooks.beforeRecord?.();
    await assertOpenArtifactStable(absolute, handle, baseline);
    const published = await publishRecord({
      outer: { bytes: afterFirst.bytes, sha256: afterFirst.sha256 },
      inspection,
    });
    await assertOpenArtifactStable(absolute, handle, baseline);
    const finalFirst = await hashOpenFile(handle, baseline.size);
    const finalSecond = await hashOpenFile(handle, baseline.size);
    assertMatchingHashes(finalFirst, finalSecond, 'after record');
    assertMatchingHashes(afterFirst, finalFirst, 'record binding');
    return { outer: finalFirst, inspection, published };
  } finally {
    await parentHandle?.close().catch(() => {});
    await handle.close();
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true });
  }
}

/** Content-based bounded privacy scan. Filenames are deliberately irrelevant. */
export async function assertPrivateEvidenceAbsent(candidateRoot, {
  mode = 'candidate',
  platform,
} = {}) {
  const root = await realpath(path.resolve(candidateRoot));
  const snapshotRoot = path.join(root, 'work/source-snapshot');
  const stack = [{ directory: root, depth: 0, ancestors: new Set() }];
  const visitedDirectories = new Set();
  let entriesSeen = 0;
  let bytesScanned = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.depth > MAX_PRIVACY_DEPTH) throw privacyBlocked('privacy scan depth budget exceeded');
    const canonicalDirectory = await realpath(current.directory);
    if (current.ancestors.has(canonicalDirectory)) throw privacyBlocked('privacy scan symbolic-link cycle detected');
    if (visitedDirectories.has(canonicalDirectory)) continue;
    visitedDirectories.add(canonicalDirectory);
    const nextAncestors = new Set(current.ancestors);
    nextAncestors.add(canonicalDirectory);
    for (const entry of await readdir(current.directory, { withFileTypes: true })) {
      entriesSeen += 1;
      if (entriesSeen > MAX_TREE_ENTRIES) throw privacyBlocked('privacy scan entry budget exceeded');
      const target = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved;
        try { resolved = await realpath(target); } catch { throw privacyBlocked('release tree symbolic link is broken'); }
        const allowedSnapshotDependency = mode === 'candidate'
          && inside(snapshotRoot, target)
          && await allowedBuilderDependencyLink(snapshotRoot, target, resolved);
        const allowedPackagedFramework = mode === 'extracted'
          && platform === 'darwin'
          && await allowedPackagedFrameworkLink(root, target, resolved);
        if (!allowedSnapshotDependency && !allowedPackagedFramework) {
          throw privacyBlocked('release tree contains a forbidden symbolic link');
        }
        continue;
      }
      if (entry.isDirectory()) stack.push({
        directory: target,
        depth: current.depth + 1,
        ancestors: nextAncestors,
      });
      else if (entry.isFile()) {
        // Extracted app.asar content is inspected only after it has been copied
        // from one stable source handle into a private immutable snapshot.
        if (mode === 'extracted' && entry.name.toLowerCase() === 'app.asar') continue;
        bytesScanned = await scanPrivacyFile(target, bytesScanned);
      }
    }
  }
}

/** Remove only ephemeral electron-builder macOS unpack roots. */
export async function cleanupCanonicalMacWorkDirectories(workDir, { hooks = {} } = {}) {
  const root = path.resolve(workDir);
  const remove = hooks.remove ?? rm;
  for (const name of ['mac-arm64', 'mac-x64']) {
    const target = path.join(root, name);
    if (path.dirname(target) !== root) {
      throw blocked('BLOCKED_MAC_WORK_CLEANUP', 'canonical mac work path is invalid');
    }
    try {
      await remove(target, { recursive: true, force: true });
    } catch {
      throw blocked('BLOCKED_MAC_WORK_CLEANUP', 'canonical mac work cleanup failed');
    }
  }
  await assertCanonicalMacWorkDirectoriesAbsent(root);
}

/** Marker publication must fail closed if an ephemeral macOS unpack root remains. */
export async function assertCanonicalMacWorkDirectoriesAbsent(workDir) {
  const root = path.resolve(workDir);
  for (const name of ['mac-arm64', 'mac-x64']) {
    try {
      await lstat(path.join(root, name));
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw blocked('BLOCKED_MAC_WORK_CLEANUP', 'canonical mac work absence check failed');
    }
    throw blocked('BLOCKED_MAC_WORK_CLEANUP', 'canonical mac work directory remains');
  }
}

async function allowedPackagedFrameworkLink(candidateRoot, linkPath, resolved) {
  const relative = normalizeRelative(path.relative(candidateRoot, linkPath));
  if (!safeRelativePath(relative)) return false;
  const segments = relative.split('/');
  const appIndexes = segments.flatMap((segment, index) => segment.endsWith('.app') ? [index] : []);
  const frameworkIndexes = segments.flatMap((segment, index) => segment.endsWith('.framework') ? [index] : []);
  if (appIndexes.length !== 1 || frameworkIndexes.length !== 1) return false;
  const appIndex = appIndexes[0];
  const frameworkIndex = frameworkIndexes[0];
  if (frameworkIndex !== appIndex + 3
      || segments[appIndex + 1] !== 'Contents'
      || segments[appIndex + 2] !== 'Frameworks'
      || frameworkIndex + 1 >= segments.length) return false;
  const frameworkRoot = path.join(candidateRoot, ...segments.slice(0, frameworkIndex + 1));
  const frameworkName = segments[frameworkIndex].slice(0, -'.framework'.length);
  if (!frameworkName || frameworkName === '.' || frameworkName === '..') return false;
  const linkSegments = segments.slice(frameworkIndex + 1);
  let rawTarget;
  let version;
  try {
    rawTarget = normalizeRelative(await readlink(linkPath));
    version = await canonicalFrameworkVersion(frameworkRoot);
  } catch {
    return false;
  }
  if (!inside(version.framework, resolved)) return false;

  if (linkSegments.length === 2
      && linkSegments[0] === 'Versions'
      && linkSegments[1] === 'Current') {
    return rawTarget === version.name && resolved === version.directory;
  }

  if (linkSegments.length !== 1) return false;
  const linkName = linkSegments[0];
  // Electron Framework ships a standard Helpers bundle link in addition to
  // the CFBundle Resources/Headers/Libraries links and framework executable.
  const allowedRootNames = new Set([
    'Resources',
    'Headers',
    'Libraries',
    'Helpers',
    frameworkName,
  ]);
  if (!allowedRootNames.has(linkName)) return false;
  if (rawTarget !== `Versions/Current/${linkName}`) return false;
  let expected;
  try { expected = await realpath(path.join(frameworkRoot, rawTarget)); } catch { return false; }
  return resolved === expected && inside(version.directory, resolved);
}

async function canonicalFrameworkVersion(frameworkRoot) {
  const framework = await realpath(frameworkRoot);
  const versions = path.join(frameworkRoot, 'Versions');
  const entries = await readdir(versions, { withFileTypes: true });
  const current = entries.filter((entry) => entry.name === 'Current');
  const versionDirectories = entries.filter((entry) => entry.name !== 'Current' && entry.isDirectory());
  if (current.length !== 1
      || !current[0].isSymbolicLink()
      || versionDirectories.length !== 1
      || entries.length !== 2) {
    throw new Error('noncanonical framework Versions directory');
  }
  const name = versionDirectories[0].name;
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('invalid framework version name');
  }
  const currentTarget = normalizeRelative(await readlink(path.join(versions, 'Current')));
  if (currentTarget !== name) throw new Error('framework Current target is noncanonical');
  const directory = await realpath(path.join(versions, name));
  const currentDirectory = await realpath(path.join(versions, 'Current'));
  if (directory !== currentDirectory || !inside(framework, directory)) {
    throw new Error('framework Current target escapes its bundle');
  }
  return { framework, name, directory };
}

async function allowedBuilderDependencyLink(snapshotRoot, linkPath, resolved) {
  const relative = normalizeRelative(path.relative(snapshotRoot, linkPath));
  if (!safeRelativePath(relative)) return false;
  const segments = relative.split('/');
  let expectedPath = null;
  if (segments.length === 2 && segments[0] === 'node_modules') {
    expectedPath = path.join(FIXED_REPO_ROOT, 'node_modules', segments[1]);
  } else if (segments.length === 3 && segments[0] === 'node_modules' && segments[1] === '@copilot') {
    if (inside(snapshotRoot, resolved)) {
      const snapshotRelative = normalizeRelative(path.relative(snapshotRoot, resolved));
      return /^(?:apps\/(?:copilot-desktop|copilot-cloud)|packages\/[^/]+)$/.test(snapshotRelative);
    }
    expectedPath = path.join(FIXED_REPO_ROOT, 'node_modules/@copilot', segments[2]);
  } else {
    const workspace = relative.match(/^(apps\/(?:copilot-desktop|copilot-cloud)|packages\/[^/]+)\/node_modules$/);
    if (workspace) expectedPath = path.join(FIXED_REPO_ROOT, workspace[1], 'node_modules');
  }
  if (!expectedPath) return false;
  let canonicalExpected;
  try { canonicalExpected = await realpath(expectedPath); } catch { return false; }
  return canonicalExpected === resolved;
}

/**
 * Expand every supported archive payload found in a Windows installer/portable
 * extraction before performing one global app.asar inventory. The caller owns
 * the archive implementation; this helper owns traversal budgets and identity
 * cardinality so a direct payload can never hide a duplicate nested payload.
 */
export async function inspectWindowsArtifactReleaseIdentity({
  root,
  canonicalIdentity,
  expandPayload,
  limits = {},
}) {
  if (typeof expandPayload !== 'function') {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows payload expander is required');
  }
  const resolvedRoot = path.resolve(root);
  const maxPayloads = boundedLimit(limits.maxPayloads, MAX_WINDOWS_PAYLOADS);
  const maxDepth = boundedLimit(limits.maxDepth, MAX_WINDOWS_PAYLOAD_DEPTH);
  const maxExpandedBytes = boundedLimit(
    limits.maxExpandedBytes,
    MAX_WINDOWS_EXPANDED_BYTES,
  );
  const initialFiles = await listRegularFilesNoLinks(resolvedRoot);
  const queue = initialFiles
    .filter(isSupportedWindowsPayload)
    .map((archive) => ({ archive, depth: 0 }));
  if (queue.length > maxPayloads) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows payload count exceeds expansion budget');
  }

  const expansionRoot = path.join(resolvedRoot, '.__njx-identity-expanded__');
  if (queue.length > 0) {
    try {
      await mkdir(expansionRoot, { mode: 0o700 });
    } catch {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows expansion root is unavailable or pre-existing');
    }
  }
  let expandedBytes = 0;
  let expandedEntries = 0;
  let payloadIndex = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows nested payload depth exceeds expansion budget');
    }
    payloadIndex += 1;
    if (payloadIndex > maxPayloads) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows payload count exceeds expansion budget');
    }
    const destination = path.join(expansionRoot, `payload-${String(payloadIndex).padStart(3, '0')}`);
    await mkdir(destination, { mode: 0o700 });
    try {
      await expandPayload({
        archive: current.archive,
        destination,
        depth: current.depth,
        index: payloadIndex,
      });
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'BLOCKED_ARTIFACT_IDENTITY') throw error;
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows nested payload expansion failed');
    }
    const expanded = await listRegularFilesNoLinks(destination);
    expandedEntries += expanded.length;
    if (expandedEntries > MAX_TREE_ENTRIES) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows expanded entry count exceeds traversal budget');
    }
    for (const file of expanded) {
      const info = await lstat(file);
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows expanded payload size is invalid');
      }
      expandedBytes += info.size;
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxExpandedBytes) {
        throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows expanded bytes exceed expansion budget');
      }
      if (isSupportedWindowsPayload(file)) {
        queue.push({ archive: file, depth: current.depth + 1 });
        if (payloadIndex + queue.length > maxPayloads) {
          throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows payload count exceeds expansion budget');
        }
      }
    }
  }
  return inspectExtractedReleaseIdentity({
    root: resolvedRoot,
    platform: 'win32',
    canonicalIdentity,
  });
}

export function buildArtifactIdentityRecord(input) {
  assertCanonicalIdentity(input?.canonicalIdentity);
  const artifact = input?.artifact;
  const inspection = input?.inspection;
  if (!plainObject(artifact) || !plainObject(inspection)) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'artifact identity record inputs are incomplete');
  }
  return {
    schemaVersion: 1,
    reportType: 'artifact-release-identity',
    candidate: input.candidate,
    sourceHead: input.sourceHead,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    artifact: {
      relativePath: artifact.relativePath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      platform: artifact.platform,
      arch: artifact.arch,
      kind: artifact.kind,
    },
    asar: {
      relativePath: inspection.asarRelativePath,
      sha256: inspection.asarSha256,
      bytes: inspection.asarBytes,
    },
    identity: {
      relativePath: inspection.identityRelativePath,
      sha256: inspection.identitySha256,
      bytes: inspection.identityBytes,
    },
    privacyScan: inspection.privacyScan,
  };
}

export async function publishArtifactIdentityRecordCrashSafe({ target, record }) {
  const contents = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, target);
    const directoryHandle = await open(directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
  return { sha256: sha256Bytes(contents), bytes: contents.length };
}

/**
 * Re-verify canonical bytes, the mode-bound complete artifact matrix, every
 * report and (for the legacy dual-platform mode) Windows authenticated trust.
 */
export async function evaluateArtifactIdentityEvidence({ candidateRoot, manifest }) {
  const root = path.resolve(candidateRoot);
  const matrixErrors = [];
  const identityErrors = [];
  const trustErrors = [];
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const releaseMode = manifest?.signingProfile?.mode;
  let requiredMatrix;
  if (releaseMode === 'macos-distribution') requiredMatrix = MACOS_REQUIRED_MATRIX;
  else if (releaseMode === 'distribution' || releaseMode === 'unsigned') requiredMatrix = REQUIRED_MATRIX;
  else {
    requiredMatrix = [];
    matrixErrors.push('canonical signing profile mode is unsupported');
  }
  const expectedKeys = requiredMatrix.map(matrixKey).sort();
  const actualKeys = artifacts.map((item) => matrixKey([
    item?.platform,
    item?.arch,
    item?.kind,
  ])).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    matrixErrors.push(releaseMode === 'macos-distribution'
      ? 'canonical artifact matrix must contain exactly mac ZIP+DMG arm64/x64'
      : 'canonical artifact matrix must contain exactly mac ZIP+DMG arm64/x64 and Windows setup+portable x64/arm64');
  }
  for (const artifact of artifacts) {
    if (
      !safeRelativePath(artifact?.relativePath)
      || !artifactPathMatches(artifact)
      || !SHA256.test(String(artifact?.sha256 ?? ''))
      || !positiveInteger(artifact?.bytes)
    ) {
      matrixErrors.push(`artifact path/hash/bytes do not match declared platform/arch/kind: ${safeLabel(artifact?.relativePath)}`);
    }
  }

  let canonical;
  try {
    canonical = canonicalReleaseIdentity({
      schemaVersion: manifest?.releaseIdentity?.schemaVersion,
      candidate: manifest?.candidate,
      sourceHead: manifest?.source?.head,
      sourceSnapshotSha256: manifest?.source?.snapshot?.sha256,
    });
    if (manifest?.releaseIdentity?.evidenceRelativePath !== 'RELEASE-IDENTITY.json') {
      identityErrors.push('canonical identity evidence path is invalid');
    }
    if (manifest?.releaseIdentity?.packagedRelativePath !== IDENTITY_PATH) {
      identityErrors.push('packaged identity path is invalid');
    }
    if (manifest?.releaseIdentity?.sha256 !== canonical.sha256
        || manifest?.releaseIdentity?.bytes !== canonical.bytes.length) {
      identityErrors.push('manifest canonical identity SHA/bytes mismatch');
    }
    const identityFile = await readCandidateFile(root, 'RELEASE-IDENTITY.json', 4096);
    if (!identityFile.equals(canonical.bytes)) identityErrors.push('canonical identity file bytes mismatch');
  } catch (error) {
    identityErrors.push(publicMessage(error, 'canonical identity is invalid'));
  }

  const referencePaths = [];
  if (canonical) {
    for (const artifact of artifacts) {
      const ref = artifact?.releaseIdentityVerification;
      if (!plainObject(ref)
          || !safeEvidencePath(ref.reportRelativePath)
          || !SHA256.test(String(ref.reportSha256 ?? ''))) {
        identityErrors.push(`exactly one valid identity report reference is required for ${safeLabel(artifact?.relativePath)}`);
        continue;
      }
      referencePaths.push(ref.reportRelativePath);
      try {
        const artifactEvidence = await inspectCandidateFile(root, artifact.relativePath);
        if (artifactEvidence.bytes !== artifact.bytes || artifactEvidence.sha256 !== artifact.sha256) {
          identityErrors.push(`outer artifact binding mismatch: ${safeLabel(artifact.relativePath)}`);
          continue;
        }
        const reportBytes = await readCandidateFile(root, ref.reportRelativePath, MAX_REPORT_BYTES);
        if (sha256Bytes(reportBytes) !== ref.reportSha256) {
          identityErrors.push(`identity report SHA mismatch: ${safeLabel(artifact.relativePath)}`);
          continue;
        }
        let record;
        try {
          record = JSON.parse(reportBytes.toString('utf8'));
        } catch {
          identityErrors.push(`identity report JSON invalid: ${safeLabel(artifact.relativePath)}`);
          continue;
        }
        if (!reportBytes.equals(Buffer.from(`${JSON.stringify(record, null, 2)}\n`))) {
          identityErrors.push(`identity report serialization is non-canonical: ${safeLabel(artifact.relativePath)}`);
          continue;
        }
        identityErrors.push(...validateRecord(record, artifact, manifest, canonical)
          .map((message) => `${safeLabel(artifact.relativePath)}: ${message}`));
      } catch (error) {
        identityErrors.push(`${safeLabel(artifact?.relativePath)}: ${publicMessage(error, 'identity evidence unavailable')}`);
      }
    }
  }

  if (new Set(referencePaths.map(canonicalPathKey)).size !== referencePaths.length) {
    identityErrors.push('identity report references must be unique');
  }
  try {
    const evidenceDir = path.join(root, 'evidence/artifact-identity');
    const actualReports = (await readdir(evidenceDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => `evidence/artifact-identity/${entry.name}`)
      .sort();
    const expectedReports = [...referencePaths].sort();
    if (JSON.stringify(actualReports) !== JSON.stringify(expectedReports)) {
      identityErrors.push('artifact identity report inventory is missing, duplicated, or stale');
    }
  } catch {
    identityErrors.push('artifact identity report directory is unavailable');
  }

  const signingGate = manifest?.postPackageGates?.gates?.find?.((gate) => gate?.id === 'signingNotarization');
  if (releaseMode === 'macos-distribution') {
    const macPlatforms = Array.isArray(signingGate?.metrics?.platforms)
      ? [...new Set(signingGate.metrics.platforms)].sort()
      : [];
    if (artifacts.some((item) => item?.platform !== 'darwin' || item?.signing !== 'verified')
        || signingGate?.status !== 'PASS'
        || signingGate?.metrics?.macosNotarization !== 'accepted'
        || signingGate?.metrics?.verifiedReports !== MACOS_REQUIRED_MATRIX.length
        || JSON.stringify(macPlatforms) !== JSON.stringify(['darwin'])) {
      identityErrors.push('verified macOS signing/notarization reports have not passed for the complete four-artifact matrix');
    }
  } else {
    const windows = artifacts.filter((item) => item?.platform === 'win32');
    if (windows.length !== 4 || windows.some((item) => (
      item?.signing !== 'verified'
      || item?.signature?.provenance !== 'canonical-windows-cryptographic-verifier'
      || item?.signature?.certificateTrustPolicy !== 'windows-attested'
      || !plainObject(item?.signature?.windowsTrustAttestation)
      || !nonempty(item.signature.windowsTrustAttestation.publicKeyPem)
      || !SHA256.test(String(item.signature.windowsTrustAttestation.publicKeySha256 ?? ''))
      || !nonempty(item.signature.windowsTrustAttestation.runnerId)
    ))) {
      trustErrors.push('all four Windows artifacts require canonical cryptographic and trust-anchor metadata');
    }
    if (
      signingGate?.status !== 'PASS'
      || signingGate?.metrics?.windowsSignature !== 'verified'
      || signingGate?.metrics?.verifiedReports !== REQUIRED_MATRIX.length
      || !Array.isArray(signingGate?.metrics?.platforms)
      || !signingGate.metrics.platforms.includes('win32')
    ) {
      trustErrors.push('authenticated Windows trust reports have not passed for the complete artifact matrix');
    }
  }

  const blockers = [];
  if (matrixErrors.length > 0) blockers.push({ code: 'BLOCKED_ARTIFACT_MATRIX', message: matrixErrors.join('; ') });
  if (identityErrors.length > 0) blockers.push({ code: 'BLOCKED_ARTIFACT_IDENTITY', message: identityErrors.join('; ') });
  if (trustErrors.length > 0) blockers.push({ code: 'BLOCKED_WINDOWS_AUTHENTICATED_TRUST', message: trustErrors.join('; ') });
  return {
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    requiredArtifacts: requiredMatrix.length,
    verifiedArtifacts: blockers.length === 0 ? artifacts.length : 0,
    identitySha256: canonical?.sha256 ?? null,
    blockers,
  };
}

function validateRecord(record, artifact, manifest, canonical) {
  const errors = [];
  if (!plainObject(record)) return ['report must be an object'];
  const allowed = ['schemaVersion', 'reportType', 'candidate', 'sourceHead', 'sourceSnapshotSha256', 'artifact', 'asar', 'identity', 'privacyScan'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) errors.push('report contains unknown fields');
  if (record.schemaVersion !== 1 || record.reportType !== 'artifact-release-identity') {
    errors.push('report type/schema mismatch');
  }
  if (record.candidate !== manifest.candidate) errors.push('candidate mismatch');
  if (record.sourceHead !== manifest.source?.head) errors.push('source HEAD mismatch');
  if (record.sourceSnapshotSha256 !== manifest.source?.snapshot?.sha256) errors.push('source snapshot mismatch');
  for (const field of ['relativePath', 'sha256', 'bytes', 'platform', 'arch', 'kind']) {
    if (record.artifact?.[field] !== artifact?.[field]) errors.push(`artifact.${field} mismatch`);
  }
  if (!plainObject(record.artifact)
      || JSON.stringify(Object.keys(record.artifact).sort())
        !== JSON.stringify(['arch', 'bytes', 'kind', 'platform', 'relativePath', 'sha256'])) {
    errors.push('artifact binding fields are invalid');
  }
  if (!plainObject(record.asar)
      || JSON.stringify(Object.keys(record.asar).sort())
        !== JSON.stringify(['bytes', 'relativePath', 'sha256'])) {
    errors.push('asar binding fields are invalid');
  }
  if (!plainObject(record.identity)
      || JSON.stringify(Object.keys(record.identity).sort())
        !== JSON.stringify(['bytes', 'relativePath', 'sha256'])) {
    errors.push('identity binding fields are invalid');
  }
  if (!safeAsarPath(record.asar?.relativePath, artifact?.platform)) errors.push('asar.relativePath is invalid');
  if (!SHA256.test(String(record.asar?.sha256 ?? ''))) errors.push('asar.sha256 is invalid');
  if (!positiveInteger(record.asar?.bytes)) errors.push('asar.bytes is invalid');
  if (record.identity?.relativePath !== IDENTITY_PATH) errors.push('identity.relativePath mismatch');
  if (record.identity?.sha256 !== canonical.sha256) errors.push('identity.sha256 mismatch');
  if (record.identity?.bytes !== canonical.bytes.length) errors.push('identity.bytes mismatch');
  if (!plainObject(record.privacyScan)
      || JSON.stringify(Object.keys(record.privacyScan).sort())
        !== JSON.stringify(['contentBased', 'scope', 'status', 'symlinks'])
      || record.privacyScan.status !== 'PASS'
      || record.privacyScan.scope !== 'complete-extracted-root-and-app-asar'
      || record.privacyScan.contentBased !== true
      || record.privacyScan.symlinks !== 'fail-closed') {
    errors.push('privacyScan binding is invalid');
  }
  return errors;
}

async function listRegularFilesNoLinks(root) {
  const output = [];
  const stack = [root];
  let entriesSeen = 0;
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entriesSeen += 1;
      if (entriesSeen > MAX_TREE_ENTRIES) {
        throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'extracted artifact exceeds traversal budget');
      }
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.toLowerCase() === 'app.asar') {
          throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'app.asar may not be a symbolic link');
        }
        continue;
      }
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  return output;
}

async function readCandidateFile(root, relativePath, maxBytes) {
  if (!safeRelativePath(relativePath)) throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'unsafe candidate evidence path');
  const absolute = path.resolve(root, relativePath);
  if (!inside(root, absolute)) throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'candidate evidence path escapes root');
  return readRegularFileNoLinks(absolute, maxBytes);
}

async function inspectCandidateFile(root, relativePath) {
  if (!safeRelativePath(relativePath)) throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'unsafe candidate artifact path');
  const absolute = path.resolve(root, relativePath);
  if (!inside(root, absolute)) throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'candidate artifact path escapes root');
  return inspectStableFinalArtifact(absolute);
}

async function inspectRegularFileNoLinks(filePath) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  const handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    const pathInfo = await lstat(filePath);
    if (!before.isFile() || pathInfo.isSymbolicLink() || before.dev !== pathInfo.dev || before.ino !== pathInfo.ino) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'artifact must be a stable regular file');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, total);
      if (result.bytesRead === 0) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      total += result.bytesRead;
    }
    const after = await handle.stat();
    const afterPath = await lstat(filePath);
    if (
      total !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || afterPath.dev !== before.dev
      || afterPath.ino !== before.ino
    ) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'artifact changed while hashing');
    }
    return { bytes: total, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function openStableArtifact(filePath) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const baseline = await handle.stat({ bigint: true });
    const pathInfo = await lstat(filePath, { bigint: true });
    if (!baseline.isFile() || baseline.nlink !== 1n || pathInfo.isSymbolicLink()
        || !sameStableFile(baseline, pathInfo) || baseline.size < 1n
        || baseline.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('unsafe');
    }
    return { handle, baseline };
  } catch {
    await handle?.close().catch(() => {});
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact is unavailable or unsafe');
  }
}

async function hashOpenFile(handle, expectedSize) {
  const size = Number(expectedSize);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (result.bytesRead === 0) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact changed while hashing');
    }
    hash.update(buffer.subarray(0, result.bytesRead));
    offset += result.bytesRead;
  }
  return { bytes: offset, sha256: hash.digest('hex') };
}

async function createPrivateArtifactSnapshot(sourcePath, sourceHandle, expected) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-artifact-snapshot-'));
  let snapshotHandle;
  try {
    await chmod(root, 0o700);
    const extension = /^[.][A-Za-z0-9]{1,12}$/.test(path.extname(sourcePath))
      ? path.extname(sourcePath) : '.bin';
    const snapshotPath = path.join(root, `artifact${extension}`);
    snapshotHandle = await open(
      snapshotPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o400,
    );
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < expected.bytes) {
      const read = await sourceHandle.read(
        buffer,
        0,
        Math.min(buffer.length, expected.bytes - offset),
        offset,
      );
      if (read.bytesRead === 0) throw new Error('source changed');
      let written = 0;
      while (written < read.bytesRead) {
        const result = await snapshotHandle.write(
          buffer,
          written,
          read.bytesRead - written,
          offset + written,
        );
        if (result.bytesWritten === 0) throw new Error('snapshot write stopped');
        written += result.bytesWritten;
      }
      hash.update(buffer.subarray(0, read.bytesRead));
      offset += read.bytesRead;
    }
    await snapshotHandle.sync();
    await snapshotHandle.chmod(0o400);
    await snapshotHandle.close();
    snapshotHandle = undefined;
    if (offset !== expected.bytes || hash.digest('hex') !== expected.sha256) {
      throw new Error('snapshot SHA mismatch');
    }
    const rootInfo = await lstat(root);
    const snapshotInfo = await lstat(snapshotPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o777) !== 0o700
        || !snapshotInfo.isFile() || snapshotInfo.isSymbolicLink()
        || (snapshotInfo.mode & 0o777) !== 0o400 || snapshotInfo.size !== expected.bytes) {
      throw new Error('snapshot permissions invalid');
    }
    const verified = await inspectStableFinalArtifact(snapshotPath);
    if (verified.bytes !== expected.bytes || verified.sha256 !== expected.sha256) {
      throw new Error('snapshot stable binding mismatch');
    }
    return { root, path: snapshotPath };
  } catch {
    await snapshotHandle?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'private artifact snapshot creation failed');
  }
}

async function assertOpenArtifactStable(filePath, handle, baseline) {
  let current;
  let pathInfo;
  try {
    current = await handle.stat({ bigint: true });
    pathInfo = await lstat(filePath, { bigint: true });
  } catch {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact path changed during verification');
  }
  if (!sameStableFile(baseline, current) || !sameStableFile(baseline, pathInfo)
      || pathInfo.isSymbolicLink() || current.nlink !== 1n || pathInfo.nlink !== 1n) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'outer artifact was replaced during verification');
  }
}

function sameStableFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertMatchingHashes(left, right, phase) {
  if (left.bytes !== right.bytes || left.sha256 !== right.sha256) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', `outer artifact SHA mismatch ${phase}`);
  }
}

async function scanPrivacyFile(filePath, bytesScanned) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw privacyBlocked('privacy scan encountered unsafe file');
  if (!Number.isSafeInteger(info.size) || info.size < 0) throw privacyBlocked('privacy scan file size is invalid');
  if (info.size > MAX_PRIVACY_FILE_BYTES) {
    const prefix = await readStablePrefix(filePath, 4096);
    if (await isAsarArchive(filePath)) {
      await scanAsarPrivacy(filePath);
      return bytesScanned;
    }
    if (classifyPrivacyContent(prefix) === 'binary') return bytesScanned;
    if (info.size > MAX_PRIVACY_STREAM_FILE_BYTES
        || bytesScanned + info.size > MAX_PRIVACY_SCAN_BYTES) {
      throw privacyBlocked('privacy scan content is over-budget or undecidable');
    }
    await streamScanTextFile(filePath, info.size);
    return bytesScanned + info.size;
  }
  if (bytesScanned + info.size > MAX_PRIVACY_SCAN_BYTES) {
    throw privacyBlocked('privacy scan byte budget exceeded');
  }
  const bytes = info.size === 0 ? Buffer.alloc(0) : await readRegularFileNoLinks(
    filePath,
    MAX_PRIVACY_FILE_BYTES,
  );
  if (bytes.length > 0 && !isValidUtf8(bytes)) {
    if (classifyPrivacyContent(bytes) === 'binary' || await isAsarArchive(filePath)) {
      return bytesScanned + info.size;
    }
    throw privacyBlocked('privacy scan content is undecidable');
  }
  if (containsPrivateReport(bytes)) throw privacyBlocked('release tree contains private replay evidence');
  return bytesScanned + info.size;
}

async function readStablePrefix(filePath, maxBytes) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    const pathInfo = await lstat(filePath, { bigint: true });
    if (!before.isFile() || pathInfo.isSymbolicLink() || !sameStableFile(before, pathInfo)) throw new Error('unsafe');
    const bytes = Buffer.alloc(Math.min(maxBytes, Number(before.size)));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat({ bigint: true });
    if (!sameStableFile(before, after)) throw new Error('changed');
    return bytes.subarray(0, bytesRead);
  } catch {
    throw privacyBlocked('privacy scan file is unsafe or changed');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function looksJsonLike(bytes) {
  const text = bytes.toString('utf8').trimStart();
  return text.startsWith('{') || text.startsWith('[');
}

function containsPrivateReport(bytes) {
  if (bytes.length === 0) return false;
  const text = bytes.toString('utf8').trim();
  if (!text) return false;
  if (textContainsPrivateReportType(text)) return true;
  const documents = [];
  try {
    documents.push(JSON.parse(text));
  } catch {
    try {
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 1) return false;
      documents.push(...lines.map((line) => JSON.parse(line)));
    } catch {
      return false;
    }
  }
  const stack = [...documents];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) stack.push(...value);
    else {
      const reportType = String(value.reportType ?? '');
      if (PRIVATE_REPORT_TYPES.has(reportType) || reportType.startsWith('north-star-private-')) {
        return true;
      }
      stack.push(...Object.values(value));
    }
  }
  return false;
}

async function streamScanTextFile(filePath, expectedSize) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    const pathInfo = await lstat(filePath, { bigint: true });
    if (!before.isFile() || pathInfo.isSymbolicLink() || Number(before.size) !== expectedSize
        || !sameStableFile(before, pathInfo)) throw new Error('unsafe');
    await streamScanHandle(handle, 0, expectedSize, 'release tree contains private replay evidence');
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (!sameStableFile(before, after) || !sameStableFile(before, afterPath)) throw new Error('changed');
  } catch (error) {
    if (error?.code === 'BLOCKED_PRIVATE_REPLAY_LEAK') throw error;
    throw privacyBlocked('privacy scan file is unsafe or changed');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function createReportTypeDetector() {
  let expectation = 'search';
  let inString = false;
  let stringRole = 'ordinary';
  let decoded = '';
  let escaped = false;
  let unicode = null;
  let overlong = false;
  const append = (char) => {
    if (decoded.length < 256) decoded += char;
    else overlong = true;
  };
  const privateValue = () => !overlong
    && (PRIVATE_REPORT_TYPES.has(decoded) || decoded.startsWith('north-star-private-'));
  return {
    feed(text) {
      for (const char of text) {
        if (inString) {
          if (unicode !== null) {
            if (!/[0-9a-f]/i.test(char)) {
              unicode = null;
              escaped = false;
              overlong = true;
            } else {
              unicode += char;
              if (unicode.length === 4) {
                append(String.fromCharCode(Number.parseInt(unicode, 16)));
                unicode = null;
                escaped = false;
              }
            }
            continue;
          }
          if (escaped) {
            if (char === 'u') unicode = '';
            else {
              const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
              if (Object.hasOwn(escapes, char)) append(escapes[char]);
              else overlong = true;
              escaped = false;
            }
            continue;
          }
          if (char === '\\') {
            escaped = true;
            continue;
          }
          if (char !== '"') {
            append(char);
            if (stringRole === 'value' && privateValue()) return true;
            continue;
          }
          inString = false;
          if (stringRole === 'value') {
            if (privateValue()) return true;
            expectation = 'search';
          } else if (!overlong && decoded === 'reportType') {
            expectation = 'colon';
          } else {
            expectation = 'search';
          }
          continue;
        }

        if (expectation === 'colon') {
          if (/\s/.test(char)) continue;
          if (char === ':') {
            expectation = 'value';
            continue;
          }
          expectation = 'search';
        } else if (expectation === 'value') {
          if (/\s/.test(char)) continue;
          if (char !== '"') {
            expectation = 'search';
            continue;
          }
          inString = true;
          stringRole = 'value';
          decoded = '';
          overlong = false;
          escaped = false;
          unicode = null;
          continue;
        }

        if (char === '"') {
          inString = true;
          stringRole = 'ordinary';
          decoded = '';
          overlong = false;
          escaped = false;
          unicode = null;
        }
      }
      return false;
    },
    undecidable() { return expectation !== 'search' || (inString && stringRole === 'value'); },
  };
}

function textContainsPrivateReportType(text) {
  const detector = createReportTypeDetector();
  return detector.feed(text);
}

function isValidUtf8(bytes) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; }
  catch { return false; }
}

function isKnownBinary(bytes) {
  if (bytes.length < 2) return false;
  const signatures = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x4d, 0x5a]),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from('%PDF'),
    Buffer.from('GIF8'),
    Buffer.from('SQLite format 3\0'),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  ];
  return signatures.some((signature) => bytes.subarray(0, signature.length).equals(signature));
}

function classifyPrivacyContent(bytes) {
  if (isKnownBinary(bytes)) return 'binary';
  if (bytes.length === 0) return 'text';
  if (!isValidUtf8(bytes)) return 'binary';
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) {
      controls += 1;
    }
  }
  return controls * 100 > bytes.length ? 'binary' : 'text';
}

async function isAsarArchive(filePath) {
  try { listPackage(filePath, { isPack: false }); return true; }
  catch { return false; }
}

async function scanAsarPrivacy(asarPath) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  let entries;
  try {
    handle = await open(asarPath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    const pathInfo = await lstat(asarPath, { bigint: true });
    if (!before.isFile() || pathInfo.isSymbolicLink() || !sameStableFile(before, pathInfo)) {
      throw new Error('unsafe');
    }
    let headerSize;
    try {
      ({ headerSize } = getRawHeader(asarPath));
      entries = listPackage(asarPath, { isPack: false });
    } catch {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final app.asar inventory is invalid');
    }
    if (!Number.isSafeInteger(headerSize) || headerSize < 0) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final app.asar header is invalid');
    }
    if (entries.length > MAX_TREE_ENTRIES) throw privacyBlocked('app.asar privacy scan entry budget exceeded');
    const dataStart = BigInt(8 + headerSize);
    let bytesScanned = 0;
    for (const entry of entries) {
      const archiveEntry = entry.replace(/^\/+/, '');
      let info;
      try { info = statFile(asarPath, archiveEntry, false); }
      catch { throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final app.asar entry is invalid'); }
      if ('link' in info) throw privacyBlocked('final app.asar contains a symbolic link');
      if ('files' in info || info.unpacked === true) continue;
      if (!Number.isSafeInteger(info.size) || info.size < 0 || !/^\d+$/.test(String(info.offset ?? ''))) {
        throw privacyBlocked('app.asar entry size or offset is invalid');
      }
      const startBig = dataStart + BigInt(info.offset);
      const endBig = startBig + BigInt(info.size);
      if (startBig < dataStart || endBig > before.size || startBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final app.asar entry range is invalid');
      }
      const start = Number(startBig);
      const prefix = await readHandleRange(handle, start, Math.min(info.size, 4096));
      if (classifyPrivacyContent(prefix) === 'binary') continue;
      if (info.size > MAX_PRIVACY_STREAM_FILE_BYTES
          || bytesScanned + info.size > MAX_PRIVACY_SCAN_BYTES) {
        throw privacyBlocked('app.asar entry is over-budget or undecidable');
      }
      if (info.size <= MAX_PRIVACY_FILE_BYTES) {
        const bytes = await readHandleRange(handle, start, info.size);
        if (containsPrivateReport(bytes)) throw privacyBlocked('final app.asar contains private replay evidence');
      } else {
        await streamScanHandle(handle, start, info.size, 'final app.asar contains private replay evidence');
      }
      bytesScanned += info.size;
    }
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(asarPath, { bigint: true });
    if (!sameStableFile(before, after) || !sameStableFile(before, afterPath)) throw new Error('changed');
  } catch (error) {
    if (error?.code === 'BLOCKED_PRIVATE_REPLAY_LEAK' || error?.code === 'BLOCKED_ARTIFACT_IDENTITY') throw error;
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'final app.asar changed during privacy scan');
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readHandleRange(handle, position, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, position + offset);
    if (bytesRead === 0) throw new Error('changed');
    offset += bytesRead;
  }
  return bytes;
}

async function streamScanHandle(handle, position, size, leakMessage) {
  const detector = createReportTypeDetector();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  while (offset < size) {
    const length = Math.min(buffer.length, size - offset);
    const { bytesRead } = await handle.read(buffer, 0, length, position + offset);
    if (bytesRead === 0) throw new Error('changed');
    let text;
    try { text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true }); }
    catch { throw privacyBlocked('privacy scan content is undecidable'); }
    if (detector.feed(text)) throw privacyBlocked(leakMessage);
    offset += bytesRead;
  }
  try {
    if (detector.feed(decoder.decode())) throw privacyBlocked(leakMessage);
  } catch (error) {
    if (error?.code === 'BLOCKED_PRIVATE_REPLAY_LEAK') throw error;
    throw privacyBlocked('privacy scan content is undecidable');
  }
  if (detector.undecidable()) throw privacyBlocked('privacy scan reportType is incomplete or over-budget');
}

function privacyBlocked(message) {
  return blocked('BLOCKED_PRIVATE_REPLAY_LEAK', message);
}

async function readRegularFileNoLinks(filePath, maxBytes) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  const handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    const pathInfo = await lstat(filePath);
    if (!before.isFile() || pathInfo.isSymbolicLink() || before.dev !== pathInfo.dev || before.ino !== pathInfo.ino) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'identity evidence must be a stable regular file');
    }
    if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > maxBytes) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'identity evidence exceeds size limit');
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== bytes.length || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'identity evidence changed while reading');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function assertCanonicalIdentity(value) {
  if (!plainObject(value) || !Buffer.isBuffer(value.bytes) || !SHA256.test(String(value.sha256 ?? ''))
      || sha256Bytes(value.bytes) !== value.sha256) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'canonical identity bytes/SHA are invalid');
  }
}

function matrixKey(value) {
  return value.map((item) => String(item ?? '')).join('|');
}

function safeEvidencePath(value) {
  return safeRelativePath(value) && /^evidence\/artifact-identity\/[A-Za-z0-9._ -]+\.json$/.test(value);
}

function safeAsarPath(value, platform) {
  if (!safeRelativePath(value)) return false;
  const normalized = value.toLowerCase();
  if (platform === 'darwin') {
    if (normalized === 'contents/resources/app.asar') return true;
    const segments = normalized.split('/');
    return segments.length === 4
      && segments[0].endsWith('.app')
      && segments[1] === 'contents'
      && segments[2] === 'resources'
      && segments[3] === 'app.asar';
  }
  if (platform === 'win32') {
    return normalized === 'resources/app.asar' || normalized.endsWith('/resources/app.asar');
  }
  return false;
}

function artifactPathMatches(artifact) {
  const relativePath = String(artifact?.relativePath ?? '');
  const arch = artifact?.arch;
  if (artifact?.platform === 'darwin' && artifact?.kind === 'macOS ZIP') {
    return relativePath.endsWith(`-mac-${arch}.zip`);
  }
  if (artifact?.platform === 'darwin' && artifact?.kind === 'macOS DMG') {
    return relativePath.endsWith(`-mac-${arch}.dmg`);
  }
  if (artifact?.platform === 'win32' && artifact?.kind === 'Windows NSIS') {
    return relativePath.endsWith(`-win-${arch}-setup.exe`);
  }
  if (artifact?.platform === 'win32' && artifact?.kind === 'Windows Portable') {
    return relativePath.endsWith(`-win-${arch}-portable.exe`);
  }
  return false;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') || /^[a-z]:/i.test(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment));
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function canonicalPathKey(value) {
  return String(value).normalize('NFC').toLowerCase();
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function boundedLimit(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw blocked('BLOCKED_ARTIFACT_IDENTITY', 'Windows expansion limit is invalid');
  }
  return value;
}

function isSupportedWindowsPayload(filePath) {
  return WINDOWS_PAYLOAD_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeLabel(value) {
  return typeof value === 'string' ? value.replace(/[\r\n]/g, '').slice(0, 180) : '<unknown>';
}

function publicMessage(error, fallback) {
  return error && typeof error === 'object' && error.code === 'BLOCKED_ARTIFACT_IDENTITY'
    ? String(error.message).replace(/^BLOCKED_ARTIFACT_IDENTITY:\s*/, '')
    : fallback;
}

function blocked(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
