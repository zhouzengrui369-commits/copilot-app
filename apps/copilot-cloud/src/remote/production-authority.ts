import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RemoteRelayOptions } from './remote-a-relay.js';
import {
  PairingAuthority,
  PairingAuthorityStore,
  type PairingIssuerKeyProvider,
} from './pairing-authority.js';

export interface ProductionAuthorityConfig {
  issuerKeyPath: string;
  maxSessions: number;
  maxUsedRequests: number;
  sessionTtlMs: number;
}

export interface FileIssuerKeyPolicy {
  expectedUid?: number | null;
}

export interface ProductionAuthorityOptions {
  config: ProductionAuthorityConfig | null | undefined;
  relayPath?: string;
  clock?: () => number;
  issuerKeyProvider?: PairingIssuerKeyProvider | null;
}

export interface ProductionRemoteAuthorityComposition {
  authority: PairingAuthority;
  store: PairingAuthorityStore;
  relayOptions: Pick<RemoteRelayOptions, 'authVerifier' | 'signatureVerifier' | 'clock'>;
  status: 'ready' | 'provider_missing' | 'provider_invalid';
}

/**
 * External-secret provider. The repository/config stores only an absolute path.
 * Secret bytes are read with no-follow, parsed into a KeyObject, then zeroed.
 */
export class FileEd25519IssuerKeyProvider implements PairingIssuerKeyProvider {
  private static readonly pemHeader = Buffer.from('-----BEGIN PRIVATE KEY-----', 'ascii');

  constructor(
    private readonly filePath: string,
    private readonly policy: FileIssuerKeyPolicy = {},
  ) {}

  async publicKeySpki(): Promise<Uint8Array> {
    const privateKey = await this.loadPrivateKey();
    return createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  }

  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    const privateKey = await this.loadPrivateKey();
    const message = Buffer.from(bytes);
    try {
      return sign(null, message, privateKey);
    } finally {
      message.fill(0);
    }
  }

  private async loadPrivateKey(): Promise<KeyObject> {
    if (!path.isAbsolute(this.filePath) || this.filePath.includes('\u0000')) {
      throw new Error('ISSUER_KEY_PROVIDER_INVALID');
    }
    let handle: fs.promises.FileHandle | null = null;
    let bytes: Buffer | null = null;
    try {
      const noFollow = fs.constants.O_NOFOLLOW;
      if (process.platform !== 'win32' && typeof noFollow !== 'number') {
        throw new Error('ISSUER_KEY_PROVIDER_INVALID');
      }
      handle = await fs.promises.open(
        this.filePath,
        fs.constants.O_RDONLY | (noFollow ?? 0),
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 32 || stat.size > 16 * 1024) {
        throw new Error('ISSUER_KEY_PROVIDER_INVALID');
      }
      if (process.platform !== 'win32') {
        if ((stat.mode & 0o777) !== 0o600) throw new Error('ISSUER_KEY_PROVIDER_INVALID');
        const expectedUid = Object.hasOwn(this.policy, 'expectedUid')
          ? this.policy.expectedUid
          : typeof process.getuid === 'function'
            ? process.getuid()
            : null;
        if (!Number.isSafeInteger(expectedUid) || stat.uid !== expectedUid) {
          throw new Error('ISSUER_KEY_PROVIDER_INVALID');
        }
      }
      bytes = await handle.readFile();
      let key: KeyObject;
      try {
        const isPem = bytes.byteLength >= FileEd25519IssuerKeyProvider.pemHeader.byteLength &&
          bytes.subarray(0, FileEd25519IssuerKeyProvider.pemHeader.byteLength)
            .equals(FileEd25519IssuerKeyProvider.pemHeader);
        key = isPem
          ? createPrivateKey(bytes)
          : createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' });
      } catch {
        throw new Error('ISSUER_KEY_PROVIDER_INVALID');
      }
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('ISSUER_KEY_PROVIDER_INVALID');
      return key;
    } catch {
      throw new Error('ISSUER_KEY_PROVIDER_INVALID');
    } finally {
      bytes?.fill(0);
      await handle?.close().catch(() => undefined);
    }
  }
}

async function providerIsValid(provider: PairingIssuerKeyProvider): Promise<boolean> {
  const canary = Buffer.from('copilot-cloud-pairing-authority-provider-v1', 'utf8');
  let publicBytes: Buffer | null = null;
  let signature: Buffer | null = null;
  try {
    publicBytes = Buffer.from(await provider.publicKeySpki());
    const publicKey = createPublicKey({ key: publicBytes, format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return false;
    signature = Buffer.from(await provider.sign(canary));
    return signature.byteLength === 64 && verify(null, canary, publicKey, signature);
  } catch {
    return false;
  } finally {
    canary.fill(0);
    publicBytes?.fill(0);
    signature?.fill(0);
  }
}

export async function createProductionRemoteAuthority(
  options: ProductionAuthorityOptions,
): Promise<ProductionRemoteAuthorityComposition> {
  const clock = options.clock ?? Date.now;
  const config = options.config;
  const limitsValid = !config || (
    Number.isSafeInteger(config.maxSessions) && config.maxSessions >= 1 && config.maxSessions <= 10_000 &&
    Number.isSafeInteger(config.maxUsedRequests) && config.maxUsedRequests >= 1 && config.maxUsedRequests <= 10_000 &&
    Number.isSafeInteger(config.sessionTtlMs) && config.sessionTtlMs >= 1 && config.sessionTtlMs <= 15 * 60_000
  );
  const relayPathValid = options.relayPath === undefined || options.relayPath === '/v1/remote/ws';
  const configuredPathValid = !config?.issuerKeyPath || (
    config.issuerKeyPath.length <= 4_096 &&
    path.isAbsolute(config.issuerKeyPath) &&
    !/[\r\n\u0000]/u.test(config.issuerKeyPath)
  );
  const configurationValid = limitsValid && relayPathValid && configuredPathValid;
  const maxSessions = configurationValid && config ? config.maxSessions : 1;
  const maxUsedRequests = configurationValid && config ? config.maxUsedRequests : 1;
  const sessionTtlMs = configurationValid && config ? config.sessionTtlMs : 15 * 60_000;
  const store = new PairingAuthorityStore(maxSessions, clock, maxUsedRequests);
  const configuredProvider = options.issuerKeyProvider
    ?? (config?.issuerKeyPath ? new FileEd25519IssuerKeyProvider(config.issuerKeyPath) : null);
  const ready = configurationValid && configuredProvider
    ? await providerIsValid(configuredProvider)
    : false;
  const provider = ready ? configuredProvider : null;
  const authority = new PairingAuthority({
    issuerKeyProvider: provider,
    store,
    relayPath: relayPathValid ? options.relayPath : undefined,
    sessionTtlMs,
    clock,
  });
  return {
    authority,
    store,
    relayOptions: ready ? {
      authVerifier: (input) => store.authenticate(input),
      signatureVerifier: (input, signature) => store.verifyEnvelopeSignature(input, signature),
      clock,
    } : {
      authVerifier: () => false,
      signatureVerifier: () => false,
      clock,
    },
    status: ready
      ? 'ready'
      : configuredProvider || !configurationValid
        ? 'provider_invalid'
        : 'provider_missing',
  };
}
