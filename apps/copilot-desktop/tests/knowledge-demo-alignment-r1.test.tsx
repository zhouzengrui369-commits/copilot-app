/**
 * Knowledge Demo direct-source alignment R1 — focused unit tests.
 *
 * Sprint: 2026-07-24-knowledge-demo-direct-source-r1
 * Plan: tasks/openclaw/2026-07-24-knowledge-demo-direct-source-r1/PLAN.md
 *
 * These tests verify the P1 gap items K-01/K-02/K-03 from
 * tasks/codex/2026-07-24-knowledge-demo-gap-audit-r1/KNOWLEDGE_GAP_MATRIX.md
 * without touching the KnowledgeGraph production files, navigation shell,
 * or any global demo CSS.
 *
 * K-01 — Low-data and zero-data MOC must remain readable using only real
 *        note metadata, body excerpts, paths, tags, and counts.
 * K-02 — Right-rail NoteDetail must keep title/path/tags and WIKI truth
 *        visible without the close button being hidden behind a long title.
 * K-03 — MOC-first / 2D-secondary views remain fail-closed. This focused file
 *        asserts real-note navigation through a MOC topic card and empty 2D
 *        states; real graph-node source navigation is covered separately.
 */

import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';
import { NoteDetail } from '../src/renderer/components/NoteDetail/index.js';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api.js';

// jsdom doesn't provide WebGL2RenderingContext; sigma.js's WebGL renderer
// crashes at module-evaluation time if pulled in via the canvas component.
// We must still render the real `KnowledgeGraph` React component so the
// `kg-toolbar-meta` truth assertion (`0 / 0 nodes`) holds for K-03. The
// stub pattern below mirrors the verified approach in
// `tests/KnowledgeGraph.test.tsx`: lightweight class stubs that satisfy
// the constructor + method surface that `SigmaCanvas` actually calls.
vi.mock('sigma', () => {
  class FakeSigma {
    public killed = false;
    constructor(_graph: unknown, _container: HTMLElement, _opts?: unknown) {
      /* no-op */
    }
    kill(): void {
      this.killed = true;
    }
    on(): void {
      /* no-op */
    }
    off(): void {
      /* no-op */
    }
    refresh(): void {
      /* no-op */
    }
  }
  return { default: FakeSigma };
});

vi.mock('graphology', () => {
  class FakeGraph {
    private nodeAttrs = new Map<string, Record<string, unknown>>();
    constructor(_opts?: unknown) {
      /* no-op */
    }
    addNode(id: string, attrs?: Record<string, unknown>): void {
      this.nodeAttrs.set(id, attrs ?? {});
    }
    hasNode(id: string): boolean {
      return this.nodeAttrs.has(id);
    }
    nodes(): string[] {
      return [...this.nodeAttrs.keys()];
    }
    getNodeAttributes(id: string): Record<string, unknown> {
      return this.nodeAttrs.get(id) ?? {};
    }
    forEachNode(cb: (id: string, attrs: Record<string, unknown>) => void): void {
      for (const [id, attrs] of this.nodeAttrs) cb(id, attrs);
    }
    hasEdge(): boolean {
      return false;
    }
    addEdgeWithKey(): void {
      /* no-op */
    }
    forEachEdge(): void {
      /* no-op */
    }
    setNodeAttribute(id: string, key: string, val: unknown): void {
      const a = this.nodeAttrs.get(id);
      if (a) a[key] = val;
    }
    setEdgeAttribute(): void {
      /* no-op */
    }
  }
  return { default: FakeGraph };
});

