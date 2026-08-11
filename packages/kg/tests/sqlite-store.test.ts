/**
 * KgStore tests (wave 1 — kg_nodes + kg_edges + note_entities + kg_tags).
 *
 * Each test uses `:memory:` SQLite via better-sqlite3 to keep the suite
 * hermetic; no temp dirs, no filesystem side-effects.
 *
 * Coverage of the wave 1 acceptance signal:
 *   - KgStore.addNode(=upsertEntity) merges aliases + source_notes + max-confidence
 *   - KgStore.getNode(=getEntityByIdString) / listNodes round-trip
 *   - note_entities bridge maintains 1:N relation from note ↔ entity
 *   - kg_edges + kg_tags CRUD works (these belong to wave 2 surface, but
 *     the schema is shared with wave 1 so we round-trip them as a smoke test).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KgQuery } from '../src/api/query.js';
import { KgStore } from '../src/store/sqlite-store.js';
import type { WikiProjectionInput } from '../src/types.js';

let store: KgStore;

beforeEach(() => {
  store = new KgStore({ dbPath: ':memory:' });
});

describe('KgStore · kg_nodes (wave 1 contract: addNode / getNode / listNodes)', () => {
  it('upsertEntity creates a new row, then updates on conflict (merges aliases + source_notes)', () => {
    const now = 1_700_000_000_000;
    const r1 = store.upsertEntity(
      {
        entity_id: 'person:grace',
        type: 'person',
        name: 'Grace',
        aliases: ['GH'],
        confidence: 0.7,
        source_note: 'note/a',
      },
      now,
    );
    expect(r1.created).toBe(true);
    expect(r1.entity.aliases).toEqual(['GH']);
    expect(r1.entity.source_notes).toEqual(['note/a']);

    const r2 = store.upsertEntity(
      {
        entity_id: 'person:grace',
        type: 'person',
        name: 'Grace',
        aliases: ['Grace Hopper'],
        confidence: 0.95,
        source_note: 'note/b',
      },
      now + 1000,
    );
    expect(r2.created).toBe(false);
    // Aliases dedup + merged
    expect(new Set(r2.entity.aliases)).toEqual(new Set(['GH', 'Grace Hopper']));
    expect(new Set(r2.entity.source_notes)).toEqual(new Set(['note/a', 'note/b']));
    // Confidence = max(existing, new)
    expect(r2.entity.confidence).toBe(0.95);
  });

  it('getEntityByIdString and listNodes round-trip', () => {
    const now = 1_700_000_000_000;
    store.upsertEntity(
      { entity_id: 'person:alice', type: 'person', name: 'Alice', source_note: 'a' },
      now,
    );
    store.upsertEntity(
      { entity_id: 'org:acme', type: 'org', name: 'Acme Inc', source_note: 'b' },
      now,
    );
    store.upsertEntity(
      { entity_id: 'concept:kg', type: 'concept', name: 'Knowledge Graph', source_note: 'c' },
      now,
    );

    expect(store.getEntityByIdString('person:alice')?.name).toBe('Alice');

    const all = store.listNodes();
    expect(all.map((e) => e.name).sort()).toEqual([
      'Acme Inc',
      'Alice',
      'Knowledge Graph',
    ]);

    const people = store.listNodes({ type: 'person' });
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe('Alice');

    expect(store.countNodes()).toBe(3);
    expect(store.countNodes({ type: 'person' })).toBe(1);
  });
});

describe('KgStore · note_entities bridge', () => {
  it('links notes to entities, 1:N both directions', () => {
    const now = 1_700_000_000_000;
    store.upsertEntity(
      { entity_id: 'person:alice', type: 'person', name: 'Alice', source_note: 'a' },
      now,
    );
    store.upsertEntity(
      { entity_id: 'org:acme', type: 'org', name: 'Acme', source_note: 'a' },
      now,
    );
    store.linkNoteEntity('a', 'person:alice');
    store.linkNoteEntity('a', 'org:acme');
    store.linkNoteEntity('b', 'person:alice');

    expect(store.entitiesForNote('a').map((e) => e.name).sort()).toEqual(['Acme', 'Alice']);
    expect(store.notesForEntity('person:alice').sort()).toEqual(['a', 'b']);

    // setNoteEntities atomically replaces the set
    store.setNoteEntities('a', ['org:acme']);
    expect(store.entitiesForNote('a').map((e) => e.name)).toEqual(['Acme']);
  });
});

describe('KgStore · kg_edges + kg_tags (smoke; full coverage in wave 2)', () => {
  it('upsertRelation dedupes by (from, to, rel) PK and merges evidence', () => {
    const now = 1_700_000_000_000;
    store.upsertEntity(
      { entity_id: 'person:alice', type: 'person', name: 'Alice', source_note: 'a' },
      now,
    );
    store.upsertEntity(
      { entity_id: 'org:acme', type: 'org', name: 'Acme', source_note: 'a' },
      now,
    );

    const r1 = store.upsertRelation(
      { from_entity_id: 'person:alice', to_entity_id: 'org:acme', rel: 'works_at', evidence_note: 'a', weight: 0.5 },
      now,
    );
    expect(r1.created).toBe(true);
    expect(r1.relation.weight).toBe(0.5);

    const r2 = store.upsertRelation(
      { from_entity_id: 'person:alice', to_entity_id: 'org:acme', rel: 'works_at', evidence_note: 'b', weight: 0.9 },
      now + 1000,
    );
    expect(r2.created).toBe(false);
    expect(r2.relation.weight).toBe(0.9); // max
    expect(new Set(r2.relation.evidence)).toEqual(new Set(['a', 'b']));

    expect(store.edgesFrom('person:alice')).toHaveLength(1);
    expect(store.edgesTo('org:acme')).toHaveLength(1);
    expect(store.countEdges()).toBe(1);
  });

  it('upsertTag creates new + ignores duplicate names', () => {
    const now = 1_700_000_000_000;
    const r1 = store.upsertTag({ name: 'project' }, now);
    expect(r1.created).toBe(true);
    const r2 = store.upsertTag({ name: 'project' }, now);
    expect(r2.created).toBe(false);
    expect(store.listTags().map((t) => t.name)).toEqual(['project']);

    store.incrementTagCount('project', 3);
    expect(store.listTags()[0]?.note_count).toBe(3);
  });
});

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);

function currentProjection(
  digest: string,
  now: number,
  overrides: Partial<WikiProjectionInput> = {},
): WikiProjectionInput {
  return {
    note_path: 'wiki/note',
    content_digest: digest,
    summary: `Summary ${digest[0]}`,
    tags: ['local-first'],
    entity_ids: ['concept:wiki'],
    relation_signatures: [],
    provenance: { provider: 'fixture', model: 'fixture-model', generated_at: now },
    status: 'current',
    ...overrides,
  };
}

function failedProjection(
  digest: string,
  now: number,
  overrides: Partial<WikiProjectionInput> = {},
): WikiProjectionInput {
  return {
    note_path: 'wiki/note',
    content_digest: digest,
    summary: null,
    tags: [],
    entity_ids: [],
    relation_signatures: [],
    provenance: { provider: 'fixture', model: 'fixture-model', generated_at: now },
    status: 'failed',
    failure_reason: 'fixture failure',
    failure_stage: 'provider',
    ...overrides,
  };
}

describe('KgStore · WIKI persistence safety', () => {
  it('handles A → B → A digest cycling before both successful and failed C attempts', () => {
    store.upsertWikiProjection(currentProjection(DIGEST_A, 1), 1);
    store.upsertWikiProjection(currentProjection(DIGEST_B, 2), 2);
    store.upsertWikiProjection(currentProjection(DIGEST_A, 3), 3);
    const success = store.upsertWikiProjection(currentProjection(DIGEST_C, 4), 4);
    expect(success).toMatchObject({ isCurrent: true, priorMarkedStale: 1 });
    expect(store.listWikiProjectionsForNote('wiki/note')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'current', content_digest: DIGEST_C }),
      expect.objectContaining({ status: 'stale', content_digest: DIGEST_A }),
      expect.objectContaining({ status: 'stale', content_digest: DIGEST_B }),
    ]));
    expect(
      store.listWikiProjectionsForNote('wiki/note')
        .filter((row) => row.content_digest === DIGEST_A && row.status === 'stale'),
    ).toHaveLength(1);

    const failureStore = new KgStore({ dbPath: ':memory:' });
    failureStore.upsertWikiProjection(currentProjection(DIGEST_A, 1), 1);
    failureStore.upsertWikiProjection(currentProjection(DIGEST_B, 2), 2);
    failureStore.upsertWikiProjection(currentProjection(DIGEST_A, 3), 3);
    const failure = failureStore.upsertWikiProjection(failedProjection(DIGEST_C, 4), 4);
    expect(failure).toMatchObject({ isCurrent: false, priorMarkedStale: 1 });
    expect(failureStore.listWikiProjectionsForNote('wiki/note')).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', content_digest: DIGEST_C }),
      expect.objectContaining({ status: 'stale', content_digest: DIGEST_A }),
      expect.objectContaining({ status: 'stale', content_digest: DIGEST_B }),
    ]));
    failureStore.close();
  });

  it('rejects malformed current, failed, digest, provenance, and public stale inputs', () => {
    const invalid = (input: WikiProjectionInput) =>
      expect(() => store.upsertWikiProjection(input, 1)).toThrow();

    invalid(currentProjection('not-a-digest', 1));
    invalid(currentProjection(DIGEST_A, 1, { summary: '   ' }));
    invalid(currentProjection(DIGEST_A, 1, { summary: '长'.repeat(241) }));
    invalid(currentProjection(DIGEST_A, 1, {
      provenance: { provider: '', model: 'fixture', generated_at: 1 },
    }));
    invalid(currentProjection(DIGEST_A, 1, {
      provenance: { provider: 'fixture', model: 'fixture', generated_at: Number.NaN },
    }));
    invalid(currentProjection(DIGEST_A, 1, { tags: ['Not Normalized'] }));
    invalid(currentProjection(DIGEST_A, 1, { relation_signatures: ['broken'] }));
    invalid(currentProjection(DIGEST_A, 1, { failure_reason: 'not allowed' }));
    invalid(failedProjection(DIGEST_A, 1, { summary: 'must be null' }));
    invalid(failedProjection(DIGEST_A, 1, { tags: ['success-facet'] }));
    invalid(failedProjection(DIGEST_A, 1, { failure_reason: ' ' }));
    invalid(failedProjection(DIGEST_A, 1, { failure_stage: null }));
    invalid({ ...currentProjection(DIGEST_A, 1), status: 'stale' } as WikiProjectionInput);
    expect(() => store.upsertWikiProjection(currentProjection(DIGEST_A, 1), Number.NaN))
      .toThrow(/finite/);
  });

  it('canonicalizes normalized deduplicated tags and recursively ordered metadata', () => {
    const first = store.computeNoteContentDigest({
      title: 'Canonical',
      body: 'same',
      tags: [' AI Agent ', '知识 图谱', 'ai-agent'],
      metadata: {
        z: { second: 2, first: { b: true, a: false } },
        a: [{ y: 2, x: 1 }],
      },
    });
    const reordered = store.computeNoteContentDigest({
      title: 'Canonical',
      body: 'same',
      tags: ['知识-图谱', 'AI-Agent'],
      metadata: {
        a: [{ x: 1, y: 2 }],
        z: { first: { a: false, b: true }, second: 2 },
      },
    });
    expect(reordered).toBe(first);
    expect(store.computeNoteContentDigest({
      title: 'Canonical',
      body: 'changed',
      tags: ['知识-图谱', 'ai-agent'],
      metadata: { a: [{ x: 1, y: 2 }], z: { first: { a: false, b: true }, second: 2 } },
    })).not.toBe(first);
  });
});

describe('KgQuery · digest-bound WIKI truth and provenance', () => {
  it('fails closed across current, stale, exact failure, unrelated failure, and missing truth', () => {
    const query = new KgQuery(store);
    expect(query.noteProjection('wiki/note', DIGEST_A)).toMatchObject({
      truth: 'missing',
      current: null,
      provenance: null,
    });

    store.upsertWikiProjection(failedProjection(DIGEST_D, 1), 1);
    expect(query.noteProjection('wiki/note', DIGEST_A)).toMatchObject({
      truth: 'missing',
      provenance: null,
    });

    store.upsertWikiProjection(currentProjection(DIGEST_A, 2), 2);
    expect(query.noteProjection('wiki/note', DIGEST_A)).toMatchObject({
      truth: 'current',
      current: expect.objectContaining({ content_digest: DIGEST_A }),
      provenance: { provider: 'fixture', model: 'fixture-model', generated_at: 2 },
    });
    expect(query.noteProjection('wiki/note')).toMatchObject({
      truth: 'missing',
      current: null,
      provenance: null,
      stale: [expect.objectContaining({ content_digest: DIGEST_A })],
    });
    expect(query.noteProjection('wiki/note', DIGEST_B)).toMatchObject({
      truth: 'stale',
      current: null,
      provenance: { provider: 'fixture', model: 'fixture-model', generated_at: 2 },
    });

    store.upsertWikiProjection(failedProjection(DIGEST_B, 3), 3);
    expect(query.noteProjection('wiki/note', DIGEST_B)).toMatchObject({
      truth: 'failed',
      current: null,
      provenance: null,
    });
    expect(query.noteProjection('wiki/note', DIGEST_C)).toMatchObject({
      truth: 'stale',
      current: null,
      provenance: { provider: 'fixture', model: 'fixture-model', generated_at: 2 },
    });
    expect(query.noteProjection('wiki/note')).toMatchObject({
      truth: 'missing',
      current: null,
      provenance: null,
    });
  });
});
