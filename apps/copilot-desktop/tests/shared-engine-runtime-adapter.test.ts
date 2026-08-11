import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { CanonicalObject, PreviousNoteMapping, RevisionState } from '@copilot/kb';
import type { KgSubgraph, NoteDocument, RagSourceDetail } from '../src/shared/domain-api.js';
import {
  assessDesktopDeletion,
  createDesktopAgentSession,
  createDesktopPortableRoundtripPlan,
  createDesktopProjectionSet,
  mapDesktopKgSubgraph,
  mapDesktopNoteDocument,
  mapDesktopRagSourceDetails,
  readRequestForDesktopContext,
  runDesktopAgentRead,
  runDesktopAgentRetrieval,
  runDesktopAgentWriteProposal,
  runDesktopRetrievalConformance,
  runtimeIdentitySnapshot,
  type DesktopMappedNote,
  type DesktopSharedEngineContext,
} from '../src/main/shared-engine-runtime-adapter.js';

const context: DesktopSharedEngineContext = {
  namespace: 'personal',
  actorId: 'owner',
  purpose: 'retrieval',
  consumerId: 'agent.runtime-test',
  privacyClass: 'D1',
  writeMode: 'WRITE_PROPOSAL',
};

function note(input: Partial<NoteDocument['note']> = {}, body = 'private synthetic note body'): NoteDocument {
  return {
    note: {
      id: input.id ?? 7,
      path: input.path ?? 'inbox/runtime-note',
      title: input.title ?? 'Runtime Note',
      type: input.type ?? 'note',
      status: input.status ?? 'active',
      tags: input.tags ?? ['runtime', 'synthetic'],
      related: input.related ?? [],
      folder: input.folder ?? 'inbox',
      createdAt: input.createdAt ?? 1_786_430_000_000,
      updatedAt: input.updatedAt ?? 1_786_430_100_000,
      confidence: input.confidence ?? 0.9,
      agent: input.agent ?? null,
    },
    body,
  };
}

function revisionState(object: CanonicalObject): RevisionState {
  return {
    object_id: object.object_id,
    content_hash: object.content_hash,
    revision: object.revision,
  };
}

function previous(mapping: DesktopMappedNote): PreviousNoteMapping {
  return {
    source: revisionState(mapping.mapping.source.object),
    knowledge: revisionState(mapping.mapping.knowledge.object),
  };
}

function graph(rowOffset = 0): KgSubgraph {
  return {
    nodes: [
      {
        id: 10 + rowOffset,
        entity_id: 'person:alice',
        type: 'person',
        name: 'Alice',
        aliases: ['A'],
        summary: 'synthetic person',
        confidence: 0.91,
        source_notes: ['inbox/runtime-note'],
        created_at: 1_786_430_000_000,
        updated_at: 1_786_430_100_000,
      },
      {
        id: 20 + rowOffset,
        entity_id: 'org:example',
        type: 'org',
        name: 'Example Org',
        aliases: [],
        summary: null,
        confidence: 0.82,
        source_notes: ['inbox/runtime-note'],
        created_at: 1_786_430_000_000,
        updated_at: 1_786_430_100_000,
      },
    ],
    edges: [
      {
        id: 30 + rowOffset,
        from_entity_id: 'person:alice',
        to_entity_id: 'org:example',
        rel: 'works_at',
        weight: 0.8,
        evidence: ['inbox/runtime-note'],
        created_at: 1_786_430_100_000,
      },
    ],
    degree: { 'person:alice': 1, 'org:example': 1 },
  };
}

function rag(score = 0.91): RagSourceDetail[] {
  return [
    {
      notePath: 'inbox/runtime-note',
      evidence: ['vector', 'kg-entity', 'kg-neighbor'],
      score,
    },
  ];
}

