import { Buffer } from 'node:buffer';
import {
  buildGroundedContext,
  createCapabilityManifest,
  createDeletionPlan,
  createPortableBundle,
  createProjection,
  evaluateDeletion,
  mapLegacyEntity,
  mapLegacyNote,
  mapLegacyRelation,
  negotiateCapability,
  planPortableImport,
  rankAuthorizedProjectionHits,
  readCanonicalObjects,
  recordDeletionTarget,
  retrieveForAgent,
  sha256Hex,
  submitAgentWriteProposal,
  type AgentWriteMode,
  type C1AdapterContext,
  type CapabilitySession,
  type CanonicalObject,
  type DeletionAuthority,
  type DeletionResult,
  type DeletionTarget,
  type NoteCanonicalMapping,
  type PortableBundle,
  type PreviousNoteMapping,
  type ProjectionKind,
  type ProjectionRecord,
  type ReadCapabilityRequest,
  type RetrievalHit,
  type UnifiedRetrievalResult,
} from '@copilot/kb';
import type {
  KgSubgraph,
  NoteDocument,
  RagRetrievalEvidence,
  RagSourceDetail,
} from '../shared/domain-api.js';

export const DESKTOP_SHARED_ENGINE_ADAPTER_ID = 'copilot-desktop-shared-engine-c6' as const;
export const DESKTOP_SHARED_ENGINE_ADAPTER_VERSION = '1' as const;

export interface DesktopSharedEngineContext {
  namespace: string;
  actorId: string;
  purpose: string;
  consumerId: string;
  privacyClass?: 'D0' | 'D1';
  writeMode?: AgentWriteMode;
}

export interface DesktopMappedNote {
  note_path: string;
  mapping: NoteCanonicalMapping;
}

export interface DesktopKgMapping {
  entities: CanonicalObject[];
  relations: CanonicalObject[];
}

export interface DesktopProjectionSet {
  object_id: string;
  projections: Record<ProjectionKind, ProjectionRecord>;
}

export interface DesktopRetrievalConformance {
  retrieval: UnifiedRetrievalResult;
  grounded_context: ReturnType<typeof buildGroundedContext>;
}

export interface DesktopPortabilityConformance {
  bundle: PortableBundle;
  import_plan: ReturnType<typeof planPortableImport>;
}

export interface DesktopDeletionProof {
  active_search_removed?: boolean;
  kg_removed?: boolean;
  rag_removed?: boolean;
  source_bytes_deleted?: boolean;
  canonical_tombstoned?: boolean;
  wiki_removed?: boolean;
  card_removed?: boolean;
  dialogue_removed?: boolean;
  cache_removed?: boolean;
  replica_removed?: boolean;
}

export class DesktopSharedEngineAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopSharedEngineAdapterError';
  }
}

const PROJECTION_KINDS: readonly ProjectionKind[] = [
  'CARD_2D',
  'WIKI',
  'FULL_TEXT',
  'VECTOR',
  'GRAPH',
  'DIALOGUE_CONTEXT',
];

const EVIDENCE_PROJECTION: Record<RagRetrievalEvidence, ProjectionKind> = {
  vector: 'VECTOR',
  'kg-entity': 'GRAPH',
  'kg-neighbor': 'GRAPH',
};

function capabilityIdForConsumer(consumerId: string): string {
  return `desktop:${consumerId}`;
}

function sharedContext(context: DesktopSharedEngineContext): C1AdapterContext {
  const namespace = context.namespace.trim();
  const actorId = context.actorId.trim();
  const purpose = context.purpose.trim();
  const consumerId = context.consumerId.trim();
  if (!namespace || !actorId || !purpose || !consumerId) {
    throw new DesktopSharedEngineAdapterError('desktop Shared Engine context is incomplete');
  }
  return {
    namespace,
    actorId,
    purposes: [purpose],
    allowedConsumers: [capabilityIdForConsumer(consumerId)],
    privacyClass: context.privacyClass ?? 'D1',
    cloudEgress: 'DENY',
  };
}

function noteSnapshot(document: NoteDocument) {
  return {
    path: document.note.path,
    title: document.note.title,
    type: document.note.type,
    status: document.note.status,
    tags: document.note.tags,
    related: document.note.related,
    sourceHash: null,
    createdAt: document.note.createdAt,
    updatedAt: document.note.updatedAt,
    confidence: document.note.confidence,
    agent: document.note.agent,
    body: document.body,
  };
}

