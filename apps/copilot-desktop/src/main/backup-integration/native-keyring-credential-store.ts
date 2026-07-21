import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';

import { BackupProtocolError, type BackupCredentialStore } from '../backup/index.js';
import { SafeStorageBackupCredentialStore, type SafeStoragePort } from './safe-storage-credential-store.js';
import { managedCredentialService } from '../managed-credential-namespace.js';

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BACKUP_KEYRING_SERVICE = 'ai.njx.copilot.v6.backup';

export interface NativeKeyringEntryPort {
  setSecret(secret: Uint8Array): Promise<void>;
  /** Exactly null means missing. Any native rejection/other value fails closed. */
  getSecret(): Promise<Uint8Array | null>;
  deleteCredential(): Promise<boolean>;
}

export type NativeKeyringEntryFactory = (
  service: string,
  account: string,
) => NativeKeyringEntryPort;

export interface LegacyBackupCredentialStore extends BackupCredentialStore {
  hasDataKeyFile(keyId: string): Promise<boolean>;
}

function unavailable(): never {
  throw new BackupProtocolError('KEY_UNAVAILABLE');
}

function requireKeyId(keyId: string): void {
  if (!SAFE_ID.test(keyId)) unavailable();
}

function equalKey(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === 32
    && right.byteLength === 32
    && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function backupKeyringAccount(keyId: string): string {
  requireKeyId(keyId);
  return `backup.data-key.${createHash('sha256').update(keyId.toLowerCase()).digest('hex')}`;
}

export class NativeKeyringCredentialStore implements BackupCredentialStore {
  private readonly service: string;

  constructor(
    private readonly entryFactory: NativeKeyringEntryFactory,
    private readonly platform: NodeJS.Platform = process.platform,
    managedProfileNamespace?: string,
  ) {
    if (platform !== 'darwin' && platform !== 'win32') unavailable();
    try {
      this.service = managedCredentialService('backup', managedProfileNamespace);
    } catch {
      unavailable();
    }
  }

  async putDataKey(keyId: string, key: Uint8Array): Promise<void> {
    this.requireInput(keyId, key);
    const entry = this.entry(keyId);
    const secret = new Uint8Array(key);
    let existing: Uint8Array | null = null;
    let verified: Uint8Array | null = null;
    try {
      existing = await entry.getSecret();
      if (existing !== null) unavailable();
      await entry.setSecret(secret);
      verified = await entry.getSecret();
      if (verified === null || !equalKey(secret, verified)) {
        await entry.deleteCredential().catch(() => false);
        unavailable();
      }
    } catch {
      unavailable();
    } finally {
      secret.fill(0);
      existing?.fill(0);
      verified?.fill(0);
    }
  }

  async getDataKey(keyId: string): Promise<Uint8Array | null> {
    this.requirePlatformAndId(keyId);
    let stored: Uint8Array | null = null;
    try {
      stored = await this.entry(keyId).getSecret();
      if (stored === null) return null;
      if (stored.byteLength !== 32) unavailable();
      return new Uint8Array(stored);
    } catch {
      return unavailable();
    } finally {
      stored?.fill(0);
    }
  }

  async deleteDataKey(keyId: string): Promise<void> {
    this.requirePlatformAndId(keyId);
    let remaining: Uint8Array | null = null;
    try {
      const entry = this.entry(keyId);
      await entry.deleteCredential();
      remaining = await entry.getSecret();
      if (remaining !== null) unavailable();
    } catch {
      unavailable();
    } finally {
      remaining?.fill(0);
    }
  }

  private entry(keyId: string): NativeKeyringEntryPort {
    try {
      return this.entryFactory(this.service, backupKeyringAccount(keyId));
    } catch {
      unavailable();
    }
  }

  private requireInput(keyId: string, key: Uint8Array): void {
    this.requirePlatformAndId(keyId);
    if (key.byteLength !== 32) unavailable();
  }

  private requirePlatformAndId(keyId: string): void {
    if (this.platform !== 'darwin' && this.platform !== 'win32') unavailable();
    requireKeyId(keyId);
  }
}

/**
 * Native keyring is authoritative. safeStorage is read only while an existing
 * legacy blob is present, and that blob is removed only after native readback.
 */
export class MigratingBackupCredentialStore implements BackupCredentialStore {
  constructor(
    private readonly nativeStore: BackupCredentialStore,
    private readonly legacyStore: LegacyBackupCredentialStore,
  ) {}

  putDataKey(keyId: string, key: Uint8Array): Promise<void> {
    return this.nativeStore.putDataKey(keyId, key);
  }

  async getDataKey(keyId: string): Promise<Uint8Array | null> {
    const current = await this.nativeStore.getDataKey(keyId);
    if (!await this.legacyStore.hasDataKeyFile(keyId)) return current;

    const legacy = await this.legacyStore.getDataKey(keyId);
    if (!legacy) unavailable();
    let resolved = current;
    let verified: Uint8Array | null = null;
    try {
      if (resolved) {
        if (!equalKey(resolved, legacy)) unavailable();
      } else {
        await this.nativeStore.putDataKey(keyId, legacy);
        verified = await this.nativeStore.getDataKey(keyId);
        if (!verified || !equalKey(verified, legacy)) unavailable();
        resolved = verified;
      }
      await this.legacyStore.deleteDataKey(keyId);
      return new Uint8Array(resolved);
    } finally {
      legacy.fill(0);
      current?.fill(0);
      verified?.fill(0);
    }
  }

  async deleteDataKey(keyId: string): Promise<void> {
    if (await this.legacyStore.hasDataKeyFile(keyId)) {
      await this.legacyStore.deleteDataKey(keyId);
    }
    await this.nativeStore.deleteDataKey(keyId);
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

function loadNativeEntryFactory(): NativeKeyringEntryFactory {
  try {
    const require = createRequire(import.meta.url);
    const module = require('@napi-rs/keyring') as { AsyncEntry?: AsyncEntryConstructor };
    const Entry = module.AsyncEntry;
    if (typeof Entry !== 'function') unavailable();
    return (service, account) => {
      const entry = new Entry(service, account);
      return {
        setSecret: (secret) => entry.setSecret(secret),
        getSecret: async () => (await entry.getSecret()) ?? null,
        deleteCredential: () => entry.deleteCredential(),
      };
    };
  } catch {
    unavailable();
  }
}

export function selectProductionBackupCredentialStore(options: {
  userDataPath: string;
  safeStorage: SafeStoragePort;
  platform?: NodeJS.Platform;
  entryFactory?: NativeKeyringEntryFactory;
  managedProfileNamespace?: string;
}): {
  store: BackupCredentialStore;
  platformProtection:
    | 'macOS Keychain (native; legacy safeStorage migration only)'
    | 'Windows Credential Manager (native; legacy safeStorage migration only)';
} {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') unavailable();
  const nativeStore = new NativeKeyringCredentialStore(
    options.entryFactory ?? loadNativeEntryFactory(),
    platform,
    options.managedProfileNamespace,
  );
  const legacyStore = new SafeStorageBackupCredentialStore(options.userDataPath, options.safeStorage);
  return {
    store: new MigratingBackupCredentialStore(nativeStore, legacyStore),
    platformProtection: platform === 'darwin'
      ? 'macOS Keychain (native; legacy safeStorage migration only)'
      : 'Windows Credential Manager (native; legacy safeStorage migration only)',
  };
}
