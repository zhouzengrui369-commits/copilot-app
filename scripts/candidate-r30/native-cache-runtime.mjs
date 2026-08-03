import { constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { cleanEnvironment, ensureIsolatedNpmConfigFiles } from './npm-cache-hydrate.mjs';
import {
  NATIVE_HYDRATION_HOSTS,
  NATIVE_TOOLCHAIN_PROFILE,
  NATIVE_BUILD_MODE,
  OWNER_NATIVE_CACHE_AUTHORITY,
  NativeCacheHydrationBlocked,
  blockNativeCache,
  nativeCacheLayout,
  nativeRebuildArgs,
} from './native-cache-policy.mjs';

export const OFFLINE_PROFILE = '(version 1)\n(allow default)\n(deny network*)\n';

const NATIVE_STRIPPED_ENV_KEYS = Object.freeze([
  'ELECTRON_MIRROR',
  'ELECTRON_CUSTOM_DIR',
  'ELECTRON_CUSTOM_FILENAME',
  'ELECTRON_GET_USE_PROXY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NODE_PRE_GYP_GITHUB_TOKEN',
  'npm_config_disturl',
  'npm_config_nodedir',
  'npm_config_target',
  'npm_config_runtime',
  'npm_config_arch',
  'npm_config_node_gyp',
]);

function cleanNativeEnvironment(extra) {
  const env = cleanEnvironment();
  for (const key of NATIVE_STRIPPED_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
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

export function gitNative(repository, args, { allowFailure = false } = {}) {
  const result = direct('git', ['-C', repository, ...args], {
    cwd: repository,
    env: process.env,
  });
  const status = result.status ?? (result.error ? 1 : 0);
  if (!allowFailure && status !== 0) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_GIT', `git ${args.join(' ')} failed`, {
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

export async function requireNewExternalPath(repository, target, label) {
  const [repo, future] = await Promise.all([realpath(repository), futureRealpath(target)]);
  if (inside(repo, future)) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PATH', `${label} must be outside repository`, {
      repository: repo,
      target: future,
    });
  }
  try {
    await lstat(target);
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS', `${label} already exists`, {
      target,
    });
  } catch (error) {
    if (error instanceof NativeCacheHydrationBlocked) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  return future;
}

export async function writeExclusiveNative(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(
      file,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS', 'refusing to overwrite output', {
        file,
      });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function runAsyncRecordedNative({ name, command, args, cwd, env, logRoot }) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const receipt = {
    name,
    command: commandText(command, args),
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    stdoutPath: `${logRoot}.${name}.stdout.log`,
    stderrPath: `${logRoot}.${name}.stderr.log`,
  };
  await writeExclusiveNative(receipt.stdoutPath, result.stdout ?? '');
  await writeExclusiveNative(receipt.stderrPath, result.stderr ?? '');
  return receipt;
}

