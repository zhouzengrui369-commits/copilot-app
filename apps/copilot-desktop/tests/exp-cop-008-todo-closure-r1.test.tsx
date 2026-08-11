import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CopilotProductApi,
  CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import type { AskConversationSnapshot } from '../src/shared/domain-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: () => <span>LOCAL ASR · NOT_READY</span>,
}));

function makeStatefulApi(initial: CopilotTodo[] = []): {
  api: CopilotProductApi;
  state: CopilotTodo[];
} {
  const state = [...initial];
  let sequence = 1;
  let latestConversation: AskConversationSnapshot | null = null;
  const api: CopilotProductApi = {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async (path) => ({
        path,
        title: '本地来源',
        body: '可核对的本地正文',
        tags: ['local'],
      })),
      create: vi.fn(async (input) => ({ ...input, localState: 'LOCAL_SAVED' as const })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => null),
    },
    rag: {
      ask: vi.fn(async () => ({
        text: '必须保留的最终回答',
        sources: ['notes/source-a.md', 'notes/source-b.md'],
        sourceDetails: [
          {
            notePath: 'notes/source-a.md',
            evidence: ['vector' as const],
            score: 0.98,
          },
          {
            notePath: 'notes/source-b.md',
            evidence: ['kg-entity' as const],
            score: 0.93,
          },
        ],
      })),
    },
    todos: {
      list: vi.fn(async () => [...state]),
      create: vi.fn(async (input) => {
        const todo: CopilotTodo = {
          ...input,
          id: `todo-${sequence++}`,
          status: 'pending',
        };
        state.push(todo);
        return todo;
      }),
      update: vi.fn(async (id, patch) => {
        const index = state.findIndex((todo) => String(todo.id) === String(id));
        if (index < 0) return null;
        state[index] = { ...state[index]!, ...patch };
        return state[index]!;
      }),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
    askConversation: {
      save: vi.fn(async (request) => {
        const snapshot: AskConversationSnapshot = {
          schemaVersion: 1,
          ...request,
          sourceTruth: 'current',
        };
        latestConversation = snapshot;
        return snapshot;
      }),
      load: vi.fn(async () => latestConversation),
      clear: vi.fn(async () => {
        latestConversation = null;
      }),
    },
  };
  return { api, state };
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

