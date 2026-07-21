import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_CONTENT_TYPE,
  BackupEngine,
  MetadataOnlyPresignClient,
  createBackupRequestDigest,
  type BackupCommand,
  type BackupCommandAuthorization,
  type BackupCredentialStore,
  type DirectCiphertextAdapter,
  type PresignGrant,
  type PresignMetadata,
  type PresignTransport,
} from '../../src/main/backup/index.js';

const NOW = 1_725_000_000_000;
const OWNER = 'a'.repeat(64);
const TARGET = 'b'.repeat(64);

class MemoryCredentialStore implements BackupCredentialStore {
  readonly values = new Map<string, Uint8Array>();
  async putDataKey(keyId: string, key: Uint8Array): Promise<void> { this.values.set(keyId, new Uint8Array(key)); }
  async getDataKey(keyId: string): Promise<Uint8Array | null> { return this.values.get(keyId) ?? null; }
  async deleteDataKey(keyId: string): Promise<void> { this.values.delete(keyId); }
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
      requestId: `request-${command}`,
      resourceDigest,
      snapshotId,
      approvedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
    },
  };
}

function grantFor(metadata: PresignMetadata): PresignGrant {
  const grant: PresignGrant = {
    method: metadata.method,
    key: metadata.key,
    url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?q-signature=do-not-log`,
    contentType: metadata.contentType,
    expiresAtMs: NOW + metadata.ttlSeconds * 1_000,
  };
  if (metadata.method === 'PUT') {
    grant.ciphertextBytes = metadata.ciphertextBytes;
    grant.ciphertextSha256 = metadata.ciphertextSha256;
  }
  return grant;
}

class RecordingTransport implements PresignTransport {
  readonly requests: PresignMetadata[] = [];
  mutate?: (grant: PresignGrant) => PresignGrant;

  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    this.requests.push(structuredClone(metadata));
    const grant = grantFor(metadata);
    return this.mutate ? this.mutate(grant) : grant;
  }
}

class MemoryDirectAdapter implements DirectCiphertextAdapter {
  object: Uint8Array | null = null;
  putGrant: PresignGrant | null = null;
  getGrant: PresignGrant | null = null;
  deleteGrant: PresignGrant | null = null;
  corruptPutReceipt = false;
  reportExistsAfterDelete = false;

  async put(grant: PresignGrant, ciphertext: Uint8Array): Promise<{ bytes: number; sha256: string }> {
    this.putGrant = grant;
    this.object = new Uint8Array(ciphertext);
    return {
      bytes: ciphertext.byteLength,
      sha256: this.corruptPutReceipt ? '0'.repeat(64) : sha256(ciphertext),
    };
  }

  async get(grant: PresignGrant): Promise<Uint8Array> {
    this.getGrant = grant;
    if (!this.object) throw new Error(`missing object at ${grant.url}`);
    return new Uint8Array(this.object);
  }

  async head(): Promise<{ exists: boolean; bytes?: number; sha256?: string }> {
    if (this.reportExistsAfterDelete) return { exists: true, bytes: this.object?.byteLength, sha256: this.object ? sha256(this.object) : undefined };
    return this.object ? { exists: true, bytes: this.object.byteLength, sha256: sha256(this.object) } : { exists: false };
  }

  async delete(grant: PresignGrant): Promise<void> {
    this.deleteGrant = grant;
    this.object = null;
  }
}

function input() {
  return {
    appVersion: '0.1.0',
    logicalSchemaVersion: 'phase1-v1',
    selectedScopes: ['note-markdown'] as const,
    sourceRevisions: { notes: 'r1' },
    files: [{ logicalPath: 'notes/a.md', scope: 'note-markdown' as const, data: Buffer.from('# a') }],
  };
}

describe('Backup A metadata-only presign and direct ciphertext transfer', () => {
  it('allows only exact method, key prefix, content type, TTL, size, and hash metadata', async () => {
    const transport = new RecordingTransport();
    const client = new MetadataOnlyPresignClient(transport, () => NOW);
    const snapshotId = '10000000-0000-4000-8000-000000000001';
    const key = `backup/v1/${OWNER}/${TARGET}/${snapshotId}.cbackup`;

    const grant = await client.request({
      method: 'PUT', region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId, key, ttlSeconds: 300, contentType: BACKUP_CONTENT_TYPE,
      ciphertextBytes: 123, ciphertextSha256: 'c'.repeat(64),
    });
    expect(grant).toEqual(expect.objectContaining({ method: 'PUT', key, ciphertextBytes: 123, ciphertextSha256: 'c'.repeat(64) }));
    expect(Object.keys(transport.requests[0]).sort()).toEqual([
      'bucket', 'ciphertextBytes', 'ciphertextSha256', 'contentType', 'key', 'method', 'ownerHash', 'region', 'snapshotId', 'targetHash', 'ttlSeconds',
    ].sort());
    expect(transport.requests[0]).not.toHaveProperty('body');
    expect(transport.requests[0]).not.toHaveProperty('dataKey');

    await expect(client.request({ ...transport.requests[0], ttlSeconds: 301 })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    await expect(client.request({ ...transport.requests[0], key: `${key}.other` })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    await expect(client.request({ ...transport.requests[0], contentType: 'application/octet-stream' })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    await expect(client.request({ ...transport.requests[0], method: 'GET', ciphertextBytes: 123, ciphertextSha256: 'c'.repeat(64) }))
      .rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    await expect(client.request({ ...transport.requests[0], method: 'PATCH' as never })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
  });

  it('rejects a presign grant that broadens or changes the requested capability', async () => {
    const transport = new RecordingTransport();
    transport.mutate = (grant) => ({ ...grant, method: 'DELETE' });
    const client = new MetadataOnlyPresignClient(transport, () => NOW);
    const snapshotId = '10000000-0000-4000-8000-000000000002';

    await expect(client.request({
      method: 'GET', region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId, key: `backup/v1/${OWNER}/${TARGET}/${snapshotId}.cbackup`, ttlSeconds: 60,
      contentType: BACKUP_CONTENT_TYPE,
    })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });

    transport.mutate = (grant) => ({ ...grant, expiresAtMs: NOW - 1 });
    await expect(client.request({
      method: 'HEAD', region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET,
      snapshotId, key: `backup/v1/${OWNER}/${TARGET}/${snapshotId}.cbackup`, ttlSeconds: 60,
      contentType: BACKUP_CONTENT_TYPE,
    })).rejects.toMatchObject({ code: 'PRESIGN_EXPIRED' });
  });

  it('uploads the opaque container directly and validates the exact receipt', async () => {
    const credentialStore = new MemoryCredentialStore();
    const transport = new RecordingTransport();
    const direct = new MemoryDirectAdapter();
    const engine = new BackupEngine({
      credentialStore, now: () => NOW,
      presignClient: new MetadataOnlyPresignClient(transport, () => NOW), directAdapter: direct,
    });
    const source = input();
    const created = await engine.create(source, authorization('create', createBackupRequestDigest(source)));

    const result = await engine.upload(created.container, { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET },
      authorization('upload', created.containerSha256, created.snapshotId));

    expect(result).toEqual({ snapshotId: created.snapshotId, bytes: created.container.byteLength, sha256: created.containerSha256 });
    expect(Buffer.from(direct.object!)).toEqual(Buffer.from(created.container));
    expect(transport.requests[0]).toEqual(expect.objectContaining({
      method: 'PUT', ciphertextBytes: created.container.byteLength, ciphertextSha256: created.containerSha256,
    }));
    expect(JSON.stringify(transport.requests)).not.toContain(Buffer.from(credentialStore.values.get(created.keyId)!).toString('base64'));

    direct.corruptPutReceipt = true;
    await expect(engine.upload(created.container, { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET },
      authorization('upload', created.containerSha256, created.snapshotId)))
      .rejects.toMatchObject({ code: 'UPLOAD_INTEGRITY_FAILED' });
  });

  it('downloads only exact ciphertext and never leaks a full signed URL in errors', async () => {
    const store = new MemoryCredentialStore();
    const transport = new RecordingTransport();
    const direct = new MemoryDirectAdapter();
    const engine = new BackupEngine({
      credentialStore: store, now: () => NOW,
      presignClient: new MetadataOnlyPresignClient(transport, () => NOW), directAdapter: direct,
    });
    const source = input();
    const created = await engine.create(source, authorization('create', createBackupRequestDigest(source)));
    direct.object = created.container;
    const target = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET };

    const downloaded = await engine.download(
      { ...target, snapshotId: created.snapshotId, ciphertextBytes: created.container.byteLength, ciphertextSha256: created.containerSha256 },
      authorization('download', created.containerSha256, created.snapshotId),
    );
    expect(Buffer.from(downloaded)).toEqual(Buffer.from(created.container));
    expect(transport.requests.at(-1)).toEqual(expect.objectContaining({ method: 'GET' }));

    direct.object = null;
    let caught: unknown;
    try {
      await engine.download(
        { ...target, snapshotId: created.snapshotId, ciphertextBytes: created.container.byteLength, ciphertextSha256: created.containerSha256 },
        authorization('download', created.containerSha256, created.snapshotId),
      );
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'COS_UNAVAILABLE' });
    expect(String((caught as Error).message)).not.toContain('q-signature');
  });

  it('requires delete consent and verifies deletion with a fresh exact HEAD capability', async () => {
    const store = new MemoryCredentialStore();
    const transport = new RecordingTransport();
    const direct = new MemoryDirectAdapter();
    const engine = new BackupEngine({
      credentialStore: store, now: () => NOW,
      presignClient: new MetadataOnlyPresignClient(transport, () => NOW), directAdapter: direct,
    });
    const source = input();
    const created = await engine.create(source, authorization('create', createBackupRequestDigest(source)));
    direct.object = created.container;
    const target = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET, snapshotId: created.snapshotId };

    await expect(engine.deleteRemote(target, { backupEnabled: true, nowMs: NOW })).rejects.toMatchObject({ code: 'DELETE_APPROVAL_REQUIRED' });
    await engine.deleteRemote(target, authorization('delete', created.snapshotId, created.snapshotId));
    expect(transport.requests.slice(-2).map((request) => request.method)).toEqual(['DELETE', 'HEAD']);
    expect(direct.deleteGrant?.method).toBe('DELETE');

    direct.object = created.container;
    direct.reportExistsAfterDelete = true;
    await expect(engine.deleteRemote(target, authorization('delete', created.snapshotId, created.snapshotId)))
      .rejects.toMatchObject({ code: 'DELETE_FAILED' });
  });

  it('rejects upload, download, and delete independently when backup is disabled or command consent is wrong', async () => {
    const store = new MemoryCredentialStore();
    const transport = new RecordingTransport();
    const direct = new MemoryDirectAdapter();
    const engine = new BackupEngine({
      credentialStore: store, now: () => NOW,
      presignClient: new MetadataOnlyPresignClient(transport, () => NOW), directAdapter: direct,
    });
    const source = input();
    const created = await engine.create(source, authorization('create', createBackupRequestDigest(source)));
    const base = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: OWNER, targetHash: TARGET };

    await expect(engine.upload(created.container, base, { backupEnabled: false })).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await expect(engine.download(
      { ...base, snapshotId: created.snapshotId, ciphertextBytes: created.container.byteLength, ciphertextSha256: created.containerSha256 },
      authorization('upload', created.containerSha256, created.snapshotId),
    )).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(engine.deleteRemote(
      { ...base, snapshotId: created.snapshotId }, authorization('download', created.snapshotId, created.snapshotId),
    )).rejects.toMatchObject({ code: 'DELETE_APPROVAL_REQUIRED' });
    expect(transport.requests).toHaveLength(0);
  });
});
