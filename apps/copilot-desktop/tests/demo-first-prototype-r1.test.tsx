import React, { type ComponentType } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type RouteLoader } from '../src/renderer/App.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';
import type { CopilotProductApi, CopilotTodo } from '../src/renderer/lib/copilot-api.js';
import type { WikiTruthReceipt } from '../src/shared/domain-api.js';

const settingsMocks = vi.hoisted(() => ({ hydrate: vi.fn(async () => undefined) }));
const apiResolution = vi.hoisted(() => ({ current: null as CopilotProductApi | null }));

vi.mock('../src/renderer/stores/settings.js', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ hydrate: settingsMocks.hydrate, theme: 'auto' }),
}));
vi.mock('../src/renderer/lib/copilot-api.js', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../src/renderer/lib/copilot-api.js')>();
  return { ...original, resolveCopilotProductApi: () => ({ api: apiResolution.current, error: apiResolution.current ? null : 'offline' }) };
});
vi.mock('../src/renderer/components/RemoteManagement/RemoteApprovalModal.js', () => ({ RemoteApprovalModal: () => null }));
vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: ({ onTranscriptDraft }: {
    onTranscriptDraft?(text: string, requestId: string): void;
  }) => (
    <button
      type="button"
      data-testid="local-voice-fail-closed"
      onClick={() => onTranscriptDraft?.(
        '本地转写草稿',
        'de305d54-75b4-431b-adb2-eb6b9e546014',
      )}
    >
      LOCAL ASR · NOT_READY
    </button>
  ),
}));

const TODAY_TODO: CopilotTodo = {
  id: 'todo-real-1',
  title: '真实本地待办',
  status: 'pending',
  dueAt: Date.now(),
  remindAt: Date.now(),
  linkedNotePaths: ['inbox/local-note'],
};

const WIKI_DIGEST = 'a'.repeat(64);

function currentWiki(path: string): WikiTruthReceipt {
  const projection = {
    projectionId: 'demo-current',
    notePath: path,
    status: 'current' as const,
    contentDigest: WIKI_DIGEST,
    summary: 'current',
    tags: [],
    entityIds: [],
    relationSignatures: [],
    generatedAt: 1,
    failureStage: null,
    failureReason: null,
    provenance: { provider: 'fake', model: 'fake', generatedAt: 1 },
  };
  return {
    notePath: path,
    expectedContentDigest: WIKI_DIGEST,
    truth: 'current',
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection.provenance,
    knowledgeBuild: {
      state: 'ready',
      revision: `note:1:${WIKI_DIGEST}`,
    },
  };
}

function makeApi(items: CopilotTodo[] = [TODAY_TODO]): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async (input) => ({
        ...input,
        body: input.body,
        localState: 'LOCAL_SAVED' as const,
        knowledgeBuild: {
          state: 'queued' as const,
          revision: `note:1:${WIKI_DIGEST}`,
        },
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    wiki: {
      getForNote: vi.fn(async (path) => currentWiki(path)),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 0 })),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => items),
      create: vi.fn(async (input) => ({ id: '1', status: 'pending', ...input })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
}

function CaptureHarness({ api, initialDraft = '' }: { api: CopilotProductApi; initialDraft?: string }) {
  const [draft, setDraft] = React.useState(initialDraft);
  return <ScheduleWorkspace api={api} captureDraft={draft} onCaptureDraftChange={setDraft} />;
}

