import { describe, expect, it } from 'vitest';
import {
  checkProjectionFreshness,
  contentHash,
  createProjection,
  knowledgeObjectIdForNote,
  mapLegacyNote,
  permissionFingerprint,
  validateProjectionRecord,
  type C1AdapterContext,
  type LegacyNoteSnapshot,
  type ProjectionKind,
  type ProjectionRecord,
} from '../src/shared-engine/index.js';

const context: C1AdapterContext = {
  namespace: 'personal',
  actorId: 'user:owner',
  purposes: ['retrieval', 'knowledge_management'],
  allowedConsumers: ['agent.reader', 'copilot.desktop'],
  privacyClass: 'D1',
};

const note: LegacyNoteSnapshot = {
  path: 'research/c3-projections',
  title: 'C3 projections',
  type: 'note',
  status: 'active',
  tags: ['c3'],
  related: ['research/shared-engine'],
  sourceHash: 'legacy-c3-source',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.9,
  agent: null,
  body: '# C3\nOne truth, multiple projections.',
};

const kinds: readonly ProjectionKind[] = [
  'CARD_2D',
  'WIKI',
  'FULL_TEXT',
  'VECTOR',
  'GRAPH',
  'DIALOGUE_CONTEXT',
];

const recipe = { recipe_id: 'projection.default', recipe_version: '1' };

function knowledge() {
  return mapLegacyNote(note, context).knowledge.object;
}

function projection(kind: ProjectionKind = 'CARD_2D') {
  return createProjection(knowledge(), kind, { text: `${kind}:summary` }, recipe);
}

describe('C3 stable projection identity', () => {
  it('keeps the same canonical object ID across all six projection surfaces', () => {
    const object = knowledge();
    const projections = kinds.map((kind) => createProjection(object, kind, { kind, title: object.payload.title }, recipe));

    expect(new Set(projections.map((entry) => entry.canonical_object_id))).toEqual(new Set([object.object_id]));
    expect(new Set(projections.map((entry) => entry.projection_kind))).toEqual(new Set(kinds));
    expect(new Set(projections.map((entry) => entry.projection_id)).size).toBe(6);
    for (const entry of projections) {
      expect(entry.canonical_content_hash).toBe(object.content_hash);
      expect(entry.canonical_revision).toBe(object.revision);
      expect(entry.source_refs).toEqual([...object.source_refs].sort());
      expect(entry.authoritative).toBe(false);
      expect(entry.rebuildable).toBe(true);
      expect(entry.permission_fingerprint).toBe(permissionFingerprint(object));
      validateProjectionRecord(entry);
    }
  });

  it('rebuilds the same projection deterministically for identical input and recipe', () => {
    const object = knowledge();
    const first = createProjection(object, 'WIKI', { sections: ['a', 'b'] }, recipe);
    const second = createProjection(object, 'WIKI', { sections: ['a', 'b'] }, recipe);
    expect(first).toEqual(second);
  });

  it('changes only projection identity when the projection payload changes', () => {
    const object = knowledge();
    const first = createProjection(object, 'CARD_2D', { summary: 'v1' }, recipe);
    const second = createProjection(object, 'CARD_2D', { summary: 'v2' }, recipe);
    expect(second.canonical_object_id).toBe(first.canonical_object_id);
    expect(second.canonical_content_hash).toBe(first.canonical_content_hash);
    expect(second.projection_id).not.toBe(first.projection_id);
    expect(second.projection_payload_hash).not.toBe(first.projection_payload_hash);
  });

  it('normalizes permission order into the same permission fingerprint', () => {
    const object = knowledge();
    const reordered = {
      ...object,
      permission_scope: {
        ...object.permission_scope,
        purposes: [...object.permission_scope.purposes].reverse(),
        allowed_consumers: [...object.permission_scope.allowed_consumers].reverse(),
      },
    };
    expect(permissionFingerprint(reordered)).toBe(permissionFingerprint(object));
  });

  it('requires a non-empty projection recipe identity', () => {
    const object = knowledge();
    expect(() => createProjection(object, 'WIKI', {}, { recipe_id: '', recipe_version: '1' })).toThrow(/recipe_id/);
    expect(() => createProjection(object, 'WIKI', {}, { recipe_id: 'wiki', recipe_version: ' ' })).toThrow(/recipe_version/);
  });
});

