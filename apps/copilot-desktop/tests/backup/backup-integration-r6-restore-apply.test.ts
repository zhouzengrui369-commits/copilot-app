import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { BackupApprovalGate, type BackupApprovalPrompt } from '../../src/main/backup-integration/approval.js';
import { LocalKnowledgeBackupSource } from '../../src/main/backup-integration/source.js';
import {
  BackupIntegrationManager,
  InMemoryBackupRepository,
  type BackupConsentStore,
  type BackupIntegrationSource,
  type BackupPreparedRestoreImport,
  type BackupRestoreImportIntent,
} from '../../src/main/backup-integration/manager.js';
import type {
  BackupCredentialStore,
  BackupPresignClient,
  BackupScope,
  DirectCiphertextAdapter,
  PresignGrant,
  PresignMetadata,
  RestorePlan,
} from '../../src/main/backup/index.js';
import type { BackupConsentReceipt } from '../../src/shared/backup-management.js';

const SNAPSHOT = '11111111-1111-4111-8111-111111111111';
const NOTE_PATH = 'work/local.md';
const NOTE_ID = createHash('sha256').update(NOTE_PATH).digest('hex');
const PREVIEW_DIGEST = 'a'.repeat(64);
const encoder = new TextEncoder();

function restoreFixture(
  scopes: BackupScope[] = ['note-markdown', 'note-metadata', 'todos'],
  reminderFired: unknown = 0,
) {
  const metadata = [{
    agent: null,
    confidence: 0.8,
    createdAt: 10,
    folder: 'work',
    logicalId: NOTE_ID,
    originalLogicalPath: NOTE_PATH,
    related: [],
    status: 'active',
    tags: ['local'],
    title: 'Local note',
    type: 'note',
    updatedAt: 20,
  }];
  const todos = [{
    body: 'Follow up', created_at: 30, due_at_ms: null, id: 7,
    note_links: [NOTE_PATH], priority: 'high', remind_at_ms: null,
    reminder_fired: reminderFired, status: 'pending', title: 'Todo', updated_at: 31,
  }];
  const files = new Map<string, Uint8Array>([
    [`notes/${NOTE_ID}.md`, encoder.encode('# private local body')],
    ['notes/metadata.json', encoder.encode(JSON.stringify(metadata))],
    ['todos/items.json', encoder.encode(JSON.stringify(todos))],
  ]);
  const planFiles = [...files.keys()]
    .filter((logicalPath) => scopes.includes(logicalPath.startsWith('todos/') ? 'todos' : logicalPath.endsWith('metadata.json') ? 'note-metadata' : 'note-markdown'))
    .map((logicalPath) => ({
      logicalPath,
      importPath: `imports/${SNAPSHOT}/${logicalPath}`,
      bytes: files.get(logicalPath)!.byteLength,
      plaintextSha256: 'b'.repeat(64),
      scope: logicalPath.startsWith('todos/') ? 'todos' : logicalPath.endsWith('metadata.json') ? 'note-metadata' : 'note-markdown',
    }));
  const plan = {
    mode: 'import-as-copy', snapshotId: SNAPSHOT, localTruthMutated: false, overwriteSupported: false,
    manifest: {
      schemaVersion: 1, appVersion: '0.1.0', logicalSchemaVersion: 'phase1-v1', createdAtMs: 1,
      selectedScopes: scopes, sourceRevisions: {}, fileCount: planFiles.length, recordCount: 2,
      logicalHashSha256: 'c'.repeat(64), files: [],
    },
    files: planFiles,
  } as RestorePlan;
  return { files, plan };
}

