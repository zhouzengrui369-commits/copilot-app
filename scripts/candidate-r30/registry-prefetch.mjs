import { createHash } from 'node:crypto';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';
import { NPM_REGISTRY, blockNativeCache } from './native-cache-policy.mjs';

export const NATIVE_REGISTRY_PREFETCH_STRATEGY =
  'lockfile-batched-name-version-npm-pack-v2';
export const NATIVE_REGISTRY_PREFETCH_BATCH_SIZE = 24;
export const NATIVE_REGISTRY_CLOSURE_STRATEGY =
  'deny-network-offline-ci-ignore-scripts-v1';

const REVIEWED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'registry.yarnpkg.com',
]);
const CANONICAL_REGISTRY = new URL(NPM_REGISTRY);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
  if (
    name.length === 0
    || name.includes('\\')
    || name.includes('..')
    || /\s/u.test(name)
    || (!name.startsWith('@') && name.includes('/'))
    || (name.startsWith('@') && !/^@[^/]+\/[^/]+$/u.test(name))
  ) {
    return null;
  }
  return name;
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
  };
}

function addRegistryIdentity(bySpec, identity) {
  const existing = bySpec.get(identity.spec);
  if (
    existing
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
  if (!existing) bySpec.set(identity.spec, identity);
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
  supplementalLockfileDocuments = [],
) {
  requireLockfileV3(lockfileDocument);
  const supplementalBySpec = supplementalRegistryIdentityIndex(supplementalLockfileDocuments);
  const bySpec = new Map();
  let supplementalIdentityCount = 0;

  for (const [packagePath, entry] of Object.entries(lockfileDocument.packages)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const identity = registryIdentityFromEntry(packagePath, entry);
    if (identity) {
      addRegistryIdentity(bySpec, identity);
      continue;
    }

    if (entry.link === true) continue;
    const version = typeof entry.version === 'string' ? entry.version : '';
    const name = packageNameFromLockfilePath(packagePath);
    if (!name || !EXACT_VERSION.test(version)) continue;
    const spec = `${name}@${version}`;
    const supplemental = supplementalBySpec.get(spec);
    if (!supplemental || bySpec.has(spec)) continue;
    addRegistryIdentity(bySpec, supplemental);
    supplementalIdentityCount += 1;
  }

  const entries = [...bySpec.values()]
    .sort((left, right) => left.spec.localeCompare(right.spec));
  if (entries.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'package-lock contains no registry packages to prefetch',
    );
  }
  const canonical = `${entries
    .map((entry) => `${entry.spec}\0${entry.resolved}\0${entry.integrity}`)
    .join('\n')}\n`;
  return {
    strategy: NATIVE_REGISTRY_PREFETCH_STRATEGY,
    metadataMode: 'name-version-packument-and-tarball',
    entryCount: entries.length,
    supplementalLockfileCount: supplementalLockfileDocuments.length,
    supplementalIdentityCount,
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
      || typeof entry.resolved !== 'string'
      || typeof entry.integrity !== 'string'
    ) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_SPEC',
        'prefetch batch contains an incomplete name@version registry identity',
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
