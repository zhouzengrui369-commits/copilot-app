import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  PairingManager,
  pairingResponseSignatureBytes,
  pairingTokenAadBytes,
  type PairingResponseV2,
  type RemoteCredentialPurpose,
  type RemoteCredentialVault,
  type RemotePairingRepositoryState,
} from '../../../copilot-desktop/src/main/remote/pairing.js';
import {
  envelopeSignatureBytes,
  parseRemoteEnvelope,
} from '../../../copilot-desktop/src/main/remote/protocol.js';
import type { RemoteEnvelope as DesktopRemoteEnvelope } from '../../../copilot-desktop/src/shared/remote-management.js';
import {
  RemoteRelayMemoryState,
  parseRemoteRelayEnvelope,
  type RemoteEnvelope as CloudRemoteEnvelope,
} from '../../src/remote/remote-a-relay.js';

const NOW = 1_725_000_000_000;
const TOKEN = Buffer.alloc(32, 7).toString('base64url');

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

class RelaySocket {
  readonly readyState = 1;
  readonly sent: string[] = [];
  send(value: string | Buffer): void { this.sent.push(String(value)); }
  close(): void {}
  terminate(): void {}
  on(): this { return this; }
}

describe('paired Desktop provisioning and Cloud relay protocol integration', () => {
  it('imports a root-signed encrypted token then accepts the same signed envelope schema and route binding', async () => {
    const issuer = generateKeyPairSync('ed25519');
    const controllerEd = generateKeyPairSync('ed25519');
    const controllerX = generateKeyPairSync('x25519');
    let state: RemotePairingRepositoryState | null = null;
    const repository = {
      get: () => structuredClone(state),
      compareAndSet: (revision: number, next: RemotePairingRepositoryState) => {
        if ((state?.revision ?? 0) !== revision) return false;
        state = structuredClone(next);
        return true;
      },
    };
    const secrets = new Map<string, Uint8Array>();
    const account = (id: string, epoch: number, purpose: RemoteCredentialPurpose) => `${id}:${epoch}:${purpose}`;
    const credentials: RemoteCredentialVault = {
      put: vi.fn(async (id, epoch, purpose, value) => {
        secrets.set(account(id, epoch, purpose), Uint8Array.from(value));
      }),
      get: vi.fn(async (id, epoch, purpose) => {
        const value = secrets.get(account(id, epoch, purpose));
        return value ? Uint8Array.from(value) : null;
      }),
      deleteSet: vi.fn(async () => undefined),
    };
    const pairing = new PairingManager({
      rootPublicKeySpki: issuer.publicKey.export({ format: 'der', type: 'spki' }),
      repository,
      credentials,
      targetId: () => 'target-opaque',
      clock: () => NOW,
    });
    const request = await pairing.createPairingRequest();
    const ephemeral = generateKeyPairSync('x25519');
    const shared = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: createPublicKey({
        key: Buffer.from(request.targetX25519PublicKey, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    });
    const responseBase = {
      schemaVersion: 2 as const,
      pairingId: request.pairingId,
      requestId: request.requestId,
      requestDigest: request.requestDigest,
      ownerId: 'owner-opaque',
      controllerId: 'controller-opaque',
      targetId: request.targetId,
      relayUrl: 'wss://relay.example.test/v1/remote/ws',
      sessionId: randomUUID(),
      controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      targetEd25519PublicKeySha256: request.targetEd25519PublicKeySha256,
      targetX25519PublicKeySha256: request.targetX25519PublicKeySha256,
      issuerEphemeralX25519PublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      relayTokenNonce: Buffer.alloc(12, 3).toString('base64url'),
      relayTokenCiphertext: '',
      relayTokenTag: '',
      relayTokenSha256: sha(TOKEN),
      keyEpoch: request.keyEpoch,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      nonce: Buffer.alloc(16, 9).toString('base64url'),
    } satisfies Omit<PairingResponseV2, 'issuerSignature'>;
    const tokenKey = Buffer.from(hkdfSync(
      'sha256',
      shared,
      Buffer.from(request.requestDigest, 'hex'),
      Buffer.from('copilot-pairing-relay-token-v1'),
      32,
    ));
    const cipher = createCipheriv('aes-256-gcm', tokenKey, Buffer.from(responseBase.relayTokenNonce, 'base64url'));
    cipher.setAAD(pairingTokenAadBytes(responseBase));
    const tokenCiphertext = Buffer.concat([cipher.update(TOKEN, 'utf8'), cipher.final()]);
    const responseUnsigned = {
      ...responseBase,
      relayTokenCiphertext: tokenCiphertext.toString('base64url'),
      relayTokenTag: cipher.getAuthTag().toString('base64url'),
    };
    const response: PairingResponseV2 = {
      ...responseUnsigned,
      issuerSignature: sign(null, pairingResponseSignatureBytes(responseUnsigned), issuer.privateKey).toString('base64url'),
    };

    await expect(pairing.importBytes(Buffer.from(JSON.stringify(response)))).resolves.toMatchObject({
      configured: true,
      recoveryRequired: false,
      keyEpoch: 1,
    });
    const active = pairing.active()!;
    expect(Buffer.from(secrets.get(account(active.pairingId, active.keyEpoch, 'relay-token'))!).toString('utf8')).toBe(TOKEN);
    expect(JSON.stringify(repository.get())).not.toContain(TOKEN);

    const payloadCiphertext = Buffer.alloc(48, 5);
    const envelopeBase = {
      schemaVersion: 1 as const,
      messageType: 'command' as const,
      requestId: randomUUID(),
      sessionId: active.sessionId,
      commandId: randomUUID(),
      ownerId: active.ownerId,
      controllerId: active.controllerId,
      targetId: active.targetId,
      nonce: Buffer.alloc(16, 11).toString('base64url'),
      issuedAtMs: NOW,
      expiresAtMs: NOW + 30_000,
      payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM' as const,
      payloadCiphertext: payloadCiphertext.toString('base64url'),
      payloadSha256: sha(payloadCiphertext),
      controllerSignature: '',
    } satisfies DesktopRemoteEnvelope;
    const envelope: DesktopRemoteEnvelope = {
      ...envelopeBase,
      controllerSignature: sign(null, envelopeSignatureBytes(envelopeBase), controllerEd.privateKey).toString('base64url'),
    };
    const bytes = Buffer.from(JSON.stringify(envelope));
    const desktopParsed = parseRemoteEnvelope(bytes.toString('utf8'), NOW);
    const cloudParsed = parseRemoteRelayEnvelope(bytes, NOW);
    expect(cloudParsed).toMatchObject({ ok: true, envelope: desktopParsed });
    expect(verify(
      null,
      envelopeSignatureBytes(desktopParsed),
      createPublicKey({ key: Buffer.from(active.controllerEd25519PublicKey, 'base64'), format: 'der', type: 'spki' }),
      Buffer.from(desktopParsed.controllerSignature, 'base64url'),
    )).toBe(true);

    const relay = new RemoteRelayMemoryState(() => NOW, 10);
    const targetSocket = new RelaySocket();
    const controllerSocket = new RelaySocket();
    relay.attach(targetSocket as never, {
      role: 'target', ownerId: active.ownerId, principalId: active.targetId, sessionId: active.sessionId,
    });
    relay.attach(controllerSocket as never, {
      role: 'controller', ownerId: active.ownerId, principalId: active.controllerId, sessionId: active.sessionId,
    });
    const routed = relay.target((cloudParsed as { ok: true; envelope: CloudRemoteEnvelope }).envelope);
    expect(routed?.socket).toBe(targetSocket);
    expect(relay.isCurrent(routed!)).toBe(true);
    expect(targetSocket.sent).toEqual([]);
    expect(controllerSocket.sent).toEqual([]);
  });
});