function importer() {
  const createdNotes: string[] = [];
  const createdTodos: string[] = [];
  const service = {
    notes: { list: vi.fn(), get: vi.fn() },
    todos: { list: vi.fn() },
    backupImport: {
      noteExists: vi.fn(async (path: string) => createdNotes.includes(path)),
      todoExists: vi.fn(async (id: string) => createdTodos.includes(id)),
      createNote: vi.fn(async ({ path }: { path: string }) => { createdNotes.push(path); }),
      createTodo: vi.fn(async ({ id }: { id: string }) => { createdTodos.push(id); }),
      rollback: vi.fn(async ({ notePaths, todoIds }: { notePaths: readonly string[]; todoIds: readonly string[] }) => {
        notePaths.forEach((path) => createdNotes.splice(createdNotes.indexOf(path), 1));
        todoIds.forEach((id) => createdTodos.splice(createdTodos.indexOf(id), 1));
      }),
    },
  };
  const source = new LocalKnowledgeBackupSource(async () => service as never, { get: vi.fn() } as never, '0.1.0');
  return { source, service, createdNotes, createdTodos };
}

describe('Backup A r6 restore import-as-copy source', () => {
  it('preflights the full snapshot, derives a deterministic namespace, remaps Todo links, applies, and exactly rolls back', async () => {
    const x = importer();
    const input = restoreFixture();
    const prepared = await x.source.prepareRestoreImport(input);

    expect(prepared.importNamespace).toBe(`backup-import-${SNAPSHOT}`);
    expect(prepared.notes).toHaveLength(1);
    expect(prepared.notes[0]).toMatchObject({
      path: `backup-import-${SNAPSHOT}/notes/${NOTE_ID}`,
      originalLogicalPath: NOTE_PATH,
      body: '# private local body',
    });
    expect(prepared.notes[0]!.tags).toEqual(expect.arrayContaining([
      `__backup_import__:backup-import-${SNAPSHOT}`,
      expect.stringMatching(/^__backup_original_path_b64__:/),
      expect.stringMatching(/^__backup_original_metadata_b64__:/),
    ]));
    expect(prepared.todos[0]!.id).toMatch(new RegExp(`^backup-import-${SNAPSHOT}-todo-[a-f0-9]{64}$`));
    expect(prepared.todos[0]!.note_links).toEqual([prepared.notes[0]!.path]);

    await x.source.applyRestoreImport!(prepared);
    expect(x.createdNotes).toEqual([prepared.notes[0]!.path]);
    expect(x.createdTodos).toEqual([prepared.todos[0]!.id]);
    await x.source.rollbackRestoreImport!({
      schemaVersion: 1, operationId: '22222222-2222-4222-8222-222222222222',
      snapshotId: SNAPSHOT, previewDigest: PREVIEW_DIGEST, generation: 3,
      importNamespace: prepared.importNamespace, notePaths: prepared.notes.map((note) => note.path),
      todoIds: prepared.todos.map((todo) => todo.id), state: 'rollback-pending',
      createdAtMs: 1, updatedAtMs: 2, attempts: 1,
    });
    expect(x.createdNotes).toEqual([]);
    expect(x.createdTodos).toEqual([]);
  });

  it('preserves exact numeric reminder_fired literals 0 and 1', async () => {
    const x = importer();
    const zero = await x.source.prepareRestoreImport(restoreFixture(undefined, 0));
    const one = await x.source.prepareRestoreImport(restoreFixture(undefined, 1));

    expect(zero.todos[0]!.reminder_fired).toBe(0);
    expect(one.todos[0]!.reminder_fired).toBe(1);
  });

  it('rejects an invalid reminder_fired value through the restore conflict path', async () => {
    const x = importer();

    await expect(x.source.prepareRestoreImport(restoreFixture(undefined, 2)))
      .rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(x.service.backupImport.createNote).not.toHaveBeenCalled();
    expect(x.service.backupImport.createTodo).not.toHaveBeenCalled();
  });

  it.each([
    ['partial note scope', ['note-markdown']],
    ['preferences', ['note-markdown', 'note-metadata', 'preferences']],
    ['knowledge graph', ['note-markdown', 'note-metadata', 'kg-nodes']],
  ])('rejects %s before any mutation', async (_label, scopes) => {
    const x = importer();
    await expect(x.source.prepareRestoreImport(restoreFixture(scopes as BackupScope[])))
      .rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(x.service.backupImport.createNote).not.toHaveBeenCalled();
    expect(x.service.backupImport.createTodo).not.toHaveBeenCalled();
  });

  it('rejects malformed exact-schema metadata and unknown fields before mutation', async () => {
    const x = importer();
    const input = restoreFixture();
    input.files.set('notes/metadata.json', encoder.encode(JSON.stringify([{ unknown: true }])));
    await expect(x.source.prepareRestoreImport(input)).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(x.service.backupImport.createNote).not.toHaveBeenCalled();
  });
});

