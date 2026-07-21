import { createHash } from 'node:crypto';

import { failBackup } from './errors.js';
import { BACKUP_SCOPES, type BackupManifestFile, type BackupScope, type BackupSourceFile, type CreateBackupInput } from './types.js';

const ALLOWED_SCOPE_SET = new Set<string>(BACKUP_SCOPES);
const PREFERENCE_KEYS = new Set(['theme', 'windowBounds', 'shortcuts', 'schemaVersion', 'cloudBackupEnabled', 'language', 'appearance']);
const FORBIDDEN_PATH_TOKENS = new Set([
  'secret', 'secrets', 'token', 'tokens', 'credential', 'credentials', 'session', 'sessions', 'bearer',
  'privatekey', 'privatekeys', 'keychain', 'embedding', 'embeddings', 'vector', 'vectors', 'log', 'logs',
  'crash', 'crashes', 'audit', 'audits', 'audio', 'recording', 'recordings', 'temp', 'tmp', 'cache', 'caches',
  'build', 'dist', 'release', 'releases', 'node_modules', 'profile', 'profiles', 'appasar',
]);
const FORBIDDEN_PREFERENCE_KEYS = /(?:api[-_]?key|secret|token|credential|password|bearer|session|private[-_]?key|model[-_]?api|keychain)/i;
const FORBIDDEN_SECRET_VALUE = /(?:\bsk-[a-z0-9_-]{8,}\b|\bAKID[a-z0-9]{8,}\b|\bbearer\s+[a-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SERIALIZED_CREDENTIAL = /["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential|private[-_]?key|session(?:id)?|cookie)["']?\s*[:=]\s*["']?[^\s"',}]{8,}/i;
const AUDIO_EXTENSION = /\.(?:wav|mp3|m4a|aac|flac|ogg|opus|webm)$/i;
const HEX_64 = /^[a-f0-9]{64}$/;
const PATH_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
const ENCODED_SEPARATOR = /%(?:25)*(?:2f|5c)/i;
const MALFORMED_PERCENT = /%(?![a-f0-9]{2})/i;
const PERCENT_ESCAPE = /%[a-f0-9]{2}/i;
const MAX_PERCENT_DECODE_LAYERS = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isByteArray(value: unknown): value is Uint8Array {
  return Buffer.isBuffer(value) || (
    ArrayBuffer.isView(value)
    && (value as ArrayBufferView & { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1
  );
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateContainerSize(bytes: number, maxSnapshotBytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1 || bytes > maxSnapshotBytes) {
    failBackup('SNAPSHOT_TOO_LARGE');
  }
}

function normalizePathLayer(value: string): string {
  if (PATH_CONTROL.test(value)) failBackup('SCOPE_INVALID');
  return value.normalize('NFKC')
    .replace(/[\u2044\u2215\u29f8]/g, '/')
    .replace(/[\u2216\u29f5]/g, '\\')
    .replace(/&#(?:x0*2f|0*47);/gi, '/')
    .replace(/&#(?:x0*5c|0*92);/gi, '\\')
    .replace(/\\u(?:002f|2044|2215|29f8|ff0f)/gi, '/')
    .replace(/\\u(?:005c|2216|29f5|ff3c)/gi, '\\')
    .replace(/\s+/g, '');
}

function assertNormalizedPathSafe(normalized: string): void {
  if (
    PATH_CONTROL.test(normalized)
    || normalized.startsWith('/')
    || normalized.startsWith('\\\\')
    || /^[a-z]:[\\/]/i.test(normalized)
    || /^file:(?:[\\/]){2}/i.test(normalized)
    || /^~[\\/]/.test(normalized)
  ) {
    failBackup('SCOPE_INVALID');
  }
}

function normalizePossibleLocalPath(value: string): string {
  let normalized = normalizePathLayer(value);
  assertNormalizedPathSafe(normalized);
  for (let attempt = 0; attempt < MAX_PERCENT_DECODE_LAYERS; attempt += 1) {
    if (MALFORMED_PERCENT.test(normalized)) failBackup('SCOPE_INVALID');
    if (!PERCENT_ESCAPE.test(normalized)) break;
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = normalizePathLayer(decoded);
      assertNormalizedPathSafe(normalized);
    } catch {
      failBackup('SCOPE_INVALID');
    }
  }
  if (MALFORMED_PERCENT.test(normalized) || ENCODED_SEPARATOR.test(normalized)) failBackup('SCOPE_INVALID');
  assertNormalizedPathSafe(normalized);
  return normalized;
}

function assertSafeRevisionString(value: string): void {
  normalizePossibleLocalPath(value);
}

export function assertNoAbsoluteLocalPaths(value: unknown): void {
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      assertSafeRevisionString(candidate);
      return;
    }
    if (candidate === null || typeof candidate !== 'object') return;
    if (visited.has(candidate)) failBackup('SCOPE_INVALID');
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isPlainObject(candidate)) failBackup('SCOPE_INVALID');
    for (const [key, nested] of Object.entries(candidate)) {
      assertSafeRevisionString(key);
      visit(nested);
    }
  };
  visit(value);
}

export function requireExactKeys(value: unknown, expected: readonly string[], code: 'SCOPE_INVALID' | 'DOWNLOAD_INTEGRITY_FAILED' | 'DECRYPT_FAILED' | 'PRESIGN_FORBIDDEN'): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) failBackup(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) failBackup(code);
}

export function isBackupScope(value: unknown): value is BackupScope {
  return typeof value === 'string' && ALLOWED_SCOPE_SET.has(value);
}

export function validateLogicalPath(logicalPath: unknown): asserts logicalPath is string {
  if (typeof logicalPath !== 'string' || logicalPath.length === 0 || logicalPath.length > 512) failBackup('SCOPE_INVALID');
  if (logicalPath.includes('\0') || logicalPath.includes('\\') || logicalPath.startsWith('/') || /^[a-zA-Z]:/.test(logicalPath) || /^[a-z]+:\/\//i.test(logicalPath)) {
    failBackup('SCOPE_INVALID');
  }
  const segments = logicalPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) failBackup('SCOPE_INVALID');
  const compactTokens = logicalPath.toLowerCase().replace(/\.asar/g, 'asar').split(/[^a-z0-9_]+/).flatMap((token) => token.split('_')).filter(Boolean);
  if (compactTokens.some((token) => FORBIDDEN_PATH_TOKENS.has(token))) failBackup('SCOPE_INVALID');
  if (/(?:api[-_]?keys?|private[-_]?keys?|model[-_]?api|node_modules)/i.test(logicalPath) || AUDIO_EXTENSION.test(logicalPath)) failBackup('SCOPE_INVALID');
}

