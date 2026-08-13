import { describe, expect, it } from 'vitest';
import {
  authorizeCanonicalRead,
  createWriteProposal,
  filterCanonicalReads,
  mapLegacyEntity,
  mapLegacyNote,
  mapLegacyRelation,
  objectId,
  receiptId,
  sha256Hex,
  stableSerialize,
  toIsoTime,
  validateCanonicalObject,
  type C1AdapterContext,
  type CanonicalObject,
  type LegacyEntitySnapshot,
  type LegacyNoteSnapshot,
  type LegacyRelationSnapshot,
  type RevisionState,
} from '../src/shared-engine/index.js';

const baseContext: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['knowledge_management', 'retrieval'],
  allowedConsumers: ['copilot.desktop', 'agent.reader'],
  privacyClass: 'D1',
};

const baseNote: LegacyNoteSnapshot = {
  path: 'notes/c1-boundaries',
  title: 'C1 boundaries',
  type: 'note',
  status: 'active',
  tags: ['c1'],
  related: [],
  sourceHash: 'legacy-source-hash',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.8,
  agent: null,
  body: 'boundary body',
};

function validKnowledge(): CanonicalObject {
  return mapLegacyNote(baseNote, baseContext).knowledge.object;
}

function revisionState(object: CanonicalObject): RevisionState {
  return {
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
  };
}

describe('C1 identity fail-closed boundaries', () => {
  it('canonicalizes arrays and omits undefined object members', () => {
    expect(stableSerialize({ b: undefined, a: [true, null, 1] })).toBe('{"a":[true,null,1]}');
    expect(stableSerialize('value')).toBe('"value"');
  });

  it('rejects non-finite and unsupported canonical JSON values', () => {
    expect(() => stableSerialize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => stableSerialize(undefined)).toThrow(/unsupported canonical JSON value/);
  });

  it('rejects incomplete object identities and empty receipt kinds', () => {
    expect(() => objectId({ namespace: '', objectType: 'Knowledge', sourceIdentity: 'x' })).toThrow(
      /namespace and sourceIdentity/,
    );
    expect(() => objectId({ namespace: 'personal', objectType: 'Knowledge', sourceIdentity: ' ' })).toThrow(
      /namespace and sourceIdentity/,
    );
    expect(() => receiptId('   ', {})).toThrow(/receipt kind/);
  });

  it('supports binary hashing and rejects invalid timestamps', () => {
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toMatch(/^[a-f0-9]{64}$/);
    expect(toIsoTime(new Date('2026-08-11T08:00:00.000Z'))).toBe('2026-08-11T08:00:00.000Z');
    expect(() => toIsoTime('not-a-date')).toThrow(/invalid timestamp/);
  });
});

describe('C1 canonical envelope validation boundaries', () => {
  it('rejects non-object and unsupported schema inputs', () => {
    expect(() => validateCanonicalObject(null)).toThrow(/must be an object/);
    const object = validKnowledge();
    expect(() => validateCanonicalObject({ ...object, schema_version: '1.0.0' })).toThrow(
      /unsupported schema version/,
    );
  });

  it('rejects malformed required envelope fields', () => {
    const object = validKnowledge();
    const invalidObjects: unknown[] = [
      { ...object, object_id: 'row:42' },
      { ...object, object_type: 'PhysicalRow' },
      { ...object, namespace: '' },
      { ...object, source_refs: 'not-an-array' },
      { ...object, content_hash: 'sha256:bad' },
      { ...object, observed_at: 123 },
      { ...object, assertion_type: 'UNKNOWN_ASSERTION' },
      { ...object, review_state: 'AUTO_ACCEPTED' },
      { ...object, privacy_class: 'D9' },
      { ...object, tombstone_state: 'DELETED_FOREVER' },
      { ...object, created_by: 42 },
      { ...object, updated_by: 42 },
      { ...object, revision: 0 },
      { ...object, revision: 1.5 },
    ];

    for (const invalid of invalidObjects) {
      expect(() => validateCanonicalObject(invalid)).toThrow(/canonical object envelope is invalid/);
    }
  });

  it('rejects invalid confidence values', () => {
    const object = validKnowledge();
    for (const confidence of [-0.01, 1.01, Number.NaN]) {
      expect(() => validateCanonicalObject({ ...object, confidence })).toThrow(/confidence/);
    }
    expect(() => validateCanonicalObject({ ...object, confidence: null })).not.toThrow();
  });

  it('rejects malformed permission scopes independently', () => {
    const object = validKnowledge();
    expect(() => validateCanonicalObject({ ...object, permission_scope: null })).toThrow(/permission_scope/);
    expect(() =>
      validateCanonicalObject({
        ...object,
        permission_scope: { ...object.permission_scope, purposes: 'retrieval' },
      }),
    ).toThrow(/permission_scope/);
    expect(() =>
      validateCanonicalObject({
        ...object,
        permission_scope: { ...object.permission_scope, allowed_consumers: 'agent.reader' },
      }),
    ).toThrow(/permission_scope/);
    expect(() =>
      validateCanonicalObject({
        ...object,
        permission_scope: { ...object.permission_scope, cloud_egress: 'OPEN_INTERNET' },
      }),
    ).toThrow(/permission_scope/);
  });
});

