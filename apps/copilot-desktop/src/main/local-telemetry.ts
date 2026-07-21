import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const NORTH_STAR_OPERATIONS = [
  'notes.list',
  'notes.get',
  'notes.create',
  'notes.update',
  'notes.remove',
  'notes.backlinks',
  'kg.view',
  'kg.reindex',
  'rag.ask',
  'rag.stream',
  'todos.list',
  'todos.create',
  'todos.update',
  'todos.remove',
  'todos.due',
  'todos.reminder-fired',
] as const;

export type NorthStarOperation = (typeof NORTH_STAR_OPERATIONS)[number];

export interface PackagedReleaseIdentity {
  schemaVersion: 1;
  candidate: string;
  sourceHead: string;
  sourceSnapshotSha256: string;
}

export function isCanonicalPackagedRuntime(options: {
  isPackaged: boolean;
  isDev: boolean;
}): boolean {
  return options.isPackaged === true && options.isDev === false;
}

/** A telemetry recorder is evidence-only and must never affect or reject product work. */
export async function recordTelemetrySafely(
  recorder?: () => void | Promise<void> | undefined,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder();
  } catch {
    // Deliberately contained: callers may safely `void` this always-resolving promise.
  }
}

export type TelemetryEventKind =
  | 'startup'
  | 'crash'
  | 'offline'
  | 'renderer-gone'
  | 'renderer-unresponsive'
  | 'operation';

export interface TelemetryEvent {
  schemaVersion: 2;
  timestamp: string;
  kind: TelemetryEventKind;
  process: 'main' | 'renderer';
  sessionId: string;
  release: PackagedReleaseIdentity;
  detail?: Record<string, string | number | boolean | null>;
  operation?: NorthStarOperation;
}

export interface LocalTelemetry {
  readonly reportPath: string;
  readonly sessionId: string;
  record(
    kind: TelemetryEventKind,
    processType: 'main' | 'renderer',
    detail?: Record<string, unknown>,
  ): Promise<void>;
  recordOperation(operation: NorthStarOperation): Promise<void>;
  recordError(
    kind: Extract<TelemetryEventKind, 'crash' | 'offline' | 'renderer-gone'>,
    processType: 'main' | 'renderer',
    error: unknown,
    detail?: Record<string, unknown>,
  ): Promise<void>;
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-[a-z0-9_-]{8,}\b/gi,
  /\bBearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+/gi,
  /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
];

export function redactTelemetryText(value: string): string {
  let output = value;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (_match, prefix: string | undefined) =>
      prefix ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  output = output
    .replace(/\/Users\/[^/\s]+/g, '~')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '~');
  return output.slice(0, 500);
}

export function sanitizeTelemetryDetail(
  detail: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (/body|content|transcript|note|prompt|authorization|path|question|secret|credential|api.?key|payload|provider|url/i.test(key)) continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'string') safe[key] = redactTelemetryText(value);
  }
  return safe;
}

/** Safe console payload for process-level errors; deliberately excludes stack and raw values. */
export function safeMainErrorForLog(error: unknown): {
  name: string;
  code: string | null;
  message: string;
} {
  const record = toSafeErrorRecord(error);
  return {
    name: String(record.errorName ?? 'UnknownError'),
    code: typeof record.errorCode === 'string' && record.errorCode ? record.errorCode : null,
    message: String(record.errorMessage ?? 'details redacted'),
  };
}

