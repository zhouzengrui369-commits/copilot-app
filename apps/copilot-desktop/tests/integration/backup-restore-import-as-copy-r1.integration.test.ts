import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KbClient, MdFileStore, SqliteStore } from '@copilot/kb';

import { FileBackupRepository } from '../../src/main/backup-integration/repository.js';
import type { BackupRestoreImportIntent } from '../../src/main/backup-integration/manager.js';
import { createProductionBackupRuntime } from '../../src/main/backup-integration/production-runtime.js';
import { LocalKnowledgeService, type LocalKnowledgeServiceOptions } from '../../src/main/local-knowledge-service.js';
import type { CopilotSettings, SettingsStorage } from '../../src/main/settings-store.js';

const SNAPSHOT = '11111111-1111-4111-8111-111111111111';
const NAMESPACE = `backup-import-${SNAPSHOT}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function intent(): BackupRestoreImportIntent {
  return {
    schemaVersion: 1,
    operationId: '22222222-2222-4222-8222-222222222222',
    snapshotId: SNAPSHOT,
    previewDigest: 'a'.repeat(64),
    generation: 9,
    importNamespace: NAMESPACE,
    notePaths: [`${NAMESPACE}/notes/${'b'.repeat(64)}`],
    todoIds: [`${NAMESPACE}-todo-${'c'.repeat(64)}`],
    state: 'applying',
    createdAtMs: 100,
    updatedAtMs: 101,
    attempts: 0,
  };
}

describe('backup restore import-as-copy durable restart boundary', () => {
  it('publishes only a 0600 redacted rollback intent and reloads it through a fresh repository instance', async () => {
    const root = await tempRoot('copilot-restore-import-');
    const first = new FileBackupRepository(root);
    await first.putRestoreImportIntent(intent());

    const intentFile = path.join(root, 'backup-a', 'snapshots', 'restore-import-intents.json');
    expect((await stat(intentFile)).mode & 0o077).toBe(0);
    const persisted = await readFile(intentFile, 'utf8');
    expect(persisted).toContain(NAMESPACE);
    expect(persisted).not.toMatch(/private local body|originalLogicalPath|markdown|plaintext|ciphertext|secret|token|url/i);

    const restarted = new FileBackupRepository(root);
    await expect(restarted.listRestoreImportIntents()).resolves.toEqual([intent()]);
    await restarted.removeRestoreImportIntent(intent().operationId);
    await expect(new FileBackupRepository(root).listRestoreImportIntents()).resolves.toEqual([]);
  });

  it('rejects rollback ownership paths outside the deterministic snapshot namespace', async () => {
    const root = await tempRoot('copilot-restore-import-invalid-');
    const repository = new FileBackupRepository(root);
    await expect(repository.putRestoreImportIntent({
      ...intent(),
      notePaths: ['work/current-user-note'],
    })).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
    await expect(repository.listRestoreImportIntents()).resolves.toEqual([]);
  });

  it.each(['temporary-opened', 'temporary-synced', 'renamed', 'directory-synced'] as const)(
    'fails closed at restore-intent publish durability boundary %s',
    async (boundary) => {
      const root = await tempRoot(`copilot-restore-publish-${boundary}-`);
      const repository = new FileBackupRepository(root, (operation, current) => {
        if (operation === 'publish' && current === boundary) throw new Error('injected durability fault');
      });
      await expect(repository.putRestoreImportIntent(intent())).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
      const durable = await new FileBackupRepository(root).listRestoreImportIntents();
      expect(durable).toEqual(
        boundary === 'renamed' || boundary === 'directory-synced' ? [intent()] : [],
      );
    },
  );

  it.each(['temporary-opened', 'temporary-synced', 'renamed', 'directory-synced'] as const)(
    'fails closed at restore-intent clear durability boundary %s',
    async (boundary) => {
      const root = await tempRoot(`copilot-restore-clear-${boundary}-`);
      await new FileBackupRepository(root).putRestoreImportIntent(intent());
      const repository = new FileBackupRepository(root, (operation, current) => {
        if (operation === 'clear' && current === boundary) throw new Error('injected durability fault');
      });
      await expect(repository.removeRestoreImportIntent(intent().operationId))
        .rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
      const durable = await new FileBackupRepository(root).listRestoreImportIntents();
      expect(durable).toEqual(
        boundary === 'renamed' || boundary === 'directory-synced' ? [] : [intent()],
      );
    },
  );
});

function productionService(root: string) {
  const kb = new KbClient({
    sqlite: new SqliteStore({ dbPath: path.join(root, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(root, 'notes') }),
  });
  const service = new LocalKnowledgeService({
    kb,
    kg: { getSubgraph: vi.fn(), reindexNote: vi.fn(), removeNote: vi.fn() },
    rag: { indexNote: vi.fn(), deleteNote: vi.fn(), ask: vi.fn() },
    settings: { get: () => false },
  } as unknown as LocalKnowledgeServiceOptions);
  return { kb, service };
}

function todo(id: string) {
  return {
    id, title: 'Imported Todo', body: 'local', due_at_ms: null, remind_at_ms: null,
    status: 'pending' as const, priority: 'normal' as const, note_links: [],
    reminder_fired: 0 as const, created_at: 10, updated_at: 11,
  };
}

describe('production local service restore ownership', () => {
  it('marks imported Todo storage exactly and deletes it only when the marker matches', async () => {
    const root = await tempRoot('copilot-restore-todo-owned-');
    const { kb, service } = productionService(root);
    const id = `${NAMESPACE}-todo-${'d'.repeat(64)}`;
    await service.backupImport.createTodo(todo(id), NAMESPACE);
    expect(kb.readNote(`system/todos/${id}`)?.note.tags).toEqual([
      '__copilot_todo__', `__backup_import__:${NAMESPACE}`,
    ]);
    await service.backupImport.rollback({ importNamespace: NAMESPACE, notePaths: [], todoIds: [id] });
    expect(kb.readNote(`system/todos/${id}`)).toBeNull();
    kb.close();
  });

  it('preserves a foreign Todo introduced after preflight and quarantines a stale intent marker mismatch', async () => {
    const root = await tempRoot('copilot-restore-todo-foreign-');
    const { kb, service } = productionService(root);
    const id = `${NAMESPACE}-todo-${'e'.repeat(64)}`;
    await expect(service.backupImport.todoExists(id)).resolves.toBe(false);
    kb.createNote({
      path: `system/todos/${id}`, title: 'Foreign Todo', type: 'todo', status: 'active',
      tags: ['__copilot_todo__'], related: [], body: JSON.stringify({ schema: 1, ...todo(id) }),
    });
    await expect(service.backupImport.createTodo(todo(id), NAMESPACE))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.backupImport.rollback({ importNamespace: NAMESPACE, notePaths: [], todoIds: [id] }))
      .rejects.toMatchObject({ code: 'INTERNAL' });
    expect(kb.readNote(`system/todos/${id}`)?.note.title).toBe('Foreign Todo');
    kb.close();
  });
});

function settingsFixture(): SettingsStorage {
  const value = {
    cloudBackupEnabled: true,
    backupConsentReceipt: { generation: 9 },
    backupConsentGeneration: 9,
    backupRecoveryMarker: null,
    theme: 'auto', windowBounds: { width: 1280, height: 800 }, shortcuts: [],
    modelApi: { provider: 'minimax', baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3', apiKey: '' },
    schemaVersion: 2,
  } as unknown as CopilotSettings;
  return {
    get: (key) => structuredClone(value[key]),
    set: (key, next) => { value[key] = structuredClone(next) as never; },
    getAll: () => structuredClone(value),
    setAll: (next) => { Object.assign(value, structuredClone(next)); },
    reset: vi.fn(),
  };
}

describe('unconfigured production recovery consent parity', () => {
  it('recovers while config is missing and remains OFF after production config returns', async () => {
    const root = await tempRoot('copilot-restore-unconfigured-');
    const repository = new FileBackupRepository(root);
    await repository.putRestoreImportIntent(intent());
    const settings = settingsFixture();
    const rollback = vi.fn(async () => undefined);
    const getService = async () => ({ backupImport: { rollback } }) as never;
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    } as never;
    const approval = { request: vi.fn() } as never;

    const missing = createProductionBackupRuntime({
      userDataPath: root, settings, getService, safeStorage, env: {}, appVersion: '0.1.0', approval,
    });
    await expect(missing.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(rollback).toHaveBeenCalledOnce();
    expect(settings.get('cloudBackupEnabled')).toBe(false);
    expect(settings.get('backupConsentGeneration')).toBe(10);
    expect(settings.get('backupConsentReceipt')).toBeNull();

    const restored = createProductionBackupRuntime({
      userDataPath: root,
      settings,
      getService,
      safeStorage,
      appVersion: '0.1.0',
      approval,
      env: {
        COPILOT_BACKUP_ENDPOINT: 'https://backup.example.test/v1/backup/presign',
        COPILOT_BACKUP_TOKEN: 'test-token',
        COPILOT_BACKUP_COS_REGION: 'ap-shanghai',
        COPILOT_BACKUP_COS_BUCKET: 'copilot-123456',
        COPILOT_BACKUP_OWNER_HASH: 'a'.repeat(64),
        COPILOT_BACKUP_TARGET_HASH: 'b'.repeat(64),
      },
    });
    await expect(restored.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(settings.get('backupConsentGeneration')).toBe(10);
  });

  it('retries a torn consent-clear boundary without rollback or a second generation increment', async () => {
    const root = await tempRoot('copilot-restore-unconfigured-retry-');
    const repository = new FileBackupRepository(root);
    await repository.putRestoreImportIntent(intent());
    const settings = settingsFixture();
    const persist = settings.set.bind(settings);
    let failReceiptClear = true;
    settings.set = ((key, value) => {
      if (key === 'backupConsentReceipt' && value === null && failReceiptClear) {
        failReceiptClear = false;
        throw new Error('injected settings persistence fault');
      }
      persist(key, value);
    }) as SettingsStorage['set'];
    const rollback = vi.fn(async () => undefined);
    const runtime = createProductionBackupRuntime({
      userDataPath: root,
      settings,
      getService: async () => ({ backupImport: { rollback } }) as never,
      safeStorage: {} as never,
      env: {},
      appVersion: '0.1.0',
      approval: { request: vi.fn() } as never,
    });

    await expect(runtime.getState()).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
    expect(rollback).not.toHaveBeenCalled();
    expect(settings.get('cloudBackupEnabled')).toBe(false);
    expect(settings.get('backupConsentGeneration')).toBe(10);
    await expect(repository.listRestoreImportIntents()).resolves.toEqual([intent()]);

    await expect(runtime.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(rollback).toHaveBeenCalledOnce();
    expect(settings.get('backupConsentGeneration')).toBe(10);
    expect(settings.get('backupConsentReceipt')).toBeNull();
  });
});
