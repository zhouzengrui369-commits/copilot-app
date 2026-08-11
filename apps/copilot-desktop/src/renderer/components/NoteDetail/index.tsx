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

type NoteDetailViewProps = NoteDetailProps & {
  presentation?: 'panel' | 'page';
};

function previewFormat(path: string, source: string): 'markdown' | 'html' {
  return /\.(?:html?|xhtml)$/iu.test(path) || /^\s*(?:<!doctype\s+html|<html|<article|<section|<main|<h[1-6]\b|<p\b)/iu.test(source)
    ? 'html'
    : 'markdown';
}

export function NoteDetail({
  noteId,
  onNavigate,
  onClose,
  dataSource,
  presentation = 'panel',
}: NoteDetailViewProps): ReactElement | null {
  const { note, backlinks, loading, error } = useNoteData(noteId, dataSource);

  if (noteId === null) {
    return null;
  }

  const Root = presentation === 'page' ? 'article' : 'aside';

  return (
    <Root
      className={`${styles.panel} ${presentation === 'page' ? styles.page : ''}`}
      data-testid="note-detail-panel"
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      data-presentation={presentation}
      aria-label="当前笔记预览"
    >
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h2 className={styles.title} data-testid="note-detail-title">
            {note ? note.title : loading ? '正在加载…' : error ? '加载失败' : '未命名笔记'}
          </h2>
          {note ? (
            <p className={styles.meta} data-testid="note-detail-meta">
              <span className={styles.path}>{note.path}</span>
              <span
                className={styles.formatBadge}
                data-testid="note-format-badge"
                data-format={previewFormat(note.path, note.body)}
              >
                {previewFormat(note.path, note.body) === 'html' ? 'HTML' : 'Markdown'}
              </span>
              {note.tags.length > 0 ? (
                <span className={styles.tags}>
                  {note.tags.map((t) => (
                    <span key={t} className={styles.tag} data-testid="note-tag">
                      #{t}
                    </span>
                  ))}
                </span>
              ) : (
                <span className={styles.tagsEmpty} data-testid="note-tags-empty">无标签</span>
              )}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="关闭笔记详情"
          data-testid="note-detail-close"
          onClick={() => onClose?.()}
        >
          ×
        </button>
      </header>

      <div className={styles.body}>
        {error ? (
          <p className={styles.error} role="alert" data-testid="note-detail-error">
            加载笔记失败：{error}
          </p>
        ) : null}

        {note ? (
          <MarkdownRenderer
            source={note.body}
            format={previewFormat(note.path, note.body)}
            onWikilinkClick={onNavigate}
          />
        ) : loading ? (
          <p className={styles.placeholder} data-testid="note-detail-loading">
            正在读取本地笔记…
          </p>
        ) : (
          <p className={styles.placeholder} data-testid="note-detail-missing">
            找不到笔记 <code>{noteId}</code>。可能已被删除或尚未索引。
          </p>
        )}
      </div>

      <BacklinkList backlinks={backlinks} loading={loading} onNavigate={onNavigate} />
    </Root>
  );
}

// Re-export the data source type so callers that build their own
// adapter (e.g. `KgNoteDataSource` post T-1.2.1-v2) can import it
// alongside the component.
export type { NoteDataSource };
