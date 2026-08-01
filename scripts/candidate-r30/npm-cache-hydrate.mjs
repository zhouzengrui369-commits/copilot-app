#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPM_CACHE_KEY_ALIGNMENT_FLAG } from './contract.mjs';

export const CACHE_HYDRATION_SCHEMA_VERSION = 1;
export const OWNER_CACHE_AUTHORITY = 'OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS';
export const NPM_REGISTRY = 'https://registry.npmjs.org/';
export const LOCKFILE_PATH = 'package-lock.json';

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ALLOWED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'registry.yarnpkg.com',
]);
const STRIPPED_ENV_KEYS = [
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_REGISTRY',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'npm_config_registry',
  'npm_config_userconfig',
  'npm_config_globalconfig',
];
const OFFLINE_PROFILE = '(version 1)\n(allow default)\n(deny network*)\n';

const isolatedNpmConfigFiles = { userConfigPath: null, globalConfigPath: null };

export class NpmCacheHydrationBlocked extends Error {
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'NpmCacheHydrationBlocked';
    this.code = code;
    this.detail = detail;
    this.context = context;
  }
}

function block(code, detail, context = {}) {
  throw new NpmCacheHydrationBlocked(code, detail, context);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    block('BLOCKED_NPM_CACHE_HYDRATION_ARGUMENT', `missing value for ${flag}`);
  }
  return value;
}

export function parseHydrationArgs(argv) {
  const parsed = {
    repository: process.cwd(),
    sourceCommit: null,
    cacheDir: null,
    receiptOutput: null,
    ownerAuthority: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--repository') parsed.repository = requiredValue(argv, ++index, token);
    else if (token === '--source-commit') parsed.sourceCommit = requiredValue(argv, ++index, token);
    else if (token === '--cache-dir') parsed.cacheDir = requiredValue(argv, ++index, token);
    else if (token === '--receipt-output') parsed.receiptOutput = requiredValue(argv, ++index, token);
    else if (token === '--owner-authority') parsed.ownerAuthority = requiredValue(argv, ++index, token);
    else block('BLOCKED_NPM_CACHE_HYDRATION_ARGUMENT', `unknown argument ${String(token)}`);
  }
  if (!FULL_COMMIT.test(parsed.sourceCommit ?? '')) {
    block('BLOCKED_NPM_CACHE_HYDRATION_COMMIT', 'source commit must be exactly 40 lower-case hex characters');
  }
  if (parsed.ownerAuthority !== OWNER_CACHE_AUTHORITY) {
    block('BLOCKED_NPM_CACHE_HYDRATION_OWNER_AUTHORITY', 'exact owner authority token is required');
  }
  for (const [name, value] of [
    ['cache dir', parsed.cacheDir],
    ['receipt output', parsed.receiptOutput],
  ]) {
    if (!value || !path.isAbsolute(value)) {
      block('BLOCKED_NPM_CACHE_HYDRATION_PATH', `${name} must be an absolute path`, { value });
    }
  }
  parsed.repository = path.resolve(parsed.repository);
  parsed.cacheDir = path.resolve(parsed.cacheDir);
  parsed.receiptOutput = path.resolve(parsed.receiptOutput);
  return parsed;
}

function commandText(command, args) {
  const quote = (value) => {
    const text = String(value);
    return /^[A-Za-z0-9_./:=@+-]+$/u.test(text)
      ? text
      : `'${text.replaceAll("'", "'\\''")}'`;
  };
  return [command, ...args].map(quote).join(' ');
}

