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
 */

import { useEffect, useMemo, useState } from 'react';
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

export interface KgDataState {
  /** All nodes from the data source — unfiltered. */
  nodes: ReadonlyArray<KgGraphNode>;
  /** All edges from the data source — unfiltered. */
  edges: ReadonlyArray<KgGraphEdge>;
  /** Edge keys (`from|to`) in the same order as `edges`. */
  edgeKeys: ReadonlyArray<string>;
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

export function useKgData({
  dataSource,
  initialFilter,
}: UseKgDataOptions): KgDataState {
  const [rawNodes, setRawNodes] = useState<ReadonlyArray<KgGraphNode>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<KgGraphEdge>>([]);
  const [edgeKeys, setEdgeKeys] = useState<ReadonlyArray<string>>([]);
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
        const nodes = subgraph.nodes.map(toGraphNode);
        const edgeList: KgGraphEdge[] = [];
        const keys: string[] = [];
        for (const rel of subgraph.edges) {
          edgeList.push(toGraphEdge(rel));
          keys.push(`${rel.from_entity_id}|${rel.to_entity_id}`);
        }
        setRawNodes(nodes);
        setEdges(edgeList);
        setEdgeKeys(keys);
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