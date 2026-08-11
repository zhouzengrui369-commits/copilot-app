import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopilotProductApi, CopilotTodo } from '../src/renderer/lib/copilot-api.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: () => <span>LOCAL ASR · NOT_READY</span>,
}));

function makeApi(items: CopilotTodo[] = []): CopilotProductApi {
  const state = [...items];
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

function localInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}T${hour}:${minute}`;
}

describe('R44 H4B Today product experience', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
  });

  it('opens todo creation from the visible plus action and restores focus on Escape', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    expect(screen.queryByText('添加本地待办')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '+ 新增待办' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '新增待办' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: '待办标题' })).toHaveFocus());

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '新增待办' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('commits date and time inside the popover before one todo can be created', async () => {
    const api = makeApi();
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(9, 30, 0, 0);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '+ 新增待办' }));
    const dialog = screen.getByRole('dialog', { name: '新增待办' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '待办标题' }), {
      target: { value: '日期 popover 验收' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));
    const popover = screen.getByRole('dialog', { name: '选择日期与提醒' });
    fireEvent.input(within(popover).getByLabelText('临时日期与提醒时间'), {
      target: { value: localInput(due) },
    });

    expect(within(popover).getByText(`待确认：${localInput(due).replace('T', ' ')}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '添加待办' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '添加待办' }));
    expect(api.todos.create).not.toHaveBeenCalled();

    fireEvent.click(within(popover).getByRole('button', { name: '使用此时间' }));
    expect(screen.queryByRole('dialog', { name: '选择日期与提醒' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: `已选择 ${localInput(due).replace('T', ' ')}` })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '添加待办' }));
    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '日期 popover 验收',
      dueAt: new Date(localInput(due)).getTime(),
      remindAt: new Date(localInput(due)).getTime(),
    })));
  });

  it('uses one quick-capture draft in compact and immersive modes', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    const draft = '需要沉浸编辑的多段本地草稿';
    fireEvent.change(screen.getByTestId('today-capture-draft'), {
      target: { value: draft },
    });
    expect(screen.getByTestId('today-capture-count')).toHaveTextContent(`${draft.length} 字`);
    const trigger = screen.getByRole('button', { name: '展开编辑' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '沉浸式快速记录' });
    expect(within(dialog).getByLabelText('沉浸式快速记录草稿')).toHaveValue('需要沉浸编辑的多段本地草稿');
    expect(dialog).toHaveTextContent('PROTOTYPE / NOT_RUNTIME_PROOF');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '沉浸式快速记录' })).not.toBeInTheDocument();
    expect(screen.getByTestId('today-capture-draft')).toHaveValue('需要沉浸编辑的多段本地草稿');
    expect(trigger).toHaveFocus();
  });

  it('appends execution logs while notes remain editable and cancel restores saved values', async () => {
    const todo: CopilotTodo = {
      id: 'detail',
      title: 'Today 卡片验收',
      status: 'pending',
      dueAt: Date.now(),
      linkedNotePaths: ['projects/copilot'],
    };
    const api = makeApi([todo]);
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '展开待办 Today 卡片验收' }));
    fireEvent.change(screen.getByLabelText('新增执行日志'), { target: { value: '完成产品合同复核' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: 'Browser 复验后再进入 R 门' } });
    fireEvent.click(screen.getByRole('button', { name: '保存待办详情' }));
    const summary = await screen.findByTestId('todo-memory-summary-detail');
    expect(summary).toHaveTextContent('执行日志');
    expect(summary).toHaveTextContent('完成产品合同复核');
    expect(summary).toHaveTextContent('备注：Browser 复验后再进入 R 门');
    expect(api.todos.update).toHaveBeenCalledWith('detail', expect.objectContaining({
      body: expect.stringContaining('COPILOT_TODO_DETAIL_V1'),
    }));

    await waitFor(() => expect(screen.getByTestId('todo-card-detail')).toHaveAttribute('data-focused', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '收起待办 Today 卡片验收' }));
    fireEvent.click(await screen.findByRole('button', { name: '展开待办 Today 卡片验收' }));
    expect(screen.getByTestId('todo-memory-summary-detail')).toHaveTextContent('完成产品合同复核');
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '未保存改动' } });
    fireEvent.click(screen.getByRole('button', { name: '取消编辑待办详情' }));
    fireEvent.click(screen.getByRole('button', { name: '展开待办 Today 卡片验收' }));
    expect(screen.getByLabelText('备注')).toHaveValue('Browser 复验后再进入 R 门');
  });

  it('removes the page-local assistant and marks critical Today actions as avoid zones', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    expect(screen.queryByTestId('today-context-ai')).not.toBeInTheDocument();
    expect(screen.queryByText('今日 AI 助手')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-assistant-avoid="critical"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: '+ 新增待办' })).toHaveAttribute('data-assistant-avoid', 'critical');
    expect(screen.getByTestId('today-capture-card')).toHaveAttribute('data-assistant-avoid', 'critical');
  });
});
