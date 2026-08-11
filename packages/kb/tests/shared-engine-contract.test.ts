import { describe, expect, it } from 'vitest';
import * as sharedEngine from '../src/shared-engine/index.js';
import {
  authorizeCanonicalRead,
  createWriteProposal,
  entityObjectId,
  knowledgeObjectIdForNote,
  mapLegacyEntity,
  mapLegacyNote,
  mapLegacyRelation,
  sourceObjectIdForNote,
  stableSerialize,
  validateCanonicalObject,
  type C1AdapterContext,
  type CanonicalObject,
  type LegacyNoteSnapshot,
  type RevisionState,
} from '../src/shared-engine/index.js';

const context: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['knowledge_management', 'retrieval'],
  allowedConsumers: ['copilot.desktop', 'agent.reader'],
  privacyClass: 'D1',
};

const baseNote: LegacyNoteSnapshot = {
  path: 'research/shared-engine',
  title: 'Shared Engine',
  type: 'note',
  status: 'active',
  tags: ['architecture', 'knowledge'],
  related: ['research/provenance'],
  sourceHash: 'legacy-hash',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.95,
  agent: null,
  body: '# Shared Engine\nCanonical identity and provenance.',
};

function revisionState(object: CanonicalObject): RevisionState {
  return {
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
  };
}

