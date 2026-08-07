import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WikiTruthReceipt } from '../src/shared/domain-api.js';
import type { CopilotProductApi } from '../src/renderer/lib/copilot-api.js';
import { KnowledgeStudioWorkspace } from '../src/renderer/workspaces/KnowledgeStudioWorkspace.js';

vi.mock('../src/renderer/components/KnowledgeGraph/index.js', () => ({
  KnowledgeGraph: () => <div data-testid="knowledge-graph-fixture" />,
}));

const now = 1_786_000_000_000;

function wikiTruth(path: string, state: 'current' | 'failed'): WikiTruthReceipt {
  const projection = {
    projectionId: `projection:${path}`,
    notePath: path,
    status: state,
    contentDigest: `digest-${path}`,
    summary: state === 'current' ? `整理摘要 ${path}` : null,
    tags: state === 'current' ? ['mvp', 'local'] : [],
    entityIds: state === 'current' ? ['concept:a'] : [],
    relationSignatures: [],
    generatedAt: now,
    failureStage: state === 'failed' ? 'provider' as const : null,
    failureReason: state === 'failed' ? 'provider unavailable' : null,
    provenance: state === 'current'
      ? { provider: 'minimax', model: 'm3', generatedAt: now }
      : null,
  };
  return {
    notePath: path,
    expectedContentDigest: `digest-${path}`,
    truth: state,
    projection,
    current: state === 'current' ? projection : null,
    latest: projection,
    stale: [],
    failed: state === 'failed' ? [projection] : [],
    provenance: projection.provenance,
    knowledgeBuild: {
      state: state === 'current' ? 'ready' : 'failed',
      revision: `note:${now}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    },
  };
}

function productApi() {
  const reindexNote = vi.fn(async () => ({
    notePath: 'notes/failed.md',
    entitiesAdded: 1,
    entitiesLinked: 0,
    ragChunksInserted: 1,
    errors: [],
  }));
  const truths = new Map<string, WikiTruthReceipt>([
    ['notes/current.md', wikiTruth('notes/current.md', 'current')],
    ['notes/failed.md', wikiTruth('notes/failed.md', 'failed')],
  ]);
  const api: CopilotProductApi = {
    notes: {
      list: async () => [
        { path: 'notes/current.md', title: 'Current note', tags: ['mvp'], updatedAt: now },
        { path: 'notes/failed.md', title: 'Failed note', tags: ['repair'], updatedAt: now + 1 },
      ],
      get: async (path) => ({
        path,
        title: path === 'notes/current.md' ? 'Current note' : 'Failed note',
        body: path === 'notes/current.md' ? 'Local source body.' : 'Failed source body.',
        tags: [],
        updatedAt: now,
      }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getBacklinks: async () => [],
    },
    wiki: {
      getForNote: async (path) => truths.get(path) ?? wikiTruth(path, 'failed'),
    },
    kg: {
      getSubgraph: async () => ({
        nodes: [
          {
            id: 1,
            entity_id: 'concept:a',
            type: 'concept',
            name: 'A',
            aliases: [],
            summary: null,
            confidence: 1,
            source_notes: ['notes/current.md'],
            created_at: now,
            updated_at: now,
          },
          {
            id: 2,
            entity_id: 'concept:b',
            type: 'concept',
            name: 'B',
            aliases: [],
            summary: null,
            confidence: 1,
            source_notes: ['notes/current.md', 'notes/failed.md'],
            created_at: now,
            updated_at: now,
          },
        ],
        edges: [{
          id: 1,
          from_entity_id: 'concept:a',
          to_entity_id: 'concept:b',
          rel: 'related_to',
          weight: 1,
          evidence: ['notes/current.md'],
          created_at: now,
        }],
        degree: { 'concept:a': 1, 'concept:b': 1 },
      }),
      reindexNote,
    },
    rag: { ask: vi.fn() },
    todos: {
      list: async () => [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      listDue: async () => [],
      markReminderFired: vi.fn(),
    },
  };
  return { api, reindexNote };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('KnowledgeStudioWorkspace', () => {
  it('renders local truth, human review and four-signal insights without replacing canonical data', async () => {
    const { api } = productApi();
    render(<KnowledgeStudioWorkspace api={api} />);

    await waitFor(() => expect(screen.getByTestId('knowledge-studio')).toBeInTheDocument());
    expect(await screen.findByText('Current note')).toBeInTheDocument();
    expect(screen.getByText(/4-Signal Connections/)).toBeInTheDocument();
    expect(screen.getByText(/整理摘要 notes\/current\.md/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Review/ }));
    const reviewQueue = screen.getByTestId('studio-review-queue');
    expect(reviewQueue).toBeInTheDocument();
    expect(within(reviewQueue).getByText('Failed note')).toBeInTheDocument();
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0);
  });

  it('keeps review decisions local and retries failed knowledge explicitly', async () => {
    const { api, reindexNote } = productApi();
    render(<KnowledgeStudioWorkspace api={api} />);
    await screen.findByText('Current note');
    fireEvent.click(screen.getByRole('tab', { name: /Review/ }));

    const accept = screen.getByRole('button', { name: '确认已读' });
    fireEvent.click(accept);
    expect(window.localStorage.getItem('copilot.wiki-studio.review-decisions.v1')).toContain('accepted');

    const retry = screen.getByRole('button', { name: '重新整理' });
    fireEvent.click(retry);
    await waitFor(() => expect(reindexNote).toHaveBeenCalledWith('notes/failed.md'));
  });
});