describe('EXP-COP-008 canonical Todo closure R1', () => {
  it('freezes one completed multi-source exchange, exposes View Todo, then persists edits', async () => {
    const { api, state } = makeStatefulApi();
    const openTodo = vi.fn();
    const openSource = vi.fn();
    const askView = render(
      <AskWorkspace api={api} onOpenTodo={openTodo} onOpenSource={openSource} />,
    );

    expect(screen.queryByTestId('ask-create-todo')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '需要行动的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('必须保留的最终回答');
    await waitFor(() => expect(screen.getByTestId('answer-source-truth'))
      .toHaveAttribute('data-truth-state', 'LOCAL_PRESENT'));
    fireEvent.click(screen.getByRole('button', { name: 'notes/source-a.md' }));
    expect(openSource).toHaveBeenCalledWith({
      exchangeId: expect.any(String),
      intent: 'full-reader',
      notePath: 'notes/source-a.md',
    });
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '尚未发送的后续草稿' } });
    const createAction = screen.getByTestId('ask-create-todo');
    expect(createAction).toBeEnabled();
    fireEvent.click(createAction);
    expect(screen.getByLabelText('待办标题')).toHaveValue('需要行动的问题');
    expect(screen.getByLabelText('待办截止时间')).toHaveValue('');
    expect(screen.getByTestId('todo-source-count')).toHaveTextContent('2 条来源');
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));

    expect(await screen.findByTestId('ask-todo-success')).toHaveTextContent('已保存并完成本地回读');
    expect(state[0]).toEqual(expect.objectContaining({
      title: '需要行动的问题',
      body: '必须保留的最终回答',
      dueAt: null,
      status: 'pending',
      linkedNotePaths: ['notes/source-a.md', 'notes/source-b.md'],
    }));
    fireEvent.click(screen.getByRole('button', { name: '查看待办' }));
    expect(openTodo).toHaveBeenCalledWith('todo-1');
    askView.unmount();

    render(<ScheduleWorkspace api={api} requestedTodoId="todo-1" />);
    expect(await screen.findByTestId('todo-card-todo-1')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByRole('button', { name: '未安排' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('todo-editor-todo-1')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });

    const titleInput = screen.getByLabelText('编辑待办标题 需要行动的问题');
    const bodyInput = screen.getByLabelText('编辑待办内容 需要行动的问题');
    const sourceInput = screen.getByLabelText('编辑待办来源 需要行动的问题');
    fireEvent.change(titleInput, {
      target: { value: '已编辑待办' },
    });
    fireEvent.change(bodyInput, {
      target: { value: '已编辑的回答正文' },
    });
    fireEvent.change(sourceInput, {
      target: { value: 'notes/source-a.md\nnotes/source-b.md' },
    });
    expect(titleInput).toHaveValue('已编辑待办');
    expect(bodyInput).toHaveValue('已编辑的回答正文');
    expect(sourceInput).toHaveValue('notes/source-a.md\nnotes/source-b.md');
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));

    expect(await screen.findByText('已保存并完成本地回读')).toBeInTheDocument();
    expect(state[0]).toEqual(expect.objectContaining({
      title: '已编辑待办',
      body: '已编辑的回答正文',
      dueAt: null,
      linkedNotePaths: ['notes/source-a.md', 'notes/source-b.md'],
    }));
  });

  it('keeps partial and cancelled streams ineligible even if a late final arrives', async () => {
    const { api } = makeStatefulApi();
    const final = deferred<{
      text: string;
      sources: string[];
      sourceDetails: Array<{ notePath: string; evidence: ['vector']; score: number }>;
    }>();
    let emit: ((event: {
      requestId: string;
      type: 'delta';
      delta: string;
      sources: Array<{ notePath: string; evidence: ['vector']; score: number }>;
    }) => void) | null = null;
    const cancel = vi.fn(async () => undefined);
    api.rag.stream = vi.fn((_question, listener) => {
      emit = listener;
      return {
        requestId: 'partial-request',
        done: final.promise,
        cancel,
      };
    });
    render(<AskWorkspace api={api} />);

    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '流式问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await waitFor(() => expect(api.rag.stream).toHaveBeenCalledTimes(1));
    act(() => emit?.({
      requestId: 'partial-request',
      type: 'delta',
      delta: '仅部分回答',
      sources: [{ notePath: 'notes/source-a.md', evidence: ['vector'], score: 0.9 }],
    }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('仅部分回答');
    expect(screen.getByTestId('ask-create-todo')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('ask-create-todo')).toBeDisabled();
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();

    await act(async () => {
      final.resolve({
        text: '迟到的最终回答',
        sources: ['notes/source-a.md'],
        sourceDetails: [{
          notePath: 'notes/source-a.md',
          evidence: ['vector'],
          score: 0.9,
        }],
      });
      await final.promise;
    });
    expect(screen.queryByText('迟到的最终回答')).not.toBeInTheDocument();
    expect(screen.getByTestId('ask-create-todo')).toBeDisabled();
  });

  it('blocks Todo creation for failed and zero-source answers', async () => {
    const failed = makeStatefulApi();
    failed.api.rag.ask = vi.fn(async () => {
      throw new Error('[OFFLINE] local provider unavailable');
    });
    const failureView = render(<AskWorkspace api={failed.api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '失败问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('RAG_OFFLINE');
    expect(screen.queryByTestId('ask-create-todo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    failureView.unmount();

    const zeroSource = makeStatefulApi();
    zeroSource.api.rag.ask = vi.fn(async () => ({
      text: '没有来源的回答',
      sources: [],
      sourceDetails: [],
    }));
    render(<AskWorkspace api={zeroSource.api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '无来源问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('没有来源的回答');
    expect(screen.getByTestId('ask-create-todo')).toBeDisabled();
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
  });
});
