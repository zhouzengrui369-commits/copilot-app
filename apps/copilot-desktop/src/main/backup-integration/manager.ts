import { createHash, randomUUID } from 'node:crypto';

import {
  BACKUP_CONTENT_TYPE,
  BackupEngine,
  BackupProtocolError,
  createBackupRequestDigest,
  inspectBackupContainer,
  type BackupCommand,
  type BackupCommandAuthorization,
  type BackupCredentialStore,
  type BackupPresignClient,
  type BackupRemoteTarget,
  type BackupScope,
  type CreatedBackup,
  type CreateBackupInput,
  type DirectCiphertextAdapter,
  type RestorePlan,
  type RestoreTempStore,
} from '../backup/index.js';
import { stableStringify } from '../backup/validation.js';
import type {
  BackupCatalogEntry,
  BackupCatalogStatus,
  BackupConsentReceipt,
  BackupEnableDraft,
  BackupEnableRequest,
  BackupManagementState,
  BackupRecoveryMarker,
  BackupRestoreApplyRequest,
  BackupRestoreImportResult,
  BackupRestorePreview,
} from '../../shared/backup-management.js';
import {
  BackupApprovalGate,
  type BackupApprovalPort,
  type BackupApprovalPrompt,
} from './approval.js';

const RETENTION_AND_DELETE = 'Cloud retention is owner-controlled. Disabling does not delete local or cloud snapshots; Delete removes only the exact selected object.';
const KEY_LOSS = 'The local data key is not uploaded. If the OS-protected key is lost, the cloud ciphertext cannot be restored.';
const CLOUD_CANNOT_DECRYPT = 'Tencent Cloud receives ciphertext only and cannot decrypt snapshot contents.';
const EXACT_FIRST_UPLOAD = 'Create one encrypted local snapshot; upload only after a separate Upload click.' as const;
const SUPPORTED_SCOPES: readonly BackupScope[] = ['note-markdown', 'note-metadata', 'todos', 'preferences'];

export interface BackupIntegrationSource {
  estimate(scopes: readonly BackupScope[]): Promise<{
    estimatedEncryptedBytes: number;
    counts: Record<string, number>;
  }>;
  gather(scopes: readonly BackupScope[]): Promise<CreateBackupInput>;
  prepareRestoreImport?(input: {
    plan: RestorePlan;
    files: ReadonlyMap<string, Uint8Array>;
  }): Promise<BackupPreparedRestoreImport>;
  applyRestoreImport?(prepared: BackupPreparedRestoreImport): Promise<void>;
  rollbackRestoreImport?(intent: BackupRestoreImportIntent): Promise<void>;
}

export interface BackupPreparedRestoreNote {
  path: string;
  originalLogicalPath: string;
  title: string;
  body: string;
  type: 'article' | 'note' | 'meeting' | 'todo' | 'reference' | 'idea' | null;
  status: 'draft' | 'active' | 'archived' | null;
  tags: string[];
  related: string[];
  confidence: number | null;
  agent: string | null;
}

export interface BackupPreparedRestoreTodo {
  id: string;
  title: string;
  body: string;
  due_at_ms: number | null;
  remind_at_ms: number | null;
  status: 'pending' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  note_links: string[];
  reminder_fired: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface BackupPreparedRestoreImport {
  importNamespace: string;
  notes: BackupPreparedRestoreNote[];
  todos: BackupPreparedRestoreTodo[];
  conflicts: string[];
}

export type BackupRestoreImportState = 'prepared' | 'applying' | 'rollback-pending';

/** Durable rollback truth only. It intentionally contains no plaintext or local filesystem path. */
export interface BackupRestoreImportIntent {
  schemaVersion: 1;
  operationId: string;
  snapshotId: string;
  previewDigest: string;
  generation: number;
  importNamespace: string;
  notePaths: string[];
  todoIds: string[];
  state: BackupRestoreImportState;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: number;
}

interface StoredSnapshot {
  catalog: BackupCatalogEntry;
  container: Uint8Array;
}

export type BackupCreateRecoveryState =
  | 'credential-put-pending'
  | 'credential-put-complete'
  | 'snapshot-save-pending'
  | 'snapshot-save-complete'
  | 'credential-delete-pending'
  | 'credential-delete-complete'
  | 'snapshot-discard-pending'
  | 'snapshot-discard-complete';

/** Repository-owned create transaction truth. IDs are opaque; no key material, content, URL or path is persisted. */
export interface BackupCreateRecoveryIntent {
  schemaVersion: 1;
  operationId: string;
  credentialId: string;
  snapshotId: string | null;
  requestDigestSha256: string;
  snapshotDigestSha256: string | null;
  state: BackupCreateRecoveryState;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: number;
}

const BACKUP_CREATE_RECOVERY_STATES = new Set<BackupCreateRecoveryState>([
  'credential-put-pending',
  'credential-put-complete',
  'snapshot-save-pending',
  'snapshot-save-complete',
  'credential-delete-pending',
  'credential-delete-complete',
  'snapshot-discard-pending',
  'snapshot-discard-complete',
]);
const RECOVERY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECOVERY_SHA256 = /^[a-f0-9]{64}$/;
const RESTORE_IMPORT_STATES = new Set<BackupRestoreImportState>([
  'prepared',
  'applying',
  'rollback-pending',
]);

/**
 * Validates both the wire shape and the state machine semantics. Recovery data
 * is hostile restart input: an impossible state must never be interpreted as
 * proof that a credential or snapshot was already cleaned up.
 */
export function validBackupCreateRecoveryIntent(value: unknown): value is BackupCreateRecoveryIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const expectedKeys = [
    'attempts', 'createdAtMs', 'credentialId', 'operationId', 'requestDigestSha256',
    'schemaVersion', 'snapshotDigestSha256', 'snapshotId', 'state', 'updatedAtMs',
  ].sort();
  const actualKeys = Object.keys(item).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || item.schemaVersion !== 1
    || typeof item.operationId !== 'string' || !RECOVERY_UUID.test(item.operationId)
    || typeof item.credentialId !== 'string' || !RECOVERY_UUID.test(item.credentialId)
    || typeof item.requestDigestSha256 !== 'string' || !RECOVERY_SHA256.test(item.requestDigestSha256)
    || typeof item.state !== 'string' || !BACKUP_CREATE_RECOVERY_STATES.has(item.state as BackupCreateRecoveryState)
    || !Number.isSafeInteger(item.createdAtMs) || Number(item.createdAtMs) < 0
    || !Number.isSafeInteger(item.updatedAtMs) || Number(item.updatedAtMs) < Number(item.createdAtMs)
    || !Number.isSafeInteger(item.attempts) || Number(item.attempts) < 0
  ) return false;

  const snapshotIdBound = typeof item.snapshotId === 'string' && RECOVERY_UUID.test(item.snapshotId);
  const snapshotDigestBound = typeof item.snapshotDigestSha256 === 'string' && RECOVERY_SHA256.test(item.snapshotDigestSha256);
  const snapshotPairNull = item.snapshotId === null && item.snapshotDigestSha256 === null;
  const snapshotPairBound = snapshotIdBound && snapshotDigestBound;
  if (!snapshotPairNull && !snapshotPairBound) return false;

  const state = item.state as BackupCreateRecoveryState;
  if (state === 'credential-put-pending' || state === 'credential-put-complete') return snapshotPairNull;
  if (state === 'credential-delete-pending' || state === 'credential-delete-complete') {
    return snapshotPairNull || snapshotPairBound;
  }
  return snapshotPairBound;
}

