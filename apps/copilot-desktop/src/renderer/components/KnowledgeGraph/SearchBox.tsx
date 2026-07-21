/**
 * KnowledgeGraph — SearchBox (Sprint 1.2 / T-1.2.2).
 *
 * Debounced text input that updates `filter.search`. The actual
 * substring match lives in `types.ts:passesFilter` so this component
 * stays pure presentational — it does not own the data shape.
 */

import { useCallback, useEffect, useState } from 'react';
import type { KgFilter } from './types.js';
import styles from './styles.module.css';

export interface SearchBoxProps {
  filter: KgFilter;
  onChange: (next: KgFilter) => void;
  /** Debounce in ms — defaults to 120ms (1 frame at 8 FPS is 125ms). */
  debounceMs?: number;
  placeholder?: string;
}

export function SearchBox({
  filter,
  onChange,
  debounceMs = 120,
  placeholder = 'Search nodes by name…',
}: SearchBoxProps): React.ReactElement {
  const [draft, setDraft] = useState<string>(filter.search);

  // Keep local draft in sync if the parent resets the filter externally.
  useEffect(() => {
    setDraft(filter.search);
  }, [filter.search]);

  // Debounced commit.
  useEffect(() => {
    if (draft === filter.search) return;
    const handle = window.setTimeout(() => {
      onChange({ ...filter, search: draft });
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [draft, debounceMs, filter, onChange]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
    },
    [],
  );

  const handleClear = useCallback(() => {
    setDraft('');
    onChange({ ...filter, search: '' });
  }, [filter, onChange]);

  return (
    <div className={styles.searchBox} data-testid="kg-search-box">
      <input
        type="search"
        className={styles.searchInput}
        data-testid="kg-search-input"
        placeholder={placeholder}
        value={draft}
        onChange={handleInput}
        aria-label="Search knowledge graph nodes by name"
      />
      {draft.length > 0 ? (
        <button
          type="button"
          className={styles.searchClear}
          data-testid="kg-search-clear"
          onClick={handleClear}
          aria-label="Clear search"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export default SearchBox;