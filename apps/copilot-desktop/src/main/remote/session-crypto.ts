import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import type { RemoteEnvelope } from '../../shared/remote-management.js';
import type { RemoteCryptoPort, RemoteReplyContext } from './controller.js';
import { envelopeSignatureBytes, RemoteError, stableJson } from './protocol.js';
import type { RemoteCredentialVault, RemotePairingRecord } from './pairing.js';

interface EnvelopeAadFields {
  schemaVersion: 1;
  messageType: RemoteEnvelope['messageType'];
  requestId: string;
  sessionId: string;
  commandId: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payloadAlgorithm: RemoteEnvelope['payloadAlgorithm'];
}

interface ProductionReplyContext extends RemoteReplyContext {
  pairingId: string;
  requestId: string;
  commandId: string;
  replyAad: string;
}

export class ProductionRemoteSessionCrypto implements RemoteCryptoPort {
  private active = true;

  private constructor(
    private readonly pairing: RemotePairingRecord,
    private readonly controllerVerifyKey: ReturnType<typeof createPublicKey>,
    private readonly inboundKey: Buffer,
    private readonly outboundKey: Buffer,
  ) {}

  static async create(
    pairing: RemotePairingRecord,
    credentials: RemoteCredentialVault,
  ): Promise<ProductionRemoteSessionCrypto> {
    const stored = await credentials.get(pairing.pairingId, pairing.keyEpoch, 'identity-x25519-pkcs8');
    if (!stored) throw new RemoteError('AUTH_REQUIRED', 'target X25519 identity is unavailable');
    try {
      const targetPrivate = createPrivateKey({ key: Buffer.from(stored), format: 'der', type: 'pkcs8' });
      if (targetPrivate.asymmetricKeyType !== 'x25519') throw new Error('wrong private key type');
      const expectedTargetPublic = decodePublic(pairing.targetX25519PublicKey, 'x25519');
      const derivedTargetPublic = createPublicKey(targetPrivate);
      if (!equalDer(derivedTargetPublic, expectedTargetPublic)) {
        throw new RemoteError('AUTH_INVALID', 'target X25519 identity does not match pairing');
      }
      const controllerDhKey = decodePublic(pairing.controllerX25519PublicKey, 'x25519');
      const controllerVerifyKey = decodePublic(pairing.controllerEd25519PublicKey, 'ed25519');
      const shared = diffieHellman({ privateKey: targetPrivate, publicKey: controllerDhKey });
      const salt = createHash('sha256').update(remotePairingTranscript(pairing)).digest();
      const inbound = Buffer.from(hkdfSync(
        'sha256', shared, salt, Buffer.from('controller-to-target'), 32,
      ));
      const outbound = Buffer.from(hkdfSync(
        'sha256', shared, salt, Buffer.from('target-to-controller'), 32,
      ));
      shared.fill(0);
      return new ProductionRemoteSessionCrypto(pairing, controllerVerifyKey, inbound, outbound);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError('AUTH_INVALID', 'paired X25519 identity is invalid');
    } finally {
      stored.fill(0);
    }
  }

