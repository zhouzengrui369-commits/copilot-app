import type { BackupManagementRuntimeBridge } from '../../shared/backup-management.js';
import { IPC_CHANNELS } from '../../shared/ipc-channels.js';
import { BackupProtocolError } from '../backup/index.js';
import type { BackupEnableRequest } from '../../shared/backup-management.js';
import type { BackupApprovalResponse } from '../../shared/backup-management.js';
import type { BackupRestoreApplyRequest } from '../../shared/backup-management.js';
import type { BackupScope } from '../backup/index.js';

interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): unknown;
}

export function registerBackupIpc(
  ipc: IpcRegistrar,
  getRuntime: () => BackupManagementRuntimeBridge,
  isTrusted: (event: unknown) => boolean,
  respondApproval?: (response: BackupApprovalResponse) => { accepted: true },
): void {
  const handle = (channel: string, action: (runtime: BackupManagementRuntimeBridge, payload: any) => unknown) => {
    ipc.handle(channel, (event, payload) => {
      if (!isTrusted(event)) throw new BackupProtocolError('PRESIGN_FORBIDDEN');
      return action(getRuntime(), payload);
    });
  };
  handle(IPC_CHANNELS.BACKUP_GET_STATE, (runtime) => runtime.getState());
  handle(IPC_CHANNELS.BACKUP_PREPARE_ENABLE, (runtime, payload) => runtime.prepareEnable(parseScopes(payload)));
  handle(IPC_CHANNELS.BACKUP_ENABLE, (runtime, payload) => runtime.enable(parseEnable(payload)));
  handle(IPC_CHANNELS.BACKUP_DISABLE, (runtime) => runtime.disable());
  handle(IPC_CHANNELS.BACKUP_CREATE, (runtime, payload) => runtime.create(parseCreate(payload)));
  handle(IPC_CHANNELS.BACKUP_UPLOAD, (runtime, payload) => runtime.upload(parseSnapshot(payload)));
  handle(IPC_CHANNELS.BACKUP_DOWNLOAD_VERIFY, (runtime, payload) => runtime.downloadVerify(parseSnapshot(payload)));
  handle(IPC_CHANNELS.BACKUP_RESTORE_PREVIEW, (runtime, payload) => runtime.restorePreview(parseSnapshot(payload)));
  handle(IPC_CHANNELS.BACKUP_RESTORE_APPLY, (runtime, payload) => runtime.restoreApply(parseRestoreApply(payload)));
  handle(IPC_CHANNELS.BACKUP_DELETE, (runtime, payload) => runtime.deleteRemote(parseDelete(payload)));
  ipc.handle(IPC_CHANNELS.BACKUP_APPROVAL_RESPOND, (event, payload) => {
    if (!isTrusted(event) || !respondApproval) forbidden();
    return respondApproval(parseApprovalResponse(payload));
  });
}

const ENABLE_KEYS = [
  'consentId', 'region', 'bucket', 'selectedScopes', 'estimatedEncryptedBytes', 'counts',
  'retentionAndDelete', 'keyLoss', 'cloudCannotDecrypt', 'exactFirstUpload',
  'issuedAtMs', 'expiresAtMs', 'retentionDeleteAcknowledged',
  'keyLossAcknowledged', 'cloudCannotDecryptAcknowledged', 'firstUploadAcknowledged',
] as const;

function parseEnable(value: unknown): BackupEnableRequest {
  const record = exactRecord(value, ENABLE_KEYS);
  if (
    typeof record.consentId !== 'string'
    || typeof record.region !== 'string'
    || typeof record.bucket !== 'string'
    || !Array.isArray(record.selectedScopes)
    || typeof record.counts !== 'object'
    || typeof record.retentionAndDelete !== 'string'
    || typeof record.keyLoss !== 'string'
    || typeof record.cloudCannotDecrypt !== 'string'
    || typeof record.exactFirstUpload !== 'string'
    || !Number.isSafeInteger(record.estimatedEncryptedBytes)
    || !Number.isSafeInteger(record.issuedAtMs)
    || !Number.isSafeInteger(record.expiresAtMs)
    || typeof record.retentionDeleteAcknowledged !== 'boolean'
    || typeof record.keyLossAcknowledged !== 'boolean'
    || typeof record.cloudCannotDecryptAcknowledged !== 'boolean'
    || typeof record.firstUploadAcknowledged !== 'boolean'
  ) forbidden();
  return record as unknown as BackupEnableRequest;
}

function parseCreate(value: unknown): { selectedScopes: BackupScope[] } {
  const record = exactRecord(value, ['selectedScopes']);
  return { selectedScopes: parseScopes(record.selectedScopes) };
}

function parseSnapshot(value: unknown): { snapshotId: string } {
  const record = exactRecord(value, ['snapshotId']);
  if (typeof record.snapshotId !== 'string') forbidden();
  return { snapshotId: record.snapshotId };
}

function parseRestoreApply(value: unknown): BackupRestoreApplyRequest {
  const record = exactRecord(value, ['generation', 'previewDigest', 'selectedScopes', 'snapshotId']);
  if (
    typeof record.snapshotId !== 'string'
    || typeof record.previewDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.previewDigest)
    || !Number.isSafeInteger(record.generation)
    || Number(record.generation) < 0
  ) forbidden();
  return {
    snapshotId: record.snapshotId,
    previewDigest: record.previewDigest,
    generation: Number(record.generation),
    selectedScopes: parseScopes(record.selectedScopes),
  };
}

function parseDelete(value: unknown): { snapshotId: string; confirmSnapshotId: string } {
  const record = exactRecord(value, ['confirmSnapshotId', 'snapshotId']);
  if (typeof record.snapshotId !== 'string' || typeof record.confirmSnapshotId !== 'string') forbidden();
  return { snapshotId: record.snapshotId, confirmSnapshotId: record.confirmSnapshotId };
}

function parseApprovalResponse(value: unknown): BackupApprovalResponse {
  const record = exactRecord(value, ['commandDigest', 'commandId', 'deadlineMs', 'decision']);
  if (
    typeof record.commandId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.commandId)
    || typeof record.commandDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.commandDigest)
    || !Number.isSafeInteger(record.deadlineMs)
    || (record.decision !== 'approve' && record.decision !== 'reject')
  ) forbidden();
  return record as unknown as BackupApprovalResponse;
}

function parseScopes(value: unknown): BackupScope[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) forbidden();
  return [...value] as BackupScope[];
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) forbidden();
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) forbidden();
  return value as Record<string, unknown>;
}

function forbidden(): never { throw new BackupProtocolError('PRESIGN_FORBIDDEN'); }