vi.mock('graphology-layout', () => ({
  circular: {
    assign(graph: { nodes: () => string[]; setNodeAttribute: (id: string, k: string, v: unknown) => void }, _opts?: unknown): void {
      const ids = graph.nodes();
      const scale = (_opts as { scale?: number } | undefined)?.scale ?? 100;
      ids.forEach((id, i) => {
        const a = (i / ids.length) * Math.PI * 2;
        graph.setNodeAttribute(id, 'x', Math.cos(a) * scale);
        graph.setNodeAttribute(id, 'y', Math.sin(a) * scale);
      });
    },
  },
  random: {
    assign(graph: { nodes: () => string[]; setNodeAttribute: (id: string, k: string, v: unknown) => void }, _opts?: unknown): void {
      graph.nodes().forEach((id, i) => {
        graph.setNodeAttribute(id, 'x', i);
        graph.setNodeAttribute(id, 'y', i);
      });
    },
  },
  forceAtlas2: {
    assign(): void {
      /* no-op */
    },
  },
}));
import type {
  CopilotNote,
  CopilotNoteInput,
  CopilotNoteSummary,
  CopilotProductApi,
} from '../src/renderer/lib/copilot-api.js';
import type { BacklinkRef, NoteContent, NoteDataSource } from '../src/renderer/components/NoteDetail/types.js';
import type { KgSubgraph, NoteBuildReceipt, WikiTruthReceipt } from '../src/shared/domain-api.js';

function makeSummary(overrides: Partial<CopilotNoteSummary> = {}): CopilotNoteSummary {
  return {
    path: 'inbox/welcome.md',
    title: 'Welcome',
    tags: ['intro'],
    type: 'note',
    status: 'active',
    updatedAt: Date.UTC(2026, 6, 21, 10, 0, 0),
    ...overrides,
  };
}

function makeNote(overrides: Partial<CopilotNote> = {}): CopilotNote {
  return {
    path: 'inbox/welcome.md',
    title: 'Welcome',
    body: '# Welcome\n\nFirst line of the body for the excerpt test.',
    tags: ['intro'],
    type: 'note',
    status: 'active',
    updatedAt: Date.UTC(2026, 6, 21, 10, 0, 0),
    ...overrides,
  };
}

function missingWiki(path: string): WikiTruthReceipt {
  return {
    notePath: path,
    expectedContentDigest: 'b'.repeat(64),
    truth: 'missing',
    projection: null,
    current: null,
    latest: null,
    stale: [],
    failed: [],
    provenance: null,
    knowledgeBuild: {
      state: 'not-ready',
      revision: `note:1:${'b'.repeat(64)}`,
    },
  };
}

function missingBuild(path: string): NoteBuildReceipt {
  return {
    state: 'BUILD_FAILED',
    kg: { state: 'ready', entitiesAdded: 0, entitiesLinked: 0, reason: null },
    wiki: missingWiki(path),
    rag: { state: 'ready', chunksInserted: 1, reason: null },
    failureStage: 'wiki',
    failureReason: 'WIKI_MISSING',
  };
}

function makeApi(seedNotes: CopilotNoteSummary[] = []): CopilotProductApi {
  const summaries = seedNotes;
  const bodies = new Map<string, CopilotNote>();
  for (const summary of summaries) {
    bodies.set(summary.path, makeNote({ path: summary.path, title: summary.title, tags: summary.tags }));
  }
  return {
    notes: {
      list: vi.fn().mockResolvedValue(summaries),
      get: vi.fn().mockImplementation(async (path: string) => bodies.get(path) ?? null),
      create: vi.fn().mockImplementation(async (input: CopilotNoteInput) => {
        const created = makeNote({
          path: input.path,
          title: input.title,
          body: input.body,
          tags: input.tags,
          localState: 'LOCAL_SAVED',
          knowledgeBuild: {
            state: 'queued',
            revision: `note:1:${'a'.repeat(64)}`,
          },
        });
        bodies.set(created.path, created);
        return created;
      }),
      createWithBuild: vi.fn().mockImplementation(async (input: CopilotNoteInput) => {
        const created = makeNote({ path: input.path, title: input.title, body: input.body, tags: input.tags });
        bodies.set(created.path, created);
        return { note: created, localState: 'LOCAL_SAVED' as const, build: missingBuild(created.path) };
      }),
      update: vi.fn().mockImplementation(async (path: string, input: Partial<CopilotNoteInput>) => {
        const current = bodies.get(path);
        if (!current) return null;
        const next = {
          ...current,
          ...input,
          path: input.path ?? current.path,
          localState: 'LOCAL_SAVED' as const,
          knowledgeBuild: {
            state: 'queued' as const,
            revision: `note:1:${'a'.repeat(64)}`,
          },
        };
        bodies.set(next.path, next);
        return next;
      }),
      updateWithBuild: vi.fn().mockImplementation(async (path: string, input: Partial<CopilotNoteInput>) => {
        const current = bodies.get(path);
        if (!current) return null;
        const next = { ...current, ...input, path: input.path ?? current.path };
        bodies.set(next.path, next);
        return { note: next, localState: 'LOCAL_SAVED' as const, build: missingBuild(next.path) };
      }),
      remove: vi.fn().mockResolvedValue(true),
      getBacklinks: vi.fn().mockResolvedValue([]),
    },
    wiki: {
      getForNote: vi.fn().mockImplementation(async (path: string) => missingWiki(path)),
    },
    kg: {
      getSubgraph: vi.fn().mockResolvedValue({
        nodes: [],
        edges: [],
        degree: {},
      } satisfies KgSubgraph),
      reindexNote: vi.fn().mockResolvedValue({ ok: true }),
    },
    rag: {
      ask: vi.fn().mockResolvedValue({ text: '', sources: [] }),
    },
    todos: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      listDue: vi.fn().mockResolvedValue([]),
      markReminderFired: vi.fn(),
    },
  };
}