function direct(command, args, { cwd, env }) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function git(repository, args, { allowFailure = false } = {}) {
  const result = direct('git', ['-C', repository, ...args], {
    cwd: repository,
    env: process.env,
  });
  const status = result.status ?? (result.error ? 1 : 0);
  if (!allowFailure && status !== 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_GIT', `git ${args.join(' ')} failed`, {
      status,
      stderr: (result.stderr ?? result.error?.message ?? '').trim(),
    });
  }
  return {
    status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function inside(parent, child) {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
}

export async function ensureIsolatedNpmConfigFiles({ userConfigPath, globalConfigPath }) {
  if (!userConfigPath || !path.isAbsolute(userConfigPath)) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
      'isolated user config path must be an absolute path',
      { userConfigPath },
    );
  }
  if (!globalConfigPath || !path.isAbsolute(globalConfigPath)) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
      'isolated global config path must be an absolute path',
      { globalConfigPath },
    );
  }
  if (path.resolve(userConfigPath) === path.resolve(globalConfigPath)) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
      'isolated user and global config paths must be distinct',
      { userConfigPath, globalConfigPath },
    );
  }
  if (/^\/dev\/(?:null|stdout|stderr|stdin|zero|full|random|urandom)(?:\.|$)/u.test(userConfigPath)
    || /^\/dev\/(?:null|stdout|stderr|stdin|zero|full|random|urandom)(?:\.|$)/u.test(globalConfigPath)) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
      'isolated npm config files must not reuse /dev/* devices',
      { userConfigPath, globalConfigPath },
    );
  }
  await mkdir(path.dirname(userConfigPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(globalConfigPath), { recursive: true, mode: 0o700 });
  await writeExclusive(userConfigPath, '');
  await writeExclusive(globalConfigPath, '');
  for (const file of [userConfigPath, globalConfigPath]) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      block(
        'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
        'isolated npm config must be a single-link regular file',
        { file, nlink: stat.nlink },
      );
    }
  }
  isolatedNpmConfigFiles.userConfigPath = await realpath(userConfigPath);
  isolatedNpmConfigFiles.globalConfigPath = await realpath(globalConfigPath);
  return getIsolatedNpmConfigFiles();
}

export function getIsolatedNpmConfigFiles() {
  if (!isolatedNpmConfigFiles.userConfigPath || !isolatedNpmConfigFiles.globalConfigPath) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_NPM_CONFIG_ISOLATION',
      'isolated npm config files have not been prepared',
    );
  }
  return {
    userConfigPath: isolatedNpmConfigFiles.userConfigPath,
    globalConfigPath: isolatedNpmConfigFiles.globalConfigPath,
  };
}

async function futureRealpath(target) {
  let cursor = path.resolve(target);
  const suffix = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function requireNewExternalPath(repository, target, label) {
  const [repo, future] = await Promise.all([realpath(repository), futureRealpath(target)]);
  if (inside(repo, future)) {
    block('BLOCKED_NPM_CACHE_HYDRATION_PATH', `${label} must be outside the repository`, {
      repository: repo,
      target: future,
    });
  }
  try {
    await lstat(target);
    block('BLOCKED_NPM_CACHE_HYDRATION_OUTPUT_EXISTS', `${label} already exists`, { target });
  } catch (error) {
    if (error instanceof NpmCacheHydrationBlocked) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  return future;
}

async function regularFileBytes(file, code) {
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    block(code, 'file cannot be opened without following links', {
      file,
      fsCode: error?.code ?? null,
    });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) block(code, 'path is not a regular file', { file });
    return { bytes: await handle.readFile(), size: stat.size };
  } finally {
    await handle.close();
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function collectResolvedValues(value, output = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectResolvedValues(child, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'resolved' && typeof child === 'string') output.push(child);
    else collectResolvedValues(child, output);
  }
  return output;
}

function isSafeWorkspacePackagePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  ) return false;
  const segments = value.split('/');
  return segments.length >= 2
    && (segments[0] === 'apps' || segments[0] === 'packages')
    && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function reviewedWorkspacePackagePaths(document) {
  if (
    !document.packages
    || typeof document.packages !== 'object'
    || Array.isArray(document.packages)
  ) {
    block(
      'BLOCKED_NPM_CACHE_HYDRATION_LOCKFILE',
      'package-lock.json must contain one packages object',
    );
  }
  return new Set(
    Object.entries(document.packages)
      .filter(([packagePath, entry]) => (
        isSafeWorkspacePackagePath(packagePath)
        && entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && entry.link !== true
      ))
      .map(([packagePath]) => packagePath),
  );
}