export function mapDesktopNoteDocument(
  document: NoteDocument,
  context: DesktopSharedEngineContext,
  previous: PreviousNoteMapping = {},
): DesktopMappedNote {
  if (!document || typeof document !== 'object' || !document.note || typeof document.body !== 'string') {
    throw new DesktopSharedEngineAdapterError('NoteDocument is malformed');
  }
  return {
    note_path: document.note.path,
    mapping: mapLegacyNote(noteSnapshot(document), sharedContext(context), previous),
  };
}

export function mapDesktopKgSubgraph(
  subgraph: KgSubgraph,
  context: DesktopSharedEngineContext,
): DesktopKgMapping {
  if (!subgraph || !Array.isArray(subgraph.nodes) || !Array.isArray(subgraph.edges)) {
    throw new DesktopSharedEngineAdapterError('KG subgraph is malformed');
  }
  const adapterContext = sharedContext(context);
  const entities = subgraph.nodes.map((entity) =>
    mapLegacyEntity(
      {
        legacyId: entity.entity_id,
        type: entity.type,
        name: entity.name,
        aliases: entity.aliases,
        summary: entity.summary,
        confidence: entity.confidence,
        sourceNotePaths: entity.source_notes,
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
      },
      adapterContext,
    ).object,
  );
  const knownEntityIds = new Set(subgraph.nodes.map((entity) => entity.entity_id));
  const relations = subgraph.edges.map((relation) => {
    if (!knownEntityIds.has(relation.from_entity_id) || !knownEntityIds.has(relation.to_entity_id)) {
      throw new DesktopSharedEngineAdapterError('KG relation references an entity absent from the supplied subgraph');
    }
    return mapLegacyRelation(
      {
        fromLegacyEntityId: relation.from_entity_id,
        toLegacyEntityId: relation.to_entity_id,
        predicate: relation.rel,
        weight: relation.weight,
        sourceNotePaths: relation.evidence,
        createdAt: relation.created_at,
      },
      adapterContext,
    ).object;
  });
  return { entities, relations };
}

export function createDesktopProjectionSet(mapping: DesktopMappedNote): DesktopProjectionSet {
  const knowledge = mapping.mapping.knowledge.object;
  const projections = Object.fromEntries(
    PROJECTION_KINDS.map((kind) => [
      kind,
      createProjection(
        knowledge,
        kind,
        {
          adapter_id: DESKTOP_SHARED_ENGINE_ADAPTER_ID,
          canonical_object_id: knowledge.object_id,
          note_path: mapping.note_path,
          surface: kind,
        },
        {
          recipe_id: DESKTOP_SHARED_ENGINE_ADAPTER_ID,
          recipe_version: DESKTOP_SHARED_ENGINE_ADAPTER_VERSION,
        },
      ),
    ]),
  ) as Record<ProjectionKind, ProjectionRecord>;
  return { object_id: knowledge.object_id, projections };
}

function mappingIndex(mappings: readonly DesktopMappedNote[]): Map<string, DesktopMappedNote> {
  const result = new Map<string, DesktopMappedNote>();
  for (const mapping of mappings) {
    if (result.has(mapping.note_path)) {
      throw new DesktopSharedEngineAdapterError(`duplicate note mapping for ${mapping.note_path}`);
    }
    result.set(mapping.note_path, mapping);
  }
  return result;
}

export function mapDesktopRagSourceDetails(
  details: readonly RagSourceDetail[],
  mappings: readonly DesktopMappedNote[],
): RetrievalHit[] {
  const byPath = mappingIndex(mappings);
  const hits: RetrievalHit[] = [];
  for (const detail of details) {
    if (!Number.isFinite(detail.score) || detail.score < 0 || detail.score > 1) {
      throw new DesktopSharedEngineAdapterError('RAG score must be finite and within 0..1');
    }
    const mapping = byPath.get(detail.notePath);
    if (!mapping) {
      throw new DesktopSharedEngineAdapterError(`RAG source has no canonical note mapping: ${detail.notePath}`);
    }
    const projections = createDesktopProjectionSet(mapping).projections;
    const evidence = [...new Set(detail.evidence)].sort();
    if (evidence.length === 0) {
      throw new DesktopSharedEngineAdapterError('RAG source detail must declare retrieval evidence');
    }
    for (const item of evidence) {
      const kind = EVIDENCE_PROJECTION[item];
      if (!kind) throw new DesktopSharedEngineAdapterError(`unsupported RAG retrieval evidence: ${item}`);
      hits.push({ projection: projections[kind], score: detail.score });
    }
  }
  return hits;
}