export function nativeHydrationProxyProfile(port) {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow network-outbound (remote tcp "localhost:${port}"))`,
    '',
  ].join('\n');
}

export async function startAllowlistedConnectProxy(hosts = NATIVE_HYDRATION_HOSTS) {
  const allowedHosts = new Set(hosts.map((host) => host.toLowerCase()));
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
      const allowed = Boolean(host) && allowedHosts.has(host) && port === 443;
      requests.push({ method: 'CONNECT', host, port, allowed });
      if (!allowed) {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const upstream = connect({ host, port: 443 });
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
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PROXY', 'proxy did not bind a TCP port');
  }
  return {
    port: address.port,
    requests,
    allowedHosts: [...allowedHosts].sort(),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function verifyProxyAudit(proxy) {
  if (proxy.requests.length === 0 || proxy.requests.some((request) => request.allowed !== true)) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PROXY', 'proxy observed no request or a denied destination', {
      allowedHosts: proxy.allowedHosts,
      requests: proxy.requests,
    });
  }
}

export async function prepareNativeCacheLayout(repository, cacheTarget) {
  await mkdir(path.dirname(cacheTarget), { recursive: true, mode: 0o700 });
  await mkdir(cacheTarget, { mode: 0o700 });
  const root = await realpath(cacheTarget);
  const layout = nativeCacheLayout(root);
  for (const target of Object.values(layout)) await mkdir(target, { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, 'home'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, 'xdg-cache'), { recursive: true, mode: 0o700 });
  await ensureIsolatedNpmConfigFiles({
    userConfigPath: path.join(root, 'npm-config/user.npmrc'),
    globalConfigPath: path.join(root, 'npm-config/global.npmrc'),
  });
  if (inside(await realpath(repository), root)) {
    blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_PATH', 'cache root is inside repository');
  }
  return layout;
}

export async function findExecutableNative(name) {
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
  blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_EXECUTABLE', `${name} is not executable`);
}

export function onlineNativeEnvironment({ layout, proxyUrl }) {
  return cleanNativeEnvironment({
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    npm_config_proxy: proxyUrl,
    npm_config_https_proxy: proxyUrl,
    npm_config_cache: layout.npm,
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_replace_registry_host: 'always',
    npm_config_prefer_online: 'true',
    npm_config_offline: 'false',
    npm_config_build_from_source: 'true',
    npm_config_python: '/usr/bin/python3',
    PYTHON: '/usr/bin/python3',
    HOME: path.join(layout.root, 'home'),
    XDG_CACHE_HOME: path.join(layout.root, 'xdg-cache'),
    npm_config_devdir: layout.nodeGyp,
    ELECTRON_CACHE: layout.electron,
    ELECTRON_BUILDER_CACHE: layout.electronBuilder,
    PREBUILD_INSTALL_CACHE: layout.prebuild,
    COPILOT_NATIVE_CACHE_NETWORK_AUTHORITY: OWNER_NATIVE_CACHE_AUTHORITY,
  });
}

export function offlineNativeEnvironment(layout, electronNodedir = null) {
  return cleanNativeEnvironment({
    npm_config_cache: layout.npm,
    npm_config_offline: 'true',
    npm_config_build_from_source: 'true',
    npm_config_python: '/usr/bin/python3',
    PYTHON: '/usr/bin/python3',
    HOME: path.join(layout.root, 'home'),
    XDG_CACHE_HOME: path.join(layout.root, 'xdg-cache'),
    npm_config_devdir: layout.nodeGyp,
    ...(electronNodedir ? { npm_config_nodedir: electronNodedir } : {}),
    ELECTRON_CACHE: layout.electron,
    ELECTRON_BUILDER_CACHE: layout.electronBuilder,
    PREBUILD_INSTALL_CACHE: layout.prebuild,
    COPILOT_NATIVE_CACHE_NETWORK_AUTHORITY: 'deny-network-offline-proof',
  });
}

export async function removeInstallTrees(repository) {
  const targets = [path.join(repository, 'node_modules')];
  for (const scope of ['apps', 'packages']) {
    const scopeRoot = path.join(repository, scope);
    let entries = [];
    try {
      entries = await readdir(scopeRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        targets.push(path.join(scopeRoot, entry.name, 'node_modules'));
      }
    }
  }
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

export async function runNativeRebuild({
  repository,
  npmExecutable,
  electronVersion,
  arch,
  env,
  sandboxProfile,
  logRoot,
  name,
}) {
  const stageRoot = await mkdtemp('/private/tmp/copilot-native-cache-hydrate-');
  const sourcePackage = path.join(repository, 'node_modules/better-sqlite3');
  const stagePackage = path.join(stageRoot, 'better-sqlite3');
  try {
    await cp(sourcePackage, stagePackage, {
      recursive: true,
      dereference: true,
      filter: (source) => path.relative(sourcePackage, source).split(path.sep)[0] !== 'build',
    });
    const execution = await runAsyncRecordedNative({
      name,
      command: '/usr/bin/sandbox-exec',
      args: [
        '-p',
        sandboxProfile,
        ...nativeRebuildArgs({ npmExecutable, electronVersion, arch }),
      ],
      cwd: stagePackage,
      env: {
        ...env,
        PATH: `${path.join(repository, 'node_modules/.bin')}:${env.PATH ?? ''}`,
        npm_config_runtime: 'electron',
        npm_config_target: electronVersion,
        npm_config_arch: arch,
        npm_config_disturl: 'https://electronjs.org/headers',
        npm_config_build_from_source: 'true',
        npm_config_python: '/usr/bin/python3',
        PYTHON: '/usr/bin/python3',
      },
      logRoot,
    });
    const binary = path.join(stagePackage, 'build/Release/better_sqlite3.node');
    let binaryIdentity = null;
    if (execution.exitCode === 0) {
      const binaryStat = await stat(binary);
      if (!binaryStat.isFile() || binaryStat.size < 1) {
        blockNativeCache('BLOCKED_NATIVE_CACHE_HYDRATION_NATIVE_PROOF', 'native output invalid', {
          name,
          binary,
        });
      }
      binaryIdentity = {
        bytes: binaryStat.size,
        sha256: (await import('node:crypto')).createHash('sha256')
          .update(await readFile(binary))
          .digest('hex'),
      };
    }
    return { ...execution, binary: binaryIdentity, arch, electronVersion };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export function nativeHydrationPublicReceiptFields() {
  return {
    profile: NATIVE_TOOLCHAIN_PROFILE,
    nativeBuildMode: NATIVE_BUILD_MODE,
    allowedHosts: [...NATIVE_HYDRATION_HOSTS].sort(),
  };
}
