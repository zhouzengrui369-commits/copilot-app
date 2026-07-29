import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CopilotNoteSummary,
  CopilotProductApi,
  CopilotRagAnswer,
  CopilotRagStreamHandle,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';

function makeApi(overrides: {
  ask?: CopilotProductApi['rag']['ask'];
  stream?: CopilotProductApi['rag']['stream'];
  get?: CopilotProductApi['notes']['get'];
} = {}): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => []),
      get: overrides.get ?? vi.fn(async () => null),
      create: vi.fn(async (input) => ({ ...input, body: input.body })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => null),
    },
    rag: {
      ask: overrides.ask ?? vi.fn(async () => ({ text: '', sources: [] })),
      stream: overrides.stream,
    },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({ ...input, id: 'todo-1', status: 'pending' })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Ask Demo direct-source adoption R1', () => {
  it('uses the Demo conversation structure with a truthful local empty state', () => {
    render(<AskWorkspace api={makeApi()} />);

    for (const className of [
      'chat-grid',
      'chat-history',
      'history-list',
      'history-item',
      'chat-main',
      'chat-main-head',
      'chat-thread',
      'followups',
      'chat-compose',
      'chat-evidence',
    ]) {
      expect(document.querySelector(`.${className}`)).not.toBeNull();
    }

    expect(screen.getByRole('heading', { name: '对话' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '历史对话' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本轮 Sources' })).toBeInTheDocument();
    expect(screen.getByTestId('ask-empty-truth')).toHaveTextContent('NOT_PROBED');
    expect(screen.getByTestId('ask-empty-truth')).toHaveTextContent('NO_SOURCE');
    expect(screen.getByTestId('answer-source-truth')).toHaveAttribute('data-truth-state', 'NOT_PROBED');
    expect(screen.getByLabelText('问题')).toHaveAttribute('placeholder', '围绕当前对话继续详细提问……');
    expect(screen.getByRole('button', { name: '提问' })).toHaveTextContent('发送');
    expect(screen.getByRole('button', { name: '列出 MOC 验收标准' })).toBeInTheDocument();
    expect(screen.queryByText(/DEMO FIXTURE|SIMULATED/u)).not.toBeInTheDocument();
    expect(document.querySelector('.badge.ok')).toBeNull();
  });

  it('keeps real ask, LOCAL_PRESENT source navigation, and copy diagnostics', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const ask = vi.fn(async (): Promise<CopilotRagAnswer> => ({
      text: '本地知识回答',
      sources: ['notes/local-source.md'],
      sourceDetails: [{
        notePath: 'notes/local-source.md',
        evidence: ['vector'],
        score: 0.92,
      }],
    }));
    const get = vi.fn(
      async (): Promise<{ note: CopilotNoteSummary; body: string }> => ({
        note: {
          path: 'notes/local-source.md',
          title: '本地来源',
          type: 'note',
          status: 'active',
          tags: ['local'],
          updatedAt: 2,
        } satisfies CopilotNoteSummary,
        body: '可核对的本地 source preview',
      }),
    );
    const onOpenSource = vi.fn();
    render(<AskWorkspace api={makeApi({ ask, stream: undefined, get })} onOpenSource={onOpenSource} />);

    fireEvent.change(screen.getByLabelText('问题'), { target: { value: ' 核对来源 ' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('本地知识回答');
    expect(ask).toHaveBeenCalledWith('核对来源');
    expect(await screen.findByText('LOCAL_PRESENT')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('notes/local-source.md');
    expect(screen.getByTestId('answer-source-truth')).toHaveAttribute('data-truth-state', 'LOCAL_PRESENT');

    fireEvent.click(screen.getByRole('button', { name: 'notes/local-source.md' }));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'full-reader',
      notePath: 'notes/local-source.md',
    }));

    fireEvent.click(screen.getByRole('button', { name: '复制来源诊断' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'notes/local-source.md: LOCAL_PRESENT / SOURCE_LOCAL_PRESENT',
    ));
  });

  it('keeps streaming cancellation terminal and does not replace it with fixture state', async () => {
    const done = deferred<CopilotRagAnswer>();
    const cancel = vi.fn(async () => undefined);
    const stream = vi.fn((): CopilotRagStreamHandle => ({
      requestId: 'ask-demo-r1',
      done: done.promise,
      cancel,
    }));
    const view = render(<AskWorkspace api={makeApi({ stream })} />);

    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '流式问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('正在检索本地知识并生成回答…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByText('已取消本次问答')).toBeInTheDocument();
    expect(screen.getByText('RAG_REQUEST_CANCELLED')).toBeInTheDocument();
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/DEMO FIXTURE|SIMULATED/u)).not.toBeInTheDocument();

    view.unmount();
    await act(async () => {
      done.resolve({ text: 'late fixture-like answer', sources: [] });
      await Promise.resolve();
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
