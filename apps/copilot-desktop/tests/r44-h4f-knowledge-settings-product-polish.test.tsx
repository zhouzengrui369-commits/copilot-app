import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/renderer/components/Settings/index.js';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="h4f-excluded-graph" />,
}));

afterEach(() => {
  window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
  window.history.replaceState(null, '', '/');
});

function renderReadyKnowledge() {
  window.history.replaceState(null, '', '/?prototype=ready#knowledge');
  const api = installBrowserPrototype().api;
  return render(<KnowledgeWorkspace api={api} />);
}

describe('R44 H4F Knowledge and Settings product polish', () => {
  it('presents 2D as a folder MOC and explains folder-level WIKI value', async () => {
    renderReadyKnowledge();

    expect(await screen.findByRole('tree', { name: '知识文件夹目录' }))
      .toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后'))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();

    const wikiValue = screen.getByTestId('folder-wiki-value');
    expect(wikiValue).toHaveTextContent('文件夹/工作区');
    expect(wikiValue).toHaveTextContent('总览、阅读路径、主题分类、最近变化和可核对来源');
    expect(wikiValue).toHaveTextContent('不替代原始文档');

    const folderTree = screen.getByRole('tree', { name: '知识文件夹目录' });
    fireEvent.click(
      within(folderTree).getByRole('button', { name: /projects.*1 条笔记/u }),
    );
    fireEvent.click(
      within(folderTree).getByRole('button', {
        name: /HTML-first 交付记录.*copilot-html-first/u,
      }),
    );
    const summary = await screen.findByLabelText('笔记详情');
    expect(summary).toHaveTextContent('当前文档摘要');
    expect(summary).toHaveTextContent('来自文件夹 WIKI');
    const topic = await screen.findByRole('button', { name: '选择主题 copilot' });
    fireEvent.click(topic);
    expect(topic).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('moc-topic-note-projects/copilot-html-first'))
      .toBeInTheDocument();
  });

  it('opens a complete raw Markdown document when WIKI is not ready and restores MOC', async () => {
    renderReadyKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), {
      target: { value: 'H4F 原文阅读' },
    });
    fireEvent.change(screen.getByLabelText('笔记路径'), {
      target: { value: 'inbox/h4f-raw-not-ready.md' },
    });
    fireEvent.change(screen.getByLabelText('笔记正文'), {
      target: { value: '# H4F 原文阅读\n\n第一节\n\nH4F_RAW_TAIL_9C31' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-organized-preview-gated')).toHaveAttribute(
        'data-wiki-state',
        'not-ready',
      );
    });
    const retainedKnowledgeMap = screen.getByRole('navigation', {
      name: '知识地图',
    });
    const retainedSummary = screen.getByLabelText('笔记详情');
    fireEvent.click(
      await screen.findByTestId('moc-topic-note-inbox/h4f-raw-not-ready.md'),
    );

    const reader = await screen.findByTestId('knowledge-document-reader');
    expect(reader).toHaveAttribute('data-wiki-state', 'not-ready');
    expect(reader.closest('[data-reader-layout]')).toHaveAttribute(
      'data-reader-layout',
      'full-span',
    );
    expect(retainedKnowledgeMap).toBeInTheDocument();
    expect(retainedKnowledgeMap).not.toBeVisible();
    expect(retainedKnowledgeMap).toHaveAttribute('hidden');
    expect(retainedKnowledgeMap).toHaveAttribute('aria-hidden', 'true');
    expect(retainedSummary).toBeInTheDocument();
    expect(retainedSummary).not.toBeVisible();
    expect(retainedSummary).toHaveAttribute('hidden');
    expect(retainedSummary).toHaveAttribute('aria-hidden', 'true');
    expect(within(reader).getByText('完整原始文档')).toBeInTheDocument();
    expect(within(reader).getByText('WIKI NOT_READY')).toBeInTheDocument();
    expect(await within(reader).findByTestId('markdown-renderer'))
      .toHaveTextContent('H4F_RAW_TAIL_9C31');
    fireEvent.click(within(reader).getByRole('button', { name: /返回 inbox MOC/u }));
    expect(await screen.findByTestId('knowledge-folder-moc'))
      .toHaveAttribute('data-folder-path', 'inbox');
    expect(retainedKnowledgeMap).toBeVisible();
    expect(retainedSummary).toBeVisible();
  });

  it('gives a CURRENT document the full knowledge content span and restores MOC', async () => {
    renderReadyKnowledge();

    const retainedKnowledgeMap = await screen.findByRole('navigation', {
      name: '知识地图',
    });
    const folderTree = within(retainedKnowledgeMap).getByRole('tree', {
      name: '知识文件夹目录',
    });
    fireEvent.click(
      within(folderTree).getByRole('button', { name: /projects.*1 条笔记/u }),
    );
    fireEvent.click(
      within(folderTree).getByRole('button', {
        name: /HTML-first 交付记录.*copilot-html-first/u,
      }),
    );
    const retainedSummary = await screen.findByLabelText('笔记详情');
    fireEvent.click(await screen.findByRole('button', { name: '全页阅读' }));

    const reader = await screen.findByTestId('knowledge-document-reader');
    await waitFor(() => {
      expect(reader).toHaveAttribute('data-wiki-state', 'current');
    });
    expect(reader.closest('[data-reader-layout]')).toHaveAttribute(
      'data-reader-layout',
      'full-span',
    );
    expect(retainedKnowledgeMap).toBeInTheDocument();
    expect(retainedKnowledgeMap).not.toBeVisible();
    expect(retainedSummary).toBeInTheDocument();
    expect(retainedSummary).not.toBeVisible();

    fireEvent.click(
      within(reader).getByRole('button', { name: /返回 projects MOC/u }),
    );
    expect(retainedKnowledgeMap).toBeVisible();
    expect(retainedSummary).toBeVisible();
    expect(retainedSummary).toHaveTextContent('当前文档摘要');
    fireEvent.click(
      within(retainedKnowledgeMap).getByRole('button', { name: /inbox.*1 条笔记/u }),
    );
    expect(await screen.findByTestId('knowledge-folder-moc'))
      .toHaveAttribute('data-folder-path', 'inbox');
  });

  it('renders a Desktop-only credential boundary without browser credential status', async () => {
    window.history.replaceState(null, '', '/?prototype=ready#settings');
    window.__COPILOT_BROWSER_PROTOTYPE__ = {
      api: installBrowserPrototype().api,
      scenario: 'ready',
      label: 'PROTOTYPE / NOT_RUNTIME_PROOF',
    };

    render(<SettingsPanel hideReset />);

    const panel = await screen.findByTestId('settings-panel');
    expect(screen.getByTestId('settings-browser-environment')).toHaveTextContent(
      '浏览器原型 · 未连接桌面凭据服务',
    );
    expect(screen.getByTestId('model-credential-browser-boundary')).toHaveTextContent(
      'API 凭据仅在 Electron 桌面 App 安全配置',
    );
    expect(panel).not.toHaveTextContent('凭据状态以字段为准');
    expect(panel).not.toHaveTextContent(/configured/iu);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByTestId('model-api-key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-credential-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-credential-clear')).not.toBeInTheDocument();
    expect(screen.getByTestId('model-restart-hint')).toHaveTextContent(
      '页面内存预览',
    );
  });
});
