import { randomBytes } from 'node:crypto';

import { requireCommandConsent } from './consent.js';
import { createEncryptedContainer, decryptAndValidateContainer, inspectBackupContainer } from './container.js';
import { failBackup } from './errors.js';
import {
  BACKUP_CONTENT_TYPE,
  DEFAULT_BACKUP_CHUNK_BYTES,
  DEFAULT_BACKUP_MAX_BYTES,
  type BackupDownloadRequest,
  type BackupEngineOptions,
  type BackupRemoteObject,
  type BackupRemoteTarget,
  type CreatedBackup,
  type CreateBackupInput,
  type DirectCiphertextDownload,
  type PresignMetadata,
  type RestorePlan,
  type RestoreTempStore,
} from './types.js';
import { createBackupRequestDigest, isHexSha256, sha256, validateContainerSize, validateCreateInput } from './validation.js';

const DEFAULT_LOGICAL_SCHEMAS = ['phase1-v1'] as const;

function remoteKey(target: BackupRemoteTarget, snapshotId: string): string {
  return `backup/v1/${target.ownerHash}/${target.targetHash}/${snapshotId}.cbackup`;
}

export class BackupEngine {
  private readonly now: () => number;
  private readonly maxSnapshotBytes: number;
  private readonly chunkSize: number;
  private readonly acceptedLogicalSchemaVersions: readonly string[];
  private readonly presignTtlSeconds: number;

  constructor(private readonly options: BackupEngineOptions) {
    this.now = options.now ?? Date.now;
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_BACKUP_MAX_BYTES;
    this.chunkSize = options.chunkSize ?? DEFAULT_BACKUP_CHUNK_BYTES;
    this.acceptedLogicalSchemaVersions = options.acceptedLogicalSchemaVersions ?? DEFAULT_LOGICAL_SCHEMAS;
    this.presignTtlSeconds = options.presignTtlSeconds ?? 300;
    if (!Number.isSafeInteger(this.maxSnapshotBytes) || this.maxSnapshotBytes < 1) failBackup('SNAPSHOT_TOO_LARGE');
    if (!Number.isSafeInteger(this.chunkSize) || this.chunkSize < 1 || this.chunkSize > 8 * 1024 * 1024) failBackup('ENCRYPT_FAILED');
    if (this.acceptedLogicalSchemaVersions.length === 0 || this.acceptedLogicalSchemaVersions.some((value) => !value)) failBackup('SNAPSHOT_VERSION_UNSUPPORTED');
    if (!Number.isSafeInteger(this.presignTtlSeconds) || this.presignTtlSeconds < 1 || this.presignTtlSeconds > 300) failBackup('PRESIGN_FORBIDDEN');
  }

  async create(input: CreateBackupInput, authorization: Parameters<typeof requireCommandConsent>[0]): Promise<CreatedBackup> {
    this.requireEnabled(authorization);
    validateCreateInput(input);
    requireCommandConsent(authorization, 'create', createBackupRequestDigest(input), undefined);
    const key = randomBytes(32);
    const encrypted = createEncryptedContainer(input, key, this.chunkSize, this.now(), this.maxSnapshotBytes);
    try {
      await this.options.credentialStore.putDataKey(encrypted.header.keyId, new Uint8Array(key));
    } catch {
      try {
        await this.options.credentialStore.deleteDataKey(encrypted.header.keyId);
      } catch {
        // Credential cleanup is best-effort; no container is returned when persistence fails.
      }
      failBackup('KEY_UNAVAILABLE');
    } finally {
      key.fill(0);
    }
    return {
      container: encrypted.container,
      snapshotId: encrypted.header.snapshotId,
      keyId: encrypted.header.keyId,
      containerBytes: encrypted.container.byteLength,
      containerSha256: encrypted.containerSha256,
      ciphertextBytes: encrypted.header.ciphertextBytes,
      ciphertextSha256: encrypted.header.ciphertextSha256,
    };
  }

