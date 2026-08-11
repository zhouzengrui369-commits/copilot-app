/**
 * KnowledgeGraph — shared types (Sprint 1.2 / T-1.2.2).
 *
 * The graph renderer is a pure presentational layer that consumes
 * `@copilot/kg` domain types (Entity / Relation / Subgraph) and
 * re-shapes them into sigma.js + graphology node/edge attributes.
 *
 * KG is 100% local (decision red line #2 in goal.md v6.2) — this
 * module never opens a network socket. The store is queried through
 * `useKgData` which goes through the Electron preload bridge in
 * production and an explicitly injected in-memory fixture during tests.
 */

import type { Entity, EntityType, Relation, Subgraph } from '@copilot/kg';

/** Node attribute shape that lands in the graphology instance. */
export interface KgGraphNode {
  /** Mirror of the @copilot/kg Entity.entity_id — used as graphology key. */
  entity_id: string;
  /** Mirror of Entity.type — drives node colour. */
  type: EntityType;
  /** Mirror of Entity.name — drives node label. */
  name: string;
  /** Optional summary (≤ 60 chars). */
  summary: string | null;
  /** Source-note count for sizing. */
  sourceCount: number;
  /** Pre-computed [x, y] position in graphology space. */
  x?: number;
  y?: number;
  /** Pre-computed display size (px radius). */
  size: number;
  /** Pre-computed colour hex string. */
  color: string;
}

/** Edge attribute shape that lands in the graphology instance. */
export interface KgGraphEdge {
  rel: string;
  weight: number;
  /** Display colour — dimmed when filtered. */
  color: string;
}

/** Filter applied to the graph (type allowlist + tag filter). */
export interface KgFilter {
  /** Allowed entity types. Empty = no type filter. */
  types: ReadonlySet<EntityType>;
  /** Allowed tag names. Empty = no tag filter (tags live in kg_tags table). */
  tags: ReadonlySet<string>;
  /** Search term (substring match against Entity.name; case-insensitive). */
  search: string;
}

/** Props for the main KnowledgeGraph component. */
export interface KnowledgeGraphProps {
  /**
   * Explicitly injected graph source. When absent, KnowledgeGraph keeps its
   * existing chrome/canvas but fails closed as unavailable with zero graph
   * nodes and edges; it never creates a fixture implicitly.
   */
  dataSource?: KgDataSource;
  /** Initial filter (default: empty filter = show everything). */
  initialFilter?: Partial<KgFilter>;
  /** Fired when the user clicks a node. */
  onNodeClick?: (entity: Entity) => void;
  /** Fired when the user hovers a node (debounced). */
  onNodeHover?: (entity: Entity | null) => void;
  /** Fired when the user pans / zooms the camera. */
  onCameraChange?: (camera: { x: number; y: number; ratio: number }) => void;
}

/** Abstraction over the KG data layer — easy to stub in tests. */
export interface KgDataSource {
  /** Snapshot the full graph. Capped at `maxNodes` to stay snappy. */
  getSubgraph(maxNodes?: number): Promise<Subgraph>;
}

/** Default filter = show all. */
export const EMPTY_FILTER: KgFilter = {
  types: new Set<EntityType>(),
  tags: new Set<string>(),
  search: '',
};

/** Palette per EntityType — must stay consistent with FilterPanel chips. */
export const ENTITY_PALETTE: Record<EntityType, string> = {
  person: '#5b8def',
  org: '#f6a623',
  concept: '#7ed321',
  event: '#ff5e7e',
  place: '#9b59b6',
  product: '#16a085',
  document: '#34495e',
  topic: '#e67e22',
  other: '#95a5a6',
};

/** Convert Entity → graphology node attributes (sizing + colour). */
export function toGraphNode(entity: Entity): KgGraphNode {
  const sourceCount = entity.source_notes.length;
  const baseSize = 4;
  const sizeBoost = Math.min(8, Math.sqrt(sourceCount) * 2);
  return {
    entity_id: entity.entity_id,
    type: entity.type,
    name: entity.name,
    summary: entity.summary,
    sourceCount,
    size: baseSize + sizeBoost,
    color: ENTITY_PALETTE[entity.type] ?? ENTITY_PALETTE.other,
  };
}

/** Convert Relation → graphology edge attributes. */
export function toGraphEdge(relation: Relation): KgGraphEdge {
  return {
    rel: relation.rel,
    weight: relation.weight ?? 0.5,
    color: '#cbd5e0',
  };
}

/** Pure predicate used by FilterPanel + SearchBox. */
export function passesFilter(
  node: KgGraphNode,
  filter: KgFilter,
): boolean {
  if (filter.types.size > 0 && !filter.types.has(node.type)) {
    return false;
  }
  if (filter.search.trim().length > 0) {
    const needle = filter.search.trim().toLowerCase();
    if (!node.name.toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

/** Pure helper — count how many nodes would survive a filter. */
export function countVisible(
  nodes: ReadonlyArray<KgGraphNode>,
  filter: KgFilter,
): number {
  let n = 0;
  for (const node of nodes) if (passesFilter(node, filter)) n += 1;
  return n;
}
