import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PairingManager,
  pairingResponseSignatureBytes,
  pairingTokenAadBytes,
  type PairingRequestV1,
  type PairingResponseV2,
  type RemoteCredentialPurpose,
  type RemoteCredentialVault,
  type RemotePairingRepository,
  type RemotePairingRepositoryState,
} from '../../src/main/remote/pairing';

const NOW = 1_700_000_000_000;
const TOKEN = Buffer.alloc(32, 0x5a).toString('base64url');

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const issuer = generateKeyPairSync('ed25519');
  const controllerEd = generateKeyPairSync('ed25519');
  const controllerX = generateKeyPairSync('x25519');
  let state: RemotePairingRepositoryState | null = null;
  const repository: RemotePairingRepository = {
    get: () => structuredClone(state),
    compareAndSet: (revision, next) => {
      if ((state?.revision ?? 0) !== revision) return false;
      state = structuredClone(next);
      return true;
    },
  };
  const secrets = new Map<string, Uint8Array>();
  const key = (id: string, epoch: number, purpose: RemoteCredentialPurpose) => `${id}:${epoch}:${purpose}`;
  const credentials: RemoteCredentialVault = {
    put: vi.fn(async (id, epoch, purpose, value) => {
      const account = key(id, epoch, purpose);
      if (secrets.has(account)) throw new Error('duplicate');
      secrets.set(account, new Uint8Array(value));
    }),
    get: vi.fn(async (id, epoch, purpose) => {
      const value = secrets.get(key(id, epoch, purpose));
      return value ? new Uint8Array(value) : null;
    }),
    deleteSet: vi.fn(async (id, epoch) => {
      for (const purpose of ['relay-token', 'identity-ed25519-pkcs8', 'identity-x25519-pkcs8'] as const) {
        secrets.delete(key(id, epoch, purpose));
      }
    }),
  };
  const manager = new PairingManager({
    rootPublicKeySpki: issuer.publicKey.export({ format: 'der', type: 'spki' }),
    repository,
    credentials,
    targetId: () => 'target-opaque',
    clock: () => NOW,
    randomUuid: (() => {
      const values = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ];
      return () => values.shift() ?? '44444444-4444-4444-8444-444444444444';
    })(),
    randomNonce: () => Buffer.alloc(16, 3),
  });

  const response = (request: PairingRequestV1, token = TOKEN, patch: Partial<PairingResponseV2> = {}) => {
    const ephemeral = generateKeyPairSync('x25519');
    const shared = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: createPublicKey({
        key: Buffer.from(request.targetX25519PublicKey, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    });
    const base = {
      schemaVersion: 2 as const,
      pairingId: request.pairingId,
      requestId: request.requestId,
      requestDigest: request.requestDigest,
      ownerId: 'owner-opaque',
      controllerId: 'controller-opaque',
      targetId: request.targetId,
      relayUrl: 'wss://relay.example.test/remote',
      sessionId: '55555555-5555-4555-8555-555555555555',
      controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      targetEd25519PublicKeySha256: request.targetEd25519PublicKeySha256,
      targetX25519PublicKeySha256: request.targetX25519PublicKeySha256,
      issuerEphemeralX25519PublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      relayTokenNonce: Buffer.alloc(12, 7).toString('base64url'),
      relayTokenCiphertext: '',
      relayTokenTag: '',
      relayTokenSha256: sha(token),
      keyEpoch: request.keyEpoch,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      nonce: Buffer.alloc(16, request.keyEpoch + 8).toString('base64url'),
      ...patch,
    } satisfies Omit<PairingResponseV2, 'issuerSignature'>;
    const aesKey = Buffer.from(hkdfSync(
      'sha256', shared, Buffer.from(base.requestDigest, 'hex'), Buffer.from('copilot-pairing-relay-token-v1'), 32,
    ));
    const cipher = createCipheriv('aes-256-gcm', aesKey, Buffer.from(base.relayTokenNonce, 'base64url'));
    cipher.setAAD(pairingTokenAadBytes(base));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const unsigned = {
      ...base,
      relayTokenCiphertext: ciphertext.toString('base64url'),
      relayTokenTag: cipher.getAuthTag().toString('base64url'),
    };
    return {
      ...unsigned,
      issuerSignature: sign(null, pairingResponseSignatureBytes(unsigned), issuer.privateKey).toString('base64url'),
    } satisfies PairingResponseV2;
  };
  return { manager, repository, credentials, secrets, response };
}

