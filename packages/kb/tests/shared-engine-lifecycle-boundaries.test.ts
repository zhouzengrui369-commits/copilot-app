import { describe, expect, it } from 'vitest';
import {
  createConflict,
  createReviewQueueItem,
  createUserCorrection,
  decideReview,
  mapLegacyEntity,
  mapLegacyNote,
  recordCompilation,
  recordIngestionAttempt,
  resolveConflict,
  type C1AdapterContext,
  type CanonicalObject,
  type ConflictRecord,
  type IngestionPreviousState,
  type LegacyNoteSnapshot,
  type ReviewQueueItem,
} from '../src/shared-engine/index.js';

const context: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['retrieval'],
  allowedConsumers: ['agent.reader'],
  privacyClass: 'D1',
};

const note: LegacyNoteSnapshot = {
  path: 'notes/c2-boundaries',
  title: 'C2 private boundary title',
  type: 'note',
  status: 'active',
  tags: [],
  related: [],
  sourceHash: 'legacy-c2',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.8,
  agent: null,
  body: 'PRIVATE_C2_BODY_SHOULD_NOT_APPEAR_IN_RECEIPTS',
};

function mapping() {
  return mapLegacyNote(note, context);
}

function previous(source: CanonicalObject): IngestionPreviousState {
  return {
    object_id: source.object_id,
    content_hash: source.content_hash,
    revision: source.revision,
    observed_at: source.observed_at,
  };
}

function proposedEntity() {
  return mapLegacyEntity(
    {
      legacyId: 'boundary-entity',
      type: 'concept',
      name: 'Boundary entity',
      aliases: [],
      summary: null,
      confidence: null,
      sourceNotePaths: [note.path],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    context,
  ).object;
}

const recipe = {
  recipe_id: 'compiler',
  recipe_version: '1',
  model_id: null,
  parameters_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

describe('C2 ingestion fail-closed boundaries', () => {
  it('rejects non-Source canonical objects and invalid source time', () => {
    const mapped = mapping();
    expect(() =>
      recordIngestionAttempt({
        source: mapped.knowledge.object as never,
        recipe_id: 'ingest',
        recipe_version: '1',
      }),
    ).toThrow(/must be a Source/);
    expect(() =>
      recordIngestionAttempt({
        source: { ...mapped.source.object, observed_at: 'not-a-date' },
        recipe_id: 'ingest',
        recipe_version: '1',
      }),
    ).toThrow(/observed_at/);
  });

  it('rejects missing recipe identity', () => {
    const source = mapping().source.object;
    expect(() => recordIngestionAttempt({ source, recipe_id: ' ', recipe_version: '1' })).toThrow(/recipe_id/);
    expect(() => recordIngestionAttempt({ source, recipe_id: 'ingest', recipe_version: ' ' })).toThrow(
      /recipe_version/,
    );
  });

  it('rejects malformed previous-state identity, hash, revision and time', () => {
    const source = mapping().source.object;
    const base = previous(source);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        previous: { ...base, object_id: 'ske:0.3:source:sha256:other' },
      }),
    ).toThrow(/object_id/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        previous: { ...base, content_hash: 'bad' },
      }),
    ).toThrow(/content_hash/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        previous: { ...base, revision: 0 },
      }),
    ).toThrow(/revision/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        previous: { ...base, observed_at: 'bad-time' },
      }),
    ).toThrow(/previous observed_at/);
  });

  it('requires coherent bounded failure metadata', () => {
    const source = mapping().source.object;
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        requested_outcome: 'FAILED',
      }),
    ).toThrow(/requires bounded failure/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        requested_outcome: 'PARTIAL',
      }),
    ).toThrow(/requires bounded failure/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        requested_outcome: 'SUCCESS',
        failure: { code: 'SHOULD_NOT_EXIST', stage: 'parser' },
      }),
    ).toThrow(/cannot carry failure/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        requested_outcome: 'FAILED',
        failure: { code: 'raw user content is forbidden', stage: 'parser' },
      }),
    ).toThrow(/bounded machine code/);
    expect(() =>
      recordIngestionAttempt({
        source,
        recipe_id: 'ingest',
        recipe_version: '1',
        requested_outcome: 'FAILED',
        failure: { code: 'READ_FAILED', stage: '' },
      }),
    ).toThrow(/stage is required/);
  });

  it('keeps failure receipts content-safe', () => {
    const source = mapping().source.object;
    const result = recordIngestionAttempt({
      source,
      recipe_id: 'ingest',
      recipe_version: '1',
      requested_outcome: 'FAILED',
      failure: { code: 'READ_FAILED', stage: 'reader' },
      completed_at: '2026-08-11T09:50:00.000Z',
    });
    const serialized = JSON.stringify(result.receipt);
    expect(serialized).not.toContain(note.title);
    expect(serialized).not.toContain(note.body);
  });
});

