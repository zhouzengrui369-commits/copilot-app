import { describe, expect, it } from 'vitest';
import {
  contentHash,
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
  type IngestionPreviousState,
  type KnowledgePayload,
  type LegacyNoteSnapshot,
} from '../src/shared-engine/index.js';

const context: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['knowledge_management', 'retrieval'],
  allowedConsumers: ['copilot.desktop', 'agent.reader'],
  privacyClass: 'D1',
};

const note: LegacyNoteSnapshot = {
  path: 'research/c2-lifecycle',
  title: 'C2 lifecycle',
  type: 'note',
  status: 'active',
  tags: ['c2'],
  related: [],
  sourceHash: 'legacy-c2-source',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.9,
  agent: null,
  body: '# C2\nLifecycle source body',
};

function mappedNote(snapshot: LegacyNoteSnapshot = note) {
  return mapLegacyNote(snapshot, context);
}

function previousSource(source: CanonicalObject): IngestionPreviousState {
  return {
    object_id: source.object_id,
    content_hash: source.content_hash,
    revision: source.revision,
    observed_at: source.observed_at,
  };
}

function proposedEntity(sourcePath = note.path) {
  return mapLegacyEntity(
    {
      legacyId: 'entity:c2',
      type: 'concept',
      name: 'Lifecycle',
      aliases: [],
      summary: 'Managed knowledge lifecycle',
      confidence: 0.8,
      sourceNotePaths: [sourcePath],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    context,
  ).object;
}

const recipe = {
  recipe_id: 'knowledge.compiler',
  recipe_version: '1',
  model_id: 'local:test-model',
  parameters_hash: contentHash({ temperature: 0 }),
};

describe('C2 ingestion lifecycle', () => {
  it('creates deterministic idempotency identities for a first ingestion', () => {
    const source = mappedNote().source.object;
    const first = recordIngestionAttempt({
      source,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      completed_at: '2026-08-11T09:10:00.000Z',
    });
    const repeated = recordIngestionAttempt({
      source,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      completed_at: '2026-08-11T09:11:00.000Z',
    });

    expect(first.receipt.status).toBe('INGESTED');
    expect(first.receipt.canonical_commit_allowed).toBe(true);
    expect(first.canonical_source?.object_id).toBe(source.object_id);
    expect(first.receipt.ingestion_id).toBe(repeated.receipt.ingestion_id);
    expect(first.receipt.receipt_id).toBe(repeated.receipt.receipt_id);
    expect(first.receipt.completed_at).not.toBe(repeated.receipt.completed_at);
  });

  it('distinguishes unchanged, revised and stale sources without changing stable identity', () => {
    const first = mappedNote().source.object;
    const unchanged = recordIngestionAttempt({
      source: first,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      previous: previousSource(first),
      completed_at: '2026-08-11T09:12:00.000Z',
    });
    expect(unchanged.receipt.status).toBe('UNCHANGED');
    expect(unchanged.receipt.canonical_commit_allowed).toBe(true);

    const revisedMapping = mapLegacyNote(
      { ...note, body: `${note.body}\nrevision`, updatedAt: note.updatedAt + 1_000 },
      context,
      { source: previousSource(first), knowledge: undefined },
    );
    const revised = recordIngestionAttempt({
      source: revisedMapping.source.object,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      previous: previousSource(first),
      completed_at: '2026-08-11T09:13:00.000Z',
    });
    expect(revised.receipt.status).toBe('REVISED');
    expect(revised.canonical_source?.object_id).toBe(first.object_id);
    expect(revised.canonical_source?.revision).toBe(2);

    const staleSource = {
      ...revisedMapping.source.object,
      observed_at: '2026-08-11T08:00:00.000Z',
    };
    const stale = recordIngestionAttempt({
      source: staleSource,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      previous: { ...previousSource(first), observed_at: '2026-08-11T09:00:00.000Z' },
      completed_at: '2026-08-11T09:14:00.000Z',
    });
    expect(stale.receipt.status).toBe('STALE');
    expect(stale.receipt.canonical_commit_allowed).toBe(false);
    expect(stale.canonical_source).toBeNull();
  });

  it('never turns partial or failed ingestion into canonical success', () => {
    const source = mappedNote().source.object;
    const partial = recordIngestionAttempt({
      source,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      requested_outcome: 'PARTIAL',
      failure: { code: 'PARTIAL_PARSE', stage: 'parser' },
      completed_at: '2026-08-11T09:15:00.000Z',
    });
    const failed = recordIngestionAttempt({
      source,
      recipe_id: 'note.ingest',
      recipe_version: '1',
      requested_outcome: 'FAILED',
      failure: { code: 'SOURCE_UNREADABLE', stage: 'reader' },
      completed_at: '2026-08-11T09:16:00.000Z',
    });

    for (const result of [partial, failed]) {
      expect(result.receipt.canonical_commit_allowed).toBe(false);
      expect(result.canonical_source).toBeNull();
      expect(JSON.stringify(result.receipt)).not.toContain(note.body);
      expect(JSON.stringify(result.receipt)).not.toContain(note.title);
    }
    expect(partial.receipt.status).toBe('PARTIAL');
    expect(failed.receipt.status).toBe('FAILED');
  });
});

describe('C2 compiler lifecycle', () => {
  it('binds compiler provenance while keeping every output proposed', () => {
    const source = mappedNote().source.object;
    const entity = proposedEntity();
    const result = recordCompilation({
      input_objects: [source],
      proposed_outputs: [entity],
      recipe,
      outcome: 'SUCCESS',
      completed_at: '2026-08-11T09:20:00.000Z',
    });

    expect(result.receipt.outcome).toBe('SUCCESS');
    expect(result.receipt.accepted_canonical_write).toBe(false);
    expect(result.receipt.input_object_ids).toEqual([source.object_id]);
    expect(result.receipt.output_object_ids).toEqual([entity.object_id]);
    expect(result.proposed_outputs[0]?.review_state).toBe('PROPOSED');
    expect(result.proposed_outputs[0]?.assertion_type).toBe('SYSTEM_INFERENCE');
  });

  it('keeps compilation identity stable regardless of input ordering', () => {
    const mapped = mappedNote();
    const entity = proposedEntity();
    const first = recordCompilation({
      input_objects: [mapped.source.object, mapped.knowledge.object],
      proposed_outputs: [entity],
      recipe,
      outcome: 'SUCCESS',
      completed_at: '2026-08-11T09:21:00.000Z',
    });
    const second = recordCompilation({
      input_objects: [mapped.knowledge.object, mapped.source.object],
      proposed_outputs: [entity],
      recipe,
      outcome: 'SUCCESS',
      completed_at: '2026-08-11T09:22:00.000Z',
    });
    expect(first.receipt.compilation_id).toBe(second.receipt.compilation_id);
    expect(first.receipt.input_object_ids).toEqual(second.receipt.input_object_ids);
  });

  it('preserves partial proposals but never marks them accepted', () => {
    const source = mappedNote().source.object;
    const entity = proposedEntity();
    const partial = recordCompilation({
      input_objects: [source],
      proposed_outputs: [entity],
      recipe: { ...recipe, model_id: null },
      outcome: 'PARTIAL',
      failure: { code: 'ENTITY_LIMIT', stage: 'extractor' },
      completed_at: '2026-08-11T09:23:00.000Z',
    });
    expect(partial.receipt.outcome).toBe('PARTIAL');
    expect(partial.receipt.accepted_canonical_write).toBe(false);
    expect(partial.proposed_outputs).toHaveLength(1);
    expect(partial.proposed_outputs[0]?.review_state).toBe('PROPOSED');
  });

  it('records failed compilation without outputs or user content', () => {
    const source = mappedNote().source.object;
    const failed = recordCompilation({
      input_objects: [source],
      proposed_outputs: [],
      recipe,
      outcome: 'FAILED',
      failure: { code: 'MODEL_UNAVAILABLE', stage: 'model' },
      completed_at: '2026-08-11T09:24:00.000Z',
    });
    expect(failed.proposed_outputs).toEqual([]);
    expect(failed.receipt.output_object_ids).toEqual([]);
    expect(failed.receipt.accepted_canonical_write).toBe(false);
    expect(JSON.stringify(failed.receipt)).not.toContain(note.body);
  });
});

describe('C2 review lifecycle', () => {
  it('requires explicit human acceptance before canonical commit', () => {
    const proposed = proposedEntity();
    const queueItem = createReviewQueueItem(proposed, '2026-08-11T09:30:00.000Z');
    const accepted = decideReview({
      item: queueItem,
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      decision: 'ACCEPT',
      reason: 'VERIFIED_SOURCE',
      decided_at: '2026-08-11T09:31:00.000Z',
    });

    expect(queueItem.state).toBe('PENDING');
    expect(proposed.review_state).toBe('PROPOSED');
    expect(accepted.item.state).toBe('DECIDED');
    expect(accepted.object.review_state).toBe('ACCEPTED');
    expect(accepted.receipt.canonical_commit_allowed).toBe(true);
    expect(accepted.receipt.previous_review_state).toBe('PROPOSED');
  });

  it('records rejection and dispute without canonical commit', () => {
    const proposed = proposedEntity();
    const reject = decideReview({
      item: createReviewQueueItem(proposed, '2026-08-11T09:32:00.000Z'),
      authority: { actor_id: 'policy:review', actor_kind: 'POLICY' },
      decision: 'REJECT',
      reason: 'LOW_EVIDENCE',
      decided_at: '2026-08-11T09:33:00.000Z',
    });
    const dispute = decideReview({
      item: createReviewQueueItem(proposed, '2026-08-11T09:34:00.000Z'),
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      decision: 'DISPUTE',
      reason: 'CONFLICTING_SOURCE',
      decided_at: '2026-08-11T09:35:00.000Z',
    });
    expect(reject.object.review_state).toBe('REJECTED');
    expect(reject.receipt.canonical_commit_allowed).toBe(false);
    expect(dispute.object.review_state).toBe('DISPUTED');
    expect(dispute.receipt.canonical_commit_allowed).toBe(false);
  });

  it('creates traceable user corrections as new proposed revisions', () => {
    const accepted = mappedNote().knowledge.object;
    const correctedPayload: KnowledgePayload = {
      ...accepted.payload,
      title: 'C2 lifecycle corrected',
    };
    const correction = createUserCorrection({
      previous: accepted,
      corrected_payload: correctedPayload,
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:36:00.000Z',
    });

    expect(correction.proposal.object_id).toBe(accepted.object_id);
    expect(correction.proposal.revision).toBe(accepted.revision + 1);
    expect(correction.proposal.review_state).toBe('PROPOSED');
    expect(correction.proposal.assertion_type).toBe('USER_DECLARED_FACT');
    expect(correction.proposal.supersedes).toBe(accepted.object_id);
    expect(correction.receipt.previous_content_hash).toBe(accepted.content_hash);
    expect(correction.receipt.next_content_hash).toBe(correction.proposal.content_hash);
  });
});

describe('C2 conflict lifecycle', () => {
  it('preserves both assertions and creates order-independent conflict identity', () => {
    const left = mappedNote().knowledge.object;
    const right = createUserCorrection({
      previous: left,
      corrected_payload: { ...left.payload, title: 'Competing title' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:40:00.000Z',
    }).proposal;

    const first = createConflict(left, right, 'CONTRADICTION', '2026-08-11T09:41:00.000Z');
    const swapped = createConflict(right, left, 'CONTRADICTION', '2026-08-11T09:42:00.000Z');
    expect(first.conflict_id).toBe(swapped.conflict_id);
    expect(first.left.object_id).toBe(left.object_id);
    expect(first.left.content_hash).toBe(left.content_hash);
    expect(first.right.content_hash).toBe(right.content_hash);
    expect(first.state).toBe('OPEN');
  });

  it('can resolve without destructive supersession', () => {
    const left = mappedNote().knowledge.object;
    const right = createUserCorrection({
      previous: left,
      corrected_payload: { ...left.payload, title: 'Alternative' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:43:00.000Z',
    }).proposal;
    const conflict = createConflict(left, right, 'CONTRADICTION', '2026-08-11T09:44:00.000Z');

    const keepBoth = resolveConflict({
      conflict,
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      strategy: 'KEEP_BOTH',
      reason: 'CONTEXT_DEPENDENT',
      resolved_at: '2026-08-11T09:45:00.000Z',
    });
    expect(keepBoth.conflict.state).toBe('RESOLVED');
    expect(keepBoth.receipt.winner_object_id).toBeNull();
    expect(keepBoth.supersession).toBeNull();
    expect(keepBoth.left_object.content_hash).toBe(left.content_hash);
    expect(keepBoth.right_object.content_hash).toBe(right.content_hash);
  });

  it('records explicit supersession lineage while retaining the prior object', () => {
    const left = mappedNote().knowledge.object;
    const right = createUserCorrection({
      previous: left,
      corrected_payload: { ...left.payload, title: 'New accepted truth' },
      actor_id: 'user:owner',
      reason: 'USER_CORRECTION',
      observed_at: '2026-08-11T09:46:00.000Z',
    }).proposal;
    const conflict = createConflict(left, right, 'STALE_REPLACEMENT', '2026-08-11T09:47:00.000Z');

    const resolved = resolveConflict({
      conflict,
      authority: { actor_id: 'user:owner', actor_kind: 'USER' },
      strategy: 'SUPERSEDE_LEFT',
      reason: 'NEWER_VERIFIED_REVISION',
      resolved_at: '2026-08-11T09:48:00.000Z',
    });
    expect(resolved.left_object.assertion_type).toBe('SUPERSEDED');
    expect(resolved.left_object.review_state).toBe('EXPIRED');
    expect(resolved.left_object.valid_to).toBe('2026-08-11T09:48:00.000Z');
    expect(resolved.right_object.supersedes).toBe(left.object_id);
    expect(resolved.supersession?.superseded_content_hash).toBe(left.content_hash);
    expect(resolved.supersession?.successor_content_hash).toBe(right.content_hash);
    expect(resolved.receipt.winner_object_id).toBe(right.object_id);
  });
});
