import {
  SHARED_ENGINE_SCHEMA_VERSION,
  type AssertionType,
  type CanonicalObject,
  type EntityPayload,
  type KnowledgePayload,
  type MappingOperation,
  type MappingReceipt,
  type PermissionScope,
  type PrivacyClass,
  type RelationPayload,
  type RevisionState,
  type ReviewState,
  type SourcePayload,
} from './contract.js';
import { contentHash, objectId, receiptId, toIsoTime } from './identity.js';

export interface C1AdapterContext {
  namespace: string;
  actorId: string;
  purposes: readonly string[];
  allowedConsumers: readonly string[];
  privacyClass?: Extract<PrivacyClass, 'D0' | 'D1'>;
  cloudEgress?: PermissionScope['cloud_egress'];
}

export interface LegacyNoteSnapshot {
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  tags: readonly string[];
  related: readonly string[];
  sourceHash: string | null;
  createdAt: number;
  updatedAt: number;
  confidence: number | null;
  agent: string | null;
  body: string;
}

export interface LegacyEntitySnapshot {
  legacyId: string;
  type: string;
  name: string;
  aliases: readonly string[];
  summary: string | null;
  confidence: number | null;
  sourceNotePaths: readonly string[];
  createdAt: number;
  updatedAt: number;
}

export interface LegacyRelationSnapshot {
  fromLegacyEntityId: string;
  toLegacyEntityId: string;
  predicate: string;
  weight: number | null;
  sourceNotePaths: readonly string[];
  createdAt: number;
}

export interface MappedObject<TPayload> {
  object: CanonicalObject<TPayload>;
  receipt: MappingReceipt;
}

export interface NoteCanonicalMapping {
  source: MappedObject<SourcePayload>;
  knowledge: MappedObject<KnowledgePayload>;
}

export interface PreviousNoteMapping {
  source?: RevisionState;
  knowledge?: RevisionState;
}

function permissionScope(context: C1AdapterContext): PermissionScope {
  return {
    purposes: [...new Set(context.purposes)].sort(),
    allowed_consumers: [...new Set(context.allowedConsumers)].sort(),
    cloud_egress: context.cloudEgress ?? 'DENY',
  };
}

function ensureConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('confidence must be null or within 0..1');
  }
  return value;
}

function deriveRevision(
  objectIdentity: string,
  nextHash: string,
  previous: RevisionState | undefined,
): { operation: MappingOperation; revision: number; previousHash: string | null; previousRevision: number | null } {
  if (!previous) {
    return { operation: 'MAPPED', revision: 1, previousHash: null, previousRevision: null };
  }
  if (previous.object_id !== objectIdentity) {
    throw new Error('previous revision object_id does not match stable canonical identity');
  }
  if (!Number.isInteger(previous.revision) || previous.revision < 1) {
    throw new Error('previous revision must be a positive integer');
  }
  if (previous.content_hash === nextHash) {
    return {
      operation: 'UNCHANGED',
      revision: previous.revision,
      previousHash: previous.content_hash,
      previousRevision: previous.revision,
    };
  }
  return {
    operation: 'REVISED',
    revision: previous.revision + 1,
    previousHash: previous.content_hash,
    previousRevision: previous.revision,
  };
}

function mappingReceipt(
  objectIdentity: string,
  nextHash: string,
  mappedAt: string,
  previous: RevisionState | undefined,
): { receipt: MappingReceipt; revision: number } {
  const transition = deriveRevision(objectIdentity, nextHash, previous);
  const receipt: MappingReceipt = {
    receipt_id: receiptId('mapping', {
      object_id: objectIdentity,
      operation: transition.operation,
      previous_content_hash: transition.previousHash,
      next_content_hash: nextHash,
      previous_revision: transition.previousRevision,
      next_revision: transition.revision,
      mapped_at: mappedAt,
    }),
    object_id: objectIdentity,
    operation: transition.operation,
    previous_content_hash: transition.previousHash,
    next_content_hash: nextHash,
    previous_revision: transition.previousRevision,
    next_revision: transition.revision,
    mapped_at: mappedAt,
    adapter_id: 'copilot-shared-engine-c1',
    adapter_version: '1',
  };
  return { receipt, revision: transition.revision };
}

