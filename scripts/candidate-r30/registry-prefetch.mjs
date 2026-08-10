import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';
import { NPM_REGISTRY, blockNativeCache } from './native-cache-policy.mjs';

export const NATIVE_REGISTRY_PREFETCH_STRATEGY =
  'lockfile-batched-name-version-npm-pack-v2';
export const NATIVE_REGISTRY_PREFETCH_BATCH_SIZE = 24;
export const NATIVE_REGISTRY_PREFETCH_MAX_SOCKETS = 12;
export const NATIVE_REGISTRY_CLOSURE_STRATEGY =
  'deny-network-offline-ci-ignore-scripts-v1';
export const NATIVE_REGISTRY_CLOSURE_COMPLETENESS =
  'root-unique-exact-specs-covered-v1';

const REVIEWED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'registry.yarnpkg.com',
]);
const CANONICAL_REGISTRY = new URL(NPM_REGISTRY);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const LOCKED_IDENTITY = 'lockfile-resolved-integrity';
const SUPPLEMENTAL_IDENTITY = 'tracked-supplemental-lock';
const EXACT_VERSION_ONLY_IDENTITY = 'root-lock-exact-version-only';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validPackageName(name) {
  return Boolean(
    typeof name === 'string'
    && name.length > 0
    && !name.includes('\\')
    && !name.includes('..')
    && !/\s/u.test(name)
    && (
      (!name.startsWith('@') && !name.includes('/'))
      || (name.startsWith('@') && /^@[^/]+\/[^/]+$/u.test(name))
    )
  );
}

function canonicalRegistryTarball(resolved) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !REVIEWED_REGISTRY_HOSTS.has(url.hostname)
  ) {
    return null;
  }
  url.protocol = CANONICAL_REGISTRY.protocol;
  url.hostname = CANONICAL_REGISTRY.hostname;
  url.port = '';
  return url.toString();
}

function packageNameFromRegistryTarball(resolved) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  const marker = '/-/';
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex <= 1) return null;
  let name;
  try {
    name = decodeURIComponent(url.pathname.slice(1, markerIndex));
  } catch {
    return null;
  }
  return validPackageName(name) ? name : null;
}

function packageNameFromLockfilePath(packagePath) {
  if (typeof packagePath !== 'string' || packagePath.length === 0) return null;
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const tail = packagePath.slice(markerIndex + marker.length);
  if (!tail || tail.includes('\\') || tail.includes('..') || /\s/u.test(tail)) return null;
  const parts = tail.split('/');
  if (tail.startsWith('@')) {
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || null;
}

function packageNameFromLockfileEntry(packagePath, entry) {
  const pathName = packageNameFromLockfilePath(packagePath);
  if (!pathName) return null;
  const lockedName = typeof entry?.name === 'string' ? entry.name : '';
  if (lockedName) {
    if (!validPackageName(lockedName)) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
        'lockfile package name is invalid',
        { packagePath, name: lockedName },
      );
    }
    return lockedName;
  }
  return pathName;
}

function requireLockfileV3(lockfileDocument, label = 'package-lock') {
  if (
    !lockfileDocument
    || typeof lockfileDocument !== 'object'
    || lockfileDocument.lockfileVersion !== 3
    || !lockfileDocument.packages
    || typeof lockfileDocument.packages !== 'object'
    || Array.isArray(lockfileDocument.packages)
  ) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      `${label} v3 packages object is required for registry prefetch`,
    );
  }
}

function requireAbsoluteRepositoryRoot(repositoryRoot, source) {
  if (
    typeof repositoryRoot !== 'string'
    || repositoryRoot.length === 0
    || !path.isAbsolute(repositoryRoot)
  ) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      `registry prefetch requires one absolute repository root from ${source}`,
      { repositoryRoot: repositoryRoot ?? null, source },
    );
  }
  return path.resolve(repositoryRoot);
}

