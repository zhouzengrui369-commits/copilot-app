import { describe, expect, it } from 'vitest';
import {
  SHARED_ENGINE_SCHEMA_VERSION,
  classifySync,
  contentHash,
  createSyncEnvelope,
  objectId,
  receiptId,
  validateSyncEnvelope,
  type CanonicalObject,
  type SyncEnvelope,
} from '../src/shared-engine/index.js';

function object(input: {
  sourceIdentity?: string;
  namespace?: string;
  revision?: number;
  payload?: unknown;
  privacy?: CanonicalObject['privacy_class'];
  review?: CanonicalObject['review_state'];
  assertion?: CanonicalObject['assertion_type'];
  tombstone?: CanonicalObject['tombstone_state'];
  supersedes?: string | null;
  purposes?: string[];
  consumers?: string[];
  objectType?: CanonicalObject['object_type'];
} = {}): CanonicalObject {
  const namespace = input.namespace ?? 'personal';
  const objectType = input.objectType ?? 'Knowledge';
  const sourceIdentity = input.sourceIdentity ?? 'sync-object';
  const payload = input.payload ?? { value: 1 };
  return {
    object_id: objectId({ namespace, objectType, sourceIdentity }),
    object_type: objectType,
    namespace,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    source_refs: [],
    content_hash: contentHash(payload),
    observed_at: '2026-08-11T10:00:00Z',
    valid_from: null,
    valid_to: null,
    assertion_type: input.assertion ?? 'SYSTEM_INFERENCE',
    confidence: 0.8,
    review_state: input.review ?? 'PROPOSED',
    privacy_class: input.privacy ?? 'D1',
    permission_scope: {
      purposes: input.purposes ?? ['retrieval'],
      allowed_consumers: input.consumers ?? ['agent.test'],
      cloud_egress: 'DENY',
    },
    supersedes: input.supersedes ?? null,
    tombstone_state: input.tombstone ?? 'ACTIVE',
    created_by: 'test',
    updated_by: 'test',
    revision: input.revision ?? 1,
    payload,
  };
}

function successor(local: CanonicalObject, overrides: Partial<CanonicalObject> = {}): CanonicalObject {
  const payload = { value: local.revision + 1 };
  return {
    ...local,
    payload,
    content_hash: contentHash(payload),
    revision: local.revision + 1,
    supersedes: local.object_id,
    updated_by: 'sync.remote',
    ...overrides,
  };
}

function reidentify(envelope: SyncEnvelope, patch: Partial<SyncEnvelope>): SyncEnvelope {
  const value = { ...envelope, ...patch };
  const logical = {
    object_id: value.object_id,
    object_type: value.object_type,
    namespace: value.namespace,
    content_hash: value.content_hash,
    revision: value.revision,
    privacy_class: value.privacy_class,
    permission_fingerprint: value.permission_fingerprint,
    review_state: value.review_state,
    assertion_type: value.assertion_type,
    tombstone_state: value.tombstone_state,
    supersedes: value.supersedes,
  };
  return { ...value, envelope_id: receiptId('sync-envelope', logical) };
}

describe('C5 sync envelope validation', () => {
  it('creates deterministic envelopes for the same canonical state', () => {
    const canonical = object();
    expect(createSyncEnvelope(canonical)).toEqual(createSyncEnvelope(canonical));
  });

  it('rejects non-object, structural and identity tamper', () => {
    const envelope = createSyncEnvelope(object());
    expect(() => validateSyncEnvelope(null)).toThrow(/must be an object/);
    expect(() => validateSyncEnvelope({ ...envelope, revision: 0 })).toThrow(/structure/);
    expect(() => validateSyncEnvelope({ ...envelope, content_hash: 'sha256:bad' })).toThrow(/structure/);
    expect(() => validateSyncEnvelope({ ...envelope, permission_fingerprint: 'sha256:bad' })).toThrow(/structure/);
    expect(() => validateSyncEnvelope({ ...envelope, envelope_id: `${envelope.envelope_id}-tamper` })).toThrow(
      /identity mismatch/,
    );
  });

  it('fails closed on unsupported runtime enum values even with a self-consistent envelope id', () => {
    const envelope = createSyncEnvelope(object());
    expect(() => validateSyncEnvelope(reidentify(envelope, { privacy_class: 'D9' as 'D1' }))).toThrow(/structure/);
    expect(() => validateSyncEnvelope(reidentify(envelope, { review_state: 'AUTO_ACCEPTED' as 'PROPOSED' }))).toThrow(
      /structure/,
    );
    expect(() => validateSyncEnvelope(reidentify(envelope, { assertion_type: 'UNKNOWN' as 'SYSTEM_INFERENCE' }))).toThrow(
      /structure/,
    );
    expect(() => validateSyncEnvelope(reidentify(envelope, { tombstone_state: 'DELETED' as 'ACTIVE' }))).toThrow(
      /structure/,
    );
    expect(() => validateSyncEnvelope(reidentify(envelope, { object_type: 'Chunk' as 'Knowledge' }))).toThrow(/structure/);
  });
});

