import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  BackupIntegrationManager,
  InMemoryBackupRepository,
  type BackupConsentStore,
  type BackupIntegrationSource,
} from '../../src/main/backup-integration/manager.js';
import type { BackupApprovalPrompt } from '../../src/main/backup-integration/approval.js';
import type {
  BackupCredentialStore,
  BackupPresignClient,
  BackupScope,
  DirectCiphertextAdapter,
  PresignGrant,
  PresignMetadata,
} from '../../src/main/backup/index.js';
import type { BackupConsentReceipt, BackupEnableRequest } from '../../src/shared/backup-management.js';

const NOW = 1_725_000_000_000;
const TARGET = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: 'a'.repeat(64), targetHash: 'b'.repeat(64) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

class Credentials implements BackupCredentialStore {
  values = new Map<string, Uint8Array>();
  failDelete = false;
  async putDataKey(id: string, key: Uint8Array) { this.values.set(id, new Uint8Array(key)); }
  async getDataKey(id: string) { return this.values.get(id) ?? null; }
  async deleteDataKey(id: string) {
    if (this.failDelete) throw new Error('keyring locked');
    this.values.delete(id);
  }
}

class Presign implements BackupPresignClient {
  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    return {
      method: metadata.method, key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?q-signature=x`,
      contentType: metadata.contentType, expiresAtMs: NOW + 60_000,
      ...(metadata.method === 'PUT' ? { ciphertextBytes: metadata.ciphertextBytes, ciphertextSha256: metadata.ciphertextSha256 } : {}),
    };
  }
}

class Direct implements DirectCiphertextAdapter {
  object: Uint8Array | null = null;
  async put(_grant: PresignGrant, value: Uint8Array) { this.object = new Uint8Array(value); return { bytes: value.byteLength, sha256: sha256(value) }; }
  async get() { return new Uint8Array(this.object ?? []); }
  async head() { return this.object ? { exists: true, bytes: this.object.byteLength, sha256: sha256(this.object) } : { exists: false }; }
  async delete() { this.object = null; }
}

class DelayedUpdateRepository extends InMemoryBackupRepository {
  entered = deferred<void>();
  release = deferred<void>();
  delayed = false;
  arm() { this.delayed = true; }
  override async update(snapshotId: string, status: Parameters<InMemoryBackupRepository['update']>[1], beforeCommit?: () => void) {
    if (this.delayed) {
      this.delayed = false;
      this.entered.resolve();
      await this.release.promise;
    }
    beforeCommit?.();
    return super.update(snapshotId, status);
  }
}

class DelayedSaveRepository extends InMemoryBackupRepository {
  entered = deferred<void>();
  release = deferred<void>();
  failDiscard = false;
  override async save(created: Parameters<InMemoryBackupRepository['save']>[0], nowMs: number) {
    this.entered.resolve();
    await this.release.promise;
    return super.save(created, nowMs);
  }
  override async discard(snapshotId: string) {
    if (this.failDiscard) throw new Error('snapshot locked');
    return super.discard(snapshotId);
  }
}

class DelayedListRepository extends InMemoryBackupRepository {
  entered = deferred<void>();
  release = deferred<void>();
  armed = false;
  arm() { this.armed = true; }
  override async list() {
    if (this.armed) {
      this.armed = false;
      this.entered.resolve();
      await this.release.promise;
    }
    return super.list();
  }
}

function source(): BackupIntegrationSource {
  return {
    estimate: vi.fn(async (scopes: readonly BackupScope[]) => ({ estimatedEncryptedBytes: 1024, counts: { files: scopes.length } })),
    gather: vi.fn(async (scopes: readonly BackupScope[]) => ({
      appVersion: '0.1.0', logicalSchemaVersion: 'phase1-v1', selectedScopes: [...scopes], sourceRevisions: { notes: 'r1' },
      files: scopes.map((scope, index) => ({ logicalPath: `${scope}/${index}.json`, scope, data: new TextEncoder().encode('{}') })),
    })),
  };
}

function consentStore(): BackupConsentStore & { receipt: BackupConsentReceipt | null; generation: number } {
  const store = {
    receipt: null as BackupConsentReceipt | null,
    generation: 0,
    getReceipt: () => store.receipt,
    setReceipt: (receipt: BackupConsentReceipt) => { store.receipt = structuredClone(receipt); },
    clearReceipt: () => { store.receipt = null; },
    getGeneration: () => store.generation,
    setGeneration: (generation: number) => { store.generation = generation; },
  };
  return store;
}

function recoveryStore() {
  const store = {
    marker: null as null | Record<string, unknown>,
    get: () => store.marker,
    set: (marker: Record<string, unknown>) => { store.marker = structuredClone(marker); },
    clear: () => { store.marker = null; },
  };
  return store;
}

function fixture(options: {
  repository?: InMemoryBackupRepository;
  credentials?: Credentials;
  settings?: { enabled: boolean; get(): boolean; set(value: boolean): void };
  consent?: ReturnType<typeof consentStore>;
  recovery?: ReturnType<typeof recoveryStore>;
  direct?: Direct;
} = {}) {
  const settings = options.settings ?? { enabled: false, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } };
  const consent = options.consent ?? consentStore();
  const recovery = options.recovery ?? recoveryStore();
  const credentials = options.credentials ?? new Credentials();
  const repository = options.repository ?? new InMemoryBackupRepository();
  const direct = options.direct ?? new Direct();
  const manager = new BackupIntegrationManager({
    settings, consentStore: consent, recoveryStore: recovery, repository, credentialStore: credentials,
    approval: { request: async (prompt: BackupApprovalPrompt) => ({ commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: NOW }) },
    source: source(), presignClient: new Presign(), directAdapter: direct, target: TARGET, now: () => NOW,
  } as never);
  return { manager, settings, consent, recovery, credentials, repository, direct };
}

async function enable(x: ReturnType<typeof fixture>, scopes: BackupEnableRequest['selectedScopes'] = ['note-markdown', 'note-metadata']) {
  const draft = await x.manager.prepareEnable(scopes);
  await x.manager.enable({ ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true });
  return draft;
}

describe('r3 generation-aware catalog publication', () => {
  it.each(['upload', 'downloadVerify', 'deleteRemote'] as const)('does not retain a late %s status when disable wins before commit', async (action) => {
    const repository = new DelayedUpdateRepository();
    const x = fixture({ repository });
    const draft = await enable(x);
    const created = await x.manager.create({ selectedScopes: draft.selectedScopes });
    const stored = await repository.load(created.snapshotId);
    x.direct.object = new Uint8Array(stored!.container);
    repository.arm();
    const running = action === 'upload'
      ? x.manager.upload({ snapshotId: created.snapshotId })
      : action === 'downloadVerify'
        ? x.manager.downloadVerify({ snapshotId: created.snapshotId })
        : x.manager.deleteRemote({ snapshotId: created.snapshotId, confirmSnapshotId: created.snapshotId });
    await repository.entered.promise;
    const disabling = x.manager.disable();
    repository.release.resolve();
    await expect(running).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await expect(disabling).resolves.toMatchObject({ enabled: false });
    expect((await repository.load(created.snapshotId))?.catalog.status).toBe('local');
  });
});

describe('r3 durable recovery quarantine', () => {
  it.each(['discard', 'key'] as const)('persists a redacted marker and blocks clean disable when %s cleanup fails, then recovers on restart', async (failure) => {
    const repository = new DelayedSaveRepository();
    const credentials = new Credentials();
    const recovery = recoveryStore();
    const settings = { enabled: false, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } };
    const consent = consentStore();
    const x = fixture({ repository, credentials, recovery, settings, consent });
    const draft = await enable(x);
    const creating = x.manager.create({ selectedScopes: draft.selectedScopes });
    await repository.entered.promise;
    if (failure === 'discard') repository.failDiscard = true;
    else credentials.failDelete = true;
    const disabling = x.manager.disable();
    repository.release.resolve();
    await expect(creating).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
    await expect(disabling).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
    expect(recovery.marker).toMatchObject({ schemaVersion: 1, snapshotId: expect.any(String), reason: 'CREATE_ROLLBACK_INCOMPLETE' });
    expect(JSON.stringify(recovery.marker)).not.toMatch(/key(Id)?|content|path|url|token|secret/i);

    repository.failDiscard = false;
    credentials.failDelete = false;
    const restarted = fixture({ repository, credentials, recovery, settings, consent });
    await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(recovery.marker).toBeNull();
    expect(await repository.list()).toEqual([]);
    expect(credentials.values.size).toBe(0);
  });

  it('keeps quarantine across restart and blocks re-enable while cleanup still fails', async () => {
    const repository = new DelayedSaveRepository();
    const credentials = new Credentials();
    const recovery = recoveryStore();
    const settings = { enabled: false, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } };
    const consent = consentStore();
    const x = fixture({ repository, credentials, recovery, settings, consent });
    const draft = await enable(x);
    const creating = x.manager.create({ selectedScopes: draft.selectedScopes });
    await repository.entered.promise;
    credentials.failDelete = true;
    const disabling = x.manager.disable();
    repository.release.resolve();
    await expect(creating).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
    await expect(disabling).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });

    const restarted = fixture({ repository, credentials, recovery, settings, consent });
    await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: true });
    await expect(restarted.manager.prepareEnable(['note-markdown', 'note-metadata'])).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
    expect(recovery.marker).not.toBeNull();
  });
});

describe('r3 getState generation revalidation', () => {
  it('never returns receipt-A scopes/catalog after disable and receipt-B re-enable during list', async () => {
    const repository = new DelayedListRepository();
    const x = fixture({ repository });
    await enable(x, ['note-markdown', 'note-metadata']);
    repository.arm();
    const stale = x.manager.getState();
    await repository.entered.promise;
    await x.manager.disable();
    await enable(x, ['todos']);
    repository.release.resolve();
    await expect(stale).resolves.toMatchObject({ enabled: true, allowedScopes: ['todos'], recoveryRequired: false });
  });
});
