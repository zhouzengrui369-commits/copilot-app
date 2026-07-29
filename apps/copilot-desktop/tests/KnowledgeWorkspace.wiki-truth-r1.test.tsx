// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeBuildState,
  KnowledgeBuildStatusReceipt,
  WikiProjectionReceipt,
  WikiTruthReceipt,
  WikiTruthState,
} from '../src/shared/domain-api.js';
import type {
  CopilotNote,
  CopilotNoteInput,
  CopilotProductApi,
} from '../src/renderer/lib/copilot-api.js';
import { KnowledgeWorkspace } from '../src/renderer/workspaces/KnowledgeWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="wiki-test-graph" />,
}));

vi.mock('../src/renderer/components/NoteDetail/index.js', () => ({
  NoteDetail: ({ noteId }: { noteId: string }) => (
    <div data-testid="note-detail-panel">{noteId}</div>
  ),
}));

const NOTE: CopilotNote = {
  path: 'inbox/wiki-truth',
  title: 'WIKI truth',
  body: '# WIKI truth\n\nCurrent local bytes.',
  tags: ['local'],
  type: 'note',
  status: 'active',
  updatedAt: 1_753_000_000_000,
};

function knowledgeBuild(state: KnowledgeBuildState): KnowledgeBuildStatusReceipt {
  return {
    state,
    revision: `note:1:${'a'.repeat(64)}`,
  };
}

function rawReceipt(note: CopilotNote, state: KnowledgeBuildState = 'queued'): CopilotNote {
  return {
    ...note,
    localState: 'LOCAL_SAVED',
    knowledgeBuild: knowledgeBuild(state),
  };
}

function projection(status: WikiProjectionReceipt['status']): WikiProjectionReceipt {
  const failed = status === 'failed';
  return {
    projectionId: status === 'current' ? '1' : '2',
    notePath: NOTE.path,
    status,
    contentDigest: status === 'stale' ? 'c'.repeat(64) : 'd'.repeat(64),
    summary: failed ? null : '真实本地 WIKI 摘要',
    tags: failed ? [] : ['wiki', 'local'],
    entityIds: failed ? [] : ['concept:wiki'],
    relationSignatures: failed ? [] : ['concept:wiki|related_to|concept:local'],
    generatedAt: 1_753_000_000_000,
    failureStage: failed ? 'provider' : null,
    failureReason: failed ? 'WIKI_PROVIDER_FAILED' : null,
    provenance: failed ? null : {
      provider: 'minimax',
      model: 'MiniMax-M3',
      generatedAt: 1_753_000_000_000,
    },
  };
}

function truth(
  state: WikiTruthState,
  buildState: KnowledgeBuildState = state === 'failed' ? 'failed' : 'ready',
): WikiTruthReceipt {
  const current = state === 'current' ? projection('current') : null;
  const stale = state === 'stale' ? [projection('stale')] : [];
  const failed = state === 'failed' ? [projection('failed')] : [];
  const selected = current ?? stale[0] ?? failed[0] ?? null;
  return {
    notePath: NOTE.path,
    expectedContentDigest: 'd'.repeat(64),
    truth: state,
    projection: selected,
    current,
    latest: selected,
    stale,
    failed,
    provenance: state === 'current' || state === 'stale'
      ? selected?.provenance ?? null
      : null,
    knowledgeBuild: knowledgeBuild(buildState),
  };
}

function digestMismatchTruth(): WikiTruthReceipt {
  const matching = truth('current', 'ready');
  const mismatched = {
    ...matching.current!,
    contentDigest: 'c'.repeat(64),
  };
  return {
    ...matching,
    projection: mismatched,
    current: mismatched,
    latest: mismatched,
    provenance: mismatched.provenance,
  };
}

function makeApi(initial: CopilotNote | null, wikiTruth: WikiTruthReceipt): CopilotProductApi {
  let stored = initial;
  return {
    notes: {
      list: vi.fn().mockImplementation(async () => stored ? [stored] : []),
      get: vi.fn().mockImplementation(async (path: string) => stored?.path === path ? stored : null),
      create: vi.fn().mockImplementation(async (input: CopilotNoteInput) => {
        stored = rawReceipt({ ...NOTE, ...input });
        return stored;
      }),
      createWithBuild: vi.fn().mockRejectedValue(new Error('legacy withBuild must not run')),
      update: vi.fn().mockImplementation(async (_path: string, input: Partial<CopilotNoteInput>) => {
        if (!stored) return null;
        stored = rawReceipt({ ...stored, ...input });
        return stored;
      }),
      updateWithBuild: vi.fn().mockRejectedValue(new Error('legacy withBuild must not run')),
      remove: vi.fn().mockResolvedValue(true),
      getBacklinks: vi.fn().mockResolvedValue([]),
    },
    wiki: {
      getForNote: vi.fn().mockImplementation(async () => wikiTruth),
    },
    kg: {
      getSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], degree: {} }),
      reindexNote: vi.fn().mockResolvedValue({}),
    },
    rag: {
      ask: vi.fn().mockResolvedValue({ text: '', sources: [] }),
    },
    todos: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      listDue: vi.fn().mockResolvedValue([]),
      markReminderFired: vi.fn(),
    },
  };
}

