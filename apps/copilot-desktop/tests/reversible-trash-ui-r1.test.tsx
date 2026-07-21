import '@testing-library/jest-dom/vitest';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererTrashItem } from '../src/shared/domain-api.js';
import type { CopilotProductApi } from '../src/renderer/lib/copilot-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';
import { TrashManagementSettings } from '../src/renderer/components/Settings/TrashManagementSettings.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="knowledge-graph-stub" />,
}));
vi.mock('../src/renderer/components/NoteDetail/index.js', () => ({
  NoteDetail: () => <div data-testid="note-detail-stub" />,
}));

const noteTrash: RendererTrashItem = {
  trashId: '11111111-1111-4111-8111-111111111111',
  kind: 'note',
  title: 'One',
  revision: 'trash:11111111-1111-4111-8111-111111111111:10',
  state: 'trashed',
  movedAt: 10,
  recoveryRequired: false,
};
const todoTrash: RendererTrashItem = {
  ...noteTrash,
  trashId: '22222222-2222-4222-8222-222222222222',
  kind: 'todo',
  title: 'Ship MVP',
  revision: 'trash:22222222-2222-4222-8222-222222222222:11',
};

function api(): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => [{ path: 'notes/one', title: 'One', type: 'note' as const, status: 'active' as const, tags: [] }]),
      get: vi.fn(async () => ({ path: 'notes/one', title: 'One', body: '# body', type: 'note' as const, status: 'active' as const, tags: [] })),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => undefined),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => [{
        id: 'todo-1', title: 'Ship MVP', status: 'pending' as const, due_at_ms: null, remind_at_ms: null, note_links: [],
      }]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(),
    },
    trash: {
      moveNote: vi.fn(async () => noteTrash),
      moveTodo: vi.fn(async () => todoTrash),
      list: vi.fn(async () => [noteTrash]),
      restore: vi.fn(async (request) => ({ ...noteTrash, trashId: request.trashId, state: 'restored' as const })),
      purge: vi.fn(async (request) => ({ ...noteTrash, trashId: request.trashId, state: 'purged' as const })),
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'copilot');
});

describe('reversible Trash renderer routing r1', () => {
  it('moves note and Todo through Trash and exposes inline Undo without legacy remove', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const product = api();
    const knowledge = render(<KnowledgeWorkspace api={product} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除 One' }));
    await waitFor(() => expect(product.trash?.moveNote).toHaveBeenCalledWith('notes/one'));
    expect(product.notes.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('knowledge-trash-feedback')).toHaveTextContent('已移至回收站');
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
    await waitFor(() => expect(product.trash?.restore).toHaveBeenCalledWith({
      trashId: noteTrash.trashId, revision: noteTrash.revision,
    }));
    knowledge.unmount();

    const schedule = render(<ScheduleWorkspace api={product} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除 Ship MVP' }));
    await waitFor(() => expect(product.trash?.moveTodo).toHaveBeenCalledWith('todo-1'));
    expect(product.todos.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('schedule-trash-feedback')).toHaveTextContent('已移至回收站');
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
    await waitFor(() => expect(product.trash?.restore).toHaveBeenCalledWith({
      trashId: todoTrash.trashId, revision: todoTrash.revision,
    }));
    schedule.unmount();
  });

  it('opens Trash only from Settings, hides paths, explains collisions, and confirms purge', async () => {
    const trash = {
      moveNote: vi.fn(),
      moveTodo: vi.fn(),
      list: vi.fn().mockResolvedValueOnce([noteTrash]).mockResolvedValue([]),
      restore: vi.fn(async () => { throw new Error('[INVALID_ARGUMENT] restore destination already exists'); }),
      purge: vi.fn(async () => ({ ...noteTrash, state: 'purged' })),
    };
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      value: { trash },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TrashManagementSettings />);
    fireEvent.click(screen.getByRole('button', { name: '管理回收站' }));
    expect(await screen.findByRole('dialog', { name: '本地回收站' })).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('notes/one');
    expect(document.body).not.toHaveTextContent('owner');

    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同名内容已存在');

    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(trash.purge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await waitFor(() => expect(trash.purge).toHaveBeenCalledWith({
      trashId: noteTrash.trashId,
      revision: noteTrash.revision,
      confirmed: true,
    }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('keeps renderer Trash sources free of Node filesystem and journal/path internals', () => {
    const appRoot = existsSync(path.join(process.cwd(), 'apps/copilot-desktop'))
      ? path.join(process.cwd(), 'apps/copilot-desktop')
      : process.cwd();
    for (const relative of [
      'src/renderer/lib/copilot-api.ts',
      'src/renderer/workspaces/KnowledgeWorkspace.tsx',
      'src/renderer/workspaces/ScheduleWorkspace.tsx',
      'src/renderer/components/Settings/TrashManagementSettings.tsx',
    ]) {
      const source = readFileSync(path.join(appRoot, relative), 'utf8');
      expect(source).not.toMatch(/node:fs|ipcRenderer|originalPath|metadataJson|ownerId|leaseUntil/u);
    }
  });
});
