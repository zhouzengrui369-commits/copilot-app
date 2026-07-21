import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

import { BackupProtocolError, failBackup } from './errors.js';
import {
  BACKUP_CRYPTO_VERSION,
  BACKUP_FORMAT,
  type BackupManifest,
  type BackupManifestFile,
  type BackupOuterHeader,
  type BackupScope,
  type CreateBackupInput,
  type InspectedBackupContainer,
} from './types.js';
import {
  assertNoAbsoluteLocalPaths,
  isBackupScope,
  isHexSha256,
  isPlainRecord,
  logicalManifestDigest,
  requireExactKeys,
  sha256,
  stableStringify,
  validateContainerSize,
  validateLogicalPath,
  validateNoCredentialMaterial,
  validatePreferenceBytes,
} from './validation.js';

const MAGIC = Buffer.from(`${BACKUP_FORMAT}\n`, 'utf8');
const OUTER_HEADER_KEYS = [
  'format', 'cryptoVersion', 'snapshotId', 'keyId', 'ciphertextBytes', 'ciphertextSha256', 'chunkSize',
  'chunkCount', 'manifestChunkCount', 'noncePrefix', 'nonceDerivation', 'tagBytes',
] as const;
const MANIFEST_KEYS = [
  'schemaVersion', 'appVersion', 'logicalSchemaVersion', 'createdAtMs', 'selectedScopes', 'sourceRevisions',
  'fileCount', 'recordCount', 'logicalHashSha256', 'files',
] as const;
const MANIFEST_FILE_KEYS = [
  'logicalPath', 'scope', 'bytes', 'plaintextSha256', 'ciphertextSha256', 'ciphertextBytes', 'chunkCount',
  'nonceStart', 'sourceRevision', 'recordCount',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE_PREFIX = /^[a-f0-9]{16}$/;
const FILE_NONCE_START = 0x80000000;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_CHUNK_COUNT = 1_000_000;

interface EncryptedFile {
  manifest: BackupManifestFile;
  chunks: Buffer[];
}

interface ParsedContainer {
  header: BackupOuterHeader;
  payload: Buffer;
  containerSha256: string;
}

interface DecryptedFile {
  manifest: BackupManifestFile;
  data: Uint8Array;
}

export interface DecryptedBackup {
  header: BackupOuterHeader;
  manifest: BackupManifest;
  files: DecryptedFile[];
}

function splitBytes(bytes: Uint8Array, chunkSize: number): Buffer[] {
  if (bytes.byteLength === 0) return [Buffer.alloc(0)];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(Buffer.from(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))));
  }
  return chunks;
}

function nonce(prefix: Buffer, counter: number): Buffer {
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > 0xffffffff) failBackup('ENCRYPT_FAILED');
  const value = Buffer.alloc(12);
  prefix.copy(value, 0);
  value.writeUInt32BE(counter, 8);
  return value;
}

function aad(input: {
  snapshotId: string;
  keyId: string;
  noncePrefix: string;
  section: 'manifest' | 'file';
  chunkIndex: number;
  nonceCounter: number;
  fileIndex?: number;
  logicalPath?: string;
}): Buffer {
  return Buffer.from(stableStringify({
    format: BACKUP_FORMAT,
    cryptoVersion: BACKUP_CRYPTO_VERSION,
    snapshotId: input.snapshotId,
    keyId: input.keyId,
    noncePrefix: input.noncePrefix,
    section: input.section,
    chunkIndex: input.chunkIndex,
    nonceCounter: input.nonceCounter,
    fileIndex: input.fileIndex ?? null,
    logicalPath: input.logicalPath ?? null,
  }), 'utf8');
}

function encryptChunk(plaintext: Uint8Array, key: Uint8Array, nonceValue: Buffer, authenticatedData: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonceValue, { authTagLength: 16 });
  cipher.setAAD(authenticatedData);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function decryptChunk(ciphertextWithTag: Uint8Array, key: Uint8Array, nonceValue: Buffer, authenticatedData: Buffer): Buffer {
  if (ciphertextWithTag.byteLength < 16) failBackup('DECRYPT_FAILED');
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.byteLength - 16);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.byteLength - 16);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonceValue, { authTagLength: 16 });
    decipher.setAAD(authenticatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    failBackup('DECRYPT_FAILED');
  }
}