describe('C1 adapter revision and provenance boundaries', () => {
  it('uses content identity as source revision when legacy source hash is absent', () => {
    const mapped = mapLegacyNote(
      { ...baseNote, sourceHash: null, confidence: null },
      {
        namespace: 'personal',
        actorId: 'user:owner',
        purposes: ['retrieval'],
        allowedConsumers: ['agent.reader'],
      },
    );
    expect(mapped.source.object.payload.source_revision).toBe(mapped.source.object.content_hash);
    expect(mapped.source.object.privacy_class).toBe('D1');
    expect(mapped.source.object.permission_scope.cloud_egress).toBe('DENY');
    expect(mapped.knowledge.object.confidence).toBeNull();
  });

  it('rejects empty note identities and out-of-range legacy confidence', () => {
    expect(() => mapLegacyNote({ ...baseNote, path: ' ' }, baseContext)).toThrow(/note path/);
    expect(() => mapLegacyNote({ ...baseNote, confidence: -0.1 }, baseContext)).toThrow(/confidence/);
    expect(() => mapLegacyNote({ ...baseNote, confidence: 1.1 }, baseContext)).toThrow(/confidence/);
    expect(() => mapLegacyNote({ ...baseNote, confidence: Number.NaN }, baseContext)).toThrow(/confidence/);
  });

  it('rejects previous revision records bound to another object or invalid revision', () => {
    const first = mapLegacyNote(baseNote, baseContext);
    expect(() =>
      mapLegacyNote(baseNote, baseContext, {
        knowledge: { ...revisionState(first.knowledge.object), object_id: 'ske:0.3:knowledge:sha256:other' },
      }),
    ).toThrow(/object_id does not match/);
    expect(() =>
      mapLegacyNote(baseNote, baseContext, {
        source: { ...revisionState(first.source.object), revision: 0 },
      }),
    ).toThrow(/positive integer/);
  });

  it('changes Source and Knowledge revisions when first-class source provenance changes', () => {
    const first = mapLegacyNote(baseNote, baseContext);
    const previous = {
      source: revisionState(first.source.object),
      knowledge: revisionState(first.knowledge.object),
    };
    const revised = mapLegacyNote({ ...baseNote, sourceHash: 'new-source-hash' }, baseContext, previous);
    expect(revised.source.object.object_id).toBe(first.source.object.object_id);
    expect(revised.source.receipt.operation).toBe('REVISED');
    expect(revised.knowledge.receipt.operation).toBe('REVISED');
    expect(revised.source.object.payload.source_revision).toBe('new-source-hash');
  });

  it('binds Entity source refs into revision lineage and supports explicit review taxonomy', () => {
    const entity: LegacyEntitySnapshot = {
      legacyId: 'entity-boundary',
      type: 'concept',
      name: 'Boundary',
      aliases: [],
      summary: null,
      confidence: null,
      sourceNotePaths: ['notes/a'],
      createdAt: baseNote.createdAt,
      updatedAt: baseNote.updatedAt,
    };
    const first = mapLegacyEntity(entity, baseContext, {
      assertionType: 'DIRECT_OBSERVATION',
      reviewState: 'ACCEPTED',
    });
    expect(first.object.assertion_type).toBe('DIRECT_OBSERVATION');
    expect(first.object.review_state).toBe('ACCEPTED');
    expect(first.object.confidence).toBeNull();

    const revised = mapLegacyEntity(
      { ...entity, sourceNotePaths: ['notes/a', 'notes/b'], updatedAt: entity.updatedAt + 1_000 },
      { ...baseContext, privacyClass: 'D0', cloudEgress: 'ASK_EACH_TIME' },
      { previous: revisionState(first.object) },
    );
    expect(revised.receipt.operation).toBe('REVISED');
    expect(revised.object.revision).toBe(2);
    expect(revised.object.privacy_class).toBe('D0');
    expect(revised.object.permission_scope.cloud_egress).toBe('ASK_EACH_TIME');
  });

  it('binds Relation source refs into revision lineage', () => {
    const relation: LegacyRelationSnapshot = {
      fromLegacyEntityId: 'e1',
      toLegacyEntityId: 'e2',
      predicate: 'supports',
      weight: null,
      sourceNotePaths: ['notes/a'],
      createdAt: baseNote.updatedAt,
    };
    const first = mapLegacyRelation(relation, baseContext, {
      assertionType: 'SOURCE_FACT',
      reviewState: 'ACCEPTED',
    });
    const revised = mapLegacyRelation(
      { ...relation, sourceNotePaths: ['notes/a', 'notes/c'] },
      baseContext,
      { previous: revisionState(first.object) },
    );
    expect(first.object.assertion_type).toBe('SOURCE_FACT');
    expect(first.object.review_state).toBe('ACCEPTED');
    expect(revised.receipt.operation).toBe('REVISED');
    expect(revised.object.revision).toBe(2);
  });
});