describe('Demo-first prototype IA and truth boundaries', () => {
  beforeEach(() => {
    apiResolution.current = makeApi();
    settingsMocks.hydrate.mockClear();
    window.history.replaceState(null, '', '#today');
    Object.defineProperty(window, '__COPILOT_BROWSER_PROTOTYPE__', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const current = (window as unknown as { copilot?: Record<string, unknown> }).copilot ?? {};
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      writable: true,
      value: {
        ...current,
        meta: {
          productName: 'njx-copilot-v6',
          appVersion: '0.1.0-test',
          platform: 'darwin',
        },
      },
    });
  });

  it('opens Today with the Demo shell classes and exactly four primary destinations', async () => {
    const routeLoader = vi.fn<RouteLoader>(async (route) => ({
      default: (() => <div data-testid={'route-' + route}>{route}</div>) as ComponentType<Record<string, unknown>>,
    }));
    render(<App routeLoader={routeLoader} />);
    expect(document.querySelector('.titlebar')).not.toBeNull();
    expect(document.querySelector('.nav')).not.toBeNull();
    expect(document.querySelector('.decision-strip')).not.toBeNull();
    expect(document.querySelector('.statusbar')).not.toBeNull();
    expect(document.querySelectorAll('.nav a')).toHaveLength(4);
    expect(screen.getByTestId('nav-schedule')).toHaveTextContent('今天');
    expect(screen.getByTestId('nav-knowledge')).toHaveTextContent('知识');
    expect(screen.getByTestId('nav-ask')).toHaveTextContent('对话');
    expect(screen.getByTestId('nav-settings')).toHaveTextContent('设置');
    expect(screen.queryByTestId('nav-studio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-voice')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-candidate-identity')).toHaveTextContent('CURRENT SOURCE PREVIEW');
    expect(screen.getByTestId('current-candidate-identity')).toHaveTextContent('njx-copilot-v6 · 0.1.0-test · darwin');
    expect(screen.getByTestId('current-candidate-state')).toHaveTextContent('MVP_NOT_COMPLETE');
    expect(screen.getByTestId('status-product-api')).toHaveTextContent('PRESENT · HEALTH NOT_PROBED');
    expect(await screen.findByTestId('route-schedule')).toBeInTheDocument();
  });

  it('keeps the Today Knowledge CTA hash, active nav, and visible route synchronized', async () => {
    const api = makeApi([]);
    Object.defineProperty(window, '__COPILOT_BROWSER_PROTOTYPE__', {
      configurable: true,
      writable: true,
      value: {
        api,
        scenario: 'ready',
        label: 'PROTOTYPE / NOT_RUNTIME_PROOF',
      },
    });
    const TodayRoute = ({ onOpenKnowledge }: { onOpenKnowledge?(): void }) => (
      <section data-testid="schedule-workspace">
        <button type="button" onClick={onOpenKnowledge}>打开知识 MOC</button>
      </section>
    );
    const routeLoader = vi.fn<RouteLoader>(async (route) => ({
      default: route === 'schedule'
        ? TodayRoute as unknown as ComponentType<Record<string, unknown>>
        : (() => <div data-testid={'route-' + route}>{route}</div>) as ComponentType<Record<string, unknown>>,
    }));
    render(<App routeLoader={routeLoader} />);

    expect(await screen.findByTestId('schedule-workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开知识 MOC' }));

    expect(await screen.findByTestId('route-knowledge')).toBeInTheDocument();
    expect(window.location.hash).toBe('#knowledge');
    expect(screen.getByTestId('nav-knowledge')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('view-knowledge')).toBeInTheDocument();
  });

  it('renders the Demo Today hierarchy from typed local Todo data without fixture truth', async () => {
    const api = makeApi();
    render(<CaptureHarness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    for (const className of ['today-grid', 'calendar-rail', 'day-workbench', 'capture', 'timeline', 'todo-list']) {
      expect(document.querySelector('.' + className)).not.toBeNull();
    }
    expect(screen.getByTestId('today-capture-composition')).toHaveClass('capture-grid');
    expect(screen.getByTestId('today-transcript-stream')).toHaveClass('transcript-stream');
    expect(screen.getByTestId('today-capture-enrichment')).toHaveClass('capture-enrichment');
    expect((await screen.findAllByText('真实本地待办')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('schedule-workspace')).not.toHaveTextContent(/DEMO FIXTURE|SIMULATED|录音中|3D 星辰大海/u);
  });

  it('keeps the Demo todo-list visible with a truthful empty state', async () => {
    const api = makeApi([]);
    render(<CaptureHarness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    expect(document.querySelector('.todo-list')).not.toBeNull();
    expect(screen.getByTestId('today-todo-empty')).toHaveTextContent('暂无待办');
    expect(screen.getByTestId('today-todo-empty')).toHaveTextContent('真实的本地空状态');
    expect(screen.getByTestId('today-timeline-empty')).toHaveTextContent('选中日期没有时间线项目');
    expect(document.querySelectorAll('.todo-list .todo')).toHaveLength(0);
    expect(screen.queryByText('真实本地待办')).not.toBeInTheDocument();
  });

  it('cancels without a write and saves raw local truth before exact-path WIKI', async () => {
    const api = makeApi([]);
    const order: string[] = [];
    const createdPath = 'inbox/real-capture';
    api.notes.create = vi.fn(async (input) => {
      order.push('notes.create');
      return {
        ...input,
        path: createdPath,
        body: input.body,
        localState: 'LOCAL_SAVED',
        knowledgeBuild: {
          state: 'queued',
          revision: `note:1:${WIKI_DIGEST}`,
        },
      };
    });
    api.wiki!.getForNote = vi.fn(async (path) => {
      order.push('wiki.getForNote:' + path);
      return currentWiki(path);
    });
    render(<CaptureHarness api={api} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('today-capture-draft'), { target: { value: '将取消的真实草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    expect(api.notes.create).not.toHaveBeenCalled();
    expect(api.kg.reindexNote).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('today-capture-draft'), { target: { value: '确认保存' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' })); });
    await waitFor(() => expect(api.wiki?.getForNote).toHaveBeenCalledWith(createdPath));
    expect(order).toEqual(['notes.create', 'wiki.getForNote:' + createdPath]);
    expect(screen.getByText('已保存到本地笔记。')).toBeInTheDocument();
    expect(screen.getByTestId('capture-index-truth')).toHaveTextContent('WIKI CURRENT');
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
  });

  it('keeps local voice inside Today and writes only to the editable draft', async () => {
    const api = makeApi([]);
    render(<CaptureHarness api={api} initialDraft="同步输入" />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    expect(screen.getByText('开始本地语音')).toBeInTheDocument();
    fireEvent.click(screen.getByText('开始本地语音'));
    fireEvent.click(screen.getByTestId('local-voice-fail-closed'));
    expect(screen.getByTestId('today-capture-draft')).toHaveValue(
      '同步输入\n本地转写草稿',
    );
    expect(api.notes.create).not.toHaveBeenCalled();
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
    expect(screen.queryByTestId('nav-voice')).not.toBeInTheDocument();
  });

  it('keeps local saved truth visible when WIKI reports a provider failure', async () => {
    const api = makeApi([]);
    api.notes.create = vi.fn(async (input) => ({
      ...input,
      path: 'inbox/config-required',
      body: input.body,
      localState: 'LOCAL_SAVED',
      knowledgeBuild: {
        state: 'queued',
        revision: `note:1:${WIKI_DIGEST}`,
      },
    }));
    api.wiki!.getForNote = vi.fn(async (path): Promise<WikiTruthReceipt> => ({
      notePath: path,
      expectedContentDigest: WIKI_DIGEST,
      truth: 'failed',
      projection: null,
      current: null,
      latest: null,
      stale: [],
      failed: [],
      provenance: null,
      knowledgeBuild: {
        state: 'failed',
        revision: `note:1:${WIKI_DIGEST}`,
      },
    }));
    render(<CaptureHarness api={api} initialDraft="本地先保存" />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' })); });
    await waitFor(() => expect(api.wiki?.getForNote).toHaveBeenCalledWith('inbox/config-required'));
    expect(screen.getByText('已保存到本地笔记。')).toBeInTheDocument();
    expect(screen.getByTestId('capture-index-truth')).toHaveTextContent('WIKI FAILED');
    expect(screen.queryByText(/保存失败/u)).not.toBeInTheDocument();
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
  });
});
