import { type CanonicalObject, validateCanonicalObject } from './contract.js';
import { receiptId, toIsoTime } from './identity.js';
import type { ReviewActorKind } from './review.js';

export type ConflictKind = 'CONTRADICTION' | 'DUPLICATE' | 'STALE_REPLACEMENT';
export type ConflictResolutionStrategy =
  | 'KEEP_LEFT'
  | 'KEEP_RIGHT'
  | 'KEEP_BOTH'
  | 'SUPERSEDE_LEFT'
  | 'SUPERSEDE_RIGHT';

export interface ConflictObjectRef {
  object_id: string;
  content_hash: string;
  revision: number;
  source_refs: readonly string[];
  assertion_type: CanonicalObject['assertion_type'];
  review_state: CanonicalObject['review_state'];
}

export interface ConflictRecord<TLeft = unknown, TRight = unknown> {
  conflict_id: string;
  namespace: string;
  kind: ConflictKind;
  state: 'OPEN' | 'RESOLVED';
  left: ConflictObjectRef;
  right: ConflictObjectRef;
  left_object: CanonicalObject<TLeft>;
  right_object: CanonicalObject<TRight>;
  detected_at: string;
  resolution_receipt_id: string | null;
}

export interface ConflictResolutionAuthority {
  actor_id: string;
  actor_kind: ReviewActorKind;
}

export interface ResolveConflictInput<TLeft = unknown, TRight = unknown> {
  conflict: ConflictRecord<TLeft, TRight>;
  authority: ConflictResolutionAuthority;
  strategy: ConflictResolutionStrategy;
  reason: string;
  resolved_at?: number | string | Date;
}

export interface SupersessionReceipt {
  receipt_id: string;
  superseded_object_id: string;
  superseded_content_hash: string;
  superseded_revision: number;
  successor_object_id: string;
  successor_content_hash: string;
  successor_revision: number;
  actor_id: string;
  resolved_at: string;
}

export interface ConflictResolutionReceipt {
  receipt_id: string;
  conflict_id: string;
  strategy: ConflictResolutionStrategy;
  actor_id: string;
  actor_kind: Exclude<ReviewActorKind, 'AGENT'>;
  reason_code: string;
  winner_object_id: string | null;
  supersession_receipt_id: string | null;
  resolved_at: string;
}

export interface ResolveConflictResult<TLeft = unknown, TRight = unknown> {
  conflict: ConflictRecord<TLeft, TRight>;
  left_object: CanonicalObject<TLeft>;
  right_object: CanonicalObject<TRight>;
  receipt: ConflictResolutionReceipt;
  supersession: SupersessionReceipt | null;
}

export class ConflictContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictContractError';
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConflictContractError(`${field} is required`);
  return trimmed;
}

function requireCode(value: string, field: string): string {
  const trimmed = requireText(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(trimmed)) {
    throw new ConflictContractError(`${field} must be a bounded machine code`);
  }
  return trimmed;
}

function objectRef(object: CanonicalObject): ConflictObjectRef {
  return {
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
    source_refs: [...object.source_refs].sort(),
    assertion_type: object.assertion_type,
    review_state: object.review_state,
  };
}

function partyKey(ref: ConflictObjectRef): string {
  return `${ref.object_id}@${ref.revision}@${ref.content_hash}`;
}

export function createConflict<TLeft, TRight>(
  left: CanonicalObject<TLeft>,
  right: CanonicalObject<TRight>,
  kind: ConflictKind,
  detectedAt: number | string | Date = new Date(),
): ConflictRecord<TLeft, TRight> {
  validateCanonicalObject(left);
  validateCanonicalObject(right);
  if (left.namespace !== right.namespace) {
    throw new ConflictContractError('conflict objects must share a namespace');
  }
  if (left.object_id === right.object_id && left.content_hash === right.content_hash && left.revision === right.revision) {
    throw new ConflictContractError('conflict requires two distinct assertions or revisions');
  }

  const leftRef = objectRef(left);
  const rightRef = objectRef(right);
  const ordered = [leftRef, rightRef].sort((a, b) => partyKey(a).localeCompare(partyKey(b)));
  const detected = toIsoTime(detectedAt);
  return {
    conflict_id: receiptId('conflict', {
      namespace: left.namespace,
      kind,
      parties: ordered.map((ref) => partyKey(ref)),
    }),
    namespace: left.namespace,
    kind,
    state: 'OPEN',
    left: leftRef,
    right: rightRef,
    left_object: left,
    right_object: right,
    detected_at: detected,
    resolution_receipt_id: null,
  };
}

