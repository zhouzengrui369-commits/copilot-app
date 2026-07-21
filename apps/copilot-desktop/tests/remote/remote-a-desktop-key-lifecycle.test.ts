import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeRemoteCredentialVault,
  remoteCredentialAccount,
  type RemoteNativeKeyringEntryFactory,
} from '../../src/main/remote/native-credential-store';
import { REMOTE_KEYRING_SERVICE } from '../../src/main/remote/pairing';

const PAIRING_ID = '11111111-1111-4111-8111-111111111111';
const KEY_EPOCH = 1;

function fakeFactory(values = new Map<string, Uint8Array>()) {
  const calls: Array<[string, string, string]> = [];
  const factory: RemoteNativeKeyringEntryFactory = (service, account) => ({
    async setSecret(secret) { calls.push([service, account, 'set']); values.set(account, new Uint8Array(secret)); },
    async getSecret() { calls.push([service, account, 'get']); return values.has(account) ? new Uint8Array(values.get(account)!) : null; },
    async deleteCredential() { calls.push([service, account, 'delete']); return values.delete(account); },
  });
  return { values, calls, factory };
}

describe('Remote native keyring purpose lifecycle', () => {
  it('uses a fixed service and purpose-separated accounts hashed by pairing id', async () => {
    const fake = fakeFactory();
    const vault = new NativeRemoteCredentialVault(fake.factory, 'darwin');
    for (const purpose of ['relay-token', 'identity-ed25519-pkcs8', 'identity-x25519-pkcs8'] as const) {
      await vault.put(PAIRING_ID, KEY_EPOCH, purpose, new Uint8Array(48).fill(purpose.length));
      await expect(vault.get(PAIRING_ID, KEY_EPOCH, purpose)).resolves.toEqual(new Uint8Array(48).fill(purpose.length));
      const expected = `remote.${purpose}.${createHash('sha256').update(`${PAIRING_ID}:${KEY_EPOCH}`).digest('hex')}`;
      expect(remoteCredentialAccount(PAIRING_ID, KEY_EPOCH, purpose)).toBe(expected);
      expect(expected).not.toContain(PAIRING_ID);
    }
    expect(fake.calls.every(([service]) => service === REMOTE_KEYRING_SERVICE)).toBe(true);
  });

  it('treats only null as missing and fails closed on rejected/ambiguous reads, duplicates and unsupported platforms', async () => {
    expect(() => new NativeRemoteCredentialVault(fakeFactory().factory, 'linux')).toThrowError();
    const ambiguous = new NativeRemoteCredentialVault(() => ({
      setSecret: vi.fn(),
      getSecret: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockResolvedValue(false),
    }) as never, 'win32');
    await expect(ambiguous.get(PAIRING_ID, KEY_EPOCH, 'relay-token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    const fake = fakeFactory();
    const vault = new NativeRemoteCredentialVault(fake.factory, 'win32');
    await vault.put(PAIRING_ID, KEY_EPOCH, 'relay-token', new Uint8Array(48).fill(1));
    await expect(vault.put(PAIRING_ID, KEY_EPOCH, 'relay-token', new Uint8Array(48).fill(2))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('attempts deletion of all three purposes and surfaces partial native failure', async () => {
    const deletes: string[] = [];
    const vault = new NativeRemoteCredentialVault((_service, account) => ({
      setSecret: vi.fn(),
      getSecret: vi.fn().mockResolvedValue(null),
      async deleteCredential() {
        deletes.push(account);
        if (account.includes('identity-ed25519')) throw new Error('locked');
        return true;
      },
    }), 'darwin');
    await expect(vault.deleteSet(PAIRING_ID, KEY_EPOCH)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(deletes).toHaveLength(3);
  });

  it('treats delete false as an unconfirmed deletion even when readback is missing', async () => {
    const vault = new NativeRemoteCredentialVault(() => ({
      setSecret: vi.fn(),
      getSecret: vi.fn().mockResolvedValue(null),
      deleteCredential: vi.fn().mockResolvedValue(false),
    }), 'win32');
    await expect(vault.deleteSet(PAIRING_ID, KEY_EPOCH)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