describe('KnowledgeWorkspace digest-bound WIKI truth R1', () => {
  it.each([
    ['current', 'CURRENT'],
    ['stale', 'STALE'],
    ['failed', 'FAILED'],
    ['missing', 'MISSING'],
  ] as const)('renders the %s truth without upgrading it', async (state, label) => {
    render(<KnowledgeWorkspace api={makeApi(NOTE, truth(state))} />);

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', state);
    });
    expect(screen.getByTestId('wiki-truth-chip')).toHaveTextContent(label);
    expect(screen.getByTestId('wiki-truth-digest')).toHaveTextContent('d'.repeat(64));
    if (state === 'current') {
      expect(screen.getByTestId('wiki-truth-summary')).toHaveTextContent('真实本地 WIKI 摘要');
      expect(screen.getByTestId('wiki-truth-tags')).toHaveTextContent('wiki、local');
      expect(screen.getByTestId('wiki-truth-entities')).toHaveTextContent('concept:wiki');
      expect(screen.getByTestId('wiki-truth-relations')).toHaveTextContent('related_to');
      expect(screen.getByTestId('wiki-truth-provenance')).toHaveTextContent('minimax / MiniMax-M3');
      expect(screen.getByTestId('moc-wiki-current')).toHaveTextContent('真实本地 WIKI 摘要');
    } else {
      expect(screen.getByTestId('wiki-truth-summary')).toHaveTextContent(
        state === 'failed' ? 'FAILED' : state === 'stale' ? 'STALE' : 'NO_PROJECTION',
      );
      expect(screen.getByTestId('wiki-truth-tags')).not.toHaveTextContent('wiki');
      expect(screen.getByTestId('wiki-truth-entities')).not.toHaveTextContent('concept:wiki');
      expect(screen.getByTestId('wiki-truth-relations')).not.toHaveTextContent('related_to');
      expect(screen.queryByTestId('wiki-truth-provenance')).not.toBeInTheDocument();
      expect(screen.queryByTestId('moc-wiki-current')).not.toBeInTheDocument();
      expect(screen.getByTestId('moc-wiki-not-current')).toHaveTextContent('保持隐藏');
    }
    if (state === 'failed') {
      expect(screen.getByTestId('wiki-truth-failure')).toHaveTextContent(
        'provider / WIKI_PROVIDER_FAILED',
      );
    }
  });

  it('keeps ready raw-current digest mismatch NOT_READY with every generated field hidden', async () => {
    const api = makeApi(NOTE, digestMismatchTruth());
    render(<KnowledgeWorkspace api={api} />);

    await waitFor(() => {
      expect(api.wiki!.getForNote).toHaveBeenCalledWith(NOTE.path);
      expect(screen.getByTestId('wiki-truth-digest')).toHaveTextContent('d'.repeat(64));
      expect(screen.getByTestId('wiki-truth-chip')).toHaveTextContent('NOT_READY');
    });
    const chip = screen.getByTestId('wiki-truth-chip');
    expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute(
      'data-wiki-state',
      'not-ready',
    );
    expect(chip).toHaveTextContent('NOT_READY');
    expect(chip).not.toHaveTextContent('CURRENT');
    expect(chip.className).not.toMatch(/wikiTruthCurrent/u);
    expect(screen.getByTestId('wiki-truth-summary')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-tags')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-entities')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-relations')).toHaveTextContent('NOT_READY');
    expect(screen.getByTestId('wiki-truth-digest')).toHaveTextContent('d'.repeat(64));
    expect(screen.queryByTestId('wiki-truth-provenance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('moc-wiki-current')).not.toBeInTheDocument();
    expect(screen.getByTestId('moc-wiki-not-current')).toHaveTextContent('保持隐藏');
  });

  it('uses raw create for immediate LOCAL_SAVED and keeps a separate WIKI failure fail-closed', async () => {
    const failedTruth = truth('failed');
    const api = makeApi(null, failedTruth);
    render(<KnowledgeWorkspace api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), { target: { value: 'Saved locally' } });
    fireEvent.change(screen.getByLabelText('笔记路径'), { target: { value: NOTE.path } });
    fireEvent.change(screen.getByLabelText('笔记正文'), { target: { value: NOTE.body } });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-save-receipt')).toHaveTextContent('LOCAL_SAVED');
    });
    expect(screen.getByTestId('knowledge-save-receipt')).toHaveTextContent('QUEUED');
    expect(screen.getByTestId('knowledge-save-path')).toHaveTextContent(NOTE.path);
    expect(api.notes.create).toHaveBeenCalledTimes(1);
    expect(api.notes.createWithBuild).not.toHaveBeenCalled();
    expect(api.notes.updateWithBuild).not.toHaveBeenCalled();
    expect(screen.queryByText('知识工作区操作失败')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'failed');
    });
    expect(screen.getByTestId('wiki-truth-chip')).toHaveTextContent('FAILED');
    expect(screen.getByTestId('note-detail-panel')).toHaveTextContent(NOTE.path);
  });

  it('polls queued → running → current on one exact path without overlap or duplicate save', async () => {
    const api = makeApi(null, truth('current'));
    const sequence = [
      truth('missing', 'queued'),
      truth('missing', 'running'),
      truth('current', 'ready'),
    ];
    let active = 0;
    let maxActive = 0;
    api.wiki!.getForNote = vi.fn().mockImplementation(async (path: string) => {
      expect(path).toBe(NOTE.path);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      const result = sequence.shift() ?? truth('current', 'ready');
      active -= 1;
      return result;
    });
    render(<KnowledgeWorkspace api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '新建笔记' }));
    fireEvent.change(screen.getByLabelText('笔记标题'), { target: { value: NOTE.title } });
    fireEvent.change(screen.getByLabelText('笔记路径'), { target: { value: NOTE.path } });
    fireEvent.change(screen.getByLabelText('笔记正文'), { target: { value: NOTE.body } });
    fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'current');
    });
    expect(api.wiki!.getForNote).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    expect(api.notes.create).toHaveBeenCalledTimes(1);
    expect(api.notes.update).not.toHaveBeenCalled();
    expect(api.notes.createWithBuild).not.toHaveBeenCalled();
    expect(screen.getByTestId('moc-wiki-current')).toHaveTextContent('真实本地 WIKI 摘要');
  });

  it('bounds pending polling at nine serial attempts and exposes exact-path retry', async () => {
    vi.useFakeTimers();
    try {
      const api = makeApi(NOTE, truth('missing', 'queued'));
      render(<KnowledgeWorkspace api={api} />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(18_750);
      });
      expect(screen.getByTestId('wiki-poll-exhausted')).toHaveTextContent('QUEUED');
      expect(api.wiki!.getForNote).toHaveBeenCalledTimes(9);
      expect(api.wiki!.getForNote).toHaveBeenCalledWith(NOTE.path);
      expect(screen.getByTestId('wiki-retry-exact-path')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('observes delayed retry-exhausted failed truth beyond the old fast poll window', async () => {
    vi.useFakeTimers();
    try {
      const api = makeApi(NOTE, truth('missing', 'running'));
      const sequence = [
        ...Array.from({ length: 8 }, () => truth('missing', 'running')),
        truth('failed'),
      ];
      let active = 0;
      let maxActive = 0;
      api.wiki!.getForNote = vi.fn().mockImplementation(async (path: string) => {
        expect(path).toBe(NOTE.path);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return sequence.shift() ?? truth('failed');
      });
      render(<KnowledgeWorkspace api={api} />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(18_750);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute(
        'data-wiki-state',
        'failed',
      );
      expect(screen.getByTestId('wiki-truth-chip')).toHaveTextContent('FAILED');
      expect(api.wiki!.getForNote).toHaveBeenCalledTimes(9);
      expect(
        vi.mocked(api.wiki!.getForNote).mock.calls.every(([path]) => path === NOTE.path),
      ).toBe(true);
      expect(maxActive).toBe(1);
      expect(api.notes.create).not.toHaveBeenCalled();
      expect(api.notes.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed build with raw update on the same path and never creates a duplicate', async () => {
    const api = makeApi(NOTE, truth('failed'));
    api.wiki!.getForNote = vi.fn()
      .mockResolvedValueOnce(truth('failed'))
      .mockResolvedValueOnce(truth('current'));
    render(<KnowledgeWorkspace api={api} />);

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'failed');
    });
    fireEvent.click(screen.getByTestId('wiki-retry-exact-path'));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'current');
    });
    expect(screen.getByTestId('knowledge-save-receipt')).toHaveTextContent('LOCAL_SAVED');
    expect(screen.getByTestId('knowledge-save-path')).toHaveTextContent(NOTE.path);
    expect(api.notes.update).toHaveBeenCalledTimes(1);
    expect(api.notes.update).toHaveBeenCalledWith(
      NOTE.path,
      expect.objectContaining({ path: NOTE.path }),
    );
    expect(api.notes.create).not.toHaveBeenCalled();
    expect(api.notes.updateWithBuild).not.toHaveBeenCalled();
  });

  it('retries a query failure by re-reading the same path without saving or creating', async () => {
    const api = makeApi(NOTE, truth('current'));
    api.wiki!.getForNote = vi.fn()
      .mockRejectedValueOnce(new Error('query unavailable'))
      .mockResolvedValueOnce(truth('current'));
    render(<KnowledgeWorkspace api={api} />);

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'query-failed');
    });
    fireEvent.click(screen.getByTestId('wiki-retry-exact-path'));

    await waitFor(() => {
      expect(screen.getByTestId('wiki-truth-block')).toHaveAttribute('data-wiki-state', 'current');
    });
    expect(api.wiki!.getForNote).toHaveBeenCalledTimes(2);
    expect(api.wiki!.getForNote).toHaveBeenNthCalledWith(1, NOTE.path);
    expect(api.wiki!.getForNote).toHaveBeenNthCalledWith(2, NOTE.path);
    expect(api.notes.create).not.toHaveBeenCalled();
    expect(api.notes.update).not.toHaveBeenCalled();
  });
});