describe('Backup A r6 fresh approval binding', () => {
  it('binds generation and preview digest into the command and rejects replayed command IDs', async () => {
    let now = 100;
    const prompts: BackupApprovalPrompt[] = [];
    const gate = new BackupApprovalGate({ request: async (prompt) => {
      prompts.push(prompt);
      return { commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: now };
    } }, () => now, () => '33333333-3333-4333-8333-333333333333');
    const intent = {
      action: 'restore-apply' as const, scopes: ['note-markdown', 'note-metadata'] as const,
      objectId: SNAPSHOT, bytes: 42, sha256: 'd'.repeat(64), generation: 4,
      previewDigest: PREVIEW_DIGEST, destructiveWarning: null,
    };
    const controller = new AbortController();
    await expect(gate.approve(intent, controller.signal)).resolves.toMatchObject({ generation: 4, previewDigest: PREVIEW_DIGEST });
    await expect(gate.approve({ ...intent, generation: 5 }, controller.signal)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(prompts[0]!.commandDigest).not.toBe(prompts[1]!.commandDigest);

    const expiring = new BackupApprovalGate({ request: async (prompt) => {
      now = prompt.deadlineMs;
      return { commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'approve', decidedAtMs: now };
    } }, () => now);
    await expect(expiring.approve(intent, controller.signal)).rejects.toMatchObject({ code: 'CONSENT_EXPIRED' });
  });
});

const TARGET = {
  region: 'ap-shanghai', bucket: 'copilot-123456',
  ownerHash: 'f'.repeat(64), targetHash: 'e'.repeat(64),
};

class ManagerCredentials implements BackupCredentialStore {
  readonly keys = new Map<string, Uint8Array>();
  async putDataKey(id: string, key: Uint8Array) { this.keys.set(id, new Uint8Array(key)); }
  async getDataKey(id: string) { return this.keys.get(id) ?? null; }
  async deleteDataKey(id: string) { this.keys.delete(id); }
}

class ManagerPresign implements BackupPresignClient {
  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    return {
      method: metadata.method,
      key: metadata.key,
      url: `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com/${metadata.key}?test-only=1`,
      contentType: metadata.contentType,
      expiresAtMs: 1_725_000_120_000,
      ...(metadata.method === 'PUT' ? {
        ciphertextBytes: metadata.ciphertextBytes,
        ciphertextSha256: metadata.ciphertextSha256,
      } : {}),
    };
  }
}

