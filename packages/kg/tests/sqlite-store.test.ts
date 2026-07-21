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
import { KgStore } from '../src/store/sqlite-store.js';

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
