import {
  type CanonicalObject,
  type ReadDenyReason,
  validateCanonicalObject,
} from './contract.js';
import {
  AGENT_API_CONTRACT_VERSION,
  assertCapabilityActive,
  type CapabilitySession,
  validateCapabilitySession,
} from './capability.js';
import { receiptId, toIsoTime } from './identity.js';
import { authorizeCanonicalRead } from './policy.js';
import {
  rankAuthorizedProjectionHits,
  type RetrievalHit,
  type UnifiedRetrievalResult,
} from './retrieval.js';
import { createWriteProposal, type CreateWriteProposalInput } from './write-proposal.js';

export type AgentApiAction = 'READ_OBJECTS' | 'RETRIEVE' | 'WRITE_PROPOSAL';
export type AgentApiDecision = 'ALLOW' | 'PARTIAL' | 'DENY';
export type AgentObjectDenyReason = ReadDenyReason | 'OBJECT_NOT_FOUND';

export interface AgentObjectDenyAudit {
  object_id: string;
  reason: AgentObjectDenyReason;
}

export interface AgentApiReceipt {
  receipt_id: string;
  contract_version: typeof AGENT_API_CONTRACT_VERSION;
  session_id: string;
  manifest_id: string;
  capability_id: string;
  consumer_id: string;
  action: AgentApiAction;
  namespace: string;
  purpose: string;
  decision: AgentApiDecision;
  requested_object_ids: readonly string[];
  allowed_object_ids: readonly string[];
  denied: readonly AgentObjectDenyAudit[];
  linked_receipt_id: string | null;
  completed_at: string;
}

export interface ReadObjectsInput {
  session: CapabilitySession;
  canonical_objects: readonly CanonicalObject[];
  object_ids: readonly string[];
  namespace: string;
  purpose: string;
  completed_at?: number | string | Date;
}

export interface ReadObjectsResult {
  objects: CanonicalObject[];
  receipt: AgentApiReceipt;
}

export interface AgentRetrievalInput {
  session: CapabilitySession;
  canonical_objects: readonly CanonicalObject[];
  hits: readonly RetrievalHit[];
  namespace: string;
  purpose: string;
  completed_at?: number | string | Date;
}

export interface AgentRetrievalResult {
  retrieval: UnifiedRetrievalResult;
  receipt: AgentApiReceipt;
}

export interface AgentWriteProposalInput<TPayload> {
  session: CapabilitySession;
  object: CanonicalObject<TPayload>;
  namespace: string;
  purpose: string;
  reason_code: string;
  proposed_at?: number | string | Date;
}

export interface AgentWriteProposalResult<TPayload> {
  proposal: ReturnType<typeof createWriteProposal<TPayload>>;
  receipt: AgentApiReceipt;
}

export class AgentApiContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_AGENT_REQUEST'
      | 'NAMESPACE_NOT_GRANTED'
      | 'PURPOSE_NOT_GRANTED'
      | 'WRITE_NOT_GRANTED'
      | 'OBJECT_TYPE_NOT_GRANTED',
    message: string,
  ) {
    super(message);
    this.name = 'AgentApiContractError';
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const MACHINE_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,79}$/;

function requireGrant(value: string, field: string): string {
  const trimmed = value.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw new AgentApiContractError('INVALID_AGENT_REQUEST', `${field} is invalid`);
  }
  return trimmed;
}

function requireMachineCode(value: string, field: string): string {
  const trimmed = value.trim();
  if (!MACHINE_CODE_PATTERN.test(trimmed)) {
    throw new AgentApiContractError(
      'INVALID_AGENT_REQUEST',
      `${field} must be a bounded machine code`,
    );
  }
  return trimmed;
}

