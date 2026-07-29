import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { LocalAsrError, isExactRecord } from '../shared/local-asr';

export const LOCAL_ASR_BUNDLE_MANIFEST = 'BUNDLE-MANIFEST.json';
export const LOCAL_ASR_BUNDLE_MANIFEST_SHA256 =
  'ea1748ebba0f6d46ca4ca206d2a5c60d4a4f90c0d4657445b4a04ef20a3cece2';
export const LOCAL_ASR_NO_EGRESS_PRELOAD =
  'runtime/local-asr-no-egress-preload.cjs';

interface LocalAsrManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

interface LocalAsrManifest {
  files: LocalAsrManifestEntry[];
}

export interface VerifiedLocalAsrAssets {
  root: string;
  manifestPath: string;
  noEgressPreloadPath: string;
  fileCount: number;
  coveredBytes: number;
}

export function parseLocalAsrManifest(raw: string): LocalAsrManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }
  const files = (parsed as Record<string, unknown>).files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }

  const seen = new Set<string>();
  const normalized: LocalAsrManifestEntry[] = [];
  for (const value of files) {
    if (!isExactRecord(value, ['path', 'bytes', 'sha256'])) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    const entryPath = value.path;
    const bytes = value.bytes;
    const sha256 = value.sha256;
    if (
      !isSafeManifestPath(entryPath)
      || entryPath === LOCAL_ASR_BUNDLE_MANIFEST
      || seen.has(entryPath)
      || typeof bytes !== 'number'
      || !Number.isSafeInteger(bytes)
      || bytes < 0
      || typeof sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(sha256)
    ) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    seen.add(entryPath);
    normalized.push({ path: entryPath, bytes, sha256 });
  }
  return { files: normalized };
}

export async function verifyLocalAsrAssets(
  injectedRoot: string,
): Promise<VerifiedLocalAsrAssets> {
  if (typeof injectedRoot !== 'string' || !path.isAbsolute(injectedRoot)) {
    throw new LocalAsrError('ASSETS_UNAVAILABLE');
  }
  const root = path.resolve(injectedRoot);
  const manifestPath = path.join(root, LOCAL_ASR_BUNDLE_MANIFEST);

  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
  } catch (error) {
    if (error instanceof LocalAsrError) throw error;
    throw new LocalAsrError('ASSETS_UNAVAILABLE');
  }

  const manifestBytes = await readPinnedRegularFile(manifestPath, true);
  if (sha256(manifestBytes) !== LOCAL_ASR_BUNDLE_MANIFEST_SHA256) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }
  const manifest = parseLocalAsrManifest(manifestBytes.toString('utf8'));
  const declaredPaths = new Set(manifest.files.map((entry) => entry.path));
  if (!declaredPaths.has(LOCAL_ASR_NO_EGRESS_PRELOAD)) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }

  let coveredBytes = 0;
  for (const entry of manifest.files) {
    const absolute = path.resolve(root, ...entry.path.split('/'));
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    const bytes = await readPinnedRegularFile(absolute, false);
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    coveredBytes += bytes.byteLength;
  }

  const inventory = await collectInventory(root);
  const expectedFiles = new Set([LOCAL_ASR_BUNDLE_MANIFEST, ...declaredPaths]);
  if (
    inventory.files.size !== expectedFiles.size
    || [...inventory.files].some((entry) => !expectedFiles.has(entry))
  ) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }
  const expectedDirectories = directoryPrefixes(declaredPaths);
  if ([...inventory.directories].some((entry) => !expectedDirectories.has(entry))) {
    throw new LocalAsrError('ASSETS_TAMPERED');
  }

  return {
    root,
    manifestPath,
    noEgressPreloadPath: path.join(root, ...LOCAL_ASR_NO_EGRESS_PRELOAD.split('/')),
    fileCount: expectedFiles.size,
    coveredBytes,
  };
}

function isSafeManifestPath(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function readPinnedRegularFile(
  filePath: string,
  unavailableWhenMissing: boolean,
): Promise<Buffer> {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    return await readFile(filePath);
  } catch (error) {
    if (error instanceof LocalAsrError) throw error;
    throw new LocalAsrError(unavailableWhenMissing ? 'ASSETS_UNAVAILABLE' : 'ASSETS_TAMPERED');
  }
}

async function collectInventory(root: string): Promise<{
  files: Set<string>;
  directories: Set<string>;
}> {
  const files = new Set<string>();
  const directories = new Set<string>();

  async function visit(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = relativeDirectory
      ? path.join(root, ...relativeDirectory.split('/'))
      : root;
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      throw new LocalAsrError('ASSETS_TAMPERED');
    }
    for (const entry of entries) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolute = path.join(absoluteDirectory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new LocalAsrError('ASSETS_TAMPERED');
      if (stat.isDirectory()) {
        directories.add(relative);
        await visit(relative);
      } else if (stat.isFile() && stat.nlink === 1) {
        files.add(relative);
      } else {
        throw new LocalAsrError('ASSETS_TAMPERED');
      }
    }
  }

  await visit('');
  return { files, directories };
}

function directoryPrefixes(paths: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const entry of paths) {
    const segments = entry.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      result.add(segments.slice(0, index).join('/'));
    }
  }
  return result;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
