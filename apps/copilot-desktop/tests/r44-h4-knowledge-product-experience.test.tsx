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

describe('R44 H4 Knowledge product experience', () => {
  it('turns real folder paths into a selectable knowledge map and folder-level MOC', async () => {
    renderReadyKnowledge();

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    const projects = await within(map).findByRole('button', {
      name: /projects.*1 条笔记/u,
    });
    fireEvent.click(projects);

    const moc = await screen.findByTestId('knowledge-folder-moc');
    expect(moc).toHaveAttribute('data-folder-path', 'projects');
    expect(within(moc).getByRole('heading', { name: 'projects 知识 MOC' }))
      .toBeInTheDocument();
    expect(within(moc).getByTestId('folder-wiki-overview')).toBeInTheDocument();
    expect(within(moc).getByTestId('folder-reading-path')).toBeInTheDocument();
    expect(within(moc).getByTestId('folder-topics')).toBeInTheDocument();
    expect(within(moc).getByTestId('folder-recent-changes')).toBeInTheDocument();
    expect(within(moc).getByTestId('folder-wiki-sources')).toHaveTextContent(
      'projects/copilot-html-first',
    );
    expect(within(moc).getByTestId('folder-wiki-truth')).toHaveTextContent(
      'PROTOTYPE_DERIVED',
    );
  });

  it('switches folder context without fabricating folder runtime truth', async () => {
    renderReadyKnowledge();

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(await within(map).findByRole('button', { name: /inbox.*1 条笔记/u }));

    const moc = await screen.findByTestId('knowledge-folder-moc');
    expect(moc).toHaveAttribute('data-folder-path', 'inbox');
    expect(
      within(moc).getByTestId('moc-topic-note-inbox/mvp-acceptance'),
    ).toHaveTextContent('MVP 验收清单');
    expect(within(moc).queryByText('HTML-first 交付记录')).not.toBeInTheDocument();
    expect(within(moc).getByText(/Browser fixture.*不代表文件夹 runtime/u))
      .toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后'))
      .toHaveAttribute('aria-disabled', 'true');
  });

  it('opens digest-bound Markdown and safe HTML in a full-page reader and restores MOC', async () => {
    renderReadyKnowledge();

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(await within(map).findByRole('button', { name: /projects.*1 条笔记/u }));
    fireEvent.click(
      await screen.findByTestId('moc-topic-note-projects/copilot-html-first'),
    );

    const markdownReader = await screen.findByTestId('knowledge-document-reader');
    expect(markdownReader).toHaveAttribute(
      'data-document-path',
      'projects/copilot-html-first',
    );
    await waitFor(() => {
      expect(within(markdownReader).getByTestId('markdown-renderer')).toHaveTextContent(
        '同源 renderer、显式 fixture 边界、浏览器操作验收。',
      );
    });
    expect(within(markdownReader).getByRole('button', { name: /返回 projects MOC/u }))
      .toBeInTheDocument();

    fireEvent.click(within(markdownReader).getByRole('button', {
      name: /返回 projects MOC/u,
    }));
    expect(await screen.findByTestId('knowledge-folder-moc')).toHaveAttribute(
      'data-folder-path',
      'projects',
    );

    fireEvent.click(await within(map).findByRole('button', { name: /inbox.*1 条笔记/u }));
    fireEvent.click(await screen.findByTestId('moc-topic-note-inbox/mvp-acceptance'));

    const htmlReader = await screen.findByTestId('knowledge-document-reader');
    await waitFor(() => {
      expect(within(htmlReader).getByTestId('safe-html-preview')).toHaveTextContent(
        '先验证今天与知识主旅程，再进入 Electron 运行门。',
      );
    });
    expect(within(htmlReader).queryByText('window.__R44_UNSAFE_HTML_EXECUTED__'))
      .not.toBeInTheDocument();
    expect(
      (window as Window & { __R44_UNSAFE_HTML_EXECUTED__?: boolean })
        .__R44_UNSAFE_HTML_EXECUTED__,
    ).toBeUndefined();
  });

  it('keeps non-current notes out of the full-page organized reader', async () => {
    renderReadyKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), {
      target: { value: '待整理资料' },
    });
    fireEvent.change(screen.getByLabelText('笔记路径'), {
      target: { value: 'inbox/pending-wiki.md' },
    });
    fireEvent.change(screen.getByLabelText('笔记正文'), {
      target: { value: 'RAW_PENDING_CONTENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-organized-preview-gated')).toHaveAttribute(
        'data-wiki-state',
        'not-ready',
      );
    });
    expect(screen.queryByTestId('knowledge-document-reader')).not.toBeInTheDocument();
    expect(screen.queryByText('RAW_PENDING_CONTENT')).not.toBeInTheDocument();
  });

  it('removes the page-local assistant and marks the knowledge journey as critical', async () => {
    renderReadyKnowledge();

    expect(await screen.findByTestId('knowledge-workspace')).toHaveAttribute(
      'data-assistant-avoid',
      'critical',
    );
    expect(screen.queryByTestId('knowledge-context-ai')).not.toBeInTheDocument();
    expect(screen.queryByText('知识 AI 助手')).not.toBeInTheDocument();
  });
});