function authorizeRequestScope(
  session: CapabilitySession,
  namespaceValue: string,
  purposeValue: string,
  at: number | string | Date,
) {
  validateCapabilitySession(session, at);
  assertCapabilityActive(session.manifest, at);
  const namespace = requireGrant(namespaceValue, 'namespace');
  const purpose = requireGrant(purposeValue, 'purpose');
  if (!session.manifest.namespaces.includes(namespace)) {
    throw new AgentApiContractError('NAMESPACE_NOT_GRANTED', 'namespace is not granted by capability');
  }
  if (!session.manifest.purposes.includes(purpose)) {
    throw new AgentApiContractError('PURPOSE_NOT_GRANTED', 'purpose is not granted by capability');
  }
  return {
    namespace,
    purpose,
    readRequest: {
      capability_id: session.manifest.capability_id,
      namespace,
      purpose,
      privacy_ceiling: session.manifest.privacy_ceiling,
      allowed_object_types: session.manifest.allowed_read_types,
    },
  } as const;
}

function decisionForCounts(allowedCount: number, deniedCount: number): AgentApiDecision {
  if (allowedCount > 0 && deniedCount > 0) return 'PARTIAL';
  if (allowedCount > 0) return 'ALLOW';
  return 'DENY';
}

function createApiReceipt(input: {
  session: CapabilitySession;
  action: AgentApiAction;
  namespace: string;
  purpose: string;
  requestedObjectIds: readonly string[];
  allowedObjectIds: readonly string[];
  denied: readonly AgentObjectDenyAudit[];
  linkedReceiptId?: string | null;
  completedAt: string;
}): AgentApiReceipt {
  const requestedObjectIds = [...new Set(input.requestedObjectIds)].sort();
  const allowedObjectIds = [...new Set(input.allowedObjectIds)].sort();
  const denied = [...input.denied].sort(
    (a, b) => a.object_id.localeCompare(b.object_id) || a.reason.localeCompare(b.reason),
  );
  const decision = decisionForCounts(allowedObjectIds.length, denied.length);
  const logicalReceipt = {
    session_id: input.session.session_id,
    manifest_id: input.session.manifest.manifest_id,
    action: input.action,
    namespace: input.namespace,
    purpose: input.purpose,
    decision,
    requested_object_ids: requestedObjectIds,
    allowed_object_ids: allowedObjectIds,
    denied,
    linked_receipt_id: input.linkedReceiptId ?? null,
  };
  return {
    receipt_id: receiptId('agent-api', logicalReceipt),
    contract_version: AGENT_API_CONTRACT_VERSION,
    session_id: input.session.session_id,
    manifest_id: input.session.manifest.manifest_id,
    capability_id: input.session.manifest.capability_id,
    consumer_id: input.session.manifest.consumer_id,
    action: input.action,
    namespace: input.namespace,
    purpose: input.purpose,
    decision,
    requested_object_ids: requestedObjectIds,
    allowed_object_ids: allowedObjectIds,
    denied,
    linked_receipt_id: input.linkedReceiptId ?? null,
    completed_at: input.completedAt,
  };
}

function canonicalMap(objects: readonly CanonicalObject[]): Map<string, CanonicalObject> {
  const result = new Map<string, CanonicalObject>();
  for (const object of objects) {
    validateCanonicalObject(object);
    const current = result.get(object.object_id);
    if (current && (current.content_hash !== object.content_hash || current.revision !== object.revision)) {
      throw new AgentApiContractError(
        'INVALID_AGENT_REQUEST',
        'canonical_objects contains conflicting versions for one object_id',
      );
    }
    result.set(object.object_id, object);
  }
  return result;
}