function validatePreferenceObject(value: unknown, topLevel: boolean): void {
  if (!isPlainObject(value)) failBackup('SCOPE_INVALID');
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PREFERENCE_KEYS.test(key)) failBackup('SCOPE_INVALID');
    if (topLevel && !PREFERENCE_KEYS.has(key)) failBackup('SCOPE_INVALID');
    if (isPlainObject(nested)) validatePreferenceObject(nested, false);
    else if (Array.isArray(nested)) {
      for (const item of nested) if (isPlainObject(item)) validatePreferenceObject(item, false);
    } else if (typeof nested === 'string' && FORBIDDEN_SECRET_VALUE.test(nested)) failBackup('SCOPE_INVALID');
  }
}

export function validatePreferenceBytes(bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    failBackup('SCOPE_INVALID');
  }
  validatePreferenceObject(parsed, true);
}

export function validateNoCredentialMaterial(bytes: Uint8Array): void {
  const text = Buffer.from(bytes).toString('utf8');
  if (FORBIDDEN_SECRET_VALUE.test(text) || SERIALIZED_CREDENTIAL.test(text)) failBackup('SCOPE_INVALID');
}

function validateSourceFile(file: BackupSourceFile, selectedScopes: Set<string>, paths: Set<string>): void {
  if (!isPlainObject(file)) failBackup('SCOPE_INVALID');
  validateLogicalPath(file.logicalPath);
  if (!isBackupScope(file.scope) || !selectedScopes.has(file.scope) || !isByteArray(file.data)) failBackup('SCOPE_INVALID');
  if (paths.has(file.logicalPath)) failBackup('SCOPE_INVALID');
  paths.add(file.logicalPath);
  if (file.recordCount !== undefined && (!Number.isSafeInteger(file.recordCount) || file.recordCount < 0)) failBackup('SCOPE_INVALID');
  if (file.sourceRevision !== undefined && (typeof file.sourceRevision !== 'string' || file.sourceRevision.length === 0 || file.sourceRevision.length > 256)) {
    failBackup('SCOPE_INVALID');
  }
  if (file.sourceRevision !== undefined) assertNoAbsoluteLocalPaths(file.sourceRevision);
  validateNoCredentialMaterial(file.data);
  if (file.scope === 'preferences') validatePreferenceBytes(file.data);
}

