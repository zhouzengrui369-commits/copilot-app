import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="legacy-test-graph" />,
}));

afterEach(() => {
  window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
  delete (window as Window & { __R44_UNSAFE_HTML_EXECUTED__?: boolean })
    .__R44_UNSAFE_HTML_EXECUTED__;
});

function renderReadyKnowledge() {
  window.history.replaceState(null, '', '?prototype=ready#knowledge');
  const api = installBrowserPrototype().api;
  return render(<KnowledgeWorkspace api={api} />);
}

describe('R44 H2 Knowledge owner feedback', () => {
  it('defines Phase 1 2D as MOC reading and leaves 3D visualization post-MVP without an entry', async () => {
    renderReadyKnowledge();

    expect(await screen.findByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: '2D 关系' })).not.toBeInTheDocument();
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();
  });

  it('renders a selectable folder tree derived from real note paths', async () => {
    renderReadyKnowledge();

    const tree = await screen.findByRole('tree', { name: '知识文件夹目录' });
    expect(within(tree).getByRole('treeitem', { name: /^inbox 文件夹$/ })).toBeInTheDocument();
    expect(within(tree).getByRole('treeitem', { name: /^projects 文件夹$/ })).toBeInTheDocument();

    fireEvent.click(
      within(tree).getByRole('button', {
        name: /^HTML-first 交付记录 copilot-html-first$/,
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-note-compact-title')).toHaveTextContent(
        'HTML-first 交付记录',
      );
    });
  });

  it('opens Markdown and sanitized HTML organized previews from MOC category cards', async () => {
    renderReadyKnowledge();

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    const markdownCard = await screen.findByTestId(
      'moc-topic-note-projects/copilot-html-first',
    );
    expect(markdownCard.closest('[data-document-format]')).toHaveAttribute(
      'data-document-format',
      'markdown',
    );
    fireEvent.click(markdownCard);

    await waitFor(() => {
      expect(screen.getByTestId('note-format-badge')).toHaveTextContent('Markdown');
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent(
        '同源 renderer、显式 fixture 边界、浏览器操作验收。',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /返回 projects MOC/u }));
    fireEvent.click(within(map).getByRole('button', { name: /inbox.*1 条笔记/u }));
    const htmlCard = screen.getByTestId('moc-topic-note-inbox/mvp-acceptance');
    expect(htmlCard.closest('[data-document-format]')).toHaveAttribute(
      'data-document-format',
      'html',
    );
    fireEvent.click(htmlCard);

    await waitFor(() => {
      expect(screen.getByTestId('note-format-badge')).toHaveTextContent('HTML');
      expect(screen.getByTestId('safe-html-preview')).toHaveTextContent(
        '先验证今天与知识主旅程，再进入 Electron 运行门。',
      );
    });
    expect(screen.queryByText('window.__R44_UNSAFE_HTML_EXECUTED__')).not.toBeInTheDocument();
    expect(
      (window as Window & { __R44_UNSAFE_HTML_EXECUTED__?: boolean })
        .__R44_UNSAFE_HTML_EXECUTED__,
    ).toBeUndefined();
  });

  it('hides raw note content until digest-bound WIKI current is ready', async () => {
    renderReadyKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), {
      target: { value: '尚未整理的原始笔记' },
    });
    fireEvent.change(screen.getByLabelText('笔记路径'), {
      target: { value: 'inbox/raw-not-ready.md' },
    });
    fireEvent.change(screen.getByLabelText('笔记正文'), {
      target: { value: 'RAW_SECRET_NOT_ORGANIZED' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-organized-preview-gated')).toHaveAttribute(
        'data-wiki-state',
        'not-ready',
      );
    });
    expect(screen.queryByTestId('note-detail-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('RAW_SECRET_NOT_ORGANIZED')).not.toBeInTheDocument();
    expect(screen.getByTestId('knowledge-save-receipt')).toHaveTextContent(
      'LOCAL_SAVED',
    );
  });
});
