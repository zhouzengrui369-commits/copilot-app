export {
  SHARED_ENGINE_SCHEMA_VERSION,
  SharedEngineContractError,
  validateCanonicalObject,
} from './contract.js';

export type {
  AssertionType,
  CanonicalObject,
  CloudEgressPolicy,
  EntityPayload,
  KnowledgePayload,
  MappingOperation,
  MappingReceipt,
  PermissionScope,
  PrivacyClass,
  ReadCapabilityRequest,
  ReadDecisionReceipt,
  ReadDenyReason,
  RelationPayload,
  RevisionState,
  ReviewState,
  SharedObjectType,
  SourcePayload,
  TombstoneState,
  WriteProposal,
} from './contract.js';

export {
  SharedEngineIdentityError,
  contentHash,
  objectId,
  receiptId,
  sha256Hex,
  stableSerialize,
  toIsoTime,
} from './identity.js';

export {
  entityObjectId,
  knowledgeObjectIdForNote,
  mapLegacyEntity,
  mapLegacyNote,
  mapLegacyRelation,
  sourceObjectIdForNote,
} from './adapters.js';

export type {
  C1AdapterContext,
  DerivedObjectOptions,
  LegacyEntitySnapshot,
  LegacyNoteSnapshot,
  LegacyRelationSnapshot,
  MappedObject,
  NoteCanonicalMapping,
  PreviousNoteMapping,
} from './adapters.js';

export { authorizeCanonicalRead, filterCanonicalReads } from './policy.js';
export type { ReadDecision } from './policy.js';

export { createWriteProposal } from './write-proposal.js';
export type { CreateWriteProposalInput } from './write-proposal.js';

export { IngestionContractError, recordIngestionAttempt } from './ingestion.js';
export type {
  IngestionAttemptInput,
  IngestionFailure,
  IngestionPreviousState,
  IngestionReceipt,
  IngestionRequestedOutcome,
  IngestionResult,
  IngestionStatus,
} from './ingestion.js';

export { CompilationContractError, recordCompilation } from './compiler.js';
export type {
  CompilationFailure,
  CompilationInput,
  CompilationOutcome,
  CompilationReceipt,
  CompilationRecipe,
  CompilationResult,
} from './compiler.js';

export {
  ReviewContractError,
  createReviewQueueItem,
  createUserCorrection,
  decideReview,
} from './review.js';
export type {
  CorrectionReceipt,
  ReviewActorKind,
  ReviewAuthority,
  ReviewDecision,
  ReviewDecisionInput,
  ReviewDecisionReceipt,
  ReviewDecisionResult,
  ReviewQueueItem,
  UserCorrectionInput,
  UserCorrectionResult,
} from './review.js';

export { ConflictContractError, createConflict, resolveConflict } from './conflict.js';
export type {
  ConflictKind,
  ConflictObjectRef,
  ConflictRecord,
  ConflictResolutionAuthority,
  ConflictResolutionReceipt,
  ConflictResolutionStrategy,
  ResolveConflictInput,
  ResolveConflictResult,
  SupersessionReceipt,
} from './conflict.js';

export {
  ProjectionContractError,
  checkProjectionFreshness,
  createProjection,
  permissionFingerprint,
  validateProjectionRecord,
} from './projection.js';
export type {
  ProjectionFreshness,
  ProjectionKind,
  ProjectionRecipe,
  ProjectionRecord,
  ProjectionStaleReason,
} from './projection.js';

export {
  RetrievalContractError,
  buildGroundedContext,
  rankAuthorizedProjectionHits,
} from './retrieval.js';
export type {
  AuthorizedProjectionEvidence,
  DeniedRetrievalAudit,
  GroundedContext,
  GroundedContextItem,
  RankedCanonicalResult,
  RetrievalHit,
  RetrievalKind,
  RetrievalReceipt,
  StaleRetrievalAudit,
  UnifiedRetrievalResult,
} from './retrieval.js';

export {
  AGENT_API_CONTRACT_VERSION,
  CAPABILITY_MANIFEST_VERSION,
  CapabilityContractError,
  assertCapabilityActive,
  createCapabilityManifest,
  negotiateCapability,
  validateCapabilityManifest,
  validateCapabilitySession,
} from './capability.js';
export type {
  AgentWriteMode,
  CapabilityManifest,
  CapabilityManifestInput,
  CapabilitySession,
} from './capability.js';

export {
  AgentApiContractError,
  readCanonicalObjects,
  retrieveForAgent,
  submitAgentWriteProposal,
} from './agent-api.js';
export type {
  AgentApiAction,
  AgentApiDecision,
  AgentApiReceipt,
  AgentObjectDenyAudit,
  AgentObjectDenyReason,
  AgentRetrievalInput,
  AgentRetrievalResult,
  AgentWriteProposalInput,
  AgentWriteProposalResult,
  ReadObjectsInput,
  ReadObjectsResult,
} from './agent-api.js';

export {
  AGENT_CONFORMANCE_FIXTURE_VERSION,
  buildAgentConformanceFixture,
} from './agent-conformance.js';
export type { AgentConformanceFixture } from './agent-conformance.js';

export {
  PORTABILITY_CONTRACT_VERSION,
  PortabilityContractError,
  createPortableBundle,
  planPortableImport,
  validatePortableBundle,
} from './portability.js';
export type {
  CreatePortableBundleInput,
  ImportOperation,
  ImportOperationKind,
  ImportPlan,
  PortableBundle,
  PortableCanonicalEntry,
  PortableSourceBytesEntry,
} from './portability.js';

export {
  DELETION_CONTRACT_VERSION,
  DELETION_TARGETS,
  DeletionContractError,
  createDeletionPlan,
  evaluateDeletion,
  recordDeletionTarget,
} from './deletion.js';
export type {
  DeletionAuthority,
  DeletionAuthorityKind,
  DeletionOverallState,
  DeletionPlan,
  DeletionResult,
  DeletionTarget,
  DeletionTargetReceipt,
  DeletionTargetState,
  DeletionTombstone,
} from './deletion.js';

export {
  SYNC_CONTRACT_VERSION,
  SyncContractError,
  classifySync,
  createSyncEnvelope,
  validateSyncEnvelope,
} from './sync.js';
export type {
  SyncConflictReason,
  SyncDecision,
  SyncDecisionKind,
  SyncEnvelope,
} from './sync.js';