export function repositoryRootFromHydrationArgv(argv = process.argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repository') {
      values.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (typeof value === 'string' && value.startsWith('--repository=')) {
      values.push(value.slice('--repository='.length));
    }
  }
  if (values.length !== 1) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch requires exactly one --repository hydration argument',
      { repositoryArgumentCount: values.length },
    );
  }
  return requireAbsoluteRepositoryRoot(values[0], 'hydrator --repository');
}

function trackedSupplementalLockfileDocuments(repositoryRoot) {
  const sourceRepositoryRoot = repositoryRoot === undefined
    ? repositoryRootFromHydrationArgv()
    : requireAbsoluteRepositoryRoot(repositoryRoot, 'explicit repositoryRoot');
  const result = spawnSync(
    'git',
    ['-C', sourceRepositoryRoot, 'ls-files', '--', ':(glob)**/package-lock.json'],
    {
      cwd: sourceRepositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if ((result.status ?? 1) !== 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'unable to enumerate tracked supplemental package-lock files',
      {
        repositoryRoot: sourceRepositoryRoot,
        stderr: (result.stderr ?? result.error?.message ?? '').trim(),
      },
    );
  }
  const lockfiles = (result.stdout ?? '')
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value && value !== 'package-lock.json')
    .sort();
  return lockfiles.map((relativePath) => {
    try {
      return JSON.parse(readFileSync(path.join(sourceRepositoryRoot, relativePath), 'utf8'));
    } catch (error) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
        'tracked supplemental package-lock must be readable JSON',
        {
          repositoryRoot: sourceRepositoryRoot,
          relativePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  });
}

function registryIdentityFromEntry(packagePath, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const rawResolved = typeof entry.resolved === 'string' ? entry.resolved : '';
  if (!rawResolved) return null;
  if (
    rawResolved.startsWith('file:')
    || rawResolved.startsWith('workspace:')
    || (!rawResolved.includes('://') && !rawResolved.startsWith('https:'))
  ) return null;

  const resolved = canonicalRegistryTarball(rawResolved);
  if (!resolved) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ORIGIN',
      'registry prefetch encountered a non-reviewed remote dependency',
      { packagePath, resolved: rawResolved },
    );
  }
  const integrity = typeof entry.integrity === 'string' ? entry.integrity : '';
  if (!/^sha(?:256|384|512)-[A-Za-z0-9+/=_-]+$/u.test(integrity)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_INTEGRITY',
      'registry tarball must have an exact lockfile integrity',
      { packagePath, resolved },
    );
  }
  const name = packageNameFromRegistryTarball(resolved);
  const version = typeof entry.version === 'string' ? entry.version : '';
  if (!name || !EXACT_VERSION.test(version)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
      'registry dependency must map to one exact name@version spec',
      { packagePath, resolved, name, version },
    );
  }
  return {
    name,
    version,
    spec: `${name}@${version}`,
    resolved,
    integrity,
    identitySource: LOCKED_IDENTITY,
  };
}

function exactVersionOnlyIdentity(packagePath, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.link === true) return null;
  const name = packageNameFromLockfileEntry(packagePath, entry);
  const version = typeof entry.version === 'string' ? entry.version : '';
  if (!name || !EXACT_VERSION.test(version)) return null;
  return {
    name,
    version,
    spec: `${name}@${version}`,
    resolved: null,
    integrity: null,
    identitySource: EXACT_VERSION_ONLY_IDENTITY,
  };
}

function hasLockedRegistryIdentity(identity) {
  return Boolean(
    identity
    && typeof identity.resolved === 'string'
    && identity.resolved.length > 0
    && typeof identity.integrity === 'string'
    && identity.integrity.length > 0
  );
}

function addRegistryIdentity(bySpec, identity) {
  const existing = bySpec.get(identity.spec);
  if (!existing) {
    bySpec.set(identity.spec, identity);
    return;
  }

  const existingLocked = hasLockedRegistryIdentity(existing);
  const incomingLocked = hasLockedRegistryIdentity(identity);
  if (
    existingLocked
    && incomingLocked
    && (existing.integrity !== identity.integrity || existing.resolved !== identity.resolved)
  ) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_INTEGRITY',
      'one exact name@version maps to conflicting lockfile registry identity',
      {
        spec: identity.spec,
        left: { resolved: existing.resolved, integrity: existing.integrity },
        right: { resolved: identity.resolved, integrity: identity.integrity },
      },
    );
  }
  if (!existingLocked && incomingLocked) bySpec.set(identity.spec, identity);
}

