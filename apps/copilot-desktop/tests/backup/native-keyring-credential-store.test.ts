import { createHash } from 'node:crypto';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  BACKUP_KEYRING_SERVICE,
  MigratingBackupCredentialStore,
  NativeKeyringCredentialStore,
  backupKeyringAccount,
  selectProductionBackupCredentialStore,
  type NativeKeyringEntryFactory,
} from '../../src/main/backup-integration/native-keyring-credential-store.js';
import { createProductionBackupRuntime } from '../../src/main/backup-integration/production-runtime.js';
import { SafeStorageBackupCredentialStore } from '../../src/main/backup-integration/safe-storage-credential-store.js';

const KEY_ID = '11111111-1111-4111-8111-111111111111';

function fakeFactory(values = new Map<string, Uint8Array>()) {
  const calls: Array<{ service: string; account: string; operation: string }> = [];
  const factory: NativeKeyringEntryFactory = (service, account) => ({
    async setSecret(secret) {
      calls.push({ service, account, operation: 'set' });
      values.set(account, new Uint8Array(secret));
    },
    async getSecret() {
      calls.push({ service, account, operation: 'get' });
      const value = values.get(account);
      return value ? new Uint8Array(value) : null;
    },
    async deleteCredential() {
      calls.push({ service, account, operation: 'delete' });
      return values.delete(account);
    },
  });
  return { factory, values, calls };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
    decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
  };
}

describe('native Backup CredentialStore spike', () => {
  it('uses a fixed service and a hashed account, verifies write, reads and deletes with fake native entries', async () => {
    const fake = fakeFactory();
    const store = new NativeKeyringCredentialStore(fake.factory, 'darwin');
    const key = new Uint8Array(32).fill(7);

    await store.putDataKey(KEY_ID, key);
    await expect(store.getDataKey(KEY_ID)).resolves.toEqual(key);
    await store.deleteDataKey(KEY_ID);
    await expect(store.getDataKey(KEY_ID)).resolves.toBeNull();

    const expectedAccount = `backup.data-key.${createHash('sha256').update(KEY_ID).digest('hex')}`;
    expect(backupKeyringAccount(KEY_ID)).toBe(expectedAccount);
    expect(expectedAccount).not.toContain(KEY_ID);
    expect(fake.calls.every((call) => call.service === BACKUP_KEYRING_SERVICE)).toBe(true);
    expect(fake.calls.every((call) => call.account === expectedAccount)).toBe(true);
  });

  it('fails closed on unsupported platforms, invalid IDs, invalid key sizes and duplicate writes', async () => {
    const fake = fakeFactory();
    expect(() => new NativeKeyringCredentialStore(fake.factory, 'linux')).toThrowError();
    const store = new NativeKeyringCredentialStore(fake.factory, 'win32');
    await expect(store.putDataKey('unsafe', new Uint8Array(32))).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    await expect(store.putDataKey(KEY_ID, new Uint8Array(31))).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    await store.putDataKey(KEY_ID, new Uint8Array(32).fill(1));
    await expect(store.putDataKey(KEY_ID, new Uint8Array(32).fill(2))).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  });

  it('treats only null as missing and never creates or migrates after a native read exception', async () => {
    const setSecret = vi.fn();
    const undefinedStore = new NativeKeyringCredentialStore(() => ({
      setSecret,
      getSecret: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockResolvedValue(false),
    }) as never, 'darwin');
    await expect(undefinedStore.getDataKey(KEY_ID)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    await expect(undefinedStore.putDataKey(KEY_ID, new Uint8Array(32))).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    expect(setSecret).not.toHaveBeenCalled();

    const nativeFailure = {
      getDataKey: vi.fn().mockRejectedValue(new Error('keychain locked')),
      putDataKey: vi.fn(),
      deleteDataKey: vi.fn(),
    };
    const legacy = {
      hasDataKeyFile: vi.fn(),
      getDataKey: vi.fn(),
      putDataKey: vi.fn(),
      deleteDataKey: vi.fn(),
    };
    const migrating = new MigratingBackupCredentialStore(nativeFailure, legacy);
    await expect(migrating.getDataKey(KEY_ID)).rejects.toThrow('keychain locked');
    expect(legacy.hasDataKeyFile).not.toHaveBeenCalled();
    expect(legacy.getDataKey).not.toHaveBeenCalled();
    expect(nativeFailure.putDataKey).not.toHaveBeenCalled();
  });

  it('migrates a legacy safeStorage blob only after native write/readback and then deletes the blob', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-keyring-migration-'));
    const legacy = new SafeStorageBackupCredentialStore(root, fakeSafeStorage());
    const key = new Uint8Array(32).fill(9);
    await legacy.putDataKey(KEY_ID, key);
    const legacyFile = path.join(root, 'backup-a', 'credentials', `${KEY_ID}.blob`);
    await expect(stat(legacyFile)).resolves.toBeDefined();

    const fake = fakeFactory();
    const native = new NativeKeyringCredentialStore(fake.factory, 'darwin');
    const migrating = new MigratingBackupCredentialStore(native, legacy);
    await expect(migrating.getDataKey(KEY_ID)).resolves.toEqual(key);
    await expect(stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(native.getDataKey(KEY_ID)).resolves.toEqual(key);
  });

  it('retains the legacy blob when native migration cannot be verified', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-keyring-failure-'));
    const legacy = new SafeStorageBackupCredentialStore(root, fakeSafeStorage());
    const key = new Uint8Array(32).fill(5);
    await legacy.putDataKey(KEY_ID, key);
    const failing = {
      putDataKey: vi.fn().mockRejectedValue(new Error('native unavailable')),
      getDataKey: vi.fn().mockResolvedValue(null),
      deleteDataKey: vi.fn(),
    };
    const migrating = new MigratingBackupCredentialStore(failing, legacy);
    await expect(migrating.getDataKey(KEY_ID)).rejects.toThrow('native unavailable');
    await expect(legacy.getDataKey(KEY_ID)).resolves.toEqual(key);
  });

  it('selects native labels only after an injected native backend loads and otherwise fails closed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-keyring-selector-'));
    const fake = fakeFactory();
    const mac = selectProductionBackupCredentialStore({
      userDataPath: root,
      safeStorage: fakeSafeStorage(),
      platform: 'darwin',
      entryFactory: fake.factory,
    });
    expect(mac.platformProtection).toBe('macOS Keychain (native; legacy safeStorage migration only)');
    await expect(mac.store.getDataKey(KEY_ID)).resolves.toBeNull();
    expect(() => selectProductionBackupCredentialStore({
      userDataPath: root,
      safeStorage: fakeSafeStorage(),
      platform: 'linux',
      entryFactory: fake.factory,
    })).toThrowError();
  });

  it('does not claim a native credential backend while Backup is unconfigured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-keyring-unconfigured-'));
    const runtime = createProductionBackupRuntime({
      userDataPath: root,
      settings: {
        get: () => false,
        set: vi.fn(),
      } as never,
      getService: async () => {
        throw new Error('must not be called while unconfigured');
      },
      safeStorage: fakeSafeStorage() as never,
      env: {},
      appVersion: 'test',
      approval: { request: async () => { throw new Error('must not request approval while unconfigured'); } },
    });

    await expect(runtime.getState()).resolves.toMatchObject({
      configured: false,
      enabled: false,
      platformProtection: 'OS credential store not configured',
    });
  });
});
