/**
 * KnowledgeGraph — main entry (Sprint 1.2 / T-1.2.2).
 *
 * Composes SigmaCanvas + FilterPanel + SearchBox + NodeInteraction.
 * Production callers provide the data source explicitly. When it is absent,
 * the existing graph chrome and canvas stay mounted with a bounded
 * unavailable, zero-node state.
 *
 * Drop-in usage:
 *   <KnowledgeGraph
 *     dataSource={new ElectronKgDataSource()}
 *     onNodeClick={(e) => navigate(`/notes/${e.entity_id}`)}
 *   />
 *
 * The component is **presentational** — it does not own the active
 * note or the note-detail panel; the consumer wires `onNodeClick`
 * to whatever navigation layer exists (Sprint 1.2 wires it to
 * `NoteDetail` from T-1.2.3).
 *
 * R2 keeps the graph presentational: Sigma clickNode resolves the canonical
 * Entity through NodeInteraction, while source navigation is rendered by the
 * existing KnowledgeWorkspace inspector. No duplicate DOM node list/detail is
 * mounted beside the WebGL canvas.
 */

import { useMemo } from 'react';
import type { Entity } from '@copilot/kg';
import { SigmaCanvas } from './SigmaCanvas.js';
import { FilterPanel } from './FilterPanel.js';
import { SearchBox } from './SearchBox.js';
import { useNodeInteraction } from './NodeInteraction.js';
import { useKgData } from './useKgData.js';
import type {
  KgDataSource,
  KgGraphEdge,
  KgGraphNode,
  KnowledgeGraphProps,
} from './types.js';
import styles from './styles.module.css';

const UNAVAILABLE_KG_DATA_SOURCE: KgDataSource = Object.freeze({
  async getSubgraph() {
    return { nodes: [], edges: [], degree: {} };
  },
});

const EMPTY_NODES: ReadonlyArray<KgGraphNode> = Object.freeze([]);
const EMPTY_EDGES: ReadonlyArray<KgGraphEdge> = Object.freeze([]);
const EMPTY_EDGE_KEYS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_VISIBLE_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_ENTITY_INDEX: ReadonlyMap<string, Entity> = new Map<string, Entity>();
const EMPTY_COUNTS = Object.freeze({});

export interface KnowledgeGraphCombinedProps
  extends KnowledgeGraphProps {
  /** Width of the canvas in px. Default 800. */
  width?: number;
  /** Height of the canvas in px. Default 600. */
  height?: number;
}

interface KnowledgeGraphSurfaceProps extends KnowledgeGraphCombinedProps {
  dataSource: KgDataSource;
  sourceUnavailable: boolean;
}

export function KnowledgeGraph(
  props: KnowledgeGraphCombinedProps,
): React.ReactElement {
  const sourceUnavailable = props.dataSource === undefined;
  return (
    <KnowledgeGraphSurface
      key={sourceUnavailable ? 'source-unavailable' : 'source-available'}
      {...props}
      dataSource={props.dataSource ?? UNAVAILABLE_KG_DATA_SOURCE}
      sourceUnavailable={sourceUnavailable}
    />
  );
}

function KnowledgeGraphSurface({
  dataSource,
  sourceUnavailable,
  initialFilter,
  onNodeClick,
  onNodeHover,
  onCameraChange,
  width = 800,
  height = 600,
}: KnowledgeGraphSurfaceProps): React.ReactElement {
  const state = useKgData({ dataSource, initialFilter });
  const nodes = sourceUnavailable ? EMPTY_NODES : state.nodes;
  const edges = sourceUnavailable ? EMPTY_EDGES : state.edges;
  const edgeKeys = sourceUnavailable ? EMPTY_EDGE_KEYS : state.edgeKeys;
  const visibleNodeIds = sourceUnavailable ? EMPTY_VISIBLE_IDS : state.visibleNodeIds;
  const visibleEdgeKeys = sourceUnavailable ? EMPTY_VISIBLE_IDS : state.visibleEdgeKeys;
  const visibleCount = sourceUnavailable ? 0 : state.visibleCount;
  const entityIndex = sourceUnavailable ? EMPTY_ENTITY_INDEX : state.entitiesById;

  const counts = useMemo(() => {
    if (sourceUnavailable) return EMPTY_COUNTS;
    const out: Record<string, number> = {};
    for (const n of nodes) {
      out[n.type] = (out[n.type] ?? 0) + 1;
    }
    return out;
  }, [nodes, sourceUnavailable]);

  const interaction = useNodeInteraction({
    entityIndex,
    onNodeClick,
    onNodeHover,
  });

  return (
    <section
      className={styles.root}
      data-testid="kg-root"
      data-source-state={sourceUnavailable ? 'unavailable' : 'available'}
      data-loading={!sourceUnavailable && state.loading ? 'true' : 'false'}
      data-error={sourceUnavailable ? 'KG_DATA_SOURCE_UNAVAILABLE' : (state.error ?? '')}
      data-visible-count={visibleCount}
      aria-label="Knowledge graph"
    >
      <header className={styles.toolbar} data-testid="kg-toolbar">
        <SearchBox
          filter={state.filter}
          onChange={(next) => state.setFilter(() => next)}
        />
        <span
          className={styles.toolbarMeta}
          data-testid="kg-toolbar-meta"
        >
          {sourceUnavailable
            ? 'Unavailable · 0 / 0 nodes'
            : state.loading
            ? 'Loading…'
            : state.error
              ? `Error: ${state.error}`
              : `${visibleCount} / ${nodes.length} nodes`}
        </span>
      </header>
      <div className={styles.body}>
        <FilterPanel
          filter={state.filter}
          onChange={(next) => state.setFilter(() => next)}
          counts={counts}
          totalCount={nodes.length}
          visibleCount={visibleCount}
        />
        <SigmaCanvas
          nodes={nodes}
          edges={edges}
          edgeKeys={edgeKeys}
          visibleNodeIds={visibleNodeIds}
          visibleEdgeKeys={visibleEdgeKeys}
          onNodeClick={sourceUnavailable ? undefined : interaction.handleClick}
          onNodeHover={sourceUnavailable ? undefined : interaction.handleHover}
          width={width}
          height={height}
        />
      </div>
      <footer className={styles.status} data-testid="kg-status">
        <span data-testid="kg-status-clicks">
          Clicks: {sourceUnavailable ? 0 : interaction.clickCount}
        </span>
        <span data-testid="kg-status-hover">
          Hover: {sourceUnavailable ? '—' : (interaction.hoveredId ?? '—')}
        </span>
      </footer>
      {/* Camera callback stub — keeps the prop wired for Sprint 1.3. */}
      <span data-testid="kg-camera-listener" hidden>
        {onCameraChange ? 'camera-listener-on' : 'camera-listener-off'}
      </span>
    </section>
  );
}

export { SigmaCanvas, FilterPanel, SearchBox, useKgData, useNodeInteraction };
export type { KnowledgeGraphProps, KgDataSource } from './types.js';
export { FixtureKgDataSource, buildFixtureGraph } from './fixtureData.js';
export {
  ENTITY_PALETTE,
  EMPTY_FILTER,
  toGraphNode,
  toGraphEdge,
  passesFilter,
  countVisible,
} from './types.js';
export type {
  KgFilter,
  KgGraphNode,
  KgGraphEdge,
} from './types.js';

export default KnowledgeGraph;
