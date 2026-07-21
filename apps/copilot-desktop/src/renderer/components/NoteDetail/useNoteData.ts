/**
 * useNoteData — data hook for the NoteDetail panel.
 *
 * Sprint 1.2 / T-1.2.3. Two implementation modes:
 *   1. `dataSource` prop is passed (preferred for tests + SSR).
 *   2. Otherwise we fall back to the in-memory mock fixtures.
 *
 * Once Sprint 1.2 T-1.2.1-v2 lands `@copilot/kg` in main, the App
 * shell will pass `KgNoteDataSource` (built on `KgClient.getNote` /
 * `KgQuery.backlinksFor`). Until then this hook delivers enough
 * fake notes for the panel to render meaningful UI.
 */

import { useEffect, useRef, useState } from 'react';
import type { BacklinkRef, NoteContent, NoteDataSource, NoteDetailData } from './types.js';

/** In-memory fixtures for the desktop app when no real KG is wired. */
const MOCK_NOTES: ReadonlyMap<string, NoteContent> = new Map<string, NoteContent>([
  [
    'notes/welcome.md',
    {
      id: 'notes/welcome.md',
      title: 'Welcome',
      path: 'notes/welcome.md',
      body:
        '# Welcome\n\nThis is the **welcome** note.\n\n' +
        'It links to [[notes/quickstart]] and [[notes/glossary]].\n\n' +
        '```ts\nconst x: number = 1;\nconsole.log(x);\n```\n',
      tags: ['intro', 'onboarding'],
      updatedAt: Date.UTC(2026, 6, 9, 10, 0, 0),
    },
  ],
  [
    'notes/quickstart.md',
    {
      id: 'notes/quickstart.md',
      title: 'Quickstart',
      path: 'notes/quickstart.md',
      body:
        '# Quickstart\n\nSee also [[notes/welcome]] and [[notes/glossary]].\n\n' +
        '1. Install\n2. Run\n3. Profit\n',
      tags: ['intro'],
      updatedAt: Date.UTC(2026, 6, 8, 12, 0, 0),
    },
  ],
  [
    'notes/glossary.md',
    {
      id: 'notes/glossary.md',
      title: 'Glossary',
      path: 'notes/glossary.md',
      body: '# Glossary\n\n- **KG**: Knowledge Graph\n- **RAG**: Retrieval-Augmented Generation\n',
      tags: ['reference'],
      updatedAt: Date.UTC(2026, 6, 7, 9, 0, 0),
    },
  ],
  [
    'notes/script-injection.md',
    {
      id: 'notes/script-injection.md',
      title: 'Script Injection Probe',
      path: 'notes/script-injection.md',
      // XSS test fixture: malicious <script> tag must NOT execute.
      body:
        '# XSS Probe\n\n' +
        'Inline: <script>window.__xssFired = true;</script>\n\n' +
        'Image onerror: <img src=x onerror="window.__xssFired=true">\n',
      tags: ['security-test'],
      updatedAt: Date.UTC(2026, 6, 9, 11, 0, 0),
    },
  ],
]);

const MOCK_BACKLINKS: ReadonlyMap<string, ReadonlyArray<BacklinkRef>> = new Map<
  string,
  ReadonlyArray<BacklinkRef>
>([
  [
    'notes/welcome.md',
    [
      {
        sourceId: 'notes/quickstart.md',
        sourceTitle: 'Quickstart',
        sourcePath: 'notes/quickstart.md',
        excerpt: 'See also [[notes/welcome]] and [[notes/glossary]].',
      },
    ],
  ],
  [
    'notes/quickstart.md',
    [
      {
        sourceId: 'notes/welcome.md',
        sourceTitle: 'Welcome',
        sourcePath: 'notes/welcome.md',
        excerpt: 'It links to [[notes/quickstart]] and [[notes/glossary]].',
      },
    ],
  ],
  [
    'notes/glossary.md',
    [
      {
        sourceId: 'notes/welcome.md',
        sourceTitle: 'Welcome',
        sourcePath: 'notes/welcome.md',
        excerpt: 'It links to [[notes/quickstart]] and [[notes/glossary]].',
      },
      {
        sourceId: 'notes/quickstart.md',
        sourceTitle: 'Quickstart',
        sourcePath: 'notes/quickstart.md',
        excerpt: 'See also [[notes/welcome]] and [[notes/glossary]].',
      },
    ],
  ],
  ['notes/script-injection.md', []],
]);

class MockNoteDataSource implements NoteDataSource {
  async getNote(noteId: string): Promise<NoteContent | null> {
    // Tiny async gap so the loading state is observable in tests.
    await Promise.resolve();
    return MOCK_NOTES.get(noteId) ?? null;
  }

  async getBacklinks(noteId: string): Promise<ReadonlyArray<BacklinkRef>> {
    await Promise.resolve();
    return MOCK_BACKLINKS.get(noteId) ?? [];
  }
}

const DEFAULT_SOURCE: NoteDataSource = new MockNoteDataSource();

/**
 * Subscribe to note + backlinks for a given noteId. Cancels in-flight
 * fetches when noteId changes to avoid race conditions where an
 * older slow request overrides a newer one.
 */
export function useNoteData(
  noteId: string | null,
  dataSource: NoteDataSource = DEFAULT_SOURCE,
): NoteDetailData {
  const [state, setState] = useState<NoteDetailData>({
    note: null,
    backlinks: [],
    loading: false,
    error: null,
  });

  // Track the latest request token so stale results don't override.
  const tokenRef = useRef(0);

  useEffect(() => {
    if (noteId === null) {
      setState({ note: null, backlinks: [], loading: false, error: null });
      return;
    }

    const token = ++tokenRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    let cancelled = false;
    const applyIfCurrent = (next: NoteDetailData) => {
      if (cancelled) return;
      if (tokenRef.current !== token) return;
      setState(next);
    };

    (async () => {
      try {
        const [note, backlinks] = await Promise.all([
          dataSource.getNote(noteId),
          dataSource.getBacklinks(noteId),
        ]);
        applyIfCurrent({ note, backlinks, loading: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        applyIfCurrent({
          note: null,
          backlinks: [],
          loading: false,
          error: message,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, dataSource]);

  return state;
}

export { MockNoteDataSource };
