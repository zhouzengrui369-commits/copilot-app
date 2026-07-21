/**
 * NoteDetail — main panel that opens when the user clicks a KG node
 * or KB note in the graph / sidebar.
 *
 * Sprint 1.2 / T-1.2.3.
 *
 * Responsibilities:
 *  1. Render note metadata (title + tags + updated-at).
 *  2. Render the markdown body through `MarkdownRenderer`.
 *  3. Render the reverse-link list via `BacklinkList`.
 *  4. Surface close / loading / error states.
 *  5. Wire wikilink clicks + backlink clicks to `onNavigate` so the
 *     outer graph (T-1.2.2) can update its active node.
 *
 * The component is **pure presentational** — it does not own the
 * routing layer. The graph renderer decides which noteId to pass in
 * and what to do when navigation is requested.
 */

import type { ReactElement } from 'react';
import { useNoteData } from './useNoteData.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { BacklinkList } from './BacklinkList.js';
import type { NoteDataSource, NoteDetailProps } from './types.js';
import styles from './styles.module.css';

export function NoteDetail({
  noteId,
  onNavigate,
  onClose,
  dataSource,
}: NoteDetailProps): ReactElement | null {
  const { note, backlinks, loading, error } = useNoteData(noteId, dataSource);

  if (noteId === null) {
    return null;
  }

  return (
    <aside
      className={styles.panel}
      data-testid="note-detail-panel"
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-label="Note detail preview"
    >
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h2 className={styles.title} data-testid="note-detail-title">
            {note ? note.title : loading ? 'Loading…' : error ? 'Error' : 'Untitled'}
          </h2>
          {note ? (
            <p className={styles.meta} data-testid="note-detail-meta">
              <span className={styles.path}>{note.path}</span>
              {note.tags.length > 0 ? (
                <span className={styles.tags}>
                  {note.tags.map((t) => (
                    <span key={t} className={styles.tag} data-testid="note-tag">
                      #{t}
                    </span>
                  ))}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close note detail"
          data-testid="note-detail-close"
          onClick={() => onClose?.()}
        >
          ×
        </button>
      </header>

      <div className={styles.body}>
        {error ? (
          <p className={styles.error} role="alert" data-testid="note-detail-error">
            Failed to load note: {error}
          </p>
        ) : null}

        {note ? (
          <MarkdownRenderer source={note.body} onWikilinkClick={onNavigate} />
        ) : loading ? (
          <p className={styles.placeholder} data-testid="note-detail-loading">
            Fetching note…
          </p>
        ) : (
          <p className={styles.placeholder} data-testid="note-detail-missing">
            Note <code>{noteId}</code> not found.
          </p>
        )}
      </div>

      <BacklinkList backlinks={backlinks} loading={loading} onNavigate={onNavigate} />
    </aside>
  );
}

// Re-export the data source type so callers that build their own
// adapter (e.g. `KgNoteDataSource` post T-1.2.1-v2) can import it
// alongside the component.
export type { NoteDataSource };