export function readRequestForDesktopContext(
  context: DesktopSharedEngineContext,
  objectTypes: readonly CanonicalObject['object_type'][] = ['Knowledge'],
): ReadCapabilityRequest {
  const resolved = sharedContext(context);
  const capabilityId = resolved.allowedConsumers[0];
  if (!capabilityId) throw new DesktopSharedEngineAdapterError('desktop capability identity is unavailable');
  return {
    capability_id: capabilityId,
    namespace: resolved.namespace,
    purpose: context.purpose.trim(),
    privacy_ceiling: context.privacyClass ?? 'D1',
    allowed_object_types: [...new Set(objectTypes)],
  };
}

export function runDesktopRetrievalConformance(
  details: readonly RagSourceDetail[],
  mappings: readonly DesktopMappedNote[],
  context: DesktopSharedEngineContext,
  at: number | string | Date = new Date(),
): DesktopRetrievalConformance {
  const hits = mapDesktopRagSourceDetails(details, mappings);
  const canonical = mappings.map((mapping) => mapping.mapping.knowledge.object);
  const retrieval = rankAuthorizedProjectionHits(
    hits,
    canonical,
    readRequestForDesktopContext(context),
    at,
  );
  return {
    retrieval,
    grounded_context: buildGroundedContext(retrieval, at),
  };
}

export function createDesktopAgentSession(
  context: DesktopSharedEngineContext,
  input: { expiresAt?: string | null; negotiatedAt?: number | string | Date } = {},
): CapabilitySession {
  const resolved = sharedContext(context);
  const capabilityId = resolved.allowedConsumers[0];
  if (!capabilityId) throw new DesktopSharedEngineAdapterError('desktop capability identity is unavailable');
  const manifest = createCapabilityManifest({
    capability_id: capabilityId,
    consumer_id: context.consumerId.trim(),
    namespaces: [resolved.namespace],
    purposes: [context.purpose.trim()],
    privacy_ceiling: context.privacyClass ?? 'D1',
    allowed_read_types: ['Source', 'Knowledge', 'Entity', 'Relation'],
    write_mode: context.writeMode ?? 'NONE',
    expires_at: input.expiresAt ?? null,
  });
  return negotiateCapability(manifest, '0.3.0-draft', input.negotiatedAt ?? new Date());
}

export function runDesktopAgentRead(
  session: CapabilitySession,
  mappings: readonly DesktopMappedNote[],
  context: DesktopSharedEngineContext,
  at: number | string | Date = new Date(),
) {
  return readCanonicalObjects({
    session,
    canonical_objects: mappings.flatMap((mapping) => [
      mapping.mapping.source.object,
      mapping.mapping.knowledge.object,
    ]),
    object_ids: mappings.map((mapping) => mapping.mapping.knowledge.object.object_id),
    namespace: context.namespace.trim(),
    purpose: context.purpose.trim(),
    completed_at: at,
  });
}

export function runDesktopAgentRetrieval(
  session: CapabilitySession,
  details: readonly RagSourceDetail[],
  mappings: readonly DesktopMappedNote[],
  context: DesktopSharedEngineContext,
  at: number | string | Date = new Date(),
) {
  return retrieveForAgent({
    session,
    canonical_objects: mappings.map((mapping) => mapping.mapping.knowledge.object),
    hits: mapDesktopRagSourceDetails(details, mappings),
    namespace: context.namespace.trim(),
    purpose: context.purpose.trim(),
    completed_at: at,
  });
}

export function runDesktopAgentWriteProposal(
  session: CapabilitySession,
  object: CanonicalObject,
  context: DesktopSharedEngineContext,
  reasonCode: string,
  at: number | string | Date = new Date(),
) {
  return submitAgentWriteProposal({
    session,
    object,
    namespace: context.namespace.trim(),
    purpose: context.purpose.trim(),
    reason_code: reasonCode,
    proposed_at: at,
  });
}

