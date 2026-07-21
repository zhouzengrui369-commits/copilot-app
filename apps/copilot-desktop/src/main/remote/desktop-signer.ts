import {
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import type { RemoteDesktopSignerPort } from './controller.js';
import type { RemoteCredentialVault, RemotePairingRecord } from './pairing.js';
import { RemoteError } from './protocol.js';

export class ProductionDesktopSigner implements RemoteDesktopSignerPort {
  private constructor(private key: KeyObject | null) {}

  static async create(
    pairing: RemotePairingRecord,
    credentials: RemoteCredentialVault,
  ): Promise<ProductionDesktopSigner> {
    const stored = await credentials.get(pairing.pairingId, pairing.keyEpoch, 'identity-ed25519-pkcs8');
    if (!stored) throw new RemoteError('AUTH_REQUIRED', 'target Ed25519 identity is unavailable');
    try {
      const privateKey = createPrivateKey({ key: Buffer.from(stored), format: 'der', type: 'pkcs8' });
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
      const derived = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
      const expected = Buffer.from(pairing.targetEd25519PublicKey, 'base64');
      if (derived.byteLength !== expected.byteLength || !timingSafeEqual(derived, expected)) {
        throw new RemoteError('AUTH_INVALID', 'target Ed25519 identity does not match pairing');
      }
      return new ProductionDesktopSigner(privateKey);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError('AUTH_INVALID', 'paired Ed25519 identity is invalid');
    } finally {
      stored.fill(0);
    }
  }

  async signAck(bytes: Buffer): Promise<string> {
    if (!this.key) throw new RemoteError('SESSION_EXPIRED', 'desktop signer session is cleared');
    return sign(null, bytes, this.key).toString('base64url');
  }

  clearSession(): void {
    this.key = null;
  }
}
