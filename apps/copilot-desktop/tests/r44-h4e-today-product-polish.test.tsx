import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      list: vi.fn(async () => todos),
      create: vi.fn(async (input) => ({ ...input, id: 'created', status: 'pending' as const })),
      update: vi.fn(async () => null),
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
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.notes.list).toHaveBeenCalled());

    expect(screen.getByTestId('today-heading-copy')).toHaveAttribute(
      'data-assistant-avoid',
      'critical',
    );
    expect(screen.getByTestId('today-key-overview')).toHaveAttribute(
      'data-assistant-avoid',
      'critical',
    );

    const pressFromSelected = async (key: string, expected: Date) => {
      const selected = screen.getByRole('button', { pressed: true });
      selected.focus();
      fireEvent.keyDown(selected, { key });
      const expectedKey = localDateKey(expected);
      expect(screen.getByTestId('selected-date-feedback')).toHaveTextContent(expectedKey);
      await waitFor(() => expect(screen.getByRole('button', {
        name: `选择日期 ${expectedKey}`,
      })).toHaveFocus());
    };

    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    await pressFromSelected('ArrowLeft', yesterday);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('所选日期');
    expect(screen.getByTestId('selected-date-heading')).toHaveTextContent('所选日期工作与生活');
    await pressFromSelected('ArrowRight', today);
    await pressFromSelected('ArrowUp', weekAgo);
    await pressFromSelected('ArrowDown', today);
    await pressFromSelected('PageUp', monthDate(today, -1));
    await pressFromSelected('PageDown', today);
    await pressFromSelected('ArrowLeft', yesterday);
    await pressFromSelected('Home', today);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('今天');
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

  it('shows separate log and note states through dirty, saving, saved, and cancel', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-memory',
      title: '保存状态验收',
      status: 'pending',
      dueAt: Date.now(),
    };
    let resolveSave: (() => void) | undefined;
    const todoMemoryAdapter = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const api = makeApi([todo]);
    render(<Harness api={api} todoMemoryAdapter={todoMemoryAdapter} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 保存状态验收' }));
    const editor = screen.getByTestId('todo-memory-editor-h4e-memory');
    expect(editor).toHaveAttribute('data-save-state', 'idle');
    fireEvent.change(screen.getByLabelText('新增执行日志'), {
      target: { value: '完成一次真实操作' },
    });
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '保存后再验收' },
    });
    expect(editor).toHaveAttribute('data-save-state', 'dirty');
    expect(screen.getByTestId('todo-log-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'dirty',
    );
    expect(screen.getByTestId('todo-note-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'dirty',
    );

    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));
    expect(screen.getByTestId('todo-log-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    expect(screen.getByTestId('todo-note-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    expect(screen.getByRole('button', { name: '保存待办详情' })).toBeDisabled();
    resolveSave?.();

    const summary = await screen.findByTestId('todo-memory-summary-h4e-memory');
    expect(todoMemoryAdapter).toHaveBeenCalledTimes(1);
    expect(summary).toHaveAttribute('data-save-state', 'saved');
    expect(summary).toHaveTextContent('已保存到当前页面内存');
    expect(screen.getByTestId('todo-log-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    expect(screen.getByTestId('todo-note-save-state-h4e-memory')).toHaveAttribute(
      'data-save-state',
      'saved',
    );

    fireEvent.click(screen.getByRole('button', { name: '展开待办 保存状态验收' }));
    expect(screen.getByText('完成一次真实操作')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '取消这次修改' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消编辑待办详情' }));
    fireEvent.click(screen.getByRole('button', { name: '展开待办 保存状态验收' }));
    expect(screen.getByLabelText('备注')).toHaveValue('保存后再验收');
  });

  it('keeps the actual no-adapter page-memory route visibly saving before commit', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-actual-route',
      title: '实际路由保存验收',
      status: 'pending',
      dueAt: Date.now(),
    };
    const api = makeApi([todo]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 实际路由保存验收' }));
    fireEvent.change(screen.getByLabelText('新增执行日志'), {
      target: { value: '实际路由保存日志' },
    });
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '实际路由保存备注' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));

    expect(screen.getByTestId('todo-memory-editor-h4e-actual-route')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    expect(screen.getByTestId('todo-log-save-state-h4e-actual-route')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    expect(screen.getByTestId('todo-note-save-state-h4e-actual-route')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    expect(screen.getByRole('button', { name: '保存待办详情' })).toBeDisabled();
    expect(screen.queryByTestId('todo-memory-summary-h4e-actual-route')).not.toBeInTheDocument();

    const summary = await screen.findByTestId('todo-memory-summary-h4e-actual-route');
    expect(summary).toHaveAttribute('data-save-state', 'saved');
    expect(summary).toHaveTextContent('执行日志（1）：实际路由保存日志');
    expect(summary).toHaveTextContent('实际路由保存备注');
  });

  it('exposes a real Browser failure fixture, retains edits, and retries without overwriting history', async () => {
    const todo: CopilotTodo = {
      id: 'h4e-failure',
      title: '失败保留验收',
      status: 'pending',
      dueAt: Date.now(),
    };
    const api = makeApi([todo]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 失败保留验收' }));
    fireEvent.change(screen.getByLabelText('新增执行日志'), {
      target: { value: '已经保存的第一条历史' },
    });
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '已经保存的备注' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));
    expect(await screen.findByTestId('todo-memory-summary-h4e-failure')).toHaveTextContent(
      '执行日志（1）：已经保存的第一条历史',
    );

    fireEvent.click(screen.getByRole('button', { name: '展开待办 失败保留验收' }));
    window.history.replaceState(null, '', '/?prototype=ready&todoMemoryFixture=reject');
    fireEvent.change(screen.getByLabelText('新增执行日志'), {
      target: { value: '失败时不能覆盖历史' },
    });
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '编辑内容必须保留' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByText('已经保存的第一条历史')).toBeInTheDocument();
    expect(screen.getByLabelText('新增执行日志')).toHaveValue('失败时不能覆盖历史');
    expect(screen.getByLabelText('备注')).toHaveValue('编辑内容必须保留');
    expect(screen.queryByTestId('todo-memory-summary-h4e-failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('todo-log-save-state-h4e-failure')).toHaveAttribute(
      'data-save-state',
      'failed',
    );
    expect(screen.getByTestId('todo-note-save-state-h4e-failure')).toHaveAttribute(
      'data-save-state',
      'failed',
    );

    window.history.replaceState(null, '', '/?prototype=ready');
    fireEvent.click(screen.getByRole('button', { name: '重试保存待办详情' }));
    const summary = await screen.findByTestId('todo-memory-summary-h4e-failure');
    expect(summary).toHaveTextContent('执行日志（2）：失败时不能覆盖历史');
    fireEvent.click(screen.getByRole('button', { name: '展开待办 失败保留验收' }));
    expect(screen.getByText('已经保存的第一条历史')).toBeInTheDocument();
    expect(screen.getByText('失败时不能覆盖历史')).toBeInTheDocument();
  });
});