describe('C3 projection freshness', () => {
  it('reports a fresh exact projection', () => {
    const object = knowledge();
    expect(checkProjectionFreshness(createProjection(object, 'GRAPH', { node: true }, recipe), object)).toEqual({
      fresh: true,
      reasons: [],
    });
  });

  it('detects every canonical identity/provenance/policy drift dimension', () => {
    const object = knowledge();
    const base = createProjection(object, 'VECTOR', { vector_hash: 'sha256-only' }, recipe);
    const replacements: Array<[Partial<ProjectionRecord>, string]> = [
      [{ canonical_object_id: knowledgeObjectIdForNote('personal', 'other/note') }, 'OBJECT_ID_MISMATCH'],
      [{ canonical_object_type: 'Entity' }, 'OBJECT_TYPE_MISMATCH'],
      [{ canonical_content_hash: contentHash('different') }, 'CONTENT_HASH_MISMATCH'],
      [{ canonical_revision: object.revision + 1 }, 'REVISION_MISMATCH'],
      [{ namespace: 'work' }, 'NAMESPACE_MISMATCH'],
      [{ source_refs: [...object.source_refs, knowledgeObjectIdForNote('personal', 'source/extra')] }, 'SOURCE_REFS_MISMATCH'],
      [{ privacy_class: 'D0' }, 'PRIVACY_MISMATCH'],
      [{ permission_fingerprint: contentHash('different-policy') }, 'PERMISSION_MISMATCH'],
    ];

    for (const [patch, reason] of replacements) {
      const freshness = checkProjectionFreshness({ ...base, ...patch }, object);
      expect(freshness.fresh).toBe(false);
      expect(freshness.reasons).toContain(reason);
    }
  });

  it('detects several simultaneous stale dimensions without mutating the projection', () => {
    const object = knowledge();
    const base = createProjection(object, 'FULL_TEXT', { body: 'index text' }, recipe);
    const stale = {
      ...base,
      canonical_content_hash: contentHash('old'),
      canonical_revision: object.revision + 1,
      privacy_class: 'D0' as const,
    };
    const before = JSON.stringify(stale);
    const result = checkProjectionFreshness(stale, object);
    expect(result.reasons).toEqual(expect.arrayContaining(['CONTENT_HASH_MISMATCH', 'REVISION_MISMATCH', 'PRIVACY_MISMATCH']));
    expect(JSON.stringify(stale)).toBe(before);
  });
});

describe('C3 projection record validation', () => {
  it('rejects non-object projection records', () => {
    expect(() => validateProjectionRecord(null)).toThrow(/must be an object/);
    expect(() => validateProjectionRecord([])).toThrow(/must be an object/);
  });

  it('fails closed for malformed projection contract fields', () => {
    const valid = projection();
    const invalidRecords: unknown[] = [
      { ...valid, projection_id: 'row:1' },
      { ...valid, projection_kind: 'SQL_ROW' },
      { ...valid, canonical_object_id: 'row:1' },
      { ...valid, canonical_object_type: 'PhysicalRow' },
      { ...valid, canonical_content_hash: 'bad' },
      { ...valid, canonical_revision: 0 },
      { ...valid, canonical_revision: 1.2 },
      { ...valid, namespace: '' },
      { ...valid, source_refs: 'not-array' },
      { ...valid, privacy_class: 'D9' },
      { ...valid, permission_fingerprint: 'bad' },
      { ...valid, projection_payload_hash: 'bad' },
      { ...valid, recipe_id: '' },
      { ...valid, recipe_version: '' },
      { ...valid, authoritative: true },
      { ...valid, rebuildable: false },
    ];
    for (const invalid of invalidRecords) {
      expect(() => validateProjectionRecord(invalid)).toThrow(/projection record is invalid/);
    }
  });
});
