import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_CRYPTO_VERSION,
  BACKUP_FORMAT,
  DEFAULT_BACKUP_MAX_BYTES,
  BackupEngine,
  createBackupRequestDigest,
  type BackupCommand,
  type BackupCommandAuthorization,
  type BackupCredentialStore,
  type BackupManifest,
  type BackupOuterHeader,
  type BackupPresignClient,
  type CreateBackupInput,
  type DirectCiphertextAdapter,
  type PresignGrant,
  type PresignMetadata,
  type RestoreTempStore,
} from '../../src/main/backup/index.js';
import { logicalManifestDigest, stableStringify } from '../../src/main/backup/validation.js';

const NOW = 1_725_000_000_000;
const OWNER = 'a'.repeat(64);
const TARGET = 'b'.repeat(64);
const SMALL_LIMIT = 300;

class RecordingCredentialStore implements BackupCredentialStore {
  readonly values = new Map<string, Uint8Array>();
  getCalls = 0;

  async putDataKey(keyId: string, key: Uint8Array): Promise<void> {
    this.values.set(keyId, new Uint8Array(key));
  }

  async getDataKey(keyId: string): Promise<Uint8Array | null> {
    this.getCalls += 1;
    const value = this.values.get(keyId);
    return value ? new Uint8Array(value) : null;
  }

  async deleteDataKey(keyId: string): Promise<void> {
    this.values.delete(keyId);
  }
}

class RecordingTempStore implements RestoreTempStore {
  readonly writes = new Map<string, Uint8Array>();

  async write(relativePath: string, data: Uint8Array): Promise<void> {
    this.writes.set(relativePath, new Uint8Array(data));
  }
}

