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
import type { BackupConsentReceipt } from '../../src/shared/backup-management.js';

const NOW = 1_725_000_000_000;
const TARGET = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: 'a'.repeat(64), targetHash: 'b'.repeat(64) };

class FailingCredentials implements BackupCredentialStore {
  values = new Map<string, Uint8Array>();
  failPutAfterStore = false;
  failDelete = false;
  async putDataKey(id: string, key: Uint8Array) {
    this.values.set(id, new Uint8Array(key));
    if (this.failPutAfterStore) throw new Error('credential put completion unavailable');
  }
  async getDataKey(id: string) { return this.values.get(id) ?? null; }
  async deleteDataKey(id: string) {
    if (this.failDelete) throw new Error('credential delete unavailable');
    this.values.delete(id);
  }
}

class FailingRepository extends InMemoryBackupRepository {
  failSaveAfterStore = false;
  failDiscard = false;
  override async save(created: Parameters<InMemoryBackupRepository['save']>[0], nowMs: number) {
    const result = await super.save(created, nowMs);
    if (this.failSaveAfterStore) throw new Error('snapshot save completion unavailable');
    return result;
  }
  override async discard(snapshotId: string) {
    if (this.failDiscard) throw new Error('snapshot discard unavailable');
    return super.discard(snapshotId);
  }
}

class Presign implements BackupPresignClient {
  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    return {
      method: metadata.method,
      key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?q-signature=x`,
      contentType: metadata.contentType,
      expiresAtMs: NOW + 60_000,
      ...(metadata.method === 'PUT' ? { ciphertextBytes: metadata.ciphertextBytes, ciphertextSha256: metadata.ciphertextSha256 } : {}),
    };
  }
}

class Direct implements DirectCiphertextAdapter {
  async put(_grant: PresignGrant, value: Uint8Array) { return { bytes: value.byteLength, sha256: createHash('sha256').update(value).digest('hex') }; }
  async get() { return new Uint8Array(); }
  async head() { return { exists: false }; }
  async delete() {}
}

function source(): BackupIntegrationSource {
  return {
    estimate: vi.fn(async (scopes: readonly BackupScope[]) => ({ estimatedEncryptedBytes: 1024, counts: { files: scopes.length } })),
    gather: vi.fn(async (scopes: readonly BackupScope[]) => ({
      appVersion: '0.1.0',
      logicalSchemaVersion: 'phase1-v1',
      selectedScopes: [...scopes],
      sourceRevisions: { notes: 'r1' },
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

function fixture(shared?: {
  repository: FailingRepository;
  credentials: FailingCredentials;
  settings: { enabled: boolean; get(): boolean; set(value: boolean): void };
  consent: ReturnType<typeof consentStore>;
}) {
  const values = shared ?? {
    repository: new FailingRepository(),
    credentials: new FailingCredentials(),
    settings: { enabled: false, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } },
    consent: consentStore(),
  };
  const manager = new BackupIntegrationManager({
    settings: values.settings,
    consentStore: values.consent,
    recoveryStore: { get: () => null, set: () => { throw new Error('settings persistence unavailable'); }, clear: () => { throw new Error('settings persistence unavailable'); } },
    approval: { request: async (prompt: BackupApprovalPrompt) => ({ commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: NOW }) },
    source: source(),
    repository: values.repository,
    credentialStore: values.credentials,
    presignClient: new Presign(),
    directAdapter: new Direct(),
    target: TARGET,
    now: () => NOW,
  });
  return { ...values, manager };
}

async function enable(x: ReturnType<typeof fixture>) {
  const draft = await x.manager.prepareEnable(['note-markdown', 'note-metadata']);
  await x.manager.enable({ ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true });
  return draft;
}

describe('r4 repository-owned durable create recovery', () => {
  it.each(['credential-put', 'snapshot-save-key-cleanup', 'snapshot-save-discard-cleanup'] as const)(
    'survives settings marker failure and restart after %s failure',
    async (failure) => {
      const x = fixture();
      const draft = await enable(x);
      if (failure === 'credential-put') {
        x.credentials.failPutAfterStore = true;
        x.credentials.failDelete = true;
      } else {
        x.repository.failSaveAfterStore = true;
        if (failure === 'snapshot-save-key-cleanup') x.credentials.failDelete = true;
        else x.repository.failDiscard = true;
      }

      await expect(x.manager.create({ selectedScopes: draft.selectedScopes })).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
      await expect(x.manager.disable()).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
      const pending = await x.repository.listRecoveryIntents();
      expect(pending).toHaveLength(1);
      expect(JSON.stringify(pending)).not.toMatch(/key(Id)?|content|path|url|token|secret/i);

      const restarted = fixture(x);
      await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: true });
      await expect(restarted.manager.prepareEnable(['note-markdown', 'note-metadata'])).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });

      restarted.credentials.failPutAfterStore = false;
      restarted.credentials.failDelete = false;
      restarted.repository.failSaveAfterStore = false;
      restarted.repository.failDiscard = false;
      await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
      expect(restarted.credentials.values.size).toBe(0);
      expect(await restarted.repository.list()).toEqual([]);
      expect(await restarted.repository.listRecoveryIntents()).toEqual([]);
    },
  );
});