class ManagerDirect implements DirectCiphertextAdapter {
  object: Uint8Array | null = null;
  readonly calls: string[] = [];
  async put(_grant: PresignGrant, bytes: Uint8Array) {
    this.calls.push('PUT'); this.object = new Uint8Array(bytes);
    return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async get() {
    this.calls.push('GET');
    if (!this.object) throw new Error('missing test ciphertext');
    return new Uint8Array(this.object);
  }
  async head() {
    this.calls.push('HEAD');
    return this.object
      ? { exists: true, bytes: this.object.byteLength, sha256: createHash('sha256').update(this.object).digest('hex') }
      : { exists: false };
  }
  async delete() { this.calls.push('DELETE'); this.object = null; }
}

class ManagerRepository extends InMemoryBackupRepository {
  readonly transactionEvents: string[] = [];
  override async putRestoreImportIntent(value: BackupRestoreImportIntent) {
    this.transactionEvents.push(`intent:${value.state}`);
    return super.putRestoreImportIntent(value);
  }
  override async removeRestoreImportIntent(operationId: string) {
    this.transactionEvents.push('intent:durable-clear');
    return super.removeRestoreImportIntent(operationId);
  }
}

function managerConsentStore(): BackupConsentStore & { receipt: BackupConsentReceipt | null; generation: number } {
  const store = {
    receipt: null as BackupConsentReceipt | null,
    generation: 0,
    getReceipt: () => store.receipt,
    setReceipt: (value: BackupConsentReceipt) => { store.receipt = structuredClone(value); },
    clearReceipt: () => { store.receipt = null; },
    getGeneration: () => store.generation,
    setGeneration: (value: number) => { store.generation = value; },
  };
  return store;
}

function managerSource(repository: ManagerRepository) {
  const imported = { notes: new Set<string>(), todos: new Set<string>() };
  const controls = { failAfterNote: false };
  const preparedFor = (snapshotId: string): BackupPreparedRestoreImport => ({
    importNamespace: `backup-import-${snapshotId}`,
    notes: [{
      path: `backup-import-${snapshotId}/notes/${'1'.repeat(64)}`,
      originalLogicalPath: 'work/original.md', title: 'Imported', body: '# private',
      type: 'note', status: 'active', tags: [`__backup_import__:backup-import-${snapshotId}`],
      related: [], confidence: null, agent: null,
    }],
    todos: [{
      id: `backup-import-${snapshotId}-todo-${'2'.repeat(64)}`,
      title: 'Imported Todo', body: '', due_at_ms: null, remind_at_ms: null,
      status: 'pending', priority: 'normal',
      note_links: [`backup-import-${snapshotId}/notes/${'1'.repeat(64)}`],
      reminder_fired: 0, created_at: 1, updated_at: 2,
    }],
    conflicts: [],
  });
  const source: BackupIntegrationSource = {
    estimate: async () => ({ estimatedEncryptedBytes: 4096, counts: { notes: 1, todos: 1 } }),
    gather: async (scopes) => ({
      appVersion: '0.1.0', logicalSchemaVersion: 'phase1-v1', selectedScopes: [...scopes],
      sourceRevisions: { notes: '1', todos: '1' },
      files: [
        { logicalPath: 'notes/one.md', scope: 'note-markdown', data: encoder.encode('# private') },
        { logicalPath: 'notes/metadata.json', scope: 'note-metadata', data: encoder.encode('[]') },
        { logicalPath: 'todos/items.json', scope: 'todos', data: encoder.encode('[]') },
      ],
    }),
    prepareRestoreImport: async ({ plan }) => preparedFor(plan.snapshotId),
    applyRestoreImport: async (prepared) => {
      const durable = await repository.listRestoreImportIntents();
      if (durable.length !== 1 || durable[0]!.state !== 'applying') throw new Error('first write preceded durable intent');
      repository.transactionEvents.push('write:note');
      imported.notes.add(prepared.notes[0]!.path);
      if (controls.failAfterNote) throw new Error('injected partial apply');
      repository.transactionEvents.push('write:todo');
      imported.todos.add(prepared.todos[0]!.id);
    },
    rollbackRestoreImport: async (restoreIntent) => {
      repository.transactionEvents.push('rollback:owned-namespace');
      restoreIntent.notePaths.forEach((path) => imported.notes.delete(path));
      restoreIntent.todoIds.forEach((id) => imported.todos.delete(id));
    },
  };
  return { source, imported, controls, preparedFor };
}

function managerFixture(shared?: {
  repository: ManagerRepository;
  sourceState: ReturnType<typeof managerSource>;
  settings: { enabled: boolean; get(): boolean; set(value: boolean): void };
  consent: ReturnType<typeof managerConsentStore>;
  credentials: ManagerCredentials;
  direct: ManagerDirect;
}) {
  const repository = shared?.repository ?? new ManagerRepository();
  const sourceState = shared?.sourceState ?? managerSource(repository);
  const settings = shared?.settings ?? { enabled: false, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } };
  const consent = shared?.consent ?? managerConsentStore();
  const credentials = shared?.credentials ?? new ManagerCredentials();
  const direct = shared?.direct ?? new ManagerDirect();
  const clock = { now: 1_725_000_000_000 };
  const approvalControl = { mode: 'approve' as 'approve' | 'expire' | 'replay', replayCommandId: '' };
  const prompts: BackupApprovalPrompt[] = [];
  const manager = new BackupIntegrationManager({
    settings,
    consentStore: consent,
    approval: { request: async (prompt) => {
      prompts.push(prompt);
      if (approvalControl.mode === 'expire') clock.now = prompt.deadlineMs;
      return {
        commandId: approvalControl.mode === 'replay' ? approvalControl.replayCommandId : prompt.commandId,
        commandDigest: prompt.commandDigest,
        deadlineMs: prompt.deadlineMs,
        decision: 'approve' as const,
        decidedAtMs: clock.now,
      };
    } },
    source: sourceState.source,
    repository,
    credentialStore: credentials,
    presignClient: new ManagerPresign(),
    directAdapter: direct,
    target: TARGET,
    now: () => clock.now,
  });
  return { manager, repository, sourceState, settings, consent, credentials, direct, prompts, approvalControl, clock };
}

