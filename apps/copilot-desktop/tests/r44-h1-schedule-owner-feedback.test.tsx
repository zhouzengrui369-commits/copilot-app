import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopilotProductApi, CopilotTodo } from '../src/renderer/lib/copilot-api.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: () => <span>LOCAL ASR · NOT_READY</span>,
}));

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function localInput(date: Date): string {
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function makeApi(items: CopilotTodo[]): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async (input) => ({
        ...input,
        localState: 'LOCAL_SAVED' as const,
        knowledgeBuild: { state: 'queued' as const, revision: 'prototype' },
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => null),
    },
    rag: {
      ask: vi.fn(async () => ({ text: '', sources: [] })),
    },
    todos: {
      list: vi.fn(async () => items),
      create: vi.fn(async (input) => ({ ...input, id: 'new', status: 'pending' as const })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
}

function Harness({ api }: { api: CopilotProductApi }) {
  const [draft, setDraft] = React.useState('');
  return (
    <ScheduleWorkspace
      api={api}
      captureDraft={draft}
      onCaptureDraftChange={setDraft}
    />
  );
}

function todayAt(hour: number): Date {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

describe('R44 H1 Schedule owner feedback', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
  });

  it('requires explicit date confirmation and echoes the confirmed value', async () => {
    const api = makeApi([]);
    const due = todayAt(15);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '+ 新增待办' }));
    const dialog = screen.getByRole('dialog', { name: '新增待办' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '待办标题' }), {
      target: { value: '确认日期测试' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));
    const confirmation = screen.getByRole('dialog', { name: '选择日期与提醒' });
    fireEvent.input(within(confirmation).getByLabelText('临时日期与提醒时间'), {
      target: { value: localInput(due) },
    });

    const submit = within(dialog).getByRole('button', { name: '添加待办' });
    expect(confirmation).toHaveTextContent(`待确认：${localInput(due).replace('T', ' ')}`);
    expect(confirmation).toHaveAttribute('data-confirmation-state', 'pending');
    expect(within(confirmation).getByRole('button', { name: '使用此时间' })).toBeEnabled();
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(api.todos.create).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole('button', { name: '使用此时间' }));
    expect(screen.queryByRole('dialog', { name: '选择日期与提醒' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', {
      name: `已选择 ${localInput(due).replace('T', ' ')}`,
    })).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认日期测试',
      dueAt: new Date(localInput(due)).getTime(),
      remindAt: new Date(localInput(due)).getTime(),
    })));
  });

  it('filters the Today main area by the selected calendar day and shows an empty day truthfully', async () => {
    const first = todayAt(10);
    const second = new Date(first);
    second.setDate(second.getDate() + 1);
    const empty = new Date(first);
    empty.setDate(empty.getDate() + 2);
    const api = makeApi([
      { id: 'first', title: '第一天待办', status: 'pending', dueAt: first.getTime() },
      { id: 'second', title: '第二天待办', status: 'pending', dueAt: second.getTime() },
    ]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: `选择日期 ${dateKey(second)}` }));
    expect(screen.getByTestId('selected-date-feedback')).toHaveTextContent(`当前选中：${dateKey(second)}`);
    expect(screen.getAllByText('第二天待办').length).toBeGreaterThan(0);
    expect(screen.queryByText('第一天待办')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `选择日期 ${dateKey(empty)}` }));
    expect(screen.getByTestId('today-todo-empty')).toHaveTextContent('选中日期暂无待办');
    expect(screen.getByTestId('today-todo-empty')).toHaveTextContent('PROTOTYPE / NOT_RUNTIME_PROOF');
    expect(screen.queryByText('第一天待办')).not.toBeInTheDocument();
    expect(screen.queryByText('第二天待办')).not.toBeInTheDocument();
  });

  it('expands a todo card and supports page-memory record and notes save/cancel', async () => {
    const api = makeApi([
      { id: 'detail', title: '展开记录测试', status: 'pending', dueAt: todayAt(11).getTime() },
    ]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 展开记录测试' }));
    expect(screen.getByText('PROTOTYPE / NOT_RUNTIME_PROOF · 仅保存在当前页面内存')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('新增执行日志'), { target: { value: '已完成资料整理' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '明天继续复核' } });
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));
    const summary = await screen.findByTestId('todo-memory-summary-detail');
    expect(summary).toHaveTextContent('已保存到当前页面内存');
    expect(summary).toHaveTextContent('已完成资料整理');

    fireEvent.click(screen.getByRole('button', { name: '展开待办 展开记录测试' }));
    expect(screen.getByText('已完成资料整理')).toBeInTheDocument();
    expect(screen.getByLabelText('备注')).toHaveValue('明天继续复核');
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '未保存改动' } });
    fireEvent.click(screen.getByRole('button', { name: '取消编辑待办详情' }));
    expect(screen.queryByLabelText('备注')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开待办 展开记录测试' }));
    expect(screen.getByText('已完成资料整理')).toBeInTheDocument();
    expect(screen.getByLabelText('备注')).toHaveValue('明天继续复核');
  });
});