describe('C6 real NoteDocument mapping', () => {
  it('ignores SQLite surrogate note id and preserves stable canonical IDs across restart-shaped DTOs', () => {
    const first = mapDesktopNoteDocument(note({ id: 7 }), context);
    const reopened = mapDesktopNoteDocument(note({ id: 999 }), context);

    expect(reopened.mapping.source.object.object_id).toBe(first.mapping.source.object.object_id);
    expect(reopened.mapping.knowledge.object.object_id).toBe(first.mapping.knowledge.object.object_id);
    expect(reopened.mapping.source.object.content_hash).toBe(first.mapping.source.object.content_hash);
    expect(reopened.mapping.knowledge.object.content_hash).toBe(first.mapping.knowledge.object.content_hash);
    expect(JSON.stringify(reopened)).not.toContain('"id":999');
  });

  it('increments source and knowledge revisions while keeping IDs stable after a body change', () => {
    const first = mapDesktopNoteDocument(note(), context);
    const updated = mapDesktopNoteDocument(
      note({ updatedAt: 1_786_430_200_000 }, 'updated synthetic body'),
      context,
      previous(first),
    );

    expect(updated.mapping.source.object.object_id).toBe(first.mapping.source.object.object_id);
    expect(updated.mapping.knowledge.object.object_id).toBe(first.mapping.knowledge.object.object_id);
    expect(updated.mapping.source.object.revision).toBe(2);
    expect(updated.mapping.knowledge.object.revision).toBe(2);
    expect(updated.mapping.source.receipt.operation).toBe('REVISED');
    expect(updated.mapping.knowledge.receipt.operation).toBe('REVISED');
  });

  it('maps agent-produced notes as proposed inference and user notes as accepted declarations', () => {
    const user = mapDesktopNoteDocument(note({ agent: null }), context);
    const agent = mapDesktopNoteDocument(note({ agent: 'agent.writer' }), context);
    expect(user.mapping.knowledge.object.review_state).toBe('ACCEPTED');
    expect(user.mapping.knowledge.object.assertion_type).toBe('USER_DECLARED_FACT');
    expect(agent.mapping.knowledge.object.review_state).toBe('PROPOSED');
    expect(agent.mapping.knowledge.object.assertion_type).toBe('SYSTEM_INFERENCE');
  });

  it('fails closed on malformed NoteDocument and incomplete runtime context', () => {
    expect(() => mapDesktopNoteDocument(null as never, context)).toThrow(/malformed/);
    expect(() => mapDesktopNoteDocument(note(), { ...context, consumerId: ' ' })).toThrow(/context is incomplete/);
  });
});

describe('C6 actual KG DTO mapping', () => {
  it('ignores physical KG row ids and maps stable entity/relation identity from public DTO fields', () => {
    const first = mapDesktopKgSubgraph(graph(0), context);
    const reloaded = mapDesktopKgSubgraph(graph(1000), context);
    expect(reloaded.entities.map((entry) => entry.object_id)).toEqual(first.entities.map((entry) => entry.object_id));
    expect(reloaded.relations.map((entry) => entry.object_id)).toEqual(first.relations.map((entry) => entry.object_id));
    expect(first.entities[0]?.source_refs[0]).toMatch(/^ske:0\.3:source:/);
    expect(first.relations[0]?.source_refs[0]).toMatch(/^ske:0\.3:source:/);
  });

  it('fails closed when a relation endpoint is absent from the supplied subgraph', () => {
    const invalid = graph();
    invalid.edges[0] = { ...invalid.edges[0]!, to_entity_id: 'org:missing' };
    expect(() => mapDesktopKgSubgraph(invalid, context)).toThrow(/absent from the supplied subgraph/);
  });

  it('fails closed on malformed KG DTO structure', () => {
    expect(() => mapDesktopKgSubgraph({ nodes: null, edges: [], degree: {} } as never, context)).toThrow(/malformed/);
  });
});

describe('C6 six-surface projection identity', () => {
  it('keeps one Knowledge object id/hash/revision/source refs across all six product surfaces', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const set = createDesktopProjectionSet(mapped);
    const projections = Object.values(set.projections);
    expect(projections).toHaveLength(6);
    expect(new Set(projections.map((entry) => entry.canonical_object_id))).toEqual(new Set([set.object_id]));
    expect(new Set(projections.map((entry) => entry.canonical_content_hash))).toEqual(
      new Set([mapped.mapping.knowledge.object.content_hash]),
    );
    expect(new Set(projections.map((entry) => entry.canonical_revision))).toEqual(
      new Set([mapped.mapping.knowledge.object.revision]),
    );
    for (const projection of projections) {
      expect(projection.source_refs).toEqual(mapped.mapping.knowledge.object.source_refs);
      expect(projection.authoritative).toBe(false);
      expect(projection.rebuildable).toBe(true);
    }
  });

  it('rebuilds stable projection ids for the same exact runtime DTO', () => {
    const a = createDesktopProjectionSet(mapDesktopNoteDocument(note(), context));
    const b = createDesktopProjectionSet(mapDesktopNoteDocument(note({ id: 999 }), context));
    expect(Object.fromEntries(Object.entries(a.projections).map(([kind, p]) => [kind, p.projection_id]))).toEqual(
      Object.fromEntries(Object.entries(b.projections).map(([kind, p]) => [kind, p.projection_id])),
    );
  });
});

