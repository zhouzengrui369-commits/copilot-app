import type { BackupErrorCode } from './types.js';

const SAFE_MESSAGES: Readonly<Record<BackupErrorCode, string>> = {
  BACKUP_DISABLED: 'cloud backup is disabled',
  CONSENT_REQUIRED: 'command-scoped consent is required',
  CONSENT_EXPIRED: 'command-scoped consent has expired',
  SCOPE_INVALID: 'backup scope is invalid',
  KEY_UNAVAILABLE: 'backup data key is unavailable',
  ENCRYPT_FAILED: 'backup encryption failed',
  SNAPSHOT_TOO_LARGE: 'backup snapshot exceeds the configured limit',
  PRESIGN_FORBIDDEN: 'presign capability is invalid',
  PRESIGN_EXPIRED: 'presign capability has expired',
  UPLOAD_INTEGRITY_FAILED: 'uploaded ciphertext integrity validation failed',
  DOWNLOAD_INTEGRITY_FAILED: 'downloaded ciphertext integrity validation failed',
  DECRYPT_FAILED: 'backup decryption or validation failed',
  SNAPSHOT_VERSION_UNSUPPORTED: 'backup snapshot version is unsupported',
  RESTORE_CONFLICT: 'backup restore has conflicts',
  RESTORE_APPROVAL_REQUIRED: 'separate restore approval is required',
  COS_UNAVAILABLE: 'ciphertext object storage is unavailable',
  DELETE_APPROVAL_REQUIRED: 'separate delete approval is required',
  DELETE_FAILED: 'ciphertext deletion could not be verified',
};

export class BackupProtocolError extends Error {
  readonly name = 'BackupProtocolError';

  constructor(public readonly code: BackupErrorCode) {
    super(SAFE_MESSAGES[code]);
  }
}

export function failBackup(code: BackupErrorCode): never {
  throw new BackupProtocolError(code);
}

export function isBackupProtocolError(error: unknown): error is BackupProtocolError {
  return error instanceof BackupProtocolError;
}
