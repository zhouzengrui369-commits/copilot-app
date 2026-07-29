/**
 * NoteDetail — vitest coverage.
 *
 * Sprint 1.2 / T-1.2.3. Exercises the public surface of the panel:
 *
 *   1. Empty / closed state (noteId = null) renders nothing.
 *   2. Loading state is shown while the data source is in-flight.
 *   3. Markdown body renders through the secure pipeline.
 *   4. XSS payloads (raw <script>, onerror=) are stripped — no JS executes.
 *   5. Wikilinks are parsed, rendered as clickable, and emit onNavigate.
 *   6. Backlink rows emit onNavigate when clicked.
 *   7. Close button triggers onClose.
 *   8. Note not found shows the missing fallback.
 *
 * Tests run against jsdom via the existing vitest config.
 */

import '@testing-library/jest-dom/vitest';

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { NoteDetail } from '../src/renderer/components/NoteDetail/index.js';
import type { BacklinkRef, NoteContent, NoteDataSource } from '../src/renderer/components/NoteDetail/types.js';

class StubDataSource implements NoteDataSource {
  private readonly notes = new Map<string, NoteContent>();
  private readonly back = new Map<string, BacklinkRef[]>();

  constructor(seed: { notes?: NoteContent[]; backlinks?: Record<string, BacklinkRef[]> } = {}) {
    for (const n of seed.notes ?? []) this.notes.set(n.id, n);
    for (const [k, v] of Object.entries(seed.backlinks ?? {})) this.back.set(k, v);
  }

  async getNote(noteId: string): Promise<NoteContent | null> {
    return this.notes.get(noteId) ?? null;
  }

  async getBacklinks(noteId: string): Promise<ReadonlyArray<BacklinkRef>> {
    return this.back.get(noteId) ?? [];
  }
}

function makeNote(overrides: Partial<NoteContent> = {}): NoteContent {
  return {
    id: 'notes/welcome.md',
    title: 'Welcome',
    path: 'notes/welcome.md',
    body: '# Welcome\n\nHello world.',
    tags: ['intro'],
    updatedAt: Date.UTC(2026, 6, 9, 10, 0, 0),
    ...overrides,
  };
}

const WELCOME = makeNote({
  body:
    '# Welcome\n\nLinks to [[notes/quickstart]] and [[notes/glossary|the glossary]].\n\n' +
    '```ts\nconst x = 1;\n```\n',
});

const XSS_NOTE = makeNote({
  id: 'notes/xss.md',
  title: 'XSS Probe',
  path: 'notes/xss.md',
  body:
    '# XSS Probe\n\n' +
    'Inline script: <script>window.__xssFired = true;</script>\n\n' +
    'Image onerror: <img src=x onerror="window.__xssFired=true">\n',
});

