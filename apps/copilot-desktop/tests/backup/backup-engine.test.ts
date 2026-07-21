import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BackupEngine,
  createBackupRequestDigest,
  inspectBackupContainer,
  type BackupCommand,
  type BackupCommandAuthorization,
  type BackupCredentialStore,
  type BackupSourceFile,
  type CreateBackupInput,
  type RestoreTempStore,
} from '../../src/main/backup/index.js';

class MemoryCredentialStore implements BackupCredentialStore {
  readonly values = new Map<string, Uint8Array>();

  async putDataKey(keyId: string, key: Uint8Array): Promise<void> {
    this.values.set(keyId, new Uint8Array(key));
  }

  async getDataKey(keyId: string): Promise<Uint8Array | null> {
    const value = this.values.get(keyId);
    return value ? new Uint8Array(value) : null;
  }

  async deleteDataKey(keyId: string): Promise<void> {
    this.values.delete(keyId);
  }
}

class MemoryTempStore implements RestoreTempStore {
  readonly writes = new Map<string, Uint8Array>();

  async write(relativePath: string, data: Uint8Array): Promise<void> {
    this.writes.set(relativePath, new Uint8Array(data));
  }
}

const NOW = 1_725_000_000_000;

function authorization(command: BackupCommand, resourceDigest: string, snapshotId?: string): BackupCommandAuthorization {
  return {
    backupEnabled: true,
    nowMs: NOW,
    consent: {
      approved: true,
      command,
      requestId: `request-${command}`,
      resourceDigest,
      snapshotId,
      approvedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
    },
  };
}