export function sourceObjectIdForNote(namespace: string, path: string): string {
  return objectId({ namespace, objectType: 'Source', sourceIdentity: `copilot-note:${path}` });
}

export function knowledgeObjectIdForNote(namespace: string, path: string): string {
  return objectId({ namespace, objectType: 'Knowledge', sourceIdentity: `copilot-note:${path}` });
}

export function entityObjectId(namespace: string, legacyId: string): string {
  return objectId({ namespace, objectType: 'Entity', sourceIdentity: `copilot-entity:${legacyId}` });
}

export function mapLegacyNote(
  note: LegacyNoteSnapshot,
  context: C1AdapterContext,
  previous: PreviousNoteMapping = {},
): NoteCanonicalMapping {
  if (!note.path.trim()) throw new Error('note path is required');
  const observedAt = toIsoTime(note.updatedAt);
  const createdAt = toIsoTime(note.createdAt);
  const scope = permissionScope(context);
  const privacyClass = context.privacyClass ?? 'D1';
  const sourceId = sourceObjectIdForNote(context.namespace, note.path);
  const knowledgeId = knowledgeObjectIdForNote(context.namespace, note.path);
  const contentRef = `copilot-note:${note.path}`;

  const sourcePayload: SourcePayload = {
    source_kind: 'copilot_note',
    source_key: note.path,
    source_revision: String(note.updatedAt),
    content_ref: contentRef,
    title: note.title,
  };
  const sourceContentHash = contentHash({ body: note.body });
  const sourceRevision = mappingReceipt(sourceId, sourceContentHash, observedAt, previous.source);

  const sourceObject: CanonicalObject<SourcePayload> = {
    object_id: sourceId,
    object_type: 'Source',
    namespace: context.namespace,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    source_refs: [],
    content_hash: sourceContentHash,
    observed_at: observedAt,
    valid_from: createdAt,
    valid_to: null,
    assertion_type: 'SOURCE_FACT',
    confidence: 1,
    review_state: 'ACCEPTED',
    privacy_class: privacyClass,
    permission_scope: scope,
    supersedes: null,
    tombstone_state: 'ACTIVE',
    created_by: context.actorId,
    updated_by: context.actorId,
    revision: sourceRevision.revision,
    payload: sourcePayload,
  };

  const relatedSourceKeys = [...new Set(note.related)].sort();
  const knowledgePayload: KnowledgePayload = {
    title: note.title,
    kind: note.type,
    state: note.status,
    tags: [...new Set(note.tags)].sort(),
    related_source_keys: relatedSourceKeys,
    content_ref: contentRef,
  };
  const knowledgeContentHash = contentHash({
    source_content_hash: sourceContentHash,
    title: note.title,
    type: note.type,
    status: note.status,
    tags: knowledgePayload.tags,
    related: relatedSourceKeys,
    legacy_source_hash: note.sourceHash,
  });
  const knowledgeRevision = mappingReceipt(knowledgeId, knowledgeContentHash, observedAt, previous.knowledge);
  const inferred = Boolean(note.agent);

  const knowledgeObject: CanonicalObject<KnowledgePayload> = {
    object_id: knowledgeId,
    object_type: 'Knowledge',
    namespace: context.namespace,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    source_refs: [sourceId],
    content_hash: knowledgeContentHash,
    observed_at: observedAt,
    valid_from: createdAt,
    valid_to: null,
    assertion_type: inferred ? 'SYSTEM_INFERENCE' : 'USER_DECLARED_FACT',
    confidence: ensureConfidence(note.confidence),
    review_state: inferred ? 'PROPOSED' : 'ACCEPTED',
    privacy_class: privacyClass,
    permission_scope: scope,
    supersedes: null,
    tombstone_state: 'ACTIVE',
    created_by: note.agent ?? context.actorId,
    updated_by: context.actorId,
    revision: knowledgeRevision.revision,
    payload: knowledgePayload,
  };

  return {
    source: { object: sourceObject, receipt: sourceRevision.receipt },
    knowledge: { object: knowledgeObject, receipt: knowledgeRevision.receipt },
  };
}

