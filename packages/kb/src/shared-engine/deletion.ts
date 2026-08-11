import { type CanonicalObject, validateCanonicalObject } from './contract.js';
import { receiptId, toIsoTime } from './identity.js';

export const DELETION_CONTRACT_VERSION = '1' as const;

export const DELETION_TARGETS = [
  'SOURCE_BYTES',
  'CANONICAL_OBJECT',
  'WIKI',
  'CARD_2D',
  'GRAPH',
  'VECTOR',
  'FULL_TEXT',
  'DIALOGUE_CONTEXT',
  'CACHE',
  'REPLICA',
] as const;

export type DeletionTarget = (typeof DELETION_TARGETS)[number];
export type DeletionTargetState = 'DELETED' | 'TOMBSTONED' | 'PENDING' | 'BLOCKED' | 'FAILED';
export type DeletionOverallState = 'COMPLETE' | 'PENDING' | 'BLOCKED' | 'FAILED';
export type DeletionAuthorityKind = 'USER' | 'POLICY';

export interface DeletionAuthority {
  authority_kind: DeletionAuthorityKind;
  authority_id: string;
  reason_code: string;
}

export interface DeletionPlan {
  contract_version: typeof DELETION_CONTRACT_VERSION;
  plan_id: string;
  object_id: string;
  content_hash: string;
  revision: number;
  namespace: string;
  authority: DeletionAuthority;
  required_targets: readonly DeletionTarget[];
  requested_at: string;
}

export interface DeletionTargetReceipt {
  receipt_id: string;
  plan_id: string;
  object_id: string;
  target: DeletionTarget;
  state: DeletionTargetState;
  retryable: boolean;
  error_code: string | null;
  recorded_at: string;
}

export interface DeletionTombstone {
  tombstone_id: string;
  object_id: string;
  deleted_content_hash: string;
  deleted_revision: number;
  deletion_plan_id: string;
  deletion_receipt_ids: readonly string[];
  deleted_at: string;
  content_retained: false;
}

export interface DeletionResult {
  result_id: string;
  plan_id: string;
  object_id: string;
  overall_state: DeletionOverallState;
  completed_targets: readonly DeletionTarget[];
  pending_targets: readonly DeletionTarget[];
  blocked_targets: readonly DeletionTarget[];
  failed_targets: readonly DeletionTarget[];
  target_receipt_ids: readonly string[];
  tombstone: DeletionTombstone | null;
  evaluated_at: string;
}

export class DeletionContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DELETION_REQUEST'
      | 'INVALID_TARGET_RECEIPT'
      | 'DUPLICATE_TARGET_RECEIPT',
    message: string,
  ) {
    super(message);
    this.name = 'DeletionContractError';
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const MACHINE_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,79}$/;
const TARGET_SET = new Set<DeletionTarget>(DELETION_TARGETS);
const TERMINAL_SUCCESS = new Set<DeletionTargetState>(['DELETED', 'TOMBSTONED']);

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new DeletionContractError('INVALID_DELETION_REQUEST', `${field} is invalid`);
  }
  return normalized;
}

function requireMachineCode(value: string, field: string): string {
  const normalized = value.trim();
  if (!MACHINE_CODE_PATTERN.test(normalized)) {
    throw new DeletionContractError(
      'INVALID_DELETION_REQUEST',
      `${field} must be a bounded machine code`,
    );
  }
  return normalized;
}

function normalizeAuthority(authority: DeletionAuthority): DeletionAuthority {
  if (authority.authority_kind !== 'USER' && authority.authority_kind !== 'POLICY') {
    throw new DeletionContractError('INVALID_DELETION_REQUEST', 'unsupported deletion authority');
  }
  return {
    authority_kind: authority.authority_kind,
    authority_id: requireId(authority.authority_id, 'authority_id'),
    reason_code: requireMachineCode(authority.reason_code, 'reason_code'),
  };
}