  async restoreToTemp(
    container: Uint8Array,
    authorization: Parameters<typeof requireCommandConsent>[0],
    tempStore: RestoreTempStore,
  ): Promise<RestorePlan> {
    this.requireEnabled(authorization);
    validateContainerSize(container.byteLength, this.maxSnapshotBytes);
    const inspection = inspectBackupContainer(container);
    requireCommandConsent(authorization, 'restore', inspection.containerSha256, inspection.header.snapshotId);
    let key: Uint8Array | null;
    try {
      key = await this.options.credentialStore.getDataKey(inspection.header.keyId);
    } catch {
      failBackup('KEY_UNAVAILABLE');
    }
    if (!key || key.byteLength !== 32) failBackup('KEY_UNAVAILABLE');
    const workingKey = new Uint8Array(key);
    let restored: ReturnType<typeof decryptAndValidateContainer>;
    try {
      restored = decryptAndValidateContainer(container, workingKey, this.acceptedLogicalSchemaVersions);
    } finally {
      workingKey.fill(0);
    }
    for (const file of restored.files) {
      try {
        await tempStore.write(file.manifest.logicalPath, new Uint8Array(file.data));
      } catch {
        failBackup('RESTORE_CONFLICT');
      }
    }
    return {
      mode: 'import-as-copy',
      snapshotId: restored.header.snapshotId,
      localTruthMutated: false,
      overwriteSupported: false,
      manifest: restored.manifest,
      files: restored.files.map((file) => ({
        logicalPath: file.manifest.logicalPath,
        importPath: `imports/${restored.header.snapshotId}/${file.manifest.logicalPath}`,
        bytes: file.manifest.bytes,
        plaintextSha256: file.manifest.plaintextSha256,
        scope: file.manifest.scope,
      })),
    };
  }

  async upload(
    container: Uint8Array,
    target: BackupRemoteTarget,
    authorization: Parameters<typeof requireCommandConsent>[0],
  ): Promise<{ snapshotId: string; bytes: number; sha256: string }> {
    this.requireEnabled(authorization);
    validateContainerSize(container.byteLength, this.maxSnapshotBytes);
    const inspection = inspectBackupContainer(container);
    requireCommandConsent(authorization, 'upload', inspection.containerSha256, inspection.header.snapshotId);
    const { presignClient, directAdapter } = this.requireRemoteAdapters();
    const metadata = this.presignMetadata('PUT', target, inspection.header.snapshotId, {
      ciphertextBytes: inspection.containerBytes,
      ciphertextSha256: inspection.containerSha256,
    });
    const grant = await presignClient.request(metadata);
    let receipt: { bytes: number; sha256: string };
    try {
      receipt = await directAdapter.put(grant, new Uint8Array(container));
    } catch {
      failBackup('COS_UNAVAILABLE');
    }
    if (receipt.bytes !== inspection.containerBytes || receipt.sha256 !== inspection.containerSha256) failBackup('UPLOAD_INTEGRITY_FAILED');
    return { snapshotId: inspection.header.snapshotId, bytes: receipt.bytes, sha256: receipt.sha256 };
  }