  async verifyAndDecrypt(envelope: RemoteEnvelope): Promise<{
    command: unknown;
    replyContext: ProductionReplyContext;
  }> {
    this.requireActive();
    this.assertBinding(envelope);
    let signature: Buffer;
    try {
      signature = Buffer.from(envelope.controllerSignature, 'base64url');
    } catch {
      throw new RemoteError('SIGNATURE_INVALID', 'controller signature is invalid');
    }
    if (
      signature.byteLength !== 64
      || !verify(null, envelopeSignatureBytes(envelope), this.controllerVerifyKey, signature)
    ) {
      throw new RemoteError('SIGNATURE_INVALID', 'controller signature is invalid');
    }

    const packed = Buffer.from(envelope.payloadCiphertext, 'base64url');
    if (packed.byteLength <= 28) throw new RemoteError('DECRYPT_FAILED', 'remote payload is invalid');
    if (createHash('sha256').update(packed).digest('hex') !== envelope.payloadSha256) {
      throw new RemoteError('DECRYPT_FAILED', 'remote payload digest mismatch');
    }
    const nonce = packed.subarray(0, 12);
    const ciphertext = packed.subarray(12, -16);
    const tag = packed.subarray(-16);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.inboundKey, nonce);
      decipher.setAAD(remoteEnvelopeAad(envelope));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const command = JSON.parse(plaintext.toString('utf8')) as unknown;
      plaintext.fill(0);
      const replyAad = replyAadBytes(envelope);
      return {
        command,
        replyContext: {
          pairingId: this.pairing.pairingId,
          requestId: envelope.requestId,
          commandId: envelope.commandId,
          replyAad: replyAad.toString('base64url'),
        },
      };
    } catch {
      throw new RemoteError('DECRYPT_FAILED', 'remote payload authentication failed');
    }
  }

  async encryptReply(value: unknown, context: RemoteReplyContext): Promise<string> {
    this.requireActive();
    const resolved = context as Partial<ProductionReplyContext>;
    if (
      resolved.pairingId !== this.pairing.pairingId
      || typeof resolved.replyAad !== 'string'
      || typeof resolved.requestId !== 'string'
      || typeof resolved.commandId !== 'string'
    ) {
      throw new RemoteError('AUTH_INVALID', 'reply crypto context is invalid');
    }
    const nonce = randomBytes(12);
    const plaintext = Buffer.from(stableJson(value), 'utf8');
    try {
      const cipher = createCipheriv('aes-256-gcm', this.outboundKey, nonce);
      cipher.setAAD(Buffer.from(resolved.replyAad, 'base64url'));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64url');
    } finally {
      plaintext.fill(0);
    }
  }

  clearSession(): void {
    if (!this.active) return;
    this.active = false;
    this.inboundKey.fill(0);
    this.outboundKey.fill(0);
  }

  private requireActive(): void {
    if (!this.active) throw new RemoteError('SESSION_EXPIRED', 'remote crypto session is cleared');
  }

  private assertBinding(envelope: RemoteEnvelope): void {
    if (envelope.targetId !== this.pairing.targetId) {
      throw new RemoteError('TARGET_MISMATCH', 'remote target binding mismatch');
    }
    if (
      envelope.ownerId !== this.pairing.ownerId
      || envelope.controllerId !== this.pairing.controllerId
    ) {
      throw new RemoteError('AUTH_INVALID', 'remote owner/controller binding mismatch');
    }
    if (envelope.sessionId !== this.pairing.sessionId) {
      throw new RemoteError('SESSION_EXPIRED', 'remote session binding mismatch');
    }
  }
}

export function remotePairingTranscript(pairing: RemotePairingRecord): Buffer {
  return Buffer.from(stableJson({
    pairingId: pairing.pairingId,
    sessionId: pairing.sessionId,
    ownerId: pairing.ownerId,
    controllerId: pairing.controllerId,
    targetId: pairing.targetId,
    controllerEd25519Fingerprint: fingerprint(pairing.controllerEd25519PublicKey),
    controllerX25519Fingerprint: fingerprint(pairing.controllerX25519PublicKey),
    targetEd25519Fingerprint: fingerprint(pairing.targetEd25519PublicKey),
    targetX25519Fingerprint: fingerprint(pairing.targetX25519PublicKey),
    keyEpoch: pairing.keyEpoch,
  }), 'utf8');
}

export function remoteEnvelopeAad(envelope: EnvelopeAadFields): Buffer {
  return Buffer.from(stableJson({
    schemaVersion: envelope.schemaVersion,
    messageType: envelope.messageType,
    requestId: envelope.requestId,
    sessionId: envelope.sessionId,
    commandId: envelope.commandId,
    ownerId: envelope.ownerId,
    controllerId: envelope.controllerId,
    targetId: envelope.targetId,
    nonce: envelope.nonce,
    issuedAtMs: envelope.issuedAtMs,
    expiresAtMs: envelope.expiresAtMs,
    payloadAlgorithm: envelope.payloadAlgorithm,
  }), 'utf8');
}

function replyAadBytes(envelope: RemoteEnvelope): Buffer {
  return Buffer.from(stableJson({
    direction: 'target-to-controller',
    pairingRequestId: envelope.requestId,
    commandId: envelope.commandId,
    sessionId: envelope.sessionId,
    ownerId: envelope.ownerId,
    controllerId: envelope.controllerId,
    targetId: envelope.targetId,
    controllerNonce: envelope.nonce,
  }), 'utf8');
}

function decodePublic(value: string, expected: 'ed25519' | 'x25519') {
  const key = createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== expected) throw new Error('wrong public key type');
  return key;
}

function equalDer(
  left: ReturnType<typeof createPublicKey>,
  right: ReturnType<typeof createPublicKey>,
): boolean {
  const a = left.export({ format: 'der', type: 'spki' });
  const b = right.export({ format: 'der', type: 'spki' });
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function fingerprint(spkiBase64: string): string {
  return createHash('sha256').update(Buffer.from(spkiBase64, 'base64')).digest('hex');
}