export function inspectLockfileDocument(document) {
  if (!document || typeof document !== 'object' || document.lockfileVersion !== 3) {
    block('BLOCKED_NPM_CACHE_HYDRATION_LOCKFILE', 'package-lock.json must use lockfileVersion 3');
  }
  const reviewedWorkspacePaths = reviewedWorkspacePackagePaths(document);
  const workspaceResolutions = new Set();
  const origins = new Set();
  for (const resolved of collectResolvedValues(document)) {
    if (resolved.startsWith('file:') || resolved.startsWith('workspace:')) continue;
    if (
      isSafeWorkspacePackagePath(resolved)
      && reviewedWorkspacePaths.has(resolved)
    ) {
      workspaceResolutions.add(resolved);
      continue;
    }
    let url;
    try {
      url = new URL(resolved);
    } catch {
      block('BLOCKED_NPM_CACHE_HYDRATION_LOCK_ORIGIN', 'resolved dependency is not a bounded registry URL or package-graph-bound workspace', {
        resolved,
      });
    }
    if (url.protocol !== 'https:' || url.username || url.password || !ALLOWED_REGISTRY_HOSTS.has(url.hostname)) {
      block('BLOCKED_NPM_CACHE_HYDRATION_LOCK_ORIGIN', 'resolved dependency origin is outside the reviewed registry set', {
        resolved,
        protocol: url.protocol,
        host: url.hostname,
      });
    }
    origins.add(url.origin);
  }
  if (origins.size === 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_LOCKFILE', 'package-lock.json contains no registry-resolved dependencies');
  }
  return {
    lockfileVersion: document.lockfileVersion,
    resolvedOrigins: [...origins].sort(),
    workspaceResolutions: [...workspaceResolutions].sort(),
  };
}

async function inspectLockfile(repository) {
  const file = path.join(repository, LOCKFILE_PATH);
  const { bytes, size } = await regularFileBytes(file, 'BLOCKED_NPM_CACHE_HYDRATION_LOCKFILE');
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    block('BLOCKED_NPM_CACHE_HYDRATION_LOCKFILE', 'package-lock.json is not valid JSON');
  }
  return {
    path: LOCKFILE_PATH,
    bytes: size,
    sha256: sha256(bytes),
    ...inspectLockfileDocument(document),
  };
}

async function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue.
    }
  }
  block('BLOCKED_NPM_CACHE_HYDRATION_EXECUTABLE', `${name} is not executable`);
}

export function cleanEnvironment(extra = {}) {
  const isolated = getIsolatedNpmConfigFiles();
  const env = { ...process.env };
  for (const key of STRIPPED_ENV_KEYS) delete env[key];
  return {
    ...env,
    NPM_CONFIG_USERCONFIG: isolated.userConfigPath,
    NPM_CONFIG_GLOBALCONFIG: isolated.globalConfigPath,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    ...extra,
  };
}

