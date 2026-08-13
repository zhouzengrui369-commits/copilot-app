import { describe, expect, it } from 'vitest';
import {
  buildGroundedContext,
  contentHash,
  createProjection,
  createUserCorrection,
  mapLegacyNote,
  rankAuthorizedProjectionHits,
  type C1AdapterContext,
  type CanonicalObject,
  type LegacyNoteSnapshot,
  type RetrievalHit,
} from '../src/shared-engine/index.js';

const context: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['retrieval', 'knowledge_management'],
  allowedConsumers: ['agent.reader', 'copilot.desktop'],
  privacyClass: 'D1',
};

const firstNote: LegacyNoteSnapshot = {
  path: 'research/c3-retrieval-a',
  title: 'C3 Retrieval A',
  type: 'note',
  status: 'active',
  tags: ['c3'],
  related: [],
  sourceHash: 'source-a',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.9,
  agent: null,
  body: 'PRIVATE_C3_BODY_A',
};

const secondNote: LegacyNoteSnapshot = {
  ...firstNote,
  path: 'research/c3-retrieval-b',
  title: 'C3 Retrieval B',
  sourceHash: 'source-b',
  body: 'PRIVATE_C3_BODY_B',
};

const recipe = { recipe_id: 'retrieval.projection', recipe_version: '1' };

function knowledge(note: LegacyNoteSnapshot): CanonicalObject {
  return mapLegacyNote(note, context).knowledge.object;
}

function hitsFor(object: CanonicalObject): RetrievalHit[] {
  return [
    {
      projection: createProjection(object, 'FULL_TEXT', { tokens: ['c3'] }, recipe),
      retrieval_kind: 'FULL_TEXT',
      score: 0.7,
    },
    {
      projection: createProjection(object, 'VECTOR', { vector: 'hash-only' }, recipe),
      retrieval_kind: 'VECTOR',
      score: 0.9,
    },
    {
      projection: createProjection(object, 'GRAPH', { neighbors: 3 }, recipe),
      retrieval_kind: 'GRAPH',
      score: 0.8,
    },
  ];
}

const request = {
  capability_id: 'agent.reader',
  namespace: 'personal',
  purpose: 'retrieval',
  privacy_ceiling: 'D1' as const,
};

