import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { aggregateCandidateBoundDirectPerformanceRawBytes } from './direct-performance-config.mjs';
import { DIRECT_PERFORMANCE_CONTRACT_R31_V1 as CONTRACT } from './direct-performance-contract-r31-v1.mjs';

const MAX_RAW_BYTES = 1024 * 1024;

try {
  const aggregate = await composeAggregate(process.argv.slice(2));
  process.exitCode = aggregate.pass === true ? 0 : 2;
} catch (error) {
  const code = typeof error?.code === 'string' && error.code.startsWith('BLOCKED_')
    ? error.code
    : 'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_UNEXPECTED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}

async function composeAggregate(args) {
  if (!Array.isArray(args) || args.length !== 4) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_ARGUMENTS');
  }
  const [outputPath, ...rawPaths] = args;
  const allPaths = [outputPath, ...rawPaths];
  if (allPaths.some((filePath) => (
    typeof filePath !== 'string'
    || !path.isAbsolute(filePath)
    || path.resolve(filePath) !== filePath
  ))) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_PATH');
  }
  if (
    path.basename(outputPath) !== CONTRACT.aggregateBasename
    || rawPaths.some((filePath, index) => (
      path.basename(filePath) !== CONTRACT.rawBasenames[index]
    ))
  ) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_BASENAME');
  }

  const lexicalParent = path.dirname(outputPath);
  if (rawPaths.some((filePath) => path.dirname(filePath) !== lexicalParent)) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY');
  }
  const parentStat = await safeLstat(
    lexicalParent,
    'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY',
  );
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY');
  }
  const resolvedParent = await realpath(lexicalParent).catch(() => {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY');
  });
  await requireAbsent(outputPath);

  const rawInputs = await Promise.all(rawPaths.map((filePath, index) => (
    readPrivateRaw(filePath, CONTRACT.rawBasenames[index])
  )));
  const aggregate = aggregateCandidateBoundDirectPerformanceRawBytes(CONTRACT, rawInputs);

  const currentParentStat = await safeLstat(
    lexicalParent,
    'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY',
  );
  const currentResolvedParent = await realpath(lexicalParent).catch(() => {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY');
  });
  if (
    currentParentStat.isSymbolicLink()
    || !currentParentStat.isDirectory()
    || currentParentStat.dev !== parentStat.dev
    || currentParentStat.ino !== parentStat.ino
    || currentResolvedParent !== resolvedParent
  ) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_DIRECTORY');
  }
  await writePrivateAggregate(outputPath, aggregate);
  return aggregate;
}

async function readPrivateRaw(filePath, basename) {
  const original = await safeLstat(filePath, 'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW');
  if (
    original.isSymbolicLink()
    || !original.isFile()
    || original.nlink !== 1
    || !Number.isSafeInteger(original.size)
    || original.size < 2
    || original.size > MAX_RAW_BYTES
    || (process.platform !== 'win32' && (original.mode & 0o777) !== 0o600)
  ) {
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW');
  }

  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.nlink !== 1
      || !Number.isSafeInteger(before.size)
      || before.size < 2
      || before.size > MAX_RAW_BYTES
      || before.dev !== original.dev
      || before.ino !== original.ino
      || before.size !== original.size
      || before.mode !== original.mode
      || before.mtimeMs !== original.mtimeMs
      || before.ctimeMs !== original.ctimeMs
      || (process.platform !== 'win32' && (before.mode & 0o777) !== 0o600)
    ) {
      fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_CHANGED');
    }

    const contents = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < contents.byteLength) {
      const { bytesRead } = await handle.read(
        contents,
        offset,
        contents.byteLength - offset,
        offset,
      );
      if (bytesRead < 1) fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_CHANGED');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      !after.isFile()
      || after.nlink !== 1
      || !Number.isSafeInteger(after.size)
      || after.size < 2
      || after.size > MAX_RAW_BYTES
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mode !== after.mode
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || contents.byteLength !== before.size
      || (process.platform !== 'win32' && (after.mode & 0o777) !== 0o600)
    ) {
      fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_CHANGED');
    }
    const record = JSON.parse(contents.toString('utf8'));
    const canonical = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (!canonical.equals(contents)) {
      fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_INVALID');
    }
    return { basename, bytes: contents };
  } catch (error) {
    if (isBlocked(error)) throw error;
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_RAW_INVALID');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writePrivateAggregate(outputPath, aggregate) {
  const contents = Buffer.from(`${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  let handle;
  try {
    handle = await open(
      outputPath,
      fsConstants.O_RDWR
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(contents);
    await handle.sync();
    await handle.chmod(0o600);
    const stat = await handle.stat();
    const verification = Buffer.allocUnsafe(contents.byteLength);
    const { bytesRead } = await handle.read(verification, 0, verification.byteLength, 0);
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || stat.size !== contents.byteLength
      || bytesRead !== contents.byteLength
      || !verification.equals(contents)
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
    ) {
      fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT');
    }
    const published = await safeLstat(
      outputPath,
      'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT',
    );
    if (
      published.isSymbolicLink()
      || !published.isFile()
      || published.nlink !== 1
      || published.dev !== stat.dev
      || published.ino !== stat.ino
      || published.size !== stat.size
      || published.mode !== stat.mode
      || published.mtimeMs !== stat.mtimeMs
      || published.ctimeMs !== stat.ctimeMs
      || published.size !== contents.byteLength
      || (process.platform !== 'win32' && (published.mode & 0o777) !== 0o600)
    ) {
      fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT');
    }
  } catch (error) {
    if (isBlocked(error)) throw error;
    fail(error?.code === 'EEXIST'
      ? 'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT_EXISTS'
      : 'BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function requireAbsent(filePath) {
  try {
    await lstat(filePath);
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT_EXISTS');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    if (isBlocked(error)) throw error;
    fail('BLOCKED_DIRECT_PERF_AGGREGATE_CLI_OUTPUT');
  }
}

async function safeLstat(filePath, code) {
  try {
    return await lstat(filePath);
  } catch {
    fail(code);
  }
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isBlocked(error) {
  return typeof error?.code === 'string' && error.code.startsWith('BLOCKED_');
}