function sampleInput(files?: BackupSourceFile[]): CreateBackupInput {
  return {
    appVersion: '0.1.0',
    logicalSchemaVersion: 'phase1-v1',
    selectedScopes: ['note-markdown', 'note-metadata', 'kb-logical', 'kb-index-metadata', 'kg-nodes', 'kg-edges', 'todos', 'preferences'],
    sourceRevisions: { notes: 'rev-note-7', kg: 'rev-kg-9' },
    files: files ?? [
      { logicalPath: 'notes/alpha.md', scope: 'note-markdown', data: Buffer.from('# Alpha\nlocal truth'), sourceRevision: 'rev-note-7' },
      { logicalPath: 'notes/alpha.json', scope: 'note-metadata', data: Buffer.from('{"title":"Alpha"}'), recordCount: 1 },
      { logicalPath: 'kb/documents.json', scope: 'kb-logical', data: Buffer.from('[{"id":"alpha"}]'), recordCount: 1 },
      { logicalPath: 'kb/index-metadata.json', scope: 'kb-index-metadata', data: Buffer.from('{"version":1}'), recordCount: 1 },
      { logicalPath: 'kg/nodes.json', scope: 'kg-nodes', data: Buffer.from('[{"id":"n1"}]'), recordCount: 1 },
      { logicalPath: 'kg/edges.json', scope: 'kg-edges', data: Buffer.from('[{"source":"n1","target":"n1"}]'), recordCount: 1 },
      { logicalPath: 'todos/items.json', scope: 'todos', data: Buffer.from('[{"id":"t1"}]'), recordCount: 1 },
      { logicalPath: 'preferences/selected.json', scope: 'preferences', data: Buffer.from('{"theme":"dark","windowBounds":{"width":900}}') },
    ],
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rewritePayload(container: Uint8Array, mutate: (payload: Buffer) => void): Uint8Array {
  const bytes = Buffer.from(container);
  const magicLength = Buffer.byteLength(`${BACKUP_FORMAT}\n`);
  const headerLength = bytes.readUInt32BE(magicLength);
  const headerStart = magicLength + 4;
  const headerEnd = headerStart + headerLength;
  const header = JSON.parse(bytes.subarray(headerStart, headerEnd).toString('utf8')) as Record<string, unknown>;
  const payload = Buffer.from(bytes.subarray(headerEnd));
  mutate(payload);
  header.ciphertextSha256 = sha256(payload);
  const nextHeader = Buffer.from(JSON.stringify(header));
  expect(nextHeader.length).toBe(headerLength);
  return Buffer.concat([bytes.subarray(0, headerStart), nextHeader, payload]);
}

describe('Backup A desktop container engine', () => {
  it('is default-off and requires command-, resource-, and time-scoped consent', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, chunkSize: 32 });
    const input = sampleInput();
    const digest = createBackupRequestDigest(input);

    await expect(engine.create(input, { backupEnabled: false })).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await expect(engine.create(input, { backupEnabled: true, nowMs: NOW })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(engine.create(input, authorization('restore', digest))).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(engine.create(input, authorization('create', 'f'.repeat(64)))).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    const expired = authorization('create', digest);
    expired.consent!.expiresAtMs = NOW - 1;
    await expect(engine.create(input, expired)).rejects.toMatchObject({ code: 'CONSENT_EXPIRED' });
    expect(store.values.size).toBe(0);
  });

  it('creates a strict opaque versioned container with random 256-bit key and unique chunk nonces', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, chunkSize: 16 });
    const input = sampleInput();
    const original = input.files.map((file) => Buffer.from(file.data));
    const auth = authorization('create', createBackupRequestDigest(input));

    const first = await engine.create(input, auth);
    const second = await engine.create(input, auth);
    const firstInspection = inspectBackupContainer(first.container);
    const clearText = Buffer.from(first.container).toString('utf8');

    expect(Buffer.from(first.container).subarray(0, Buffer.byteLength(`${BACKUP_FORMAT}\n`)).toString()).toBe(`${BACKUP_FORMAT}\n`);
    expect(Object.keys(firstInspection.header).sort()).toEqual([
      'chunkCount', 'chunkSize', 'ciphertextBytes', 'ciphertextSha256', 'cryptoVersion', 'format', 'keyId',
      'manifestChunkCount', 'nonceDerivation', 'noncePrefix', 'snapshotId', 'tagBytes',
    ].sort());
    expect(firstInspection.header.format).toBe(BACKUP_FORMAT);
    expect(firstInspection.header.chunkCount).toBeGreaterThan(firstInspection.header.manifestChunkCount);
    expect(firstInspection.header.nonceDerivation).toBe('random-64-bit-prefix+uint32be-counter');
    expect(firstInspection.payloadSha256).toBe(firstInspection.header.ciphertextSha256);
    expect(firstInspection.header.ciphertextBytes).toBe(firstInspection.payloadBytes);
    expect(first.containerSha256).toBe(sha256(first.container));
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(first.keyId).not.toBe(second.keyId);
    expect(first.containerSha256).not.toBe(second.containerSha256);
    expect(store.values.get(first.keyId)).toHaveLength(32);
    expect(store.values.get(second.keyId)).toHaveLength(32);
    expect(firstInspection.header.noncePrefix).not.toBe(inspectBackupContainer(second.container).header.noncePrefix);
    expect(clearText).not.toContain('notes/alpha.md');
    expect(clearText).not.toContain('phase1-v1');
    expect(clearText).not.toContain('rev-note-7');
    for (const [index, file] of input.files.entries()) expect(Buffer.from(file.data)).toEqual(original[index]);

    for (const key of store.values.values()) {
      expect(clearText).not.toContain(Buffer.from(key).toString('hex'));
      expect(clearText).not.toContain(Buffer.from(key).toString('base64'));
    }
  });

  it('restores only after full validation into temp and returns an import-as-copy plan', async () => {
    const store = new MemoryCredentialStore();
    const temp = new MemoryTempStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, chunkSize: 13 });
    const input = sampleInput();
    const created = await engine.create(input, authorization('create', createBackupRequestDigest(input)));

    const result = await engine.restoreToTemp(
      created.container,
      authorization('restore', created.containerSha256, created.snapshotId),
      temp,
    );

    expect(result.mode).toBe('import-as-copy');
    expect(result.localTruthMutated).toBe(false);
    expect(result.overwriteSupported).toBe(false);
    expect(result.snapshotId).toBe(created.snapshotId);
    expect(result.files).toHaveLength(input.files.length);
    expect(result.manifest.fileCount).toBe(input.files.length);
    expect(result.manifest.recordCount).toBe(6);
    for (const file of input.files) {
      expect(Buffer.from(temp.writes.get(file.logicalPath)!)).toEqual(Buffer.from(file.data));
      expect(result.files).toContainEqual(expect.objectContaining({
        logicalPath: file.logicalPath,
        importPath: `imports/${created.snapshotId}/${file.logicalPath}`,
        plaintextSha256: sha256(file.data),
      }));
    }
  });

  it('fails closed before temp writes for outer hash, truncation, AEAD, wrong key, and consent failures', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, chunkSize: 17 });
    const input = sampleInput();
    const created = await engine.create(input, authorization('create', createBackupRequestDigest(input)));
    const restoreAuth = authorization('restore', created.containerSha256, created.snapshotId);

    const tamperedOuter = Buffer.from(created.container);
    tamperedOuter[tamperedOuter.length - 1] ^= 1;
    await expect(engine.restoreToTemp(tamperedOuter, restoreAuth, new MemoryTempStore())).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });

    const truncatedTemp = new MemoryTempStore();
    await expect(engine.restoreToTemp(created.container.subarray(0, created.container.length - 5), restoreAuth, truncatedTemp)).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
    expect(truncatedTemp.writes.size).toBe(0);

    const aeadTampered = rewritePayload(created.container, (payload) => { payload[payload.length - 1] ^= 1; });
    const aeadTemp = new MemoryTempStore();
    await expect(engine.restoreToTemp(
      aeadTampered,
      authorization('restore', sha256(aeadTampered), created.snapshotId),
      aeadTemp,
    )).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    expect(aeadTemp.writes.size).toBe(0);

    const key = store.values.get(created.keyId)!;
    store.values.set(created.keyId, Buffer.alloc(key.length, 7));
    const wrongKeyTemp = new MemoryTempStore();
    await expect(engine.restoreToTemp(created.container, restoreAuth, wrongKeyTemp)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    expect(wrongKeyTemp.writes.size).toBe(0);
    store.values.set(created.keyId, key);

    await expect(engine.restoreToTemp(created.container, authorization('create', created.containerSha256), new MemoryTempStore()))
      .rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('hard-excludes unsafe paths, data classes, and secret-bearing preferences', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW });
    const unsafe: Array<BackupSourceFile> = [
      { logicalPath: '/Users/njx/note.md', scope: 'note-markdown', data: Buffer.from('x') },
      { logicalPath: 'notes/../tokens.json', scope: 'note-metadata', data: Buffer.from('x') },
      { logicalPath: 'C:\\Users\\njx\\note.md', scope: 'note-markdown', data: Buffer.from('x') },
      { logicalPath: 'settings/api-keys.json', scope: 'preferences', data: Buffer.from('{"theme":"dark"}') },
      { logicalPath: 'kb/vectors.bin', scope: 'kb-index-metadata', data: Buffer.from('x') },
      { logicalPath: 'logs/crash.log', scope: 'note-metadata', data: Buffer.from('x') },
      { logicalPath: 'audio/raw.wav', scope: 'note-metadata', data: Buffer.from('x') },
      { logicalPath: 'release/app.asar', scope: 'kb-logical', data: Buffer.from('x') },
      { logicalPath: 'preferences/selected.json', scope: 'preferences', data: Buffer.from('{"theme":"dark","modelApi":{"apiKey":"secret"}}') },
      { logicalPath: 'notes/leaked.md', scope: 'note-markdown', data: Buffer.from('Authorization: Bearer super-secret-token-value') },
    ];

    for (const file of unsafe) {
      const input = sampleInput([file]);
      await expect(engine.create(input, authorization('create', createBackupRequestDigest(input))))
        .rejects.toMatchObject({ code: 'SCOPE_INVALID' });
    }
    expect(store.values.size).toBe(0);
  });

  it('rejects non-allowlisted scopes, duplicate paths, and files outside selected scopes', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW });

    const unknown = sampleInput([{ logicalPath: 'x/data.json', scope: 'embeddings' as never, data: Buffer.from('[]') }]);
    await expect(engine.create(unknown, authorization('create', createBackupRequestDigest(unknown))))
      .rejects.toMatchObject({ code: 'SCOPE_INVALID' });

    const duplicate = sampleInput([
      { logicalPath: 'notes/a.md', scope: 'note-markdown', data: Buffer.from('a') },
      { logicalPath: 'notes/a.md', scope: 'note-markdown', data: Buffer.from('b') },
    ]);
    await expect(engine.create(duplicate, authorization('create', createBackupRequestDigest(duplicate))))
      .rejects.toMatchObject({ code: 'SCOPE_INVALID' });

    const outside = sampleInput([{ logicalPath: 'notes/a.md', scope: 'note-markdown', data: Buffer.from('a') }]);
    outside.selectedScopes = ['todos'];
    await expect(engine.create(outside, authorization('create', createBackupRequestDigest(outside))))
      .rejects.toMatchObject({ code: 'SCOPE_INVALID' });
  });

  it('enforces a fail-closed snapshot limit including encrypted container overhead', async () => {
    const store = new MemoryCredentialStore();
    const input = sampleInput([{ logicalPath: 'notes/big.md', scope: 'note-markdown', data: Buffer.alloc(256, 1) }]);
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW, maxSnapshotBytes: 300, chunkSize: 32 });

    await expect(engine.create(input, authorization('create', createBackupRequestDigest(input))))
      .rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
    expect(store.values.size).toBe(0);
  });

  it('rejects unsupported container and logical schema versions without touching temp', async () => {
    const store = new MemoryCredentialStore();
    const engine = new BackupEngine({ credentialStore: store, now: () => NOW });
    const input = sampleInput();
    const created = await engine.create(input, authorization('create', createBackupRequestDigest(input)));
    const bytes = Buffer.from(created.container);
    bytes.write('COPILOT-BACKUP/9\n', 0, 'utf8');

    await expect(engine.restoreToTemp(
      bytes,
      authorization('restore', sha256(bytes), created.snapshotId),
      new MemoryTempStore(),
    )).rejects.toMatchObject({ code: 'SNAPSHOT_VERSION_UNSUPPORTED' });

    const restrictive = new BackupEngine({
      credentialStore: store,
      now: () => NOW,
      acceptedLogicalSchemaVersions: ['phase1-v2'],
    });
    const temp = new MemoryTempStore();
    await expect(restrictive.restoreToTemp(created.container, authorization('restore', created.containerSha256, created.snapshotId), temp))
      .rejects.toMatchObject({ code: 'SNAPSHOT_VERSION_UNSUPPORTED' });
    expect(temp.writes.size).toBe(0);
  });
});