function supplementalRegistryIdentityIndex(supplementalLockfileDocuments) {
  if (!Array.isArray(supplementalLockfileDocuments)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'supplemental package-lock inputs must be an array',
    );
  }
  const bySpec = new Map();
  for (let index = 0; index < supplementalLockfileDocuments.length; index += 1) {
    const document = supplementalLockfileDocuments[index];
    requireLockfileV3(document, `supplemental package-lock ${index + 1}`);
    for (const [packagePath, entry] of Object.entries(document.packages)) {
      const identity = registryIdentityFromEntry(packagePath, entry);
      if (identity) addRegistryIdentity(bySpec, identity);
    }
  }
  return bySpec;
}

export function buildRegistryPrefetchManifest(
  lockfileDocument,
  supplementalLockfileDocuments,
  options = {},
) {
  requireLockfileV3(lockfileDocument);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch options must be an object',
    );
  }
  const supplements = supplementalLockfileDocuments === undefined
    ? trackedSupplementalLockfileDocuments(options.repositoryRoot)
    : supplementalLockfileDocuments;
  const supplementalBySpec = supplementalRegistryIdentityIndex(supplements);
  const bySpec = new Map();
  const rootClosureSpecs = new Set();
  let supplementalIdentityCount = 0;
  let exactVersionOnlyIdentityCount = 0;

  for (const [packagePath, entry] of Object.entries(lockfileDocument.packages)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.link === true) continue;

    const exactOnly = exactVersionOnlyIdentity(packagePath, entry);
    if (exactOnly) rootClosureSpecs.add(exactOnly.spec);

    const identity = registryIdentityFromEntry(packagePath, entry);
    if (identity) {
      addRegistryIdentity(bySpec, identity);
      continue;
    }

    if (!exactOnly) continue;
    const supplemental = supplementalBySpec.get(exactOnly.spec);
    if (supplemental) {
      addRegistryIdentity(bySpec, {
        ...supplemental,
        identitySource: SUPPLEMENTAL_IDENTITY,
      });
      supplementalIdentityCount += 1;
      continue;
    }

    addRegistryIdentity(bySpec, exactOnly);
    exactVersionOnlyIdentityCount += 1;
  }

  const missingRootSpecs = [...rootClosureSpecs]
    .filter((spec) => !bySpec.has(spec))
    .sort();
  if (missingRootSpecs.length > 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch manifest does not cover every root lock exact closure spec',
      {
        completenessMode: NATIVE_REGISTRY_CLOSURE_COMPLETENESS,
        rootClosureSpecCount: rootClosureSpecs.size,
        coveredSpecCount: bySpec.size,
        missingRootSpecs,
      },
    );
  }

  const entries = [...bySpec.values()]
    .sort((left, right) => left.spec.localeCompare(right.spec));
  if (entries.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'package-lock contains no registry packages to prefetch',
    );
  }
  if (entries.length !== rootClosureSpecs.size) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch manifest cardinality differs from root exact closure spec cardinality',
      {
        completenessMode: NATIVE_REGISTRY_CLOSURE_COMPLETENESS,
        rootClosureSpecCount: rootClosureSpecs.size,
        entryCount: entries.length,
      },
    );
  }

  const canonical = `${entries
    .map((entry) => [
      entry.spec,
      entry.identitySource,
      entry.resolved ?? '<registry-resolution-by-exact-spec>',
      entry.integrity ?? '<integrity-not-present-in-lockfile>',
    ].join('\0'))
    .join('\n')}\n`;
  return {
    strategy: NATIVE_REGISTRY_PREFETCH_STRATEGY,
    metadataMode: 'name-version-packument-and-tarball',
    completenessMode: NATIVE_REGISTRY_CLOSURE_COMPLETENESS,
    rootClosureSpecCount: rootClosureSpecs.size,
    coveredRootClosureSpecCount: entries.length,
    entryCount: entries.length,
    supplementalLockfileCount: supplements.length,
    supplementalIdentityCount,
    exactVersionOnlyIdentityCount,
    manifestSha256: sha256(canonical),
    entries,
  };
}