function frame(chunk: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunk.byteLength, 0);
  return Buffer.concat([length, chunk]);
}

function parseOuter(container: Uint8Array): ParsedContainer {
  const bytes = Buffer.from(container);
  if (bytes.length < MAGIC.length || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) failBackup('SNAPSHOT_VERSION_UNSUPPORTED');
  if (bytes.length < MAGIC.length + 4) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  const headerLength = bytes.readUInt32BE(MAGIC.length);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES || bytes.length < MAGIC.length + 4 + headerLength) {
    failBackup('DOWNLOAD_INTEGRITY_FAILED');
  }
  const headerStart = MAGIC.length + 4;
  const headerEnd = headerStart + headerLength;
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.subarray(headerStart, headerEnd).toString('utf8'));
  } catch {
    failBackup('DOWNLOAD_INTEGRITY_FAILED');
  }
  requireExactKeys(decoded, OUTER_HEADER_KEYS, 'DOWNLOAD_INTEGRITY_FAILED');
  const raw = decoded as Record<string, unknown>;
  if (raw.format !== BACKUP_FORMAT || raw.cryptoVersion !== BACKUP_CRYPTO_VERSION) failBackup('SNAPSHOT_VERSION_UNSUPPORTED');
  if (typeof raw.snapshotId !== 'string' || !UUID.test(raw.snapshotId) || typeof raw.keyId !== 'string' || !UUID.test(raw.keyId)) {
    failBackup('DOWNLOAD_INTEGRITY_FAILED');
  }
  if (!Number.isSafeInteger(raw.ciphertextBytes) || (raw.ciphertextBytes as number) < 0 || !isHexSha256(raw.ciphertextSha256)) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  if (!Number.isSafeInteger(raw.chunkSize) || (raw.chunkSize as number) < 1 || (raw.chunkSize as number) > 8 * 1024 * 1024) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  if (!Number.isSafeInteger(raw.chunkCount) || (raw.chunkCount as number) < 1 || (raw.chunkCount as number) > MAX_CHUNK_COUNT) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  if (!Number.isSafeInteger(raw.manifestChunkCount) || (raw.manifestChunkCount as number) < 1 || (raw.manifestChunkCount as number) > (raw.chunkCount as number)) {
    failBackup('DOWNLOAD_INTEGRITY_FAILED');
  }
  if (typeof raw.noncePrefix !== 'string' || !NONCE_PREFIX.test(raw.noncePrefix) || raw.nonceDerivation !== 'random-64-bit-prefix+uint32be-counter' || raw.tagBytes !== 16) {
    failBackup('DOWNLOAD_INTEGRITY_FAILED');
  }
  const payload = bytes.subarray(headerEnd);
  if (payload.byteLength !== raw.ciphertextBytes || sha256(payload) !== raw.ciphertextSha256) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  return { header: raw as unknown as BackupOuterHeader, payload, containerSha256: sha256(bytes) };
}

function parseFrames(payload: Buffer, expectedCount: number, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < expectedCount; index += 1) {
    if (offset + 4 > payload.length) failBackup('DOWNLOAD_INTEGRITY_FAILED');
    const length = payload.readUInt32BE(offset);
    offset += 4;
    if (length < 16 || length > chunkSize + 16 || offset + length > payload.length) failBackup('DOWNLOAD_INTEGRITY_FAILED');
    chunks.push(payload.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== payload.length) failBackup('DOWNLOAD_INTEGRITY_FAILED');
  return chunks;
}

function requireSafeManifestPath(path: unknown): asserts path is string {
  try {
    validateLogicalPath(path);
  } catch {
    failBackup('DECRYPT_FAILED');
  }
}