describe('C1 policy-filtered read boundaries', () => {
  it('distinguishes namespace, consumer and object-type denials', () => {
    const object = validKnowledge();
    const baseRequest = {
      capability_id: 'agent.reader',
      namespace: 'personal',
      purpose: 'retrieval',
      privacy_ceiling: 'D1' as const,
    };

    expect(authorizeCanonicalRead(object, { ...baseRequest, namespace: 'work' }).receipt.reason).toBe(
      'NAMESPACE_DENIED',
    );
    expect(
      authorizeCanonicalRead(object, { ...baseRequest, capability_id: 'agent.unknown' }).receipt.reason,
    ).toBe('CONSUMER_DENIED');
    expect(
      authorizeCanonicalRead(object, { ...baseRequest, allowed_object_types: ['Source'] }).receipt.reason,
    ).toBe('OBJECT_TYPE_DENIED');
    expect(
      authorizeCanonicalRead(object, { ...baseRequest, allowed_object_types: ['Knowledge'] }).allowed,
    ).toBe(true);
  });

  it('filters mixed object sets and returns one audit receipt per object', () => {
    const allowed = validKnowledge();
    const denied = { ...allowed, object_id: `${allowed.object_id}-d2`, privacy_class: 'D2' as const };
    const result = filterCanonicalReads(
      [allowed, denied],
      {
        capability_id: 'agent.reader',
        namespace: 'personal',
        purpose: 'retrieval',
        privacy_ceiling: 'D1',
      },
      '2026-08-11T08:30:00.000Z',
    );
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.object_id).toBe(allowed.object_id);
    expect(result.receipts).toHaveLength(2);
    expect(result.receipts.map((receipt) => receipt.decision)).toEqual(['ALLOW', 'DENY']);
  });

  it('supports the default decision timestamp without exposing object content in receipts', () => {
    const object = validKnowledge();
    const result = authorizeCanonicalRead(object, {
      capability_id: 'agent.reader',
      namespace: 'personal',
      purpose: 'retrieval',
      privacy_ceiling: 'D1',
    });
    expect(Number.isNaN(Date.parse(result.receipt.decided_at))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain(baseNote.body);
  });
});

describe('C1 Agent write proposal boundaries', () => {
  it('rejects empty capability and proposal reasons', () => {
    const object = validKnowledge();
    expect(() => createWriteProposal({ capabilityId: ' ', object, reason: 'valid' })).toThrow(/capabilityId/);
    expect(() => createWriteProposal({ capabilityId: 'agent.writer', object, reason: ' ' })).toThrow(/reason/);
  });

  it('creates a proposal with a default timestamp but no acceptance operation', () => {
    const object = validKnowledge();
    const proposal = createWriteProposal({
      capabilityId: 'agent.writer',
      object,
      reason: 'candidate correction',
    });
    expect(proposal.state).toBe('WRITE_PROPOSAL');
    expect(proposal.proposed_object.review_state).toBe('PROPOSED');
    expect(Number.isNaN(Date.parse(proposal.proposed_at))).toBe(false);
  });
});
