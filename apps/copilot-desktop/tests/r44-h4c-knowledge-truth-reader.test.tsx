import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WikiProjectionReceipt,
  WikiTruthReceipt,
} from '../src/shared/domain-api.js';
import { MarkdownRenderer } from '../src/renderer/components/NoteDetail/MarkdownRenderer.js';
import type {
  CopilotNote,
  CopilotProductApi,
} from '../src/renderer/lib/copilot-api.js';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="isolated-knowledge-graph" />,
}));

afterEach(() => {
  window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
});

function renderReadyKnowledge(
  onAssistantContextChange?: Parameters<typeof KnowledgeWorkspace>[0]['onAssistantContextChange'],
) {
  window.history.replaceState(null, '', '?prototype=ready#knowledge');
  const api = installBrowserPrototype().api;
  return render(
    <KnowledgeWorkspace
      api={api}
      onAssistantContextChange={onAssistantContextChange}
    />,
  );
}

const FULL_READER_PATH = 'projects/copilot-html-first';
const FULL_READER_TAIL_MARKER = 'H4C_FULL_READER_TAIL_7F9C2D';
const FULL_READER_BODY = [
  '# HTML-first 交付记录',
  '',
  '## 第一章：同源渲染',
  '',
  '同源 renderer、显式 fixture 边界、浏览器操作验收。',
  '',
  '## 第二章：真值边界',
  '',
  '整理摘要只属于紧凑预览，完整阅读必须继续展示原始正文。',
  '',
  '## 第三章：文尾核对',
  '',
  `唯一文尾标记：${FULL_READER_TAIL_MARKER}`,
].join('\n');

function renderRichReaderKnowledge() {
  window.history.replaceState(null, '', '?prototype=ready#knowledge');
  const api = installBrowserPrototype().api;
  const readNote = api.notes.get.bind(api.notes);
  api.notes.get = async (path) => {
    const note = await readNote(path);
    return path === FULL_READER_PATH && note
      ? { ...note, body: FULL_READER_BODY }
      : note;
  };
  const readWikiTruth = api.wiki!.getForNote.bind(api.wiki);
  api.wiki!.getForNote = async (path) => {
    const truth = await readWikiTruth(path);
    if (path !== FULL_READER_PATH) return truth;
    const contentDigest = `fixture-digest:${FULL_READER_TAIL_MARKER}`;
    const bindDigest = (projection: WikiProjectionReceipt | null) => (
      projection ? { ...projection, contentDigest } : null
    );
    return {
      ...truth,
      expectedContentDigest: contentDigest,
      projection: bindDigest(truth.projection),
      current: bindDigest(truth.current),
      latest: bindDigest(truth.latest),
      stale: truth.stale.map((projection) => ({ ...projection, contentDigest })),
      failed: truth.failed.map((projection) => ({ ...projection, contentDigest })),
    };
  };
  return render(<KnowledgeWorkspace api={api} />);
}

