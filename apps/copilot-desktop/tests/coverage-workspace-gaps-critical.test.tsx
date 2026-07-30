import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AskConversationSaveRequest,
  AskConversationSnapshot,
  NoteRecord,
  TodoRecord,
} from '../src/shared/domain-api.js';
import type {
  CopilotProductApi,
  CopilotRagAnswer,
  CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

const ORIGINAL_CRYPTO = globalThis.crypto;
const FROZEN_NOW = 1_753_000_000_000;

const NOTE: NoteRecord = {
  id: 1,
  path: 'notes/source.md',
  title: 'Source',
  type: 'note',
  status: 'active',
  tags: ['local'],
  related: [],
  folder: 'notes',
  createdAt: 1,
  updatedAt: 2,
  confidence: null,
  agent: null,
};

const TODO: CopilotTodo = {
  id: 'todo-1',
  title: 'Question',
  body: 'answer',
  status: 'pending',
  dueAt: null,
  remindAt: null,
  linkedNotePaths: [NOTE.path],
};

type ApiOverrides = {
  notes?: Partial<CopilotProductApi['notes']>;
  kg?: Partial<CopilotProductApi['kg']>;
  rag?: Partial<CopilotProductApi['rag']>;
  todos?: Partial<CopilotProductApi['todos']>;
  askConversation?: CopilotProductApi['askConversation'];
};

function snapshot(request: AskConversationSaveRequest): AskConversationSnapshot {
  return {
    ...request,
    schemaVersion: 1,
    sourceTruth: 'current',
  };
}

function makeApi(overrides: ApiOverrides = {}): CopilotProductApi {
  const base: CopilotProductApi = {
    notes: {
      list: vi.fn(async () => [NOTE]),
      get: vi.fn(async (path) => path === NOTE.path ? { ...NOTE, body: 'local body' } : null),
      create: vi.fn(async (input) => ({ ...input, status: input.status ?? 'active', type: input.type ?? 'note' })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({})),
    },
    rag: {
      ask: vi.fn(async (): Promise<CopilotRagAnswer> => ({ text: '', sources: [] })),
    },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => TODO),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
  return {
    ...base,
    notes: { ...base.notes, ...overrides.notes },
    kg: { ...base.kg, ...overrides.kg },
    rag: { ...base.rag, ...overrides.rag },
    todos: { ...base.todos, ...overrides.todos },
    ...(overrides.askConversation ? { askConversation: overrides.askConversation } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: ORIGINAL_CRYPTO });
});

