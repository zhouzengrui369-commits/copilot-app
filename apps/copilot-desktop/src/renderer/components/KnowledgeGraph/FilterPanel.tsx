/**
 * KnowledgeGraph — FilterPanel (Sprint 1.2 / T-1.2.2).
 *
 * Compact sidebar that toggles which EntityType(s) are visible.
 * Selecting a type adds it to the active filter set; clicking again
 * removes it. The "Clear" button resets the filter entirely.
 *
 * The palette here is the source of truth for `ENTITY_PALETTE` — if
 * you add a colour, update `types.ts` so the canvas matches.
 */

import { useCallback, useMemo } from 'react';
import type { EntityType } from '@copilot/kg';
import {
  ENTITY_PALETTE,
  type KgFilter,
} from './types.js';
import styles from './styles.module.css';

export interface FilterPanelProps {
  filter: KgFilter;
  onChange: (next: KgFilter) => void;
  /** Per-type counts so the chips show "(n)". */
  counts?: Partial<Record<EntityType, number>>;
  /** Total node count — shown next to "Clear". */
  totalCount?: number;
  /** Number of nodes that pass the active filter. */
  visibleCount: number;
}

const ENTITY_TYPES: ReadonlyArray<EntityType> = [
  'person',
  'org',
  'concept',
  'event',
  'place',
  'product',
  'document',
  'topic',
  'other',
];

export function FilterPanel({
  filter,
  onChange,
  counts,
  totalCount,
  visibleCount,
}: FilterPanelProps): React.ReactElement {
  const isActive = useCallback(
    (t: EntityType) => filter.types.has(t),
    [filter.types],
  );

  const toggle = useCallback(
    (t: EntityType) => {
      const nextTypes = new Set(filter.types);
      if (nextTypes.has(t)) nextTypes.delete(t);
      else nextTypes.add(t);
      onChange({ ...filter, types: nextTypes });
    },
    [filter, onChange],
  );

  const clear = useCallback(() => {
    onChange({ ...filter, types: new Set<EntityType>() });
  }, [filter, onChange]);

  const summary = useMemo(() => {
    if (filter.types.size === 0 && filter.search.trim() === '') {
      return `Showing all ${totalCount ?? visibleCount} nodes`;
    }
    return `Showing ${visibleCount} of ${totalCount ?? visibleCount} nodes`;
  }, [filter, totalCount, visibleCount]);

  return (
    <aside
      className={styles.filterPanel}
      data-testid="kg-filter-panel"
      aria-label="Filter by entity type"
    >
      <header className={styles.filterPanelHeader}>
        <h3 className={styles.filterPanelTitle}>Filter by type</h3>
        <button
          type="button"
          className={styles.filterPanelClear}
          data-testid="kg-filter-clear"
          onClick={clear}
        >
          Clear
        </button>
      </header>
      <ul className={styles.filterPanelChips}>
        {ENTITY_TYPES.map((t) => {
          const active = isActive(t);
          const count = counts?.[t] ?? 0;
          return (
            <li key={t}>
              <button
                type="button"
                className={`${styles.chip}${active ? ` ${styles.chipActive}` : ''}`}
                data-testid={`kg-chip-${t}`}
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onClick={() => toggle(t)}
              >
                <span
                  className={styles.chipDot}
                  style={{ background: ENTITY_PALETTE[t] }}
                />
                <span className={styles.chipLabel}>{t}</span>
                {typeof counts === 'object' ? (
                  <span className={styles.chipCount}>{count}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <footer className={styles.filterPanelSummary} data-testid="kg-filter-summary">
        {summary}
      </footer>
    </aside>
  );
}

export default FilterPanel;