import { type CanonicalObject, validateCanonicalObject } from './contract.js';
import { contentHash, receiptId, toIsoTime } from './identity.js';

export type ReviewDecision = 'ACCEPT' | 'REJECT' | 'DISPUTE';
export type ReviewActorKind = 'USER' | 'POLICY' | 'AGENT';

export interface ReviewAuthority {
  actor_id: string;
  actor_kind: ReviewActorKind;
}

export interface ReviewQueueItem<TPayload = unknown> {
  queue_item_id: string;
  state: 'PENDING' | 'DECIDED';
  object: CanonicalObject<TPayload>;
  proposed_object_id: string;
  proposed_content_hash: string;
  proposed_revision: number;
  proposed_by: string;
  queued_at: string;
  decision: ReviewDecision | null;
  decision_receipt_id: string | null;
}

export interface ReviewDecisionInput<TPayload = unknown> {
  item: ReviewQueueItem<TPayload>;
  authority: ReviewAuthority;
  decision: ReviewDecision;
  reason: string;
  decided_at?: number | string | Date;
}

export interface ReviewDecisionReceipt {
  receipt_id: string;
  queue_item_id: string;
  object_id: string;
  content_hash: string;
  revision: number;
  reviewer_id: string;
  reviewer_kind: Exclude<ReviewActorKind, 'AGENT'>;
  decision: ReviewDecision;
  reason_code: string;
  previous_review_state: 'PROPOSED';
  next_review_state: 'ACCEPTED' | 'REJECTED' | 'DISPUTED';
  canonical_commit_allowed: boolean;
  decided_at: string;
}

export interface ReviewDecisionResult<TPayload = unknown> {
  item: ReviewQueueItem<TPayload>;
  object: CanonicalObject<TPayload>;
  receipt: ReviewDecisionReceipt;
}

export interface UserCorrectionInput<TPayload> {
  previous: CanonicalObject<TPayload>;
  corrected_payload: TPayload;
  actor_id: string;
  reason: string;
  observed_at?: number | string | Date;
}

export interface CorrectionReceipt {
  receipt_id: string;
  object_id: string;
  previous_content_hash: string;
  next_content_hash: string;
  previous_revision: number;
  next_revision: number;
  actor_id: string;
  reason_code: string;
  created_at: string;
}

export interface UserCorrectionResult<TPayload> {
  proposal: CanonicalObject<TPayload>;
  receipt: CorrectionReceipt;
}

export class ReviewContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewContractError';
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ReviewContractError(`${field} is required`);
  return trimmed;
}

function requireCode(value: string, field: string): string {
  const trimmed = requireText(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(trimmed)) {
    throw new ReviewContractError(`${field} must be a bounded machine code`);
  }
  return trimmed;
}

export function createReviewQueueItem<TPayload>(
  object: CanonicalObject<TPayload>,
  queuedAt: number | string | Date = new Date(),
): ReviewQueueItem<TPayload> {
  validateCanonicalObject(object);
  if (object.review_state !== 'PROPOSED') {
    throw new ReviewContractError('only PROPOSED objects can enter the review queue');
  }
  const at = toIsoTime(queuedAt);
  return {
    queue_item_id: receiptId('review-queue', {
      object_id: object.object_id,
      content_hash: object.content_hash,
      revision: object.revision,
    }),
    state: 'PENDING',
    object,
    proposed_object_id: object.object_id,
    proposed_content_hash: object.content_hash,
    proposed_revision: object.revision,
    proposed_by: object.updated_by,
    queued_at: at,
    decision: null,
    decision_receipt_id: null,
  };
}

function nextReviewState(decision: ReviewDecision): 'ACCEPTED' | 'REJECTED' | 'DISPUTED' {
  if (decision === 'ACCEPT') return 'ACCEPTED';
  if (decision === 'REJECT') return 'REJECTED';
  return 'DISPUTED';
}

