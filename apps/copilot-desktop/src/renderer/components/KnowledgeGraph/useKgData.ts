/**
 * KnowledgeGraph — data hook (Sprint 1.2 / T-1.2.2).
 *
 * Loads the Subgraph from a `KgDataSource`, projects it into the
 * graphology-ready node/edge attributes, and re-runs the projection
 * whenever the filter changes so the canvas can re-render the
 * reduced set without re-querying SQLite.
 *
 * KG is 100% local (decision red line #2 in goal.md v6.2) — no
 * network traffic. The hook is React-only; no DOM access happens
 * outside `useEffect`s, so it's safe under jsdom in tests.
 *
 * R2 keeps one canonical renderer Entity per KG node. Its source_notes
 * contains only real, navigable local paths in a locale-independent order;
 * graph projection and click callbacks consume that same Entity.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Entity } from '@copilot/kg';
import type { KgDataSource } from './types.js';
import {
  EMPTY_FILTER,
  passesFilter,
  toGraphEdge,
  toGraphNode,
  type KgFilter,
  type KgGraphEdge,
  type KgGraphNode,
} from './types.js';

/**
 * A source path is navigable only after trimming when it is non-empty and
 * does not use the reserved `unknown:` prefix (case-insensitive).
 */
export function isNavigableSource(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  return path.length > 0 && !path.toLowerCase().startsWith('unknown:');
}

function compareBinary(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export interface KgDataState {
  /** All nodes from the data source — unfiltered. */
  nodes: ReadonlyArray<KgGraphNode>;
  /** All edges from the data source — unfiltered. */
  edges: ReadonlyArray<KgGraphEdge>;
  /** Edge keys (`from|to`) in the same order as `edges`. */
  edgeKeys: ReadonlyArray<string>;
  /**
   * Canonical `Entity` objects from the data source, sorted by
   * `entity_id` (stable order, deterministic across renders). The
   * 2D renderer relies on these to drive the source navigation UI;
   * `entityIndex` in `index.tsx` is built from this map, not from
   * the projected `KgGraphNode` shape.
   */
  entities: ReadonlyArray<Entity>;
  /** `entity_id` → canonical `Entity` lookup. */
  entitiesById: ReadonlyMap<string, Entity>;
  /**
   * Canonical navigable `source_notes` per `entity_id`, trimmed, deduped,
   * and sorted without locale/ICU dependence.
   */
  sourceNotesByEntity: ReadonlyMap<string, ReadonlyArray<string>>;
  /** `true` while the Subgraph is being loaded. */
  loading: boolean;
  /** Non-null if loading failed. */
  error: string | null;
  /** Active filter (defaults to EMPTY_FILTER). */
  filter: KgFilter;
  /** Subset of `nodes` that passes `filter`. */
  visibleNodeIds: ReadonlySet<string>;
  /** Subset of `edgeKeys` whose endpoints are both visible. */
  visibleEdgeKeys: ReadonlySet<string>;
  /** Number of nodes that pass `filter`. */
  visibleCount: number;
  /** Replace the active filter (functional setState). */
  setFilter: (updater: (prev: KgFilter) => KgFilter) => void;
  /** Force a reload from the data source. */
  reload: () => void;
}

export interface UseKgDataOptions {
  dataSource: KgDataSource;
  initialFilter?: Partial<KgFilter>;
}

/**
 * Pure helper for the canonical renderer source list.
 */
export function normalizeSourceNotes(
  sourceNotes: ReadonlyArray<string> | undefined | null,
): ReadonlyArray<string> {
  if (!sourceNotes || sourceNotes.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sourceNotes) {
    if (!isNavigableSource(raw)) continue;
    const path = raw.trim();
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  out.sort(compareBinary);
  return out;
}

export function useKgData({
  dataSource,
  initialFilter,
}: UseKgDataOptions): KgDataState {
  const [rawNodes, setRawNodes] = useState<ReadonlyArray<KgGraphNode>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<KgGraphEdge>>([]);
  const [edgeKeys, setEdgeKeys] = useState<ReadonlyArray<string>>([]);
  const [entities, setEntities] = useState<ReadonlyArray<Entity>>([]);
  const [entitiesById, setEntitiesById] = useState<ReadonlyMap<string, Entity>>(
    () => new Map(),
  );
  const [sourceNotesByEntity, setSourceNotesByEntity] = useState<
    ReadonlyMap<string, ReadonlyArray<string>>
  >(() => new Map());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState<number>(0);
  const [filter, setFilterState] = useState<KgFilter>(() => ({
    ...EMPTY_FILTER,
    ...(initialFilter ?? {}),
  }));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    dataSource
      .getSubgraph(2000)
      .then((subgraph) => {
        if (cancelled) return;
        const edgeList: KgGraphEdge[] = [];
        const keys: string[] = [];
        for (const rel of subgraph.edges) {
          edgeList.push(toGraphEdge(rel));
          keys.push(`${rel.from_entity_id}|${rel.to_entity_id}`);
        }
        const sortedEntities: Entity[] = subgraph.nodes
          .map((entity) => ({
            ...entity,
            source_notes: [...normalizeSourceNotes(entity.source_notes)],
          }))
          .sort((left, right) => compareBinary(left.entity_id, right.entity_id));
        const entityIndex = new Map<string, Entity>();
        const notesIndex = new Map<string, ReadonlyArray<string>>();
        for (const entity of sortedEntities) {
          entityIndex.set(entity.entity_id, entity);
          notesIndex.set(entity.entity_id, entity.source_notes);
        }
        // Project only after source normalisation so graph node sourceCount and
        // sizing describe the same real paths exposed by the canonical Entity.
        setRawNodes(sortedEntities.map(toGraphNode));
        setEdges(edgeList);
        setEdgeKeys(keys);
        setEntities(sortedEntities);
        setEntitiesById(entityIndex);
        setSourceNotesByEntity(notesIndex);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, reloadTick]);

  const visibleNodeIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const node of rawNodes) {
      if (passesFilter(node, filter)) set.add(node.entity_id);
    }
    return set;
  }, [rawNodes, filter]);

  const visibleEdgeKeys = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (let i = 0; i < edges.length; i += 1) {
      // An edge survives if both endpoints remain visible. We don't have
      // endpoint ids here, but the edgeKeys were projected 1:1 with edges
      // in load order, so we re-derive ids from the key string.
      const [from, to] = edgeKeys[i]!.split('|');
      if (visibleNodeIds.has(from!) && visibleNodeIds.has(to!)) {
        set.add(edgeKeys[i]!);
      }
    }
    return set;
  }, [edges, edgeKeys, visibleNodeIds]);

  const setFilter = (updater: (prev: KgFilter) => KgFilter) => {
    setFilterState((prev) => updater(prev));
  };

  const reload = () => setReloadTick((n) => n + 1);

  return {
    nodes: rawNodes,
    edges,
    edgeKeys,
    entities,
    entitiesById,
    sourceNotesByEntity,
    loading,
    error,
    filter,
    visibleNodeIds,
    visibleEdgeKeys,
    visibleCount: visibleNodeIds.size,
    setFilter,
    reload,
  };
}