function renderProductKnowledge(api: CopilotProductApi) {
  window.__COPILOT_BROWSER_PROTOTYPE__ = {
    api,
    scenario: 'ready',
    label: 'PROTOTYPE / NOT_RUNTIME_PROOF',
  };
  return render(<KnowledgeWorkspace api={api} />);
}

afterEach(() => {
  window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
  delete (window as Window & { __R44_UNSAFE_HTML_EXECUTED__?: boolean })
    .__R44_UNSAFE_HTML_EXECUTED__;
});

class StubNoteDataSource implements NoteDataSource {
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

const LONG_TITLE = 'OPC 航材数字孪生 2026 试运行：跨班次交接、SB 匹配与拆装工时联动的本地化运行笔记标题';

const LONG_TITLE_NOTE: NoteContent = {
  id: 'inbox/long.md',
  path: 'inbox/long.md',
  title: LONG_TITLE,
  body: '# OPC 航材数字孪生\n\n真实记录本周班次与 SB 匹配进度。',
  tags: ['opc', '航材', 'mro'],
  updatedAt: Date.UTC(2026, 6, 21, 10, 0, 0),
};

describe('Knowledge Workspace — K-01 low-data / zero-data MOC readability', () => {
  it('renders a zero-data MOC with fail-closed empty state and zero counts', async () => {
    const api = makeApi([]);
    const view = renderProductKnowledge(api);

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-moc-reader')).toBeInTheDocument();
    });

    // Real counts — never fabricated.
    expect(screen.getByTestId('moc-total-count')).toHaveTextContent('0');
    expect(screen.getByTestId('moc-group-count')).toHaveTextContent('0');
    expect(screen.getByTestId('moc-selected-count')).toHaveTextContent('0');

    // Prototype provenance stays explicit while generated WIKI fields remain hidden.
    expect(screen.getByTestId('moc-truth-chip')).toHaveTextContent('PROTOTYPE_DERIVED');
    expect(screen.getByTestId('folder-wiki-truth')).toHaveTextContent(
      '按更新时间/标签分组 · PROTOTYPE_DERIVED',
    );
    expect(screen.getByTestId('moc-wiki-not-current')).toHaveTextContent('保持隐藏');
    expect(screen.queryByTestId('moc-wiki-current')).not.toBeInTheDocument();

    // Fixture provenance is visible, with no simulated or post-MVP content.
    const reader = screen.getByTestId('knowledge-moc-reader');
    expect(reader).toHaveTextContent('Browser fixture');
    expect(reader.textContent ?? '').not.toMatch(/SIMULATED|3D 星辰大海/u);

    // Zero-data has a WorkspaceState empty block inside the MOC primary
    // area (the left rail also renders one; we scope to the MOC reader
    // using the `reader` already captured above for the fixture check).
    expect(within(reader).getByTestId('workspace-state-empty')).toBeInTheDocument();
    expect(within(reader).getByRole('button', { name: /新建第一条本地笔记/ })).toBeInTheDocument();

    view.unmount();
  });

