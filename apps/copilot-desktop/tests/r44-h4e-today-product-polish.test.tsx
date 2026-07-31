import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotNoteSummary,
  CopilotProductApi,
  CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: () => <span>LOCAL ASR · NOT_READY</span>,
}));

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthDate(date: Date, offset: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function makeApi(
  todos: CopilotTodo[] = [],
  notes: CopilotNoteSummary[] = [],
): CopilotProductApi {
  const state = [...todos];
  return {
    notes: {
      list: vi.fn(async () => notes),
      get: vi.fn(async () => null),
      create: vi.fn(async (input) => ({
        ...input,
        localState: 'LOCAL_SAVED' as const,
        knowledgeBuild: { state: 'queued' as const, revision: 'h4e' },
      })),
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
      list: vi.fn(async () => [...state]),
      create: vi.fn(async (input) => {
        const created = { ...input, id: 'created', status: 'pending' as const };
        state.push(created);
        return created;
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
  };
}

function Harness({
  api,
  onOpenNote,
  todoMemoryAdapter,
}: {
  api: CopilotProductApi;
  onOpenNote?(path: string): void;
  todoMemoryAdapter?(
    todo: CopilotTodo,
    memory: {
      logs: Array<{ id: string; createdAt: number; body: string }>;
      note: string;
    },
  ): Promise<void>;
}) {
  const [draft, setDraft] = React.useState('');
  return (
    <ScheduleWorkspace
      api={api}
      captureDraft={draft}
      onCaptureDraftChange={setDraft}
      onOpenNote={onOpenNote}
      todoMemoryAdapter={todoMemoryAdapter}
    />
  );
}

describe('R44 H4E Today product polish', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
    window.history.replaceState(null, '', '/?prototype=ready');
  });

  it('keeps date truth coherent and supports keyboard navigation in the main calendar', async () => {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    const priorMonth = monthDate(today, -1);
    // Month navigation clamps to the destination month's final valid day.
    const monthAfterPriorMonth = monthDate(priorMonth, 1);
    const scenarios = [
      { from: today, key: 'ArrowLeft', expected: yesterday },
      { from: yesterday, key: 'ArrowRight', expected: today },
      { from: today, key: 'ArrowUp', expected: weekAgo },
      { from: weekAgo, key: 'ArrowDown', expected: today },
      { from: today, key: 'PageUp', expected: priorMonth },
      { from: priorMonth, key: 'PageDown', expected: monthAfterPriorMonth },
      { from: yesterday, key: 'Home', expected: today },
    ] as const;

    for (const [index, scenario] of scenarios.entries()) {
      const api = makeApi();
      const view = render(<Harness api={api} />);
      await waitFor(() => expect(api.notes.list).toHaveBeenCalled());

      if (index === 0) {
        expect(screen.getByTestId('today-heading-copy')).toHaveAttribute(
          'data-assistant-avoid',
          'critical',
        );
        expect(screen.getByTestId('today-key-overview')).toHaveAttribute(
          'data-assistant-avoid',
          'critical',
        );
      }

      const fromKey = localDateKey(scenario.from);
      const expectedKey = localDateKey(scenario.expected);
      if (fromKey !== localDateKey(today)) {
        fireEvent.click(screen.getByRole('button', { name: `选择日期 ${fromKey}` }));
        await waitFor(() => expect(screen.getByRole('button', {
          name: `选择日期 ${fromKey}`,
          pressed: true,
        })).toBeInTheDocument());
      }

      const source = screen.getByRole('button', {
        name: `选择日期 ${fromKey}`,
        pressed: true,
      });
      await act(async () => {
        source.focus();
        fireEvent.keyDown(source, { key: scenario.key });
        await Promise.resolve();
      });

      await waitFor(() => {
        const target = screen.getByRole('button', {
          name: `选择日期 ${expectedKey}`,
          pressed: true,
        });
        expect(target).toHaveFocus();
        expect(screen.getByTestId('selected-date-feedback')).toHaveTextContent(expectedKey);
      });

      if (scenario.key === 'ArrowLeft') {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('所选日期');
        expect(screen.getByTestId('selected-date-heading')).toHaveTextContent('所选日期工作与生活');
      }
      if (scenario.key === 'Home') {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('今天');
      }
      view.unmount();
    }
  });

  it('shows only notes saved on the selected date and opens the exact note path', async () => {
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const openNote = vi.fn();
    const notes: CopilotNoteSummary[] = [
      {
        path: 'journal/today',
        title: '今天的真实笔记',
        updatedAt: today.getTime(),
        tags: ['journal'],
      },
      {
        path: 'journal/yesterday',
        title: '昨天的真实笔记',
        updatedAt: yesterday.getTime(),
        tags: ['journal'],
      },
    ];
    const api = makeApi([], notes);
    render(<Harness api={api} onOpenNote={openNote} />);
    await waitFor(() => expect(api.notes.list).toHaveBeenCalled());

    const section = screen.getByRole('region', { name: '当日笔记' });
    expect(within(section).getByText('今天的真实笔记')).toBeInTheDocument();
    expect(within(section).queryByText('昨天的真实笔记')).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /打开笔记 今天的真实笔记/ }));
    expect(openNote).toHaveBeenCalledWith('journal/today');

    fireEvent.click(screen.getByRole('button', {
      name: `选择日期 ${localDateKey(yesterday)}`,
    }));
    expect(within(section).getByText('昨天的真实笔记')).toBeInTheDocument();
    expect(within(section).queryByText('今天的真实笔记')).not.toBeInTheDocument();
  });

  it('keeps todo creation in one app-owned modal with an explicit date footer', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    expect(screen.queryByText('添加本地待办')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ 新增待办' }));
    const dialog = screen.getByRole('dialog', { name: '新增待办' });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));
    const popover = screen.getByRole('dialog', { name: '选择日期与提醒' });
    expect(within(popover).getByRole('button', { name: '取消日期选择' })).toBeInTheDocument();
    expect(within(popover).getByRole('button', { name: '使用此时间' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /确认日期/ })).not.toBeInTheDocument();
  });

  it('uses one immersive draft and preserves a desktop minimum editing surface', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('today-capture-draft'), {
      target: { value: '同源的沉浸式草稿' },
    });
    fireEvent.click(screen.getByRole('button', { name: '展开编辑' }));
    expect(screen.getByLabelText('沉浸式快速记录草稿')).toHaveValue('同源的沉浸式草稿');

    const css = readFileSync(
      join(process.cwd(), 'src/renderer/workspaces/ScheduleWorkspace.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.immersiveEditor\s*\{[^}]*min-width:\s*min\(640px,\s*100%\);/s,
    );
    expect(css).toMatch(
      /\.immersiveEditor textarea\s*\{[^}]*min-height:\s*420px;/s,
    );
  });

  it('persists title and body through update plus canonical list readback', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-memory',
      title: '保存状态验收',
      body: '原始正文',
      status: 'pending',
      dueAt: Date.now(),
      linkedNotePaths: ['notes/original.md'],
    };
    const api = makeApi([todo]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 保存状态验收' }));
    const editor = screen.getByTestId('todo-editor-h4e-memory');
    expect(editor).toHaveAttribute('data-save-state', 'idle');
    fireEvent.change(screen.getByLabelText('编辑待办标题 保存状态验收'), {
      target: { value: '保存状态已编辑' },
    });
    fireEvent.change(screen.getByLabelText('编辑待办内容 保存状态验收'), {
      target: { value: '保存后的真实正文' },
    });
    expect(editor).toHaveAttribute('data-save-state', 'dirty');
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));
    expect(await screen.findByText('已保存并完成本地回读')).toBeInTheDocument();
    expect(api.todos.update).toHaveBeenCalledWith('h4e-memory', expect.objectContaining({
      title: '保存状态已编辑',
      body: '保存后的真实正文',
      linkedNotePaths: ['notes/original.md'],
    }));
    expect(screen.getByLabelText('编辑待办标题 保存状态已编辑')).toHaveValue('保存状态已编辑');
  });

  it('persists explicit due time and every source path', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-actual-route',
      title: '实际路由保存验收',
      body: '正文',
      status: 'pending',
      dueAt: null,
      linkedNotePaths: ['notes/a.md'],
    };
    const api = makeApi([todo]);
    render(<ScheduleWorkspace api={api} requestedTodoId="h4e-actual-route" />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    expect(await screen.findByTestId('todo-editor-h4e-actual-route')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    const dueInput = screen.getByLabelText('编辑待办截止时间 实际路由保存验收');
    const sourceInput = screen.getByLabelText('编辑待办来源 实际路由保存验收');
    fireEvent.change(dueInput, {
      target: { value: '2026-08-01T09:30' },
    });
    fireEvent.change(sourceInput, {
      target: { value: 'notes/a.md\nnotes/b.md' },
    });
    expect(dueInput).toHaveValue('2026-08-01T09:30');
    expect(sourceInput).toHaveValue('notes/a.md\nnotes/b.md');
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));

    expect(await screen.findByText('已保存并完成本地回读')).toBeInTheDocument();
    expect(api.todos.update).toHaveBeenCalledWith('h4e-actual-route', expect.objectContaining({
      dueAt: new Date('2026-08-01T09:30').getTime(),
      linkedNotePaths: ['notes/a.md', 'notes/b.md'],
    }));
  });

  it('retains edits and never shows success when canonical update readback fails', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-failure',
      title: '失败保留验收',
      body: '原始正文',
      status: 'pending',
      dueAt: Date.now(),
    };
    const api = makeApi([todo]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 失败保留验收' }));
    fireEvent.change(screen.getByLabelText('编辑待办内容 失败保留验收'), {
      target: { value: '编辑内容必须保留' },
    });
    api.todos.list = vi.fn(async () => []);
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByLabelText('编辑待办内容 失败保留验收')).toHaveValue('编辑内容必须保留');
    expect(screen.queryByText('已保存并完成本地回读')).not.toBeInTheDocument();
  });
});
