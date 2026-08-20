#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ELECTRON_ARTIFACT_PREFETCH_STRATEGY =
  'official-electron-embedded-sha256-bounded-range-v1';
export const ELECTRON_ARTIFACT_PREFETCH_PHASE = 'electron-artifact-range-prefetch';
export const ELECTRON_ARTIFACT_RANGE_BYTES = 1_024 * 1_024;
export const ELECTRON_ARTIFACT_RANGE_CONCURRENCY = 4;
export const ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS = 3;
export const ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS = 10 * 60 * 1_000;
export const ELECTRON_ARTIFACT_MAX_BYTES = 512 * 1_024 * 1_024;
export const ELECTRON_ARTIFACT_PACKAGE_PATHS = Object.freeze([
  'apps/copilot-desktop/node_modules/electron',
  'node_modules/electron',
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const RETRYABLE_RANGE_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

function boundedInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function rangeProtocolError(message) {
  return Object.assign(new Error(message), { code: 'ERANGE_PROTOCOL' });
}

function parseContentRange(value, expectedStart, expectedEnd) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(String(value ?? ''));
  if (!match) throw rangeProtocolError('Electron asset response lacks an exact Content-Range');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  boundedInteger(total, 'Electron artifact total bytes', { max: ELECTRON_ARTIFACT_MAX_BYTES });
  if (start !== expectedStart || end !== expectedEnd || end >= total) {
    throw rangeProtocolError(
      `Electron artifact Content-Range mismatch: expected ${expectedStart}-${expectedEnd}, got ${start}-${end}/${total}`,
    );
  }
  return total;
}

export function createGotRangeFetcher(got) {
  if (typeof got?.stream !== 'function') throw new TypeError('got.stream is required');
  return async function fetchRange(url, start, end) {
    const expectedBytes = end - start + 1;
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      let total = null;
      let settled = false;
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const stream = got.stream(url, {
        decompress: false,
        headers: {
          'accept-encoding': 'identity',
          range: `bytes=${start}-${end}`,
        },
        retry: { limit: 0 },
        timeout: { request: ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS },
      });
      stream.once('response', (response) => {
        try {
          if (response.statusCode !== 206) {
            throw rangeProtocolError(
              `Electron asset range request returned HTTP ${String(response.statusCode)}`,
            );
          }
          total = parseContentRange(response.headers['content-range'], start, end);
          const contentLength = Number(response.headers['content-length']);
          if (contentLength !== expectedBytes) {
            throw rangeProtocolError(
              `Electron asset range length mismatch: expected ${expectedBytes}, got ${String(contentLength)}`,
            );
          }
        } catch (error) {
          stream.destroy(error);
        }
      });
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > expectedBytes) {
          stream.destroy(rangeProtocolError('Electron asset range exceeded its declared bound'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      stream.once('error', finishReject);
      stream.once('end', () => {
        if (settled) return;
        if (total === null || bytes !== expectedBytes) {
          finishReject(rangeProtocolError(
            `Electron asset range ended at ${bytes} bytes; expected ${expectedBytes}`,
          ));
          return;
        }
        settled = true;
        resolve({ body: Buffer.concat(chunks), total });
      });
    });
  };
}

async function fetchRangeWithAttempts({ fetchRange, url, start, end, maxAttempts }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fetchRange(url, start, end);
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RANGE_CODES.has(error?.code) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

export async function downloadElectronArtifactInRanges({
  url,
  targetFilePath,
  fetchRange,
  rangeBytes = ELECTRON_ARTIFACT_RANGE_BYTES,
  concurrency = ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
  maxAttempts = ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
}) {
  if (typeof url !== 'string' || !url.startsWith('https://github.com/electron/electron/releases/download/')) {
    throw new Error('Electron artifact URL is not the exact official release origin');
  }
  if (!path.isAbsolute(targetFilePath)) throw new Error('Electron artifact target must be absolute');
  if (typeof fetchRange !== 'function') throw new TypeError('fetchRange is required');
  boundedInteger(rangeBytes, 'rangeBytes', { max: 8 * 1_024 * 1_024 });
  boundedInteger(concurrency, 'concurrency', { max: 4 });
  boundedInteger(maxAttempts, 'maxAttempts', { max: 3 });

  const metadata = await fetchRangeWithAttempts({
    fetchRange,
    url,
    start: 0,
    end: 0,
    maxAttempts,
  });
  const total = boundedInteger(metadata.total, 'Electron artifact total bytes', {
    max: ELECTRON_ARTIFACT_MAX_BYTES,
  });
  const ranges = [];
  for (let start = 0; start < total; start += rangeBytes) {
    ranges.push({ start, end: Math.min(total - 1, start + rangeBytes - 1) });
  }

  await mkdir(path.dirname(targetFilePath), { recursive: true, mode: 0o700 });
  const handle = await open(targetFilePath, 'wx', 0o600);
  let requestCount = metadata.attempts;
  let retryCount = metadata.attempts - 1;
  try {
    for (let index = 0; index < ranges.length; index += concurrency) {
      const batch = ranges.slice(index, index + concurrency);
      const results = await Promise.all(batch.map(({ start, end }) => fetchRangeWithAttempts({
        fetchRange,
        url,
        start,
        end,
        maxAttempts,
      })));
      for (let offset = 0; offset < results.length; offset += 1) {
        const expected = batch[offset].end - batch[offset].start + 1;
        if (results[offset].total !== total || results[offset].body.length !== expected) {
          throw rangeProtocolError('Electron artifact range result changed total or length');
        }
        await handle.write(results[offset].body);
        requestCount += results[offset].attempts;
        retryCount += results[offset].attempts - 1;
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const written = await stat(targetFilePath);
  if (!written.isFile() || written.size !== total) {
    throw rangeProtocolError(`Electron artifact final size mismatch: ${written.size}/${total}`);
  }
  return {
    bytes: total,
    rangeCount: ranges.length,
    requestCount,
    retryCount,
  };
}

export class BoundedElectronArtifactDownloader {
  constructor({ got, expectedUrl }) {
    this.fetchRange = createGotRangeFetcher(got);
    this.expectedUrl = expectedUrl;
    this.report = null;
  }

  async download(url, targetFilePath) {
    if (url !== this.expectedUrl) throw new Error('Electron artifact resolved URL changed');
    this.report = await downloadElectronArtifactInRanges({
      url,
      targetFilePath,
      fetchRange: this.fetchRange,
    });
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredArg(argv, flag) {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value || value.startsWith('--')) throw new Error(`missing ${flag}`);
  return path.resolve(value);
}

async function main(argv) {
  const repository = await realpath(requiredArg(argv, '--repository'));
  const cacheRoot = await realpath(requiredArg(argv, '--cache-root'));
  const requireFromRepository = createRequire(path.join(repository, 'package.json'));
  const { downloadArtifact } = requireFromRepository('@electron/get');
  const got = requireFromRepository('got');
  const artifacts = [];
  const tempDirectory = path.join(cacheRoot, '.bounded-range-temp');
  await mkdir(tempDirectory, { recursive: true, mode: 0o700 });

  for (const packagePath of ELECTRON_ARTIFACT_PACKAGE_PATHS) {
    const packageRoot = path.join(repository, packagePath);
    const packageDocument = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const checksums = JSON.parse(await readFile(path.join(packageRoot, 'checksums.json'), 'utf8'));
    const version = String(packageDocument.version ?? '');
    if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`invalid Electron version at ${packagePath}`);
    const fileName = `electron-v${version}-darwin-arm64.zip`;
    const expectedSha256 = String(checksums[fileName] ?? '');
    if (!SHA256.test(expectedSha256)) throw new Error(`missing embedded checksum for ${fileName}`);
    const sourceUrl = `https://github.com/electron/electron/releases/download/v${version}/${fileName}`;
    const downloader = new BoundedElectronArtifactDownloader({ got, expectedUrl: sourceUrl });
    const cachePath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: 'darwin',
      arch: 'arm64',
      cacheRoot,
      tempDirectory,
      checksums,
      downloader,
    });
    const bytes = await readFile(cachePath);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== expectedSha256) throw new Error(`post-cache checksum mismatch for ${fileName}`);
    artifacts.push({
      packagePath,
      version,
      fileName,
      sourceUrl,
      cachePath,
      bytes: bytes.length,
      sha256: actualSha256,
      ...downloader.report,
    });
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: 'PASS',
    strategy: ELECTRON_ARTIFACT_PREFETCH_STRATEGY,
    platform: 'darwin',
    arch: 'arm64',
    rangeBytes: ELECTRON_ARTIFACT_RANGE_BYTES,
    concurrency: ELECTRON_ARTIFACT_RANGE_CONCURRENCY,
    maxAttemptsPerRange: ELECTRON_ARTIFACT_RANGE_MAX_ATTEMPTS,
    requestTimeoutMs: ELECTRON_ARTIFACT_RANGE_TIMEOUT_MS,
    automaticHydrationRetry: false,
    partialCacheReuse: false,
    artifacts,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
