export const SHARED_ENGINE_SCHEMA_VERSION = '0.3.0-draft' as const;

export type SharedObjectType = 'Source' | 'Knowledge' | 'Entity' | 'Relation';

export type AssertionType =
  | 'SOURCE_FACT'
  | 'USER_DECLARED_FACT'
  | 'DIRECT_OBSERVATION'
  | 'SYSTEM_INFERENCE'
  | 'TEMPORARY_HYPOTHESIS'
  | 'DISPUTED'
  | 'STALE'
  | 'SUPERSEDED';

export type ReviewState = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'DISPUTED' | 'EXPIRED';
export type PrivacyClass = 'D0' | 'D1' | 'D2' | 'D3';
export type TombstoneState = 'ACTIVE' | 'TOMBSTONED';
export type CloudEgressPolicy = 'DENY' | 'ASK_EACH_TIME' | 'ALLOW_SCOPED';

export interface PermissionScope {
  purposes: readonly string[];
  allowed_consumers: readonly string[];
  cloud_egress: CloudEgressPolicy;
}

export interface CanonicalObject<TPayload = unknown> {
  object_id: string;
  object_type: SharedObjectType;
  namespace: string;
  schema_version: typeof SHARED_ENGINE_SCHEMA_VERSION;
  source_refs: readonly string[];
  content_hash: string;
  observed_at: string;
  valid_from: string | null;
  valid_to: string | null;
  assertion_type: AssertionType;
  confidence: number | null;
  review_state: ReviewState;
  privacy_class: PrivacyClass;
  permission_scope: PermissionScope;
  supersedes: string | null;
  tombstone_state: TombstoneState;
  created_by: string;
  updated_by: string;
  revision: number;
  payload: TPayload;
}

export interface SourcePayload {
  source_kind: 'copilot_note';
  source_key: string;
  source_revision: string;
  content_ref: string;
  title: string;
}

export interface KnowledgePayload {
  title: string;
  kind: string | null;
  state: string | null;
  tags: readonly string[];
  related_source_keys: readonly string[];
  content_ref: string;
}

export interface EntityPayload {
  entity_kind: string;
  name: string;
  aliases: readonly string[];
  summary: string | null;
}

export interface RelationPayload {
  from_object_id: string;
  to_object_id: string;
  predicate: string;
  weight: number | null;
}

export interface RevisionState {
  object_id: string;
  content_hash: string;
  revision: number;
}

export type MappingOperation = 'MAPPED' | 'UNCHANGED' | 'REVISED';

export interface MappingReceipt {
  receipt_id: string;
  object_id: string;
  operation: MappingOperation;
  previous_content_hash: string | null;
  next_content_hash: string;
  previous_revision: number | null;
  next_revision: number;
  mapped_at: string;
  adapter_id: 'copilot-shared-engine-c1';
  adapter_version: '1';
}

export interface ReadCapabilityRequest {
  capability_id: string;
  namespace: string;
  purpose: string;
  privacy_ceiling: 'D0' | 'D1';
  allowed_object_types?: readonly SharedObjectType[];
}

export type ReadDenyReason =
  | 'NAMESPACE_DENIED'
  | 'PURPOSE_DENIED'
  | 'CONSUMER_DENIED'
  | 'PRIVACY_DENIED'
  | 'OBJECT_TYPE_DENIED';

export interface ReadDecisionReceipt {
  receipt_id: string;
  object_id: string;
  capability_id: string;
  purpose: string;
  decision: 'ALLOW' | 'DENY';
  reason: 'POLICY_MATCH' | ReadDenyReason;
  decided_at: string;
}

export interface WriteProposal<TPayload = unknown> {
  proposal_id: string;
  state: 'WRITE_PROPOSAL';
  capability_id: string;
  proposed_object: CanonicalObject<TPayload>;
  reason: string;
  proposed_at: string;
}

export class SharedEngineContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CANONICAL_OBJECT'
      | 'UNSUPPORTED_SCHEMA_VERSION'
      | 'INVALID_PERMISSION_SCOPE',
    message: string,
  ) {
    super(message);
    this.name = 'SharedEngineContractError';
  }
}

const OBJECT_TYPES = new Set<SharedObjectType>(['Source', 'Knowledge', 'Entity', 'Relation']);
const ASSERTION_TYPES = new Set<AssertionType>([
  'SOURCE_FACT',
  'USER_DECLARED_FACT',
  'DIRECT_OBSERVATION',
  'SYSTEM_INFERENCE',
  'TEMPORARY_HYPOTHESIS',
  'DISPUTED',
  'STALE',
  'SUPERSEDED',
]);
const REVIEW_STATES = new Set<ReviewState>(['PROPOSED', 'ACCEPTED', 'REJECTED', 'DISPUTED', 'EXPIRED']);
const PRIVACY_CLASSES = new Set<PrivacyClass>(['D0', 'D1', 'D2', 'D3']);
const TOMBSTONE_STATES = new Set<TombstoneState>(['ACTIVE', 'TOMBSTONED']);
const CLOUD_EGRESS = new Set<CloudEgressPolicy>(['DENY', 'ASK_EACH_TIME', 'ALLOW_SCOPED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function validateCanonicalObject(value: unknown): asserts value is CanonicalObject {
  if (!isRecord(value)) {
    throw new SharedEngineContractError('INVALID_CANONICAL_OBJECT', 'canonical object must be an object');
  }

  if (value.schema_version !== SHARED_ENGINE_SCHEMA_VERSION) {
    throw new SharedEngineContractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `unsupported schema version: ${String(value.schema_version)}`,
    );
  }

  if (
    typeof value.object_id !== 'string' ||
    !value.object_id.startsWith('ske:0.3:') ||
    !OBJECT_TYPES.has(value.object_type as SharedObjectType) ||
    typeof value.namespace !== 'string' ||
    value.namespace.length === 0 ||
    !isStringArray(value.source_refs) ||
    typeof value.content_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.content_hash) ||
    typeof value.observed_at !== 'string' ||
    !ASSERTION_TYPES.has(value.assertion_type as AssertionType) ||
    !REVIEW_STATES.has(value.review_state as ReviewState) ||
    !PRIVACY_CLASSES.has(value.privacy_class as PrivacyClass) ||
    !TOMBSTONE_STATES.has(value.tombstone_state as TombstoneState) ||
    typeof value.created_by !== 'string' ||
    typeof value.updated_by !== 'string' ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    throw new SharedEngineContractError('INVALID_CANONICAL_OBJECT', 'canonical object envelope is invalid');
  }

  if (value.confidence !== null && (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)) {
    throw new SharedEngineContractError('INVALID_CANONICAL_OBJECT', 'confidence must be null or within 0..1');
  }

  if (!isRecord(value.permission_scope)) {
    throw new SharedEngineContractError('INVALID_PERMISSION_SCOPE', 'permission_scope must be an object');
  }

  if (
    !isStringArray(value.permission_scope.purposes) ||
    !isStringArray(value.permission_scope.allowed_consumers) ||
    !CLOUD_EGRESS.has(value.permission_scope.cloud_egress as CloudEgressPolicy)
  ) {
    throw new SharedEngineContractError('INVALID_PERMISSION_SCOPE', 'permission_scope is invalid');
  }
}