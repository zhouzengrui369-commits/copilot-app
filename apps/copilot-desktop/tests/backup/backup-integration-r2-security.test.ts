import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  BackupApprovalGate,
  type BackupApprovalDecision,
  type BackupApprovalPort,
  type BackupApprovalPrompt,
} from '../../src/main/backup-integration/approval.js';
import {
  BackupIntegrationManager,
  InMemoryBackupRepository,
  type BackupConsentStore,
  type BackupIntegrationSource,
  type BackupRepository,
} from '../../src/main/backup-integration/manager.js';
import {
  FetchDirectCiphertextAdapter,
  InMemoryPresignGrantRegistry,
} from '../../src/main/backup-integration/cloud-adapters.js';
import { registerBackupIpc } from '../../src/main/backup-integration/ipc.js';
import type {
  BackupCredentialStore,
  BackupPresignClient,
  DirectCiphertextAdapter,
  PresignGrant,
  PresignMetadata,
} from '../../src/main/backup/index.js';
import type { BackupConsentReceipt, BackupEnableRequest } from '../../src/shared/backup-management.js';

const NOW = 1_725_000_000_000;
const SNAPSHOT = '11111111-1111-4111-8111-111111111111';
const TARGET = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: 'a'.repeat(64), targetHash: 'b'.repeat(64) };
const CONTENT_TYPE = 'application/vnd.njx.copilot-backup' as const;

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class MemoryCredentials implements BackupCredentialStore {
  values = new Map<string, Uint8Array>();
  puts = 0; deletes = 0;
  async putDataKey(id: string, key: Uint8Array) { this.puts += 1; this.values.set(id, new Uint8Array(key)); }
  async getDataKey(id: string) { return this.values.get(id) ?? null; }
  async deleteDataKey(id: string) { this.deletes += 1; this.values.delete(id); }
}

