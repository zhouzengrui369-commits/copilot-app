import {
  type CanonicalObject,
  type ReadCapabilityRequest,
  type ReadDecisionReceipt,
  type ReadDenyReason,
  validateCanonicalObject,
} from './contract.js';
import { receiptId, toIsoTime } from './identity.js';

const PRIVACY_RANK = { D0: 0, D1: 1, D2: 2, D3: 3 } as const;

export interface ReadDecision<TPayload = unknown> {
  allowed: boolean;
  object: CanonicalObject<TPayload> | null;
  receipt: ReadDecisionReceipt;
}

function denyReason(object: CanonicalObject, request: ReadCapabilityRequest): ReadDenyReason | null {
  if (object.namespace !== request.namespace) return 'NAMESPACE_DENIED';
  if (!object.permission_scope.purposes.includes(request.purpose)) return 'PURPOSE_DENIED';
  if (!object.permission_scope.allowed_consumers.includes(request.capability_id)) return 'CONSUMER_DENIED';
  if (PRIVACY_RANK[object.privacy_class] > PRIVACY_RANK[request.privacy_ceiling]) return 'PRIVACY_DENIED';
  if (request.allowed_object_types && !request.allowed_object_types.includes(object.object_type)) {
    return 'OBJECT_TYPE_DENIED';
  }
  return null;
}

export function authorizeCanonicalRead<TPayload>(
  object: CanonicalObject<TPayload>,
  request: ReadCapabilityRequest,
  decidedAt: number | string | Date = new Date(),
): ReadDecision<TPayload> {
  validateCanonicalObject(object);
  const at = toIsoTime(decidedAt);
  const denied = denyReason(object, request);
  const decision = denied ? 'DENY' : 'ALLOW';
  const reason = denied ?? 'POLICY_MATCH';
  const receipt: ReadDecisionReceipt = {
    receipt_id: receiptId('read', {
      object_id: object.object_id,
      capability_id: request.capability_id,
      purpose: request.purpose,
      decision,
      reason,
      decided_at: at,
    }),
    object_id: object.object_id,
    capability_id: request.capability_id,
    purpose: request.purpose,
    decision,
    reason,
    decided_at: at,
  };

  return {
    allowed: !denied,
    object: denied ? null : object,
    receipt,
  };
}

export function filterCanonicalReads(
  objects: readonly CanonicalObject[],
  request: ReadCapabilityRequest,
  decidedAt: number | string | Date = new Date(),
): { objects: CanonicalObject[]; receipts: ReadDecisionReceipt[] } {
  const objectsAllowed: CanonicalObject[] = [];
  const receipts: ReadDecisionReceipt[] = [];

  for (const object of objects) {
    const decision = authorizeCanonicalRead(object, request, decidedAt);
    receipts.push(decision.receipt);
    if (decision.object) objectsAllowed.push(decision.object);
  }

  return { objects: objectsAllowed, receipts };
}