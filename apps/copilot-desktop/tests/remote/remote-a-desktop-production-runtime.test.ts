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
import { createProductionRemoteRuntime } from '../../src/main/remote/production-runtime';
import {
  pairingResponseSignatureBytes,
  pairingTokenAadBytes,
  type PairingRequestV1,
  type PairingResponseV2,
  type RemoteCredentialPurpose,
  type RemoteCredentialVault,
  type RemotePairingRepository,
  type RemotePairingRepositoryState,
} from '../../src/main/remote/pairing';
import type { RemoteSocket, RemoteSocketFactory } from '../../src/main/remote/online-client';

const NOW = 1_700_000_000_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

class FakeSocket implements RemoteSocket {
  readyState = 0;
  closed = false;
  private listeners = new Map<string, Array<(value?: unknown) => void>>();
  on(event: string, listener: (value?: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  send(): void {}
  close(): void { this.closed = true; this.readyState = 3; }
}

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-runtime-pairing-'));
  roots.push(userData);
  const issuer = generateKeyPairSync('ed25519');
  const controllerEd = generateKeyPairSync('ed25519');
  const controllerX = generateKeyPairSync('x25519');
  const token = Buffer.alloc(32, 4).toString('base64url');
  let request: PairingRequestV1 | null = null;
  let requestBytes: Uint8Array | null = null;
  let responseBytes: Uint8Array | null = null;
  let pairingState: RemotePairingRepositoryState | null = null;
  const repository: RemotePairingRepository = {
    get: () => structuredClone(pairingState),
    compareAndSet: (revision, value) => {
      if ((pairingState?.revision ?? 0) !== revision) return false;
      pairingState = structuredClone(value);
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
  const buildResponse = (): PairingResponseV2 => {
    if (!request) throw new Error('request absent');
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
      sessionId: '22222222-2222-4222-8222-222222222222',
      controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      targetEd25519PublicKeySha256: request.targetEd25519PublicKeySha256,
      targetX25519PublicKeySha256: request.targetX25519PublicKeySha256,
      issuerEphemeralX25519PublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      relayTokenNonce: Buffer.alloc(12, 5).toString('base64url'),
      relayTokenCiphertext: '',
      relayTokenTag: '',
      relayTokenSha256: sha(token),
      keyEpoch: request.keyEpoch,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      nonce: Buffer.alloc(16, 3).toString('base64url'),
    } satisfies Omit<PairingResponseV2, 'issuerSignature'>;
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(request.requestDigest, 'hex'), Buffer.from('copilot-pairing-relay-token-v1'), 32));
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(base.relayTokenNonce, 'base64url'));
    cipher.setAAD(pairingTokenAadBytes(base));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const unsigned = { ...base, relayTokenCiphertext: ciphertext.toString('base64url'), relayTokenTag: cipher.getAuthTag().toString('base64url') };
    return { ...unsigned, issuerSignature: sign(null, pairingResponseSignatureBytes(unsigned), issuer.privateKey).toString('base64url') };
  };
  const socket = new FakeSocket();
  const socketFactory = vi.fn(() => socket);
  const approval = { cancelAll: vi.fn(), respond: vi.fn(() => ({ accepted: true })) };
  const runtime = createProductionRemoteRuntime({
    userDataPath: userData,
    getService: async () => { throw new Error('not used'); },
    approval: approval as never,
    savePairingRequest: async (bytes) => {
      requestBytes = bytes;
      request = JSON.parse(Buffer.from(bytes).toString('utf8')) as PairingRequestV1;
      return true;
    },
    pickPairingBundle: async () => {
      responseBytes = Buffer.from(JSON.stringify(buildResponse()));
      return responseBytes;
    },
    pairingRootPublicKeySpki: issuer.publicKey.export({ format: 'der', type: 'spki' }),
    pairingRepository: repository,
    credentialVault: credentials,
    socketFactory: socketFactory as unknown as RemoteSocketFactory,
    clock: () => NOW,
    env: { COPILOT_REMOTE_WSS_URL: 'wss://evil.example.test/?token=ENV_SECRET' },
  });
  return {
    runtime,
    socket,
    socketFactory,
    approval,
    credentials,
    token,
    pairingBuffers: () => ({ requestBytes, responseBytes }),
  };
}

describe('Remote target production runtime composition', () => {
  it('creates request/imports in main, enables from paired config, sends exact target headers, and ignores env', async () => {
    const { runtime, socketFactory, token, pairingBuffers } = fixture();
    await expect(runtime.createPairingRequest()).resolves.toMatchObject({ pairing: { pendingRequest: true } });
    expect([...pairingBuffers().requestBytes!]).toEqual(expect.arrayContaining([0]));
    expect([...pairingBuffers().requestBytes!].every((byte) => byte === 0)).toBe(true);
    await expect(runtime.importPairing()).resolves.toMatchObject({ enabled: false, pairing: { configured: true, keyEpoch: 1 } });
    expect([...pairingBuffers().responseBytes!].every((byte) => byte === 0)).toBe(true);
    await expect(runtime.enable({ ownerConsent: true })).resolves.toMatchObject({ enabled: true, connection: 'connecting' });
    expect(socketFactory).toHaveBeenCalledWith('wss://relay.example.test/remote', {
      Authorization: `Bearer ${token}`,
      'X-Remote-Role': 'target',
      'X-Owner-Id': 'owner-opaque',
      'X-Session-Id': '22222222-2222-4222-8222-222222222222',
      'X-Target-Id': expect.stringMatching(/^desktop-/),
    });
    expect(JSON.stringify(await runtime.getState())).not.toContain(token);
    expect(JSON.stringify(socketFactory.mock.calls)).not.toContain('ENV_SECRET');
  });

  it('disable closes the socket/session; revoke deletes exact epoch and retains redacted status', async () => {
    const { runtime, socket, credentials, approval, token } = fixture();
    await runtime.createPairingRequest();
    await runtime.importPairing();
    await runtime.enable({ ownerConsent: true });
    await expect(runtime.disable()).resolves.toMatchObject({ enabled: false, pairing: { configured: true } });
    expect(socket.closed).toBe(true);
    expect(approval.cancelAll).toHaveBeenCalled();
    await expect(runtime.revokePairing()).resolves.toMatchObject({ pairing: { configured: false, revoked: true } });
    expect(credentials.deleteSet).toHaveBeenCalledWith(expect.any(String), 1);
    expect(JSON.stringify(await runtime.getState())).not.toContain(token);
  });
});
