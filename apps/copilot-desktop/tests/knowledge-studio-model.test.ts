import { describe, expect, it } from 'vitest';
import type { KgSubgraph, WikiTruthReceipt } from '../src/shared/domain-api.js';
import {
  buildKnowledgeReviewItems,
  knowledgeReviewId,
  scoreKnowledgeConnections,
  summarizeKnowledgeActivity,
  type KnowledgeReviewDecisionMap,
} from '../src/renderer/workspaces/knowledge-studio-model.js';

const now = 1_786_000_000_000;

function truth(
  path: string,
  state: 'current' | 'stale' | 'failed' | 'missing',
  build: 'queued' | 'running' | 'ready' | 'failed' | 'not-ready' = 'ready',
): WikiTruthReceipt {
  const projection = state === 'missing' ? null : {
    projectionId: `projection:${path}`,
    notePath: path,
    status: state === 'current' ? 'current' as const : state === 'stale' ? 'stale' as const : 'failed' as const,
    contentDigest: `digest-${path}`,
    summary: state === 'failed' ? null : `Summary ${path}`,
    tags: ['tag'],
    entityIds: ['concept:a'],
    relationSignatures: [],
    generatedAt: now,
    failureStage: state === 'failed' ? 'provider' as const : null,
    failureReason: state === 'failed' ? 'provider unavailable' : null,
    provenance: state === 'failed' ? null : { provider: 'minimax', model: 'm3', generatedAt: now },
  };
  return {
    notePath: path,
    expectedContentDigest: `digest-${path}`,
    truth: state,
    projection,
    current: state === 'current' ? projection : null,
    latest: projection,
    stale: state === 'stale' && projection ? [projection] : [],
    failed: state === 'failed' && projection ? [projection] : [],
    provenance: projection?.provenance ?? null,
    knowledgeBuild: { state: build, revision: `note:${now}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` },
  };
}

describe('knowledge studio review model', () => {
  const notes = [
    { path: 'notes/current.md', title: 'Current', updatedAt: now },
    { path: 'notes/failed.md', title: 'Failed', updatedAt: now + 1 },
    { path: 'notes/queued.md', title: 'Queued', updatedAt: now + 2 },
  ];

  it('prioritizes failed/stale work while keeping current projections reviewable', () => {
    const truths = {
      'notes/current.md': truth('notes/current.md', 'current'),
      'notes/failed.md': truth('notes/failed.md', 'failed', 'failed'),
      'notes/queued.md': truth('notes/queued.md', 'missing', 'queued'),
    };
    const items = buildKnowledgeReviewItems(notes, truths);
    expect(items.map((item) => item.state)).toEqual(['failed', 'queued', 'current']);
    expect(items[0].needsAttention).toBe(true);
    expect(items[2].needsAttention).toBe(true);
    expect(items[2].provider).toBe('minimax');
  });

  it('binds a local review decision to one projection identity only', () => {
    const currentTruth = truth('notes/current.md', 'current');
    const id = knowledgeReviewId(notes[0], currentTruth);
    const decisions: KnowledgeReviewDecisionMap = {
      [id]: { decision: 'accepted', decidedAt: now + 50 },
    };
    const [item] = buildKnowledgeReviewItems([notes[0]], {
      'notes/current.md': currentTruth,
    }, decisions);
    expect(item.decision?.decision).toBe('accepted');
    expect(item.needsAttention).toBe(false);

    const changedTruth = {
      ...currentTruth,
      current: currentTruth.current ? {
        ...currentTruth.current,
        projectionId: 'projection:new',
        contentDigest: 'digest-new',
      } : null,
      projection: currentTruth.projection ? {
        ...currentTruth.projection,
        projectionId: 'projection:new',
        contentDigest: 'digest-new',
      } : null,
      expectedContentDigest: 'digest-new',
    } satisfies WikiTruthReceipt;
    const [changed] = buildKnowledgeReviewItems([notes[0]], {
      'notes/current.md': changedTruth,
    }, decisions);
    expect(changed.id).not.toBe(id);
    expect(changed.decision).toBeNull();
    expect(changed.needsAttention).toBe(true);
  });

  it('summarizes durable build truth without inventing success', () => {
    const counts = summarizeKnowledgeActivity(notes, {
      'notes/current.md': truth('notes/current.md', 'current'),
      'notes/failed.md': truth('notes/failed.md', 'failed', 'failed'),
      'notes/queued.md': truth('notes/queued.md', 'missing', 'queued'),
    });
    expect(counts).toEqual({
      total: 3,
      current: 1,
      queued: 1,
      running: 0,
      stale: 0,
      failed: 1,
      missing: 0,
      notReady: 0,
    });
  });
});

describe('clean-room four-signal relevance', () => {
  it('combines direct links, source overlap, Adamic-Adar and type affinity', () => {
    const graph: KgSubgraph = {
      nodes: [
        {
          id: 1,
          entity_id: 'concept:a',
          type: 'concept',
          name: 'A',
          aliases: [],
          summary: null,
          confidence: 1,
          source_notes: ['s1', 's2'],
          created_at: now,
          updated_at: now,
        },
        {
          id: 2,
          entity_id: 'concept:b',
          type: 'concept',
          name: 'B',
          aliases: [],
          summary: null,
          confidence: 1,
          source_notes: ['s2'],
          created_at: now,
          updated_at: now,
        },
        {
          id: 3,
          entity_id: 'topic:c',
          type: 'topic',
          name: 'C',
          aliases: [],
          summary: null,
          confidence: 1,
          source_notes: ['s3'],
          created_at: now,
          updated_at: now,
        },
      ],
      edges: [
        { id: 1, from_entity_id: 'concept:a', to_entity_id: 'topic:c', rel: 'related_to', weight: 1, evidence: ['s1'], created_at: now },
        { id: 2, from_entity_id: 'concept:b', to_entity_id: 'topic:c', rel: 'related_to', weight: 1, evidence: ['s2'], created_at: now },
      ],
      degree: { 'concept:a': 1, 'concept:b': 1, 'topic:c': 2 },
    };
    const scores = scoreKnowledgeConnections(graph);
    const ab = scores.find((item) => item.id === 'concept:a::concept:b');
    expect(ab).toBeDefined();
    expect(ab?.sourceOverlap).toBe(1);
    expect(ab?.typeAffinity).toBe(1);
    expect(ab?.adamicAdar).toBeGreaterThan(0);
    expect(ab?.score).toBeGreaterThan(5);

    const ac = scores.find((item) => item.id === 'concept:a::topic:c');
    expect(ac?.directLink).toBe(1);
    expect(ac?.typeAffinity).toBe(0);
  });
});
