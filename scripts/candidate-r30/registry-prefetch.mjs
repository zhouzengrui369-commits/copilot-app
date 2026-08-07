import { createHash } from 'node:crypto';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';
import { NPM_REGISTRY, blockNativeCache } from './native-cache-policy.mjs';

export const NATIVE_REGISTRY_PREFETCH_STRATEGY = 'lockfile-batched-npm-pack-v1';
export const NATIVE_REGISTRY_PREFETCH_BATCH_SIZE = 24;

const REVIEWED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'registry.yarnpkg.com',
]);
const CANONICAL_REGISTRY = new URL(NPM_REGISTRY);

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

export function buildRegistryPrefetchManifest(lockfileDocument) {
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
      'package-lock v3 packages object is required for registry prefetch',
    );
  }

  const byResolved = new Map();
  for (const [packagePath, entry] of Object.entries(lockfileDocument.packages)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rawResolved = typeof entry.resolved === 'string' ? entry.resolved : '';
    if (!rawResolved) continue;
    if (
      rawResolved.startsWith('file:')
      || rawResolved.startsWith('workspace:')
      || (!rawResolved.includes('://') && !rawResolved.startsWith('https:'))
    ) continue;

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
    const existing = byResolved.get(resolved);
    if (existing && existing.integrity !== integrity) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_INTEGRITY',
        'one registry tarball URL maps to conflicting lockfile integrities',
        { resolved, left: existing.integrity, right: integrity },
      );
    }
    if (!existing) byResolved.set(resolved, { resolved, integrity });
  }

  const entries = [...byResolved.values()]
    .sort((left, right) => left.resolved.localeCompare(right.resolved));
  if (entries.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST',
      'package-lock contains no registry tarballs to prefetch',
    );
  }
  const canonical = `${entries.map((entry) => `${entry.resolved}\0${entry.integrity}`).join('\n')}\n`;
  return {
    strategy: NATIVE_REGISTRY_PREFETCH_STRATEGY,
    entryCount: entries.length,
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
  const specs = (Array.isArray(entries) ? entries : []).map((entry) => entry?.resolved);
  if (!npmExecutable || !npmCacheDir || !packDestination || specs.length === 0) {
    blockNativeCache(
      'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ARGUMENT',
      'registry prefetch requires npm, cache, destination and at least one exact tarball',
    );
  }
  for (const spec of specs) {
    let url;
    try {
      url = new URL(spec);
    } catch {
      url = null;
    }
    if (
      !url
      || url.protocol !== 'https:'
      || url.hostname !== CANONICAL_REGISTRY.hostname
      || url.username
      || url.password
    ) {
      blockNativeCache(
        'BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_ORIGIN',
        'prefetch batch contains a noncanonical registry tarball',
        { spec },
      );
    }
  }
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
    '--pack-destination',
    packDestination,
    '--registry',
    NPM_REGISTRY,
    ...specs,
  ];
}
