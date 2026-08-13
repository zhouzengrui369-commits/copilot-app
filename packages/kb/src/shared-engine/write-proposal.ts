import { type CanonicalObject, type WriteProposal, validateCanonicalObject } from './contract.js';
import { receiptId, toIsoTime } from './identity.js';

export interface CreateWriteProposalInput<TPayload> {
  capabilityId: string;
  object: CanonicalObject<TPayload>;
  reason: string;
  proposedAt?: number | string | Date;
}

/**
 * C1 deliberately has no "accept proposal" function. Agent writes stop at a
 * reviewable proposal boundary until a later milestone adds explicit policy,
 * review and rollback authority.
 */
export function createWriteProposal<TPayload>(
  input: CreateWriteProposalInput<TPayload>,
): WriteProposal<TPayload> {
  validateCanonicalObject(input.object);
  if (!input.capabilityId.trim()) throw new Error('capabilityId is required');
  if (!input.reason.trim()) throw new Error('proposal reason is required');

  const proposedAt = toIsoTime(input.proposedAt ?? new Date());
  const proposedObject: CanonicalObject<TPayload> = {
    ...input.object,
    review_state: 'PROPOSED',
    updated_by: input.capabilityId,
  };

  return {
    proposal_id: receiptId('write-proposal', {
      capability_id: input.capabilityId,
      object_id: proposedObject.object_id,
      content_hash: proposedObject.content_hash,
      proposed_at: proposedAt,
    }),
    state: 'WRITE_PROPOSAL',
    capability_id: input.capabilityId,
    proposed_object: proposedObject,
    reason: input.reason,
    proposed_at: proposedAt,
  };
}