describe('C2 compiler fail-closed boundaries', () => {
  it('requires at least one unique canonical input', () => {
    const source = mapping().source.object;
    expect(() =>
      recordCompilation({ input_objects: [], proposed_outputs: [], recipe, outcome: 'FAILED', failure: { code: 'NO_INPUT', stage: 'input' } }),
    ).toThrow(/at least one input/);
    expect(() =>
      recordCompilation({
        input_objects: [source, source],
        proposed_outputs: [],
        recipe,
        outcome: 'FAILED',
        failure: { code: 'DUPLICATE', stage: 'input' },
      }),
    ).toThrow(/duplicate object/);
  });

  it('validates recipe identity, hash and optional model', () => {
    const source = mapping().source.object;
    const base = { input_objects: [source], proposed_outputs: [], outcome: 'FAILED' as const, failure: { code: 'X', stage: 'model' } };
    expect(() => recordCompilation({ ...base, recipe: { ...recipe, recipe_id: '' } })).toThrow(/recipe_id/);
    expect(() => recordCompilation({ ...base, recipe: { ...recipe, recipe_version: '' } })).toThrow(/recipe_version/);
    expect(() => recordCompilation({ ...base, recipe: { ...recipe, parameters_hash: 'bad' } })).toThrow(/sha256/);
    expect(() => recordCompilation({ ...base, recipe: { ...recipe, model_id: ' ' } })).toThrow(/model_id/);
  });

  it('requires coherent bounded failure metadata', () => {
    const source = mapping().source.object;
    expect(() =>
      recordCompilation({ input_objects: [source], proposed_outputs: [], recipe, outcome: 'FAILED' }),
    ).toThrow(/requires bounded failure/);
    expect(() =>
      recordCompilation({ input_objects: [source], proposed_outputs: [], recipe, outcome: 'PARTIAL' }),
    ).toThrow(/requires bounded failure/);
    expect(() =>
      recordCompilation({
        input_objects: [source],
        proposed_outputs: [proposedEntity()],
        recipe,
        outcome: 'SUCCESS',
        failure: { code: 'NOPE', stage: 'model' },
      }),
    ).toThrow(/cannot carry failure/);
    expect(() =>
      recordCompilation({
        input_objects: [source],
        proposed_outputs: [],
        recipe,
        outcome: 'FAILED',
        failure: { code: 'private body must not be error code', stage: 'model' },
      }),
    ).toThrow(/bounded machine code/);
  });

  it('rejects failed output, Source output, accepted output and wrong assertion classes', () => {
    const mapped = mapping();
    const entity = proposedEntity();
    expect(() =>
      recordCompilation({
        input_objects: [mapped.source.object],
        proposed_outputs: [entity],
        recipe,
        outcome: 'FAILED',
        failure: { code: 'MODEL_FAILED', stage: 'model' },
      }),
    ).toThrow(/failed compilation cannot emit/);
    expect(() =>
      recordCompilation({ input_objects: [mapped.source.object], proposed_outputs: [mapped.source.object], recipe, outcome: 'SUCCESS' }),
    ).toThrow(/cannot create Source/);
    expect(() =>
      recordCompilation({
        input_objects: [mapped.source.object],
        proposed_outputs: [{ ...entity, review_state: 'ACCEPTED' }],
        recipe,
        outcome: 'SUCCESS',
      }),
    ).toThrow(/remain PROPOSED/);
    expect(() =>
      recordCompilation({
        input_objects: [mapped.source.object],
        proposed_outputs: [{ ...entity, assertion_type: 'USER_DECLARED_FACT' }],
        recipe,
        outcome: 'SUCCESS',
      }),
    ).toThrow(/inference or hypothesis/);
  });

  it('requires source refs to be non-empty and present in inputs', () => {
    const source = mapping().source.object;
    const entity = proposedEntity();
    expect(() =>
      recordCompilation({
        input_objects: [source],
        proposed_outputs: [{ ...entity, source_refs: [] }],
        recipe,
        outcome: 'SUCCESS',
      }),
    ).toThrow(/requires source_refs/);
    expect(() =>
      recordCompilation({
        input_objects: [source],
        proposed_outputs: [{ ...entity, source_refs: ['ske:0.3:source:sha256:unknown'] }],
        recipe,
        outcome: 'SUCCESS',
      }),
    ).toThrow(/not present in input_objects/);
    expect(() =>
      recordCompilation({ input_objects: [source], proposed_outputs: [], recipe, outcome: 'SUCCESS' }),
    ).toThrow(/requires at least one proposed output/);
  });

  it('allows a temporary hypothesis but still returns no accepted write', () => {
    const source = mapping().source.object;
    const hypothesis = { ...proposedEntity(), assertion_type: 'TEMPORARY_HYPOTHESIS' as const };
    const result = recordCompilation({
      input_objects: [source],
      proposed_outputs: [hypothesis],
      recipe,
      outcome: 'SUCCESS',
      completed_at: '2026-08-11T09:51:00.000Z',
    });
    expect(result.proposed_outputs[0]?.assertion_type).toBe('TEMPORARY_HYPOTHESIS');
    expect(result.receipt.accepted_canonical_write).toBe(false);
  });
});