class MemoryPresign implements BackupPresignClient {
  requests: PresignMetadata[] = [];
  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    this.requests.push(metadata);
    return {
      method: metadata.method, key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?q-signature=x`,
      contentType: metadata.contentType, expiresAtMs: NOW + 60_000,
      ...(metadata.method === 'PUT' ? { ciphertextBytes: metadata.ciphertextBytes, ciphertextSha256: metadata.ciphertextSha256 } : {}),
    };
  }
}

class MemoryDirect implements DirectCiphertextAdapter {
  object: Uint8Array | null = null;
  calls: string[] = [];
  async put(_grant: PresignGrant, bytes: Uint8Array) { this.calls.push('PUT'); this.object = new Uint8Array(bytes); return { bytes: bytes.byteLength, sha256: sha256(bytes) }; }
  async get() { this.calls.push('GET'); return new Uint8Array(this.object ?? []); }
  async head() { this.calls.push('HEAD'); return this.object ? { exists: true, bytes: this.object.byteLength, sha256: sha256(this.object) } : { exists: false }; }
  async delete() { this.calls.push('DELETE'); this.object = null; }
}

function autoApproval(overrides: Partial<BackupApprovalDecision> = {}): BackupApprovalPort {
  return {
    request: vi.fn(async (prompt: BackupApprovalPrompt): Promise<BackupApprovalDecision> => ({
      commandId: prompt.commandId,
      commandDigest: prompt.commandDigest,
      deadlineMs: prompt.deadlineMs,
      decision: 'approve',
      decidedAtMs: NOW,
      ...overrides,
    })),
  };
}

function makeConsentStore(seed?: { receipt?: BackupConsentReceipt | null; generation?: number }): BackupConsentStore & { receipt: BackupConsentReceipt | null; generation: number } {
  const store = {
    receipt: seed?.receipt ?? null,
    generation: seed?.generation ?? 0,
    getReceipt: () => store.receipt,
    setReceipt: (value: BackupConsentReceipt) => { store.receipt = structuredClone(value); },
    clearReceipt: () => { store.receipt = null; },
    getGeneration: () => store.generation,
    setGeneration: (value: number) => { store.generation = value; },
  };
  return store;
}

function source(inputPromise?: Promise<ReturnType<BackupIntegrationSource['gather']> extends Promise<infer T> ? T : never>): BackupIntegrationSource {
  const input = {
    appVersion: '0.1.0', logicalSchemaVersion: 'phase1-v1',
    selectedScopes: ['note-markdown', 'note-metadata'] as const,
    sourceRevisions: { notes: 'r1' },
    files: [
      { logicalPath: 'notes/a.md', scope: 'note-markdown' as const, data: new TextEncoder().encode('# local') },
      { logicalPath: 'notes/metadata.json', scope: 'note-metadata' as const, data: new TextEncoder().encode('[]') },
    ],
  };
  return {
    estimate: vi.fn().mockResolvedValue({ estimatedEncryptedBytes: 2048, counts: { notes: 1, files: 2 } }),
    gather: vi.fn(() => inputPromise ?? Promise.resolve(input)),
  };
}

function fixture(options: {
  enabled?: boolean;
  consentStore?: ReturnType<typeof makeConsentStore>;
  approval?: BackupApprovalPort;
  source?: BackupIntegrationSource;
  repository?: BackupRepository;
  credentials?: MemoryCredentials;
  direct?: DirectCiphertextAdapter;
  presign?: MemoryPresign;
  abortAndClear?: () => void;
  resumeNetwork?: () => void;
} = {}) {
  const settings = { enabled: options.enabled ?? false, get: () => settings.enabled, set: (value: boolean) => { settings.enabled = value; } };
  const consentStore = options.consentStore ?? makeConsentStore();
  const credentials = options.credentials ?? new MemoryCredentials();
  const repository = options.repository ?? new InMemoryBackupRepository();
  const direct = options.direct ?? new MemoryDirect();
  const presign = options.presign ?? new MemoryPresign();
  const approval = options.approval ?? autoApproval();
  const manager = new BackupIntegrationManager({
    settings, consentStore, approval, source: options.source ?? source(), repository,
    credentialStore: credentials, presignClient: presign, directAdapter: direct,
    target: TARGET, now: () => NOW, abortAndClear: options.abortAndClear, resumeNetwork: options.resumeNetwork,
  });
  return { manager, settings, consentStore, credentials, repository, direct, presign, approval };
}

async function enable(x: ReturnType<typeof fixture>) {
  const draft = await x.manager.prepareEnable(['note-markdown', 'note-metadata']);
  const request: BackupEnableRequest = {
    ...draft,
    retentionDeleteAcknowledged: true,
    keyLossAcknowledged: true,
    cloudCannotDecryptAcknowledged: true,
    firstUploadAcknowledged: true,
  };
  await x.manager.enable(request);
  return { draft, request };
}

describe('r2 canonical enable receipt', () => {
  it.each([
    ['region', 'ap-beijing'],
    ['bucket', 'other-123456'],
    ['selectedScopes', ['todos']],
    ['estimatedEncryptedBytes', 2049],
    ['counts', { notes: 2, files: 2 }],
    ['retentionAndDelete', 'changed'],
    ['keyLoss', 'changed'],
    ['cloudCannotDecrypt', 'changed'],
    ['exactFirstUpload', 'changed'],
    ['issuedAtMs', NOW + 1],
    ['expiresAtMs', NOW + 999_999],
  ])('rejects rebinding %s before persistence', async (field, changed) => {
    const x = fixture();
    const draft = await x.manager.prepareEnable(['note-markdown', 'note-metadata']);
    const request = { ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true, [field]: changed } as BackupEnableRequest;
    await expect(x.manager.enable(request)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(x.settings.enabled).toBe(false);
    expect(x.consentStore.receipt).toBeNull();
  });

  it('persists the canonical receipt, restores current scopes after restart, and rejects a revoked old receipt', async () => {
    const x = fixture();
    await enable(x);
    const receipt = structuredClone(x.consentStore.receipt!);
    expect(receipt).toMatchObject({ schemaVersion: 1, consentId: expect.any(String), region: TARGET.region, bucket: TARGET.bucket, selectedScopes: ['note-markdown', 'note-metadata'], estimatedEncryptedBytes: 2048, counts: { files: 2, notes: 1 }, issuedAtMs: NOW, expiresAtMs: expect.any(Number), generation: 1, bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const restarted = fixture({ enabled: true, consentStore: x.consentStore });
    await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: true, allowedScopes: ['note-markdown', 'note-metadata'] });

    await restarted.manager.disable();
    expect(x.consentStore.receipt).toBeNull();
    const revokedGeneration = x.consentStore.generation;
    x.consentStore.receipt = receipt;
    const replayed = fixture({ enabled: true, consentStore: x.consentStore });
    await expect(replayed.manager.getState()).resolves.toMatchObject({ enabled: false, allowedScopes: [] });
    expect(x.consentStore.generation).toBe(revokedGeneration);
    expect(x.consentStore.receipt).toBeNull();
  });
});

describe('r2 main-native per-command approval', () => {
  it('rejects renderer approved fields as unknown before runtime and sends only intent payloads', () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const runtime = { create: vi.fn(), enable: vi.fn() };
    registerBackupIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, () => runtime as never, () => true);
    expect(() => handlers.get('copilot:backup:create')?.({}, { approved: true, selectedScopes: ['note-markdown', 'note-metadata'] })).toThrowError();
    expect(() => handlers.get('copilot:backup:enable')?.({}, { approved: true })).toThrowError();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.enable).not.toHaveBeenCalled();
  });

  it('binds a native approval to action/scope/object/bytes/hash and executes only on an exact decision', async () => {
    const approval = autoApproval();
    const x = fixture({ approval });
    const { draft } = await enable(x);
    await x.manager.create({ selectedScopes: draft.selectedScopes });
    expect(approval.request).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'create', scopes: ['note-markdown', 'note-metadata'], bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), destructiveWarning: null,
      commandId: expect.any(String), commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/), deadlineMs: NOW + 60_000,
    }), expect.any(AbortSignal));
  });

  it('rejects expired, replayed and cross-command decisions', async () => {
    let now = NOW;
    const first: { value?: BackupApprovalDecision } = {};
    const port: BackupApprovalPort = { request: vi.fn(async (prompt) => {
      if (!first.value) first.value = { commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: now };
      return first.value;
    }) };
    const gate = new BackupApprovalGate(port, () => now);
    const base = { action: 'upload' as const, scopes: ['note-markdown'] as const, objectId: SNAPSHOT, bytes: 9, sha256: 'c'.repeat(64), destructiveWarning: null };
    await gate.approve(base, new AbortController().signal);
    await expect(gate.approve(base, new AbortController().signal)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(gate.approve({ ...base, action: 'delete', destructiveWarning: 'exact object deletion' }, new AbortController().signal)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    const expiring = new BackupApprovalGate({ request: async (prompt) => { now = prompt.deadlineMs + 1; return { commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: now }; } }, () => now);
    await expect(expiring.approve(base, new AbortController().signal)).rejects.toMatchObject({ code: 'CONSENT_EXPIRED' });
  });
});

describe('r2 disable generation fence', () => {
  it('waits for an in-flight gather, then leaves zero key/catalog/network commit after disable resolves', async () => {
    const gather = deferred<any>();
    const x = fixture({ source: source(gather.promise), abortAndClear: vi.fn() });
    const { draft } = await enable(x);
    const creating = x.manager.create({ selectedScopes: draft.selectedScopes });
    await vi.waitFor(() => expect((x.manager as unknown as { active: { operation: string } | null }).active?.operation).toBe('create'));
    let disabled = false;
    const disabling = x.manager.disable().then(() => { disabled = true; });
    await Promise.resolve();
    expect(disabled).toBe(false);
    gather.resolve({ appVersion: '0.1.0', logicalSchemaVersion: 'phase1-v1', selectedScopes: ['note-markdown', 'note-metadata'], sourceRevisions: { notes: 'r1' }, files: [] });
    await expect(creating).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await disabling;
    expect(x.credentials.puts).toBe(0);
    expect(x.presign.requests).toHaveLength(0);
    expect(await x.repository.list()).toEqual([]);
  });

  it('cleans a created key and late repository save, and does not HEAD/update after delayed upload abort', async () => {
    const x = fixture();
    const { draft } = await enable(x);
    const created = await x.manager.create({ selectedScopes: draft.selectedScopes });
    const upload = deferred<{ bytes: number; sha256: string }>();
    const calls: string[] = [];
    const delayedDirect: DirectCiphertextAdapter = {
      put: async (_grant, bytes) => { calls.push('PUT'); const result = await upload.promise; return { ...result, bytes: bytes.byteLength, sha256: sha256(bytes) }; },
      get: async () => new Uint8Array(), head: async () => { calls.push('HEAD'); return { exists: true }; }, delete: async () => undefined,
    };
    (x.manager as unknown as { options: { directAdapter: DirectCiphertextAdapter } }).options.directAdapter = delayedDirect;
    (x.manager as unknown as { engine: { options: { directAdapter: DirectCiphertextAdapter } } }).engine.options.directAdapter = delayedDirect;
    const uploading = x.manager.upload({ snapshotId: created.snapshotId });
    await vi.waitFor(() => expect(calls).toEqual(['PUT']));
    const disabling = x.manager.disable();
    upload.resolve({ bytes: created.bytes, sha256: created.sha256 });
    await expect(uploading).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await disabling;
    expect(calls).toEqual(['PUT']);
    expect((await x.repository.load(created.snapshotId))?.catalog.status).toBe('local');
  });

  it('rolls back an uncommitted local snapshot and key before disable resolves when repository save finishes late', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    class DelayedRepository extends InMemoryBackupRepository {
      override async save(created: Parameters<InMemoryBackupRepository['save']>[0], nowMs: number) {
        entered.resolve();
        await release.promise;
        return super.save(created, nowMs);
      }
    }
    const repository = new DelayedRepository();
    const x = fixture({ repository });
    const { draft } = await enable(x);
    const creating = x.manager.create({ selectedScopes: draft.selectedScopes });
    await entered.promise;
    let disabled = false;
    const disabling = x.manager.disable().then(() => { disabled = true; });
    await Promise.resolve();
    expect(disabled).toBe(false);
    release.resolve();
    await expect(creating).rejects.toMatchObject({ code: 'BACKUP_DISABLED' });
    await disabling;
    expect(x.credentials.puts).toBe(1);
    expect(x.credentials.deletes).toBe(1);
    expect(x.credentials.values.size).toBe(0);
    expect(await repository.list()).toEqual([]);
  });
});

describe('r2 self-validating direct grants', () => {
  function metadata(method: PresignMetadata['method'] = 'HEAD'): PresignMetadata {
    return { method, ...TARGET, snapshotId: SNAPSHOT, key: `backup/v1/${TARGET.ownerHash}/${TARGET.targetHash}/${SNAPSHOT}.cbackup`, ttlSeconds: 60, contentType: CONTENT_TYPE, ...(method === 'PUT' ? { ciphertextBytes: 3, ciphertextSha256: sha256(new Uint8Array([1, 2, 3])) } : {}) };
  }
  function grant(meta: PresignMetadata): PresignGrant {
    return { method: meta.method, key: meta.key, url: `https://${meta.bucket}.cos.${meta.region}.myqcloud.com/${meta.key}?q-signature=x`, contentType: CONTENT_TYPE, expiresAtMs: NOW + 60_000, ...(meta.method === 'PUT' ? { ciphertextBytes: meta.ciphertextBytes, ciphertextSha256: meta.ciphertextSha256 } : {}) };
  }

