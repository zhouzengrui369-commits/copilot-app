/**
 * KnowledgeGraph — main entry (Sprint 1.2 / T-1.2.2).
 *
 * Composes SigmaCanvas + FilterPanel + SearchBox + NodeInteraction.
 * Defaults to an in-memory `FixtureKgDataSource` (100 nodes) so the
 * component is self-contained for tests and screenshots.
 *
 * Drop-in usage:
 *   <KnowledgeGraph onNodeClick={(e) => openNote(e.entity_id)} />
 *
 *   <KnowledgeGraph
 *     dataSource={new ElectronKgDataSource()}
 *     onNodeClick={(e) => navigate(`/notes/${e.entity_id}`)}
 *   />
 *
 * The component is **presentational** — it does not own the active
 * note or the note-detail panel; the consumer wires `onNodeClick`
 * to whatever navigation layer exists (Sprint 1.2 wires it to
 * `NoteDetail` from T-1.2.3).
 */

import { useMemo } from 'react';
import { SigmaCanvas } from './SigmaCanvas.js';
import { FilterPanel } from './FilterPanel.js';
import { SearchBox } from './SearchBox.js';
import { useNodeInteraction } from './NodeInteraction.js';
import { useKgData } from './useKgData.js';
import { FixtureKgDataSource } from './fixtureData.js';
import type {
  KnowledgeGraphProps,
} from './types.js';
import type { Entity } from '@copilot/kg';
import styles from './styles.module.css';

export interface KnowledgeGraphCombinedProps
  extends KnowledgeGraphProps {
  /** Width of the canvas in px. Default 800. */
  width?: number;
  /** Height of the canvas in px. Default 600. */
  height?: number;
}

export function KnowledgeGraph({
  dataSource,
  initialFilter,
  onNodeClick,
  onNodeHover,
  onCameraChange,
  width = 800,
  height = 600,
}: KnowledgeGraphCombinedProps): React.ReactElement {
  const source = useMemo(
    () => dataSource ?? new FixtureKgDataSource(100),
    [dataSource],
  );

  const state = useKgData({ dataSource: source, initialFilter });
  const entityIndex = useMemo(() => {
    const map = new Map<string, Entity>();
    // We only stored the projected form; re-derive Entity from the
    // projection — keeps the index light and avoids double-bookkeeping.
    for (const n of state.nodes) {
      map.set(n.entity_id, {
        id: 0,
        entity_id: n.entity_id,
        type: n.type,
        name: n.name,
        aliases: [],
        summary: n.summary,
        confidence: null,
        source_notes: new Array(n.sourceCount).fill(''),
        created_at: 0,
        updated_at: 0,
      });
    }
    return map;
  }, [state.nodes]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of state.nodes) {
      out[n.type] = (out[n.type] ?? 0) + 1;
    }
    return out;
  }, [state.nodes]);

  const interaction = useNodeInteraction({
    entityIndex,
    onNodeClick,
    onNodeHover,
  });

  return (
    <section
      className={styles.root}
      data-testid="kg-root"
      data-loading={state.loading ? 'true' : 'false'}
      data-error={state.error ?? ''}
      data-visible-count={state.visibleCount}
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
          {state.loading
            ? 'Loading…'
            : state.error
              ? `Error: ${state.error}`
              : `${state.visibleCount} / ${state.nodes.length} nodes`}
        </span>
      </header>
      <div className={styles.body}>
        <FilterPanel
          filter={state.filter}
          onChange={(next) => state.setFilter(() => next)}
          counts={counts}
          totalCount={state.nodes.length}
          visibleCount={state.visibleCount}
        />
        <SigmaCanvas
          nodes={state.nodes}
          edges={state.edges}
          edgeKeys={state.edgeKeys}
          visibleNodeIds={state.visibleNodeIds}
          visibleEdgeKeys={state.visibleEdgeKeys}
          onNodeClick={interaction.handleClick}
          onNodeHover={interaction.handleHover}
          width={width}
          height={height}
        />
      </div>
      <footer className={styles.status} data-testid="kg-status">
        <span data-testid="kg-status-clicks">
          Clicks: {interaction.clickCount}
        </span>
        <span data-testid="kg-status-hover">
          Hover: {interaction.hoveredId ?? '—'}
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