export interface DerivedObjectOptions {
  assertionType?: AssertionType;
  reviewState?: ReviewState;
  previous?: RevisionState;
}

export function mapLegacyEntity(
  entity: LegacyEntitySnapshot,
  context: C1AdapterContext,
  options: DerivedObjectOptions = {},
): MappedObject<EntityPayload> {
  const identity = entityObjectId(context.namespace, entity.legacyId);
  const payload: EntityPayload = {
    entity_kind: entity.type,
    name: entity.name,
    aliases: [...new Set(entity.aliases)].sort(),
    summary: entity.summary,
  };
  const nextHash = contentHash(payload);
  const mappedAt = toIsoTime(entity.updatedAt);
  const mapped = mappingReceipt(identity, nextHash, mappedAt, options.previous);

  return {
    object: {
      object_id: identity,
      object_type: 'Entity',
      namespace: context.namespace,
      schema_version: SHARED_ENGINE_SCHEMA_VERSION,
      source_refs: [...new Set(entity.sourceNotePaths)]
        .sort()
        .map((path) => sourceObjectIdForNote(context.namespace, path)),
      content_hash: nextHash,
      observed_at: mappedAt,
      valid_from: toIsoTime(entity.createdAt),
      valid_to: null,
      assertion_type: options.assertionType ?? 'SYSTEM_INFERENCE',
      confidence: ensureConfidence(entity.confidence),
      review_state: options.reviewState ?? 'PROPOSED',
      privacy_class: context.privacyClass ?? 'D1',
      permission_scope: permissionScope(context),
      supersedes: null,
      tombstone_state: 'ACTIVE',
      created_by: context.actorId,
      updated_by: context.actorId,
      revision: mapped.revision,
      payload,
    },
    receipt: mapped.receipt,
  };
}

export function mapLegacyRelation(
  relation: LegacyRelationSnapshot,
  context: C1AdapterContext,
  options: DerivedObjectOptions = {},
): MappedObject<RelationPayload> {
  const fromId = entityObjectId(context.namespace, relation.fromLegacyEntityId);
  const toId = entityObjectId(context.namespace, relation.toLegacyEntityId);
  const identity = objectId({
    namespace: context.namespace,
    objectType: 'Relation',
    sourceIdentity: `copilot-relation:${relation.fromLegacyEntityId}:${relation.predicate}:${relation.toLegacyEntityId}`,
  });
  const payload: RelationPayload = {
    from_object_id: fromId,
    to_object_id: toId,
    predicate: relation.predicate,
    weight: relation.weight,
  };
  const nextHash = contentHash(payload);
  const mappedAt = toIsoTime(relation.createdAt);
  const mapped = mappingReceipt(identity, nextHash, mappedAt, options.previous);

  return {
    object: {
      object_id: identity,
      object_type: 'Relation',
      namespace: context.namespace,
      schema_version: SHARED_ENGINE_SCHEMA_VERSION,
      source_refs: [...new Set(relation.sourceNotePaths)]
        .sort()
        .map((path) => sourceObjectIdForNote(context.namespace, path)),
      content_hash: nextHash,
      observed_at: mappedAt,
      valid_from: mappedAt,
      valid_to: null,
      assertion_type: options.assertionType ?? 'SYSTEM_INFERENCE',
      confidence: relation.weight === null ? null : ensureConfidence(relation.weight),
      review_state: options.reviewState ?? 'PROPOSED',
      privacy_class: context.privacyClass ?? 'D1',
      permission_scope: permissionScope(context),
      supersedes: null,
      tombstone_state: 'ACTIVE',
      created_by: context.actorId,
      updated_by: context.actorId,
      revision: mapped.revision,
      payload,
    },
    receipt: mapped.receipt,
  };
}