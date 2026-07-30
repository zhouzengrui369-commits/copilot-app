import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AskConversationSaveRequest,
  AskConversationSnapshot,
  TodoRecord,
} from '../src/shared/domain-api.js';
import type {
  CopilotNoteInput,
  CopilotNoteSummary,
  CopilotProductApi,
  CopilotRagAnswer,
  CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

const FROZEN_NOW = 1_753_000_000_000;
const NOTE_PATH = 'notes/source.md';

function snapshot(request: AskConversationSaveRequest): AskConversationSnapshot {
  return { ...request, schemaVersion: 1, sourceTruth: 'current' };
}

function baseApi(overrides: {
  notes?: Partial<CopilotProductApi['notes']>;
  todos?: Partial<CopilotProductApi['todos']>;
  rag?: Partial<CopilotProductApi['rag']>;
  askConversation?: CopilotProductApi['askConversation'];
} = {}): CopilotProductApi {
  const api: CopilotProductApi = {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async (input: CopilotNoteInput) => ({
        ...input,
        type: input.type ?? 'note',
        status: input.status ?? 'active',
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({})),
    },
    rag: {
      ask: vi.fn(async () => ({ text: '', sources: [] })),
    },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async (): Promise<CopilotTodo> => ({
        id: 'todo-1',
        title: '',
        status: 'pending',
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
  return {
    ...api,
    notes: { ...api.notes, ...overrides.notes },
    todos: { ...api.todos, ...overrides.todos },
    rag: { ...api.rag, ...overrides.rag },
    ...(overrides.askConversation ? { askConversation: overrides.askConversation } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AskWorkspace final critical callbacks', () => {
  it('edits and cancels the composer, then persists and opens one canonical Todo', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
    const answer: CopilotRagAnswer = {
      text: 'Grounded answer',
      sources: [NOTE_PATH],
      sourceDetails: [{ notePath: NOTE_PATH, evidence: ['vector'], score: 0.98 }],
    };
    let canonicalTodo: CopilotTodo | null = null;
    const create = vi.fn(async (input: Parameters<CopilotProductApi['todos']['create']>[0]) => {
      canonicalTodo = {
        id: 'todo-1',
        title: input.title,
        body: input.body ?? '',
        status: 'pending',
        dueAt: input.dueAt ?? null,
        remindAt: input.remindAt ?? null,
        linkedNotePaths: [...(input.linkedNotePaths ?? [])],
      };
      return canonicalTodo;
    });
    const list = vi.fn(async () => canonicalTodo ? [canonicalTodo] : []);
    const save = vi.fn(async (request: AskConversationSaveRequest) => snapshot(request));
    const onOpenTodo = vi.fn();
    const api = baseApi({
      notes: {
        get: vi.fn(async (path: string) => path === NOTE_PATH
          ? { path: NOTE_PATH, title: 'Source', body: 'local source body', tags: [] }
          : null),
      },
      rag: { ask: vi.fn(async () => answer) },
      todos: { create, list },
      askConversation: {
        load: vi.fn(async () => null),
        save,
        clear: vi.fn(async () => undefined),
      },
    });

    render(<AskWorkspace api={api} onOpenTodo={onOpenTodo} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'Original question' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('Grounded answer');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());

    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.change(screen.getByLabelText('待办标题'), { target: { value: 'Discarded title' } });
    fireEvent.change(screen.getByLabelText('待办截止时间'), {
      target: { value: '2026-08-01T09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('确认待办')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.change(screen.getByLabelText('待办标题'), { target: { value: 'Persisted title' } });
    fireEvent.change(screen.getByLabelText('待办截止时间'), {
      target: { value: '2026-08-02T10:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));

    expect(await screen.findByTestId('ask-todo-success')).toHaveTextContent('Persisted title');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Persisted title',
      body: 'Grounded answer',
      dueAt: expect.any(Number),
      remindAt: expect.any(Number),
      linkedNotePaths: [NOTE_PATH],
    }));
    const persisted = save.mock.calls.at(-1)?.[0].todoReceipt as TodoRecord | null;
    expect(persisted).toMatchObject({
      id: 'todo-1',
      title: 'Persisted title',
      body: 'Grounded answer',
      note_links: [NOTE_PATH],
      created_at: FROZEN_NOW,
      updated_at: FROZEN_NOW,
    });

    fireEvent.click(screen.getByRole('button', { name: '查看待办' }));
    expect(onOpenTodo).toHaveBeenCalledWith('todo-1');
  });

  it('truncates long local previews and reports non-Error Todo failures deterministically', async () => {
    const longBody = `LONG_PREVIEW_${'x'.repeat(400)}`;
    const api = baseApi({
      notes: {
        get: vi.fn(async () => ({
          path: NOTE_PATH,
          title: 'Long source',
          body: longBody,
          tags: ['local'],
        })),
      },
      rag: {
        ask: vi.fn(async () => ({
          text: 'Grounded long-preview answer',
          sources: [NOTE_PATH],
          sourceDetails: [{ notePath: NOTE_PATH, evidence: ['vector'], score: 0.99 }],
        })),
      },
      todos: {
        create: vi.fn(async (): Promise<CopilotTodo> => Promise.reject('STRING_CREATE_FAILURE')),
      },
    });

    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'Long preview question' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    await waitFor(() => expect(screen.getByTestId('answer-source-truth'))
      .toHaveAttribute('data-truth-state', 'LOCAL_PRESENT'));
    const preview = screen.getByText(/^预览：LONG_PREVIEW_/u);
    expect(preview.textContent).toMatch(/…$/u);
    expect(preview.textContent?.length).toBeLessThan(longBody.length);

    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ask-create-todo'));
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '待办未创建：STRING_CREATE_FAILURE',
    );
  });
});

describe('ScheduleWorkspace final critical callbacks', () => {
  it('opens calendar knowledge, note sources, and controlled immersive capture callbacks', async () => {
    const note: CopilotNoteSummary = {
      path: NOTE_PATH,
      title: 'Source',
      tags: ['local'],
      updatedAt: Date.now(),
    };
    const todo: CopilotTodo = {
      id: 'todo-1',
      title: 'Inspect source',
      body: 'body',
      status: 'pending',
      dueAt: Date.now(),
      remindAt: null,
      linkedNotePaths: [NOTE_PATH],
    };
    const api = baseApi({
      notes: { list: vi.fn(async () => [note]) },
      todos: { list: vi.fn(async () => [todo]) },
    });
    const onOpenNote = vi.fn();
    const onOpenKnowledge = vi.fn();
    const scrollIntoView = vi.fn();
    const onCaptureDraftChange = vi.fn();

    function Harness() {
      const [draft, setDraft] = useState('initial draft');
      return (
        <ScheduleWorkspace
          api={api}
          requestedTodoId="todo-1"
          onOpenNote={onOpenNote}
          onOpenKnowledge={onOpenKnowledge}
          captureDraft={draft}
          onCaptureDraftChange={(value) => {
            onCaptureDraftChange(value);
            setDraft(value);
          }}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    const captureCard = screen.getByTestId('today-capture-card');
    Object.defineProperty(captureCard, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(screen.getByRole('button', { name: '快速记录' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    fireEvent.click(screen.getByRole('button', { name: '打开知识 MOC' }));
    expect(onOpenKnowledge).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
    fireEvent.click(screen.getAllByRole('button', { name: '打开笔记 Source' })[0]!);
    expect(onOpenNote).toHaveBeenCalledWith(NOTE_PATH);

    fireEvent.click(screen.getByRole('button', { name: `打开来源：${NOTE_PATH}` }));
    expect(onOpenNote).toHaveBeenCalledWith(NOTE_PATH);

    fireEvent.change(screen.getByLabelText('快速记录草稿'), {
      target: { value: 'inline changed' },
    });
    expect(onCaptureDraftChange).toHaveBeenCalledWith('inline changed');
    fireEvent.click(screen.getByRole('button', { name: '展开编辑' }));
    await screen.findByRole('dialog', { name: '沉浸式快速记录' });
    fireEvent.change(screen.getByLabelText('沉浸式快速记录草稿'), {
      target: { value: 'immersive changed' },
    });
    expect(onCaptureDraftChange).toHaveBeenCalledWith('immersive changed');

    fireEvent.click(screen.getByRole('button', { name: '取消沉浸式草稿' }));
    expect(screen.queryByRole('dialog', { name: '沉浸式快速记录' })).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: '放弃本地草稿？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await screen.findByRole('dialog', { name: '沉浸式快速记录' });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '沉浸式快速记录' })).not.toBeInTheDocument();
  });
});
