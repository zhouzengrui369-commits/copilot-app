// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AskConversationSaveRequest,
  AskConversationSnapshot,
} from '../src/shared/domain-api.js';
import type {
  CopilotProductApi,
  CopilotRagAnswer,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

function api(snapshot: AskConversationSnapshot | null): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => [{
        path: 'notes/source.md', title: 'Source', tags: [], updatedAt: 10,
      }]),
      get: vi.fn(async () => ({
        note: { path: 'notes/source.md', title: 'Source', tags: [], updatedAt: 10 },
        body: 'exact source bytes',
      })),
      create: vi.fn(async (input) => ({ ...input })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => null),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({ ...input, id: 'todo-1', status: 'pending' as const })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
    askConversation: {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async (request) => ({ ...snapshot!, ...request })),
      clear: vi.fn(async () => undefined),
    },
  };
}

const current: AskConversationSnapshot = {
  schemaVersion: 1,
  exchangeId: 'exchange-1',
  phase: 'completed',
  question: '本地问题',
  answer: {
    text: '本地回答',
    sources: ['notes/source.md'],
    sourceDetails: [{
      notePath: 'notes/source.md',
      evidence: ['vector'],
      score: 0.9,
    }],
  },
  todoReceipt: null,
  completedAt: 20,
  sourceTruth: 'current',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ask source back continuity', () => {
  it('restores the latest exchange and opens the exact source with an origin token', async () => {
    const onOpenSource = vi.fn();
    render(<AskWorkspace api={api(current)} onOpenSource={onOpenSource} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    expect(screen.getAllByText('本地问题').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('LOCAL_PRESENT')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'notes/source.md' }));
    expect(onOpenSource).toHaveBeenCalledWith({
      exchangeId: 'exchange-1',
      intent: 'full-reader',
      notePath: 'notes/source.md',
    });
  });

  it('opens the requested source in the full reader and only offers matching return', async () => {
    const onReturnToAsk = vi.fn();
    render(
      <KnowledgeWorkspace
        api={api(current)}
        requestedPath="notes/source.md"
        sourceOrigin={{
          exchangeId: 'exchange-1',
          intent: 'full-reader',
          notePath: 'notes/source.md',
        }}
        onReturnToAsk={onReturnToAsk}
      />,
    );
    expect(await screen.findByTestId('knowledge-document-reader')).toHaveAttribute(
      'data-document-path',
      'notes/source.md',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回本轮回答' }));
    expect(onReturnToAsk).toHaveBeenCalledWith('exchange-1');
  });

  it('downgrades stale restore and does not expose completed source or Todo actions', async () => {
    render(<AskWorkspace api={api({
      ...current,
      sourceTruth: 'stale',
      todoReceipt: null,
    })} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    expect(screen.getByTestId('answer-source-truth')).toHaveAttribute('data-truth-state', 'STALE');
    expect(screen.getByTestId('ask-create-todo')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'notes/source.md' })).toBeDisabled();
  });

  it('withholds Todo success and View Todo until the matching current conversation receipt is saved', async () => {
    const pending = deferred<AskConversationSnapshot>();
    const testApi = api(current);
    let saveRequest: AskConversationSaveRequest | null = null;
    testApi.todos.create = vi.fn(async (input) => ({
      ...input,
      id: 'todo-1',
      status: 'pending' as const,
    }));
    testApi.todos.list = vi.fn(async () => [{
      id: 'todo-1',
      title: '本地问题',
      body: '本地回答',
      status: 'pending' as const,
      dueAt: null,
      remindAt: null,
      linkedNotePaths: ['notes/source.md'],
    }]);
    testApi.askConversation!.save = vi.fn((request) => {
      saveRequest = request;
      return pending.promise;
    });

    render(<AskWorkspace api={testApi} onOpenTodo={vi.fn()} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));
    await waitFor(() => expect(testApi.askConversation!.save).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看待办' })).not.toBeInTheDocument();

    const request = requireCapturedRequest(saveRequest);
    pending.resolve({
      schemaVersion: 1,
      ...request,
      todoReceipt: request.todoReceipt,
      sourceTruth: 'current',
    });
    expect(await screen.findByTestId('ask-todo-success')).toHaveTextContent('本地问题');
    expect(screen.getByRole('button', { name: '查看待办' })).toBeEnabled();
  });

  it('keeps Todo success absent and reports truthfully when conversation receipt save rejects', async () => {
    const pending = deferred<AskConversationSnapshot>();
    const testApi = api(current);
    testApi.todos.create = vi.fn(async (input) => ({
      ...input,
      id: 'todo-1',
      status: 'pending' as const,
    }));
    testApi.todos.list = vi.fn(async () => [{
      id: 'todo-1',
      title: '本地问题',
      body: '本地回答',
      status: 'pending' as const,
      dueAt: null,
      remindAt: null,
      linkedNotePaths: ['notes/source.md'],
    }]);
    testApi.askConversation!.save = vi.fn(() => pending.promise);

    render(<AskWorkspace api={testApi} onOpenTodo={vi.fn()} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));
    await waitFor(() => expect(testApi.askConversation!.save).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    pending.reject(new Error('store rejected'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '待办已创建，但会话回执未能安全持久化。',
    );
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看待办' })).not.toBeInTheDocument();
  });

  it('never exposes Todo success when the conversation bridge disappears', async () => {
    const testApi = api(current);
    testApi.todos.create = vi.fn(async (input) => ({
      ...input,
      id: 'todo-1',
      status: 'pending' as const,
    }));
    testApi.todos.list = vi.fn(async () => [{
      id: 'todo-1',
      title: '本地问题',
      body: '本地回答',
      status: 'pending' as const,
      dueAt: null,
      remindAt: null,
      linkedNotePaths: ['notes/source.md'],
    }]);

    render(<AskWorkspace api={testApi} onOpenTodo={vi.fn()} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    testApi.askConversation = undefined;
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '待办已创建，但会话回执未能安全持久化。',
    );
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看待办' })).not.toBeInTheDocument();
  });

  it('never republishes an old Todo receipt when its save resolves after a new conversation', async () => {
    const pending = deferred<AskConversationSnapshot>();
    const testApi = api(current);
    let saveRequest: AskConversationSaveRequest | null = null;
    testApi.rag.ask = vi.fn(async () => ({
      text: '新回答',
      sources: ['notes/source.md'],
      sourceDetails: [{
        notePath: 'notes/source.md',
        evidence: ['vector' as const],
        score: 0.8,
      }],
    }));
    testApi.todos.create = vi.fn(async (input) => ({
      ...input,
      id: 'todo-1',
      status: 'pending' as const,
    }));
    testApi.todos.list = vi.fn(async () => [{
      id: 'todo-1',
      title: '本地问题',
      body: '本地回答',
      status: 'pending' as const,
      dueAt: null,
      remindAt: null,
      linkedNotePaths: ['notes/source.md'],
    }]);
    testApi.askConversation!.save = vi.fn(async (request) => {
      if (request.todoReceipt) {
        saveRequest = request;
        return pending.promise;
      }
      return {
        schemaVersion: 1,
        ...request,
        sourceTruth: 'current' as const,
      };
    });

    render(<AskWorkspace api={testApi} onOpenTodo={vi.fn()} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));
    await waitFor(() => expect(testApi.askConversation!.save).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await waitFor(() => expect(testApi.askConversation!.clear).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '新问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('新回答')).toBeInTheDocument();

    await act(async () => {
      const request = requireCapturedRequest(saveRequest);
      pending.resolve({
        schemaVersion: 1,
        ...request,
        todoReceipt: request.todoReceipt,
        sourceTruth: 'current',
      });
      await pending.promise;
    });

    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看待办' })).not.toBeInTheDocument();
  });

  it('keeps the new answer actionable when an old Todo save rejects late', async () => {
    const pending = deferred<AskConversationSnapshot>();
    const testApi = api(current);
    testApi.rag.ask = vi.fn(async () => ({
      text: '拒绝后的新回答',
      sources: ['notes/source.md'],
      sourceDetails: [{
        notePath: 'notes/source.md',
        evidence: ['vector' as const],
        score: 0.8,
      }],
    }));
    testApi.todos.create = vi.fn(async (input) => ({
      ...input,
      id: 'todo-1',
      status: 'pending' as const,
    }));
    testApi.todos.list = vi.fn(async () => [{
      id: 'todo-1',
      title: '本地问题',
      body: '本地回答',
      status: 'pending' as const,
      dueAt: null,
      remindAt: null,
      linkedNotePaths: ['notes/source.md'],
    }]);
    testApi.askConversation!.save = vi.fn((request) => {
      if (request.todoReceipt) return pending.promise;
      return Promise.resolve({
        schemaVersion: 1,
        ...request,
        sourceTruth: 'current' as const,
      });
    });

    render(<AskWorkspace api={testApi} onOpenTodo={vi.fn()} />);
    expect(await screen.findByText('本地回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));
    await waitFor(() => expect(testApi.askConversation!.save).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await waitFor(() => expect(testApi.askConversation!.clear).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '拒绝后的新问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('拒绝后的新回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '转为待办' })).toBeEnabled());

    await act(async () => {
      pending.reject(new Error('old conversation store rejected'));
      await pending.promise.catch(() => undefined);
    });

    expect(screen.getByText('拒绝后的新回答')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-todo-success')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看待办' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '转为待办' })).toBeEnabled();
  });

  it('sets completedAt only after the final terminal answer exists', async () => {
    const final = deferred<CopilotRagAnswer>();
    const testApi = api(null);
    const terminalAnswer: CopilotRagAnswer = {
      text: '终态回答',
      sources: ['notes/source.md'],
      sourceDetails: [{
        notePath: 'notes/source.md',
        evidence: ['vector'],
        score: 0.9,
      }],
    };
    testApi.rag.stream = vi.fn(() => ({
      requestId: 'terminal-time-request',
      done: final.promise,
      cancel: vi.fn(async () => undefined),
    }));
    testApi.askConversation!.save = vi.fn(async (request) => ({
      schemaVersion: 1,
      ...request,
      sourceTruth: 'current',
    }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);

    render(<AskWorkspace api={testApi} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '终态时间问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await waitFor(() => expect(testApi.rag.stream).toHaveBeenCalledTimes(1));
    expect(testApi.askConversation!.save).not.toHaveBeenCalled();

    now.mockReturnValue(200);
    final.resolve(terminalAnswer);
    await waitFor(() => expect(testApi.askConversation!.save).toHaveBeenCalledTimes(1));
    expect(testApi.askConversation!.save).toHaveBeenCalledWith(
      expect.objectContaining({ completedAt: 200 }),
    );
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requireCapturedRequest(
  request: AskConversationSaveRequest | null,
): AskConversationSaveRequest {
  if (!request) throw new Error('save request not captured');
  return request;
}
