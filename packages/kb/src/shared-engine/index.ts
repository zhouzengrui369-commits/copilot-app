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