describe('C2 review fail-closed boundaries', () => {
  it('only queues proposed objects', () => {
    const accepted = mapping().knowledge.object;
    expect(() => createReviewQueueItem(accepted)).toThrow(/only PROPOSED/);
    const pending = createReviewQueueItem(proposedEntity());
    expect(pending.state).toBe('PENDING');
    expect(Number.isNaN(Date.parse(pending.queued_at))).toBe(false);
  });

  it('denies Agent terminal decisions and invalid review metadata', () => {
    const item = createReviewQueueItem(proposedEntity(), '2026-08-11T09:52:00.000Z');
    expect(() =>
      decideReview({
        item,
        authority: { actor_id: 'agent:compiler', actor_kind: 'AGENT' },
        decision: 'ACCEPT',
        reason: 'SELF_APPROVE',
      }),
    ).toThrow(/Agent capability/);
    expect(() =>
      decideReview({
        item,
        authority: { actor_id: '', actor_kind: 'USER' },
        decision: 'ACCEPT',
        reason: 'VERIFIED',
      }),
    ).toThrow(/actor_id/);
    expect(() =>
      decideReview({
        item,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        decision: 'ACCEPT',
        reason: 'private user content is not a reason code',
      }),
    ).toThrow(/bounded machine code/);
  });

  it('detects terminal replay and tampered queue identity', () => {
    const item = createReviewQueueItem(proposedEntity(), '2026-08-11T09:53:00.000Z');
    const accepted = decideReview({
      item,
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      decision: 'ACCEPT',
      reason: 'VERIFIED',
      decided_at: '2026-08-11T09:54:00.000Z',
    });
    expect(() =>
      decideReview({
        item: accepted.item,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        decision: 'REJECT',
        reason: 'REPLAY',
      }),
    ).toThrow(/already terminal/);

    const tampered: ReviewQueueItem = { ...item, proposed_content_hash: 'sha256:' + '0'.repeat(64) };
    expect(() =>
      decideReview({
        item: tampered,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        decision: 'ACCEPT',
        reason: 'VERIFIED',
      }),
    ).toThrow(/no longer matches/);
  });

  it('rejects no-op and malformed correction requests', () => {
    const accepted = mapping().knowledge.object;
    expect(() =>
      createUserCorrection({ previous: accepted, corrected_payload: accepted.payload, actor_id: 'user:owner', reason: 'CORRECTION' }),
    ).toThrow(/must change/);
    expect(() =>
      createUserCorrection({ previous: accepted, corrected_payload: { ...accepted.payload, title: 'changed' }, actor_id: '', reason: 'CORRECTION' }),
    ).toThrow(/actor_id/);
    expect(() =>
      createUserCorrection({
        previous: accepted,
        corrected_payload: { ...accepted.payload, title: 'changed' },
        actor_id: 'user:owner',
        reason: 'free form user text should not enter receipt',
      }),
    ).toThrow(/bounded machine code/);
  });

  it('keeps review and correction receipts free of payload content', () => {
    const proposed = proposedEntity();
    const reviewed = decideReview({
      item: createReviewQueueItem(proposed, '2026-08-11T09:55:00.000Z'),
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      decision: 'ACCEPT',
      reason: 'VERIFIED',
      decided_at: '2026-08-11T09:56:00.000Z',
    });
    const corrected = createUserCorrection({
      previous: mapping().knowledge.object,
      corrected_payload: { ...mapping().knowledge.object.payload, title: 'changed private title' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:57:00.000Z',
    });
    expect(JSON.stringify(reviewed.receipt)).not.toContain('Boundary entity');
    expect(JSON.stringify(corrected.receipt)).not.toContain('changed private title');
  });
});

describe('C2 conflict fail-closed boundaries', () => {
  function conflictingPair() {
    const left = mapping().knowledge.object;
    const right = createUserCorrection({
      previous: left,
      corrected_payload: { ...left.payload, title: 'right-side-private-title' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:58:00.000Z',
    }).proposal;
    return { left, right };
  }

  it('rejects cross-namespace and identical assertions', () => {
    const { left, right } = conflictingPair();
    expect(() => createConflict(left, { ...right, namespace: 'work' }, 'CONTRADICTION')).toThrow(/share a namespace/);
    expect(() => createConflict(left, left, 'DUPLICATE')).toThrow(/two distinct assertions/);
  });

  it('denies Agent resolution and invalid resolution metadata', () => {
    const { left, right } = conflictingPair();
    const conflict = createConflict(left, right, 'CONTRADICTION', '2026-08-11T09:59:00.000Z');
    expect(() =>
      resolveConflict({
        conflict,
        authority: { actor_id: 'agent:compiler', actor_kind: 'AGENT' },
        strategy: 'KEEP_RIGHT',
        reason: 'SELF_RESOLVE',
      }),
    ).toThrow(/Agent capability/);
    expect(() =>
      resolveConflict({
        conflict,
        authority: { actor_id: '', actor_kind: 'USER' },
        strategy: 'KEEP_RIGHT',
        reason: 'VERIFIED',
      }),
    ).toThrow(/actor_id/);
    expect(() =>
      resolveConflict({
        conflict,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        strategy: 'KEEP_RIGHT',
        reason: 'raw private explanation is forbidden here',
      }),
    ).toThrow(/bounded machine code/);
  });

  it('detects replay and assertion drift', () => {
    const { left, right } = conflictingPair();
    const conflict = createConflict(left, right, 'CONTRADICTION', '2026-08-11T10:00:00.000Z');
    const resolved = resolveConflict({
      conflict,
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      strategy: 'KEEP_LEFT',
      reason: 'VERIFIED',
      resolved_at: '2026-08-11T10:01:00.000Z',
    });
    expect(resolved.receipt.winner_object_id).toBe(left.object_id);
    expect(() =>
      resolveConflict({
        conflict: resolved.conflict,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        strategy: 'KEEP_RIGHT',
        reason: 'REPLAY',
      }),
    ).toThrow(/already resolved/);

    const drifted: ConflictRecord = {
      ...conflict,
      left_object: { ...left, content_hash: 'sha256:' + '1'.repeat(64) },
    };
    expect(() =>
      resolveConflict({
        conflict: drifted,
        authority: { actor_id: 'user:owner', actor_kind: 'USER' },
        strategy: 'KEEP_LEFT',
        reason: 'VERIFIED',
      }),
    ).toThrow(/identity no longer matches/);
  });

  it('covers KEEP_RIGHT and both supersession directions', () => {
    const { left, right } = conflictingPair();
    const rightWins = resolveConflict({
      conflict: createConflict(left, right, 'CONTRADICTION', '2026-08-11T10:02:00.000Z'),
      authority: { actor_id: 'policy:review', actor_kind: 'POLICY' },
      strategy: 'KEEP_RIGHT',
      reason: 'POLICY_VERIFIED',
      resolved_at: '2026-08-11T10:03:00.000Z',
    });
    expect(rightWins.receipt.winner_object_id).toBe(right.object_id);
    expect(rightWins.supersession).toBeNull();

    const supersedeRight = resolveConflict({
      conflict: createConflict(left, right, 'STALE_REPLACEMENT', '2026-08-11T10:04:00.000Z'),
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      strategy: 'SUPERSEDE_RIGHT',
      reason: 'LEFT_IS_CURRENT',
      resolved_at: '2026-08-11T10:05:00.000Z',
    });
    expect(supersedeRight.right_object.assertion_type).toBe('SUPERSEDED');
    expect(supersedeRight.left_object.supersedes).toBe(right.object_id);
    expect(supersedeRight.supersession?.successor_content_hash).toBe(left.content_hash);
  });

  it('keeps conflict resolution receipts content-safe', () => {
    const { left, right } = conflictingPair();
    const resolved = resolveConflict({
      conflict: createConflict(left, right, 'DUPLICATE', '2026-08-11T10:06:00.000Z'),
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      strategy: 'KEEP_BOTH',
      reason: 'CONTEXT_DEPENDENT',
      resolved_at: '2026-08-11T10:07:00.000Z',
    });
    const serialized = JSON.stringify(resolved.receipt);
    expect(serialized).not.toContain(note.body);
    expect(serialized).not.toContain('right-side-private-title');
  });
});