  async download(request: BackupDownloadRequest, authorization: Parameters<typeof requireCommandConsent>[0]): Promise<Uint8Array> {
    this.requireEnabled(authorization);
    if (!isHexSha256(request.ciphertextSha256) || !Number.isSafeInteger(request.ciphertextBytes) || request.ciphertextBytes < 1) {
      failBackup('DOWNLOAD_INTEGRITY_FAILED');
    }
    validateContainerSize(request.ciphertextBytes, this.maxSnapshotBytes);
    requireCommandConsent(authorization, 'download', request.ciphertextSha256, request.snapshotId);
    const { presignClient, directAdapter } = this.requireRemoteAdapters();
    const grant = await presignClient.request(this.presignMetadata('GET', request, request.snapshotId));
    let response: Uint8Array | DirectCiphertextDownload;
    try {
      response = await directAdapter.get(grant);
    } catch {
      failBackup('COS_UNAVAILABLE');
    }
    const container = this.requireBoundedDownload(response);
    if (container.byteLength !== request.ciphertextBytes || sha256(container) !== request.ciphertextSha256) failBackup('DOWNLOAD_INTEGRITY_FAILED');
    let inspection: ReturnType<typeof inspectBackupContainer>;
    try {
      inspection = inspectBackupContainer(container);
    } catch {
      failBackup('DOWNLOAD_INTEGRITY_FAILED');
    }
    if (inspection.header.snapshotId !== request.snapshotId) failBackup('DOWNLOAD_INTEGRITY_FAILED');
    return new Uint8Array(container);
  }

  async deleteRemote(target: BackupRemoteObject, authorization: Parameters<typeof requireCommandConsent>[0]): Promise<void> {
    this.requireEnabled(authorization);
    requireCommandConsent(authorization, 'delete', target.snapshotId, target.snapshotId, 'DELETE_APPROVAL_REQUIRED');
    const { presignClient, directAdapter } = this.requireRemoteAdapters();
    const deleteGrant = await presignClient.request(this.presignMetadata('DELETE', target, target.snapshotId));
    try {
      await directAdapter.delete(deleteGrant);
    } catch {
      failBackup('DELETE_FAILED');
    }
    const headGrant = await presignClient.request(this.presignMetadata('HEAD', target, target.snapshotId));
    let head: { exists: boolean; bytes?: number; sha256?: string };
    try {
      head = await directAdapter.head(headGrant);
    } catch {
      failBackup('DELETE_FAILED');
    }
    if (head.exists) failBackup('DELETE_FAILED');
  }

  private requireRemoteAdapters() {
    if (!this.options.presignClient || !this.options.directAdapter) failBackup('COS_UNAVAILABLE');
    return { presignClient: this.options.presignClient, directAdapter: this.options.directAdapter };
  }

  private requireBoundedDownload(response: Uint8Array | DirectCiphertextDownload): Uint8Array {
    if (response !== null && typeof response === 'object' && !Buffer.isBuffer(response) && !(response instanceof Uint8Array)) {
      const candidate = response as DirectCiphertextDownload & { contentLength?: unknown };
      if (Number.isSafeInteger(candidate.contentLength) && (candidate.contentLength as number) >= 0) {
        validateContainerSize(candidate.contentLength as number, this.maxSnapshotBytes);
      }
      if (!Buffer.isBuffer(candidate.ciphertext) && !(candidate.ciphertext instanceof Uint8Array)) failBackup('DOWNLOAD_INTEGRITY_FAILED');
      validateContainerSize(candidate.ciphertext.byteLength, this.maxSnapshotBytes);
      return candidate.ciphertext;
    }
    const container = response as Uint8Array;
    validateContainerSize(container.byteLength, this.maxSnapshotBytes);
    return container;
  }

  private requireEnabled(authorization: Parameters<typeof requireCommandConsent>[0]): void {
    if (authorization.backupEnabled !== true) failBackup('BACKUP_DISABLED');
  }

  private presignMetadata(
    method: PresignMetadata['method'],
    target: BackupRemoteTarget,
    snapshotId: string,
    integrity?: { ciphertextBytes: number; ciphertextSha256: string },
  ): PresignMetadata {
    const common = {
      method,
      region: target.region,
      bucket: target.bucket,
      ownerHash: target.ownerHash,
      targetHash: target.targetHash,
      snapshotId,
      key: remoteKey(target, snapshotId),
      ttlSeconds: this.presignTtlSeconds,
      contentType: BACKUP_CONTENT_TYPE,
    };
    return method === 'PUT' ? { ...common, ...integrity } : common;
  }
}