export function createLocalTelemetry(
  userDataPath: string,
  options: {
    releaseIdentity: PackagedReleaseIdentity;
    now?: () => Date;
    sessionId?: string;
    hooks?: {
      afterOpen?: (context: { reportPath: string }) => void | Promise<void>;
    };
  },
): LocalTelemetry {
  const identityErrors = validatePackagedReleaseIdentity(options?.releaseIdentity);
  if (identityErrors.length > 0) {
    throw new Error(`invalid packaged release identity: ${identityErrors.join('; ')}`);
  }
  const now = options.now ?? (() => new Date());
  const sessionId = options.sessionId ?? randomUUID();
  if (!isUuidV4(sessionId)) throw new Error('invalid telemetry session id');
  const releaseIdentity = Object.freeze({ ...options.releaseIdentity });
  const telemetryDir = path.join(userDataPath, 'telemetry');
  const reportPath = path.join(telemetryDir, 'events.jsonl');
  let appendQueue = Promise.resolve();
  let startupRecorded = false;
  let lastTimestampMs = Number.NEGATIVE_INFINITY;

  const nextTimestamp = (): string => {
    const observed = now().getTime();
    if (!Number.isFinite(observed)) throw new Error('invalid telemetry timestamp');
    const timestamp = Math.max(observed, lastTimestampMs + 1);
    lastTimestampMs = timestamp;
    return new Date(timestamp).toISOString();
  };

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = appendQueue.then(work);
    appendQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const record = async (
    kind: TelemetryEventKind,
    processType: 'main' | 'renderer',
    detail: Record<string, unknown> = {},
  ): Promise<void> => {
    return enqueue(async () => {
      if (kind === 'operation') throw new Error('operation events require recordOperation');
      if (kind === 'startup' && startupRecorded) return;
      const event: TelemetryEvent = {
        schemaVersion: 2,
        timestamp: nextTimestamp(),
        kind,
        process: processType,
        sessionId,
        release: releaseIdentity,
        detail: sanitizeTelemetryDetail(detail),
      };
      await secureAppendTelemetryLine({
        telemetryDir,
        reportPath,
        line: `${JSON.stringify(event)}\n`,
        afterOpen: options.hooks?.afterOpen,
      });
      if (kind === 'startup') startupRecorded = true;
    });
  };

  return {
    reportPath,
    sessionId,
    record,
    async recordOperation(operation) {
      if (!(NORTH_STAR_OPERATIONS as readonly string[]).includes(operation)) {
        throw new Error('invalid north-star operation');
      }
      await enqueue(async () => {
        if (!startupRecorded) throw new Error('startup must be recorded before operation');
        const event: TelemetryEvent = {
          schemaVersion: 2,
          timestamp: nextTimestamp(),
          kind: 'operation',
          process: 'main',
          sessionId,
          release: releaseIdentity,
          operation,
        };
        await secureAppendTelemetryLine({
          telemetryDir,
          reportPath,
          line: `${JSON.stringify(event)}\n`,
          afterOpen: options.hooks?.afterOpen,
        });
      });
    },
    async recordError(kind, processType, error, detail = {}) {
      const errorRecord = toSafeErrorRecord(error);
      await record(kind, processType, { ...detail, ...errorRecord });
    },
  };
}