export function registryPrefetchBatches(
  manifest,
  batchSize = NATIVE_REGISTRY_PREFETCH_BATCH_SIZE,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_BATCH',
      'registry prefetch batch size must be an integer from 1 to 64',
      { batchSize },
    );
  }
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (entries.length !== manifest?.entryCount || entries.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch manifest entry count is inconsistent',
    );
  }
  if (
    manifest?.completenessMode === NATIVE_REGISTRY_CLOSURE_COMPLETENESS
    && manifest?.rootClosureSpecCount !== entries.length
  ) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'registry prefetch batches require complete root exact-spec coverage',
      {
        rootClosureSpecCount: manifest?.rootClosureSpecCount ?? null,
        entryCount: entries.length,
      },
    );
  }
  const batches = [];
  for (let index = 0; index < entries.length; index += batchSize) {
    batches.push(entries.slice(index, index + batchSize));
  }
  return batches;
}

export function registryPrefetchBatchArgs({
  npmExecutable,
  npmCacheDir,
  packDestination,
  entries,
}) {
  const checkedEntries = Array.isArray(entries) ? entries : [];
  if (!npmExecutable || !npmCacheDir || !packDestination || checkedEntries.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ARGUMENT',
      'registry prefetch requires npm, cache, destination and at least one exact package',
    );
  }
  const specs = checkedEntries.map((entry) => {
    if (
      !entry
      || typeof entry.name !== 'string'
      || typeof entry.version !== 'string'
      || entry.spec !== `${entry.name}@${entry.version}`
      || !EXACT_VERSION.test(entry.version)
    ) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
        'prefetch batch contains an incomplete name@version registry identity',
        { entry },
      );
    }

    const exactVersionOnly = entry.identitySource === EXACT_VERSION_ONLY_IDENTITY;
    if (exactVersionOnly) {
      if (entry.resolved !== null || entry.integrity !== null) {
        blockNativeCache(
          'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
          'exact-version-only prefetch identity must not invent resolved or integrity',
          { entry },
        );
      }
      return entry.spec;
    }

    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
        'locked prefetch identity requires resolved and integrity',
        { entry },
      );
    }
    const canonical = canonicalRegistryTarball(entry.resolved);
    if (!canonical || canonical !== entry.resolved) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ORIGIN',
        'prefetch batch contains a noncanonical registry tarball',
        { spec: entry.spec, resolved: entry.resolved },
      );
    }
    if (!/^sha(?:256|384|512)-[A-Za-z0-9+/=_-]+$/u.test(entry.integrity)) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_INTEGRITY',
        'locked prefetch identity requires a valid integrity',
        { spec: entry.spec, integrity: entry.integrity },
      );
    }
    return entry.spec;
  });
  return [
    npmExecutable,
    'pack',
    '--ignore-scripts',
    '--json',
    '--cache',
    npmCacheDir,
    NPM_CACHE_KEY_ALIGNMENT_FLAG,
    '--no-audit',
    '--no-fund',
    `--maxsockets=${NATIVE_REGISTRY_PREFETCH_MAX_SOCKETS}`,
    '--prefer-online',
    '--pack-destination',
    packDestination,
    '--registry',
    NPM_REGISTRY,
    ...specs,
  ];
}

export function registryCacheClosureArgs({ npmExecutable, npmCacheDir }) {
  if (!npmExecutable || !npmCacheDir) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CLOSURE_ARGUMENT',
      'registry cache closure proof requires npm and an isolated cache',
    );
  }
  return [
    npmExecutable,
    'ci',
    '--cache',
    npmCacheDir,
    NPM_CACHE_KEY_ALIGNMENT_FLAG,
    '--no-audit',
    '--no-fund',
    '--offline',
    '--ignore-scripts',
  ];
}
