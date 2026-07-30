import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../src/main/local-knowledge-service.js';
import type {
  AskConversationSnapshot,
  TodoRecord,
} from '../src/shared/domain-api.js';
import type {
  CopilotProductApi,
  CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';

const NOTE_PATH = 'notes/restored.md';
const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

function makeMinimalKnowledgeService() {
  const kb = {
    createNote: vi.fn(),
    readNote: vi.fn(() => null),
    updateNote: vi.fn(() => null),
    deleteNote: vi.fn(() => false),
    listNotes: vi.fn(() => ({ items: [], total: 0, limit: 1000, offset: 0 })),
    listLinks: vi.fn(() => ({ in: [] })),
  };
  const kg = {
    getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
    reindexNote: vi.fn(async () => ({ entitiesAdded: 0, entitiesLinked: 0 })),
    removeNote: vi.fn(async () => undefined),
  };
  const rag = {
    indexNote: vi.fn(async () => ({ chunksInserted: 0, errors: [] as string[] })),
    deleteNote: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ text: '', sources: [] as string[] })),
  };
  const service = new LocalKnowledgeService({
    kb,
    kg,
    rag,
    settings: { get: () => false },
  } as unknown as LocalKnowledgeServiceOptions);
  return { service, kb, kg, rag };
}

function restoredApi(onOpenTodo: (id: string | number) => void): {
  api: CopilotProductApi;
  snapshot: AskConversationSnapshot;
  todo: TodoRecord;
  onOpenTodo: (id: string | number) => void;
} {
  const todo: TodoRecord = {
    id: 'todo-restored',
    title: 'Restored Todo',
    body: 'Restored answer',
    due_at_ms: null,
    remind_at_ms: null,
    status: 'pending',
    priority: 'normal',
    note_links: [NOTE_PATH],
    reminder_fired: 0,
    created_at: 10,
    updated_at: 20,
  };
  const snapshot: AskConversationSnapshot = {
    schemaVersion: 1,
    exchangeId: 'exchange-restored',
    phase: 'completed',
    question: 'Restored question',
    answer: {
      text: 'Restored answer',
      sources: [NOTE_PATH],
      sourceDetails: [{ notePath: NOTE_PATH, evidence: ['vector'], score: 0.9 }],
    },
    todoReceipt: todo,
    completedAt: 20,
    sourceTruth: 'current',
  };
  const api: CopilotProductApi = {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async (path) => path === NOTE_PATH
        ? { path: NOTE_PATH, title: 'Restored note', body: 'local restored body', tags: [] }
        : null),
      create: vi.fn(async (input) => ({
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
      ask: vi.fn(async () => snapshot.answer),
    },
    todos: {
      list: vi.fn(async (): Promise<CopilotTodo[]> => []),
      create: vi.fn(async (): Promise<CopilotTodo> => ({
        id: 'unused', title: 'unused', status: 'pending',
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
    askConversation: {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => snapshot),
      clear: vi.fn(async () => undefined),
    },
  };
  return { api, snapshot, todo, onOpenTodo };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(globalThis.navigator, 'clipboard');
  }
});

describe('last local knowledge branches', () => {
  it('returns null for a synchronous update whose durable note disappeared', async () => {
    const { service, kb } = makeMinimalKnowledgeService();
    await expect(service.notes.updateWithBuild({
      path: 'notes/missing',
      patch: { title: 'still missing' },
    })).resolves.toBeNull();
    expect(kb.updateNote).toHaveBeenCalledWith('notes/missing', { title: 'still missing' });
  });

  it('treats already-missing owned rollback objects as idempotently complete', async () => {
    const { service, kb, kg, rag } = makeMinimalKnowledgeService();
    await expect(service.backupImport.rollback({
      importNamespace: 'import-a',
      notePaths: ['import-a/notes/missing'],
      todoIds: ['import-a-todo-missing'],
    })).resolves.toBeUndefined();
    expect(kb.deleteNote).not.toHaveBeenCalled();
    expect(kg.removeNote).toHaveBeenCalledOnce();
    expect(kg.removeNote).toHaveBeenCalledWith('import-a/notes/missing');
    expect(rag.deleteNote).toHaveBeenCalledOnce();
    expect(rag.deleteNote).toHaveBeenCalledWith('import-a/notes/missing');
  });
});

describe('last AskWorkspace branches', () => {
  it('restores a canonical Todo receipt and copies the restored answer', async () => {
    const onOpenTodo = vi.fn();
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    const { api, snapshot } = restoredApi(onOpenTodo);

    render(<AskWorkspace api={api} onOpenTodo={onOpenTodo} />);

    expect(await screen.findByTestId('rag-answer')).toHaveTextContent(snapshot.answer.text);
    expect(await screen.findByTestId('ask-todo-success')).toHaveTextContent('Restored Todo');
    await waitFor(() => expect(screen.getByTestId('ask-create-todo')).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '查看待办' }));
    expect(onOpenTodo).toHaveBeenCalledWith('todo-restored');

    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Restored answer'));
    expect(screen.getByTestId('copy-status-answer')).toHaveTextContent('已复制');
  });
});
