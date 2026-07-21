/**
 * Backup A metadata-only Tencent COS V5 presigning.
 *
 * The cloud receives no snapshot bytes. It binds a short-lived URL to one
 * authenticated owner/target, one UUIDv4 snapshot, one exact HTTP method and
 * signed request headers. Local data remains authoritative.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const BACKUP_CONTENT_TYPE = 'application/vnd.njx.copilot-backup';
export const BACKUP_MAX_CIPHERTEXT_BYTES = 256 * 1024 * 1024;
export const BACKUP_MAX_METADATA_BODY_BYTES = 4096;
export const BACKUP_OBJECT_PREFIX = 'backup/v1';

const IDENTITY_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}-[0-9]{5,20}$/;

export type BackupMethod = 'PUT' | 'GET' | 'HEAD' | 'DELETE';

interface BackupPresignBaseRequest {
  schemaVersion: 1;
  method: BackupMethod;
  snapshotId: string;
  ttlSeconds: number;
  contentType: typeof BACKUP_CONTENT_TYPE;
}

export interface BackupPutPresignRequest extends BackupPresignBaseRequest {
  method: 'PUT';
  ciphertextBytes: number;
  ciphertextSha256: string;
}

export interface BackupObjectPresignRequest extends BackupPresignBaseRequest {
  method: 'GET' | 'HEAD' | 'DELETE';
}

export type BackupPresignRequest = BackupPutPresignRequest | BackupObjectPresignRequest;

export interface BackupPresignInput {
  ownerHash: string;
  targetHash: string;
  request: BackupPresignRequest;
}

export interface BackupPresignResult {
  schemaVersion: 1;
  method: BackupMethod;
  snapshotId: string;
  key: string;
  expiresAtMs: number;
  url: string;
  requiredHeaders: Record<string, string>;
}

export interface BackupPresigner {
  presign(input: BackupPresignInput): Promise<BackupPresignResult>;
}

export interface BackupAuthBinding {
  token: string;
  ownerHash: string;
  targetHash: string;
}

export interface BackupCosSigningConfig {
  region: string;
  bucket: string;
  secretId: string;
  secretKey: string;
  securityToken: string;
}

export class BackupContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BackupContractError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requireUuidV4(snapshotId: unknown): string {
  if (typeof snapshotId !== 'string' || !UUID_V4_PATTERN.test(snapshotId)) {
    throw new BackupContractError('SNAPSHOT_ID_INVALID');
  }
  return snapshotId.toLowerCase();
}

function requireIdentityHash(value: string): string {
  if (!IDENTITY_HASH_PATTERN.test(value)) {
    throw new BackupContractError('BACKUP_IDENTITY_INVALID');
  }
  return value;
}

export function deriveBackupObjectKey(
  ownerHash: string,
  targetHash: string,
  snapshotId: string,
): string {
  return `${BACKUP_OBJECT_PREFIX}/${requireIdentityHash(ownerHash)}/${requireIdentityHash(targetHash)}/${requireUuidV4(snapshotId)}.cbackup`;
}

export function parseBackupPresignRequest(value: unknown): BackupPresignRequest {
  if (!isRecord(value)) throw new BackupContractError('INVALID_SCHEMA');
  if (value.schemaVersion !== 1) throw new BackupContractError('INVALID_SCHEMA');
  if (typeof value.method !== 'string' || !['PUT', 'GET', 'HEAD', 'DELETE'].includes(value.method)) {
    throw new BackupContractError('METHOD_NOT_ALLOWED');
  }

  const method = value.method as BackupMethod;
  const baseKeys = ['schemaVersion', 'method', 'snapshotId', 'ttlSeconds', 'contentType'];
  const allowed = new Set(method === 'PUT'
    ? [...baseKeys, 'ciphertextBytes', 'ciphertextSha256']
    : baseKeys);
  if (!hasExactKeys(value, allowed) || Object.keys(value).length !== allowed.size) {
    throw new BackupContractError('INVALID_SCHEMA');
  }

  const snapshotId = requireUuidV4(value.snapshotId);
  if (!Number.isSafeInteger(value.ttlSeconds) || Number(value.ttlSeconds) < 1 || Number(value.ttlSeconds) > 300) {
    throw new BackupContractError('TTL_INVALID');
  }
  if (value.contentType !== BACKUP_CONTENT_TYPE) {
    throw new BackupContractError('CONTENT_TYPE_INVALID');
  }

  const base = {
    schemaVersion: 1 as const,
    method,
    snapshotId,
    ttlSeconds: Number(value.ttlSeconds),
    contentType: BACKUP_CONTENT_TYPE as typeof BACKUP_CONTENT_TYPE,
  };

  if (method !== 'PUT') return base as BackupObjectPresignRequest;
  if (
    !Number.isSafeInteger(value.ciphertextBytes) ||
    Number(value.ciphertextBytes) < 1 ||
    Number(value.ciphertextBytes) > BACKUP_MAX_CIPHERTEXT_BYTES
  ) {
    throw new BackupContractError('CIPHERTEXT_SIZE_INVALID');
  }
  if (typeof value.ciphertextSha256 !== 'string' || !SHA256_PATTERN.test(value.ciphertextSha256)) {
    throw new BackupContractError('CIPHERTEXT_SHA256_INVALID');
  }
  return {
    ...base,
    method: 'PUT',
    ciphertextBytes: Number(value.ciphertextBytes),
    ciphertextSha256: value.ciphertextSha256,
  };
}

function constantTimeTokenEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyBackupBearer(
  authorization: string | undefined,
  bindings: BackupAuthBinding[],
): BackupAuthBinding | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;
  return bindings.find((binding) => constantTimeTokenEquals(token, binding.token)) ?? null;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalize(values: Record<string, string>): { list: string; serialized: string } {
  const entries = Object.entries(values)
    .map(([key, value]) => [rfc3986(key).toLowerCase(), rfc3986(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    list: entries.map(([key]) => key).join(';'),
    serialized: entries.map(([key, value]) => `${key}=${value}`).join('&'),
  };
}

function assertCosSigningConfig(config: BackupCosSigningConfig): void {
  if (
    !REGION_PATTERN.test(config.region) ||
    !BUCKET_PATTERN.test(config.bucket) ||
    !config.secretId.trim() ||
    !config.secretKey.trim() ||
    /[\s\u0000-\u001f\u007f]/.test(config.secretId) ||
    /[\s\u0000-\u001f\u007f]/.test(config.secretKey) ||
    /[\s\u0000-\u001f\u007f]/.test(config.securityToken)
  ) {
    throw new BackupContractError('BACKUP_COS_CONFIG_INVALID');
  }
}

/**
 * COS XML API V5 signer per Tencent's published Request Signature algorithm.
 * Host is always signed. PUT also signs exact byte length and ciphertext
 * SHA-256 metadata; COS does not receive plaintext or encryption keys.
 */
