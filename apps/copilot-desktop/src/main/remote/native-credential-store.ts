import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  REMOTE_CREDENTIAL_PURPOSES,
  type RemoteCredentialPurpose,
  type RemoteCredentialVault,
} from './pairing.js';
import { RemoteError } from './protocol.js';
import { managedCredentialService } from '../managed-credential-namespace.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RemoteNativeKeyringEntry {
  setSecret(secret: Uint8Array): Promise<void>;
  /** Exactly null is missing. Rejection and any other shape fail closed. */
  getSecret(): Promise<Uint8Array | null>;
  deleteCredential(): Promise<boolean>;
}

export type RemoteNativeKeyringEntryFactory = (
  service: string,
  account: string,
) => RemoteNativeKeyringEntry;

export function remoteCredentialAccount(
  pairingId: string,
  keyEpoch: number,
  purpose: RemoteCredentialPurpose,
): string {
  requirePairingId(pairingId);
  requireKeyEpoch(keyEpoch);
  if (!REMOTE_CREDENTIAL_PURPOSES.includes(purpose)) fail();
  const hash = createHash('sha256')
    .update(`${pairingId.toLowerCase()}:${keyEpoch}`)
    .digest('hex');
  return `remote.${purpose}.${hash}`;
}

export class NativeRemoteCredentialVault implements RemoteCredentialVault {
  private readonly service: string;

  constructor(
    private readonly entryFactory: RemoteNativeKeyringEntryFactory,
    private readonly platform: NodeJS.Platform = process.platform,
    managedProfileNamespace?: string,
  ) {
    requirePlatform(platform);
    try {
      this.service = managedCredentialService('remote', managedProfileNamespace);
    } catch {
      fail();
    }
  }

  async put(pairingId: string, keyEpoch: number, purpose: RemoteCredentialPurpose, input: Uint8Array): Promise<void> {
    this.requireInput(pairingId, keyEpoch, purpose, input);
    const secret = new Uint8Array(input);
    let existing: Uint8Array | null = null;
    let verified: Uint8Array | null = null;
    try {
      const entry = this.entry(pairingId, keyEpoch, purpose);
      existing = await entry.getSecret();
      if (existing !== null) fail();
      await entry.setSecret(secret);
      verified = await entry.getSecret();
      if (!verified || !equal(secret, verified)) {
        await entry.deleteCredential().catch(() => false);
        fail();
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      fail();
    } finally {
      secret.fill(0);
      existing?.fill(0);
      verified?.fill(0);
    }
  }

  async get(pairingId: string, keyEpoch: number, purpose: RemoteCredentialPurpose): Promise<Uint8Array | null> {
    this.requirePurpose(pairingId, keyEpoch, purpose);
    let stored: Uint8Array | null = null;
    try {
      stored = await this.entry(pairingId, keyEpoch, purpose).getSecret();
      if (stored === null) return null;
      if (!validLength(purpose, stored.byteLength)) fail();
      return new Uint8Array(stored);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      return fail();
    } finally {
      stored?.fill(0);
    }
  }

  async deleteSet(pairingId: string, keyEpoch: number): Promise<void> {
    requirePlatform(this.platform);
    requirePairingId(pairingId);
    requireKeyEpoch(keyEpoch);
    let failed = false;
    for (const purpose of REMOTE_CREDENTIAL_PURPOSES) {
      let remaining: Uint8Array | null = null;
      try {
        const entry = this.entry(pairingId, keyEpoch, purpose);
        if (await entry.deleteCredential() !== true) failed = true;
        remaining = await entry.getSecret();
        if (remaining !== null) failed = true;
      } catch {
        failed = true;
      } finally {
        remaining?.fill(0);
      }
    }
    if (failed) fail();
  }

  private entry(pairingId: string, keyEpoch: number, purpose: RemoteCredentialPurpose): RemoteNativeKeyringEntry {
    try {
      return this.entryFactory(
        this.service,
        remoteCredentialAccount(pairingId, keyEpoch, purpose),
      );
    } catch {
      return fail();
    }
  }

  private requireInput(
    pairingId: string,
    keyEpoch: number,
    purpose: RemoteCredentialPurpose,
    value: Uint8Array,
  ): void {
    this.requirePurpose(pairingId, keyEpoch, purpose);
    if (!validLength(purpose, value.byteLength)) fail();
  }

  private requirePurpose(pairingId: string, keyEpoch: number, purpose: RemoteCredentialPurpose): void {
    requirePlatform(this.platform);
    requirePairingId(pairingId);
    requireKeyEpoch(keyEpoch);
    if (!REMOTE_CREDENTIAL_PURPOSES.includes(purpose)) fail();
  }
}

interface RawAsyncEntry {
  setSecret(secret: Uint8Array): Promise<void>;
  getSecret(): Promise<Uint8Array | undefined>;
  deleteCredential(): Promise<boolean>;
}

interface AsyncEntryConstructor {
  new(service: string, account: string): RawAsyncEntry;
}

export function loadProductionRemoteKeyringFactory(): RemoteNativeKeyringEntryFactory {
  try {
    const require = createRequire(import.meta.url);
    const module = require('@napi-rs/keyring') as { AsyncEntry?: AsyncEntryConstructor };
    const Entry = module.AsyncEntry;
    if (typeof Entry !== 'function') fail();
    return (service, account) => {
      const entry = new Entry(service, account);
      return {
        setSecret: (secret) => entry.setSecret(secret),
        // @napi-rs/keyring documents undefined as the missing-item result;
        // native rejection remains a rejection and is never collapsed to missing.
        getSecret: async () => (await entry.getSecret()) ?? null,
        deleteCredential: () => entry.deleteCredential(),
      };
    };
  } catch {
    return fail();
  }
}

function validLength(purpose: RemoteCredentialPurpose, length: number): boolean {
  if (purpose === 'relay-token') return length >= 32 && length <= 512;
  return length >= 32 && length <= 512;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function requirePairingId(pairingId: string): void {
  if (!UUID_V4.test(pairingId)) fail();
}

function requireKeyEpoch(keyEpoch: number): void {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) fail();
}

function requirePlatform(platform: NodeJS.Platform): void {
  if (platform !== 'darwin' && platform !== 'win32') fail();
}

function fail(): never {
  throw new RemoteError('AUTH_REQUIRED', 'OS-protected remote credential is unavailable');
}
