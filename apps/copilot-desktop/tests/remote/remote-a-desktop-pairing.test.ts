import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PairingManager,
  pairingResponseSignatureBytes,
  pairingTokenAadBytes,
  readSelectedPairingFile,
  type PairingRequestV1,
  type PairingResponseV2,
  type RemoteCredentialPurpose,
  type RemoteCredentialVault,
  type RemotePairingRepository,
  type RemotePairingRepositoryState,
} from '../../src/main/remote/pairing';

const NOW = 1_700_000_000_000;
const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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
  const account = (id: string, epoch: number, purpose: RemoteCredentialPurpose) => `${id}:${epoch}:${purpose}`;
  const credentials: RemoteCredentialVault = {
    put: vi.fn(async (id, epoch, purpose, value) => {
      const key = account(id, epoch, purpose);
      if (secrets.has(key)) throw new Error('duplicate');
      secrets.set(key, new Uint8Array(value));
    }),
    get: vi.fn(async (id, epoch, purpose) => {
      const value = secrets.get(account(id, epoch, purpose));
      return value ? new Uint8Array(value) : null;
    }),
    deleteSet: vi.fn(async (id, epoch) => {
      for (const key of [...secrets.keys()]) if (key.startsWith(`${id}:${epoch}:`)) secrets.delete(key);
    }),
  };
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const manager = new PairingManager({
    rootPublicKeySpki: issuer.publicKey.export({ format: 'der', type: 'spki' }),
    repository,
    credentials,
    targetId: () => 'target-opaque',
    clock: () => NOW,
    randomUuid: () => ids.shift() ?? '44444444-4444-4444-8444-444444444444',
    randomNonce: () => Buffer.alloc(16, 5),
  });
  const signed = (request: PairingRequestV1, token = TOKEN, patch: Partial<PairingResponseV2> = {}) => {
    const ephemeral = generateKeyPairSync('x25519');
    const shared = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: createPublicKey({ key: Buffer.from(request.targetX25519PublicKey, 'base64'), format: 'der', type: 'spki' }),
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
      relayTokenNonce: Buffer.alloc(12, request.keyEpoch).toString('base64url'),
      relayTokenCiphertext: '',
      relayTokenTag: '',
      relayTokenSha256: sha(token),
      keyEpoch: request.keyEpoch,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      nonce: Buffer.alloc(16, request.keyEpoch + 8).toString('base64url'),
      ...patch,
    } satisfies Omit<PairingResponseV2, 'issuerSignature'>;
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(base.requestDigest, 'hex'), Buffer.from('copilot-pairing-relay-token-v1'), 32));
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(base.relayTokenNonce, 'base64url'));
    cipher.setAAD(pairingTokenAadBytes(base));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const unsigned = { ...base, relayTokenCiphertext: ciphertext.toString('base64url'), relayTokenTag: cipher.getAuthTag().toString('base64url') };
    return { ...unsigned, issuerSignature: sign(null, pairingResponseSignatureBytes(unsigned), issuer.privateKey).toString('base64url') } satisfies PairingResponseV2;
  };
  return { manager, repository, credentials, secrets, issuer, signed };
}

describe('Remote A production pairing import', () => {
  it('reads only one regular, single-link, <=16 KiB .copilot-pairing file in main', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-pairing-file-'));
    roots.push(root);
    const valid = path.join(root, 'owner.copilot-pairing');
    fs.writeFileSync(valid, '{"schemaVersion":2}', { mode: 0o600 });
    await expect(readSelectedPairingFile(valid)).resolves.toEqual(Buffer.from('{"schemaVersion":2}'));
    const oversized = path.join(root, 'large.copilot-pairing');
    fs.writeFileSync(oversized, Buffer.alloc(16_385));
    await expect(readSelectedPairingFile(oversized)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    const external = path.join(root, 'external');
    fs.writeFileSync(external, 'unchanged');
    const symlink = path.join(root, 'symlink.copilot-pairing');
    fs.symlinkSync(external, symlink);
    await expect(readSelectedPairingFile(symlink)).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    const hardlink = path.join(root, 'hardlink.copilot-pairing');
    fs.linkSync(external, hardlink);
    await expect(readSelectedPairingFile(hardlink)).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(fs.readFileSync(external, 'utf8')).toBe('unchanged');
  });

  it('stages target keys before import and persists only redacted/public metadata', async () => {
    const { manager, repository, credentials, signed } = fixture();
    const request = await manager.createPairingRequest();
    const response = signed(request);
    await expect(manager.importBytes(Buffer.from(JSON.stringify(response)))).resolves.toMatchObject({
      configured: true, revoked: false, recoveryRequired: false, keyEpoch: 1,
    });
    const persisted = JSON.stringify(repository.get());
    expect(persisted).not.toContain(TOKEN);
    expect(persisted).not.toContain('issuerSignature');
    expect(credentials.put).toHaveBeenCalledTimes(3);
  });

  it('rejects missing root, old plaintext schema, unknown fields, expiry, endpoint, digest substitutions and replay', async () => {
    const { manager, repository, credentials, issuer, signed } = fixture();
    const request = await manager.createPairingRequest();
    const response = signed(request);
    const missingRoot = new PairingManager({ rootPublicKeySpki: null, repository, credentials, clock: () => NOW });
    await expect(missingRoot.importBytes(Buffer.from(JSON.stringify(response)))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(manager.importBytes(Buffer.alloc(16_385))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify({ ...response, relayToken: TOKEN })))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify({ ...response, unknown: true })))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify(signed(request, TOKEN, { expiresAtMs: NOW - 1 }))))).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(manager.importBytes(Buffer.from(JSON.stringify(signed(request, TOKEN, { relayUrl: 'wss://relay.example.test:444/remote' }))))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    const substituted = { ...response, pairingId: '99999999-9999-4999-8999-999999999999' };
    await expect(manager.importBytes(Buffer.from(JSON.stringify(substituted)))).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
    expect(issuer.privateKey.type).toBe('private');
    await manager.importBytes(Buffer.from(JSON.stringify(response)));
    await expect(manager.importBytes(Buffer.from(JSON.stringify(response)))).resolves.toMatchObject({ configured: true });
  });

  it('keeps epoch 1 active on same-id epoch 2 failure and revokes every versioned credential set', async () => {
    const { manager, repository, credentials, secrets, signed } = fixture();
    const first = await manager.createPairingRequest();
    await manager.importBytes(Buffer.from(JSON.stringify(signed(first))));
    const before = repository.get()?.active;
    const rotation = await manager.createPairingRequest();
    (credentials.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('locked'));
    const rotationBytes = Buffer.from(JSON.stringify(
      signed(rotation, Buffer.alloc(32, 9).toString('base64url')),
    ));
    await expect(manager.importBytes(rotationBytes))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(repository.get()?.active).toEqual(before);
    expect(secrets.has(`${first.pairingId}:1:relay-token`)).toBe(true);
    await expect(manager.revoke()).resolves.toMatchObject({ configured: false, revoked: true });
    expect(credentials.deleteSet).toHaveBeenCalledWith(first.pairingId, 1);
  });
});