function supersede<TSuperseded, TSuccessor>(
  superseded: CanonicalObject<TSuperseded>,
  successor: CanonicalObject<TSuccessor>,
  actorId: string,
  resolvedAt: string,
): {
  superseded: CanonicalObject<TSuperseded>;
  successor: CanonicalObject<TSuccessor>;
  receipt: SupersessionReceipt;
} {
  const supersededObject: CanonicalObject<TSuperseded> = {
    ...superseded,
    assertion_type: 'SUPERSEDED',
    review_state: 'EXPIRED',
    valid_to: resolvedAt,
    updated_by: actorId,
  };
  const successorObject: CanonicalObject<TSuccessor> = {
    ...successor,
    supersedes: superseded.object_id,
    updated_by: actorId,
  };
  const receipt: SupersessionReceipt = {
    receipt_id: receiptId('supersession', {
      superseded_object_id: superseded.object_id,
      superseded_content_hash: superseded.content_hash,
      superseded_revision: superseded.revision,
      successor_object_id: successor.object_id,
      successor_content_hash: successor.content_hash,
      successor_revision: successor.revision,
      actor_id: actorId,
      resolved_at: resolvedAt,
    }),
    superseded_object_id: superseded.object_id,
    superseded_content_hash: superseded.content_hash,
    superseded_revision: superseded.revision,
    successor_object_id: successor.object_id,
    successor_content_hash: successor.content_hash,
    successor_revision: successor.revision,
    actor_id: actorId,
    resolved_at: resolvedAt,
  };
  return { superseded: supersededObject, successor: successorObject, receipt };
}

export function resolveConflict<TLeft, TRight>(
  input: ResolveConflictInput<TLeft, TRight>,
): ResolveConflictResult<TLeft, TRight> {
  if (input.conflict.state !== 'OPEN' || input.conflict.resolution_receipt_id !== null) {
    throw new ConflictContractError('conflict is already resolved');
  }
  validateCanonicalObject(input.conflict.left_object);
  validateCanonicalObject(input.conflict.right_object);
  if (
    input.conflict.left_object.object_id !== input.conflict.left.object_id ||
    input.conflict.left_object.content_hash !== input.conflict.left.content_hash ||
    input.conflict.left_object.revision !== input.conflict.left.revision ||
    input.conflict.right_object.object_id !== input.conflict.right.object_id ||
    input.conflict.right_object.content_hash !== input.conflict.right.content_hash ||
    input.conflict.right_object.revision !== input.conflict.right.revision
  ) {
    throw new ConflictContractError('conflict object identity no longer matches the recorded assertions');
  }
  if (input.authority.actor_kind === 'AGENT') {
    throw new ConflictContractError('Agent capability cannot resolve a conflict');
  }

  const actorId = requireText(input.authority.actor_id, 'authority.actor_id');
  const reason = requireCode(input.reason, 'reason');
  const resolvedAt = toIsoTime(input.resolved_at ?? new Date());
  let leftObject = input.conflict.left_object;
  let rightObject = input.conflict.right_object;
  let supersession: SupersessionReceipt | null = null;
  let winnerObjectId: string | null = null;

  if (input.strategy === 'KEEP_LEFT') winnerObjectId = leftObject.object_id;
  if (input.strategy === 'KEEP_RIGHT') winnerObjectId = rightObject.object_id;
  if (input.strategy === 'SUPERSEDE_LEFT') {
    const result = supersede(leftObject, rightObject, actorId, resolvedAt);
    leftObject = result.superseded;
    rightObject = result.successor;
    supersession = result.receipt;
    winnerObjectId = rightObject.object_id;
  }
  if (input.strategy === 'SUPERSEDE_RIGHT') {
    const result = supersede(rightObject, leftObject, actorId, resolvedAt);
    rightObject = result.superseded;
    leftObject = result.successor;
    supersession = result.receipt;
    winnerObjectId = leftObject.object_id;
  }

  const receipt: ConflictResolutionReceipt = {
    receipt_id: receiptId('conflict-resolution', {
      conflict_id: input.conflict.conflict_id,
      strategy: input.strategy,
      actor_id: actorId,
      actor_kind: input.authority.actor_kind,
      reason_code: reason,
      winner_object_id: winnerObjectId,
      supersession_receipt_id: supersession?.receipt_id ?? null,
      resolved_at: resolvedAt,
    }),
    conflict_id: input.conflict.conflict_id,
    strategy: input.strategy,
    actor_id: actorId,
    actor_kind: input.authority.actor_kind,
    reason_code: reason,
    winner_object_id: winnerObjectId,
    supersession_receipt_id: supersession?.receipt_id ?? null,
    resolved_at: resolvedAt,
  };

  return {
    conflict: {
      ...input.conflict,
      state: 'RESOLVED',
      resolution_receipt_id: receipt.receipt_id,
    },
    left_object: leftObject,
    right_object: rightObject,
    receipt,
    supersession,
  };
}