describe('Shared Knowledge Engine C1 canonical contract', () => {
  it('canonicalizes JSON deterministically', () => {
    expect(stableSerialize({ b: 2, a: { z: true, y: [3, 2, 1] } })).toBe(
      stableSerialize({ a: { y: [3, 2, 1], z: true }, b: 2 }),
    );
  });

  it('maps a legacy note to stable Source + Knowledge IDs without copying body bytes', () => {
    const first = mapLegacyNote(baseNote, context);
    const second = mapLegacyNote({ ...baseNote }, context);

    expect(first.source.object.object_id).toBe(second.source.object.object_id);
    expect(first.knowledge.object.object_id).toBe(second.knowledge.object.object_id);
    expect(first.source.object.object_id).toBe(sourceObjectIdForNote('personal', baseNote.path));
    expect(first.knowledge.object.object_id).toBe(knowledgeObjectIdForNote('personal', baseNote.path));
    expect(first.knowledge.object.source_refs).toEqual([first.source.object.object_id]);
    expect(first.knowledge.object.payload.related_object_ids).toEqual([
      knowledgeObjectIdForNote('personal', 'research/provenance'),
    ]);

    const serialized = JSON.stringify([first.source.object, first.knowledge.object]);
    expect(serialized).not.toContain(baseNote.body);
    expect(first.source.object.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.knowledge.object.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    validateCanonicalObject(first.source.object);
    validateCanonicalObject(first.knowledge.object);
  });

  it('keeps object identity stable while recording unchanged and revised lineage', () => {
    const first = mapLegacyNote(baseNote, context);
    const previous = {
      source: revisionState(first.source.object),
      knowledge: revisionState(first.knowledge.object),
    };

    const unchanged = mapLegacyNote(baseNote, context, previous);
    expect(unchanged.source.receipt.operation).toBe('UNCHANGED');
    expect(unchanged.knowledge.receipt.operation).toBe('UNCHANGED');
    expect(unchanged.source.object.revision).toBe(1);
    expect(unchanged.knowledge.object.revision).toBe(1);

    const revised = mapLegacyNote(
      {
        ...baseNote,
        body: `${baseNote.body}\nRevision 2`,
        updatedAt: baseNote.updatedAt + 1_000,
      },
      context,
      previous,
    );

    expect(revised.source.object.object_id).toBe(first.source.object.object_id);
    expect(revised.knowledge.object.object_id).toBe(first.knowledge.object.object_id);
    expect(revised.source.receipt.operation).toBe('REVISED');
    expect(revised.knowledge.receipt.operation).toBe('REVISED');
    expect(revised.source.object.revision).toBe(2);
    expect(revised.knowledge.object.revision).toBe(2);
    expect(revised.source.receipt.previous_content_hash).toBe(first.source.object.content_hash);
    expect(revised.knowledge.receipt.previous_content_hash).toBe(first.knowledge.object.content_hash);
  });

  it('never silently accepts agent-produced legacy knowledge', () => {
    const mapped = mapLegacyNote(
      { ...baseNote, agent: 'agent:compiler', confidence: 0.7 },
      context,
    );
    expect(mapped.knowledge.object.assertion_type).toBe('SYSTEM_INFERENCE');
    expect(mapped.knowledge.object.review_state).toBe('PROPOSED');
    expect(mapped.knowledge.object.created_by).toBe('agent:compiler');
  });

  it('maps entity and relation projections to canonical IDs and source refs', () => {
    const entity = mapLegacyEntity(
      {
        legacyId: 'entity-001',
        type: 'concept',
        name: 'Provenance',
        aliases: ['lineage'],
        summary: 'Evidence lineage',
        confidence: 0.8,
        sourceNotePaths: [baseNote.path],
        createdAt: baseNote.createdAt,
        updatedAt: baseNote.updatedAt,
      },
      context,
    );

    expect(entity.object.object_id).toBe(entityObjectId('personal', 'entity-001'));
    expect(entity.object.source_refs).toEqual([sourceObjectIdForNote('personal', baseNote.path)]);
    expect(entity.object.review_state).toBe('PROPOSED');

    const relation = mapLegacyRelation(
      {
        fromLegacyEntityId: 'entity-001',
        toLegacyEntityId: 'entity-002',
        predicate: 'related_to',
        weight: 2,
        sourceNotePaths: [baseNote.path],
        createdAt: baseNote.updatedAt,
      },
      context,
    );

    expect(relation.object.payload.from_object_id).toBe(entityObjectId('personal', 'entity-001'));
    expect(relation.object.payload.to_object_id).toBe(entityObjectId('personal', 'entity-002'));
    expect(relation.object.payload.weight).toBe(2);
    expect(relation.object.confidence).toBeNull();
    expect(relation.object.source_refs).toEqual([sourceObjectIdForNote('personal', baseNote.path)]);
  });

  it('allows only namespace/purpose/consumer/privacy-matching reads and emits content-safe receipts', () => {
    const object = mapLegacyNote(baseNote, context).knowledge.object;
    const allowed = authorizeCanonicalRead(
      object,
      {
        capability_id: 'agent.reader',
        namespace: 'personal',
        purpose: 'retrieval',
        privacy_ceiling: 'D1',
      },
      '2026-08-11T08:00:00.000Z',
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.object?.object_id).toBe(object.object_id);
    expect(allowed.receipt.reason).toBe('POLICY_MATCH');

    const deniedPurpose = authorizeCanonicalRead(
      object,
      {
        capability_id: 'agent.reader',
        namespace: 'personal',
        purpose: 'marketing',
        privacy_ceiling: 'D1',
      },
      '2026-08-11T08:00:00.000Z',
    );
    expect(deniedPurpose.allowed).toBe(false);
    expect(deniedPurpose.object).toBeNull();
    expect(deniedPurpose.receipt.reason).toBe('PURPOSE_DENIED');
    expect(JSON.stringify(deniedPurpose.receipt)).not.toContain(baseNote.title);
    expect(JSON.stringify(deniedPurpose.receipt)).not.toContain(baseNote.body);

    const d2Object = { ...object, privacy_class: 'D2' as const };
    const deniedPrivacy = authorizeCanonicalRead(
      d2Object,
      {
        capability_id: 'agent.reader',
        namespace: 'personal',
        purpose: 'retrieval',
        privacy_ceiling: 'D1',
      },
      '2026-08-11T08:00:00.000Z',
    );
    expect(deniedPrivacy.receipt.reason).toBe('PRIVACY_DENIED');
  });

  it('fails closed on unknown schema or privacy state', () => {
    const object = mapLegacyNote(baseNote, context).knowledge.object;
    expect(() => validateCanonicalObject({ ...object, schema_version: '9.9.9' })).toThrow(
      /unsupported schema version/,
    );
    expect(() => validateCanonicalObject({ ...object, privacy_class: 'UNKNOWN' })).toThrow(
      /canonical object envelope is invalid/,
    );
  });

  it('creates Agent writes only as reviewable WRITE_PROPOSAL objects', () => {
    const acceptedUserObject = mapLegacyNote(baseNote, context).knowledge.object;
    expect(acceptedUserObject.review_state).toBe('ACCEPTED');

    const proposal = createWriteProposal({
      capabilityId: 'agent.writer',
      object: acceptedUserObject,
      reason: 'Suggest a corrected summary',
      proposedAt: '2026-08-11T08:10:00.000Z',
    });

    expect(proposal.state).toBe('WRITE_PROPOSAL');
    expect(proposal.proposed_object.review_state).toBe('PROPOSED');
    expect(proposal.proposed_object.updated_by).toBe('agent.writer');
    expect('acceptWriteProposal' in sharedEngine).toBe(false);
    expect('canonicalWrite' in sharedEngine).toBe(false);
  });

  it('does not expose current physical schema names in canonical contract output', () => {
    const mapped = mapLegacyNote(baseNote, context);
    const entity = mapLegacyEntity(
      {
        legacyId: 'e1',
        type: 'concept',
        name: 'Knowledge',
        aliases: [],
        summary: null,
        confidence: null,
        sourceNotePaths: [baseNote.path],
        createdAt: baseNote.createdAt,
        updatedAt: baseNote.updatedAt,
      },
      context,
    );
    const relation = mapLegacyRelation(
      {
        fromLegacyEntityId: 'e1',
        toLegacyEntityId: 'e2',
        predicate: 'related_to',
        weight: 1,
        sourceNotePaths: [baseNote.path],
        createdAt: baseNote.updatedAt,
      },
      context,
    );

    const publicFixture = JSON.stringify([
      mapped.source.object,
      mapped.knowledge.object,
      entity.object,
      relation.object,
    ]);

    for (const physicalName of [
      'kg_nodes',
      'kg_edges',
      'note_entities',
      'rag_index_meta',
      'md_path',
      'trash_entries',
    ]) {
      expect(publicFixture).not.toContain(physicalName);
    }
  });
});
