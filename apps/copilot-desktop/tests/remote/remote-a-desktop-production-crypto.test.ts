import {
  createCipheriv,
  createDecipheriv,
  createHash,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RemoteEnvelope } from '../../src/shared/remote-management';
import { envelopeSignatureBytes } from '../../src/main/remote/protocol';
import {
  ProductionRemoteSessionCrypto,
  remoteEnvelopeAad,
  remotePairingTranscript,
} from '../../src/main/remote/session-crypto';
import { ProductionDesktopSigner } from '../../src/main/remote/desktop-signer';
import type { RemotePairingRecord, RemoteCredentialVault } from '../../src/main/remote/pairing';

const NOW = 1_700_000_000_000;

function fixture() {
  const controllerEd = generateKeyPairSync('ed25519');
  const controllerX = generateKeyPairSync('x25519');
  const targetEd = generateKeyPairSync('ed25519');
  const targetX = generateKeyPairSync('x25519');
  const pairing: RemotePairingRecord = {
    pairingId: '11111111-1111-4111-8111-111111111111',
    ownerId: 'owner-opaque',
    controllerId: 'controller-opaque',
    targetId: 'target-opaque',
    relayUrl: 'wss://relay.example.test/remote',
    sessionId: '22222222-2222-4222-8222-222222222222',
    controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    targetEd25519PublicKey: targetEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    targetX25519PublicKey: targetX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    controllerKeyFingerprint: createHash('sha256').update(controllerEd.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
    targetKeyFingerprint: createHash('sha256').update(targetEd.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
    keyEpoch: 1,
    issuedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    bundleDigest: 'a'.repeat(64),
    nonceDigest: 'b'.repeat(64),
    relayTokenSha256: 'c'.repeat(64),
  };
  const values = new Map([
    ['relay-token', Buffer.from('relay-secret')],
    ['identity-ed25519-pkcs8', targetEd.privateKey.export({ format: 'der', type: 'pkcs8' })],
    ['identity-x25519-pkcs8', targetX.privateKey.export({ format: 'der', type: 'pkcs8' })],
  ]);
  const vault: RemoteCredentialVault = {
    put: async () => undefined,
    get: async (_id, _epoch, purpose) => new Uint8Array(values.get(purpose)!),
    deleteSet: async () => undefined,
  };
  return { pairing, vault, controllerEd, controllerX, targetEd, targetX };
}

function envelopeFor(f: ReturnType<typeof fixture>, command: unknown): RemoteEnvelope {
  const shared = diffieHellman({ privateKey: f.controllerX.privateKey, publicKey: f.targetX.publicKey });
  const transcript = remotePairingTranscript(f.pairing);
  const key = Buffer.from(hkdfSync('sha256', shared, createHash('sha256').update(transcript).digest(), Buffer.from('controller-to-target'), 32));
  const nonce = randomBytes(12);
  const draft = {
    schemaVersion: 1,
    messageType: 'command',
    requestId: '33333333-3333-4333-8333-333333333333',
    sessionId: f.pairing.sessionId,
    commandId: '44444444-4444-4444-8444-444444444444',
    ownerId: f.pairing.ownerId,
    controllerId: f.pairing.controllerId,
    targetId: f.pairing.targetId,
    nonce: Buffer.alloc(16, 9).toString('base64url'),
    issuedAtMs: NOW,
    expiresAtMs: NOW + 60_000,
    payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
  } as const;
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(remoteEnvelopeAad(draft));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(command)), cipher.final()]);
  const packed = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
  const unsigned: RemoteEnvelope = {
    ...draft,
    payloadCiphertext: packed.toString('base64url'),
    payloadSha256: createHash('sha256').update(packed).digest('hex'),
    controllerSignature: '',
  };
  return {
    ...unsigned,
    controllerSignature: sign(null, envelopeSignatureBytes(unsigned), f.controllerEd.privateKey).toString('base64url'),
  };
}

describe('Remote A production session crypto and signer', () => {
  it('verifies controller Ed25519, decrypts X25519/HKDF/A256GCM, encrypts reply directionally, and signs ACK', async () => {
    const f = fixture();
    const crypto = await ProductionRemoteSessionCrypto.create(f.pairing, f.vault);
    const signer = await ProductionDesktopSigner.create(f.pairing, f.vault);
    const command = { action: 'note.list', input: {} };
    const envelope = envelopeFor(f, command);
    const opened = await crypto.verifyAndDecrypt(envelope);
    expect(opened.command).toEqual(command);

    const reply = Buffer.from(await crypto.encryptReply({ ok: true }, opened.replyContext), 'base64url');
    const shared = diffieHellman({ privateKey: f.controllerX.privateKey, publicKey: f.targetX.publicKey });
    const replyKey = Buffer.from(hkdfSync('sha256', shared, createHash('sha256').update(remotePairingTranscript(f.pairing)).digest(), Buffer.from('target-to-controller'), 32));
    const nonce = reply.subarray(0, 12);
    const tag = reply.subarray(reply.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', replyKey, nonce);
    decipher.setAAD(Buffer.from(opened.replyContext.replyAad as string, 'base64url'));
    decipher.setAuthTag(tag);
    expect(JSON.parse(Buffer.concat([decipher.update(reply.subarray(12, -16)), decipher.final()]).toString())).toEqual({ ok: true });

    const signature = await signer.signAck(Buffer.from('ack-bytes'));
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it('fails closed for forged controller signature, GCM tag/AAD changes, missing key material and cleared sessions', async () => {
    const f = fixture();
    const valid = envelopeFor(f, { action: 'note.list', input: {} });
    const forged = { ...valid, controllerSignature: Buffer.alloc(64, 1).toString('base64url') };
    const crypto = await ProductionRemoteSessionCrypto.create(f.pairing, f.vault);
    await expect(crypto.verifyAndDecrypt(forged)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
    const tamperedBytes = Buffer.from(valid.payloadCiphertext, 'base64url');
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    const tampered = { ...valid, payloadCiphertext: tamperedBytes.toString('base64url') };
    await expect(crypto.verifyAndDecrypt(tampered)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    await crypto.clearSession();
    await expect(crypto.verifyAndDecrypt(valid)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });

    const missing: RemoteCredentialVault = { ...f.vault, get: async () => null };
    await expect(ProductionRemoteSessionCrypto.create(f.pairing, missing)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(ProductionDesktopSigner.create(f.pairing, missing)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
