import { randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { BackupProtocolError, type BackupCredentialStore } from '../backup/index.js';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(): never {
  throw new BackupProtocolError('KEY_UNAVAILABLE');
}

export class SafeStorageBackupCredentialStore implements BackupCredentialStore {
  private readonly directory: string;

  constructor(userDataPath: string, private readonly safeStorage: SafeStoragePort) {
    this.directory = path.join(userDataPath, 'backup-a', 'credentials');
  }

  async putDataKey(keyId: string, key: Uint8Array): Promise<void> {
    this.requireSafe(keyId);
    if (key.byteLength !== 32) unavailable();
    await this.requireDirectory();
    const destination = this.file(keyId);
    const temporary = path.join(this.directory, `.${keyId}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      const encrypted = this.safeStorage.encryptString(Buffer.from(key).toString('base64'));
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encrypted);
      await handle.sync();
      await handle.close();
      handle = null;
      // link is an atomic, no-overwrite publication on the same filesystem.
      await link(temporary, destination);
      await chmod(destination, 0o600);
    } catch {
      unavailable();
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  async getDataKey(keyId: string): Promise<Uint8Array | null> {
    this.requireSafe(keyId);
    const file = this.file(keyId);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      unavailable();
    }
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) unavailable();
    try {
      const decoded = Buffer.from(this.safeStorage.decryptString(await readFile(file)), 'base64');
      if (decoded.byteLength !== 32) unavailable();
      return new Uint8Array(decoded);
    } catch {
      unavailable();
    }
  }

  /** Checks only for a legacy blob. It never decrypts or creates credentials. */
  async hasDataKeyFile(keyId: string): Promise<boolean> {
    this.requireId(keyId);
    try {
      const info = await lstat(this.file(keyId));
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) unavailable();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      unavailable();
    }
  }

  async deleteDataKey(keyId: string): Promise<void> {
    this.requireSafe(keyId);
    const file = this.file(keyId);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) unavailable();
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unavailable();
    }
  }

  private requireSafe(keyId: string): void {
    this.requireId(keyId);
    if (!this.safeStorage.isEncryptionAvailable()) unavailable();
  }

  private requireId(keyId: string): void {
    if (!SAFE_ID.test(keyId)) unavailable();
  }

  private file(keyId: string): string {
    return path.join(this.directory, `${keyId}.blob`);
  }

  private async requireDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) unavailable();
    await chmod(this.directory, 0o700);
  }
}
