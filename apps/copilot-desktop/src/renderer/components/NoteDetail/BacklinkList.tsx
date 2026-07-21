/**
 * BacklinkList — reverse references for the active note.
 *
 * Sprint 1.2 / T-1.2.3.
 *
 * "Backlinks" are notes whose body contains a `[[note_path]]` link
 * pointing to the active note. The list is a flat, ordered-by-title
 * rendering of `{sourceId, sourceTitle, sourcePath, excerpt}` from
 * `useNoteData`. Each row is keyboard-focusable and triggers the
 * `onNavigate` callback so the user can jump straight to the source.
 */

import type { ReactElement } from 'react';
import type { BacklinkRef } from './types.js';
import styles from './styles.module.css';

export interface BacklinkListProps {
  backlinks: ReadonlyArray<BacklinkRef>;
  loading: boolean;
  onNavigate?: (targetPath: string) => void;
}

export function BacklinkList({
  backlinks,
  loading,
  onNavigate,
}: BacklinkListProps): ReactElement {
  if (loading) {
    return (
      <section className={styles.backlinks} data-testid="backlinks" data-state="loading">
        <h3 className={styles.backlinksTitle}>Backlinks</h3>
        <p className={styles.backlinksHint}>Loading backlinks…</p>
      </section>
    );
  }

  if (backlinks.length === 0) {
    return (
      <section className={styles.backlinks} data-testid="backlinks" data-state="empty">
        <h3 className={styles.backlinksTitle}>Backlinks</h3>
        <p className={styles.backlinksHint} data-testid="backlinks-empty">
          No notes link to this one yet.
        </p>
      </section>
    );
  }

  const ordered = [...backlinks].sort((a, b) =>
    a.sourceTitle.localeCompare(b.sourceTitle),
  );

  return (
    <section className={styles.backlinks} data-testid="backlinks" data-state="ready">
      <h3 className={styles.backlinksTitle}>
        Backlinks <span className={styles.backlinksCount}>({ordered.length})</span>
      </h3>
      <ul className={styles.backlinkItems}>
        {ordered.map((ref) => (
          <li key={ref.sourceId} className={styles.backlinkItem}>
            <button
              type="button"
              className={styles.backlinkButton}
              data-testid="backlink-item"
              data-source-path={ref.sourcePath}
              onClick={() => onNavigate?.(ref.sourcePath)}
            >
              <span className={styles.backlinkTitle}>{ref.sourceTitle}</span>
              <span className={styles.backlinkPath}>{ref.sourcePath}</span>
              {ref.excerpt ? (
                <span className={styles.backlinkExcerpt}>{ref.excerpt}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