export function createDeletionPlan(
  object: CanonicalObject,
  authority: DeletionAuthority,
  requestedAt: number | string | Date = new Date(),
): DeletionPlan {
  validateCanonicalObject(object);
  if (object.tombstone_state !== 'ACTIVE') {
    throw new DeletionContractError('INVALID_DELETION_REQUEST', 'object is already tombstoned');
  }
  const normalizedAuthority = normalizeAuthority(authority);
  const identity = {
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
    namespace: object.namespace,
    authority: normalizedAuthority,
    required_targets: DELETION_TARGETS,
  };
  return {
    contract_version: DELETION_CONTRACT_VERSION,
    plan_id: receiptId('deletion-plan', identity),
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
    namespace: object.namespace,
    authority: normalizedAuthority,
    required_targets: DELETION_TARGETS,
    requested_at: toIsoTime(requestedAt),
  };
}

function validatePlan(plan: DeletionPlan): void {
  if (
    plan.contract_version !== DELETION_CONTRACT_VERSION ||
    !ID_PATTERN.test(plan.plan_id) ||
    !ID_PATTERN.test(plan.object_id) ||
    !/^sha256:[a-f0-9]{64}$/.test(plan.content_hash) ||
    !Number.isInteger(plan.revision) ||
    plan.revision < 1 ||
    typeof plan.namespace !== 'string' ||
    plan.namespace.length === 0 ||
    plan.required_targets.length !== DELETION_TARGETS.length ||
    plan.required_targets.some((target, index) => target !== DELETION_TARGETS[index])
  ) {
    throw new DeletionContractError('INVALID_DELETION_REQUEST', 'deletion plan is malformed');
  }
  const expected = createDeletionPlan(
    {
      object_id: plan.object_id,
      object_type: 'Knowledge',
      namespace: plan.namespace,
      schema_version: '0.3.0-draft',
      source_refs: [],
      content_hash: plan.content_hash,
      observed_at: plan.requested_at,
      valid_from: null,
      valid_to: null,
      assertion_type: 'SOURCE_FACT',
      confidence: null,
      review_state: 'PROPOSED',
      privacy_class: 'D0',
      permission_scope: { purposes: [], allowed_consumers: [], cloud_egress: 'DENY' },
      supersedes: null,
      tombstone_state: 'ACTIVE',
      created_by: 'deletion-plan-validator',
      updated_by: 'deletion-plan-validator',
      revision: plan.revision,
      payload: null,
    },
    plan.authority,
    plan.requested_at,
  );
  if (expected.plan_id !== plan.plan_id) {
    throw new DeletionContractError('INVALID_DELETION_REQUEST', 'deletion plan identity mismatch');
  }
}

export function recordDeletionTarget(
  plan: DeletionPlan,
  input: {
    target: DeletionTarget;
    state: DeletionTargetState;
    retryable?: boolean;
    error_code?: string | null;
    recorded_at?: number | string | Date;
  },
): DeletionTargetReceipt {
  validatePlan(plan);
  if (!TARGET_SET.has(input.target)) {
    throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'unknown deletion target');
  }
  const success = TERMINAL_SUCCESS.has(input.state);
  const pending = input.state === 'PENDING';
  const errorCode = input.error_code ?? null;
  if (success && errorCode !== null) {
    throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'successful deletion target cannot carry error');
  }
  if (!success && !pending && (errorCode === null || !MACHINE_CODE_PATTERN.test(errorCode))) {
    throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'blocked/failed target requires machine error code');
  }
  if (pending && errorCode !== null && !MACHINE_CODE_PATTERN.test(errorCode)) {
    throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'pending error code is invalid');
  }
  const retryable = input.retryable ?? (input.state === 'PENDING' || input.state === 'FAILED');
  const logical = {
    plan_id: plan.plan_id,
    object_id: plan.object_id,
    target: input.target,
    state: input.state,
    retryable,
    error_code: errorCode,
  };
  return {
    receipt_id: receiptId('deletion-target', logical),
    ...logical,
    recorded_at: toIsoTime(input.recorded_at ?? new Date()),
  };
}

