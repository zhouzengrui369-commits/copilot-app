// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleWorkspace } from '../../src/renderer/workspaces/ScheduleWorkspace.js';
import type { CopilotNote, CopilotProductApi } from '../../src/renderer/lib/copilot-api.js';
import type {
  KnowledgeBuildState,
  WikiProjectionReceipt,
  WikiTruthReceipt,
  WikiTruthState,
} from '../../src/shared/domain-api.js';

vi.mock('../../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: ({ onTranscriptDraft }: {
    onTranscriptDraft?(text: string, requestId: string): void;
  }) => React.createElement(
    'button',
    {
      type: 'button',
      'data-testid': 'deliver-local-transcript',
      onClick: () => onTranscriptDraft?.(
        '本地语音补充',
        'de305d54-75b4-431b-adb2-eb6b9e546014',
      ),
    },
    'LOCAL ASR · NOT_READY',
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const DIGEST = 'a'.repeat(64);
const REVISION = `note:20:${DIGEST}`;

function localSaved(
  path: string,
  body: string,
  state: KnowledgeBuildState = 'queued',
): CopilotNote {
  return {
    path,
    title: 'Capture',
    body,
    tags: ['inbox'],
    type: 'note',
    status: 'active',
    localState: 'LOCAL_SAVED',
    knowledgeBuild: { state, revision: REVISION },
  };
}

function currentProjection(path: string, digest = DIGEST): WikiProjectionReceipt {
  return {
    projectionId: 'wiki-current',
    notePath: path,
    status: 'current',
    contentDigest: digest,
    summary: 'current summary',
    tags: ['current'],
    entityIds: ['entity-current'],
    relationSignatures: [],
    generatedAt: 20,
    failureStage: null,
    failureReason: null,
    provenance: { provider: 'fake', model: 'fake', generatedAt: 20 },
  };
}

function wikiTruth(
  path: string,
  state: KnowledgeBuildState,
  truth: WikiTruthState,
  options: { projectionDigest?: string; expectedDigest?: string } = {},
): WikiTruthReceipt {
  const expectedDigest = options.expectedDigest ?? DIGEST;
  const projection = truth === 'current'
    ? currentProjection(path, options.projectionDigest ?? DIGEST)
    : null;
  return {
    notePath: path,
    expectedContentDigest: expectedDigest,
    truth,
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection?.provenance ?? null,
    knowledgeBuild: { state, revision: REVISION },
  };
}

interface ApiOptions {
  create?: CopilotProductApi['notes']['create'];
  update?: CopilotProductApi['notes']['update'];
  getForNote?: NonNullable<CopilotProductApi['wiki']>['getForNote'];
}

function makeApi(options: ApiOptions = {}): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: options.create ?? vi.fn(async (input) => localSaved(input.path, input.body)),
      update: options.update ?? vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    wiki: {
      getForNote: options.getForNote
        ?? vi.fn(async (path) => wikiTruth(path, 'ready', 'current')),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({ id: 'todo', status: 'pending', ...input })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
}

function Harness({ api, initialDraft }: { api: CopilotProductApi; initialDraft: string }) {
  const [draft, setDraft] = React.useState(initialDraft);
  return React.createElement(ScheduleWorkspace, {
    api,
    captureDraft: draft,
    onCaptureDraftChange: setDraft,
  });
}

describe('Today capture to local knowledge integration', () => {
  it('appends local transcript with zero persistence until explicit save, then never manually reindexes', async () => {
    const createdPath = 'inbox/integration-explicit-save';
    const create = vi.fn<CopilotProductApi['notes']['create']>(
      async (input) => localSaved(createdPath, input.body),
    );
    const api = makeApi({ create });
    render(React.createElement(Harness, { api, initialDraft: '录音前文字' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('today-capture-draft'), {
      target: { value: '录音期间继续输入' },
    });
    fireEvent.click(screen.getByTestId('deliver-local-transcript'));
    expect(screen.getByTestId('today-capture-draft')).toHaveValue(
      '录音期间继续输入\n本地语音补充',
    );
    expect(create).not.toHaveBeenCalled();
    expect(api.wiki?.getForNote).not.toHaveBeenCalled();
    expect(api.kg.reindexNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    await waitFor(() => expect(api.wiki?.getForNote).toHaveBeenCalledWith(createdPath));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].body).toBe('录音期间继续输入\n本地语音补充');
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
  });

  it('shows LOCAL_SAVED and clears only the committed draft before deferred WIKI resolves', async () => {
    const createdPath = 'inbox/integration-local-first';
    let resolveWiki!: (truth: WikiTruthReceipt) => void;
    const pendingWiki = new Promise<WikiTruthReceipt>((resolve) => { resolveWiki = resolve; });
    const api = makeApi({
      create: vi.fn(async (input) => localSaved(createdPath, input.body, 'queued')),
      getForNote: vi.fn(async () => pendingWiki),
    });
    render(React.createElement(Harness, { api, initialDraft: '本地先落盘' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    expect(await screen.findByText('已保存到本地笔记。')).toBeInTheDocument();
    expect(screen.getByText(createdPath)).toBeInTheDocument();
    expect(screen.getByTestId('today-capture-draft')).toHaveValue('');
    expect(screen.getByTestId('capture-index-truth')).toHaveTextContent('WIKI QUEUED');
    expect(api.kg.reindexNote).not.toHaveBeenCalled();

    await act(async () => {
      resolveWiki(wikiTruth(createdPath, 'ready', 'current'));
      await pendingWiki;
    });
    expect(await screen.findByTestId('capture-index-truth')).toHaveTextContent('WIKI CURRENT');
  });

  it('polls queued to running to digest-bound current on one non-overlapping exact-path lane', async () => {
    const createdPath = 'inbox/integration-poll';
    const sequence = [
      wikiTruth(createdPath, 'queued', 'missing'),
      wikiTruth(createdPath, 'running', 'missing'),
      wikiTruth(createdPath, 'ready', 'current'),
    ];
    let active = 0;
    let maxActive = 0;
    const getForNote = vi.fn(async (path: string) => {
      expect(path).toBe(createdPath);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return sequence.shift() ?? wikiTruth(createdPath, 'ready', 'current');
    });
    const api = makeApi({
      create: vi.fn(async (input) => localSaved(createdPath, input.body, 'queued')),
      getForNote,
    });
    render(React.createElement(Harness, { api, initialDraft: '轮询真值' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    expect(await screen.findByTestId('capture-index-truth')).toHaveTextContent('WIKI QUEUED');
    await waitFor(
      () => expect(screen.getByTestId('capture-index-truth')).toHaveTextContent('WIKI CURRENT'),
      { timeout: 2_500 },
    );
    expect(getForNote).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
  });

  it('observes delayed retry-exhausted failed truth beyond the old fast poll window', async () => {
    vi.useFakeTimers();
    try {
      const createdPath = 'inbox/integration-delayed-failed';
      const create = vi.fn<CopilotProductApi['notes']['create']>(
        async (input) => localSaved(createdPath, input.body, 'queued'),
      );
      const sequence = [
        ...Array.from(
          { length: 8 },
          () => wikiTruth(createdPath, 'running', 'missing'),
        ),
        wikiTruth(createdPath, 'failed', 'failed'),
      ];
      let active = 0;
      let maxActive = 0;
      const getForNote = vi.fn(async (path: string) => {
        expect(path).toBe(createdPath);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return sequence.shift() ?? wikiTruth(createdPath, 'failed', 'failed');
      });
      const api = makeApi({ create, getForNote });
      render(React.createElement(Harness, { api, initialDraft: '延迟失败仍须可见' }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(18_750);
      });

      expect(screen.getByTestId('capture-index-truth').textContent).toContain('WIKI FAILED');
      expect(getForNote).toHaveBeenCalledTimes(9);
      expect(getForNote.mock.calls.every(([path]) => path === createdPath)).toBe(true);
      expect(maxActive).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(api.notes.update).not.toHaveBeenCalled();
      expect(api.kg.reindexNote).not.toHaveBeenCalled();
      expect(api.rag.ask).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps path and bytes on WIKI query failure, then re-queries the same path without a second create', async () => {
    const createdPath = 'inbox/integration-query-retry';
    const create = vi.fn<CopilotProductApi['notes']['create']>(
      async (input) => localSaved(createdPath, input.body, 'queued'),
    );
    const getForNote = vi.fn<NonNullable<CopilotProductApi['wiki']>['getForNote']>()
      .mockRejectedValueOnce(new Error('query unavailable'))
      .mockResolvedValueOnce(wikiTruth(createdPath, 'ready', 'current'));
    const api = makeApi({ create, getForNote });
    render(React.createElement(Harness, { api, initialDraft: '查询失败仍保留' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    expect(await screen.findByTestId('capture-index-truth')).toHaveTextContent(
      'WIKI FAILED · 查询失败：query unavailable',
    );
    expect(screen.getByText(createdPath)).toBeInTheDocument();
    expect(screen.queryByText(/保存失败/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试 WIKI' }));
    await waitFor(() => expect(screen.getByTestId('capture-index-truth')).toHaveTextContent(
      'WIKI CURRENT',
    ));
    expect(getForNote).toHaveBeenCalledTimes(2);
    expect(getForNote).toHaveBeenNthCalledWith(2, createdPath);
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.notes.update).not.toHaveBeenCalled();
  });

  it('rebuild retry updates the exact saved path and body, never creating a duplicate', async () => {
    const createdPath = 'inbox/integration-build-retry';
    const create = vi.fn<CopilotProductApi['notes']['create']>(
      async (input) => localSaved(createdPath, input.body, 'queued'),
    );
    const update = vi.fn<CopilotProductApi['notes']['update']>(
      async (path, input) => localSaved(path, input.body ?? '', 'queued'),
    );
    const getForNote = vi.fn<NonNullable<CopilotProductApi['wiki']>['getForNote']>()
      .mockResolvedValueOnce(wikiTruth(createdPath, 'failed', 'failed'))
      .mockResolvedValueOnce(wikiTruth(createdPath, 'ready', 'current'));
    const api = makeApi({ create, update, getForNote });
    render(React.createElement(Harness, { api, initialDraft: '失败后同路径重建' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    expect(await screen.findByTestId('capture-index-truth')).toHaveTextContent('WIKI FAILED');
    fireEvent.click(screen.getByRole('button', { name: '重试 WIKI' }));

    await waitFor(() => expect(screen.getByTestId('capture-index-truth')).toHaveTextContent(
      'WIKI CURRENT',
    ));
    expect(update).toHaveBeenCalledWith(createdPath, { body: '失败后同路径重建' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
  });

  it('never shows current for ready WIKI with a digest mismatch', async () => {
    const createdPath = 'inbox/integration-digest-mismatch';
    const api = makeApi({
      create: vi.fn(async (input) => localSaved(createdPath, input.body, 'ready')),
      getForNote: vi.fn(async () => wikiTruth(
        createdPath,
        'ready',
        'current',
        { projectionDigest: 'b'.repeat(64) },
      )),
    });
    render(React.createElement(Harness, { api, initialDraft: '不能伪绿' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    expect(await screen.findByTestId('capture-index-truth')).toHaveTextContent('WIKI NOT_READY');
    expect(screen.queryByText(/WIKI CURRENT/u)).not.toBeInTheDocument();
  });

  it('retains the editable draft and exposes no saved truth when notes.create rejects', async () => {
    const create = vi.fn<CopilotProductApi['notes']['create']>(async () => {
      throw new Error('local write failed');
    });
    const api = makeApi({ create });
    render(React.createElement(Harness, { api, initialDraft: '必须保留的草稿' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      '保存失败：local write failed。草稿已保留。',
    ));
    expect(screen.getByTestId('today-capture-draft')).toHaveValue('必须保留的草稿');
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.wiki?.getForNote).not.toHaveBeenCalled();
    expect(api.kg.reindexNote).not.toHaveBeenCalled();
    expect(screen.queryByText('已保存到本地笔记。')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-index-truth')).not.toBeInTheDocument();
  });
});