export function validBackupRestoreImportIntent(value: unknown): value is BackupRestoreImportIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const expectedKeys = [
    'attempts', 'createdAtMs', 'generation', 'importNamespace', 'notePaths',
    'operationId', 'previewDigest', 'schemaVersion', 'snapshotId', 'state',
    'todoIds', 'updatedAtMs',
  ].sort();
  const actualKeys = Object.keys(item).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || item.schemaVersion !== 1
    || typeof item.operationId !== 'string' || !RECOVERY_UUID.test(item.operationId)
    || typeof item.snapshotId !== 'string' || !RECOVERY_UUID.test(item.snapshotId)
    || typeof item.previewDigest !== 'string' || !RECOVERY_SHA256.test(item.previewDigest)
    || !Number.isSafeInteger(item.generation) || Number(item.generation) < 0
    || typeof item.state !== 'string' || !RESTORE_IMPORT_STATES.has(item.state as BackupRestoreImportState)
    || !Number.isSafeInteger(item.createdAtMs) || Number(item.createdAtMs) < 0
    || !Number.isSafeInteger(item.updatedAtMs) || Number(item.updatedAtMs) < Number(item.createdAtMs)
    || !Number.isSafeInteger(item.attempts) || Number(item.attempts) < 0
    || !Array.isArray(item.notePaths) || !Array.isArray(item.todoIds)
  ) return false;
  const namespace = `backup-import-${item.snapshotId}`;
  if (item.importNamespace !== namespace) return false;
  const notePaths = item.notePaths as unknown[];
  const todoIds = item.todoIds as unknown[];
  if (
    new Set(notePaths).size !== notePaths.length
    || new Set(todoIds).size !== todoIds.length
    || notePaths.some((candidate) => typeof candidate !== 'string' || !new RegExp(`^${namespace}/notes/[a-f0-9]{64}$`).test(candidate))
    || todoIds.some((candidate) => typeof candidate !== 'string' || !new RegExp(`^${namespace}-todo-[a-f0-9]{64}$`).test(candidate))
  ) return false;
  return true;
}

export interface BackupRepository {
  list(): Promise<BackupCatalogEntry[]>;
  save(created: CreatedBackup, nowMs: number): Promise<BackupCatalogEntry>;
  load(snapshotId: string): Promise<StoredSnapshot | null>;
  update(snapshotId: string, status: BackupCatalogStatus, beforeCommit?: () => void): Promise<BackupCatalogEntry>;
  /** Removes only a snapshot created by an operation that never committed. */
  discard(snapshotId: string): Promise<void>;
  listRecoveryIntents(): Promise<BackupCreateRecoveryIntent[]>;
  putRecoveryIntent(intent: BackupCreateRecoveryIntent): Promise<void>;
  removeRecoveryIntent(operationId: string): Promise<void>;
  listRestoreImportIntents(): Promise<BackupRestoreImportIntent[]>;
  putRestoreImportIntent(intent: BackupRestoreImportIntent): Promise<void>;
  removeRestoreImportIntent(operationId: string): Promise<void>;
}

export interface BackupConsentStore {
  getReceipt(): BackupConsentReceipt | null;
  setReceipt(receipt: BackupConsentReceipt): void;
  clearReceipt(): void;
  getGeneration(): number;
  setGeneration(generation: number): void;
}

export interface BackupRecoveryStore {
  get(): BackupRecoveryMarker | null;
  set(marker: BackupRecoveryMarker): void;
  clear(): void;
}

export class BackupRecoveryRequiredError extends Error {
  readonly code = 'BACKUP_RECOVERY_REQUIRED' as const;
  constructor() {
    super('backup cleanup recovery is required');
    this.name = 'BackupRecoveryRequiredError';
  }
}

