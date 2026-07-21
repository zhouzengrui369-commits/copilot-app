import { describe, expect, it } from 'vitest';

import { managedCredentialService, readManagedCredentialNamespace } from '../src/main/managed-credential-namespace.js';
import { NativeKeyringCredentialStore } from '../src/main/backup-integration/native-keyring-credential-store.js';
import { NativeRemoteCredentialVault } from '../src/main/remote/native-credential-store.js';
import { REMOTE_CREDENTIAL_PURPOSES } from '../src/main/remote/pairing.js';

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const PAIRING_ID = '22222222-2222-4222-8222-222222222222';

function nativeEntries(keepAfterDelete = false) {
  const values = new Map<string, Uint8Array>();
  const services: string[] = [];
  return {
    values,
    services,
    factory: (service: string, account: string) => ({
      setSecret: async (secret: Uint8Array) => { services.push(service); values.set(`${service}:${account}`, Uint8Array.from(secret)); },
      getSecret: async () => values.get(`${service}:${account}`) ?? null,
      deleteCredential: async () => keepAfterDelete || values.delete(`${service}:${account}`),
    }),
  };
}

describe('managed native credential namespace r1', () => {
  it('keeps defaults unchanged and derives only bounded fixed-prefix services', () => {
    expect(managedCredentialService('backup')).toBe('ai.njx.copilot.v6.backup');
    expect(managedCredentialService('remote')).toBe('ai.njx.copilot.v6.remote');
    expect(managedCredentialService('backup', 'run-01')).toBe('ai.njx.copilot.v6.run-01.backup');
    expect(readManagedCredentialNamespace({ COPILOT_MANAGED_PROFILE_NAMESPACE: 'run-01' })).toBe('run-01');
    for (const invalid of ['', 'UPPER', ' space', 'a'.repeat(33), 'a.b', '../x']) {
      expect(() => managedCredentialService('backup', invalid)).toThrow();
    }
  });

  it('uses the dedicated Backup service and requires exact-account readback absence', async () => {
    const native = nativeEntries();
    const store = new NativeKeyringCredentialStore(native.factory, 'darwin', 'run-01');
    await store.putDataKey(KEY_ID, new Uint8Array(32).fill(1));
    expect(native.services).toEqual(['ai.njx.copilot.v6.run-01.backup']);
    await store.deleteDataKey(KEY_ID);
    await expect(store.getDataKey(KEY_ID)).resolves.toBeNull();

    const lingering = nativeEntries(true);
    const unsafe = new NativeKeyringCredentialStore(lingering.factory, 'darwin', 'run-02');
    await unsafe.putDataKey(KEY_ID, new Uint8Array(32).fill(2));
    await expect(unsafe.deleteDataKey(KEY_ID)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  });

  it('uses the dedicated Remote service and deletes/readbacks all three exact accounts', async () => {
    const native = nativeEntries();
    const vault = new NativeRemoteCredentialVault(native.factory, 'win32', 'run-01');
    for (const purpose of REMOTE_CREDENTIAL_PURPOSES) {
      await vault.put(PAIRING_ID, 1, purpose, new Uint8Array(32).fill(3));
    }
    expect(new Set(native.services)).toEqual(new Set(['ai.njx.copilot.v6.run-01.remote']));
    await vault.deleteSet(PAIRING_ID, 1);
    for (const purpose of REMOTE_CREDENTIAL_PURPOSES) {
      await expect(vault.get(PAIRING_ID, 1, purpose)).resolves.toBeNull();
    }
  });
});
