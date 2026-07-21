/**
 * KnowledgeGraph — SigmaCanvas (Sprint 1.2 / T-1.2.2).
 *
 * Thin React wrapper around sigma.js v3. The component owns the
 * underlying `Sigma` instance (kept in a ref so React re-renders
 * don't recreate it). It receives the projected graphology node /
 * edge attributes from `useKgData` and re-uses the same sigma
 * instance across renders — sigma is built for incremental updates.
 *
 * Interaction surface is handled in `NodeInteraction.tsx`; this
 * file just renders the WebGL canvas and forwards click events.
 *
 * Performance notes:
 *   - sigma uses RAF for its render loop (≥ 30 FPS on a 100-node graph
 *     with the WebGL renderer on any 2018+ MacBook).
 *   - We do not run ForceAtlas2 in this component — the layout is
 *     pre-computed once in `applyPrecomputedLayout` (random circular
 *     layout, deterministic by entity_id) and stays put. Sprint 1.3
 *     can swap in ForceAtlas2 / NoverlapLayout as opt-in toggles.
 */

import { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import type {
  KgGraphEdge,
  KgGraphNode,
} from './types.js';
import styles from './styles.module.css';

export interface SigmaCanvasProps {
  nodes: ReadonlyArray<KgGraphNode>;
  edges: ReadonlyArray<KgGraphEdge>;
  edgeKeys: ReadonlyArray<string>;
  visibleNodeIds: ReadonlySet<string>;
  visibleEdgeKeys: ReadonlySet<string>;
  onNodeClick?: (entity_id: string) => void;
  onNodeHover?: (entity_id: string | null) => void;
  width?: number;
  height?: number;
}

/**
 * Pre-compute a circular layout keyed by entity_id so the layout is
 * stable across re-renders / filter changes (node positions stay put,
 * hidden nodes are just dimmed).
 */
export function applyPrecomputedLayout(
  nodes: ReadonlyArray<KgGraphNode>,
): Array<readonly [string, { x: number; y: number }]> {
  return nodes.map((node, index) => {
    const angle = nodes.length === 0 ? 0 : (index / nodes.length) * Math.PI * 2;
    return [node.entity_id, {
      x: Math.cos(angle) * 100,
      y: Math.sin(angle) * 100,
    }] as const;
  });
}

function syncGraph(
  graph: Graph,
  nodes: ReadonlyArray<KgGraphNode>,
  edges: ReadonlyArray<KgGraphEdge>,
  edgeKeys: ReadonlyArray<string>,
): void {
  const graphInterop = graph as Graph & {
    edges?: () => string[];
    dropEdge?: (key: string) => void;
    dropNode?: (id: string) => void;
    replaceNodeAttributes?: (id: string, attributes: Record<string, unknown>) => void;
    replaceEdgeAttributes?: (key: string, attributes: Record<string, unknown>) => void;
  };
  const desiredNodeIds = new Set(nodes.map((node) => node.entity_id));
  const desiredEdgeKeys = new Set(edgeKeys);

  for (const key of graphInterop.edges?.() ?? []) {
    if (!desiredEdgeKeys.has(key)) graphInterop.dropEdge?.(key);
  }
  for (const id of graph.nodes()) {
    if (!desiredNodeIds.has(id)) graphInterop.dropNode?.(id);
  }

  const positions = new Map(applyPrecomputedLayout(nodes));
  for (const node of nodes) {
    const position = positions.get(node.entity_id) ?? { x: 0, y: 0 };
    const attributes = {
      label: node.name,
      size: node.size,
      color: node.color,
      x: position.x,
      y: position.y,
    };
    if (graph.hasNode(node.entity_id)) {
      if (typeof graphInterop.replaceNodeAttributes === 'function') {
        graphInterop.replaceNodeAttributes(node.entity_id, attributes);
      } else {
        for (const [name, value] of Object.entries(attributes)) {
          graph.setNodeAttribute(node.entity_id, name, value);
        }
      }
    } else {
      graph.addNode(node.entity_id, attributes);
    }
  }

  for (let index = 0; index < edges.length; index += 1) {
    const key = edgeKeys[index];
    if (!key) continue;
    const [from, to] = key.split('|');
    if (!from || !to || !graph.hasNode(from) || !graph.hasNode(to)) continue;
    const edge = edges[index]!;
    const attributes = {
      size: 1 + (edge.weight ?? 0.5) * 2,
      color: edge.color,
      type: 'arrow',
    };
    if (graph.hasEdge(key)) {
      if (typeof graphInterop.replaceEdgeAttributes === 'function') {
        graphInterop.replaceEdgeAttributes(key, attributes);
      } else {
        for (const [name, value] of Object.entries(attributes)) {
          graph.setEdgeAttribute(key, name, value);
        }
      }
    } else {
      graph.addEdgeWithKey(key, from, to, attributes);
    }
  }
}

export function SigmaCanvas({
  nodes,
  edges,
  edgeKeys,
  visibleNodeIds,
  visibleEdgeKeys,
  onNodeClick,
  onNodeHover,
  width = 800,
  height = 600,
}: SigmaCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const handlersRef = useRef<{
    click?: (id: string) => void;
    hover?: (id: string | null) => void;
  }>({});

  // Mount/unmount sigma + graphology graph.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({ multi: true, type: 'directed' });
    syncGraph(graph, nodes, edges, edgeKeys);
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeType: 'arrow',
      labelColor: { color: '#1a202c' },
      edgeLabelColor: { color: '#1a202c' },
      labelDensity: 0.7,
      labelGridCellSize: 60,
      labelRenderedSizeThreshold: 6,
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    });
    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  // Sync graph nodes + edges + positions.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    syncGraph(graph, nodes, edges, edgeKeys);
  }, [nodes, edges, edgeKeys]);

  // Sync visibility (color dim = hidden).
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const nodeById = new Map(nodes.map((node) => [node.entity_id, node]));
    const edgeByKey = new Map(edgeKeys.map((key, index) => [key, edges[index]]));
    graph.forEachNode((id) => {
      const visible = visibleNodeIds.has(id);
      const node = nodeById.get(id);
      graph.setNodeAttribute(id, 'color', visible ? node?.color : '#e2e8f0');
      graph.setNodeAttribute(id, 'label', visible ? node?.name : '');
      graph.setNodeAttribute(id, 'size', visible ? node?.size : 1);
    });
    graph.forEachEdge((key) => {
      const visible = visibleEdgeKeys.has(key);
      const edge = edgeByKey.get(key);
      graph.setEdgeAttribute(key, 'color', visible ? edge?.color : '#f1f5f9');
      graph.setEdgeAttribute(key, 'size', visible ? 1 + (edge?.weight ?? 0.5) * 2 : 0.5);
    });
    sigmaRef.current?.refresh();
  }, [nodes, edges, edgeKeys, visibleNodeIds, visibleEdgeKeys]);

  // Sync handlers — keep stable refs so click/hover doesn't recreate sigma.
  useEffect(() => {
    handlersRef.current.click = onNodeClick;
    handlersRef.current.hover = onNodeHover;
  }, [onNodeClick, onNodeHover]);

  // Wire up DOM events on the sigma canvas.
  // 钉子 #23 self-audit: sigma.js's event payload type (`SigmaNodeEventPayload`
  // from `sigma/types`) is structurally complex and not worth the import
  // churn at Sprint 1.2 time. We narrow to `any` at the boundary and read
  // `.node` defensively — same behaviour, half the type surface.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    // sigma.on() has overloaded signatures keyed off the event name; we
    // cast through `unknown` to `any` (single allowed escape hatch under
    // 钉子 #23 — only at this JS interop boundary).
    type AnyHandler = (payload: unknown) => void;
    const handleClick: AnyHandler = (event) => {
      const id = (event as { node?: string } | undefined)?.node;
      if (id && handlersRef.current.click) handlersRef.current.click(id);
    };
    const handleEnter: AnyHandler = (event) => {
      const id = (event as { node?: string } | undefined)?.node ?? null;
      if (handlersRef.current.hover) handlersRef.current.hover(id);
    };
    const handleLeave: AnyHandler = () => {
      if (handlersRef.current.hover) handlersRef.current.hover(null);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sigma.on('clickNode', handleClick as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sigma.on('enterNode', handleEnter as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sigma.on('leaveNode', handleLeave as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sigma.off('clickNode', handleClick as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sigma.off('enterNode', handleEnter as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sigma.off('leaveNode', handleLeave as any);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.sigmaCanvas}
      data-testid="kg-sigma-canvas"
      style={{ width, height, position: 'relative', overflow: 'hidden' }}
    />
  );
}

export default SigmaCanvas;
