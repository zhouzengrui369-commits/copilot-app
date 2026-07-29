import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="forbidden-legacy-graph" />,
}));

afterEach(() => {
  window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
});

describe('KnowledgeWorkspace · Phase 1 source navigation', () => {
  it('navigates from a real folder and MOC card to the digest-bound local document', async () => {
    window.history.replaceState(null, '', '?prototype=ready#knowledge');
    const api = installBrowserPrototype().api;
    render(<KnowledgeWorkspace api={api} />);

    const map = await screen.findByRole('navigation', { name: '知识地图' });
    fireEvent.click(within(map).getByRole('button', { name: /projects.*1 条笔记/u }));
    const source = await screen.findByTestId(
      'moc-topic-note-projects/copilot-html-first',
    );
    expect(source.closest('[data-document-format]')).toHaveAttribute(
      'data-document-format',
      'markdown',
    );
    fireEvent.click(source);

    const reader = await screen.findByTestId('knowledge-document-reader');
    expect(reader).toHaveAttribute(
      'data-document-path',
      'projects/copilot-html-first',
    );
    await waitFor(() => {
      expect(within(reader).getByTestId('markdown-renderer')).toHaveTextContent(
        '同源 renderer、显式 fixture 边界、浏览器操作验收。',
      );
    });
  });

  it('does not expose the retired test-only 2D graph source lane', async () => {
    window.history.replaceState(null, '', '?prototype=ready#knowledge');
    const api = installBrowserPrototype().api;
    render(<KnowledgeWorkspace api={api} />);

    expect(await screen.findByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: '2D 关系' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-graph-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-graph-sources')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forbidden-legacy-graph')).not.toBeInTheDocument();
    expect(screen.getByText('3D 节点可视化知识图谱 · MVP 后'))
      .toHaveAttribute('aria-disabled', 'true');
  });
});