describe('AskWorkspace remaining critical branches', () => {
  it('uses the deterministic exchange id fallback and fails closed after a stale Todo persistence receipt', async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

    const answer: CopilotRagAnswer = {
      text: 'answer',
      sources: [NOTE.path],
      sourceDetails: [{ notePath: NOTE.path, evidence: ['vector'], score: 0.9 }],
    };
    const todoRecord: TodoRecord = {
      id: TODO.id,
      title: TODO.title,
      body: TODO.body ?? '',
      due_at_ms: null,
      remind_at_ms: null,
      status: 'pending',
      priority: 'normal',
      note_links: [NOTE.path],
      reminder_fired: 0,
      created_at: FROZEN_NOW,
      updated_at: FROZEN_NOW,
    };
    const save = vi.fn()
      .mockImplementationOnce(async (request: AskConversationSaveRequest) => snapshot(request))
      .mockImplementationOnce(async (request: AskConversationSaveRequest) => ({
        ...snapshot(request),
        todoReceipt: null,
      }));
    const askConversation = {
      load: vi.fn(async () => null),
      save,
      clear: vi.fn(async () => undefined),
    };
    const api = makeApi({
      rag: { ask: vi.fn(async () => answer) },
      todos: {
        create: vi.fn(async () => TODO),
        list: vi.fn(async () => [TODO]),
      },
      askConversation,
    });

    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('answer');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].exchangeId).toMatch(/^exchange-1753000000000-/u);
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());

    fireEvent.click(screen.getByTestId('ask-create-todo'));
    expect(screen.getByRole('textbox', { name: '待办标题' })).toHaveValue('Question');
    fireEvent.click(screen.getByRole('button', { name: '创建待办' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '待办已创建，但会话回执未能安全持久化。',
    );
    expect(api.todos.create).toHaveBeenCalledWith({
      title: 'Question',
      body: 'answer',
      dueAt: null,
      remindAt: null,
      linkedNotePaths: [NOTE.path],
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].todoReceipt).toEqual(todoRecord);
  });

  it('clears and cancels an active conversation without surfacing bridge failures', async () => {
    let rejectDone!: (reason?: unknown) => void;
    const done = new Promise<CopilotRagAnswer>((_resolve, reject) => { rejectDone = reject; });
    const cancel = vi.fn(async () => { throw new Error('cancel ignored'); });
    const clear = vi.fn(async () => { throw new Error('clear ignored'); });
    const api = makeApi({
      rag: {
        ask: vi.fn(),
        stream: vi.fn(() => ({ requestId: 'req', done, cancel })),
      },
      askConversation: {
        load: vi.fn(async () => null),
        save: vi.fn(async (request) => snapshot(request)),
        clear,
      },
    });

    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'stream' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await waitFor(() => expect(api.rag.stream).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('ask-empty-truth')).toBeInTheDocument();
    rejectDone(new DOMException('cancelled', 'AbortError'));
    await act(async () => Promise.resolve());
  });
});

describe('ScheduleWorkspace remaining calendar functions', () => {
  it('executes date shortcuts, month buttons, grid selection, Escape cancellation, and keyboard navigation', async () => {
    const api = makeApi();
    render(<ScheduleWorkspace api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    const mainCalendar = screen.getByLabelText('月历');
    const mainSelected = mainCalendar.querySelector<HTMLButtonElement>('[tabindex="0"]');
    expect(mainSelected).not.toBeNull();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'Enter']) {
      const active = mainCalendar.querySelector<HTMLButtonElement>('[tabindex="0"]') ?? mainSelected!;
      fireEvent.keyDown(active, { key });
    }

    fireEvent.click(screen.getByRole('button', { name: /\+ 新增待办/u }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办标题' }), {
      target: { value: 'Calendar task' },
    });
    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));

    const dialog = screen.getByTestId('todo-date-confirmation');
    expect(dialog.querySelector('[aria-current="date"]')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '今天 09:00' }));
    expect(within(dialog).getByText(/待确认：/u)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '上个月' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '下个月' }));
    const grid = within(dialog).getByRole('grid', { name: '日期月历' });
    const temporary = grid.querySelector<HTMLButtonElement>('[tabindex="0"]');
    expect(temporary).not.toBeNull();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter']) {
      const active = grid.querySelector<HTMLButtonElement>('[tabindex="0"]') ?? temporary!;
      fireEvent.keyDown(active, { key });
    }
    const firstCell = within(grid).getAllByRole('gridcell')[0]!;
    fireEvent.click(firstCell);
    fireEvent.click(within(dialog).getByRole('button', { name: '使用此时间' }));

    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    const reopened = screen.getByTestId('todo-date-confirmation');
    expect(within(reopened).getByText(/已选择：/u)).toBeInTheDocument();
    fireEvent.click(within(reopened).getByRole('button', { name: '明天 09:00' }));
    fireEvent.keyDown(reopened, { key: 'Escape' });
    expect(screen.queryByTestId('todo-date-confirmation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    const noDateDialog = screen.getByTestId('todo-date-confirmation');
    fireEvent.click(within(noDateDialog).getByRole('button', { name: '无日期' }));
    expect(within(noDateDialog).getByText('待确认：无日期')).toBeInTheDocument();
    fireEvent.click(within(noDateDialog).getByRole('button', { name: '取消日期选择' }));
    expect(screen.queryByTestId('todo-date-confirmation')).not.toBeInTheDocument();
  });
});