function overallState(receipts: ReadonlyMap<DeletionTarget, DeletionTargetReceipt>): DeletionOverallState {
  if (DELETION_TARGETS.every((target) => TERMINAL_SUCCESS.has(receipts.get(target)?.state ?? 'PENDING'))) {
    return 'COMPLETE';
  }
  if ([...receipts.values()].some((receipt) => receipt.state === 'FAILED')) return 'FAILED';
  if ([...receipts.values()].some((receipt) => receipt.state === 'BLOCKED')) return 'BLOCKED';
  return 'PENDING';
}

export function evaluateDeletion(
  plan: DeletionPlan,
  targetReceipts: readonly DeletionTargetReceipt[],
  evaluatedAt: number | string | Date = new Date(),
): DeletionResult {
  validatePlan(plan);
  const byTarget = new Map<DeletionTarget, DeletionTargetReceipt>();
  for (const receipt of targetReceipts) {
    if (
      receipt.plan_id !== plan.plan_id ||
      receipt.object_id !== plan.object_id ||
      !TARGET_SET.has(receipt.target)
    ) {
      throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'target receipt does not belong to plan');
    }
    const expected = recordDeletionTarget(plan, {
      target: receipt.target,
      state: receipt.state,
      retryable: receipt.retryable,
      error_code: receipt.error_code,
      recorded_at: receipt.recorded_at,
    });
    if (expected.receipt_id !== receipt.receipt_id) {
      throw new DeletionContractError('INVALID_TARGET_RECEIPT', 'target receipt identity mismatch');
    }
    if (byTarget.has(receipt.target)) {
      throw new DeletionContractError('DUPLICATE_TARGET_RECEIPT', `duplicate receipt for ${receipt.target}`);
    }
    byTarget.set(receipt.target, receipt);
  }

  const state = overallState(byTarget);
  const completedTargets = DELETION_TARGETS.filter((target) =>
    TERMINAL_SUCCESS.has(byTarget.get(target)?.state ?? 'PENDING'),
  );
  const pendingTargets = DELETION_TARGETS.filter(
    (target) => !byTarget.has(target) || byTarget.get(target)?.state === 'PENDING',
  );
  const blockedTargets = DELETION_TARGETS.filter((target) => byTarget.get(target)?.state === 'BLOCKED');
  const failedTargets = DELETION_TARGETS.filter((target) => byTarget.get(target)?.state === 'FAILED');
  const receiptIds = [...byTarget.values()].map((receipt) => receipt.receipt_id).sort();
  const evaluated = toIsoTime(evaluatedAt);
  const tombstone: DeletionTombstone | null =
    state === 'COMPLETE'
      ? {
          tombstone_id: receiptId('deletion-tombstone', {
            object_id: plan.object_id,
            content_hash: plan.content_hash,
            revision: plan.revision,
            plan_id: plan.plan_id,
            receipt_ids: receiptIds,
          }),
          object_id: plan.object_id,
          deleted_content_hash: plan.content_hash,
          deleted_revision: plan.revision,
          deletion_plan_id: plan.plan_id,
          deletion_receipt_ids: receiptIds,
          deleted_at: evaluated,
          content_retained: false,
        }
      : null;
  const logical = {
    plan_id: plan.plan_id,
    object_id: plan.object_id,
    overall_state: state,
    completed_targets: completedTargets,
    pending_targets: pendingTargets,
    blocked_targets: blockedTargets,
    failed_targets: failedTargets,
    target_receipt_ids: receiptIds,
    tombstone_id: tombstone?.tombstone_id ?? null,
  };
  return {
    result_id: receiptId('deletion-result', logical),
    plan_id: plan.plan_id,
    object_id: plan.object_id,
    overall_state: state,
    completed_targets: completedTargets,
    pending_targets: pendingTargets,
    blocked_targets: blockedTargets,
    failed_targets: failedTargets,
    target_receipt_ids: receiptIds,
    tombstone,
    evaluated_at: evaluated,
  };
}
