import type { KgSubgraph, WikiTruthReceipt } from '../../shared/domain-api.js';
import type { CopilotNoteSummary } from '../lib/copilot-api.js';

export type KnowledgeReviewDecision = 'accepted' | 'deferred';
export type KnowledgeReviewState =
  | 'current'
  | 'queued'
  | 'running'
  | 'stale'
  | 'failed'
  | 'missing'
  | 'not-ready';

export interface KnowledgeReviewDecisionRecord {
  decision: KnowledgeReviewDecision;
  decidedAt: number;
}

export type KnowledgeReviewDecisionMap = Record<string, KnowledgeReviewDecisionRecord>;

export interface KnowledgeReviewItem {
  id: string;
  notePath: string;
  title: string;
  state: KnowledgeReviewState;
  priority: 0 | 1 | 2 | 3 | 4;
  summary: string | null;
  generatedAt: number | null;
  provider: string | null;
  model: string | null;
  contentDigest: string | null;
  decision: KnowledgeReviewDecisionRecord | null;
  needsAttention: boolean;
}

export interface KnowledgeActivityCounts {
  total: number;
  current: number;
  queued: number;
  running: number;
  stale: number;
  failed: number;
  missing: number;
  notReady: number;
}

export interface KnowledgeConnectionScore {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  directLink: number;
  sourceOverlap: number;
  adamicAdar: number;
  typeAffinity: number;
  score: number;
  sharedSources: string[];
}

function currentProjection(truth: WikiTruthReceipt | null | undefined) {
  if (!truth || truth.truth !== 'current') return null;
  const projection = truth.current ?? truth.projection;
  if (!projection || projection.status !== 'current') return null;
  if (!truth.expectedContentDigest || projection.contentDigest !== truth.expectedContentDigest) return null;
  return projection;
}

export function knowledgeReviewState(
  truth: WikiTruthReceipt | null | undefined,
): KnowledgeReviewState {
  const build = truth?.knowledgeBuild?.state;
  if (build === 'queued' || build === 'running' || build === 'failed' || build === 'not-ready') {
    return build;
  }
  if (!truth) return 'missing';
  if (currentProjection(truth)) return 'current';
  if (truth.truth === 'stale' || truth.truth === 'failed' || truth.truth === 'missing') {
    return truth.truth;
  }
  return 'not-ready';
}

function reviewPriority(state: KnowledgeReviewState): 0 | 1 | 2 | 3 | 4 {
  switch (state) {
    case 'failed':
      return 0;
    case 'stale':
    case 'missing':
      return 1;
    case 'not-ready':
      return 2;
    case 'queued':
    case 'running':
      return 3;
    case 'current':
      return 4;
  }
}

export function knowledgeReviewId(
  note: CopilotNoteSummary,
  truth: WikiTruthReceipt | null | undefined,
): string {
  const projection = currentProjection(truth) ?? truth?.latest ?? truth?.projection ?? null;
  const identity = projection?.projectionId
    ?? projection?.contentDigest
    ?? truth?.expectedContentDigest
    ?? `note-${note.updatedAt ?? note.updated_at ?? 0}`;
  return `${encodeURIComponent(note.path)}::${identity}`;
}

export function buildKnowledgeReviewItems(
  notes: readonly CopilotNoteSummary[],
  truths: Readonly<Record<string, WikiTruthReceipt | undefined>>,
  decisions: KnowledgeReviewDecisionMap = {},
): KnowledgeReviewItem[] {
  return notes.map((note) => {
    const truth = truths[note.path];
    const projection = currentProjection(truth) ?? truth?.latest ?? truth?.projection ?? null;
    const state = knowledgeReviewState(truth);
    const id = knowledgeReviewId(note, truth);
    const decision = decisions[id] ?? null;
    return {
      id,
      notePath: note.path,
      title: note.title,
      state,
      priority: reviewPriority(state),
      summary: projection?.summary ?? null,
      generatedAt: projection?.generatedAt ?? null,
      provider: projection?.provenance?.provider ?? null,
      model: projection?.provenance?.model ?? null,
      contentDigest: projection?.contentDigest ?? truth?.expectedContentDigest ?? null,
      decision,
      needsAttention: state !== 'current' || decision?.decision !== 'accepted',
    };
  }).sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.decision?.decision !== right.decision?.decision) {
      if (!left.decision) return -1;
      if (!right.decision) return 1;
      if (left.decision.decision === 'deferred') return -1;
      if (right.decision.decision === 'deferred') return 1;
    }
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

