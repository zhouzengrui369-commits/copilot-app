import {
  type AssertionType,
  type CanonicalObject,
  type PrivacyClass,
  type ReviewState,
  type TombstoneState,
  validateCanonicalObject,
} from './contract.js';
import { receiptId, toIsoTime } from './identity.js';
import { permissionFingerprint } from './projection.js';

export const SYNC_CONTRACT_VERSION = '1' as const;

export interface SyncEnvelope {
  contract_version: typeof SYNC_CONTRACT_VERSION;
  envelope_id: string;
  object_id: string;
  object_type: CanonicalObject['object_type'];
  namespace: string;
  content_hash: string;
  revision: number;
  privacy_class: PrivacyClass;
  permission_fingerprint: string;
  review_state: ReviewState;
  assertion_type: AssertionType;
  tombstone_state: TombstoneState;
  supersedes: string | null;
}

export type SyncDecisionKind = 'IDENTICAL' | 'STALE' | 'APPLY_SUCCESSOR' | 'CONFLICT';
export type SyncConflictReason =
  | 'IDENTITY_DRIFT'
  | 'SAME_REVISION_DIVERGENCE'
  | 'REVISION_GAP'
  | 'PERMISSION_CHANGE'
  | 'PRIVACY_SENSITIVE'
  | 'REVIEW_SENSITIVE'
  | 'TOMBSTONE_CHANGE'
  | 'ASSERTION_NOT_AUTO_MERGEABLE'
  | 'MISSING_SUCCESSOR_LINEAGE';

export interface SyncDecision {
  decision_id: string;
  object_id: string;
  decision: SyncDecisionKind;
  local_content_hash: string;
  local_revision: number;
  incoming_content_hash: string;
  incoming_revision: number;
  conflict_reasons: readonly SyncConflictReason[];
  physical_write_performed: false;
  decided_at: string;
}

export class SyncContractError extends Error {
  constructor(
    readonly code: 'INVALID_SYNC_ENVELOPE' | 'SYNC_OBJECT_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'SyncContractError';
  }
}

const AUTO_ASSERTIONS = new Set<AssertionType>(['SYSTEM_INFERENCE', 'TEMPORARY_HYPOTHESIS']);

export function createSyncEnvelope(object: CanonicalObject): SyncEnvelope {
  validateCanonicalObject(object);
  const logical = {
    object_id: object.object_id,
    object_type: object.object_type,
    namespace: object.namespace,
    content_hash: object.content_hash,
    revision: object.revision,
    privacy_class: object.privacy_class,
    permission_fingerprint: permissionFingerprint(object),
    review_state: object.review_state,
    assertion_type: object.assertion_type,
    tombstone_state: object.tombstone_state,
    supersedes: object.supersedes,
  };
  return {
    contract_version: SYNC_CONTRACT_VERSION,
    envelope_id: receiptId('sync-envelope', logical),
    ...logical,
  };
}

export function validateSyncEnvelope(value: unknown): asserts value is SyncEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncContractError('INVALID_SYNC_ENVELOPE', 'sync envelope must be an object');
  }
  const record = value as SyncEnvelope;
  if (
    record.contract_version !== SYNC_CONTRACT_VERSION ||
    typeof record.object_id !== 'string' ||
    typeof record.namespace !== 'string' ||
    typeof record.content_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(record.content_hash) ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.permission_fingerprint !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(record.permission_fingerprint) ||
    typeof record.envelope_id !== 'string'
  ) {
    throw new SyncContractError('INVALID_SYNC_ENVELOPE', 'sync envelope structure is invalid');
  }
  const logical = {
    object_id: record.object_id,
    object_type: record.object_type,
    namespace: record.namespace,
    content_hash: record.content_hash,
    revision: record.revision,
    privacy_class: record.privacy_class,
    permission_fingerprint: record.permission_fingerprint,
    review_state: record.review_state,
    assertion_type: record.assertion_type,
    tombstone_state: record.tombstone_state,
    supersedes: record.supersedes,
  };
  if (record.envelope_id !== receiptId('sync-envelope', logical)) {
    throw new SyncContractError('INVALID_SYNC_ENVELOPE', 'sync envelope identity mismatch');
  }
}