export function validateCreateInput(input: CreateBackupInput): void {
  if (!isPlainObject(input) || typeof input.appVersion !== 'string' || input.appVersion.length === 0 || input.appVersion.length > 128) failBackup('SCOPE_INVALID');
  if (typeof input.logicalSchemaVersion !== 'string' || input.logicalSchemaVersion.length === 0 || input.logicalSchemaVersion.length > 128) failBackup('SCOPE_INVALID');
  if (!Array.isArray(input.selectedScopes) || input.selectedScopes.length === 0 || !Array.isArray(input.files)) failBackup('SCOPE_INVALID');
  const selectedScopes = new Set<string>();
  for (const scope of input.selectedScopes) {
    if (!isBackupScope(scope) || selectedScopes.has(scope)) failBackup('SCOPE_INVALID');
    selectedScopes.add(scope);
  }
  if (!isPlainObject(input.sourceRevisions)) failBackup('SCOPE_INVALID');
  assertNoAbsoluteLocalPaths(input.sourceRevisions);
  for (const [source, revision] of Object.entries(input.sourceRevisions)) {
    if (!source || source.length > 128 || typeof revision !== 'string' || !revision || revision.length > 256 || FORBIDDEN_PREFERENCE_KEYS.test(source)) failBackup('SCOPE_INVALID');
    validateNoCredentialMaterial(Buffer.from(revision, 'utf8'));
  }
  const paths = new Set<string>();
  for (const file of input.files) validateSourceFile(file, selectedScopes, paths);
}

export function createBackupRequestDigest(input: CreateBackupInput): string {
  const files = [...input.files].map((file) => ({
    logicalPath: String(file.logicalPath),
    scope: String(file.scope),
    bytes: isByteArray(file.data) ? file.data.byteLength : -1,
    plaintextSha256: isByteArray(file.data) ? sha256(file.data) : null,
    recordCount: file.recordCount ?? null,
    sourceRevision: file.sourceRevision ?? null,
  })).sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  return sha256(stableStringify({
    appVersion: input.appVersion,
    logicalSchemaVersion: input.logicalSchemaVersion,
    selectedScopes: [...input.selectedScopes].map(String).sort(),
    sourceRevisions: input.sourceRevisions,
    files,
  }));
}

export function logicalManifestDigest(input: {
  appVersion: string;
  logicalSchemaVersion: string;
  selectedScopes: readonly BackupScope[];
  sourceRevisions: Readonly<Record<string, string>>;
  files: readonly BackupManifestFile[];
}): string {
  return sha256(stableStringify({
    appVersion: input.appVersion,
    logicalSchemaVersion: input.logicalSchemaVersion,
    selectedScopes: [...input.selectedScopes],
    sourceRevisions: input.sourceRevisions,
    files: input.files.map((file) => ({
      logicalPath: file.logicalPath,
      scope: file.scope,
      bytes: file.bytes,
      plaintextSha256: file.plaintextSha256,
      sourceRevision: file.sourceRevision,
      recordCount: file.recordCount,
    })),
  }));
}

export function isHexSha256(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
