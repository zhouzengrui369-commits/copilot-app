import { BackupProtocolError, failBackup } from './errors.js';
import {
  BACKUP_CONTENT_TYPE,
  type PresignGrant,
  type PresignMetadata,
  type PresignTransport,
} from './types.js';
import { isHexSha256, isPlainRecord } from './validation.js';

const COMMON_METADATA_KEYS = [
  'method', 'region', 'bucket', 'ownerHash', 'targetHash', 'snapshotId', 'key', 'ttlSeconds', 'contentType',
] as const;
const PUT_METADATA_KEYS = [...COMMON_METADATA_KEYS, 'ciphertextBytes', 'ciphertextSha256'] as const;
const COMMON_GRANT_KEYS = ['method', 'key', 'url', 'contentType', 'expiresAtMs'] as const;
const PUT_GRANT_KEYS = [...COMMON_GRANT_KEYS, 'ciphertextBytes', 'ciphertextSha256'] as const;
const METHODS = new Set(['PUT', 'GET', 'HEAD', 'DELETE']);
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REGION = /^[a-z0-9][a-z0-9-]{1,62}$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{2,62}$/;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateMetadata(value: unknown): PresignMetadata {
  if (!isPlainRecord(value) || !METHODS.has(String(value.method))) failBackup('PRESIGN_FORBIDDEN');
  const method = value.method as PresignMetadata['method'];
  if (!exactKeys(value, method === 'PUT' ? PUT_METADATA_KEYS : COMMON_METADATA_KEYS)) failBackup('PRESIGN_FORBIDDEN');
  if (typeof value.region !== 'string' || !REGION.test(value.region) || typeof value.bucket !== 'string' || !BUCKET.test(value.bucket)) failBackup('PRESIGN_FORBIDDEN');
  if (typeof value.ownerHash !== 'string' || !HASH.test(value.ownerHash) || typeof value.targetHash !== 'string' || !HASH.test(value.targetHash)) {
    failBackup('PRESIGN_FORBIDDEN');
  }
  if (typeof value.snapshotId !== 'string' || !UUID.test(value.snapshotId) || value.contentType !== BACKUP_CONTENT_TYPE) failBackup('PRESIGN_FORBIDDEN');
  const exactKey = `backup/v1/${value.ownerHash}/${value.targetHash}/${value.snapshotId}.cbackup`;
  if (value.key !== exactKey || !Number.isSafeInteger(value.ttlSeconds) || (value.ttlSeconds as number) < 1 || (value.ttlSeconds as number) > 300) {
    failBackup('PRESIGN_FORBIDDEN');
  }
  if (method === 'PUT') {
    if (!Number.isSafeInteger(value.ciphertextBytes) || (value.ciphertextBytes as number) < 1 || !isHexSha256(value.ciphertextSha256)) failBackup('PRESIGN_FORBIDDEN');
  }
  return value as unknown as PresignMetadata;
}

function validateGrant(value: unknown, metadata: PresignMetadata, nowMs: number): PresignGrant {
  if (!isPlainRecord(value) || !exactKeys(value, metadata.method === 'PUT' ? PUT_GRANT_KEYS : COMMON_GRANT_KEYS)) failBackup('PRESIGN_FORBIDDEN');
  if (value.method !== metadata.method || value.key !== metadata.key || value.contentType !== metadata.contentType) failBackup('PRESIGN_FORBIDDEN');
  if (!Number.isFinite(value.expiresAtMs) || (value.expiresAtMs as number) <= nowMs) failBackup('PRESIGN_EXPIRED');
  if ((value.expiresAtMs as number) > nowMs + metadata.ttlSeconds * 1_000) failBackup('PRESIGN_FORBIDDEN');
  if (typeof value.url !== 'string') failBackup('PRESIGN_FORBIDDEN');
  let parsed: URL;
  try {
    parsed = new URL(value.url);
  } catch {
    failBackup('PRESIGN_FORBIDDEN');
  }
  const expectedHost = `${metadata.bucket}.cos.${metadata.region}.myqcloud.com`;
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
    || parsed.hostname !== expectedHost
    || parsed.pathname !== `/${metadata.key}`
    || !parsed.search
  ) failBackup('PRESIGN_FORBIDDEN');
  if (metadata.method === 'PUT' && (value.ciphertextBytes !== metadata.ciphertextBytes || value.ciphertextSha256 !== metadata.ciphertextSha256)) {
    failBackup('PRESIGN_FORBIDDEN');
  }
  return value as unknown as PresignGrant;
}

export class MetadataOnlyPresignClient {
  constructor(private readonly transport: PresignTransport, private readonly now: () => number = Date.now) {}

  async request(metadataValue: unknown): Promise<PresignGrant> {
    const metadata = validateMetadata(metadataValue);
    let grant: PresignGrant;
    try {
      grant = await this.transport.request({ ...metadata });
    } catch (error) {
      if (error instanceof BackupProtocolError) throw error;
      failBackup('COS_UNAVAILABLE');
    }
    return validateGrant(grant, metadata, this.now());
  }
}