export class CosV5BackupPresigner implements BackupPresigner {
  constructor(
    private readonly config: BackupCosSigningConfig,
    private readonly nowMs: () => number = Date.now,
  ) {
    assertCosSigningConfig(config);
  }

  async presign(input: BackupPresignInput): Promise<BackupPresignResult> {
    const request = parseBackupPresignRequest(input.request);
    const key = deriveBackupObjectKey(input.ownerHash, input.targetHash, request.snapshotId);
    const nowMs = this.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new BackupContractError('BACKUP_CLOCK_INVALID');
    }
    const startSeconds = Math.floor(nowMs / 1000);
    const endSeconds = startSeconds + request.ttlSeconds;
    const keyTime = `${startSeconds};${endSeconds}`;
    const host = `${this.config.bucket}.cos.${this.config.region}.myqcloud.com`;
    const path = `/${key}`;
    const requiredHeaders: Record<string, string> = {
      'content-type': BACKUP_CONTENT_TYPE,
    };
    if (request.method === 'PUT') {
      requiredHeaders['content-length'] = String(request.ciphertextBytes);
      requiredHeaders['x-cos-meta-ciphertext-sha256'] = request.ciphertextSha256;
    }

    const signedHeaders = canonicalize({ host, ...requiredHeaders });
    const originalQuery: Record<string, string> = {};
    if (this.config.securityToken) {
      originalQuery['x-cos-security-token'] = this.config.securityToken;
    }
    const signedQuery = canonicalize(originalQuery);
    const httpString = `${request.method.toLowerCase()}\n${path}\n${signedQuery.serialized}\n${signedHeaders.serialized}\n`;
    const stringToSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`;
    const signKey = createHmac('sha1', this.config.secretKey).update(keyTime).digest('hex');
    const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex');

    const queryValues: Record<string, string> = {
      ...originalQuery,
      'q-sign-algorithm': 'sha1',
      'q-ak': this.config.secretId,
      'q-sign-time': keyTime,
      'q-key-time': keyTime,
      'q-header-list': signedHeaders.list,
      'q-url-param-list': signedQuery.list,
      'q-signature': signature,
    };
    const query = Object.entries(queryValues)
      .map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`)
      .join('&');
    return {
      schemaVersion: 1,
      method: request.method,
      snapshotId: request.snapshotId,
      key,
      expiresAtMs: endSeconds * 1000,
      url: `https://${host}${path}?${query}`,
      requiredHeaders,
    };
  }
}
