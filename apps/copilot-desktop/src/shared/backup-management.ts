import type { BackupScope } from '../main/backup/types.js';

export type BackupCatalogStatus = 'local' | 'uploaded' | 'verified' | 'remote-deleted';

export interface BackupCatalogEntry {
  snapshotId: string;
  sha256: string;
  bytes: number;
  createdAtMs: number;
  status: BackupCatalogStatus;
}

export interface BackupEnableDraft {
  consentId: string;
  region: string;
  bucket: string;
  selectedScopes: BackupScope[];
  estimatedEncryptedBytes: number;
  counts: Record<string, number>;
  retentionAndDelete: string;
  keyLoss: string;
  cloudCannotDecrypt: string;
  exactFirstUpload: 'Create one encrypted local snapshot; upload only after a separate Upload click.';
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface BackupEnableRequest extends BackupEnableDraft {
  retentionDeleteAcknowledged: boolean;
  keyLossAcknowledged: boolean;
  cloudCannotDecryptAcknowledged: boolean;
  firstUploadAcknowledged: boolean;
}

/** Main-process persisted, non-secret owner-consent receipt. Never sent through settings IPC. */
export interface BackupConsentReceipt extends BackupEnableDraft {
  schemaVersion: 1;
  generation: number;
  ownerHash: string;
  targetHash: string;
  bindingSha256: string;
}

/** Main-only, redacted quarantine marker. It contains no key, content, URL or local path. */
export interface BackupRecoveryMarker {
  schemaVersion: 1;
  markerId: string;
  snapshotId: string;
  reason: 'CREATE_ROLLBACK_INCOMPLETE';
  phase: 'credential-cleanup' | 'snapshot-discard';
  createdAtMs: number;
  attempts: number;
}

export interface BackupManagementState {
  enabled: boolean;
  configured: boolean;
  region: string;
  platformProtection:
    | 'macOS Keychain (native; legacy safeStorage migration only)'
    | 'Windows Credential Manager (native; legacy safeStorage migration only)'
    | 'macOS Keychain via Electron safeStorage'
    | 'Windows DPAPI via Electron safeStorage'
    | 'Electron safeStorage'
    | 'OS credential store not configured';
  catalog: BackupCatalogEntry[];
  allowedScopes: BackupScope[];
  activeOperation: string | null;
  schedulingAvailable: false;
  replaceCurrentAvailable: false;
  recoveryRequired: boolean;
}

export type BackupApprovalAction = 'enable' | 'create' | 'upload' | 'download-verify' | 'restore-preview' | 'restore-apply' | 'delete';

/** Sanitized one-shot prompt. Main retains all authority and operation state. */
export interface BackupApprovalRequest {
  commandId: string;
  commandDigest: string;
  issuedAtMs: number;
  deadlineMs: number;
  action: BackupApprovalAction;
  scopes: BackupScope[];
  objectId: string;
  bytes: number;
  sha256: string;
  /** Present for manager-issued commands; restore-apply requires an exact value. */
  generation?: number;
  /** Present only for restore-apply and bound into the one-shot command digest. */
  previewDigest?: string | null;
  destructiveWarning: string | null;
}

export interface BackupApprovalResponse {
  commandId: string;
  commandDigest: string;
  deadlineMs: number;
  decision: 'approve' | 'reject';
}

export interface BackupApprovalLifecycleEvent {
  commandId: string;
  state: 'resolved' | 'expired' | 'cancelled';
}

export interface BackupManagementRuntimeBridge {
  getState(): Promise<BackupManagementState>;
  prepareEnable(scopes: BackupScope[]): Promise<BackupEnableDraft>;
  enable(request: BackupEnableRequest): Promise<BackupManagementState>;
  disable(): Promise<BackupManagementState>;
  create(request: { selectedScopes: BackupScope[] }): Promise<BackupCatalogEntry>;
  upload(request: { snapshotId: string }): Promise<BackupCatalogEntry>;
  downloadVerify(request: { snapshotId: string }): Promise<BackupCatalogEntry>;
  restorePreview(request: { snapshotId: string }): Promise<BackupRestorePreview>;
  restoreApply(request: BackupRestoreApplyRequest): Promise<BackupRestoreImportResult>;
  deleteRemote(request: { snapshotId: string; confirmSnapshotId: string }): Promise<BackupCatalogEntry>;
}

export interface BackupRestorePreview {
  snapshotId: string;
  files: number;
  records: number;
  conflicts: string[];
  mode: 'import-as-copy';
  selectedScopes: BackupScope[];
  previewDigest: string;
  generation: number;
  replaceCurrentAvailable: false;
}

export interface BackupRestoreApplyRequest {
  snapshotId: string;
  selectedScopes: BackupScope[];
  previewDigest: string;
  generation: number;
}

export interface BackupRestoreImportResult {
  snapshotId: string;
  previewDigest: string;
  importedNotes: number;
  importedTodos: number;
  importNamespace: string;
  conflictCount: number;
  rollbackStatus: 'not-required';
  replaceCurrentAvailable: false;
}

export interface BackupManagementBridge extends BackupManagementRuntimeBridge {
  respondApproval(response: BackupApprovalResponse): Promise<{ accepted: true }>;
  onApprovalRequest(listener: (request: BackupApprovalRequest) => void): () => void;
  onApprovalLifecycle(listener: (event: BackupApprovalLifecycleEvent) => void): () => void;
}