function parseManifest(bytes: Uint8Array, acceptedLogicalSchemaVersions: readonly string[]): BackupManifest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    failBackup('DECRYPT_FAILED');
  }
  requireExactKeys(decoded, MANIFEST_KEYS, 'DECRYPT_FAILED');
  const manifest = decoded as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) failBackup('SNAPSHOT_VERSION_UNSUPPORTED');
  if (typeof manifest.appVersion !== 'string' || !manifest.appVersion || manifest.appVersion.length > 128) failBackup('DECRYPT_FAILED');
  if (typeof manifest.logicalSchemaVersion !== 'string' || !acceptedLogicalSchemaVersions.includes(manifest.logicalSchemaVersion)) {
    failBackup('SNAPSHOT_VERSION_UNSUPPORTED');
  }
  if (!Number.isSafeInteger(manifest.createdAtMs) || (manifest.createdAtMs as number) < 0 || !Array.isArray(manifest.selectedScopes) || !isPlainRecord(manifest.sourceRevisions)) {
    failBackup('DECRYPT_FAILED');
  }
  const scopes = new Set<BackupScope>();
  for (const scope of manifest.selectedScopes) {
    if (!isBackupScope(scope) || scopes.has(scope)) failBackup('DECRYPT_FAILED');
    scopes.add(scope);
  }
  for (const [source, revision] of Object.entries(manifest.sourceRevisions)) {
    if (!source || typeof revision !== 'string' || !revision) failBackup('DECRYPT_FAILED');
  }
  try {
    assertNoAbsoluteLocalPaths(manifest.sourceRevisions);
  } catch {
    failBackup('DECRYPT_FAILED');
  }
  if (!Number.isSafeInteger(manifest.fileCount) || (manifest.fileCount as number) < 0 || !Number.isSafeInteger(manifest.recordCount) || (manifest.recordCount as number) < 0) {
    failBackup('DECRYPT_FAILED');
  }
  if (!isHexSha256(manifest.logicalHashSha256) || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) failBackup('DECRYPT_FAILED');

  const paths = new Set<string>();
  let recordCount = 0;
  let expectedNonce = FILE_NONCE_START;
  for (const value of manifest.files) {
    requireExactKeys(value, MANIFEST_FILE_KEYS, 'DECRYPT_FAILED');
    const file = value as Record<string, unknown>;
    requireSafeManifestPath(file.logicalPath);
    if (paths.has(file.logicalPath)) failBackup('DECRYPT_FAILED');
    paths.add(file.logicalPath);
    if (!isBackupScope(file.scope) || !scopes.has(file.scope)) failBackup('DECRYPT_FAILED');
    if (!Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0 || !isHexSha256(file.plaintextSha256) || !isHexSha256(file.ciphertextSha256)) failBackup('DECRYPT_FAILED');
    if (!Number.isSafeInteger(file.ciphertextBytes) || (file.ciphertextBytes as number) < 16 || !Number.isSafeInteger(file.chunkCount) || (file.chunkCount as number) < 1) failBackup('DECRYPT_FAILED');
    if (!Number.isSafeInteger(file.nonceStart) || file.nonceStart !== expectedNonce || expectedNonce + (file.chunkCount as number) - 1 > 0xffffffff) failBackup('DECRYPT_FAILED');
    expectedNonce += file.chunkCount as number;
    if (file.sourceRevision !== null && (typeof file.sourceRevision !== 'string' || !file.sourceRevision)) failBackup('DECRYPT_FAILED');
    if (file.sourceRevision !== null) {
      try {
        assertNoAbsoluteLocalPaths(file.sourceRevision);
      } catch {
        failBackup('DECRYPT_FAILED');
      }
    }
    if (!Number.isSafeInteger(file.recordCount) || (file.recordCount as number) < 0) failBackup('DECRYPT_FAILED');
    recordCount += file.recordCount as number;
  }
  if (recordCount !== manifest.recordCount) failBackup('DECRYPT_FAILED');
  const typed = manifest as unknown as BackupManifest;
  if (logicalManifestDigest(typed) !== typed.logicalHashSha256) failBackup('DECRYPT_FAILED');
  return typed;
}