export function summarizeKnowledgeActivity(
  notes: readonly CopilotNoteSummary[],
  truths: Readonly<Record<string, WikiTruthReceipt | undefined>>,
): KnowledgeActivityCounts {
  const counts: KnowledgeActivityCounts = {
    total: notes.length,
    current: 0,
    queued: 0,
    running: 0,
    stale: 0,
    failed: 0,
    missing: 0,
    notReady: 0,
  };
  for (const note of notes) {
    switch (knowledgeReviewState(truths[note.path])) {
      case 'current': counts.current += 1; break;
      case 'queued': counts.queued += 1; break;
      case 'running': counts.running += 1; break;
      case 'stale': counts.stale += 1; break;
      case 'failed': counts.failed += 1; break;
      case 'missing': counts.missing += 1; break;
      case 'not-ready': counts.notReady += 1; break;
    }
  }
  return counts;
}

function pairId(left: string, right: string): string {
  return left < right ? `${left}::${right}` : `${right}::${left}`;
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value)).sort();
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Clean-room implementation of the four-signal relevance idea documented by
 * nashsu/llm_wiki. It intentionally shares no upstream implementation bytes.
 * Signals are normalized for Copilot's existing local KG contract:
 * direct relation ×3, source overlap ×4, Adamic-Adar ×1.5, same type ×1.
 */
export function scoreKnowledgeConnections(
  graph: KgSubgraph,
  limit = 24,
): KnowledgeConnectionScore[] {
  const nodes = graph.nodes;
  const nodeById = new Map(nodes.map((node) => [node.entity_id, node]));
  const neighbors = new Map<string, Set<string>>();
  const directWeights = new Map<string, number>();
  for (const node of nodes) neighbors.set(node.entity_id, new Set());
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.from_entity_id) || !nodeById.has(edge.to_entity_id)) continue;
    neighbors.get(edge.from_entity_id)?.add(edge.to_entity_id);
    neighbors.get(edge.to_entity_id)?.add(edge.from_entity_id);
    directWeights.set(pairId(edge.from_entity_id, edge.to_entity_id), Math.max(0, edge.weight ?? 1));
  }

  const out: KnowledgeConnectionScore[] = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      const sharedSources = intersection(left.source_notes ?? [], right.source_notes ?? []);
      const sourceBase = Math.max(1, Math.min(left.source_notes?.length ?? 0, right.source_notes?.length ?? 0));
      const sourceOverlap = sharedSources.length / sourceBase;
      const leftNeighbors = neighbors.get(left.entity_id) ?? new Set<string>();
      const rightNeighbors = neighbors.get(right.entity_id) ?? new Set<string>();
      let adamicAdar = 0;
      for (const neighborId of leftNeighbors) {
        if (!rightNeighbors.has(neighborId)) continue;
        const degree = graph.degree[neighborId] ?? neighbors.get(neighborId)?.size ?? 0;
        adamicAdar += 1 / Math.log(Math.max(2, degree + 1));
      }
      const directLink = directWeights.has(pairId(left.entity_id, right.entity_id)) ? 1 : 0;
      const typeAffinity = left.type === right.type ? 1 : 0;
      const score = (directLink * 3) + (sourceOverlap * 4) + (adamicAdar * 1.5) + typeAffinity;
      if (score <= 0) continue;
      out.push({
        id: pairId(left.entity_id, right.entity_id),
        fromId: left.entity_id,
        fromName: left.name,
        toId: right.entity_id,
        toName: right.name,
        directLink,
        sourceOverlap: rounded(sourceOverlap),
        adamicAdar: rounded(adamicAdar),
        typeAffinity,
        score: rounded(score),
        sharedSources,
      });
    }
  }

  return out
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit));
}