describe('C5 object-level sync classification', () => {
  it('returns IDENTICAL for exact object state and keeps decision id independent of time', () => {
    const envelope = createSyncEnvelope(object());
    const a = classifySync(envelope, envelope, '2026-08-11T10:00:00Z');
    const b = classifySync(envelope, envelope, '2026-08-11T11:00:00Z');
    expect(a.decision).toBe('IDENTICAL');
    expect(a.conflict_reasons).toEqual([]);
    expect(a.decision_id).toBe(b.decision_id);
    expect(a.decided_at).not.toBe(b.decided_at);
    expect(a.physical_write_performed).toBe(false);
  });

  it('returns IDENTITY_DRIFT if non-content authority differs at the same hash/revision', () => {
    const localObject = object();
    const local = createSyncEnvelope(localObject);
    const changedPermission = createSyncEnvelope({ ...localObject, permission_scope: { ...localObject.permission_scope, purposes: ['other'] } });
    const result = classifySync(local, changedPermission);
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toEqual(['IDENTITY_DRIFT']);
  });

  it('returns STALE for older incoming revisions without overwriting local state', () => {
    const older = object({ revision: 1, payload: { v: 1 } });
    const newer = object({ revision: 2, payload: { v: 2 } });
    const result = classifySync(createSyncEnvelope(newer), createSyncEnvelope(older));
    expect(result.decision).toBe('STALE');
    expect(result.physical_write_performed).toBe(false);
  });

  it('treats same-revision content divergence as a conflict rather than LWW', () => {
    const a = object({ revision: 2, payload: { side: 'a' } });
    const b = object({ revision: 2, payload: { side: 'b' } });
    const result = classifySync(createSyncEnvelope(a), createSyncEnvelope(b));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toEqual(['SAME_REVISION_DIVERGENCE']);
  });

  it('allows only an exact safe proposed D0/D1 successor lineage', () => {
    const localObject = object({ revision: 4, privacy: 'D1', review: 'PROPOSED', assertion: 'SYSTEM_INFERENCE' });
    const incoming = successor(localObject, { assertion_type: 'TEMPORARY_HYPOTHESIS' });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('APPLY_SUCCESSOR');
    expect(result.conflict_reasons).toEqual([]);
    expect(result.physical_write_performed).toBe(false);
  });

  it('rejects revision gaps', () => {
    const localObject = object({ revision: 1 });
    const incoming = successor(localObject, { revision: 3 });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toContain('REVISION_GAP');
  });

  it('rejects permission changes even for a proposed successor', () => {
    const localObject = object({ revision: 1 });
    const incoming = successor(localObject, {
      permission_scope: { ...localObject.permission_scope, allowed_consumers: ['another.agent'] },
    });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toContain('PERMISSION_CHANGE');
  });

  it('never auto-merges D2 or D3 objects', () => {
    for (const privacy of ['D2', 'D3'] as const) {
      const localObject = object({ revision: 1, privacy });
      const incoming = successor(localObject);
      const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
      expect(result.decision).toBe('CONFLICT');
      expect(result.conflict_reasons).toContain('PRIVACY_SENSITIVE');
    }
  });

  it('never auto-merges accepted, disputed, rejected or expired review state', () => {
    for (const review of ['ACCEPTED', 'DISPUTED', 'REJECTED', 'EXPIRED'] as const) {
      const localObject = object({ revision: 1, review });
      const incoming = successor(localObject, { review_state: review });
      const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
      expect(result.decision).toBe('CONFLICT');
      expect(result.conflict_reasons).toContain('REVIEW_SENSITIVE');
    }
  });

  it('never auto-merges tombstone state transitions', () => {
    const localObject = object({ revision: 1 });
    const incoming = successor(localObject, { tombstone_state: 'TOMBSTONED' });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toContain('TOMBSTONE_CHANGE');
  });

  it('limits automatic successors to inference/hypothesis assertions', () => {
    const localObject = object({ revision: 1, assertion: 'USER_DECLARED_FACT' });
    const incoming = successor(localObject, { assertion_type: 'USER_DECLARED_FACT' });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toContain('ASSERTION_NOT_AUTO_MERGEABLE');
  });

  it('requires explicit successor lineage', () => {
    const localObject = object({ revision: 1 });
    const incoming = successor(localObject, { supersedes: null });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toContain('MISSING_SUCCESSOR_LINEAGE');
  });

  it('reports multiple conflict reasons deterministically without payload content', () => {
    const localObject = object({ revision: 1, privacy: 'D2', review: 'ACCEPTED', assertion: 'USER_DECLARED_FACT' });
    const incoming = successor(localObject, {
      revision: 4,
      review_state: 'ACCEPTED',
      assertion_type: 'USER_DECLARED_FACT',
      tombstone_state: 'TOMBSTONED',
      supersedes: null,
      permission_scope: { ...localObject.permission_scope, purposes: ['changed'] },
      payload: { secret: 'must not appear in decision' },
      content_hash: contentHash({ secret: 'must not appear in decision' }),
    });
    const result = classifySync(createSyncEnvelope(localObject), createSyncEnvelope(incoming));
    expect(result.decision).toBe('CONFLICT');
    expect(result.conflict_reasons).toEqual([...result.conflict_reasons].sort());
    expect(result.conflict_reasons).toEqual(
      expect.arrayContaining([
        'REVISION_GAP',
        'PERMISSION_CHANGE',
        'PRIVACY_SENSITIVE',
        'REVIEW_SENSITIVE',
        'TOMBSTONE_CHANGE',
        'ASSERTION_NOT_AUTO_MERGEABLE',
        'MISSING_SUCCESSOR_LINEAGE',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('must not appear');
  });

  it('rejects envelopes for different canonical identities, types or namespaces', () => {
    const local = createSyncEnvelope(object({ sourceIdentity: 'a' }));
    const differentId = createSyncEnvelope(object({ sourceIdentity: 'b' }));
    expect(() => classifySync(local, differentId)).toThrow(/same canonical object/);

    const typeDrift = reidentify(local, { object_type: 'Entity' });
    expect(() => classifySync(local, typeDrift)).toThrow(/same canonical object/);

    const namespaceDrift = reidentify(local, { namespace: 'work' });
    expect(() => classifySync(local, namespaceDrift)).toThrow(/same canonical object/);
  });
});