export function readCanonicalObjects(input: ReadObjectsInput): ReadObjectsResult {
  const completedAt = toIsoTime(input.completed_at ?? new Date());
  const scope = authorizeRequestScope(input.session, input.namespace, input.purpose, completedAt);
  const byId = canonicalMap(input.canonical_objects);
  const requestedObjectIds = [...new Set(input.object_ids.map((value) => requireGrant(value, 'object_id')))].sort();
  if (requestedObjectIds.length === 0) {
    throw new AgentApiContractError('INVALID_AGENT_REQUEST', 'at least one object_id is required');
  }

  const objects: CanonicalObject[] = [];
  const denied: AgentObjectDenyAudit[] = [];
  for (const objectId of requestedObjectIds) {
    const object = byId.get(objectId);
    if (!object) {
      denied.push({ object_id: objectId, reason: 'OBJECT_NOT_FOUND' });
      continue;
    }
    const decision = authorizeCanonicalRead(object, scope.readRequest, completedAt);
    if (!decision.allowed || !decision.object) {
      if (decision.receipt.reason === 'POLICY_MATCH') {
        throw new AgentApiContractError('INVALID_AGENT_REQUEST', 'denied read unexpectedly matched policy');
      }
      denied.push({ object_id: objectId, reason: decision.receipt.reason });
      continue;
    }
    objects.push(decision.object);
  }

  objects.sort((a, b) => a.object_id.localeCompare(b.object_id));
  return {
    objects,
    receipt: createApiReceipt({
      session: input.session,
      action: 'READ_OBJECTS',
      namespace: scope.namespace,
      purpose: scope.purpose,
      requestedObjectIds,
      allowedObjectIds: objects.map((object) => object.object_id),
      denied,
      completedAt,
    }),
  };
}

export function retrieveForAgent(input: AgentRetrievalInput): AgentRetrievalResult {
  const completedAt = toIsoTime(input.completed_at ?? new Date());
  const scope = authorizeRequestScope(input.session, input.namespace, input.purpose, completedAt);
  const retrieval = rankAuthorizedProjectionHits(
    input.hits,
    input.canonical_objects,
    scope.readRequest,
    completedAt,
  );
  const denied: AgentObjectDenyAudit[] = retrieval.receipt.denied.map((entry) => ({
    object_id: entry.object_id,
    reason: entry.reason,
  }));
  return {
    retrieval,
    receipt: createApiReceipt({
      session: input.session,
      action: 'RETRIEVE',
      namespace: scope.namespace,
      purpose: scope.purpose,
      requestedObjectIds: input.hits.map((hit) => hit.projection.canonical_object_id),
      allowedObjectIds: retrieval.results.map((result) => result.object_id),
      denied,
      linkedReceiptId: retrieval.receipt.receipt_id,
      completedAt,
    }),
  };
}

export function submitAgentWriteProposal<TPayload>(
  input: AgentWriteProposalInput<TPayload>,
): AgentWriteProposalResult<TPayload> {
  const proposedAt = toIsoTime(input.proposed_at ?? new Date());
  const scope = authorizeRequestScope(input.session, input.namespace, input.purpose, proposedAt);
  validateCanonicalObject(input.object);
  if (input.session.manifest.write_mode !== 'WRITE_PROPOSAL') {
    throw new AgentApiContractError('WRITE_NOT_GRANTED', 'capability is read-only');
  }
  if (input.object.namespace !== scope.namespace) {
    throw new AgentApiContractError('NAMESPACE_NOT_GRANTED', 'proposed object namespace is not granted');
  }
  if (!input.session.manifest.allowed_read_types.includes(input.object.object_type)) {
    throw new AgentApiContractError('OBJECT_TYPE_NOT_GRANTED', 'proposed object type is not granted');
  }

  const policyDecision = authorizeCanonicalRead(input.object, scope.readRequest, proposedAt);
  if (!policyDecision.allowed) {
    throw new AgentApiContractError(
      'WRITE_NOT_GRANTED',
      'proposed object is outside granted capability scope',
    );
  }

  const reasonCode = requireMachineCode(input.reason_code, 'reason_code');
  const proposalInput: CreateWriteProposalInput<TPayload> = {
    capabilityId: input.session.manifest.capability_id,
    object: input.object,
    reason: reasonCode,
    proposedAt,
  };
  const proposal = createWriteProposal(proposalInput);
  return {
    proposal,
    receipt: createApiReceipt({
      session: input.session,
      action: 'WRITE_PROPOSAL',
      namespace: scope.namespace,
      purpose: scope.purpose,
      requestedObjectIds: [input.object.object_id],
      allowedObjectIds: [proposal.proposed_object.object_id],
      denied: [],
      linkedReceiptId: proposal.proposal_id,
      completedAt: proposedAt,
    }),
  };
}
