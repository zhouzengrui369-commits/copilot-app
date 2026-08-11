import {
  type CanonicalObject,
  type ReadCapabilityRequest,
  type ReadDenyReason,
  validateCanonicalObject,
} from './contract.js';
import { receiptId, toIsoTime } from './identity.js';
import { authorizeCanonicalRead } from './policy.js';
import {
  checkProjectionFreshness,
  type ProjectionKind,
  type ProjectionRecord,
  type ProjectionStaleReason,
  validateProjectionRecord,
} from './projection.js';

export type RetrievalKind = 'FULL_TEXT' | 'VECTOR' | 'GRAPH' | 'WIKI' | 'CARD_2D' | 'DIALOGUE_CONTEXT';

export interface RetrievalHit {
  projection: ProjectionRecord;
  retrieval_kind: RetrievalKind;
  score: number;
}

export interface AuthorizedProjectionEvidence {
  projection_id: string;
  projection_kind: ProjectionKind;
  retrieval_kind: RetrievalKind;
}

export interface RankedCanonicalResult {
  object: CanonicalObject;
  object_id: string;
  score: number;
  evidence: readonly AuthorizedProjectionEvidence[];
}

export interface DeniedRetrievalAudit {
  object_id: string;
  reason: ReadDenyReason;
}

export interface StaleRetrievalAudit {
  projection_id: string;
  reason: 'UNKNOWN_CANONICAL_OBJECT' | 'STALE_PROJECTION';
  stale_reasons: readonly ProjectionStaleReason[];
}

export interface RetrievalReceipt {
  receipt_id: string;
  capability_id: string;
  namespace: string;
  purpose: string;
  privacy_ceiling: 'D0' | 'D1';
  input_hit_count: number;
  authorized_object_ids: readonly string[];
  authorized_projection_ids: readonly string[];
  denied: readonly DeniedRetrievalAudit[];
  stale: readonly StaleRetrievalAudit[];
  completed_at: string;
}

export interface UnifiedRetrievalResult {
  results: RankedCanonicalResult[];
  receipt: RetrievalReceipt;
}

export interface GroundedContextItem {
  object_id: string;
  object_type: CanonicalObject['object_type'];
  content_hash: string;
  revision: number;
  source_refs: readonly string[];
  score: number;
  projection_evidence: readonly AuthorizedProjectionEvidence[];
}

export interface GroundedContext {
  context_id: string;
  retrieval_receipt_id: string;
  capability_id: string;
  purpose: string;
  items: readonly GroundedContextItem[];
  created_at: string;
}

export class RetrievalContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalContractError';
  }
}

function validateScore(score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RetrievalContractError('retrieval score must be finite within 0..1');
  }
  return score;
}

function validateCanonicalSet(objects: readonly CanonicalObject[]): Map<string, CanonicalObject> {
  const map = new Map<string, CanonicalObject>();
  for (const object of objects) {
    validateCanonicalObject(object);
    const previous = map.get(object.object_id);
    if (previous && (previous.content_hash !== object.content_hash || previous.revision !== object.revision)) {
      throw new RetrievalContractError('canonical_objects contains conflicting versions for one object_id');
    }
    map.set(object.object_id, object);
  }
  return map;
}