async function enableManager(x: ReturnType<typeof managerFixture>) {
  const draft = await x.manager.prepareEnable(['note-markdown', 'note-metadata', 'todos']);
  await x.manager.enable({
    ...draft,
    retentionDeleteAcknowledged: true,
    keyLossAcknowledged: true,
    cloudCannotDecryptAcknowledged: true,
    firstUploadAcknowledged: true,
  });
  return draft;
}

async function uploadedPreview(x: ReturnType<typeof managerFixture>) {
  const draft = await enableManager(x);
  const created = await x.manager.create({ selectedScopes: [...draft.selectedScopes] });
  await x.manager.upload({ snapshotId: created.snapshotId });
  const preview = await x.manager.restorePreview({ snapshotId: created.snapshotId });
  return { created, preview };
}

describe('BackupIntegrationManager r6 restoreApply transaction', () => {
  it('uses a fresh bound approval and re-download, persists intent before first write, durably clears, and returns audit result', async () => {
    const x = managerFixture();
    const { created, preview } = await uploadedPreview(x);
    const getCallsBefore = x.direct.calls.filter((call) => call === 'GET').length;
    const result = await x.manager.restoreApply({
      snapshotId: created.snapshotId,
      selectedScopes: [...preview.selectedScopes],
      previewDigest: preview.previewDigest,
      generation: preview.generation,
    });

    expect(x.direct.calls.filter((call) => call === 'GET')).toHaveLength(getCallsBefore + 1);
    const previewPrompt = x.prompts.find((prompt) => prompt.action === 'restore-preview')!;
    const applyPrompt = x.prompts.find((prompt) => prompt.action === 'restore-apply')!;
    expect(applyPrompt.commandId).not.toBe(previewPrompt.commandId);
    expect(applyPrompt).toMatchObject({
      objectId: created.snapshotId,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      generation: preview.generation,
      previewDigest: preview.previewDigest,
      scopes: preview.selectedScopes,
    });
    expect(x.repository.transactionEvents).toEqual(expect.arrayContaining([
      'intent:prepared', 'intent:applying', 'write:note', 'write:todo', 'intent:durable-clear',
    ]));
    expect(x.repository.transactionEvents.indexOf('intent:applying'))
      .toBeLessThan(x.repository.transactionEvents.indexOf('write:note'));
    expect(x.repository.transactionEvents.indexOf('intent:durable-clear'))
      .toBeGreaterThan(x.repository.transactionEvents.indexOf('write:todo'));
    await expect(x.repository.listRestoreImportIntents()).resolves.toEqual([]);
    expect(result).toMatchObject({
      snapshotId: created.snapshotId, previewDigest: preview.previewDigest,
      importedNotes: 1, importedTodos: 1, conflictCount: 0,
      rollbackStatus: 'not-required', replaceCurrentAvailable: false,
    });
  });

  it('rebinds digest and exact scopes on a new download before any local write', async () => {
    const digest = managerFixture();
    const first = await uploadedPreview(digest);
    await expect(digest.manager.restoreApply({
      snapshotId: first.created.snapshotId,
      selectedScopes: [...first.preview.selectedScopes],
      previewDigest: '9'.repeat(64),
      generation: first.preview.generation,
    })).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(digest.repository.transactionEvents).not.toContain('write:note');

    const scope = managerFixture();
    const second = await uploadedPreview(scope);
    await expect(scope.manager.restoreApply({
      snapshotId: second.created.snapshotId,
      selectedScopes: ['note-markdown', 'note-metadata'],
      previewDigest: second.preview.previewDigest,
      generation: second.preview.generation,
    })).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(scope.repository.transactionEvents).not.toContain('write:note');
  });

  it('rolls back an injected partial apply and durably clears the intent', async () => {
    const x = managerFixture();
    const { created, preview } = await uploadedPreview(x);
    x.sourceState.controls.failAfterNote = true;
    await expect(x.manager.restoreApply({
      snapshotId: created.snapshotId,
      selectedScopes: [...preview.selectedScopes],
      previewDigest: preview.previewDigest,
      generation: preview.generation,
    })).rejects.toThrow('injected partial apply');
    expect(x.sourceState.imported.notes.size).toBe(0);
    expect(x.sourceState.imported.todos.size).toBe(0);
    expect(x.repository.transactionEvents).toEqual(expect.arrayContaining([
      'intent:rollback-pending', 'rollback:owned-namespace', 'intent:durable-clear',
    ]));
    await expect(x.repository.listRestoreImportIntents()).resolves.toEqual([]);
  });

  it('recovers a configured restart intent, revokes consent, and stays OFF', async () => {
    const x = managerFixture();
    await enableManager(x);
    const seeded = x.sourceState.preparedFor(SNAPSHOT);
    seeded.notes.forEach((note) => x.sourceState.imported.notes.add(note.path));
    seeded.todos.forEach((entry) => x.sourceState.imported.todos.add(entry.id));
    await x.repository.putRestoreImportIntent({
      schemaVersion: 1, operationId: '44444444-4444-4444-8444-444444444444',
      snapshotId: SNAPSHOT, previewDigest: PREVIEW_DIGEST, generation: x.consent.generation,
      importNamespace: seeded.importNamespace, notePaths: seeded.notes.map((note) => note.path),
      todoIds: seeded.todos.map((entry) => entry.id), state: 'applying',
      createdAtMs: x.clock.now, updatedAtMs: x.clock.now, attempts: 0,
    });
    const restarted = managerFixture(x);
    await expect(restarted.manager.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(restarted.settings.enabled).toBe(false);
    expect(restarted.consent.receipt).toBeNull();
    expect(restarted.sourceState.imported.notes.size).toBe(0);
    expect(restarted.sourceState.imported.todos.size).toBe(0);
    await expect(restarted.repository.listRestoreImportIntents()).resolves.toEqual([]);
  });

  it.each(['generation', 'replay', 'expiry'] as const)('rejects stale %s authorization without local mutation', async (kind) => {
    const x = managerFixture();
    const { created, preview } = await uploadedPreview(x);
    const promptCount = x.prompts.length;
    if (kind === 'replay') {
      x.approvalControl.mode = 'replay';
      x.approvalControl.replayCommandId = x.prompts[0]!.commandId;
    } else if (kind === 'expiry') {
      x.approvalControl.mode = 'expire';
    }
    const request = {
      snapshotId: created.snapshotId,
      selectedScopes: [...preview.selectedScopes],
      previewDigest: preview.previewDigest,
      generation: kind === 'generation' ? preview.generation + 1 : preview.generation,
    };
    await expect(x.manager.restoreApply(request)).rejects.toMatchObject({
      code: kind === 'expiry' ? 'CONSENT_EXPIRED' : kind === 'generation' ? 'RESTORE_APPROVAL_REQUIRED' : 'CONSENT_REQUIRED',
    });
    if (kind === 'generation') expect(x.prompts).toHaveLength(promptCount);
    expect(x.repository.transactionEvents).not.toContain('write:note');
    await expect(x.repository.listRestoreImportIntents()).resolves.toEqual([]);
  });
});