describe('C6 actual RAG source-detail mapping and permission-first retrieval', () => {
  it('maps vector/KG evidence to canonical projections and deduplicates by canonical object id', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const hits = mapDesktopRagSourceDetails(rag(), [mapped]);
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((hit) => hit.projection.projection_kind))).toEqual(new Set(['VECTOR', 'GRAPH']));

    const result = runDesktopRetrievalConformance(rag(), [mapped], context, '2026-08-11T10:30:00Z');
    expect(result.retrieval.results).toHaveLength(1);
    expect(result.retrieval.results[0]?.object_id).toBe(mapped.mapping.knowledge.object.object_id);
    expect(result.retrieval.results[0]?.evidence).toHaveLength(2);
    expect(result.grounded_context.items[0]?.object_id).toBe(mapped.mapping.knowledge.object.object_id);
  });

  it('denies D2 before score/evidence enters ranked or grounded output', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    mapped.mapping.knowledge.object.privacy_class = 'D2';
    mapped.mapping.source.object.privacy_class = 'D2';
    const result = runDesktopRetrievalConformance(
      [{ notePath: mapped.note_path, evidence: ['vector'], score: 0.97321 }],
      [mapped],
      context,
      '2026-08-11T10:30:00Z',
    );
    expect(result.retrieval.results).toEqual([]);
    expect(result.grounded_context.items).toEqual([]);
    expect(result.retrieval.receipt.denied[0]?.reason).toBe('PRIVACY_DENIED');
    expect(JSON.stringify(result.retrieval.receipt.denied)).not.toContain('0.97321');
  });

  it('denies a wrong desktop capability consumer without leaking score', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const deniedContext = { ...context, consumerId: 'agent.other' };
    const result = runDesktopRetrievalConformance(
      [{ notePath: mapped.note_path, evidence: ['vector'], score: 0.87654 }],
      [mapped],
      deniedContext,
      '2026-08-11T10:30:00Z',
    );
    expect(result.retrieval.results).toEqual([]);
    expect(result.retrieval.receipt.denied[0]?.reason).toBe('CONSUMER_DENIED');
    expect(JSON.stringify(result.retrieval.receipt.denied)).not.toContain('0.87654');
  });

  it('rejects invalid score, unknown note path and missing retrieval evidence', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    expect(() => mapDesktopRagSourceDetails(rag(Number.NaN), [mapped])).toThrow(/score/);
    expect(() =>
      mapDesktopRagSourceDetails([{ notePath: 'missing', evidence: ['vector'], score: 0.5 }], [mapped]),
    ).toThrow(/no canonical note mapping/);
    expect(() => mapDesktopRagSourceDetails([{ notePath: mapped.note_path, evidence: [], score: 0.5 }], [mapped])).toThrow(
      /declare retrieval evidence/,
    );
    expect(() => mapDesktopRagSourceDetails([{ notePath: mapped.note_path, evidence: ['unknown' as 'vector'], score: 0.5 }], [mapped])).toThrow(
      /unsupported RAG retrieval evidence/,
    );
  });

  it('rejects duplicate note mappings rather than selecting an arbitrary physical row', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    expect(() => mapDesktopRagSourceDetails(rag(), [mapped, mapped])).toThrow(/duplicate note mapping/);
  });
});

describe('C6 C4 Agent seam over desktop mappings', () => {
  it('binds permission scope and manifest to the same capability id', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const session = createDesktopAgentSession(context, { negotiatedAt: '2026-08-11T10:00:00Z' });
    const request = readRequestForDesktopContext(context);
    expect(mapped.mapping.knowledge.object.permission_scope.allowed_consumers).toEqual([session.manifest.capability_id]);
    expect(request.capability_id).toBe(session.manifest.capability_id);
  });

  it('allows canonical read and retrieval for the granted desktop capability', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const session = createDesktopAgentSession(context, { negotiatedAt: '2026-08-11T10:00:00Z' });
    const read = runDesktopAgentRead(session, [mapped], context, '2026-08-11T10:10:00Z');
    expect(read.objects.map((entry) => entry.object_id)).toEqual([mapped.mapping.knowledge.object.object_id]);
    const retrieved = runDesktopAgentRetrieval(session, rag(), [mapped], context, '2026-08-11T10:10:00Z');
    expect(retrieved.retrieval.results[0]?.object_id).toBe(mapped.mapping.knowledge.object.object_id);
  });

  it('keeps desktop Agent writes proposal-only and rejects read-only sessions', () => {
    const mapped = mapDesktopNoteDocument(note({ agent: 'agent.runtime-test' }), context);
    const writable = createDesktopAgentSession(context, { negotiatedAt: '2026-08-11T10:00:00Z' });
    const proposed = runDesktopAgentWriteProposal(
      writable,
      mapped.mapping.knowledge.object,
      context,
      'DESKTOP_CAPTURE',
      '2026-08-11T10:10:00Z',
    );
    expect(proposed.proposal.proposed_object.review_state).toBe('PROPOSED');
    expect(proposed.receipt.action).toBe('WRITE_PROPOSAL');

    const readOnlyContext = { ...context, writeMode: 'NONE' as const };
    const readOnly = createDesktopAgentSession(readOnlyContext, { negotiatedAt: '2026-08-11T10:00:00Z' });
    expect(() =>
      runDesktopAgentWriteProposal(
        readOnly,
        mapped.mapping.knowledge.object,
        readOnlyContext,
        'DESKTOP_CAPTURE',
        '2026-08-11T10:10:00Z',
      ),
    ).toThrow(/read-only/);
  });
});