export function decideReview<TPayload>(input: ReviewDecisionInput<TPayload>): ReviewDecisionResult<TPayload> {
  if (input.item.state !== 'PENDING' || input.item.decision !== null || input.item.decision_receipt_id !== null) {
    throw new ReviewContractError('review queue item is already terminal');
  }
  validateCanonicalObject(input.item.object);
  if (
    input.item.object.object_id !== input.item.proposed_object_id ||
    input.item.object.content_hash !== input.item.proposed_content_hash ||
    input.item.object.revision !== input.item.proposed_revision ||
    input.item.object.review_state !== 'PROPOSED'
  ) {
    throw new ReviewContractError('review queue item no longer matches the proposed object identity');
  }
  if (input.authority.actor_kind === 'AGENT') {
    throw new ReviewContractError('Agent capability cannot make a terminal review decision');
  }

  const reviewerId = requireText(input.authority.actor_id, 'authority.actor_id');
  const reason = requireCode(input.reason, 'reason');
  const decidedAt = toIsoTime(input.decided_at ?? new Date());
  const reviewState = nextReviewState(input.decision);
  const object: CanonicalObject<TPayload> = {
    ...input.item.object,
    review_state: reviewState,
    updated_by: reviewerId,
  };
  const receipt: ReviewDecisionReceipt = {
    receipt_id: receiptId('review-decision', {
      queue_item_id: input.item.queue_item_id,
      object_id: object.object_id,
      content_hash: object.content_hash,
      revision: object.revision,
      reviewer_id: reviewerId,
      reviewer_kind: input.authority.actor_kind,
      decision: input.decision,
      reason_code: reason,
      decided_at: decidedAt,
    }),
    queue_item_id: input.item.queue_item_id,
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
    reviewer_id: reviewerId,
    reviewer_kind: input.authority.actor_kind,
    decision: input.decision,
    reason_code: reason,
    previous_review_state: 'PROPOSED',
    next_review_state: reviewState,
    canonical_commit_allowed: input.decision === 'ACCEPT',
    decided_at: decidedAt,
  };

  return {
    item: {
      ...input.item,
      state: 'DECIDED',
      decision: input.decision,
      decision_receipt_id: receipt.receipt_id,
    },
    object,
    receipt,
  };
}

export function createUserCorrection<TPayload>(input: UserCorrectionInput<TPayload>): UserCorrectionResult<TPayload> {
  validateCanonicalObject(input.previous);
  const actorId = requireText(input.actor_id, 'actor_id');
  const reason = requireCode(input.reason, 'reason');
  const observedAt = toIsoTime(input.observed_at ?? new Date());
  if (contentHash(input.corrected_payload) === contentHash(input.previous.payload)) {
    throw new ReviewContractError('correction must change the canonical payload');
  }
  const nextHash = contentHash({
    payload: input.corrected_payload,
    source_refs: [...input.previous.source_refs].sort(),
    assertion_type: 'USER_DECLARED_FACT',
  });

  const proposal: CanonicalObject<TPayload> = {
    ...input.previous,
    payload: input.corrected_payload,
    content_hash: nextHash,
    observed_at: observedAt,
    assertion_type: 'USER_DECLARED_FACT',
    review_state: 'PROPOSED',
    supersedes: input.previous.object_id,
    updated_by: actorId,
    revision: input.previous.revision + 1,
  };
  const receipt: CorrectionReceipt = {
    receipt_id: receiptId('user-correction', {
      object_id: proposal.object_id,
      previous_content_hash: input.previous.content_hash,
      next_content_hash: nextHash,
      previous_revision: input.previous.revision,
      next_revision: proposal.revision,
      actor_id: actorId,
      reason_code: reason,
      created_at: observedAt,
    }),
    object_id: proposal.object_id,
    previous_content_hash: input.previous.content_hash,
    next_content_hash: nextHash,
    previous_revision: input.previous.revision,
    next_revision: proposal.revision,
    actor_id: actorId,
    reason_code: reason,
    created_at: observedAt,
  };

  return { proposal, receipt };
}