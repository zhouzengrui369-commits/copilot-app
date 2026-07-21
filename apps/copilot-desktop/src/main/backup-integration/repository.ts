import { randomUUID, createHash } from 'node:crypto';
import { renameSync } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { BackupProtocolError, type CreatedBackup } from '../backup/index.js';
import type { BackupCatalogEntry, BackupCatalogStatus } from '../../shared/backup-management.js';
import {
  validBackupCreateRecoveryIntent,
  validBackupRestoreImportIntent,
  type BackupCreateRecoveryIntent,
  type BackupRepository,
  type BackupRestoreImportIntent,
} from './manager.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RestoreIntentDurabilityOperation = 'publish' | 'clear';
export type RestoreIntentDurabilityBoundary = 'temporary-opened' | 'temporary-synced' | 'renamed' | 'directory-synced';

export class FileBackupRepository implements BackupRepository {
  private readonly root: string;
  private readonly catalogFile: string;
  private readonly recoveryFile: string;
  private readonly restoreImportFile: string;

  constructor(
    userDataPath: string,
    private readonly restoreDurabilityFault?: (
      operation: RestoreIntentDurabilityOperation,
      boundary: RestoreIntentDurabilityBoundary,
    ) => void,
  ) {
    this.root = path.join(userDataPath, 'backup-a', 'snapshots');
    this.catalogFile = path.join(this.root, 'catalog.json');
    this.recoveryFile = path.join(this.root, 'create-recovery-intents.json');
    this.restoreImportFile = path.join(this.root, 'restore-import-intents.json');
  }

  async list(): Promise<BackupCatalogEntry[]> {
    return this.readCatalog();
  }