class RecordingPresignClient implements BackupPresignClient {
  readonly requests: PresignMetadata[] = [];

  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    this.requests.push(structuredClone(metadata));
    return {
      method: metadata.method,
      key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?signature=redacted`,
      contentType: metadata.contentType,
      expiresAtMs: NOW + 60_000,
    };
  }
}

class DownloadResponseAdapter implements DirectCiphertextAdapter {
  getCalls = 0;
  putCalls = 0;
  response: unknown = new Uint8Array();

  async put(_grant: PresignGrant, ciphertext: Uint8Array): Promise<{ bytes: number; sha256: string }> {
    this.putCalls += 1;
    return { bytes: ciphertext.byteLength, sha256: sha256(ciphertext) };
  }

  async get(): Promise<Uint8Array> {
    this.getCalls += 1;
    return this.response as Uint8Array;
  }

  async head(): Promise<{ exists: boolean }> {
    return { exists: false };
  }

  async delete(): Promise<void> {
    throw new Error('not used');
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function authorization(command: BackupCommand, resourceDigest: string, snapshotId?: string): BackupCommandAuthorization {
  return {
    backupEnabled: true,
    nowMs: NOW,
    consent: {
      approved: true,
      command,
      requestId: `r2-${command}`,
      resourceDigest,
      snapshotId,
      approvedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
    },
  };
}

function safeInput(): CreateBackupInput {
  return {
    appVersion: '0.1.0',
    logicalSchemaVersion: 'phase1-v1',
    selectedScopes: ['note-markdown'],
    sourceRevisions: { notes: 'revision-7' },
    files: [{
      logicalPath: 'notes/a.md',
      scope: 'note-markdown',
      data: Buffer.from('# local note'),
      sourceRevision: 'revision-7',
    }],
  };
}

async function createSafe(store: RecordingCredentialStore) {
  const engine = new BackupEngine({ credentialStore: store, now: () => NOW, maxSnapshotBytes: 16_384, chunkSize: 64 });
  const input = safeInput();
  return engine.create(input, authorization('create', createBackupRequestDigest(input)));
}

function aad(header: BackupOuterHeader, input: {
  section: 'manifest' | 'file';
  chunkIndex: number;
  nonceCounter: number;
  fileIndex?: number;
  logicalPath?: string;
}): Buffer {
  return Buffer.from(stableStringify({
    format: BACKUP_FORMAT,
    cryptoVersion: BACKUP_CRYPTO_VERSION,
    snapshotId: header.snapshotId,
    keyId: header.keyId,
    noncePrefix: header.noncePrefix,
    section: input.section,
    chunkIndex: input.chunkIndex,
    nonceCounter: input.nonceCounter,
    fileIndex: input.fileIndex ?? null,
    logicalPath: input.logicalPath ?? null,
  }));
}

function nonce(header: BackupOuterHeader, counter: number): Buffer {
  const value = Buffer.alloc(12);
  Buffer.from(header.noncePrefix, 'hex').copy(value);
  value.writeUInt32BE(counter, 8);
  return value;
}

function frame(chunk: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunk.byteLength);
  return Buffer.concat([length, chunk]);
}

function decryptManifestChunk(header: BackupOuterHeader, key: Uint8Array, chunk: Buffer, index: number): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce(header, index), { authTagLength: 16 });
  decipher.setAAD(aad(header, { section: 'manifest', chunkIndex: index, nonceCounter: index }));
  decipher.setAuthTag(chunk.subarray(chunk.length - 16));
  return Buffer.concat([decipher.update(chunk.subarray(0, chunk.length - 16)), decipher.final()]);
}

function encryptManifestChunk(header: BackupOuterHeader, key: Uint8Array, chunk: Buffer, index: number): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce(header, index), { authTagLength: 16 });
  cipher.setAAD(aad(header, { section: 'manifest', chunkIndex: index, nonceCounter: index }));
  return Buffer.concat([cipher.update(chunk), cipher.final(), cipher.getAuthTag()]);
}

function parseFrames(payload: Buffer, count: number): Buffer[] {
  const frames: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const length = payload.readUInt32BE(offset);
    offset += 4;
    frames.push(Buffer.from(payload.subarray(offset, offset + length)));
    offset += length;
  }
  expect(offset).toBe(payload.length);
  return frames;
}

function forgeManifest(
  container: Uint8Array,
  key: Uint8Array,
  mutate: (manifest: BackupManifest) => void,
): Uint8Array {
  const bytes = Buffer.from(container);
  const magic = Buffer.from(`${BACKUP_FORMAT}\n`);
  const headerLength = bytes.readUInt32BE(magic.length);
  const headerStart = magic.length + 4;
  const headerEnd = headerStart + headerLength;
  const header = JSON.parse(bytes.subarray(headerStart, headerEnd).toString('utf8')) as BackupOuterHeader;
  const frames = parseFrames(bytes.subarray(headerEnd), header.chunkCount);
  const manifest = JSON.parse(Buffer.concat(
    frames.slice(0, header.manifestChunkCount).map((chunk, index) => decryptManifestChunk(header, key, chunk, index)),
  ).toString('utf8')) as BackupManifest;

  mutate(manifest);
  manifest.logicalHashSha256 = logicalManifestDigest(manifest);
  const manifestBytes = Buffer.from(stableStringify(manifest));
  const plaintextChunks: Buffer[] = [];
  for (let offset = 0; offset < manifestBytes.length; offset += header.chunkSize) {
    plaintextChunks.push(manifestBytes.subarray(offset, Math.min(offset + header.chunkSize, manifestBytes.length)));
  }
  const manifestFrames = plaintextChunks.map((chunk, index) => encryptManifestChunk(header, key, chunk, index));
  const fileFrames = frames.slice(header.manifestChunkCount);
  const payload = Buffer.concat([...manifestFrames, ...fileFrames].map(frame));
  header.manifestChunkCount = manifestFrames.length;
  header.chunkCount = manifestFrames.length + fileFrames.length;
  header.ciphertextBytes = payload.byteLength;
  header.ciphertextSha256 = sha256(payload);
  const nextHeader = Buffer.from(JSON.stringify(header));
  const nextHeaderLength = Buffer.alloc(4);
  nextHeaderLength.writeUInt32BE(nextHeader.byteLength);
  return Buffer.concat([magic, nextHeaderLength, nextHeader, payload]);
}

async function expectStaticError(promise: Promise<unknown>, code: string, forbiddenPath?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
  if (forbiddenPath) expect(String((caught as Error).message)).not.toContain(forbiddenPath);
}

describe('Backup A r2 size and absolute-source-path closure', () => {
  it('allows upload at the exact actual-byte limit and rejects limit + 1 before presign or PUT', async () => {
    const store = new RecordingCredentialStore();
    const created = await createSafe(store);
    const target = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET };
    const exactPresign = new RecordingPresignClient();
    const exactDirect = new DownloadResponseAdapter();
    const exactEngine = new BackupEngine({
      credentialStore: store,
      now: () => NOW,
      maxSnapshotBytes: created.container.byteLength,
      presignClient: exactPresign,
      directAdapter: exactDirect,
    });

    await expect(exactEngine.upload(
      created.container,
      target,
      authorization('upload', created.containerSha256, created.snapshotId),
    )).resolves.toEqual({
      snapshotId: created.snapshotId,
      bytes: created.container.byteLength,
      sha256: created.containerSha256,
    });
    expect(exactPresign.requests).toHaveLength(1);
    expect(exactDirect.putCalls).toBe(1);

    const overPresign = new RecordingPresignClient();
    const overDirect = new DownloadResponseAdapter();
    const overEngine = new BackupEngine({
      credentialStore: store,
      now: () => NOW,
      maxSnapshotBytes: created.container.byteLength - 1,
      presignClient: overPresign,
      directAdapter: overDirect,
    });
    await expect(overEngine.upload(
      created.container,
      target,
      authorization('upload', created.containerSha256, created.snapshotId),
    )).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(overPresign.requests).toHaveLength(0);
    expect(overDirect.putCalls).toBe(0);
  });

  it('enforces the default upload limit before parsing without allocating 256 MiB', async () => {
    const store = new RecordingCredentialStore();
    const presign = new RecordingPresignClient();
    const direct = new DownloadResponseAdapter();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, presignClient: presign, directAdapter: direct });
    const tinyProxy = new Proxy(new Uint8Array([0]), {
      get(target, property) {
        if (property === 'byteLength') return DEFAULT_BACKUP_MAX_BYTES + 1;
        return Reflect.get(target, property, target);
      },
    });

    await expect(engine.upload(
      tinyProxy,
      { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET },
      authorization('upload', '0'.repeat(64), '10000000-0000-4000-8000-000000000004'),
    )).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(presign.requests).toHaveLength(0);
    expect(direct.putCalls).toBe(0);
  });

  it('rejects restore above the injected limit before parse, key access, decrypt, or temp writes', async () => {
    const store = new RecordingCredentialStore();
    const created = await createSafe(store);
    expect(created.container.byteLength).toBeGreaterThan(SMALL_LIMIT);
    store.getCalls = 0;
    const temp = new RecordingTempStore();
    const consumer = new BackupEngine({ credentialStore: store, now: () => NOW, maxSnapshotBytes: SMALL_LIMIT });

    await expect(consumer.restoreToTemp(
      created.container,
      authorization('restore', created.containerSha256, created.snapshotId),
      temp,
    )).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(store.getCalls).toBe(0);
    expect(temp.writes.size).toBe(0);
  });

  it('enforces the 256 MiB default without allocating a 256 MiB test buffer', async () => {
    expect(DEFAULT_BACKUP_MAX_BYTES).toBe(256 * 1024 * 1024);
    const store = new RecordingCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW });
    const tinyProxy = new Proxy(new Uint8Array([0]), {
      get(target, property) {
        if (property === 'byteLength') return DEFAULT_BACKUP_MAX_BYTES + 1;
        return Reflect.get(target, property, target);
      },
    });

    await expect(engine.restoreToTemp(
      tinyProxy,
      authorization('restore', '0'.repeat(64), '10000000-0000-4000-8000-000000000001'),
      new RecordingTempStore(),
    )).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(store.getCalls).toBe(0);
  });

  it('rejects an over-limit declared download before presign or direct GET', async () => {
    const store = new RecordingCredentialStore();
    const presign = new RecordingPresignClient();
    const direct = new DownloadResponseAdapter();
    const engine = new BackupEngine({
      credentialStore: store,
      now: () => NOW,
      maxSnapshotBytes: SMALL_LIMIT,
      presignClient: presign,
      directAdapter: direct,
    });
    const snapshotId = '10000000-0000-4000-8000-000000000002';
    const digest = 'c'.repeat(64);

    await expect(engine.download({
      region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId, ciphertextBytes: SMALL_LIMIT + 1, ciphertextSha256: digest,
    }, authorization('download', digest, snapshotId))).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(presign.requests).toHaveLength(0);
    expect(direct.getCalls).toBe(0);
  });

  it('rejects an over-limit Content-Length before inspecting otherwise valid ciphertext', async () => {
    const store = new RecordingCredentialStore();
    const created = await createSafe(store);
    const limit = created.container.byteLength + 10;
    const presign = new RecordingPresignClient();
    const direct = new DownloadResponseAdapter();
    direct.response = { ciphertext: created.container, contentLength: limit + 1 };
    const engine = new BackupEngine({
      credentialStore: store, now: () => NOW, maxSnapshotBytes: limit, presignClient: presign, directAdapter: direct,
    });

    await expect(engine.download({
      region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId: created.snapshotId, ciphertextBytes: created.container.byteLength, ciphertextSha256: created.containerSha256,
    }, authorization('download', created.containerSha256, created.snapshotId)))
      .rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(direct.getCalls).toBe(1);
    expect(store.getCalls).toBe(0);
  });

  it.each([
    ['forged small Content-Length', 1],
    ['missing Content-Length', undefined],
    ['malformed Content-Length', '301'],
  ])('falls back to actual bytes for %s', async (_label, contentLength) => {
    const store = new RecordingCredentialStore();
    const presign = new RecordingPresignClient();
    const direct = new DownloadResponseAdapter();
    const actual = Buffer.alloc(SMALL_LIMIT + 1, 7);
    direct.response = { ciphertext: actual, contentLength };
    const engine = new BackupEngine({
      credentialStore: store, now: () => NOW, maxSnapshotBytes: SMALL_LIMIT, presignClient: presign, directAdapter: direct,
    });
    const snapshotId = '10000000-0000-4000-8000-000000000003';
    const digest = sha256(actual);

    await expect(engine.download({
      region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId, ciphertextBytes: SMALL_LIMIT, ciphertextSha256: digest,
    }, authorization('download', digest, snapshotId))).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(direct.getCalls).toBe(1);
    expect(store.getCalls).toBe(0);
  });

  it('rejects absolute or disguised local paths in revision keys/values and per-file source revisions at create', async () => {
    const forbiddenPaths = [
      '/Users/njx/private/notes.db',
      'C:\\Users\\njx\\private\\notes.db',
      'C:/Users/njx/private/notes.db',
      '\\\\server\\share\\notes.db',
      'file:///Users/njx/private/notes.db',
      '／Users／njx／private／notes.db',
      '%2FUsers%2Fnjx%2Fprivate%2Fnotes.db',
      'file:%2F%2F%2FUsers%2Fnjx%2Fprivate%2Fnotes.db',
      '%2FUsers%2Fnjx%2Fprivate%2Fnotes.db%ZZ',
      '%252FUsers%252Fnjx%252Fprivate%252Fnotes.db%ZZ',
      '%25252FUsers%25252Fnjx%25252Fprivate%25252Fnotes.db%ZZ',
      '%2FUsers%5Cnjx%2Fprivate%5Cnotes.db%ZZ',
      '%5C%5Cserver%5Cshare%5Cnotes.db%ZZ',
      'C%3A%5CUsers%5Cnjx%5Cprivate%5Cnotes.db%ZZ',
      'file%3A%2F%2F%2FUsers%2Fnjx%2Fprivate%2Fnotes.db%ZZ',
      `revision-${String.fromCharCode(1)}-/Users/njx/private/notes.db`,
    ];

    for (const forbiddenPath of forbiddenPaths) {
      for (const target of ['key', 'value', 'file'] as const) {
        const store = new RecordingCredentialStore();
        const engine = new BackupEngine({ credentialStore: store, now: () => NOW, maxSnapshotBytes: 16_384 });
        const input = safeInput();
        if (target === 'key') input.sourceRevisions = { [forbiddenPath]: 'revision-7' };
        if (target === 'value') input.sourceRevisions = { notes: forbiddenPath };
        if (target === 'file') input.files[0]!.sourceRevision = forbiddenPath;

        await expectStaticError(
          engine.create(input, authorization('create', createBackupRequestDigest(input))),
          'SCOPE_INVALID',
          forbiddenPath,
        );
        expect(store.values.size).toBe(0);
      }
    }
  });

  it('rejects the same path classes after decrypting a legacy encrypted manifest with zero temp writes', async () => {
    const forbiddenPaths = [
      '/Users/njx/private/notes.db',
      'C:\\Users\\njx\\private\\notes.db',
      '\\\\server\\share\\notes.db',
      'file:///Users/njx/private/notes.db',
      '／Users／njx／private／notes.db',
      '%2FUsers%2Fnjx%2Fprivate%2Fnotes.db',
      '%2FUsers%2Fnjx%2Fprivate%2Fnotes.db%ZZ',
      '%252FUsers%252Fnjx%252Fprivate%252Fnotes.db%ZZ',
      '%25252FUsers%25252Fnjx%25252Fprivate%25252Fnotes.db%ZZ',
      '%2FUsers%5Cnjx%2Fprivate%5Cnotes.db%ZZ',
      '%5C%5Cserver%5Cshare%5Cnotes.db%ZZ',
      'C%3A%5CUsers%5Cnjx%5Cprivate%5Cnotes.db%ZZ',
      'file%3A%2F%2F%2FUsers%2Fnjx%2Fprivate%2Fnotes.db%ZZ',
      `revision-${String.fromCharCode(1)}-/Users/njx/private/notes.db`,
    ];
    const store = new RecordingCredentialStore();
    const created = await createSafe(store);
    const key = store.values.get(created.keyId)!;
    const consumer = new BackupEngine({ credentialStore: store, now: () => NOW, maxSnapshotBytes: 16_384 });

    for (const forbiddenPath of forbiddenPaths) {
      for (const target of ['key', 'value', 'file'] as const) {
        const forged = forgeManifest(created.container, key, (manifest) => {
          if (target === 'key') manifest.sourceRevisions = { [forbiddenPath]: 'revision-7' };
          if (target === 'value') manifest.sourceRevisions = { notes: forbiddenPath };
          if (target === 'file') manifest.files[0]!.sourceRevision = forbiddenPath;
        });
        const temp = new RecordingTempStore();
        await expectStaticError(
          consumer.restoreToTemp(forged, authorization('restore', sha256(forged), created.snapshotId), temp),
          'DECRYPT_FAILED',
          forbiddenPath,
        );
        expect(temp.writes.size).toBe(0);
      }
    }
  });
});