async function secureAppendTelemetryLine(options: {
  telemetryDir: string;
  reportPath: string;
  line: string;
  afterOpen?: (context: { reportPath: string }) => void | Promise<void>;
}): Promise<void> {
  await mkdir(options.telemetryDir, { recursive: true, mode: 0o700 });
  const directoryPathStat = await lstat(options.telemetryDir);
  if (!directoryPathStat.isDirectory() || directoryPathStat.isSymbolicLink()) {
    throw new Error('telemetry directory is unsafe or a symlink');
  }
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let directoryHandle;
  let reportHandle;
  try {
    directoryHandle = await open(options.telemetryDir, fsConstants.O_RDONLY | noFollow);
    const directoryHandleStat = await directoryHandle.stat();
    if (!directoryHandleStat.isDirectory()
      || directoryHandleStat.dev !== directoryPathStat.dev
      || directoryHandleStat.ino !== directoryPathStat.ino) {
      throw new Error('telemetry directory changed while opening');
    }
    await directoryHandle.chmod(0o700);

    reportHandle = await open(
      options.reportPath,
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | noFollow,
      0o600,
    );
    const opened = await reportHandle.stat();
    if (!opened.isFile() || opened.nlink !== 1) throw new Error('telemetry leaf is unsafe');
    await options.afterOpen?.({ reportPath: options.reportPath });

    const reportPathStat = await lstat(options.reportPath);
    const directoryAfterOpen = await lstat(options.telemetryDir);
    if (reportPathStat.isSymbolicLink()
      || !reportPathStat.isFile()
      || reportPathStat.nlink !== 1
      || reportPathStat.dev !== opened.dev
      || reportPathStat.ino !== opened.ino
      || directoryAfterOpen.isSymbolicLink()
      || !directoryAfterOpen.isDirectory()
      || directoryAfterOpen.dev !== directoryHandleStat.dev
      || directoryAfterOpen.ino !== directoryHandleStat.ino) {
      throw new Error('telemetry path changed or is unsafe');
    }

    await reportHandle.chmod(0o600);
    const bytes = Buffer.from(options.line, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await reportHandle.write(bytes, offset, bytes.length - offset, null);
      if (bytesWritten <= 0) throw new Error('telemetry append made no progress');
      offset += bytesWritten;
    }
    await reportHandle.sync();
    const finalHandleStat = await reportHandle.stat();
    const finalPathStat = await lstat(options.reportPath);
    if (!finalHandleStat.isFile()
      || finalHandleStat.nlink !== 1
      || finalPathStat.isSymbolicLink()
      || finalHandleStat.dev !== opened.dev
      || finalHandleStat.ino !== opened.ino
      || finalPathStat.dev !== opened.dev
      || finalPathStat.ino !== opened.ino) {
      throw new Error('telemetry leaf changed after append');
    }
    await directoryHandle.sync().catch((error: NodeJS.ErrnoException) => {
      if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(error.code ?? '')) throw error;
    });
  } catch (error) {
    if (['ELOOP', 'ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '')) {
      throw new Error('telemetry path changed or is unsafe or a symlink');
    }
    throw error;
  } finally {
    await reportHandle?.close().catch(() => {});
    await directoryHandle?.close().catch(() => {});
  }
}

export function validatePackagedReleaseIdentity(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['identity must be an object'];
  }
  const identity = value as Partial<PackagedReleaseIdentity>;
  if (identity.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (
    typeof identity.candidate !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identity.candidate)
  ) errors.push('candidate is invalid');
  if (typeof identity.sourceHead !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(identity.sourceHead)) {
    errors.push('sourceHead is invalid');
  }
  if (
    typeof identity.sourceSnapshotSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(identity.sourceSnapshotSha256)
  ) errors.push('sourceSnapshotSha256 is invalid');
  return errors;
}

export async function loadPackagedReleaseIdentity(
  identityPath: string,
): Promise<PackagedReleaseIdentity> {
  const bytes = await readFile(identityPath);
  if (bytes.length > 4096) throw new Error('packaged release identity exceeds size limit');
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('packaged release identity is invalid JSON');
  }
  const errors = validatePackagedReleaseIdentity(value);
  if (errors.length > 0) throw new Error(`invalid packaged release identity: ${errors.join('; ')}`);
  return value as PackagedReleaseIdentity;
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toSafeErrorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = safeErrorCode(
      'code' in error ? (error as Error & { code?: unknown }).code : undefined,
    );
    return {
      errorName: classifyErrorName(error.name),
      errorCode: code,
      errorMessage: classifyErrorMessage(error.message),
    };
  }
  return { errorName: 'UnknownError', errorMessage: 'details redacted' };
}

const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'AbortError', 'TimeoutError', 'NetworkError',
]);

function classifyErrorName(value: unknown): string {
  return typeof value === 'string' && SAFE_ERROR_NAMES.has(value) ? value : 'UnknownError';
}

function safeErrorCode(value: unknown): string {
  const code = typeof value === 'string' ? value : '';
  return /^[A-Z0-9_-]{1,64}$/i.test(code) ? code : '';
}

function classifyErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (/timeout|timed out/.test(normalized)) return 'timeout';
  if (/fetch|network|connection|offline|econn/.test(normalized)) return 'network failure';
  return 'details redacted';
}
