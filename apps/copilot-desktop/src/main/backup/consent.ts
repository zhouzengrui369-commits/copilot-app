import { failBackup } from './errors.js';
import type { BackupCommand, BackupCommandAuthorization, BackupErrorCode } from './types.js';

export function requireCommandConsent(
  authorization: BackupCommandAuthorization,
  command: BackupCommand,
  resourceDigest: string,
  snapshotId: string | undefined,
  defaultCode: BackupErrorCode = 'CONSENT_REQUIRED',
): void {
  if (authorization.backupEnabled !== true) failBackup('BACKUP_DISABLED');
  const consent = authorization.consent;
  if (!consent || consent.approved !== true || consent.command !== command || !consent.requestId || consent.resourceDigest !== resourceDigest) {
    failBackup(defaultCode);
  }
  if (snapshotId !== undefined && consent.snapshotId !== snapshotId) failBackup(defaultCode);
  const now = authorization.nowMs ?? Date.now();
  if (!Number.isFinite(consent.approvedAtMs) || !Number.isFinite(consent.expiresAtMs) || consent.approvedAtMs > now || consent.expiresAtMs <= now) {
    failBackup('CONSENT_EXPIRED');
  }
}
