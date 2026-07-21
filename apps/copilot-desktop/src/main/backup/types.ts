export const BACKUP_FORMAT = 'COPILOT-BACKUP/1' as const;
export const BACKUP_CRYPTO_VERSION = 'A256GCM-CHUNKED/1' as const;
export const BACKUP_CONTENT_TYPE = 'application/vnd.njx.copilot-backup' as const;
export const DEFAULT_BACKUP_MAX_BYTES = 256 * 1024 * 1024;
export const DEFAULT_BACKUP_CHUNK_BYTES = 1024 * 1024;

export const BACKUP_SCOPES = [
  'note-markdown',
  'note-metadata',
  'kb-logical',
  'kb-index-metadata',
  'kg-nodes',
  'kg-edges',
  'todos',
  'preferences',
] as const;

export type BackupScope = typeof BACKUP_SCOPES[number];
export type BackupCommand = 'create' | 'upload' | 'download' | 'delete' | 'restore';

export type BackupErrorCode =
  | 'BACKUP_DISABLED'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_EXPIRED'
  | 'SCOPE_INVALID'
  | 'KEY_UNAVAILABLE'
  | 'ENCRYPT_FAILED'
  | 'SNAPSHOT_TOO_LARGE'
  | 'PRESIGN_FORBIDDEN'
  | 'PRESIGN_EXPIRED'
  | 'UPLOAD_INTEGRITY_FAILED'
  | 'DOWNLOAD_INTEGRITY_FAILED'
  | 'DECRYPT_FAILED'
  | 'SNAPSHOT_VERSION_UNSUPPORTED'
  | 'RESTORE_CONFLICT'
  | 'RESTORE_APPROVAL_REQUIRED'
  | 'COS_UNAVAILABLE'
  | 'DELETE_APPROVAL_REQUIRED'
  | 'DELETE_FAILED';

export interface BackupCommandConsent {
  approved: true;
  command: BackupCommand;
  requestId: string;
  resourceDigest: string;
  snapshotId?: string;
  approvedAtMs: number;
  expiresAtMs: number;
}

export interface BackupCommandAuthorization {
  backupEnabled?: boolean;
  nowMs?: number;
  consent?: BackupCommandConsent;
}

export interface BackupCredentialStore {
  putDataKey(keyId: string, key: Uint8Array): Promise<void>;
  getDataKey(keyId: string): Promise<Uint8Array | null>;
  deleteDataKey(keyId: string): Promise<void>;
}

export interface BackupSourceFile {
  logicalPath: string;
  scope: BackupScope;
  data: Uint8Array;
  recordCount?: number;
  sourceRevision?: string;
}

export interface CreateBackupInput {
  appVersion: string;
  logicalSchemaVersion: string;
  selectedScopes: readonly BackupScope[];
  sourceRevisions: Readonly<Record<string, string>>;
  files: readonly BackupSourceFile[];
}

export interface BackupOuterHeader {
  format: typeof BACKUP_FORMAT;
  cryptoVersion: typeof BACKUP_CRYPTO_VERSION;
  snapshotId: string;
  keyId: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  chunkSize: number;
  chunkCount: number;
  manifestChunkCount: number;
  noncePrefix: string;
  nonceDerivation: 'random-64-bit-prefix+uint32be-counter';
  tagBytes: 16;
}

export interface BackupManifestFile {
  logicalPath: string;
  scope: BackupScope;
  bytes: number;
  plaintextSha256: string;
  ciphertextSha256: string;
  ciphertextBytes: number;
  chunkCount: number;
  nonceStart: number;
  sourceRevision: string | null;
  recordCount: number;
}

export interface BackupManifest {
  schemaVersion: 1;
  appVersion: string;
  logicalSchemaVersion: string;
  createdAtMs: number;
  selectedScopes: BackupScope[];
  sourceRevisions: Record<string, string>;
  fileCount: number;
  recordCount: number;
  logicalHashSha256: string;
  files: BackupManifestFile[];
}

export interface CreatedBackup {
  container: Uint8Array;
  snapshotId: string;
  keyId: string;
  containerBytes: number;
  containerSha256: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
}

export interface InspectedBackupContainer {
  header: BackupOuterHeader;
  payloadBytes: number;
  payloadSha256: string;
  containerBytes: number;
  containerSha256: string;
}

export interface RestoreTempStore {
  write(relativePath: string, data: Uint8Array): Promise<void>;
}

export interface RestorePlanFile {
  logicalPath: string;
  importPath: string;
  bytes: number;
  plaintextSha256: string;
  scope: BackupScope;
}

export interface RestorePlan {
  mode: 'import-as-copy';
  snapshotId: string;
  localTruthMutated: false;
  overwriteSupported: false;
  manifest: BackupManifest;
  files: RestorePlanFile[];
}

export type PresignMethod = 'PUT' | 'GET' | 'HEAD' | 'DELETE';

export interface PresignMetadata {
  method: PresignMethod;
  region: string;
  bucket: string;
  ownerHash: string;
  targetHash: string;
  snapshotId: string;
  key: string;
  ttlSeconds: number;
  contentType: typeof BACKUP_CONTENT_TYPE;
  ciphertextBytes?: number;
  ciphertextSha256?: string;
}

export interface PresignGrant {
  method: PresignMethod;
  key: string;
  url: string;
  contentType: typeof BACKUP_CONTENT_TYPE;
  expiresAtMs: number;
  ciphertextBytes?: number;
  ciphertextSha256?: string;
}

export interface PresignTransport {
  request(metadata: PresignMetadata): Promise<PresignGrant>;
}

export interface BackupPresignClient {
  request(metadata: PresignMetadata): Promise<PresignGrant>;
}

export interface DirectCiphertextDownload {
  ciphertext: Uint8Array;
  contentLength?: number | null;
}

export interface DirectCiphertextAdapter {
  put(grant: PresignGrant, ciphertext: Uint8Array): Promise<{ bytes: number; sha256: string }>;
  get(grant: PresignGrant): Promise<Uint8Array | DirectCiphertextDownload>;
  head(grant: PresignGrant): Promise<{ exists: boolean; bytes?: number; sha256?: string }>;
  delete(grant: PresignGrant): Promise<void>;
}

export interface BackupRemoteTarget {
  region: string;
  bucket: string;
  ownerHash: string;
  targetHash: string;
}

export interface BackupRemoteObject extends BackupRemoteTarget {
  snapshotId: string;
}

export interface BackupDownloadRequest extends BackupRemoteObject {
  ciphertextBytes: number;
  ciphertextSha256: string;
}

export interface BackupEngineOptions {
  credentialStore: BackupCredentialStore;
  now?: () => number;
  maxSnapshotBytes?: number;
  chunkSize?: number;
  acceptedLogicalSchemaVersions?: readonly string[];
  presignClient?: BackupPresignClient;
  directAdapter?: DirectCiphertextAdapter;
  presignTtlSeconds?: number;
}
