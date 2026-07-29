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
import type { GlobalAssistantContext } from '../src/renderer/components/Assistant/types.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: () => <span>LOCAL ASR · NOT_READY</span>,
}));

const NOTES: CopilotNoteSummary[] = [
  { path: 'projects/alpha', title: 'Alpha 项目文档', tags: ['project'] },
  { path: 'inbox/beta', title: 'Beta 收件箱', tags: ['inbox'] },
];

function makeApi(
  items: CopilotTodo[] = [],
  notes: CopilotNoteSummary[] = NOTES,
): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => notes),
      get: vi.fn(async () => null),
      create: vi.fn(async (input) => ({
        ...input,
        localState: 'LOCAL_SAVED' as const,
        knowledgeBuild: { state: 'queued' as const, revision: 'h4c' },
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
      list: vi.fn(async () => items),
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
  onAssistantContextChange,
}: {
  api: CopilotProductApi;
  onAssistantContextChange?(context: GlobalAssistantContext): void;
}) {
  const [draft, setDraft] = React.useState('');
  return (
    <ScheduleWorkspace
      api={api}
      captureDraft={draft}
      onCaptureDraftChange={setDraft}
      onAssistantContextChange={onAssistantContextChange}
    />
  );
}

function openTodoDialog() {
  const trigger = screen.getByRole('button', { name: '+ 新增待办' });
  fireEvent.click(trigger);
  return {
    trigger,
    dialog: screen.getByRole('dialog', { name: '新增待办' }),
  };
}

describe('R44 H4C Today blockers', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
  });

  it('keeps the todo dialog open when Escape cancels only the nested date draft', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
    const { dialog } = openTodoDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));
    const popover = screen.getByRole('dialog', { name: '选择日期与提醒' });
    fireEvent.click(within(popover).getByRole('button', { name: '明天 09:00' }));
    fireEvent.keyDown(popover, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '选择日期与提醒' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '新增待办' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '选择日期与提醒' })).toHaveFocus();
  });

  it('keeps no-date temporary until footer commit and creates a null-dated todo', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    const { dialog } = openTodoDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '待办标题' }), {
      target: { value: '无日期待办' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));
    const popover = screen.getByRole('dialog', { name: '选择日期与提醒' });
    fireEvent.click(within(popover).getByRole('button', { name: '无日期' }));

    expect(popover).toBeInTheDocument();
    expect(within(popover).getByText('待确认：无日期')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '添加待办' })).toBeDisabled();
    fireEvent.click(within(popover).getByRole('button', { name: '使用此时间' }));
    expect(within(dialog).getByRole('button', { name: '无日期（已确认）' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '添加待办' }));

    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '无日期待办',
      dueAt: null,
      remindAt: null,
    })));
  });

  it('requires an accessible confirmation before discarding a non-empty capture draft', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    const draft = screen.getByTestId('today-capture-draft');
    fireEvent.change(draft, { target: { value: '必须保留的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消草稿' }));

    const confirmation = screen.getByRole('alertdialog', { name: '放弃本地草稿？' });
    expect(draft).toHaveValue('必须保留的草稿');
    fireEvent.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog', { name: '放弃本地草稿？' })).not.toBeInTheDocument();
    expect(draft).toHaveValue('必须保留的草稿');

    fireEvent.click(screen.getByRole('button', { name: '取消草稿' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: '放弃本地草稿？' }))
      .getByRole('button', { name: '放弃草稿' }));
    expect(draft).toHaveValue('');
  });

  it('searches loaded local notes and links only a selected candidate', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
    const { dialog } = openTodoDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '待办标题' }), {
      target: { value: '关联候选待办' },
    });
    const search = within(dialog).getByRole('combobox', { name: '搜索关联笔记' });
    fireEvent.change(search, { target: { value: 'Alpha' } });
    fireEvent.click(within(dialog).getByRole('option', { name: /Alpha 项目文档/ }));
    expect(within(dialog).getByText('已关联：Alpha 项目文档')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '添加待办' }));

    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      linkedNotePaths: ['projects/alpha'],
    })));
  });

  it('owns an accessible keyboard month grid and restores inert background', async () => {
    const api = makeApi();
    render(<Harness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    const background = screen.getByTestId('schedule-workspace');
    const { dialog } = openTodoDialog();
    expect(background).toHaveAttribute('inert');
    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(dialog).toHaveAttribute('aria-describedby', 'todo-dialog-description');
    fireEvent.click(within(dialog).getByRole('button', { name: '选择日期与提醒' }));

    const grid = screen.getByRole('grid', { name: '日期月历' });
    const temporary = within(grid).getByRole('gridcell', { name: /临时选择/ });
    temporary.focus();
    fireEvent.keyDown(temporary, { key: 'ArrowRight' });
    expect(within(grid).getByRole('gridcell', { name: /临时选择/ })).toHaveFocus();
    const monthBefore = within(screen.getByRole('dialog', { name: '选择日期与提醒' }))
      .getByTestId('date-grid-month').textContent;
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageDown' });
    expect(within(screen.getByRole('dialog', { name: '选择日期与提醒' }))
      .getByTestId('date-grid-month')).not.toHaveTextContent(monthBefore ?? '');

    fireEvent.keyDown(screen.getByRole('dialog', { name: '选择日期与提醒' }), { key: 'Escape' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(background).not.toHaveAttribute('inert');
    expect(background).not.toHaveAttribute('aria-hidden');

    const css = readFileSync(
      join(process.cwd(), 'src/renderer/workspaces/ScheduleWorkspace.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.modalCard\s+button[\s\S]*min-(?:height|block-size):\s*44px/);
    expect(css).toMatch(
      /\.todoDeleteButton\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    );
  });

  it('publishes a safe Today assistant context without draft or todo title', async () => {
    const contexts: GlobalAssistantContext[] = [];
    const api = makeApi([{
      id: 'pending',
      title: '敏感待办标题',
      status: 'pending',
      dueAt: Date.now(),
    }]);
    render(<Harness api={api} onAssistantContextChange={(context) => contexts.push(context)} />);
    await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
    const draft = screen.getByTestId('today-capture-draft');
    fireEvent.change(draft, {
      target: { value: 'API_KEY_SHOULD_NOT_LEAK=secret-draft' },
    });
    const deleteButton = screen.getByRole('button', { name: '删除 敏感待办标题' });
    expect(deleteButton.className).toMatch(/todoDeleteButton/);
    const { dialog } = openTodoDialog();
    fireEvent.change(within(dialog).getByRole('combobox', { name: '搜索关联笔记' }), {
      target: { value: 'Beta' },
    });
    fireEvent.click(within(dialog).getByRole('option', { name: /Beta 收件箱/ }));

    await waitFor(() => expect(contexts.at(-1)).toEqual(expect.objectContaining({
      route: 'schedule',
      truth: 'NOT_PROBED',
      sourceCount: 1,
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      todoCount: 1,
      notePath: 'inbox/beta',
    })));
    const serialized = JSON.stringify(contexts.at(-1));
    expect(serialized).toContain('inbox/beta');
    expect(serialized).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(serialized).toContain('1 项未完成');
    expect(serialized).not.toContain('敏感待办标题');
    expect(serialized).not.toContain('API_KEY_SHOULD_NOT_LEAK');
    expect(serialized).not.toContain('secret-draft');
    expect(serialized).not.toMatch(/api.?key|credential|token|密钥/iu);
  });
});