async function writeExclusive(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      block('BLOCKED_NPM_CACHE_HYDRATION_OUTPUT_EXISTS', 'refusing to overwrite an existing output', { file });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function runRecorded({ name, command, args, cwd, env, logRoot }) {
  const startedAt = new Date().toISOString();
  const result = direct(command, args, { cwd, env });
  const endedAt = new Date().toISOString();
  const stdoutPath = `${logRoot}.${name}.stdout.log`;
  const stderrPath = `${logRoot}.${name}.stderr.log`;
  await writeExclusive(stdoutPath, result.stdout ?? '');
  await writeExclusive(stderrPath, result.stderr ?? '');
  return {
    name,
    command: commandText(command, args),
    startedAt,
    endedAt,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    stdoutPath,
    stderrPath,
  };
}

async function runAsyncRecorded({ name, command, args, cwd, env, logRoot }) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => resolve({
      status: 1,
      signal: null,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: `${Buffer.concat(stderr).toString('utf8')}${error.message}\n`,
    }));
    child.once('close', (status, signal) => resolve({
      status,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
  const endedAt = new Date().toISOString();
  const stdoutPath = `${logRoot}.${name}.stdout.log`;
  const stderrPath = `${logRoot}.${name}.stderr.log`;
  await writeExclusive(stdoutPath, result.stdout ?? '');
  await writeExclusive(stderrPath, result.stderr ?? '');
  return {
    name,
    command: commandText(command, args),
    startedAt,
    endedAt,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    stdoutPath,
    stderrPath,
  };
}

async function startRegistryOnlyProxy() {
  const requests = [];
  const sockets = new Set();
  const server = createServer((client) => {
    sockets.add(client);
    client.once('close', () => sockets.delete(client));
    let header = Buffer.alloc(0);
    const onData = (chunk) => {
      header = Buffer.concat([header, chunk]);
      if (header.length > 16 * 1024) {
        requests.push({ method: 'INVALID', host: null, port: null, allowed: false });
        client.end('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n');
        return;
      }
      const end = header.indexOf('\r\n\r\n');
      if (end < 0) return;
      client.off('data', onData);
      const firstLine = header.subarray(0, end).toString('utf8').split('\r\n', 1)[0] ?? '';
      const match = /^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/1\.[01]$/u.exec(firstLine);
      const host = match?.[1]?.toLowerCase() ?? null;
      const port = match ? Number(match[2]) : null;
      const allowed = host === 'registry.npmjs.org' && port === 443;
      requests.push({ method: 'CONNECT', host, port, allowed });
      if (!allowed) {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const upstream = connect({ host: 'registry.npmjs.org', port: 443 });
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const remainder = header.subarray(end + 4);
        if (remainder.length) upstream.write(remainder);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.once('error', (error) => {
        if (!client.destroyed) {
          client.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${error.message}`);
        }
      });
    };
    client.on('data', onData);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    block('BLOCKED_NPM_CACHE_HYDRATION_PROXY', 'registry-only proxy did not bind a TCP port');
  }
  return {
    port: address.port,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function registryProxyProfile(port) {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow network-outbound (remote tcp "localhost:${port}"))`,
    '',
  ].join('\n');
}

export async function computeCacheIdentity(cacheDir) {
  const canonical = await realpath(cacheDir);
  const entries = [];
  async function visit(directory, relative = '') {
    const children = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const childRelative = path.posix.join(relative, child.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        block('BLOCKED_NPM_CACHE_HYDRATION_CACHE_IDENTITY', 'cache contains a symbolic link', {
          path: childRelative,
        });
      }
      if (stat.isDirectory()) {
        await visit(absolute, childRelative);
        continue;
      }
      if (!stat.isFile()) {
        block('BLOCKED_NPM_CACHE_HYDRATION_CACHE_IDENTITY', 'cache contains a non-regular entry', {
          path: childRelative,
        });
      }
      const { bytes, size } = await regularFileBytes(
        absolute,
        'BLOCKED_NPM_CACHE_HYDRATION_CACHE_IDENTITY',
      );
      entries.push({ path: childRelative, bytes: size, sha256: sha256(bytes) });
    }
  }
  await visit(canonical);
  if (entries.length === 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_CACHE_IDENTITY', 'hydrated cache is empty');
  }
  const aggregate = createHash('sha256');
  aggregate.update('npm-cache-ledger-v1\0');
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.bytes;
    aggregate.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\0`);
  }
  return {
    scope: 'npm-cache-all-regular-files-v1',
    path: canonical,
    fileCount: entries.length,
    totalBytes,
    aggregateSha256: aggregate.digest('hex'),
  };
}

export async function validateHydrationReceipt({
  repository,
  sourceCommit,
  cacheDir,
  receiptPath,
}) {
  if (!FULL_COMMIT.test(sourceCommit ?? '')) {
    block('BLOCKED_NPM_CACHE_RECEIPT_SOURCE', 'candidate source commit is invalid');
  }
  const canonicalRepository = await realpath(repository);
  const canonicalCache = await realpath(cacheDir);
  const { bytes: receiptBytes } = await regularFileBytes(
    receiptPath,
    'BLOCKED_NPM_CACHE_RECEIPT_INVALID',
  );
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    block('BLOCKED_NPM_CACHE_RECEIPT_INVALID', 'receipt is not valid JSON');
  }
  const lockfile = await inspectLockfile(canonicalRepository);
  const actualCacheIdentity = await computeCacheIdentity(canonicalCache);
  if (
    receipt?.schemaVersion !== CACHE_HYDRATION_SCHEMA_VERSION
    || receipt?.status !== 'PASS'
    || receipt?.ownerAuthority !== OWNER_CACHE_AUTHORITY
    || receipt?.sourceCommit !== sourceCommit
    || receipt?.registry !== NPM_REGISTRY
    || receipt?.lifecycleScriptsDisabled !== true
    || receipt?.automaticRetry !== false
    || receipt?.candidateCreated !== false
    || receipt?.evidenceCreated !== false
    || receipt?.offlineProbe?.status !== 'PASS'
    || receipt?.onlineHydration?.proxy?.allowedHost !== 'registry.npmjs.org'
    || receipt?.onlineHydration?.proxy?.allowedPort !== 443
    || receipt?.onlineHydration?.proxy?.allRequestsAllowed !== true
    || receipt?.lockfile?.sha256 !== lockfile.sha256
    || receipt?.cacheIdentity?.path !== canonicalCache
    || receipt?.cacheIdentity?.scope !== actualCacheIdentity.scope
    || receipt?.cacheIdentity?.fileCount !== actualCacheIdentity.fileCount
    || receipt?.cacheIdentity?.totalBytes !== actualCacheIdentity.totalBytes
    || receipt?.cacheIdentity?.aggregateSha256 !== actualCacheIdentity.aggregateSha256
  ) {
    block('BLOCKED_NPM_CACHE_RECEIPT_INVALID', 'receipt, source, lockfile, or cache identity mismatch');
  }
  return {
    receipt,
    receiptSha256: sha256(receiptBytes),
    lockfile,
    cacheIdentity: actualCacheIdentity,
  };
}

export async function hydrateNpmCache(options) {
  process.umask(0o077);
  if (process.platform !== 'darwin') {
    block('BLOCKED_NPM_CACHE_HYDRATION_PLATFORM', 'macOS is required', {
      platform: process.platform,
    });
  }
  await access('/usr/bin/sandbox-exec', fsConstants.X_OK).catch(() => {
    block('BLOCKED_NPM_CACHE_HYDRATION_SANDBOX', '/usr/bin/sandbox-exec is unavailable');
  });

  const cacheParent = path.dirname(path.resolve(options.cacheDir));
  const isolatedUserConfigPath = await requireNewExternalPath(
    options.repository,
    path.join(cacheParent, `.npmrc-user-${process.pid}-${Date.now()}`),
    'isolated user config file',
  );
  const isolatedGlobalConfigPath = await requireNewExternalPath(
    options.repository,
    path.join(cacheParent, `.npmrc-global-${process.pid}-${Date.now()}`),
    'isolated global config file',
  );
  await ensureIsolatedNpmConfigFiles({
    userConfigPath: isolatedUserConfigPath,
    globalConfigPath: isolatedGlobalConfigPath,
  });

  const repository = await realpath(options.repository);
  const insideWorktree = git(repository, ['rev-parse', '--is-inside-work-tree'], {
    allowFailure: true,
  });
  if (insideWorktree.status !== 0 || insideWorktree.stdout.trim() !== 'true') {
    block('BLOCKED_NPM_CACHE_HYDRATION_REPOSITORY', 'repository is not a Git worktree');
  }
  const actualCommit = git(repository, ['rev-parse', 'HEAD']).stdout.trim();
  const branch = git(repository, ['branch', '--show-current']).stdout.trim();
  const status = git(repository, ['status', '--porcelain=v1', '--untracked-files=all']).stdout;
  if (actualCommit !== options.sourceCommit || branch !== '' || status !== '') {
    block('BLOCKED_NPM_CACHE_HYDRATION_SOURCE', 'hydration requires the exact clean detached source commit', {
      expected: options.sourceCommit,
      actual: actualCommit,
      branch,
      status: status.replaceAll('\n', ' | '),
    });
  }
  try {
    await lstat(path.join(repository, '.npmrc'));
    block('BLOCKED_NPM_CACHE_HYDRATION_NPMRC', 'repository-local .npmrc is not allowed');
  } catch (error) {
    if (error instanceof NpmCacheHydrationBlocked) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }

  const cacheTarget = await requireNewExternalPath(repository, options.cacheDir, 'cache dir');
  const receiptTarget = await requireNewExternalPath(repository, options.receiptOutput, 'receipt output');
  options.receiptOutput = receiptTarget;
  await mkdir(path.dirname(cacheTarget), { recursive: true, mode: 0o700 });
  await mkdir(cacheTarget, { mode: 0o700 });
  const cacheDir = await realpath(cacheTarget);
  const lockfile = await inspectLockfile(repository);
  const npmExecutable = await findExecutable('npm');
  const npmVersionResult = direct(npmExecutable, ['--version'], {
    cwd: repository,
    env: cleanEnvironment(),
  });
  if ((npmVersionResult.status ?? 1) !== 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_EXECUTABLE', 'npm --version failed');
  }
  const npmVersion = (npmVersionResult.stdout ?? '').trim();
  const logRoot = options.receiptOutput.replace(/\.json$/u, '');

  const registryProxy = await startRegistryOnlyProxy();
  const proxyUrl = `http://127.0.0.1:${registryProxy.port}`;
  const onlineArgs = [
    '-p',
    registryProxyProfile(registryProxy.port),
    npmExecutable,
    'ci',
    '--ignore-scripts',
    '--cache',
    cacheDir,
    '--prefer-online',
    '--registry',
    NPM_REGISTRY,
    NPM_CACHE_KEY_ALIGNMENT_FLAG,
    '--no-audit',
    '--no-fund',
  ];
  const onlineEnv = cleanEnvironment({
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    npm_config_proxy: proxyUrl,
    npm_config_https_proxy: proxyUrl,
    npm_config_cache: cacheDir,
    npm_config_registry: NPM_REGISTRY,
    npm_config_replace_registry_host: 'always',
    npm_config_ignore_scripts: 'true',
    npm_config_prefer_online: 'true',
    npm_config_offline: 'false',
    COPILOT_NPM_CACHE_NETWORK_AUTHORITY: OWNER_CACHE_AUTHORITY,
  });
  let online;
  try {
    online = await runAsyncRecorded({
      name: 'registry-read-only-hydration',
      command: '/usr/bin/sandbox-exec',
      args: onlineArgs,
      cwd: repository,
      env: onlineEnv,
      logRoot,
    });
  } finally {
    await registryProxy.close();
  }

  await rm(path.join(repository, 'node_modules'), { recursive: true, force: true });
  if (online.exitCode !== 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_ONLINE', 'reviewed npm registry hydration failed', {
      command: online.command,
      exitCode: online.exitCode,
      stdoutPath: online.stdoutPath,
      stderrPath: online.stderrPath,
    });
  }

  const offlineArgs = offlineProbeArgs({ npmExecutable, cacheDir });
  const offlineEnv = cleanEnvironment({
    npm_config_cache: cacheDir,
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    COPILOT_NPM_CACHE_NETWORK_AUTHORITY: 'offline-probe',
  });
  const offline = await runRecorded({
    name: 'deny-network-offline-probe',
    command: '/usr/bin/sandbox-exec',
    args: offlineArgs,
    cwd: repository,
    env: offlineEnv,
    logRoot,
  });
  await rm(path.join(repository, 'node_modules'), { recursive: true, force: true });
  if (offline.exitCode !== 0) {
    block('BLOCKED_NPM_CACHE_HYDRATION_OFFLINE_PROBE', 'hydrated cache does not satisfy npm ci --offline', {
      command: offline.command,
      exitCode: offline.exitCode,
      stdoutPath: offline.stdoutPath,
      stderrPath: offline.stderrPath,
    });
  }

  const finalStatus = git(
    repository,
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ).stdout;
  if (finalStatus !== '') {
    block('BLOCKED_NPM_CACHE_HYDRATION_SOURCE', 'hydration changed tracked or untracked source', {
      status: finalStatus.replaceAll('\n', ' | '),
    });
  }
  if (
    registryProxy.requests.length === 0
    || registryProxy.requests.some((request) => request.allowed !== true)
  ) {
    block('BLOCKED_NPM_CACHE_HYDRATION_PROXY', 'registry-only proxy observed no request or a denied destination', {
      requests: registryProxy.requests,
    });
  }
  const cacheIdentity = await computeCacheIdentity(cacheDir);
  const receipt = {
    schemaVersion: CACHE_HYDRATION_SCHEMA_VERSION,
    status: 'PASS',
    ownerAuthority: OWNER_CACHE_AUTHORITY,
    authorityScope: 'single-exact-commit-public-npm-registry-read-only-cache-hydration',
    sourceCommit: options.sourceCommit,
    repository,
    registry: NPM_REGISTRY,
    registryEnforcement: 'sandbox-localhost-only-plus-registry-connect-proxy-and-reviewed-lock-origins',
    lifecycleScriptsDisabled: true,
    automaticRetry: false,
    candidateCreated: false,
    evidenceCreated: false,
    npmExecutable,
    npmVersion,
    lockfile,
    cacheIdentity,
    onlineHydration: {
      status: 'PASS',
      proxy: {
        allowedHost: 'registry.npmjs.org',
        allowedPort: 443,
        requests: registryProxy.requests,
        allRequestsAllowed: registryProxy.requests.length > 0
          && registryProxy.requests.every((request) => request.allowed === true),
      },
      ...online,
    },
    offlineProbe: { status: 'PASS', networkAuthority: 'deny-network', ...offline },
    endedAt: new Date().toISOString(),
  };
  await writeExclusive(options.receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function offlineProbeArgs({ npmExecutable, cacheDir }) {
  return [
    '-p',
    OFFLINE_PROFILE,
    npmExecutable,
    'ci',
    '--ignore-scripts',
    '--offline',
    '--cache',
    cacheDir,
    NPM_CACHE_KEY_ALIGNMENT_FLAG,
    '--no-audit',
    '--no-fund',
  ];
}

async function main() {
  try {
    const options = parseHydrationArgs(process.argv.slice(2));
    const receipt = await hydrateNpmCache(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const blocked = error instanceof NpmCacheHydrationBlocked
      ? error
      : new NpmCacheHydrationBlocked(
        'BLOCKED_NPM_CACHE_HYDRATION_UNEXPECTED',
        error instanceof Error ? error.message : String(error),
      );
    process.stderr.write(`${JSON.stringify({
      schemaVersion: CACHE_HYDRATION_SCHEMA_VERSION,
      status: 'BLOCKED',
      code: blocked.code,
      detail: blocked.detail,
      context: blocked.context,
      automaticRetry: false,
      candidateCreated: false,
      evidenceCreated: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const currentScript = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentScript) await main();