export function createDesktopPortableRoundtripPlan(
  documents: readonly NoteDocument[],
  context: DesktopSharedEngineContext,
  localObjects: readonly CanonicalObject[] = [],
  at: number | string | Date = new Date(),
): DesktopPortabilityConformance {
  const mapped = documents.map((document) => mapDesktopNoteDocument(document, context));
  const objects = mapped.flatMap((entry) => [entry.mapping.source.object, entry.mapping.knowledge.object]);
  const sourceBytes = mapped.map((entry, index) => {
    const bytes = Buffer.from(documents[index]?.body ?? '', 'utf8');
    return {
      source_object_id: entry.mapping.source.object.object_id,
      privacy_class: (context.privacyClass ?? 'D1') as 'D0' | 'D1',
      content_sha256: `sha256:${sha256Hex(bytes)}`,
      byte_length: bytes.byteLength,
      encoding: 'base64' as const,
      included: true,
      redacted: false,
      data_base64: bytes.toString('base64'),
    };
  });
  const bundle = createPortableBundle({
    namespace: context.namespace.trim(),
    objects,
    source_bytes: sourceBytes,
    exported_at: at,
  });
  return {
    bundle,
    import_plan: planPortableImport(bundle, localObjects, at),
  };
}

function deletionReceipt(
  plan: ReturnType<typeof createDeletionPlan>,
  target: DeletionTarget,
  proven: boolean | undefined,
  at: number | string | Date,
) {
  if (proven === undefined) return null;
  return recordDeletionTarget(plan, {
    target,
    state: proven ? (target === 'CANONICAL_OBJECT' ? 'TOMBSTONED' : 'DELETED') : 'FAILED',
    error_code: proven ? null : 'SURFACE_DELETE_NOT_PROVEN',
    recorded_at: at,
  });
}

export function assessDesktopDeletion(
  mapping: DesktopMappedNote,
  proof: DesktopDeletionProof,
  authority: DeletionAuthority,
  at: number | string | Date = new Date(),
): DeletionResult {
  const plan = createDeletionPlan(mapping.mapping.knowledge.object, authority, at);
  const targetProof: ReadonlyArray<[DeletionTarget, boolean | undefined]> = [
    ['SOURCE_BYTES', proof.source_bytes_deleted],
    ['CANONICAL_OBJECT', proof.canonical_tombstoned],
    ['WIKI', proof.wiki_removed],
    ['CARD_2D', proof.card_removed],
    ['GRAPH', proof.kg_removed],
    ['VECTOR', proof.rag_removed],
    ['FULL_TEXT', proof.active_search_removed],
    ['DIALOGUE_CONTEXT', proof.dialogue_removed],
    ['CACHE', proof.cache_removed],
    ['REPLICA', proof.replica_removed],
  ];
  const receipts = targetProof
    .map(([target, proven]) => deletionReceipt(plan, target, proven, at))
    .filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== null);
  return evaluateDeletion(plan, receipts, at);
}

export function runtimeIdentitySnapshot(
  document: NoteDocument,
  context: DesktopSharedEngineContext,
) {
  const mapped = mapDesktopNoteDocument(document, context);
  const projections = createDesktopProjectionSet(mapped);
  const session = createDesktopAgentSession(context, { negotiatedAt: document.note.updatedAt });
  return {
    adapter_id: DESKTOP_SHARED_ENGINE_ADAPTER_ID,
    adapter_version: DESKTOP_SHARED_ENGINE_ADAPTER_VERSION,
    note_path: document.note.path,
    source_object_id: mapped.mapping.source.object.object_id,
    knowledge_object_id: mapped.mapping.knowledge.object.object_id,
    source_content_hash: mapped.mapping.source.object.content_hash,
    knowledge_content_hash: mapped.mapping.knowledge.object.content_hash,
    source_revision: mapped.mapping.source.object.revision,
    knowledge_revision: mapped.mapping.knowledge.object.revision,
    projection_ids: Object.fromEntries(
      PROJECTION_KINDS.map((kind) => [kind, projections.projections[kind].projection_id]),
    ),
    capability_manifest_id: session.manifest.manifest_id,
    capability_session_id: session.session_id,
  };
}