function currentTruth(note: CopilotNote, summary = '整理摘要'): WikiTruthReceipt {
  const digest = `digest:${note.path}:${note.body}`;
  const projection: WikiProjectionReceipt = {
    projectionId: `projection:${note.path}`,
    notePath: note.path,
    status: 'current',
    contentDigest: digest,
    summary,
    tags: note.tags,
    entityIds: [],
    relationSignatures: [],
    generatedAt: note.updatedAt ?? null,
    failureStage: null,
    failureReason: null,
    provenance: {
      provider: 'test',
      model: 'test',
      generatedAt: note.updatedAt ?? 1,
    },
  };
  return {
    notePath: note.path,
    expectedContentDigest: digest,
    truth: 'current',
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection.provenance,
    knowledgeBuild: { state: 'ready', revision: digest },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('R44 H4C Knowledge truth and full reader', () => {
  it('keeps the WIKI summary compact but reads the complete original Markdown document', async () => {
    renderRichReaderKnowledge();

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    fireEvent.click(
      within(map).getByRole('button', {
        name: /^HTML-first 交付记录 copilot-html-first$/u,
      }),
    );

    const compactPreview = await screen.findByTestId('wiki-organized-preview-current');
    await waitFor(() => {
      expect(compactPreview).toHaveTextContent(
        '已整理的 HTML-first 交付摘要',
      );
    });
    expect(compactPreview).not.toHaveTextContent(FULL_READER_TAIL_MARKER);
    fireEvent.click(screen.getByRole('button', { name: '全页阅读' }));

    const reader = await screen.findByTestId('knowledge-document-reader');
    const fullDocument = await within(reader).findByTestId('markdown-renderer');
    expect(fullDocument).toHaveTextContent('第一章：同源渲染');
    expect(fullDocument).toHaveTextContent('第二章：真值边界');
    expect(fullDocument).toHaveTextContent('第三章：文尾核对');
    expect(fullDocument).toHaveTextContent(FULL_READER_TAIL_MARKER);
    expect(within(reader).getByText('完整原文 · WIKI CURRENT 已核验'))
      .toBeInTheDocument();
  });

  it.each([
    ['javascript', '[bad](javascript:alert(1))', null],
    ['data', '[bad](data:text/html;base64,PHNjcmlwdD4=)', null],
    ['https', '[safe](https://example.test/a)', 'https://example.test/a'],
    ['http', '[safe](http://example.test/a)', 'http://example.test/a'],
    ['mailto', '[safe](mailto:test@example.test)', 'mailto:test@example.test'],
  ])('fails closed for %s Markdown URLs', (_label, source, expectedHref) => {
    const view = render(<MarkdownRenderer source={source} />);
    const link = screen.getByRole('link');
    if (expectedHref) {
      expect(link).toHaveAttribute('href', expectedHref);
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('target', '_blank');
    } else {
      expect(link).not.toHaveAttribute('href');
      expect(link).not.toHaveAttribute('target');
    }
    view.unmount();
  });

  it('keeps internal wikilinks while stripping the complete active HTML matrix', () => {
    const onNavigate = vi.fn();
    const view = render(
      <MarkdownRenderer source="[[notes/safe|Safe note]]" onWikilinkClick={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('wikilink'));
    expect(onNavigate).toHaveBeenCalledWith('notes/safe');
    view.unmount();

    const html = [
      '<article onclick="alert(1)">SAFE ARTICLE',
      '<a href="javascript:alert(1)">JS</a>',
      '<a href="data:text/html;base64,WA==">DATA</a>',
      '<a href="https://example.test">HTTPS</a>',
      '<form>FORM<input value="x"></form>',
      '<iframe>IFRAME</iframe><embed src="x"><object>OBJECT</object>',
      '<svg><text>SVG</text></svg><style>STYLE</style><template>TEMPLATE</template>',
      '</article>',
    ].join('');
    const htmlView = render(<MarkdownRenderer source={html} format="html" />);
    const preview = screen.getByTestId('safe-html-preview');
    expect(preview).toHaveTextContent('SAFE ARTICLE');
    expect(preview).not.toHaveTextContent(/FORM|IFRAME|OBJECT|SVG|STYLE|TEMPLATE/u);
    expect(preview.querySelector('[onclick], form, iframe, embed, object, svg, style, template'))
      .toBeNull();
    const links = preview.querySelectorAll('a');
    expect(links[0]).not.toHaveAttribute('href');
    expect(links[1]).not.toHaveAttribute('href');
    expect(links[2]).toHaveAttribute('href', 'https://example.test');
    expect(links[2]).toHaveAttribute('rel', 'noopener noreferrer');
    htmlView.unmount();
  });

  it('labels browser MOC as mechanical grouping rather than folder WIKI truth', async () => {
    renderReadyKnowledge();

    expect(await screen.findByTestId('folder-wiki-truth')).toHaveTextContent(
      '按更新时间/标签分组 · PROTOTYPE_DERIVED',
    );
    expect(screen.queryByText('PROTOTYPE_WIKI_VIEW')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后'))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();
  });

  it('invalidates folder truth immediately when a save starts a new generation', async () => {
    let note: CopilotNote = {
      path: 'notes/a.md',
      title: 'Note A',
      body: '# A\n\noriginal',
      tags: ['alpha'],
      type: 'note',
      status: 'active',
      updatedAt: 1,
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'ready', revision: 'r1' },
    };
    const nextTruth = deferred<WikiTruthReceipt>();
    let wikiCalls = 0;
    const api = {
      notes: {
        list: vi.fn(async () => [{ ...note, body: undefined }]),
        get: vi.fn(async () => note),
        create: vi.fn(),
        update: vi.fn(async (_path: string, input: Partial<CopilotNote>) => {
          note = {
            ...note,
            ...input,
            updatedAt: 2,
            localState: 'LOCAL_SAVED',
            knowledgeBuild: { state: 'running', revision: 'r2' },
          };
          return note;
        }),
        remove: vi.fn(async () => true),
        getBacklinks: vi.fn(async () => []),
      },
      wiki: {
        getForNote: vi.fn(async () => {
          wikiCalls += 1;
          if (wikiCalls <= 2) return currentTruth(note);
          return nextTruth.promise;
        }),
      },
      kg: {
        getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
        reindexNote: vi.fn(async () => undefined),
      },
      rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
      todos: {
        list: vi.fn(async () => []),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(async () => true),
        listDue: vi.fn(async () => []),
        markReminderFired: vi.fn(),
      },
    } as unknown as CopilotProductApi;

    render(<KnowledgeWorkspace api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('folder-wiki-truth')).toHaveTextContent('NOTE_CURRENT_ONLY');
    });
    fireEvent.click(screen.getByRole('button', { name: '编辑原始笔记' }));
    fireEvent.change(await screen.findByLabelText('笔记正文'), {
      target: { value: '# A\n\nchanged' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => expect(api.notes.update).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('folder-wiki-truth')).toHaveTextContent('NOT_READY');
    expect(screen.queryByTestId('moc-wiki-current')).not.toBeInTheDocument();
  });

  it('restores folder, selected topic and MOC scroll after full-page reading', async () => {
    renderReadyKnowledge();
    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    fireEvent.click(await screen.findByRole('button', { name: '选择主题 copilot' }));
    const moc = screen.getByTestId('knowledge-moc-reader');
    moc.scrollTop = 180;
    fireEvent.click(screen.getByTestId('moc-topic-note-projects/copilot-html-first'));
    const reader = await screen.findByTestId('knowledge-document-reader');
    fireEvent.click(within(reader).getByRole('button', { name: /返回 projects MOC/u }));

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-folder-moc')).toHaveAttribute(
        'data-folder-path',
        'projects',
      );
      expect(screen.getByTestId('moc-topic-copilot')).toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(screen.getByTestId('knowledge-moc-reader').scrollTop).toBe(180);
    });
  });

  it('offers collapsible rails and publishes fail-closed assistant context', async () => {
    const onContext = vi.fn();
    renderReadyKnowledge(onContext);

    expect(await screen.findByRole('button', { name: '收起知识目录' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '收起整理预览' }))
      .toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '收起知识目录' }));
    expect(screen.getByRole('button', { name: '展开知识目录' }))
      .toHaveAttribute('aria-expanded', 'false');

    await waitFor(() => expect(onContext).toHaveBeenCalledWith(expect.objectContaining({
      documentPath: 'inbox/mvp-acceptance',
      wikiTruth: 'CURRENT',
    })));
    const lastContext = [...onContext.mock.calls]
      .reverse()
      .map(([context]) => context)
      .find((context) => (
        context.documentPath === 'inbox/mvp-acceptance'
        && context.wikiTruth === 'CURRENT'
      ));
    expect(lastContext).toEqual({
        route: 'knowledge',
        subtitle: expect.stringContaining('知识 · MOC inbox · WIKI CURRENT'),
        truth: 'NOT_PROBED',
        sourceCount: 1,
        folderPath: 'inbox',
        documentPath: 'inbox/mvp-acceptance',
        wikiTruth: 'CURRENT',
    });
    expect(Object.keys(lastContext ?? {}).sort()).toEqual([
      'documentPath',
      'folderPath',
      'route',
      'sourceCount',
      'subtitle',
      'truth',
      'wikiTruth',
    ]);
    expect(JSON.stringify(lastContext)).not.toMatch(
      /api.?key|credential|secret|token|password|(?:credential|secret).*length/iu,
    );
  });
});