describe('C3 permission-first unified retrieval', () => {
  it('deduplicates multi-index hits by canonical object ID and keeps projection evidence', () => {
    const object = knowledge(firstNote);
    const result = rankAuthorizedProjectionHits(
      hitsFor(object),
      [object],
      request,
      '2026-08-11T10:10:00.000Z',
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.object_id).toBe(object.object_id);
    expect(result.results[0]?.score).toBe(0.9);
    expect(result.results[0]?.evidence).toHaveLength(3);
    expect(new Set(result.results[0]?.evidence.map((entry) => entry.retrieval_kind))).toEqual(
      new Set(['FULL_TEXT', 'VECTOR', 'GRAPH']),
    );
    expect(result.receipt.authorized_object_ids).toEqual([object.object_id]);
    expect(result.receipt.authorized_projection_ids).toHaveLength(3);
    expect(result.receipt.denied).toEqual([]);
    expect(result.receipt.stale).toEqual([]);
  });

  it('ranks authorized canonical results and uses object ID as deterministic tie-breaker', () => {
    const a = knowledge(firstNote);
    const b = knowledge(secondNote);
    const aHit = { ...hitsFor(a)[0]!, score: 0.8 };
    const bHit = { ...hitsFor(b)[0]!, score: 0.8 };
    const result = rankAuthorizedProjectionHits([bHit, aHit], [b, a], request, '2026-08-11T10:11:00.000Z');
    expect(result.results.map((entry) => entry.object_id)).toEqual([a.object_id, b.object_id].sort());
  });

  it('filters privacy-denied objects before exposing score or projection evidence', () => {
    const allowed = knowledge(firstNote);
    const denied: CanonicalObject = {
      ...knowledge(secondNote),
      privacy_class: 'D2',
    };
    const result = rankAuthorizedProjectionHits(
      [
        ...hitsFor(allowed),
        {
          projection: createProjection(denied, 'VECTOR', { private_vector: 'PRIVATE_VECTOR_PAYLOAD' }, recipe),
          retrieval_kind: 'VECTOR',
          score: 0.99,
        },
      ],
      [allowed, denied],
      request,
      '2026-08-11T10:12:00.000Z',
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.object_id).toBe(allowed.object_id);
    expect(result.receipt.denied).toEqual([{ object_id: denied.object_id, reason: 'PRIVACY_DENIED' }]);
    const receiptText = JSON.stringify(result.receipt);
    expect(receiptText).not.toContain('0.99');
    expect(receiptText).not.toContain('PRIVATE_VECTOR_PAYLOAD');
    expect(receiptText).not.toContain(secondNote.title);
    expect(receiptText).not.toContain(secondNote.body);
    expect(receiptText).not.toContain('projection_payload_hash');
  });

  it('applies namespace, purpose and consumer policy before ranking', () => {
    const object = knowledge(firstNote);
    const hit = hitsFor(object)[0]!;
    const scenarios = [
      [{ ...request, namespace: 'work' }, 'NAMESPACE_DENIED'],
      [{ ...request, purpose: 'marketing' }, 'PURPOSE_DENIED'],
      [{ ...request, capability_id: 'agent.unknown' }, 'CONSUMER_DENIED'],
    ] as const;

    for (const [policy, reason] of scenarios) {
      const result = rankAuthorizedProjectionHits([hit], [object], policy, '2026-08-11T10:13:00.000Z');
      expect(result.results).toEqual([]);
      expect(result.receipt.denied).toEqual([{ object_id: object.object_id, reason }]);
    }
  });

  it('respects requested object-type capability constraints', () => {
    const object = knowledge(firstNote);
    const result = rankAuthorizedProjectionHits(
      [hitsFor(object)[0]!],
      [object],
      { ...request, allowed_object_types: ['Source'] },
      '2026-08-11T10:14:00.000Z',
    );
    expect(result.results).toEqual([]);
    expect(result.receipt.denied[0]?.reason).toBe('OBJECT_TYPE_DENIED');
  });
});