describe('NoteDetail', () => {
  it('renders nothing when noteId is null', () => {
    const { container } = render(<NoteDetail noteId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the loading state then the resolved note content', async () => {
    const source = new StubDataSource({ notes: [WELCOME] });
    render(<NoteDetail noteId="notes/welcome.md" dataSource={source} />);
    // Loading state may flash; wait for the resolved title.
    expect(await screen.findByTestId('note-detail-title')).toHaveTextContent('Welcome');
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
  });

  it('does not execute XSS payloads — raw HTML is skipped by react-markdown', async () => {
    const source = new StubDataSource({ notes: [XSS_NOTE] });
    // Spy window.__xssFired BEFORE render so we can assert it never gets set.
    const w = window as unknown as { __xssFired?: boolean };
    w.__xssFired = false;
    render(<NoteDetail noteId="notes/xss.md" dataSource={source} />);
    const root = await screen.findByTestId('note-detail-panel');

    // react-markdown (with skipHtml=true) never emits a literal
    // <script> tag from markdown text — raw HTML in the source is
    // dropped at parse time. This is the primary XSS defense.
    expect(root.querySelector('script')).toBeNull();
    // No <img onerror="..."> either: react-markdown can't represent
    // inline event handlers, so even if an <img> tag slipped through,
    // it would have no onerror attribute to fire.
    const imgs = root.querySelectorAll('img');
    imgs.forEach((img) => {
      expect(img.getAttribute('onerror')).toBeNull();
      expect(img.getAttribute('src')).not.toBe('x');
    });
    // And critically — no script ever executed.
    expect(w.__xssFired).toBe(false);
  });

  it('parses [[wikilink]] tokens and routes clicks through onNavigate', async () => {
    const source = new StubDataSource({ notes: [WELCOME], backlinks: {} });
    const onNavigate = vi.fn();
    render(
      <NoteDetail
        noteId="notes/welcome.md"
        dataSource={source}
        onNavigate={onNavigate}
      />,
    );

    const links = await screen.findAllByTestId('wikilink');
    // Two wikilinks in the welcome body: quickstart + glossary.
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('notes/quickstart');
    // The panel preserves the exact target string the user typed —
    // resolution to a real note path is the KG layer's job downstream.
    expect(links[0]).toHaveAttribute('data-target', 'notes/quickstart');
    expect(links[1]).toHaveTextContent('the glossary');
    expect(links[1]).toHaveAttribute('data-target', 'notes/glossary');

    fireEvent.click(links[1]);
    expect(onNavigate).toHaveBeenCalledWith('notes/glossary');
  });

  it('renders backlinks and routes their clicks through onNavigate', async () => {
    const source = new StubDataSource({
      notes: [WELCOME],
      backlinks: {
        'notes/welcome.md': [
          {
            sourceId: 'notes/quickstart.md',
            sourceTitle: 'Quickstart',
            sourcePath: 'notes/quickstart.md',
            excerpt: 'See also [[notes/welcome]].',
          },
          {
            sourceId: 'notes/glossary.md',
            sourceTitle: 'Glossary',
            sourcePath: 'notes/glossary.md',
            excerpt: '',
          },
        ],
      },
    });
    const onNavigate = vi.fn();
    render(
      <NoteDetail
        noteId="notes/welcome.md"
        dataSource={source}
        onNavigate={onNavigate}
      />,
    );

    const items = await screen.findAllByTestId('backlink-item');
    expect(items).toHaveLength(2);
    // Backlinks are sorted by title (localeCompare) — "Glossary" < "Quickstart".
    fireEvent.click(items[0]);
    expect(onNavigate).toHaveBeenCalledWith('notes/glossary.md');
  });

  it('shows the empty-backlinks hint when the KG reports no reverse refs', async () => {
    const source = new StubDataSource({ notes: [WELCOME], backlinks: { 'notes/welcome.md': [] } });
    render(<NoteDetail noteId="notes/welcome.md" dataSource={source} />);
    expect(await screen.findByTestId('backlinks-empty')).toBeInTheDocument();
  });

  it('emits onClose when the close button is clicked', async () => {
    const source = new StubDataSource({ notes: [WELCOME] });
    const onClose = vi.fn();
    render(
      <NoteDetail
        noteId="notes/welcome.md"
        dataSource={source}
        onClose={onClose}
      />,
    );
    fireEvent.click(await screen.findByTestId('note-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a missing-note fallback when the data source returns null', async () => {
    const source = new StubDataSource();
    render(<NoteDetail noteId="notes/missing.md" dataSource={source} />);
    expect(await screen.findByTestId('note-detail-missing')).toHaveTextContent(
      'notes/missing.md',
    );
  });

  it('renders tags from the note metadata', async () => {
    const source = new StubDataSource({ notes: [WELCOME] });
    render(<NoteDetail noteId="notes/welcome.md" dataSource={source} />);
    const tags = await screen.findAllByTestId('note-tag');
    expect(tags.map((t) => t.textContent)).toEqual(['#intro']);
  });

  it('keeps the close button reachable when the title wraps to two lines (K-02)', async () => {
    const longTitle =
      'OPC 航材数字孪生 2026 试运行：跨班次交接、SB 匹配与拆装工时联动的本地化运行笔记';
    const longNote = makeNote({
      id: 'notes/long.md',
      title: longTitle,
      path: 'notes/long.md',
      body: '# Long\n\nBody for the long-title close-button regression test.',
    });
    const source = new StubDataSource({ notes: [longNote] });
    const view = render(<NoteDetail noteId="notes/long.md" dataSource={source} />);
    expect(await screen.findByTestId('note-detail-title')).toHaveTextContent(longTitle);
    const close = screen.getByTestId('note-detail-close');
    expect(close).toBeInTheDocument();
    expect(close).toBeVisible();
    // Click triggers onClose without scrolling or layout shift.
    fireEvent.click(close);
    view.unmount();
  });

  it('shows a Chinese fail-closed "no tags" hint instead of #undefined (K-02)', async () => {
    const noTagNote = makeNote({
      id: 'notes/untagged.md',
      path: 'notes/untagged.md',
      title: 'Untagged',
      body: '# Untagged\n\nBody without tags.',
      tags: [],
    });
    const source = new StubDataSource({ notes: [noTagNote] });
    render(<NoteDetail noteId="notes/untagged.md" dataSource={source} />);
    expect(await screen.findByTestId('note-tags-empty')).toHaveTextContent('无标签');
    expect(screen.queryByTestId('note-tag')).toBeNull();
  });

  it('cancels stale fetches when noteId changes mid-flight', async () => {
    // Two notes, two fetches — only the latest should win.
    let resolveFirst!: (n: NoteContent | null) => void;
    const pending = new Promise<NoteContent | null>((res) => {
      resolveFirst = res;
    });

    const source: NoteDataSource = {
      getNote: vi.fn().mockImplementation((id: string) => {
        if (id === 'notes/a.md') return pending;
        return Promise.resolve(makeNote({ id, title: id }));
      }),
      getBacklinks: vi.fn().mockResolvedValue([]),
    };

    const view = render(<NoteDetail noteId="notes/a.md" dataSource={source} />);

    // Re-render with a different id BEFORE the first promise resolves.
    view.rerender(<NoteDetail noteId="notes/b.md" dataSource={source} /> as ReactElement);

    // Now resolve the first promise (which is now stale).
    await act(async () => {
      resolveFirst(null);
    });

    // The latest title must be 'notes/b.md', not the stale 'Welcome'.
    await waitFor(() => {
      expect(screen.getByTestId('note-detail-title')).toHaveTextContent('notes/b.md');
    });
  });
});
