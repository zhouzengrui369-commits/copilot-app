import { describe, expect, it } from 'vitest';
import {
  DELETION_TARGETS,
  SHARED_ENGINE_SCHEMA_VERSION,
  contentHash,
  createDeletionPlan,
  evaluateDeletion,
  objectId,
  recordDeletionTarget,
  type CanonicalObject,
  type DeletionTarget,
  type DeletionTargetReceipt,
} from '../src/shared-engine/index.js';

function object(overrides: Partial<CanonicalObject> = {}): CanonicalObject {
  const payload = { title: 'delete me' };
  return {
    object_id: objectId({ namespace: 'personal', objectType: 'Knowledge', sourceIdentity: 'delete-me' }),
    object_type: 'Knowledge',
    namespace: 'personal',
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    source_refs: [],
    content_hash: contentHash(payload),
    observed_at: '2026-08-11T10:00:00Z',
    valid_from: null,
    valid_to: null,
    assertion_type: 'USER_DECLARED_FACT',
    confidence: 1,
    review_state: 'ACCEPTED',
    privacy_class: 'D1',
    permission_scope: {
      purposes: ['retrieval'],
      allowed_consumers: ['agent.test'],
      cloud_egress: 'DENY',
    },
    supersedes: null,
    tombstone_state: 'ACTIVE',
    created_by: 'user',
    updated_by: 'user',
    revision: 3,
    payload,
    ...overrides,
  };
}

function plan() {
  return createDeletionPlan(
    object(),
    { authority_kind: 'USER', authority_id: 'owner', reason_code: 'USER_DELETE' },
    '2026-08-11T10:00:00Z',
  );
}

function successReceipts(
  targetState: (target: DeletionTarget) => 'DELETED' | 'TOMBSTONED' = (target) =>
    target === 'CANONICAL_OBJECT' ? 'TOMBSTONED' : 'DELETED',
): DeletionTargetReceipt[] {
  const deletionPlan = plan();
  return DELETION_TARGETS.map((target) =>
    recordDeletionTarget(deletionPlan, {
      target,
      state: targetState(target),
      recorded_at: '2026-08-11T10:10:00Z',
    }),
  );
}

describe('C5 deletion planning', () => {
  it('creates deterministic plans independent of request time', () => {
    const value = object();
    const authority = { authority_kind: 'USER' as const, authority_id: 'owner', reason_code: 'USER_DELETE' };
    const a = createDeletionPlan(value, authority, '2026-08-11T10:00:00Z');
    const b = createDeletionPlan(value, authority, '2026-08-11T11:00:00Z');
    expect(a.plan_id).toBe(b.plan_id);
    expect(a.requested_at).not.toBe(b.requested_at);
    expect(a.required_targets).toEqual(DELETION_TARGETS);
  });

  it('supports explicit policy authority', () => {
    const value = createDeletionPlan(
      object(),
      { authority_kind: 'POLICY', authority_id: 'retention.policy', reason_code: 'RETENTION_EXPIRED' },
      '2026-08-11T10:00:00Z',
    );
    expect(value.authority.authority_kind).toBe('POLICY');
  });

  it('rejects already tombstoned objects and malformed authority', () => {
    expect(() =>
      createDeletionPlan(
        object({ tombstone_state: 'TOMBSTONED' }),
        { authority_kind: 'USER', authority_id: 'owner', reason_code: 'USER_DELETE' },
      ),
    ).toThrow(/already tombstoned/);
    expect(() =>
      createDeletionPlan(object(), {
        authority_kind: 'AGENT' as 'USER',
        authority_id: 'agent',
        reason_code: 'AGENT_DELETE',
      }),
    ).toThrow(/authority/);
    expect(() =>
      createDeletionPlan(object(), {
        authority_kind: 'USER',
        authority_id: 'bad id',
        reason_code: 'USER_DELETE',
      }),
    ).toThrow(/authority_id/);
    expect(() =>
      createDeletionPlan(object(), {
        authority_kind: 'USER',
        authority_id: 'owner',
        reason_code: 'free form reason',
      }),
    ).toThrow(/machine code/);
  });
});