export function createEncryptedContainer(input: CreateBackupInput, key: Uint8Array, chunkSize: number, nowMs: number, maxSnapshotBytes: number): {
  container: Uint8Array;
  header: BackupOuterHeader;
  containerSha256: string;
} {
  if (key.byteLength !== 32) failBackup('ENCRYPT_FAILED');
  const sourceBytes = input.files.reduce((total, file) => total + file.data.byteLength, 0);
  validateContainerSize(sourceBytes, maxSnapshotBytes);
  assertNoAbsoluteLocalPaths({
    sourceRevisions: input.sourceRevisions,
    fileSourceRevisions: input.files.map((file) => file.sourceRevision ?? null),
  });
  const snapshotId = randomUUID();
  const keyId = randomUUID();
  const noncePrefixBytes = randomBytes(8);
  const noncePrefix = noncePrefixBytes.toString('hex');

  try {
    let nextCounter = FILE_NONCE_START;
    const encryptedFiles: EncryptedFile[] = input.files.map((file, fileIndex) => {
      const nonceStart = nextCounter;
      const chunks = splitBytes(file.data, chunkSize).map((plaintext, chunkIndex) => {
        const counter = nonceStart + chunkIndex;
        if (counter > 0xffffffff) failBackup('ENCRYPT_FAILED');
        return encryptChunk(plaintext, key, nonce(noncePrefixBytes, counter), aad({
          snapshotId, keyId, noncePrefix, section: 'file', fileIndex, logicalPath: file.logicalPath,
          chunkIndex, nonceCounter: counter,
        }));
      });
      nextCounter += chunks.length;
      const ciphertext = Buffer.concat(chunks);
      return {
        chunks,
        manifest: {
          logicalPath: file.logicalPath,
          scope: file.scope,
          bytes: file.data.byteLength,
          plaintextSha256: sha256(file.data),
          ciphertextSha256: sha256(ciphertext),
          ciphertextBytes: ciphertext.byteLength,
          chunkCount: chunks.length,
          nonceStart,
          sourceRevision: file.sourceRevision ?? null,
          recordCount: file.recordCount ?? 0,
        },
      };
    });
    const manifestBase = {
      schemaVersion: 1 as const,
      appVersion: input.appVersion,
      logicalSchemaVersion: input.logicalSchemaVersion,
      createdAtMs: nowMs,
      selectedScopes: [...input.selectedScopes],
      sourceRevisions: { ...input.sourceRevisions },
      fileCount: encryptedFiles.length,
      recordCount: encryptedFiles.reduce((total, file) => total + file.manifest.recordCount, 0),
      files: encryptedFiles.map((file) => file.manifest),
    };
    const manifest: BackupManifest = {
      ...manifestBase,
      logicalHashSha256: logicalManifestDigest(manifestBase),
    };
    const manifestBytes = Buffer.from(stableStringify(manifest), 'utf8');
    const manifestChunks = splitBytes(manifestBytes, chunkSize).map((plaintext, chunkIndex) => encryptChunk(
      plaintext,
      key,
      nonce(noncePrefixBytes, chunkIndex),
      aad({ snapshotId, keyId, noncePrefix, section: 'manifest', chunkIndex, nonceCounter: chunkIndex }),
    ));
    if (manifestChunks.length >= FILE_NONCE_START) failBackup('ENCRYPT_FAILED');
    const allChunks = [...manifestChunks, ...encryptedFiles.flatMap((file) => file.chunks)];
    const payload = Buffer.concat(allChunks.map(frame));
    const header: BackupOuterHeader = {
      format: BACKUP_FORMAT,
      cryptoVersion: BACKUP_CRYPTO_VERSION,
      snapshotId,
      keyId,
      ciphertextBytes: payload.byteLength,
      ciphertextSha256: sha256(payload),
      chunkSize,
      chunkCount: allChunks.length,
      manifestChunkCount: manifestChunks.length,
      noncePrefix,
      nonceDerivation: 'random-64-bit-prefix+uint32be-counter',
      tagBytes: 16,
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLength = Buffer.alloc(4);
    headerLength.writeUInt32BE(headerBytes.byteLength, 0);
    const container = Buffer.concat([MAGIC, headerLength, headerBytes, payload]);
    validateContainerSize(container.byteLength, maxSnapshotBytes);
    return { container, header, containerSha256: sha256(container) };
  } catch (error) {
    if (error instanceof BackupProtocolError) throw error;
    failBackup('ENCRYPT_FAILED');
  }
}

export function inspectBackupContainer(container: Uint8Array): InspectedBackupContainer {
  const parsed = parseOuter(container);
  return {
    header: { ...parsed.header },
    payloadBytes: parsed.payload.byteLength,
    payloadSha256: sha256(parsed.payload),
    containerBytes: container.byteLength,
    containerSha256: parsed.containerSha256,
  };
}

export function decryptAndValidateContainer(container: Uint8Array, key: Uint8Array, acceptedLogicalSchemaVersions: readonly string[]): DecryptedBackup {
  if (key.byteLength !== 32) failBackup('KEY_UNAVAILABLE');
  const parsed = parseOuter(container);
  const frames = parseFrames(parsed.payload, parsed.header.chunkCount, parsed.header.chunkSize);
  const noncePrefixBytes = Buffer.from(parsed.header.noncePrefix, 'hex');
  const manifestPlaintext = Buffer.concat(frames.slice(0, parsed.header.manifestChunkCount).map((chunk, chunkIndex) => decryptChunk(
    chunk,
    key,
    nonce(noncePrefixBytes, chunkIndex),
    aad({
      snapshotId: parsed.header.snapshotId,
      keyId: parsed.header.keyId,
      noncePrefix: parsed.header.noncePrefix,
      section: 'manifest',
      chunkIndex,
      nonceCounter: chunkIndex,
    }),
  )));
  const manifest = parseManifest(manifestPlaintext, acceptedLogicalSchemaVersions);
  const expectedFileChunkCount = manifest.files.reduce((total, file) => total + file.chunkCount, 0);
  if (parsed.header.manifestChunkCount + expectedFileChunkCount !== parsed.header.chunkCount) failBackup('DECRYPT_FAILED');

  let frameIndex = parsed.header.manifestChunkCount;
  const files: DecryptedFile[] = manifest.files.map((file, fileIndex) => {
    const chunks = frames.slice(frameIndex, frameIndex + file.chunkCount);
    frameIndex += file.chunkCount;
    const ciphertext = Buffer.concat(chunks);
    if (ciphertext.byteLength !== file.ciphertextBytes || sha256(ciphertext) !== file.ciphertextSha256) failBackup('DECRYPT_FAILED');
    const plaintext = Buffer.concat(chunks.map((chunk, chunkIndex) => {
      const counter = file.nonceStart + chunkIndex;
      return decryptChunk(chunk, key, nonce(noncePrefixBytes, counter), aad({
        snapshotId: parsed.header.snapshotId,
        keyId: parsed.header.keyId,
        noncePrefix: parsed.header.noncePrefix,
        section: 'file',
        fileIndex,
        logicalPath: file.logicalPath,
        chunkIndex,
        nonceCounter: counter,
      }));
    }));
    if (plaintext.byteLength !== file.bytes || sha256(plaintext) !== file.plaintextSha256) failBackup('DECRYPT_FAILED');
    try {
      validateNoCredentialMaterial(plaintext);
    } catch {
      failBackup('DECRYPT_FAILED');
    }
    if (file.scope === 'preferences') {
      try {
        validatePreferenceBytes(plaintext);
      } catch {
        failBackup('DECRYPT_FAILED');
      }
    }
    return { manifest: file, data: plaintext };
  });
  if (frameIndex !== frames.length) failBackup('DECRYPT_FAILED');
  return { header: parsed.header, manifest, files };
}