export function rankAuthorizedProjectionHits(
  hits: readonly RetrievalHit[],
  canonicalObjects: readonly CanonicalObject[],
  request: ReadCapabilityRequest,
  completedAt: number | string | Date = new Date(),
): UnifiedRetrievalResult {
  const canonicalById = validateCanonicalSet(canonicalObjects);
  const freshHitsByObject = new Map<string, RetrievalHit[]>();
  const stale: StaleRetrievalAudit[] = [];

  for (const hit of hits) {
    validateProjectionRecord(hit.projection);
    validateScore(hit.score);
    const canonical = canonicalById.get(hit.projection.canonical_object_id);
    if (!canonical) {
      stale.push({
        projection_id: hit.projection.projection_id,
        reason: 'UNKNOWN_CANONICAL_OBJECT',
        stale_reasons: [],
      });
      continue;
    }
    const freshness = checkProjectionFreshness(hit.projection, canonical);
    if (!freshness.fresh) {
      stale.push({
        projection_id: hit.projection.projection_id,
        reason: 'STALE_PROJECTION',
        stale_reasons: freshness.reasons,
      });
      continue;
    }
    const existing = freshHitsByObject.get(canonical.object_id) ?? [];
    existing.push(hit);
    freshHitsByObject.set(canonical.object_id, existing);
  }

  const results: RankedCanonicalResult[] = [];
  const denied: DeniedRetrievalAudit[] = [];
  for (const objectId of [...freshHitsByObject.keys()].sort()) {
    const canonical = canonicalById.get(objectId);
    if (!canonical) throw new RetrievalContractError('internal canonical lookup failed');
    const decision = authorizeCanonicalRead(canonical, request, completedAt);
    if (!decision.allowed || !decision.object) {
      if (decision.receipt.reason === 'POLICY_MATCH') {
        throw new RetrievalContractError('denied read unexpectedly returned POLICY_MATCH');
      }
      denied.push({ object_id: objectId, reason: decision.receipt.reason });
      continue;
    }

    const objectHits = freshHitsByObject.get(objectId) ?? [];
    const evidence = objectHits
      .map((hit) => ({
        projection_id: hit.projection.projection_id,
        projection_kind: hit.projection.projection_kind,
        retrieval_kind: hit.retrieval_kind,
      }))
      .sort((a, b) => a.projection_id.localeCompare(b.projection_id));
    const score = Math.max(...objectHits.map((hit) => hit.score));
    results.push({ object: decision.object, object_id: objectId, score, evidence });
  }

  results.sort((a, b) => b.score - a.score || a.object_id.localeCompare(b.object_id));
  const completed = toIsoTime(completedAt);
  const authorizedObjectIds = results.map((result) => result.object_id);
  const authorizedProjectionIds = results.flatMap((result) => result.evidence.map((entry) => entry.projection_id)).sort();
  const receipt: RetrievalReceipt = {
    receipt_id: receiptId('retrieval', {
      capability_id: request.capability_id,
      namespace: request.namespace,
      purpose: request.purpose,
      privacy_ceiling: request.privacy_ceiling,
      authorized_object_ids: authorizedObjectIds,
      authorized_projection_ids: authorizedProjectionIds,
      denied: denied.map((entry) => ({ object_id: entry.object_id, reason: entry.reason })),
      stale: stale.map((entry) => ({ projection_id: entry.projection_id, reason: entry.reason, stale_reasons: entry.stale_reasons })),
    }),
    capability_id: request.capability_id,
    namespace: request.namespace,
    purpose: request.purpose,
    privacy_ceiling: request.privacy_ceiling,
    input_hit_count: hits.length,
    authorized_object_ids: authorizedObjectIds,
    authorized_projection_ids: authorizedProjectionIds,
    denied,
    stale,
    completed_at: completed,
  };

  return { results, receipt };
}

export function buildGroundedContext(
  retrieval: UnifiedRetrievalResult,
  createdAt: number | string | Date = new Date(),
): GroundedContext {
  const created = toIsoTime(createdAt);
  const items: GroundedContextItem[] = retrieval.results.map((result) => ({
    object_id: result.object.object_id,
    object_type: result.object.object_type,
    content_hash: result.object.content_hash,
    revision: result.object.revision,
    source_refs: [...result.object.source_refs].sort(),
    score: result.score,
    projection_evidence: result.evidence,
  }));
  return {
    context_id: receiptId('grounded-context', {
      retrieval_receipt_id: retrieval.receipt.receipt_id,
      items: items.map((item) => ({
        object_id: item.object_id,
        content_hash: item.content_hash,
        revision: item.revision,
        source_refs: item.source_refs,
        projection_ids: item.projection_evidence.map((entry) => entry.projection_id),
      })),
    }),
    retrieval_receipt_id: retrieval.receipt.receipt_id,
    capability_id: retrieval.receipt.capability_id,
    purpose: retrieval.receipt.purpose,
    items,
    created_at: created,
  };
}