  it('renders a single-note folder MOC without leaking raw body before WIKI current', async () => {
    const api = makeApi([
      makeSummary({
        path: 'inbox/welcome.md',
        title: 'Welcome',
        tags: ['intro'],
      }),
    ]);
    const view = renderProductKnowledge(api);

    await waitFor(() => {
      expect(screen.getByTestId('moc-total-count')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('moc-group-count')).toHaveTextContent('1');

    // Reading path is non-empty and names the real document.
    const step = screen.getByTestId('moc-reading-step-0');
    expect(step).toHaveTextContent('Welcome');
    expect(step).toHaveTextContent('待 WIKI 整理');

    // Topic card retains real metadata, while the raw body remains gated.
    expect(screen.getByTestId('moc-topic-intro')).toBeInTheDocument();
    expect(screen.getByTestId('moc-topic-note-inbox/welcome.md')).toHaveTextContent('Welcome');
    expect(screen.getByTestId('moc-topic-excerpt-empty-inbox/welcome.md')).toHaveTextContent(
      '仅在 WIKI CURRENT',
    );
    expect(screen.queryByText('First line of the body for the excerpt test.')).not.toBeInTheDocument();
    expect(screen.queryByText(/#undefined/)).toBeNull();

    // A non-current reading-path entry opens the original document while its
    // generated WIKI truth remains explicitly fail-closed.
    fireEvent.click(step);
    const rawReader = await screen.findByTestId('knowledge-document-reader');
    expect(rawReader).toHaveAttribute('data-wiki-state', 'not-ready');
    expect(within(rawReader).getByText('WIKI NOT_READY')).toBeInTheDocument();
    expect(rawReader).toHaveTextContent('First line of the body for the excerpt test.');
    expect(rawReader).not.toHaveTextContent('WIKI CURRENT');

    view.unmount();
  });

  it('renders multi-note MOC with per-group counts and real topic cards', async () => {
    const api = makeApi([
      makeSummary({ path: 'inbox/welcome.md', title: 'Welcome', tags: ['intro'] }),
      makeSummary({ path: 'inbox/quickstart.md', title: 'Quickstart', tags: ['intro'] }),
      makeSummary({ path: 'inbox/glossary.md', title: 'Glossary', tags: ['reference'] }),
    ]);
    const view = renderProductKnowledge(api);

    await waitFor(() => {
      expect(screen.getByTestId('moc-total-count')).toHaveTextContent('3');
    });
    expect(screen.getByTestId('moc-group-count')).toHaveTextContent('2');

    // Two real groups present.
    expect(screen.getByTestId('moc-topic-intro')).toBeInTheDocument();
    expect(screen.getByTestId('moc-topic-reference')).toBeInTheDocument();

    // Search filters the reader deterministically.
    const search = screen.getByLabelText('搜索本地知识');
    fireEvent.change(search, { target: { value: 'glossary' } });
    await waitFor(() => {
      expect(screen.getByTestId('moc-total-count')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('moc-selected-count')).toHaveTextContent('0');
    expect(screen.getByTestId('moc-topic-reference')).toBeInTheDocument();
    expect(screen.queryByTestId('moc-topic-intro')).not.toBeInTheDocument();

    view.unmount();
  });

  it('keeps a newly saved filtered note WIKI-gated while preserving the local receipt', async () => {
    window.history.replaceState(null, '', '?prototype=ready#knowledge');
    const api = installBrowserPrototype().api;
    const view = render(<KnowledgeWorkspace api={api} />);

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    const moc = await screen.findByTestId('knowledge-folder-moc');
    expect(moc).toHaveAttribute('data-folder-path', 'inbox');
    expect(screen.getByTestId('moc-total-count')).toHaveTextContent('1');
    expect(screen.getByTestId('moc-topic-note-inbox/mvp-acceptance'))
      .toHaveTextContent('MVP 验收清单');
    expect(screen.queryByTestId('moc-topic-note-projects/copilot-html-first'))
      .not.toBeInTheDocument();

    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-folder-moc')).toHaveAttribute(
        'data-folder-path',
        'projects',
      );
    });
    expect(screen.getByTestId('moc-total-count')).toHaveTextContent('1');
    expect(screen.getByTestId('moc-topic-note-projects/copilot-html-first'))
      .toHaveTextContent('HTML-first 交付记录');
    expect(screen.queryByTestId('moc-topic-note-inbox/mvp-acceptance'))
      .not.toBeInTheDocument();

    fireEvent.click(within(map).getByRole('button', { name: /inbox.*1 条笔记/u }));
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-folder-moc')).toHaveAttribute(
        'data-folder-path',
        'inbox',
      );
    });
    expect(screen.getByTestId('moc-total-count')).toHaveTextContent('1');

    fireEvent.change(screen.getByLabelText('搜索本地知识'), {
      target: { value: 'no-existing-or-new-note-matches' },
    });
    expect(screen.getByTestId('moc-selected-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), {
      target: { value: '过滤状态中新建的笔记' },
    });
    fireEvent.change(screen.getByLabelText('笔记路径'), {
      target: { value: 'inbox/post-create-filtered' },
    });
    fireEvent.change(screen.getByLabelText('笔记正文'), {
      target: { value: '# 新建后必须立即可读' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-organized-preview-gated')).toHaveAttribute(
        'data-wiki-state',
        'not-ready',
      );
    });
    expect(screen.queryByTestId('note-detail-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('# 新建后必须立即可读')).not.toBeInTheDocument();
    expect(screen.getByTestId('knowledge-save-receipt')).toHaveTextContent('LOCAL_SAVED');

    view.unmount();
  });
});

describe('Knowledge Workspace — K-02 NoteDetail title/path/tags + WIKI truth', () => {
  it('keeps the close button reachable when a long title wraps to two lines', async () => {
    const source = new StubNoteDataSource({ notes: [LONG_TITLE_NOTE] });
    const view = render(<NoteDetail noteId="inbox/long.md" dataSource={source} />);

    expect(await screen.findByTestId('note-detail-title')).toHaveTextContent(LONG_TITLE);
    const close = await screen.findByTestId('note-detail-close');
    expect(close).toBeInTheDocument();
    expect(close).toBeVisible();
    // Close still fires onNavigate-free onClose.
    fireEvent.click(close);
    expect(close).toBeInTheDocument();

    view.unmount();
  });

  it('renders Chinese status copy in NoteDetail without i18n expansion', async () => {
    const source = new StubNoteDataSource({
      notes: [
        {
          id: 'inbox/zh.md',
          path: 'inbox/zh.md',
          title: '中文标题',
          body: '# 中文笔记\n\n真实记录本周排程。',
          tags: ['a', 'b'],
          updatedAt: Date.UTC(2026, 6, 21, 10, 0, 0),
        },
      ],
    });
    render(<NoteDetail noteId="inbox/zh.md" dataSource={source} />);

    expect(await screen.findByTestId('note-detail-title')).toHaveTextContent('中文标题');
    expect(screen.getByLabelText('关闭笔记详情')).toBeInTheDocument();
    const tags = await screen.findAllByTestId('note-tag');
    expect(tags.map((t) => t.textContent)).toEqual(['#a', '#b']);
  });

  it('shows a fail-closed "no tags" hint instead of #undefined for missing tags', async () => {
    const source = new StubNoteDataSource({
      notes: [
        {
          id: 'inbox/untagged.md',
          path: 'inbox/untagged.md',
          title: 'Untagged',
          body: '# Untagged\n\nBody without tags.',
          tags: [],
          updatedAt: Date.UTC(2026, 6, 21, 10, 0, 0),
        },
      ],
    });
    render(<NoteDetail noteId="inbox/untagged.md" dataSource={source} />);
    expect(await screen.findByTestId('note-tags-empty')).toHaveTextContent('无标签');
    expect(screen.queryByTestId('note-tag')).toBeNull();
  });

  it('shows Chinese loading / missing / error states without dropping the close button', async () => {
    const source = new StubNoteDataSource({});
    const view = render(<NoteDetail noteId="inbox/missing.md" dataSource={source} />);
    expect(await screen.findByTestId('note-detail-missing')).toHaveTextContent('找不到笔记');
    expect(screen.getByTestId('note-detail-close')).toBeInTheDocument();
    view.unmount();

    const errorSource: NoteDataSource = {
      getNote: vi.fn().mockRejectedValue(new Error('boom')),
      getBacklinks: vi.fn().mockResolvedValue([]),
    };
    const view2 = render(<NoteDetail noteId="inbox/bad.md" dataSource={errorSource} />);
    expect(await screen.findByTestId('note-detail-error')).toHaveTextContent('加载笔记失败');
    expect(screen.getByTestId('note-detail-close')).toBeInTheDocument();
    view2.unmount();
  });
});

describe('Knowledge Workspace — K-03 folder WIKI/MOC product semantics', () => {
  it('defines Phase 1 2D as MOC reading and keeps the node graph post-MVP', async () => {
    const api = installBrowserPrototype().api;
    const view = render(<KnowledgeWorkspace api={api} />);

    expect(await screen.findByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: '2D 关系' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后')).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    view.unmount();
  });

  it('keeps a folder MOC fail-closed when its note WIKI is not current', async () => {
    const api = makeApi([
      makeSummary({ path: 'inbox/welcome.md', title: 'Welcome', tags: ['intro'] }),
    ]);
    const view = renderProductKnowledge(api);

    const moc = await screen.findByTestId('knowledge-folder-moc');
    expect(moc).toHaveAttribute('data-folder-path', 'inbox');
    expect(within(moc).getByTestId('folder-wiki-truth')).toHaveTextContent(
      '按更新时间/标签分组 · PROTOTYPE_DERIVED',
    );
    expect(within(moc).queryByTestId('moc-wiki-current')).not.toBeInTheDocument();
    expect(within(moc).getByTestId('folder-wiki-sources')).toHaveTextContent(
      'inbox/welcome.md',
    );
    expect(within(moc).queryByText('First line of the body for the excerpt test.'))
      .not.toBeInTheDocument();

    view.unmount();
  });

  it('opens only digest-bound Markdown and sanitized HTML as full-page organized documents', async () => {
    const api = installBrowserPrototype().api;
    const view = render(<KnowledgeWorkspace api={api} />);

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    fireEvent.click(
      await screen.findByTestId('moc-topic-note-projects/copilot-html-first'),
    );

    const reader = await screen.findByTestId('knowledge-document-reader');
    await waitFor(() => {
      expect(within(reader).getByTestId('markdown-renderer')).toHaveTextContent(
        '同源 renderer、显式 fixture 边界、浏览器操作验收。',
      );
    });

    fireEvent.click(within(reader).getByRole('button', {
      name: /返回 projects MOC/u,
    }));
    fireEvent.click(within(map).getByRole('button', { name: /inbox.*1 条笔记/u }));
    fireEvent.click(await screen.findByTestId('moc-topic-note-inbox/mvp-acceptance'));

    await waitFor(() => {
      const htmlReader = screen.getByTestId('knowledge-document-reader');
      expect(htmlReader).toHaveAttribute(
        'data-document-path',
        'inbox/mvp-acceptance',
      );
      expect(within(htmlReader).getByTestId('safe-html-preview')).toHaveTextContent(
        '先验证今天与知识主旅程，再进入 Electron 运行门。',
      );
    });
    expect(screen.queryByText('window.__R44_UNSAFE_HTML_EXECUTED__')).not.toBeInTheDocument();
    expect(
      (window as Window & { __R44_UNSAFE_HTML_EXECUTED__?: boolean })
        .__R44_UNSAFE_HTML_EXECUTED__,
    ).toBeUndefined();

    view.unmount();
  });

  it('keeps the WIKI inspector block fail-closed when no note is selected', async () => {
    const api = makeApi([]);
    const view = renderProductKnowledge(api);
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-moc-reader')).toBeInTheDocument();
    });
    expect(screen.getByTestId('wiki-truth-chip')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-summary')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-tags')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-entities')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-relations')).toHaveTextContent('NOT_READY');
    view.unmount();
  });
});