describe('C5 deletion target receipts', () => {
  it('records successful, pending, blocked and failed target states content-safely', () => {
    const p = plan();
    const deleted = recordDeletionTarget(p, { target: 'SOURCE_BYTES', state: 'DELETED' });
    const pending = recordDeletionTarget(p, { target: 'REPLICA', state: 'PENDING', error_code: 'REMOTE_PENDING' });
    const blocked = recordDeletionTarget(p, {
      target: 'CACHE',
      state: 'BLOCKED',
      error_code: 'OWNER_AUTH_REQUIRED',
    });
    const failed = recordDeletionTarget(p, {
      target: 'VECTOR',
      state: 'FAILED',
      error_code: 'INDEX_DELETE_FAILED',
    });
    expect(deleted.error_code).toBeNull();
    expect(deleted.retryable).toBe(false);
    expect(pending.retryable).toBe(true);
    expect(blocked.retryable).toBe(false);
    expect(failed.retryable).toBe(true);
    expect(JSON.stringify([deleted, pending, blocked, failed])).not.toContain('delete me');
  });

  it('rejects success receipts with errors and blocked/failed receipts without machine errors', () => {
    const p = plan();
    expect(() =>
      recordDeletionTarget(p, { target: 'WIKI', state: 'DELETED', error_code: 'SHOULD_NOT_EXIST' }),
    ).toThrow(/cannot carry error/);
    expect(() => recordDeletionTarget(p, { target: 'WIKI', state: 'FAILED' })).toThrow(/requires machine error/);
    expect(() =>
      recordDeletionTarget(p, { target: 'WIKI', state: 'BLOCKED', error_code: 'free form' }),
    ).toThrow(/machine error/);
    expect(() =>
      recordDeletionTarget(p, { target: 'WIKI', state: 'PENDING', error_code: 'free form' }),
    ).toThrow(/pending error/);
  });

  it('rejects unknown and invalid runtime target states', () => {
    const p = plan();
    expect(() => recordDeletionTarget(p, { target: 'UNKNOWN' as DeletionTarget, state: 'DELETED' })).toThrow(
      /unknown deletion target/,
    );
    expect(() =>
      recordDeletionTarget(p, {
        target: 'WIKI',
        state: 'SUCCESS' as 'DELETED',
        error_code: 'UNEXPECTED_STATE',
      }),
    ).toThrow(/state/);
  });

  it('rejects a tampered deletion plan identity', () => {
    const p = plan();
    expect(() => recordDeletionTarget({ ...p, plan_id: `${p.plan_id}-tamper` }, { target: 'WIKI', state: 'DELETED' })).toThrow(
      /identity mismatch/,
    );
  });
});

describe('C5 deletion aggregate truthfulness', () => {
  it('never reports complete when target receipts are missing', () => {
    const p = plan();
    const result = evaluateDeletion(p, [], '2026-08-11T10:20:00Z');
    expect(result.overall_state).toBe('PENDING');
    expect(result.pending_targets).toEqual(DELETION_TARGETS);
    expect(result.tombstone).toBeNull();
  });

  it('reports PENDING while any required target remains pending', () => {
    const p = plan();
    const receipts = DELETION_TARGETS.slice(0, -1).map((target) =>
      recordDeletionTarget(p, { target, state: 'DELETED' }),
    );
    const result = evaluateDeletion(p, receipts);
    expect(result.overall_state).toBe('PENDING');
    expect(result.pending_targets).toEqual(['REPLICA']);
    expect(result.tombstone).toBeNull();
  });

  it('prioritizes FAILED over BLOCKED and BLOCKED over PENDING', () => {
    const p = plan();
    const pending = recordDeletionTarget(p, { target: 'REPLICA', state: 'PENDING' });
    const blocked = recordDeletionTarget(p, {
      target: 'CACHE',
      state: 'BLOCKED',
      error_code: 'CACHE_BUSY',
    });
    expect(evaluateDeletion(p, [pending, blocked]).overall_state).toBe('BLOCKED');

    const failed = recordDeletionTarget(p, {
      target: 'VECTOR',
      state: 'FAILED',
      error_code: 'INDEX_DELETE_FAILED',
    });
    expect(evaluateDeletion(p, [pending, blocked, failed]).overall_state).toBe('FAILED');
  });

  it('returns COMPLETE only after every required target is deleted/tombstoned', () => {
    const p = plan();
    const receipts = DELETION_TARGETS.map((target) =>
      recordDeletionTarget(p, {
        target,
        state: target === 'CANONICAL_OBJECT' ? 'TOMBSTONED' : 'DELETED',
        recorded_at: '2026-08-11T10:10:00Z',
      }),
    );
    const result = evaluateDeletion(p, receipts, '2026-08-11T10:20:00Z');
    expect(result.overall_state).toBe('COMPLETE');
    expect(result.completed_targets).toEqual(DELETION_TARGETS);
    expect(result.pending_targets).toEqual([]);
    expect(result.failed_targets).toEqual([]);
    expect(result.blocked_targets).toEqual([]);
    expect(result.tombstone?.content_retained).toBe(false);
    expect(JSON.stringify(result.tombstone)).not.toContain('delete me');
    expect(result.tombstone?.deleted_content_hash).toBe(p.content_hash);
  });

  it('keeps complete result identity stable while timestamps may change', () => {
    const p = plan();
    const receipts = DELETION_TARGETS.map((target) => recordDeletionTarget(p, { target, state: 'DELETED' }));
    const a = evaluateDeletion(p, receipts, '2026-08-11T10:20:00Z');
    const b = evaluateDeletion(p, receipts, '2026-08-11T11:20:00Z');
    expect(a.result_id).toBe(b.result_id);
    expect(a.tombstone?.tombstone_id).toBe(b.tombstone?.tombstone_id);
    expect(a.evaluated_at).not.toBe(b.evaluated_at);
  });

  it('rejects duplicate, wrong-plan and tampered target receipts', () => {
    const p = plan();
    const receipt = recordDeletionTarget(p, { target: 'WIKI', state: 'DELETED' });
    expect(() => evaluateDeletion(p, [receipt, receipt])).toThrow(/duplicate receipt/);
    expect(() => evaluateDeletion(p, [{ ...receipt, plan_id: 'ske-receipt:other:sha256:deadbeef' }])).toThrow(
      /does not belong/,
    );
    expect(() => evaluateDeletion(p, [{ ...receipt, receipt_id: `${receipt.receipt_id}-tamper` }])).toThrow(
      /identity mismatch/,
    );
  });
});
