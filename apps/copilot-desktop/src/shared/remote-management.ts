/** Dependency-free Remote A desktop contracts shared by main/preload/renderer. */

export const REMOTE_ACTIONS = [
  'note.list',
  'note.read',
  'note.create',
  'note.update',
  'note.move_to_trash',
  'todo.list',
  'todo.read',
  'todo.create',
  'todo.update',
  'todo.move_to_trash',
  'command.status',
] as const;

export type RemoteAction = (typeof REMOTE_ACTIONS)[number];
export type RemoteResourceType = 'note' | 'todo';
export type RemoteInitiator = 'user' | 'ai';

export interface RemoteEnvelope {
  schemaVersion: 1;
  messageType: 'command' | 'ack' | 'status_query' | 'status_reply';
  requestId: string;
  sessionId: string;
  commandId: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM';
  payloadCiphertext: string;
  payloadSha256: string;
  controllerSignature: string;
}

export interface RemoteApprovalClaim {
  controllerApprovedAtMs: number;
  controllerApprovalDigest: string;
}

export interface RemoteCommand {
  action: RemoteAction;
  initiatedBy: RemoteInitiator;
  reason: string;
  resource: { type: RemoteResourceType; id: string | null };
  expectedRevision: string | null;
  idempotencyKey: string;
  input: Record<string, unknown>;
  approvalClaim?: RemoteApprovalClaim;
}

export interface RemoteFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface RemoteApprovalRequest {
  /** Main-process generated, 256-bit, single-use approval challenge. */
  approvalToken: string;
  /** SHA-256 of the complete command/envelope approval binding. */
  commandDigest: string;
  /** Exact main-process deadline echoed by the renderer. */
  deadlineMs: number;
  commandId: string;
  controllerId: string;
  initiatedBy: RemoteInitiator;
  action: RemoteAction;
  resource: RemoteCommand['resource'];
  reason: string;
  expiresAtMs: number;
  proposedFields: Record<string, unknown>;
  diff: RemoteFieldDiff[];
  localTruthWarning: string;
  destructiveWarning: string | null;
  approvalScope: 'single-command';
  approveAll: false;
  controllerApprovalVerified: boolean;
}

export type RemoteTerminalCode =
  | 'EXECUTED'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'SESSION_EXPIRED'
  | 'TARGET_OFFLINE'
  | 'TARGET_MISMATCH'
  | 'INVALID_SCHEMA'
  | 'ACTION_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'TTL_INVALID'
  | 'COMMAND_EXPIRED'
  | 'NONCE_REPLAYED'
  | 'SIGNATURE_INVALID'
  | 'DECRYPT_FAILED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  | 'REVISION_CONFLICT'
  | 'DUPLICATE_COMMAND'
  | 'LOCAL_EXECUTION_FAILED'
  | 'ACK_DELIVERY_LOST';

export interface RemoteCommandStatus {
  commandId: string;
  terminalCode: RemoteTerminalCode;
  inputDigest: string;
  preRevision: string | null;
  postRevision: string | null;
}

export interface RemoteExecutionAck {
  commandId: string;
  requestId: string;
  code: RemoteTerminalCode;
  retryable: boolean;
  encryptedPayload?: string;
  /** The only wire-sendable ACK. Absence means fail closed; never send a fallback. */
  wireEnvelope?: RemoteEnvelope;
  status?: RemoteCommandStatus | null;
}

export interface RemoteClientState {
  enabled: boolean;
  ownerConsentAtMs: number | null;
  connection: 'disabled' | 'connecting' | 'online' | 'offline';
  queuedCommands: 0;
  lastErrorCode: RemoteTerminalCode | null;
  pairing?: RemotePairingStatus;
}

export interface RemotePairingStatus {
  configured: boolean;
  revoked: boolean;
  recoveryRequired: boolean;
  pendingRequest: boolean;
  keyEpoch: number | null;
  ownerFingerprint: string | null;
  controllerFingerprint: string | null;
  targetFingerprint: string | null;
  expiresAtMs: number | null;
}

export interface RemoteEnableRequest {
  ownerConsent: boolean;
}

export interface RemoteApprovalResponse {
  approvalToken: string;
  commandDigest: string;
  deadlineMs: number;
  commandId: string;
  decision: 'approve' | 'reject';
}

export interface RemoteApprovalLifecycleEvent {
  approvalToken: string;
  commandId: string;
  state: 'expired' | 'cancelled' | 'resolved';
}

export interface RemoteBridge {
  getState(): Promise<RemoteClientState>;
  enable(request: RemoteEnableRequest): Promise<RemoteClientState>;
  disable(): Promise<RemoteClientState>;
  /** Renderer sends intent only; main owns request bytes and save destination. */
  createPairingRequest(): Promise<RemoteClientState>;
  /** Renderer sends intent only; main owns dialog, path, bytes and verification. */
  importPairing(): Promise<RemoteClientState>;
  revokePairing(): Promise<RemoteClientState>;
  respondApproval(response: RemoteApprovalResponse): Promise<{ accepted: true }>;
  onApprovalRequest(listener: (request: RemoteApprovalRequest) => void): () => void;
  onApprovalLifecycle(listener: (event: RemoteApprovalLifecycleEvent) => void): () => void;
}
