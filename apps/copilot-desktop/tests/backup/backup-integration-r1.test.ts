import { mkdtemp, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  BackupIntegrationManager,
  InMemoryBackupRepository,
  type BackupIntegrationSource,
} from '../../src/main/backup-integration/manager.js';
import { SafeStorageBackupCredentialStore } from '../../src/main/backup-integration/safe-storage-credential-store.js';
import {
  CloudBackupPresignTransport,
  FetchDirectCiphertextAdapter,
  InMemoryPresignGrantRegistry,
} from '../../src/main/backup-integration/cloud-adapters.js';
import { LocalKnowledgeBackupSource } from '../../src/main/backup-integration/source.js';
import type {
  BackupCredentialStore,
  BackupPresignClient,
  DirectCiphertextAdapter,
  PresignGrant,
  PresignMetadata,
} from '../../src/main/backup/index.js';
import type { BackupConsentReceipt } from '../../src/shared/backup-management.js';

const NOW = 1_725_000_000_000;
const TARGET = {
  region: 'ap-shanghai',
  bucket: 'copilot-123456',
  ownerHash: 'a'.repeat(64),
  targetHash: 'b'.repeat(64),
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class MemoryCredentials implements BackupCredentialStore {
  values = new Map<string, Uint8Array>();
  touches = 0;
  async putDataKey(id: string, key: Uint8Array) { this.touches += 1; this.values.set(id, new Uint8Array(key)); }
  async getDataKey(id: string) { this.touches += 1; return this.values.get(id) ?? null; }
  async deleteDataKey(id: string) { this.touches += 1; this.values.delete(id); }
}

class MemoryPresign implements BackupPresignClient {
  requests: PresignMetadata[] = [];
  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    this.requests.push(metadata);
    return {
      method: metadata.method,
      key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?secret=memory-only`,
      contentType: metadata.contentType,
      expiresAtMs: NOW + 60_000,
      ...(metadata.method === 'PUT' ? {
        ciphertextBytes: metadata.ciphertextBytes,
        ciphertextSha256: metadata.ciphertextSha256,
      } : {}),
    };
  }
}

class MemoryDirect implements DirectCiphertextAdapter {
  object: Uint8Array | null = null;
  calls: string[] = [];
  async put(_grant: PresignGrant, bytes: Uint8Array) {
    this.calls.push('PUT'); this.object = new Uint8Array(bytes);
    return { bytes: bytes.byteLength, sha256: sha256(bytes) };
  }
  async get() { this.calls.push('GET'); if (!this.object) throw new Error('missing'); return new Uint8Array(this.object); }
  async head() { this.calls.push('HEAD'); return this.object
    ? { exists: true, bytes: this.object.byteLength, sha256: sha256(this.object) }
    : { exists: false }; }
  async delete() { this.calls.push('DELETE'); this.object = null; }
}

function source(): BackupIntegrationSource {
  return {
    estimate: vi.fn().mockResolvedValue({ estimatedEncryptedBytes: 2048, counts: { notes: 1, todos: 1 } }),
    gather: vi.fn().mockResolvedValue({
      appVersion: '0.1.0',
      logicalSchemaVersion: 'phase1-v1',
      selectedScopes: ['note-markdown', 'note-metadata', 'todos'],
      sourceRevisions: { notes: 'r1', todos: 'r1' },
      files: [
        { logicalPath: 'notes/n1.md', scope: 'note-markdown', data: new TextEncoder().encode('# local') },
        { logicalPath: 'notes/metadata.json', scope: 'note-metadata', data: new TextEncoder().encode('[]') },
        { logicalPath: 'todos/items.json', scope: 'todos', data: new TextEncoder().encode('[]') },
      ],
    }),
  };
}

function manager() {
  const credentials = new MemoryCredentials();
  const presign = new MemoryPresign();
  const direct = new MemoryDirect();
  const repository = new InMemoryBackupRepository();
  const settings = { enabled: false, get: vi.fn(() => settings.enabled), set: vi.fn((v: boolean) => { settings.enabled = v; }) };
  const consentStore = {
    receipt: null as BackupConsentReceipt | null,
    generation: 0,
    getReceipt() { return this.receipt; },
    setReceipt(receipt: BackupConsentReceipt) { this.receipt = structuredClone(receipt); },
    clearReceipt() { this.receipt = null; },
    getGeneration() { return this.generation; },
    setGeneration(generation: number) { this.generation = generation; },
  };
  const value = new BackupIntegrationManager({
    settings,
    consentStore,
    approval: { request: async (prompt) => ({ commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: NOW }) },
    source: source(),
    repository,
    credentialStore: credentials,
    presignClient: presign,
    directAdapter: direct,
    target: TARGET,
    now: () => NOW,
  });
  return { value, credentials, presign, direct, repository, settings, consentStore };
}

describe('Backup A desktop integration r1', () => {
  it('fresh OFF state touches no source, credential, repository, presign or direct adapter', async () => {
    const x = manager();
    await expect(x.value.getState()).resolves.toMatchObject({ enabled: false, catalog: [] });
    expect(x.credentials.touches).toBe(0);
    expect(x.presign.requests).toHaveLength(0);
    expect(x.direct.calls).toHaveLength(0);
    expect(x.repository.touches).toBe(0);
  });

  it('requires an unambiguous owner consent bound to region/scopes/estimate/disclosures/first upload', async () => {
    const x = manager();
    const draft = await x.value.prepareEnable(['note-markdown', 'note-metadata', 'todos']);
    expect(draft).toMatchObject({ region: 'ap-shanghai', estimatedEncryptedBytes: 2048, retentionAndDelete: expect.any(String), keyLoss: expect.any(String), cloudCannotDecrypt: expect.any(String), exactFirstUpload: 'Create one encrypted local snapshot; upload only after a separate Upload click.' });
    await expect(x.value.enable({
      ...draft,
      retentionDeleteAcknowledged: true,
      keyLossAcknowledged: false,
      cloudCannotDecryptAcknowledged: true,
      firstUploadAcknowledged: true,
    })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(x.settings.enabled).toBe(false);
    await x.value.enable({
      ...draft,
      retentionDeleteAcknowledged: true,
      keyLossAcknowledged: true,
      cloudCannotDecryptAcknowledged: true,
      firstUploadAcknowledged: true,
    });
    expect(x.settings.enabled).toBe(true);
    expect(x.presign.requests).toHaveLength(0);
    expect(x.credentials.touches).toBe(0);
  });

  it('runs create then explicit upload + HEAD/hash, download verify, and destructive delete + HEAD absent', async () => {
    const x = manager();
    const draft = await x.value.prepareEnable(['note-markdown', 'note-metadata', 'todos']);
    await x.value.enable({ ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true });
    const created = await x.value.create({ selectedScopes: draft.selectedScopes });
    expect(created).not.toHaveProperty('keyId');
    expect(created).not.toHaveProperty('path');
    await x.value.upload({ snapshotId: created.snapshotId });
    expect(x.direct.calls).toEqual(['PUT', 'HEAD']);
    await x.value.downloadVerify({ snapshotId: created.snapshotId });
    expect(x.direct.calls).toEqual(['PUT', 'HEAD', 'GET']);
    await expect(x.value.deleteRemote({ snapshotId: created.snapshotId, confirmSnapshotId: 'wrong' })).rejects.toMatchObject({ code: 'DELETE_APPROVAL_REQUIRED' });
    await x.value.deleteRemote({ snapshotId: created.snapshotId, confirmSnapshotId: created.snapshotId });
    expect(x.direct.calls).toEqual(['PUT', 'HEAD', 'GET', 'DELETE', 'HEAD']);
    const state = await x.value.getState();
    expect(state.catalog[0]).toMatchObject({ snapshotId: created.snapshotId, status: 'remote-deleted' });
    expect(JSON.stringify(state.catalog)).not.toMatch(/secret=|keyId|path|content|url/i);
  });

  it('exposes restore preview only and fails replace-current closed', async () => {
    const x = manager();
    expect((await x.value.getState()).replaceCurrentAvailable).toBe(false);
    await expect(x.value.replaceCurrent()).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
  });

  it('disable blocks new work, clears in-memory capabilities and does not delete snapshots', async () => {
    const x = manager();
    const clear = vi.fn();
    (x.value as unknown as { options: { abortAndClear?: () => void } }).options.abortAndClear = clear;
    const draft = await x.value.prepareEnable(['note-markdown', 'note-metadata', 'todos']);
    await x.value.enable({ ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true });
    const created = await x.value.create({ selectedScopes: draft.selectedScopes });
    await x.value.disable();
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(x.value.upload({ snapshotId: created.snapshotId })).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    expect(x.repository.touches).toBeGreaterThan(0);
  });
});

describe('local snapshot gatherer scope boundary', () => {
  it('includes notes metadata/Markdown, todos and selected nonsecret prefs but not model credentials, vectors, logs or audio', async () => {
    const service = {
      notes: {
        list: vi.fn().mockResolvedValue({ items: [{ id: 1, path: 'work/local.md', title: 'Local', type: 'note', status: 'active', tags: [], related: [], folder: 'work', createdAt: 1, updatedAt: 2, confidence: null, agent: null }], total: 1, limit: 500, offset: 0 }),
        get: vi.fn().mockResolvedValue({ note: { id: 1, path: 'work/local.md', title: 'Local', type: 'note', status: 'active', tags: [], related: [], folder: 'work', createdAt: 1, updatedAt: 2, confidence: null, agent: null }, body: '# markdown' }),
      },
      todos: { list: vi.fn().mockResolvedValue([]) },
      backupImport: {
        noteExists: async (_path: string): Promise<never> => {
          throw new Error('backupImport unused in gather-only test');
        },
        todoExists: async (_id: string): Promise<never> => {
          throw new Error('backupImport unused in gather-only test');
        },
        createNote: async (_request: object): Promise<never> => {
          throw new Error('backupImport unused in gather-only test');
        },
        createTodo: async (_todo: object, _importNamespace: string): Promise<never> => {
          throw new Error('backupImport unused in gather-only test');
        },
        rollback: async (_request: object): Promise<never> => {
          throw new Error('backupImport unused in gather-only test');
        },
      },
    };
    const values = { theme: 'dark', windowBounds: { width: 800, height: 600 }, shortcuts: [], schemaVersion: 2, modelApi: { apiKey: 'sk-forbidden' } } as const;
    const gatherer = new LocalKnowledgeBackupSource(async () => service, { get: (key: keyof typeof values) => values[key] } as never, '0.1.0');
    const gathered = await gatherer.gather(['note-markdown', 'note-metadata', 'todos', 'preferences']);
    expect(gathered.files.map((file) => file.logicalPath)).toEqual(expect.arrayContaining(['notes/metadata.json', 'todos/items.json', 'preferences/settings.json']));
    const serialized = gathered.files.map((file) => Buffer.from(file.data).toString()).join('\n');
    expect(serialized).toContain('# markdown');
    expect(serialized).not.toMatch(/sk-forbidden|modelApi|embedding|vector|audio|recording/i);
    expect(gathered.files.map((file) => file.logicalPath).join('\n')).not.toMatch(/logs?|secrets?|credentials?|audio|recordings?|vectors?/i);
    await expect(gatherer.gather(['kg-nodes'])).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
  });
});

describe('safeStorage credential persistence', () => {
  it('fails closed when Electron safeStorage is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-key-'));
    const store = new SafeStorageBackupCredentialStore(root, {
      isEncryptionAvailable: () => false,
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    });
    await expect(store.putDataKey('11111111-1111-4111-8111-111111111111', new Uint8Array(32))).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  });

  it('writes only a safeStorage-encrypted 0600 regular blob and rejects symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-key-'));
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
      decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
    };
    const store = new SafeStorageBackupCredentialStore(root, safe);
    const keyId = '11111111-1111-4111-8111-111111111111';
    const key = new Uint8Array(32).fill(7);
    await store.putDataKey(keyId, key);
    const file = path.join(root, 'backup-a', 'credentials', `${keyId}.blob`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await readFile(file, 'utf8'))).not.toContain(Buffer.from(key).toString('base64'));
    await expect(store.putDataKey(keyId, key)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    const symlinkId = '22222222-2222-4222-8222-222222222222';
    await symlink(file, path.join(root, 'backup-a', 'credentials', `${symlinkId}.blob`));
    await expect(store.getDataKey(symlinkId)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  });
});

describe('Cloud presign and direct ciphertext adapters', () => {
  it('uses the separate bearer endpoint once and keeps required headers/URL memory-only', async () => {
    const registry = new InMemoryPresignGrantRegistry();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      schemaVersion: 1, method: 'HEAD', snapshotId: '11111111-1111-4111-8111-111111111111',
      key: `backup/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/11111111-1111-4111-8111-111111111111.cbackup`,
      expiresAtMs: NOW + 60_000,
      url: `https://copilot-123456.cos.ap-shanghai.myqcloud.com/backup/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/11111111-1111-4111-8111-111111111111.cbackup?q-signature=memory-only`,
      requiredHeaders: { 'content-type': 'application/vnd.njx.copilot-backup' },
    }) });
    const transport = new CloudBackupPresignTransport({ endpoint: 'https://backup.example/v1/backup/presign', token: 'backup-only-token', fetcher, registry, now: () => NOW });
    const grant = await transport.request({
      method: 'HEAD', region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: 'a'.repeat(64), targetHash: 'b'.repeat(64), snapshotId: '11111111-1111-4111-8111-111111111111', key: `backup/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/11111111-1111-4111-8111-111111111111.cbackup`, ttlSeconds: 60, contentType: 'application/vnd.njx.copilot-backup',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer backup-only-token', 'content-type': 'application/json' } });
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('ownerHash');
    expect(registry.headersFor(grant)).toEqual({ 'content-type': 'application/vnd.njx.copilot-backup' });
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('performs exactly one direct request and sends no authorization header', async () => {
    const registry = new InMemoryPresignGrantRegistry();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-length': '0' }) });
    const adapter = new FetchDirectCiphertextAdapter(fetcher, registry, () => undefined, () => NOW);
    const snapshotId = '11111111-1111-4111-8111-111111111111';
    const key = `backup/v1/${TARGET.ownerHash}/${TARGET.targetHash}/${snapshotId}.cbackup`;
    const metadata: PresignMetadata = { method: 'HEAD', ...TARGET, snapshotId, key, ttlSeconds: 60, contentType: 'application/vnd.njx.copilot-backup' };
    const grant: PresignGrant = { method: 'HEAD', key, url: `https://${TARGET.bucket}.cos.${TARGET.region}.myqcloud.com/${key}?q-signature=memory-only`, contentType: 'application/vnd.njx.copilot-backup', expiresAtMs: NOW + 1_000 };
    registry.remember(metadata, grant, { 'content-type': grant.contentType }, NOW);
    await adapter.head(grant);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  });
});