describe('C6 C5 portability over real NoteDocument mapping', () => {
  it('exports Source+Knowledge and returns an ADD-only import plan without physical writes', () => {
    const roundtrip = createDesktopPortableRoundtripPlan([note()], context, [], '2026-08-11T10:30:00Z');
    expect(roundtrip.bundle.objects).toHaveLength(2);
    expect(roundtrip.bundle.source_bytes).toHaveLength(1);
    expect(roundtrip.import_plan.operations.map((entry) => entry.operation)).toEqual(['ADD', 'ADD']);
    expect(roundtrip.import_plan.physical_write_performed).toBe(false);
    expect(Buffer.from(roundtrip.bundle.source_bytes[0]?.data_base64 ?? '', 'base64').toString('utf8')).toBe(
      'private synthetic note body',
    );
  });

  it('returns UNCHANGED for an exact local canonical roundtrip and stable bundle id across time', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const local = [mapped.mapping.source.object, mapped.mapping.knowledge.object];
    const a = createDesktopPortableRoundtripPlan([note()], context, local, '2026-08-11T10:30:00Z');
    const b = createDesktopPortableRoundtripPlan([note({ id: 999 })], context, local, '2026-08-11T11:30:00Z');
    expect(a.bundle.bundle_id).toBe(b.bundle.bundle_id);
    expect(a.import_plan.operations.every((entry) => entry.operation === 'UNCHANGED')).toBe(true);
  });
});

describe('C6 actual local trash cleanup maps to honest deletion state', () => {
  it('does not claim COMPLETE when current desktop cleanup proves only active search + KG + RAG', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const result = assessDesktopDeletion(
      mapped,
      {
        active_search_removed: true,
        kg_removed: true,
        rag_removed: true,
      },
      { authority_kind: 'USER', authority_id: 'owner', reason_code: 'USER_DELETE' },
      '2026-08-11T10:30:00Z',
    );
    expect(result.overall_state).toBe('PENDING');
    expect(result.completed_targets).toEqual(expect.arrayContaining(['FULL_TEXT', 'GRAPH', 'VECTOR']));
    expect(result.pending_targets).toEqual(
      expect.arrayContaining(['SOURCE_BYTES', 'CANONICAL_OBJECT', 'WIKI', 'CARD_2D', 'DIALOGUE_CONTEXT', 'CACHE', 'REPLICA']),
    );
    expect(result.tombstone).toBeNull();
  });

  it('reports FAILED if a known surface cleanup explicitly failed', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const result = assessDesktopDeletion(
      mapped,
      { active_search_removed: true, kg_removed: true, rag_removed: false },
      { authority_kind: 'USER', authority_id: 'owner', reason_code: 'USER_DELETE' },
    );
    expect(result.overall_state).toBe('FAILED');
    expect(result.failed_targets).toEqual(['VECTOR']);
  });

  it('reaches COMPLETE only when all ten target proofs are explicitly true', () => {
    const mapped = mapDesktopNoteDocument(note(), context);
    const result = assessDesktopDeletion(
      mapped,
      {
        active_search_removed: true,
        kg_removed: true,
        rag_removed: true,
        source_bytes_deleted: true,
        canonical_tombstoned: true,
        wiki_removed: true,
        card_removed: true,
        dialogue_removed: true,
        cache_removed: true,
        replica_removed: true,
      },
      { authority_kind: 'USER', authority_id: 'owner', reason_code: 'USER_DELETE' },
    );
    expect(result.overall_state).toBe('COMPLETE');
    expect(result.tombstone?.content_retained).toBe(false);
  });
});

describe('C6 restart identity snapshot', () => {
  it('is stable across physical note row id changes and excludes physical ids/paths', () => {
    const first = runtimeIdentitySnapshot(note({ id: 1 }), context);
    const reopened = runtimeIdentitySnapshot(note({ id: 999 }), context);
    expect(reopened).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('999');
    expect(JSON.stringify(first)).not.toContain('md_path');
    expect(JSON.stringify(first)).not.toContain('sqlite');
  });
});