describe('Remote pairing/signer r2 target-bound provisioning', () => {
  it('creates a public-only staged request and imports only a signed, target-bound encrypted response', async () => {
    const { manager, repository, credentials, secrets, response } = fixture();
    const request = await manager.createPairingRequest();
    expect(JSON.stringify(request)).not.toContain('PRIVATE');
    expect(request).toMatchObject({ schemaVersion: 1, keyEpoch: 1, targetId: 'target-opaque' });
    expect(request.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(credentials.put).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(repository.get())).not.toContain('pkcs8');

    const encrypted = response(request);
    expect(JSON.stringify(encrypted)).not.toContain(TOKEN);
    await expect(manager.importBytes(Buffer.from(JSON.stringify({
      ...encrypted,
      schemaVersion: 1,
      relayToken: TOKEN,
    })))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify(response(request, TOKEN, {
      requestDigest: '0'.repeat(64),
    }))))).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify(response(request, TOKEN, {
      targetX25519PublicKeySha256: 'f'.repeat(64),
    }))))).rejects.toMatchObject({ code: 'AUTH_INVALID' });

    await expect(manager.importBytes(Buffer.from(JSON.stringify(encrypted)))).resolves.toMatchObject({
      configured: true,
      keyEpoch: 1,
      recoveryRequired: false,
    });
    const storedToken = secrets.get(`${request.pairingId}:1:relay-token`);
    expect(Buffer.from(storedToken ?? []).toString('utf8')).toBe(TOKEN);
    const persisted = JSON.stringify(repository.get());
    expect(persisted).not.toContain(TOKEN);
    expect(persisted).not.toContain('relayTokenCiphertext');
  });

  it('uses same-pairing-id epoch staging and preserves the old active set on rotation failure', async () => {
    const { manager, repository, credentials, secrets, response } = fixture();
    const first = await manager.createPairingRequest();
    await manager.importBytes(Buffer.from(JSON.stringify(response(first))));
    const before = repository.get()?.active;
    const rotation = await manager.createPairingRequest();
    expect(rotation).toMatchObject({ pairingId: first.pairingId, keyEpoch: 2 });
    (credentials.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('locked'));
    await expect(manager.importBytes(Buffer.from(JSON.stringify(response(rotation, Buffer.alloc(32, 8).toString('base64url'))))))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(repository.get()?.active).toEqual(before);
    expect(secrets.has(`${first.pairingId}:1:identity-x25519-pkcs8`)).toBe(true);
    expect(secrets.has(`${first.pairingId}:1:relay-token`)).toBe(true);
    expect([...secrets.keys()].some((key) => key.startsWith(`${first.pairingId}:2:`))).toBe(false);
  });

  it('keeps active metadata and persists recovery-required when revoke deletion is uncertain', async () => {
    const { manager, repository, credentials, response } = fixture();
    const request = await manager.createPairingRequest();
    await manager.importBytes(Buffer.from(JSON.stringify(response(request))));
    const before = repository.get()?.active;
    (credentials.deleteSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('native delete denied'));
    await expect(manager.revoke()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(repository.get()).toMatchObject({
      active: before,
      revoked: false,
      recoveryRequired: true,
      orphanedCredentialSets: [{ pairingId: request.pairingId, keyEpoch: 1 }],
    });
    expect(manager.status()).toMatchObject({ configured: true, revoked: false, recoveryRequired: true });
    expect(() => manager.active()).toThrowError();
  });

  it('persists a redacted orphan marker and fails closed when failed-rotation cleanup is uncertain', async () => {
    const { manager, repository, credentials, response } = fixture();
    const first = await manager.createPairingRequest();
    await manager.importBytes(Buffer.from(JSON.stringify(response(first))));
    const active = repository.get()?.active;
    const rotation = await manager.createPairingRequest();
    (credentials.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('relay write denied'));
    (credentials.deleteSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cleanup denied'));
    await expect(manager.importBytes(Buffer.from(JSON.stringify(
      response(rotation, Buffer.alloc(32, 6).toString('base64url')),
    )))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(repository.get()).toMatchObject({
      active,
      recoveryRequired: true,
      orphanedCredentialSets: [{ pairingId: first.pairingId, keyEpoch: 2 }],
    });
    expect(JSON.stringify(repository.get())).not.toContain(TOKEN);
    expect(() => manager.active()).toThrowError();
  });
});