  it.each([
    ['userinfo', (url: string) => url.replace('https://', 'https://user:pass@')],
    ['non443', (url: string) => url.replace('.com/', '.com:444/')],
    ['fragment', (url: string) => `${url}#leak`],
    ['host', (url: string) => url.replace('.myqcloud.com', '.evil.example')],
    ['path', (url: string) => url.replace(`${SNAPSHOT}.cbackup`, 'other.cbackup')],
  ])('rejects malicious %s grant with zero fetch', async (_name, mutate) => {
    const registry = new InMemoryPresignGrantRegistry();
    const meta = metadata();
    const good = grant(meta);
    registry.remember(meta, good, { 'content-type': CONTENT_TYPE }, NOW);
    const fetcher = vi.fn();
    const adapter = new FetchDirectCiphertextAdapter(fetcher, registry, () => undefined, () => NOW);
    await expect(adapter.head({ ...good, url: mutate(good.url) })).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects expired/wrong-method/credential headers and enforces no-redirect/no-credentials/no-referrer', async () => {
    const registry = new InMemoryPresignGrantRegistry();
    const meta = metadata();
    const good = grant(meta);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-length': '0' }) });
    const adapter = new FetchDirectCiphertextAdapter(fetcher, registry, () => undefined, () => NOW);
    expect(() => registry.remember(meta, good, { 'content-type': CONTENT_TYPE, Authorization: 'forbidden' }, NOW)).toThrowError();
    await expect(adapter.head(good)).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
    registry.clear();
    expect(() => registry.remember(meta, { ...good, expiresAtMs: NOW - 1 }, { 'content-type': CONTENT_TYPE }, NOW)).toThrowError(expect.objectContaining({ code: 'PRESIGN_EXPIRED' }));
    registry.clear();
    registry.remember(meta, good, { 'content-type': CONTENT_TYPE }, NOW);
    await expect(adapter.get(good)).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.head(good);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});