  async save(created: CreatedBackup, nowMs: number): Promise<BackupCatalogEntry> {
    await this.ensureRoot();
    const file = this.snapshotFile(created.snapshotId);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(created.container);
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(file, 0o600);
    } catch {
      await handle?.close().catch(() => undefined);
      throw new BackupProtocolError('ENCRYPT_FAILED');
    }
    const entry: BackupCatalogEntry = { snapshotId: created.snapshotId, sha256: created.containerSha256, bytes: created.containerBytes, createdAtMs: nowMs, status: 'local' };
    const catalog = await this.readCatalog();
    catalog.push(entry);
    await this.writeCatalog(catalog);
    return { ...entry };
  }

  async load(snapshotId: string) {
    const catalog = await this.readCatalog();
    const entry = catalog.find((item) => item.snapshotId === snapshotId);
    if (!entry) return null;
    const file = this.snapshotFile(snapshotId);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size !== entry.bytes) throw new Error('unsafe');
      const container = new Uint8Array(await readFile(file));
      if (createHash('sha256').update(container).digest('hex') !== entry.sha256) throw new Error('hash');
      return { catalog: { ...entry }, container };
    } catch {
      throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    }
  }

  async update(snapshotId: string, status: BackupCatalogStatus, beforeCommit?: () => void): Promise<BackupCatalogEntry> {
    const catalog = await this.readCatalog();
    const index = catalog.findIndex((entry) => entry.snapshotId === snapshotId);
    if (index < 0) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    catalog[index] = { ...catalog[index]!, status };
    await this.writeCatalog(catalog, beforeCommit);
    return { ...catalog[index]! };
  }

  async discard(snapshotId: string): Promise<void> {
    const file = this.snapshotFile(snapshotId);
    const catalog = await this.readCatalog();
    const next = catalog.filter((entry) => entry.snapshotId !== snapshotId);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe');
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new BackupProtocolError('ENCRYPT_FAILED');
    }
    if (next.length !== catalog.length) await this.writeCatalog(next);
  }

  async listRecoveryIntents(): Promise<BackupCreateRecoveryIntent[]> {
    return this.readRecoveryIntents();
  }

  async putRecoveryIntent(intent: BackupCreateRecoveryIntent): Promise<void> {
    if (!validBackupCreateRecoveryIntent(intent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    const intents = await this.readRecoveryIntents();
    const index = intents.findIndex((candidate) => candidate.operationId === intent.operationId);
    if (index < 0) intents.push(structuredClone(intent));
    else intents[index] = structuredClone(intent);
    await this.writeRecoveryIntents(intents);
  }

  async removeRecoveryIntent(operationId: string): Promise<void> {
    if (!UUID.test(operationId)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    const intents = await this.readRecoveryIntents();
    await this.writeRecoveryIntents(intents.filter((intent) => intent.operationId !== operationId));
  }

  async listRestoreImportIntents(): Promise<BackupRestoreImportIntent[]> {
    return this.readRestoreImportIntents();
  }

  async putRestoreImportIntent(intent: BackupRestoreImportIntent): Promise<void> {
    if (!validBackupRestoreImportIntent(intent)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    const intents = await this.readRestoreImportIntents();
    const index = intents.findIndex((candidate) => candidate.operationId === intent.operationId);
    if (index < 0) intents.push(structuredClone(intent));
    else intents[index] = structuredClone(intent);
    await this.writeRestoreImportIntents(intents, 'publish');
  }

  async removeRestoreImportIntent(operationId: string): Promise<void> {
    if (!UUID.test(operationId)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    const intents = await this.readRestoreImportIntents();
    await this.writeRestoreImportIntents(intents.filter((intent) => intent.operationId !== operationId), 'clear');
  }

  private snapshotFile(snapshotId: string): string {
    if (!UUID.test(snapshotId)) throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    return path.join(this.root, `${snapshotId}.cbackup`);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new BackupProtocolError('ENCRYPT_FAILED');
    await chmod(this.root, 0o700);
  }

  private async readCatalog(): Promise<BackupCatalogEntry[]> {
    try {
      const info = await lstat(this.catalogFile);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('unsafe');
      const value = JSON.parse(await readFile(this.catalogFile, 'utf8')) as unknown;
      if (!Array.isArray(value) || !value.every(validEntry)) throw new Error('schema');
      return value.map((entry) => ({ ...entry }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    }
  }

  private async writeCatalog(catalog: BackupCatalogEntry[], beforeCommit?: () => void): Promise<void> {
    await this.ensureRoot();
    const temporary = path.join(this.root, `.catalog.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(catalog), { flag: 'wx', mode: 0o600 });
      // Guard + atomic publication contain no await: disable can linearize
      // before this section, or waits until the already-started commit wins.
      beforeCommit?.();
      renameSync(temporary, this.catalogFile);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async readRecoveryIntents(): Promise<BackupCreateRecoveryIntent[]> {
    try {
      const info = await lstat(this.recoveryFile);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('unsafe');
      const value = JSON.parse(await readFile(this.recoveryFile, 'utf8')) as unknown;
      if (!Array.isArray(value) || !value.every(validBackupCreateRecoveryIntent)) throw new Error('schema');
      return value.map((intent) => structuredClone(intent));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    }
  }

  private async writeRecoveryIntents(intents: BackupCreateRecoveryIntent[]): Promise<void> {
    await this.ensureRoot();
    const temporary = path.join(this.root, `.create-recovery.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(intents), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.recoveryFile);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async readRestoreImportIntents(): Promise<BackupRestoreImportIntent[]> {
    try {
      const info = await lstat(this.restoreImportFile);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('unsafe');
      const value = JSON.parse(await readFile(this.restoreImportFile, 'utf8')) as unknown;
      if (!Array.isArray(value) || !value.every(validBackupRestoreImportIntent)) throw new Error('schema');
      return value.map((intent) => structuredClone(intent));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    }
  }

  private async writeRestoreImportIntents(
    intents: BackupRestoreImportIntent[],
    operation: RestoreIntentDurabilityOperation,
  ): Promise<void> {
    await this.ensureRoot();
    const temporary = path.join(this.root, `.restore-import.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporary, 'wx', 0o600);
      this.restoreDurabilityFault?.(operation, 'temporary-opened');
      await handle.writeFile(JSON.stringify(intents));
      await handle.sync();
      this.restoreDurabilityFault?.(operation, 'temporary-synced');
      await handle.close();
      handle = null;
      renameSync(temporary, this.restoreImportFile);
      this.restoreDurabilityFault?.(operation, 'renamed');
      const directory = await open(this.root, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.restoreDurabilityFault?.(operation, 'directory-synced');
    } catch {
      await handle?.close().catch(() => undefined);
      throw new BackupProtocolError('DOWNLOAD_INTEGRITY_FAILED');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

function validEntry(value: unknown): value is BackupCatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join('|') === ['bytes', 'createdAtMs', 'sha256', 'snapshotId', 'status'].sort().join('|')
    && typeof item.snapshotId === 'string' && UUID.test(item.snapshotId)
    && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
    && Number.isSafeInteger(item.bytes) && Number(item.bytes) > 0
    && Number.isSafeInteger(item.createdAtMs) && Number(item.createdAtMs) >= 0
    && ['local', 'uploaded', 'verified', 'remote-deleted'].includes(String(item.status));
}