describe('C3 stale and invalid retrieval input boundaries', () => {
  it('rejects stale projection hits before authorization', () => {
    const original = knowledge(firstNote);
    const oldProjection = createProjection(original, 'FULL_TEXT', { text: 'old' }, recipe);
    const revised = createUserCorrection({
      previous: original,
      corrected_payload: { ...original.payload, title: 'C3 revised title' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T10:15:00.000Z',
    }).proposal;
    const result = rankAuthorizedProjectionHits(
      [{ projection: oldProjection, retrieval_kind: 'FULL_TEXT', score: 0.95 }],
      [revised],
      request,
      '2026-08-11T10:16:00.000Z',
    );
    expect(result.results).toEqual([]);
    expect(result.receipt.denied).toEqual([]);
    expect(result.receipt.stale).toHaveLength(1);
    expect(result.receipt.stale[0]?.reason).toBe('STALE_PROJECTION');
    expect(result.receipt.stale[0]?.stale_reasons).toEqual(
      expect.arrayContaining(['CONTENT_HASH_MISMATCH', 'REVISION_MISMATCH']),
    );
    expect(JSON.stringify(result.receipt)).not.toContain('0.95');
  });

  it('classifies a projection for an unknown canonical object without leaking its score', () => {
    const object = knowledge(firstNote);
    const projection = createProjection(object, 'GRAPH', { secret_graph_payload: 'NO_LEAK' }, recipe);
    const result = rankAuthorizedProjectionHits(
      [{ projection, retrieval_kind: 'GRAPH', score: 0.88 }],
      [],
      request,
      '2026-08-11T10:17:00.000Z',
    );
    expect(result.results).toEqual([]);
    expect(result.receipt.stale).toEqual([
      { projection_id: projection.projection_id, reason: 'UNKNOWN_CANONICAL_OBJECT', stale_reasons: [] },
    ]);
    const receiptText = JSON.stringify(result.receipt);
    expect(receiptText).not.toContain('0.88');
    expect(receiptText).not.toContain('NO_LEAK');
  });

  it('rejects invalid retrieval scores', () => {
    const object = knowledge(firstNote);
    const base = hitsFor(object)[0]!;
    for (const score of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rankAuthorizedProjectionHits([{ ...base, score }], [object], request)).toThrow(/score/);
    }
  });

  it('rejects malformed projection records before ranking', () => {
    const object = knowledge(firstNote);
    const hit = hitsFor(object)[0]!;
    expect(() =>
      rankAuthorizedProjectionHits(
        [{ ...hit, projection: { ...hit.projection, projection_payload_hash: 'bad' } }],
        [object],
        request,
      ),
    ).toThrow(/projection record is invalid/);
  });

  it('rejects conflicting canonical versions for one object ID', () => {
    const object = knowledge(firstNote);
    const conflicting = { ...object, content_hash: contentHash('different'), revision: object.revision + 1 };
    expect(() => rankAuthorizedProjectionHits(hitsFor(object), [object, conflicting], request)).toThrow(
      /conflicting versions/,
    );
  });

  it('returns an empty but auditable receipt for zero hits', () => {
    const result = rankAuthorizedProjectionHits([], [], request, '2026-08-11T10:18:00.000Z');
    expect(result.results).toEqual([]);
    expect(result.receipt.input_hit_count).toBe(0);
    expect(result.receipt.authorized_object_ids).toEqual([]);
    expect(result.receipt.authorized_projection_ids).toEqual([]);
  });
});

describe('C3 grounded context', () => {
  it('builds grounded evidence from authorized results without copying object payloads', () => {
    const object = knowledge(firstNote);
    const retrieval = rankAuthorizedProjectionHits(
      hitsFor(object),
      [object],
      request,
      '2026-08-11T10:20:00.000Z',
    );
    const grounded = buildGroundedContext(retrieval, '2026-08-11T10:21:00.000Z');

    expect(grounded.retrieval_receipt_id).toBe(retrieval.receipt.receipt_id);
    expect(grounded.items).toHaveLength(1);
    expect(grounded.items[0]?.object_id).toBe(object.object_id);
    expect(grounded.items[0]?.source_refs).toEqual([...object.source_refs].sort());
    expect(grounded.items[0]?.projection_evidence).toHaveLength(3);
    const serialized = JSON.stringify(grounded);
    expect(serialized).not.toContain(firstNote.title);
    expect(serialized).not.toContain(firstNote.body);
    expect(serialized).not.toContain('payload');
  });

  it('keeps grounded context identity stable across creation times for the same retrieval evidence', () => {
    const object = knowledge(firstNote);
    const retrieval = rankAuthorizedProjectionHits(hitsFor(object), [object], request, '2026-08-11T10:22:00.000Z');
    const first = buildGroundedContext(retrieval, '2026-08-11T10:23:00.000Z');
    const second = buildGroundedContext(retrieval, '2026-08-11T10:24:00.000Z');
    expect(first.context_id).toBe(second.context_id);
    expect(first.created_at).not.toBe(second.created_at);
  });

  it('supports default timestamps while keeping evidence content-safe', () => {
    const object = knowledge(firstNote);
    const retrieval = rankAuthorizedProjectionHits([hitsFor(object)[0]!], [object], request);
    const grounded = buildGroundedContext(retrieval);
    expect(Number.isNaN(Date.parse(retrieval.receipt.completed_at))).toBe(false);
    expect(Number.isNaN(Date.parse(grounded.created_at))).toBe(false);
  });
});