function isSensitivePrivacy(value: PrivacyClass): boolean {
  return value === 'D2' || value === 'D3';
}

function safeProposedState(reviewState: ReviewState): boolean {
  return reviewState === 'PROPOSED';
}

function decisionResult(
  local: SyncEnvelope,
  incoming: SyncEnvelope,
  decision: SyncDecisionKind,
  reasons: readonly SyncConflictReason[],
  decidedAt: number | string | Date,
): SyncDecision {
  const normalizedReasons = [...new Set(reasons)].sort();
  const logical = {
    object_id: local.object_id,
    decision,
    local_content_hash: local.content_hash,
    local_revision: local.revision,
    incoming_content_hash: incoming.content_hash,
    incoming_revision: incoming.revision,
    conflict_reasons: normalizedReasons,
  };
  return {
    decision_id: receiptId('sync-decision', logical),
    object_id: local.object_id,
    decision,
    local_content_hash: local.content_hash,
    local_revision: local.revision,
    incoming_content_hash: incoming.content_hash,
    incoming_revision: incoming.revision,
    conflict_reasons: normalizedReasons,
    physical_write_performed: false,
    decided_at: toIsoTime(decidedAt),
  };
}

export function classifySync(
  local: SyncEnvelope,
  incoming: SyncEnvelope,
  decidedAt: number | string | Date = new Date(),
): SyncDecision {
  validateSyncEnvelope(local);
  validateSyncEnvelope(incoming);
  if (
    local.object_id !== incoming.object_id ||
    local.object_type !== incoming.object_type ||
    local.namespace !== incoming.namespace
  ) {
    throw new SyncContractError('SYNC_OBJECT_MISMATCH', 'sync envelopes do not describe the same canonical object');
  }

  if (local.revision === incoming.revision && local.content_hash === incoming.content_hash) {
    if (
      local.permission_fingerprint !== incoming.permission_fingerprint ||
      local.privacy_class !== incoming.privacy_class ||
      local.review_state !== incoming.review_state ||
      local.assertion_type !== incoming.assertion_type ||
      local.tombstone_state !== incoming.tombstone_state ||
      local.supersedes !== incoming.supersedes
    ) {
      return decisionResult(local, incoming, 'CONFLICT', ['IDENTITY_DRIFT'], decidedAt);
    }
    return decisionResult(local, incoming, 'IDENTICAL', [], decidedAt);
  }

  if (incoming.revision < local.revision) {
    return decisionResult(local, incoming, 'STALE', [], decidedAt);
  }

  if (incoming.revision === local.revision) {
    return decisionResult(local, incoming, 'CONFLICT', ['SAME_REVISION_DIVERGENCE'], decidedAt);
  }

  const reasons: SyncConflictReason[] = [];
  if (incoming.revision !== local.revision + 1) reasons.push('REVISION_GAP');
  if (local.permission_fingerprint !== incoming.permission_fingerprint) reasons.push('PERMISSION_CHANGE');
  if (isSensitivePrivacy(local.privacy_class) || isSensitivePrivacy(incoming.privacy_class)) {
    reasons.push('PRIVACY_SENSITIVE');
  }
  if (!safeProposedState(local.review_state) || !safeProposedState(incoming.review_state)) {
    reasons.push('REVIEW_SENSITIVE');
  }
  if (local.tombstone_state !== incoming.tombstone_state) reasons.push('TOMBSTONE_CHANGE');
  if (!AUTO_ASSERTIONS.has(local.assertion_type) || !AUTO_ASSERTIONS.has(incoming.assertion_type)) {
    reasons.push('ASSERTION_NOT_AUTO_MERGEABLE');
  }
  if (incoming.supersedes !== local.object_id) reasons.push('MISSING_SUCCESSOR_LINEAGE');

  if (reasons.length > 0) {
    return decisionResult(local, incoming, 'CONFLICT', reasons, decidedAt);
  }
  return decisionResult(local, incoming, 'APPLY_SUCCESSOR', [], decidedAt);
}