export class InMemoryBackupRepository implements BackupRepository {
  private readonly values = new Map<string, StoredSnapshot>();
  private readonly recoveryIntents = new Map<string, BackupCreateRecoveryIntent>();
  private readonly restoreImportIntents = new Map<string, BackupRestoreImportIntent>();
  touches = 0;
  recoveryTouches = 0;
  async list() { this.touches += 1; return [...this.values.values()].map((v) => ({ ...v.catalog })); }
  async save(created: CreatedBackup, nowMs: number) {
    this.touches += 1;
    const catalog: BackupCatalogEntry = { snapshotId: created.snapshotId, sha256: created.containerSha256, bytes: created.containerBytes, createdAtMs: nowMs, status: 'local' };
    this.values.set(created.snapshotId, { catalog, container: new Uint8Array(created.container) });
    return { ...catalog };
  }
  async load(snapshotId: string) {
    this.touches += 1;
    const value = this.values.get(snapshotId);
    return value ? { catalog: { ...value.catalog }, container: new Uint8Array(value.container) } : null;
  }
  async update(snapshotId: string, status: BackupCatalogStatus, beforeCommit?: () => void) {
    this.touches += 1;
    const value = this.values.get(snapshotId);
    if (!value) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    beforeCommit?.();
    value.catalog = { ...value.catalog, status };
    return { ...value.catalog };
  }
  async discard(snapshotId: string): Promise<void> {
    this.touches += 1;
    this.values.delete(snapshotId);
  }
  async listRecoveryIntents(): Promise<BackupCreateRecoveryIntent[]> {
    this.recoveryTouches += 1;
    const intents = [...this.recoveryIntents.values()];
    if (!intents.every(validBackupCreateRecoveryIntent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    return intents.map((intent) => structuredClone(intent));
  }
  async putRecoveryIntent(intent: BackupCreateRecoveryIntent): Promise<void> {
    this.recoveryTouches += 1;
    if (!validBackupCreateRecoveryIntent(intent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    this.recoveryIntents.set(intent.operationId, structuredClone(intent));
  }
  async removeRecoveryIntent(operationId: string): Promise<void> {
    this.recoveryTouches += 1;
    this.recoveryIntents.delete(operationId);
  }
  async listRestoreImportIntents(): Promise<BackupRestoreImportIntent[]> {
    this.recoveryTouches += 1;
    const intents = [...this.restoreImportIntents.values()];
    if (!intents.every(validBackupRestoreImportIntent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    return intents.map((intent) => structuredClone(intent));
  }
  async putRestoreImportIntent(intent: BackupRestoreImportIntent): Promise<void> {
    this.recoveryTouches += 1;
    if (!validBackupRestoreImportIntent(intent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    this.restoreImportIntents.set(intent.operationId, structuredClone(intent));
  }
  async removeRestoreImportIntent(operationId: string): Promise<void> {
    this.recoveryTouches += 1;
    this.restoreImportIntents.delete(operationId);
  }
}

interface EnableSettings {
  get(): boolean;
  set(value: boolean): void;
}

interface OperationContext {
  readonly operation: string;
  readonly generation: number;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  settle(): void;
}

export class BackupIntegrationManager {
  private readonly engine: BackupEngine;
  private readonly now: () => number;
  private readonly approval: BackupApprovalGate;
  private readonly recoveryStore: BackupRecoveryStore;
  private readonly enableDrafts = new Map<string, { draft: BackupEnableDraft; generation: number }>();
  private active: OperationContext | null = null;
  private allowedScopes: BackupScope[] | null = null;
  private remotePresignClient: BackupPresignClient;
  private remoteDirectAdapter: DirectCiphertextAdapter;
  private recoveryAttempt: Promise<boolean> | null = null;
  private volatileRecoveryRequired = false;
  private activeCreateRecovery: {
    operationId: string;
    requestDigestSha256: string;
    intent: BackupCreateRecoveryIntent | null;
  } | null = null;
  private activeRestoreImport: BackupRestoreImportIntent | null = null;

  constructor(private readonly options: {
    settings: EnableSettings;
    consentStore: BackupConsentStore;
    recoveryStore?: BackupRecoveryStore;
    approval: BackupApprovalPort;
    source: BackupIntegrationSource;
    repository: BackupRepository;
    credentialStore: BackupCredentialStore;
    presignClient: BackupPresignClient;
    directAdapter: DirectCiphertextAdapter;
    target: BackupRemoteTarget;
    now?: () => number;
    abortAndClear?: () => void;
    resumeNetwork?: () => void;
    platform?: NodeJS.Platform;
    platformProtection?: BackupManagementState['platformProtection'];
  }) {
    this.now = options.now ?? Date.now;
    this.recoveryStore = options.recoveryStore ?? new InMemoryBackupRecoveryStore();
    this.approval = new BackupApprovalGate(options.approval, this.now);
    this.remotePresignClient = {
      request: (metadata) => this.fencedRemote(() => options.presignClient.request(metadata)),
    };
    this.remoteDirectAdapter = {
      put: (grant, ciphertext) => this.fencedRemote(() => options.directAdapter.put(grant, ciphertext)),
      get: (grant) => this.fencedRemote(() => options.directAdapter.get(grant)),
      head: (grant) => this.fencedRemote(() => options.directAdapter.head(grant)),
      delete: (grant) => this.fencedRemote(() => options.directAdapter.delete(grant)),
    };
    const recoveryAwareCredentialStore: BackupCredentialStore = {
      putDataKey: async (credentialId, key) => {
        const session = this.activeCreateRecovery;
        if (!session) return options.credentialStore.putDataKey(credentialId, key);
        const intent: BackupCreateRecoveryIntent = {
          schemaVersion: 1,
          operationId: session.operationId,
          credentialId,
          snapshotId: null,
          requestDigestSha256: session.requestDigestSha256,
          snapshotDigestSha256: null,
          state: 'credential-put-pending',
          createdAtMs: this.now(),
          updatedAtMs: this.now(),
          attempts: 0,
        };
        await options.repository.putRecoveryIntent(intent);
        session.intent = intent;
        await options.credentialStore.putDataKey(credentialId, key);
        session.intent = await this.transitionRecoveryIntent(intent, 'credential-put-complete');
      },
      getDataKey: (credentialId) => options.credentialStore.getDataKey(credentialId),
      deleteDataKey: async (credentialId) => {
        const session = this.activeCreateRecovery;
        if (!session?.intent || session.intent.credentialId !== credentialId) {
          return options.credentialStore.deleteDataKey(credentialId);
        }
        session.intent = await this.transitionRecoveryIntent(session.intent, 'credential-delete-pending');
        await options.credentialStore.deleteDataKey(credentialId);
        session.intent = await this.transitionRecoveryIntent(session.intent, 'credential-delete-complete');
      },
    };
    this.engine = new BackupEngine({
      credentialStore: recoveryAwareCredentialStore,
      presignClient: this.remotePresignClient,
      directAdapter: this.remoteDirectAdapter,
      now: this.now,
    });
  }

  async getState(): Promise<BackupManagementState> {
    if (!await this.recoverIfRequired()) return this.state(null, [], true);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = this.currentReceipt();
      if (!before) return this.state(null, [], false);
      const catalog = await this.options.repository.list();
      const after = this.currentReceipt();
      if (after && after.generation === before.generation && after.bindingSha256 === before.bindingSha256) {
        return this.state(after, catalog, false);
      }
    }
    throw new BackupProtocolError('BACKUP_DISABLED');
  }

  async prepareEnable(scopes: BackupScope[]): Promise<BackupEnableDraft> {
    await this.requireRecovered();
    if (this.options.settings.get() || this.active) throw new BackupProtocolError('CONSENT_REQUIRED');
    const selectedScopes = this.canonicalScopes(scopes);
    const generation = this.safeGeneration();
    const estimate = await this.options.source.estimate(selectedScopes);
    if (generation !== this.safeGeneration() || this.options.settings.get()) throw new BackupProtocolError('BACKUP_DISABLED');
    this.requireEstimate(estimate);
    const issuedAtMs = this.now();
    const draft: BackupEnableDraft = {
      consentId: randomUUID(),
      region: this.options.target.region,
      bucket: this.options.target.bucket,
      selectedScopes,
      estimatedEncryptedBytes: estimate.estimatedEncryptedBytes,
      counts: canonicalCounts(estimate.counts),
      retentionAndDelete: RETENTION_AND_DELETE,
      keyLoss: KEY_LOSS,
      cloudCannotDecrypt: CLOUD_CANNOT_DECRYPT,
      exactFirstUpload: EXACT_FIRST_UPLOAD,
      issuedAtMs,
      expiresAtMs: issuedAtMs + 5 * 60_000,
    };
    this.enableDrafts.clear();
    this.enableDrafts.set(draft.consentId, { draft, generation });
    return structuredClone(draft);
  }

  async enable(request: BackupEnableRequest): Promise<BackupManagementState> {
    await this.requireRecovered();
    const pending = this.enableDrafts.get(request?.consentId);
    if (
      !pending
      || this.options.settings.get()
      || pending.generation !== this.safeGeneration()
      || request.expiresAtMs <= this.now()
      || stableStringify(this.enableBinding(request)) !== stableStringify(this.enableBinding(pending.draft))
      || !request.retentionDeleteAcknowledged
      || !request.keyLossAcknowledged
      || !request.cloudCannotDecryptAcknowledged
      || !request.firstUploadAcknowledged
    ) throw new BackupProtocolError('CONSENT_REQUIRED');

    const generation = pending.generation + 1;
    const core = {
      ...structuredClone(pending.draft),
      schemaVersion: 1 as const,
      generation,
      ownerHash: this.options.target.ownerHash,
      targetHash: this.options.target.targetHash,
    };
    const receipt: BackupConsentReceipt = {
      ...core,
      bindingSha256: sha256Stable(core),
    };
    this.enableDrafts.clear();
    this.options.consentStore.setGeneration(generation);
    try {
      this.options.consentStore.setReceipt(receipt);
      this.options.settings.set(true);
      this.allowedScopes = [...receipt.selectedScopes];
      this.options.resumeNetwork?.();
    } catch {
      this.options.settings.set(false);
      try { this.options.consentStore.clearReceipt(); } catch { /* settings remains OFF */ }
      this.allowedScopes = null;
      this.options.abortAndClear?.();
      throw new BackupProtocolError('CONSENT_REQUIRED');
    }
    return this.getState();
  }

  async disable(): Promise<BackupManagementState> {
    this.options.settings.set(false);
    this.enableDrafts.clear();
    this.allowedScopes = null;
    const current = this.active;
    current?.controller.abort();
    this.options.abortAndClear?.();
    let storeFailure = false;
    try {
      const generation = this.safeGeneration();
      this.options.consentStore.setGeneration(generation + 1);
      this.options.consentStore.clearReceipt();
    } catch {
      storeFailure = true;
    }
    if (current) await current.settled;
    if (storeFailure) throw new BackupProtocolError('CONSENT_REQUIRED');
    let durableRecoveryRequired = false;
    try {
      durableRecoveryRequired = (await this.options.repository.listRecoveryIntents()).length > 0
        || (await this.options.repository.listRestoreImportIntents()).length > 0;
    } catch {
      durableRecoveryRequired = true;
    }
    if (durableRecoveryRequired || this.volatileRecoveryRequired || this.recoveryStore.get()) throw new BackupRecoveryRequiredError();
    return this.getState();
  }

  async create(request: { selectedScopes: BackupScope[] }): Promise<BackupCatalogEntry> {
    return this.run('create', async (context) => {
      const scopes = this.canonicalScopes(request.selectedScopes);
      if (!this.allowedScopes || stableStringify(scopes) !== stableStringify(this.allowedScopes)) throw new BackupProtocolError('CONSENT_REQUIRED');
      const input = await this.options.source.gather(scopes);
      this.fence(context);
      if (stableStringify(this.canonicalScopes([...input.selectedScopes])) !== stableStringify(scopes)) throw new BackupProtocolError('SCOPE_INVALID');
      const resourceDigest = createBackupRequestDigest(input);
      const prompt = await this.approve(context, {
        action: 'create', scopes, objectId: 'new-encrypted-local-snapshot', bytes: input.files.reduce((sum, file) => sum + file.data.byteLength, 0), sha256: resourceDigest, destructiveWarning: null,
      });
      const recoverySession = {
        operationId: randomUUID(),
        requestDigestSha256: resourceDigest,
        intent: null as BackupCreateRecoveryIntent | null,
      };
      this.activeCreateRecovery = recoverySession;
      try {
        const created = await this.engine.create(input, this.authorization('create', resourceDigest, undefined, prompt));
        this.fence(context);
        if (!recoverySession.intent) throw new BackupRecoveryRequiredError();
        recoverySession.intent = await this.transitionRecoveryIntent(recoverySession.intent, 'snapshot-save-pending', {
          snapshotId: created.snapshotId,
          snapshotDigestSha256: created.containerSha256,
        });
        const result = await this.options.repository.save(created, this.now());
        recoverySession.intent = await this.transitionRecoveryIntent(recoverySession.intent, 'snapshot-save-complete');
        this.fence(context);
        await this.options.repository.removeRecoveryIntent(recoverySession.operationId);
        recoverySession.intent = null;
        this.bestEffortClearRecoveryCache();
        return result;
      } catch (error) {
        if (recoverySession.intent) {
          const recovered = await this.rollbackRecoveryIntent(recoverySession.intent);
          recoverySession.intent = recovered.intent;
          if (!recovered.complete) {
            this.quarantineIntent(recoverySession.intent);
            throw new BackupRecoveryRequiredError();
          }
        }
        throw error;
      } finally {
        if (this.activeCreateRecovery === recoverySession) this.activeCreateRecovery = null;
      }
    });
  }

  async upload(request: { snapshotId: string }): Promise<BackupCatalogEntry> {
    return this.run('upload', async (context) => {
      const stored = await this.requireStored(request.snapshotId, context);
      const prompt = await this.approve(context, this.catalogIntent('upload', stored));
      await this.engine.upload(stored.container, this.options.target, this.authorization('upload', stored.catalog.sha256, request.snapshotId, prompt));
      this.fence(context);
      const grant = await this.remotePresignClient.request(this.metadata('HEAD', request.snapshotId));
      this.fence(context);
      const head = await this.remoteDirectAdapter.head(grant);
      this.fence(context);
      if (!head.exists || head.bytes !== stored.catalog.bytes || head.sha256 !== stored.catalog.sha256) throw new BackupProtocolError('UPLOAD_INTEGRITY_FAILED');
      return this.options.repository.update(request.snapshotId, 'uploaded', () => this.fence(context));
    });
  }

  async downloadVerify(request: { snapshotId: string }): Promise<BackupCatalogEntry> {
    return this.run('download-verify', async (context) => {
      const stored = await this.requireStored(request.snapshotId, context);
      const prompt = await this.approve(context, this.catalogIntent('download-verify', stored));
      await this.engine.download({ ...this.options.target, snapshotId: request.snapshotId, ciphertextBytes: stored.catalog.bytes, ciphertextSha256: stored.catalog.sha256 }, this.authorization('download', stored.catalog.sha256, request.snapshotId, prompt));
      this.fence(context);
      return this.options.repository.update(request.snapshotId, 'verified', () => this.fence(context));
    });
  }

  async restorePreview(request: { snapshotId: string }): Promise<BackupRestorePreview> {
    return this.run('restore-preview', async (context) => {
      const stored = await this.requireStored(request.snapshotId, context);
      const prompt = await this.approve(context, this.catalogIntent('restore-preview', stored));
      const downloaded = await this.engine.download({ ...this.options.target, snapshotId: request.snapshotId, ciphertextBytes: stored.catalog.bytes, ciphertextSha256: stored.catalog.sha256 }, this.authorization('download', stored.catalog.sha256, request.snapshotId, prompt));
      this.fence(context);
      const inspection = inspectBackupContainer(downloaded);
      const temporary = new MemoryRestoreTempStore(() => this.fence(context));
      try {
        const plan = await this.engine.restoreToTemp(downloaded, this.authorization('restore', inspection.containerSha256, request.snapshotId, prompt), temporary);
        this.fence(context);
        const previewDigest = restorePreviewDigest(stored.catalog.sha256, plan);
        let conflicts: string[];
        if (!isSupportedRestoreScopeSet(plan.manifest.selectedScopes) || !this.options.source.prepareRestoreImport) {
          conflicts = ['One or more selected domains do not yet have a safe copy importer.'];
        } else {
          const prepared = await this.options.source.prepareRestoreImport({ plan, files: temporary.files });
          this.fence(context);
          conflicts = [...prepared.conflicts];
        }
        return {
          snapshotId: plan.snapshotId,
          files: plan.files.length,
          records: plan.manifest.recordCount,
          conflicts,
          mode: 'import-as-copy' as const,
          selectedScopes: [...plan.manifest.selectedScopes],
          previewDigest,
          generation: context.generation,
          replaceCurrentAvailable: false as const,
        };
      } finally {
        temporary.clear();
      }
    });
  }

  async restoreApply(request: BackupRestoreApplyRequest): Promise<BackupRestoreImportResult> {
    return this.run('restore-apply', async (context) => {
      const scopes = canonicalRestoreScopes(request.selectedScopes);
      if (request.generation !== context.generation || !RECOVERY_SHA256.test(request.previewDigest)) {
        throw new BackupProtocolError('RESTORE_APPROVAL_REQUIRED');
      }
      const stored = await this.requireStored(request.snapshotId, context);
      const prompt = await this.approve(context, {
        action: 'restore-apply',
        scopes,
        objectId: request.snapshotId,
        bytes: stored.catalog.bytes,
        sha256: stored.catalog.sha256,
        previewDigest: request.previewDigest,
        destructiveWarning: 'Import verified copy creates a separate local namespace and never replaces current data.',
      });
      if (prompt.generation !== context.generation || prompt.previewDigest !== request.previewDigest) {
        throw new BackupProtocolError('RESTORE_APPROVAL_REQUIRED');
      }

      const temporary = new MemoryRestoreTempStore(() => this.fence(context));
      let intent: BackupRestoreImportIntent | null = null;
      try {
        const downloaded = await this.engine.download(
          { ...this.options.target, snapshotId: request.snapshotId, ciphertextBytes: stored.catalog.bytes, ciphertextSha256: stored.catalog.sha256 },
          this.authorization('download', stored.catalog.sha256, request.snapshotId, prompt),
        );
        this.fence(context);
        const inspection = inspectBackupContainer(downloaded);
        const plan = await this.engine.restoreToTemp(
          downloaded,
          this.authorization('restore', inspection.containerSha256, request.snapshotId, prompt),
          temporary,
        );
        this.fence(context);
        if (
          plan.snapshotId !== request.snapshotId
          || restorePreviewDigest(stored.catalog.sha256, plan) !== request.previewDigest
          || stableStringify(canonicalRestoreScopes(plan.manifest.selectedScopes)) !== stableStringify(scopes)
          || !this.options.source.prepareRestoreImport
          || !this.options.source.applyRestoreImport
          || !this.options.source.rollbackRestoreImport
        ) throw new BackupProtocolError('RESTORE_CONFLICT');

        const prepared = await this.options.source.prepareRestoreImport({ plan, files: temporary.files });
        this.fence(context);
        if (prepared.conflicts.length > 0
          || prepared.importNamespace !== `backup-import-${request.snapshotId}`) {
          throw new BackupProtocolError('RESTORE_CONFLICT');
        }
        const createdAtMs = this.now();
        intent = {
          schemaVersion: 1,
          operationId: randomUUID(),
          snapshotId: request.snapshotId,
          previewDigest: request.previewDigest,
          generation: context.generation,
          importNamespace: prepared.importNamespace,
          notePaths: prepared.notes.map((note) => note.path),
          todoIds: prepared.todos.map((todo) => todo.id),
          state: 'prepared',
          createdAtMs,
          updatedAtMs: createdAtMs,
          attempts: 0,
        };
        if (!validBackupRestoreImportIntent(intent)) throw new BackupProtocolError('RESTORE_CONFLICT');
        await this.options.repository.putRestoreImportIntent(intent);
        this.activeRestoreImport = intent;
        intent = await this.transitionRestoreImportIntent(intent, 'applying');
        this.activeRestoreImport = intent;
        await this.options.source.applyRestoreImport(prepared);
        this.fence(context);
        await this.options.repository.removeRestoreImportIntent(intent.operationId);
        this.activeRestoreImport = null;
        const result: BackupRestoreImportResult = {
          snapshotId: request.snapshotId,
          previewDigest: request.previewDigest,
          importedNotes: prepared.notes.length,
          importedTodos: prepared.todos.length,
          importNamespace: prepared.importNamespace,
          conflictCount: 0,
          rollbackStatus: 'not-required',
          replaceCurrentAvailable: false,
        };
        intent = null;
        return result;
      } catch (error) {
        if (intent) {
          try {
            intent = await this.transitionRestoreImportIntent(intent, 'rollback-pending');
            this.activeRestoreImport = intent;
            if (!this.options.source.rollbackRestoreImport) throw new Error('restore rollback adapter unavailable');
            await this.options.source.rollbackRestoreImport(intent);
            await this.options.repository.removeRestoreImportIntent(intent.operationId);
            this.activeRestoreImport = null;
            intent = null;
          } catch {
            this.volatileRecoveryRequired = true;
            this.forceOff();
            throw new BackupRecoveryRequiredError();
          }
        }
        throw error;
      } finally {
        if (this.activeRestoreImport?.operationId === intent?.operationId) this.activeRestoreImport = null;
        temporary.clear();
      }
    });
  }

  async deleteRemote(request: { snapshotId: string; confirmSnapshotId: string }): Promise<BackupCatalogEntry> {
    return this.run('delete', async (context) => {
      if (request.confirmSnapshotId !== request.snapshotId) throw new BackupProtocolError('DELETE_APPROVAL_REQUIRED');
      const stored = await this.requireStored(request.snapshotId, context);
      const prompt = await this.approve(context, this.catalogIntent('delete', stored, 'Permanently delete only this exact encrypted cloud object. Local snapshots are preserved.'));
      await this.engine.deleteRemote({ ...this.options.target, snapshotId: request.snapshotId }, this.authorization('delete', request.snapshotId, request.snapshotId, prompt));
      this.fence(context);
      return this.options.repository.update(request.snapshotId, 'remote-deleted', () => this.fence(context));
    });
  }

  async replaceCurrent(): Promise<never> {
    throw new BackupProtocolError('RESTORE_CONFLICT');
  }

  private async run<T>(operation: string, action: (context: OperationContext) => Promise<T>): Promise<T> {
    await this.requireRecovered();
    const receipt = this.currentReceipt();
    if (!receipt) throw new BackupProtocolError('BACKUP_DISABLED');
    if (this.active) throw new BackupProtocolError('CONSENT_REQUIRED');
    let settle!: () => void;
    const context: OperationContext = {
      operation,
      generation: receipt.generation,
      controller: new AbortController(),
      settled: new Promise<void>((resolve) => { settle = resolve; }),
      settle,
    };
    this.active = context;
    try {
      return await action(context);
    } finally {
      if (this.active === context) this.active = null;
      context.settle();
    }
  }

  private async approve(
    context: OperationContext,
    intent: Omit<BackupApprovalPrompt, 'commandId' | 'commandDigest' | 'issuedAtMs' | 'deadlineMs'>,
  ): Promise<BackupApprovalPrompt> {
    const prompt = await this.approval.approve({
      ...intent,
      generation: context.generation,
      previewDigest: intent.previewDigest ?? null,
    }, context.controller.signal);
    this.fence(context);
    return prompt;
  }

  private authorization(command: BackupCommand, resourceDigest: string, snapshotId: string | undefined, prompt: BackupApprovalPrompt): BackupCommandAuthorization {
    return {
      backupEnabled: true,
      nowMs: this.now(),
      consent: { approved: true, command, requestId: prompt.commandId, resourceDigest, snapshotId, approvedAtMs: prompt.issuedAtMs, expiresAtMs: prompt.deadlineMs },
    };
  }

  private catalogIntent(action: BackupApprovalPrompt['action'], stored: StoredSnapshot, destructiveWarning: string | null = null) {
    return {
      action,
      scopes: [...(this.allowedScopes ?? [])],
      objectId: stored.catalog.snapshotId,
      bytes: stored.catalog.bytes,
      sha256: stored.catalog.sha256,
      destructiveWarning,
    };
  }

  private async fencedRemote<T>(call: () => Promise<T>): Promise<T> {
    const context = this.active;
    if (!context) throw new BackupProtocolError('BACKUP_DISABLED');
    this.fence(context);
    const result = await call();
    this.fence(context);
    return result;
  }

  private fence(context: OperationContext): void {
    if (
      this.active !== context
      || context.controller.signal.aborted
      || !this.options.settings.get()
      || context.generation !== this.safeGeneration()
    ) throw new BackupProtocolError('BACKUP_DISABLED');
  }

  private metadata(method: 'HEAD', snapshotId: string) {
    return {
      method,
      ...this.options.target,
      snapshotId,
      key: `backup/v1/${this.options.target.ownerHash}/${this.options.target.targetHash}/${snapshotId}.cbackup`,
      ttlSeconds: 300,
      contentType: BACKUP_CONTENT_TYPE,
    } as const;
  }

  private async requireStored(snapshotId: string, context: OperationContext): Promise<StoredSnapshot> {
    if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    const stored = await this.options.repository.load(snapshotId);
    this.fence(context);
    if (!stored) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    return stored;
  }

  private state(receipt: BackupConsentReceipt | null, catalog: BackupCatalogEntry[], recoveryRequired: boolean): BackupManagementState {
    return {
      enabled: receipt !== null && !recoveryRequired,
      configured: Boolean(this.options.target.region && this.options.target.bucket),
      region: this.options.target.region,
      platformProtection: this.platformProtection(),
      catalog: receipt && !recoveryRequired ? catalog : [],
      allowedScopes: receipt && !recoveryRequired ? [...receipt.selectedScopes] : [],
      activeOperation: this.active?.operation ?? null,
      schedulingAvailable: false,
      replaceCurrentAvailable: false,
      recoveryRequired,
    };
  }

  private async requireRecovered(): Promise<void> {
    if (!await this.recoverIfRequired()) throw new BackupRecoveryRequiredError();
  }

  private async recoverIfRequired(): Promise<boolean> {
    let intents: BackupCreateRecoveryIntent[];
    let restoreIntents: BackupRestoreImportIntent[];
    try {
      const stored = await this.options.repository.listRecoveryIntents();
      if (!stored.every(validBackupCreateRecoveryIntent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
      intents = stored.filter((intent) => intent.operationId !== this.activeCreateRecovery?.operationId);
      const storedRestore = await this.options.repository.listRestoreImportIntents();
      if (!storedRestore.every(validBackupRestoreImportIntent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
      restoreIntents = storedRestore.filter((intent) => intent.operationId !== this.activeRestoreImport?.operationId);
    } catch {
      this.volatileRecoveryRequired = true;
      this.forceOff();
      return false;
    }
    if (intents.length === 0 && restoreIntents.length === 0) {
      if (!this.recoveryStore.get()) return !this.volatileRecoveryRequired;
      if (this.recoveryAttempt) return this.recoveryAttempt;
      const attempt = this.performLegacyMarkerRecovery();
      this.recoveryAttempt = attempt;
      try {
        return await attempt;
      } finally {
        if (this.recoveryAttempt === attempt) this.recoveryAttempt = null;
      }
    }
    if (this.recoveryAttempt) return this.recoveryAttempt;
    const attempt = this.performDurableRecovery(intents, restoreIntents);
    this.recoveryAttempt = attempt;
    try {
      return await attempt;
    } finally {
      if (this.recoveryAttempt === attempt) this.recoveryAttempt = null;
    }
  }

  private async performDurableRecovery(
    intents: BackupCreateRecoveryIntent[],
    restoreIntents: BackupRestoreImportIntent[],
  ): Promise<boolean> {
    this.forceOff();
    if (!this.options.source.rollbackRestoreImport && restoreIntents.length > 0) return false;
    for (let intent of restoreIntents) {
      try {
        intent = await this.transitionRestoreImportIntent(intent, 'rollback-pending');
        await this.options.source.rollbackRestoreImport!(intent);
        await this.options.repository.removeRestoreImportIntent(intent.operationId);
      } catch {
        this.volatileRecoveryRequired = true;
        return false;
      }
    }
    for (const intent of intents) {
      const result = await this.rollbackRecoveryIntent(intent);
      if (!result.complete) {
        this.quarantineIntent(result.intent);
        return false;
      }
    }
    this.volatileRecoveryRequired = false;
    this.bestEffortClearRecoveryCache();
    return true;
  }

  private async performLegacyMarkerRecovery(): Promise<boolean> {
    const marker = this.recoveryStore.get();
    if (!marker || !validRecoveryMarker(marker)) return marker === null && !this.volatileRecoveryRequired;
    this.forceOff();
    let current = marker;
    try {
      if (current.phase === 'credential-cleanup') {
        const stored = await this.options.repository.load(current.snapshotId);
        if (!stored) throw new Error('quarantine snapshot unavailable');
        const keyId = inspectBackupContainer(stored.container).header.keyId;
        await this.options.credentialStore.deleteDataKey(keyId);
        current = { ...current, phase: 'snapshot-discard', attempts: current.attempts + 1 };
        this.recoveryStore.set(current);
      }
      await this.options.repository.discard(current.snapshotId);
      this.recoveryStore.clear();
      this.volatileRecoveryRequired = false;
      return true;
    } catch {
      try { this.recoveryStore.set({ ...current, attempts: current.attempts + 1 }); } catch { /* remain fail closed */ }
      return false;
    }
  }

  private async transitionRecoveryIntent(
    intent: BackupCreateRecoveryIntent,
    state: BackupCreateRecoveryState,
    patch: Pick<BackupCreateRecoveryIntent, 'snapshotId' | 'snapshotDigestSha256'> | Record<string, never> = {},
  ): Promise<BackupCreateRecoveryIntent> {
    const next: BackupCreateRecoveryIntent = {
      ...intent,
      ...patch,
      state,
      updatedAtMs: this.now(),
      attempts: intent.attempts + (state.endsWith('-pending') ? 1 : 0),
    };
    await this.options.repository.putRecoveryIntent(next);
    return next;
  }

  private async transitionRestoreImportIntent(
    intent: BackupRestoreImportIntent,
    state: BackupRestoreImportState,
  ): Promise<BackupRestoreImportIntent> {
    const next: BackupRestoreImportIntent = {
      ...intent,
      state,
      updatedAtMs: this.now(),
      attempts: intent.attempts + (state === 'rollback-pending' ? 1 : 0),
    };
    await this.options.repository.putRestoreImportIntent(next);
    return next;
  }

  private async rollbackRecoveryIntent(intent: BackupCreateRecoveryIntent): Promise<{ complete: boolean; intent: BackupCreateRecoveryIntent }> {
    let current = intent;
    try {
      if (!credentialDeleteComplete(current.state)) {
        current = await this.transitionRecoveryIntent(current, 'credential-delete-pending');
        if (this.activeCreateRecovery?.operationId === current.operationId) this.activeCreateRecovery.intent = current;
        await this.options.credentialStore.deleteDataKey(current.credentialId);
        current = await this.transitionRecoveryIntent(current, 'credential-delete-complete');
        if (this.activeCreateRecovery?.operationId === current.operationId) this.activeCreateRecovery.intent = current;
      }
      if (current.snapshotId !== null && current.state !== 'snapshot-discard-complete') {
        const snapshotId = current.snapshotId;
        current = await this.transitionRecoveryIntent(current, 'snapshot-discard-pending');
        if (this.activeCreateRecovery?.operationId === current.operationId) this.activeCreateRecovery.intent = current;
        await this.options.repository.discard(snapshotId);
        current = await this.transitionRecoveryIntent(current, 'snapshot-discard-complete');
        if (this.activeCreateRecovery?.operationId === current.operationId) this.activeCreateRecovery.intent = current;
      }
      await this.options.repository.removeRecoveryIntent(current.operationId);
      this.bestEffortClearRecoveryCache();
      return { complete: true, intent: current };
    } catch {
      return { complete: false, intent: current };
    }
  }

  private quarantineIntent(intent: BackupCreateRecoveryIntent): void {
    const phase: BackupRecoveryMarker['phase'] = credentialDeleteComplete(intent.state)
      ? 'snapshot-discard'
      : 'credential-cleanup';
    const marker: BackupRecoveryMarker = {
      schemaVersion: 1,
      markerId: randomUUID(),
      snapshotId: intent.snapshotId ?? intent.operationId,
      reason: 'CREATE_ROLLBACK_INCOMPLETE',
      phase,
      createdAtMs: this.now(),
      attempts: 0,
    };
    this.volatileRecoveryRequired = true;
    try { this.recoveryStore.set(marker); } catch { /* stable error still blocks this process */ }
    this.forceOff();
  }

  private bestEffortClearRecoveryCache(): void {
    try { this.recoveryStore.clear(); } catch { /* repository intent remains authoritative */ }
  }

  private forceOff(): void {
    const wasEnabled = this.options.settings.get();
    this.options.settings.set(false);
    this.allowedScopes = null;
    this.enableDrafts.clear();
    this.active?.controller.abort();
    this.options.abortAndClear?.();
    if (wasEnabled) {
      try {
        this.options.consentStore.setGeneration(this.safeGeneration() + 1);
        this.options.consentStore.clearReceipt();
      } catch { /* OFF plus recovery quarantine remains authoritative */ }
    }
  }

  private currentReceipt(): BackupConsentReceipt | null {
    if (!this.options.settings.get()) {
      this.allowedScopes = null;
      return null;
    }
    try {
      const receipt = this.options.consentStore.getReceipt();
      const generation = this.options.consentStore.getGeneration();
      if (!receipt || !this.validReceipt(receipt, generation)) throw new Error('invalid receipt');
      this.allowedScopes = [...receipt.selectedScopes];
      this.options.resumeNetwork?.();
      return receipt;
    } catch {
      this.options.settings.set(false);
      this.allowedScopes = null;
      this.enableDrafts.clear();
      this.options.abortAndClear?.();
      try { this.options.consentStore.clearReceipt(); } catch { /* fail closed in settings even if cleanup fails */ }
      return null;
    }
  }

  private validReceipt(receipt: BackupConsentReceipt, generation: number): boolean {
    const receiptKeys = [
      'bindingSha256', 'bucket', 'cloudCannotDecrypt', 'consentId', 'counts',
      'estimatedEncryptedBytes', 'exactFirstUpload', 'expiresAtMs', 'generation',
      'issuedAtMs', 'keyLoss', 'ownerHash', 'region', 'retentionAndDelete',
      'schemaVersion', 'selectedScopes', 'targetHash',
    ].sort();
    const actualKeys = Object.keys(receipt).sort();
    if (
      actualKeys.length !== receiptKeys.length
      || actualKeys.some((key, index) => key !== receiptKeys[index])
      || receipt.schemaVersion !== 1
      || receipt.generation !== generation
      || receipt.ownerHash !== this.options.target.ownerHash
      || receipt.targetHash !== this.options.target.targetHash
      || receipt.region !== this.options.target.region
      || receipt.bucket !== this.options.target.bucket
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.consentId)
      || !Number.isSafeInteger(receipt.estimatedEncryptedBytes)
      || receipt.estimatedEncryptedBytes < 0
      || !Number.isSafeInteger(receipt.issuedAtMs)
      || !Number.isSafeInteger(receipt.expiresAtMs)
      || receipt.issuedAtMs > this.now()
      || receipt.expiresAtMs <= receipt.issuedAtMs
      || receipt.retentionAndDelete !== RETENTION_AND_DELETE
      || receipt.keyLoss !== KEY_LOSS
      || receipt.cloudCannotDecrypt !== CLOUD_CANNOT_DECRYPT
      || receipt.exactFirstUpload !== EXACT_FIRST_UPLOAD
    ) return false;
    let scopes: BackupScope[];
    try { scopes = this.canonicalScopes(receipt.selectedScopes); } catch { return false; }
    if (stableStringify(scopes) !== stableStringify(receipt.selectedScopes)) return false;
    try { if (stableStringify(canonicalCounts(receipt.counts)) !== stableStringify(receipt.counts)) return false; } catch { return false; }
    const { bindingSha256, ...core } = receipt;
    return /^[a-f0-9]{64}$/.test(bindingSha256) && bindingSha256 === sha256Stable(core);
  }

  private canonicalScopes(scopes: readonly BackupScope[]): BackupScope[] {
    if (!Array.isArray(scopes) || scopes.length === 0 || new Set(scopes).size !== scopes.length || scopes.some((scope) => !SUPPORTED_SCOPES.includes(scope))) throw new BackupProtocolError('SCOPE_INVALID');
    if (scopes.includes('note-markdown') !== scopes.includes('note-metadata')) throw new BackupProtocolError('SCOPE_INVALID');
    return SUPPORTED_SCOPES.filter((scope) => scopes.includes(scope));
  }

  private requireEstimate(estimate: { estimatedEncryptedBytes: number; counts: Record<string, number> }): void {
    if (!Number.isSafeInteger(estimate.estimatedEncryptedBytes) || estimate.estimatedEncryptedBytes < 0) throw new BackupProtocolError('CONSENT_REQUIRED');
    canonicalCounts(estimate.counts);
  }

  private safeGeneration(): number {
    const value = this.options.consentStore.getGeneration();
    if (!Number.isSafeInteger(value) || value < 0) throw new BackupProtocolError('CONSENT_REQUIRED');
    return value;
  }

  private enableBinding(value: BackupEnableDraft) {
    return {
      consentId: value.consentId,
      region: value.region,
      bucket: value.bucket,
      selectedScopes: value.selectedScopes,
      estimatedEncryptedBytes: value.estimatedEncryptedBytes,
      counts: value.counts,
      retentionAndDelete: value.retentionAndDelete,
      keyLoss: value.keyLoss,
      cloudCannotDecrypt: value.cloudCannotDecrypt,
      exactFirstUpload: value.exactFirstUpload,
      issuedAtMs: value.issuedAtMs,
      expiresAtMs: value.expiresAtMs,
    };
  }

  private platformProtection(): BackupManagementState['platformProtection'] {
    if (this.options.platformProtection) return this.options.platformProtection;
    if ((this.options.platform ?? process.platform) === 'darwin') return 'macOS Keychain via Electron safeStorage';
    if ((this.options.platform ?? process.platform) === 'win32') return 'Windows DPAPI via Electron safeStorage';
    return 'Electron safeStorage';
  }
}

class MemoryRestoreTempStore implements RestoreTempStore {
  readonly files = new Map<string, Uint8Array>();
  constructor(private readonly fence: () => void) {}
  async write(relativePath: string, data: Uint8Array): Promise<void> {
    this.fence();
    this.files.set(relativePath, new Uint8Array(data));
    this.fence();
  }
  clear(): void {
    for (const bytes of this.files.values()) bytes.fill(0);
    this.files.clear();
  }
}

class InMemoryBackupRecoveryStore implements BackupRecoveryStore {
  private marker: BackupRecoveryMarker | null = null;
  get(): BackupRecoveryMarker | null { return this.marker ? structuredClone(this.marker) : null; }
  set(marker: BackupRecoveryMarker): void { this.marker = structuredClone(marker); }
  clear(): void { this.marker = null; }
}

function validRecoveryMarker(marker: BackupRecoveryMarker): boolean {
  const keys = ['attempts', 'createdAtMs', 'markerId', 'phase', 'reason', 'schemaVersion', 'snapshotId'].sort();
  const actual = Object.keys(marker).sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index])
    && marker.schemaVersion === 1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker.markerId)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker.snapshotId)
    && marker.reason === 'CREATE_ROLLBACK_INCOMPLETE'
    && (marker.phase === 'credential-cleanup' || marker.phase === 'snapshot-discard')
    && Number.isSafeInteger(marker.createdAtMs)
    && marker.createdAtMs >= 0
    && Number.isSafeInteger(marker.attempts)
    && marker.attempts >= 0;
}

function credentialDeleteComplete(state: BackupCreateRecoveryState): boolean {
  return state === 'credential-delete-complete'
    || state === 'snapshot-discard-pending'
    || state === 'snapshot-discard-complete';
}

function canonicalCounts(value: Record<string, number>): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupProtocolError('CONSENT_REQUIRED');
  const result: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) {
    const count = value[key];
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(key) || !Number.isSafeInteger(count) || Number(count) < 0) throw new BackupProtocolError('CONSENT_REQUIRED');
    result[key] = Number(count);
  }
  return result;
}

function sha256Stable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function isSupportedRestoreScopeSet(scopes: readonly BackupScope[]): boolean {
  try {
    canonicalRestoreScopes(scopes);
    return true;
  } catch {
    return false;
  }
}

function canonicalRestoreScopes(scopes: readonly BackupScope[]): BackupScope[] {
  if (!Array.isArray(scopes) || new Set(scopes).size !== scopes.length) {
    throw new BackupProtocolError('RESTORE_CONFLICT');
  }
  const selected = new Set(scopes);
  if (
    !selected.has('note-markdown')
    || !selected.has('note-metadata')
    || [...selected].some((scope) => !['note-markdown', 'note-metadata', 'todos'].includes(scope))
  ) throw new BackupProtocolError('RESTORE_CONFLICT');
  return ['note-markdown', 'note-metadata', ...(selected.has('todos') ? ['todos' as const] : [])];
}

function restorePreviewDigest(containerSha256: string, plan: RestorePlan): string {
  return sha256Stable({
    snapshotId: plan.snapshotId,
    containerSha256,
    logicalSchemaVersion: plan.manifest.logicalSchemaVersion,
    logicalHashSha256: plan.manifest.logicalHashSha256,
    selectedScopes: [...plan.manifest.selectedScopes],
    files: plan.files.map((file) => ({
      logicalPath: file.logicalPath,
      scope: file.scope,
      bytes: file.bytes,
      plaintextSha256: file.plaintextSha256,
    })).sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)),
  });
}
