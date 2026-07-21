import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  BackupIntegrationManager,
  InMemoryBackupRepository,
  type BackupCreateRecoveryIntent,
  type BackupRepository,
} from '../../src/main/backup-integration/manager.js';
import { FileBackupRepository } from '../../src/main/backup-integration/repository.js';

const NOW = 1_725_000_000_000;
const DIGEST = 'a'.repeat(64);
const SNAPSHOT_DIGEST = 'b'.repeat(64);
const TARGET = { region: 'ap-shanghai', bucket: 'copilot-123456', ownerHash: 'c'.repeat(64), targetHash: 'd'.repeat(64) };

function intent(
  state: BackupCreateRecoveryIntent['state'],
  snapshot: 'bound' | 'null' = 'null',
): BackupCreateRecoveryIntent {
  return {
    schemaVersion: 1,
    operationId: randomUUID(),
    credentialId: randomUUID(),
    snapshotId: snapshot === 'bound' ? randomUUID() : null,
    requestDigestSha256: DIGEST,
    snapshotDigestSha256: snapshot === 'bound' ? SNAPSHOT_DIGEST : null,
    state,
    createdAtMs: NOW,
    updatedAtMs: NOW,
    attempts: 0,
  };
}

class Credentials {
  readonly values = new Map<string, Uint8Array>();
  deleteCalls = 0;
  async putDataKey(id: string, key: Uint8Array) { this.values.set(id, new Uint8Array(key)); }
  async getDataKey(id: string) { return this.values.get(id) ?? null; }
  async deleteDataKey(id: string) { this.deleteCalls += 1; this.values.delete(id); }
}

function manager(repository: BackupRepository, credentials = new Credentials()) {
  const recovery = {
    set: vi.fn(() => { throw new Error('settings persistence unavailable'); }),
    clear: vi.fn(() => { throw new Error('settings persistence unavailable'); }),
  };
  const settings = { enabled: true, get() { return this.enabled; }, set(value: boolean) { this.enabled = value; } };
  const instance = new BackupIntegrationManager({
    settings,
    consentStore: {
      getReceipt: () => null,
      setReceipt: () => undefined,
      clearReceipt: () => undefined,
      getGeneration: () => 0,
      setGeneration: () => undefined,
    },
    recoveryStore: { get: () => null, set: recovery.set, clear: recovery.clear },
    approval: { request: vi.fn() },
    source: { estimate: vi.fn(), gather: vi.fn() },
    repository,
    credentialStore: credentials,
    presignClient: { request: vi.fn() },
    directAdapter: { put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: vi.fn() },
    target: TARGET,
    now: () => NOW,
  } as never);
  return { instance, credentials, recovery, settings };
}

async function seedFileIntent(root: string, value: unknown) {
  const directory = path.join(root, 'backup-a', 'snapshots');
  const file = path.join(directory, 'create-recovery-intents.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify([value]);
  await writeFile(file, bytes, { mode: 0o600 });
  await chmod(file, 0o600);
  return { file, bytes };
}

describe('r5 state-dependent durable recovery intent semantics', () => {
  it.each([
    ['credential-put-pending', 'bound'],
    ['credential-put-complete', 'bound'],
    ['snapshot-save-pending', 'null'],
    ['snapshot-save-complete', 'null'],
    ['snapshot-discard-pending', 'null'],
    ['snapshot-discard-complete', 'null'],
  ] as const)('rejects impossible %s + %s snapshot bindings in memory', async (state, snapshot) => {
    const repository = new InMemoryBackupRepository();
    await expect(repository.putRecoveryIntent(intent(state, snapshot))).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
    expect(await repository.listRecoveryIntents()).toEqual([]);
  });

  it('rejects mismatched snapshot bindings and reverse timestamps in memory', async () => {
    const repository = new InMemoryBackupRepository();
    const mismatched = { ...intent('credential-delete-pending', 'bound'), snapshotDigestSha256: null };
    await expect(repository.putRecoveryIntent(mismatched)).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
    const reversed = { ...intent('credential-delete-complete', 'null'), updatedAtMs: NOW - 1 };
    await expect(repository.putRecoveryIntent(reversed)).rejects.toMatchObject({ code: 'DOWNLOAD_INTEGRITY_FAILED' });
    expect(await repository.listRecoveryIntents()).toEqual([]);
  });

  it('keeps impossible snapshot-discard-complete + null fail-closed across real file repository restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-r5-invalid-'));
    const impossible = intent('snapshot-discard-complete', 'null');
    const { file, bytes } = await seedFileIntent(root, impossible);
    const credentials = new Credentials();
    credentials.values.set(impossible.credentialId, new Uint8Array([7, 8, 9]));

    for (let restart = 0; restart < 2; restart += 1) {
      const x = manager(new FileBackupRepository(root), credentials);
      await expect(x.instance.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: true });
      await expect(x.instance.prepareEnable(['note-markdown', 'note-metadata'])).rejects.toMatchObject({ code: 'BACKUP_RECOVERY_REQUIRED' });
      expect(x.recovery.set).not.toHaveBeenCalled();
      expect(x.recovery.clear).not.toHaveBeenCalled();
    }

    expect(credentials.deleteCalls).toBe(0);
    expect(credentials.values.has(impossible.credentialId)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['credential-put-pending', 'bound'],
    ['snapshot-save-pending', 'null'],
    ['snapshot-discard-pending', 'null'],
    ['credential-delete-pending', 'mismatch'],
    ['credential-delete-complete', 'reversed-time'],
  ] as const)('does no destructive cleanup for real-file semantic invalidity %s/%s', async (state, kind) => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-r5-matrix-'));
    const base = intent(state, kind === 'null' ? 'null' : 'bound');
    const invalid = kind === 'mismatch'
      ? { ...base, snapshotDigestSha256: null }
      : kind === 'reversed-time'
        ? { ...base, updatedAtMs: NOW - 1 }
        : base;
    const { file, bytes } = await seedFileIntent(root, invalid);
    const credentials = new Credentials();
    credentials.values.set(invalid.credentialId, new Uint8Array([1]));
    const x = manager(new FileBackupRepository(root), credentials);

    await expect(x.instance.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: true });
    expect(credentials.deleteCalls).toBe(0);
    expect(credentials.values.has(invalid.credentialId)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(bytes);
  });

  it.each([
    intent('credential-delete-complete', 'null'),
    intent('credential-delete-complete', 'bound'),
    intent('snapshot-discard-complete', 'bound'),
  ])('accepts safe schema-v1 completed intent compatibility for $state/$snapshotId', async (completed) => {
    const repository = new InMemoryBackupRepository();
    await repository.putRecoveryIntent(completed);
    const x = manager(repository);
    await expect(x.instance.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(x.credentials.deleteCalls).toBe(0);
    expect(await repository.listRecoveryIntents()).toEqual([]);
  });

  it('removes a valid bound snapshot-discard-complete file intent across restart even when recovery cache clear throws', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backup-r5-complete-'));
    const completed = intent('snapshot-discard-complete', 'bound');
    const { file } = await seedFileIntent(root, completed);
    const credentials = new Credentials();
    const first = manager(new FileBackupRepository(root), credentials);

    await expect(first.instance.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(first.recovery.clear).toHaveBeenCalled();
    expect(first.recovery.set).not.toHaveBeenCalled();
    expect(credentials.deleteCalls).toBe(0);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const restarted = manager(new FileBackupRepository(root), credentials);
    await expect(restarted.instance.getState()).resolves.toMatchObject({ enabled: false, recoveryRequired: false });
    expect(credentials.deleteCalls).toBe(0);
  });
});
