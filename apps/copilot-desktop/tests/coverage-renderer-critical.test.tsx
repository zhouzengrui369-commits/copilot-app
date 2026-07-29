import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotDomainBridge,
  NoteCommitBuildReceipt,
  NoteRecord,
  RagStreamEvent,
  RendererTrashItem,
  TodoRecord,
  WikiTruthReceipt,
} from '../src/shared/domain-api.js';
import {
  MarkdownRenderer,
  preprocessWikilinks,
} from '../src/renderer/components/NoteDetail/MarkdownRenderer.js';
import {
  buildLocalAsrDecodeRequest,
} from '../src/renderer/components/VoiceInput/audio-pcm.js';
import {
  useLocalAsrCapture,
} from '../src/renderer/components/VoiceInput/useLocalAsrCapture.js';
import { VoiceInput } from '../src/renderer/components/VoiceInput/index.js';
import {
  createKgDataSource,
  createNoteDataSource,
  normalizeNote,
  normalizeNoteList,
  resolveCopilotProductApi,
  todoDueAt,
  todoNoteLinks,
  todoRemindAt,
  type CopilotProductApi,
  type CopilotRagAnswer,
  type CopilotTodo,
} from '../src/renderer/lib/copilot-api.js';
import { AskWorkspace } from '../src/renderer/workspaces/AskWorkspace.js';
import { WorkspaceState } from '../src/renderer/workspaces/WorkspaceState.js';
import { ScheduleWorkspace } from '../src/renderer/workspaces/ScheduleWorkspace.js';

const NOTE_RECORD: NoteRecord = {
  id: 1,
  path: 'notes/one.md',
  title: 'One',
  type: 'note',
  status: 'active',
  tags: ['local'],
  related: [],
  folder: 'notes',
  createdAt: 10,
  updatedAt: 20,
  confidence: null,
  agent: null,
};

const TODO_RECORD: TodoRecord = {
  id: 'todo-1',
  title: 'Ship MVP',
  body: '',
  due_at_ms: Date.UTC(2026, 6, 20, 9, 30),
  remind_at_ms: Date.UTC(2026, 6, 20, 9, 0),
  status: 'pending',
  priority: 'normal',
  note_links: ['notes/one.md'],
  reminder_fired: 0,
  created_at: 1,
  updated_at: 2,
};

const MISSING_WIKI_RECEIPT: WikiTruthReceipt = {
  notePath: NOTE_RECORD.path,
  expectedContentDigest: null,
  truth: 'missing',
  projection: null,
  current: null,
  latest: null,
  stale: [],
  failed: [],
  provenance: null,
};

function localSavedMissingBuild(): NoteCommitBuildReceipt {
  return {
    note: NOTE_RECORD,
    localState: 'LOCAL_SAVED',
    build: {
      state: 'BUILD_FAILED',
      kg: {
        state: 'failed',
        entitiesAdded: 0,
        entitiesLinked: 0,
        reason: 'KG_BUILD_NOT_COMPLETED',
      },
      wiki: MISSING_WIKI_RECEIPT,
      rag: {
        state: 'failed',
        chunksInserted: 0,
        reason: 'RAG_INDEX_NOT_COMPLETED',
      },
      failureStage: 'wiki',
      failureReason: 'WIKI_MISSING',
    },
  };
}

function makeBridge(): CopilotDomainBridge {
  let streamListener: ((event: RagStreamEvent) => void) | null = null;
  return {
    notes: {
      list: vi.fn(async () => ({ items: [NOTE_RECORD], total: 1, limit: 100, offset: 0 })),
      get: vi.fn(async () => ({ note: NOTE_RECORD, body: '# body' })),
      create: vi.fn(async () => NOTE_RECORD),
      createWithBuild: vi.fn(async () => localSavedMissingBuild()),
      update: vi.fn(async () => NOTE_RECORD),
      updateWithBuild: vi.fn(async () => localSavedMissingBuild()),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => [{ fromPath: 'notes/from.md', toPath: NOTE_RECORD.path, relation: 'ref' }]),
    },
    wiki: {
      getForNote: vi.fn(async () => MISSING_WIKI_RECEIPT),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async (notePath) => ({ notePath, entitiesAdded: 1, entitiesLinked: 0, ragChunksInserted: 1, errors: [] })),
    },
    rag: {
      ask: vi.fn(async () => ({ text: 'answer', sources: [NOTE_RECORD.path] })),
      startStream: vi.fn(async ({ requestId }) => ({ requestId, accepted: true as const })),
      cancelStream: vi.fn(async (requestId) => ({ requestId, cancelled: true })),
      onStreamEvent: vi.fn((listener) => {
        streamListener = listener;
        return vi.fn(() => { streamListener = null; });
      }),
    },
    todos: {
      list: vi.fn(async () => [TODO_RECORD]),
      create: vi.fn(async () => TODO_RECORD),
      update: vi.fn(async () => TODO_RECORD),
      remove: vi.fn(async () => true),
      listDue: vi.fn(async () => [TODO_RECORD]),
      markReminderFired: vi.fn(async () => ({ ...TODO_RECORD, reminder_fired: 1 })),
    },
    getStreamListener: () => streamListener,
  } as CopilotDomainBridge & { getStreamListener(): typeof streamListener };
}

function resolvedApi(bridge = makeBridge()): CopilotProductApi {
  const result = resolveCopilotProductApi(bridge);
  expect(result.error).toBeNull();
  expect(result.api).not.toBeNull();
  return result.api!;
}

type CopilotProductApiOverrides = {
  notes?: Partial<CopilotProductApi['notes']>;
  kg?: Partial<CopilotProductApi['kg']>;
  rag?: Partial<CopilotProductApi['rag']>;
  todos?: Partial<CopilotProductApi['todos']>;
  trash?: NonNullable<CopilotProductApi['trash']>;
};

function makeProductApi(overrides: CopilotProductApiOverrides = {}): CopilotProductApi {
  const base = resolvedApi();
  return {
    ...base,
    ...overrides,
    notes: { ...base.notes, ...overrides.notes },
    kg: { ...base.kg, ...overrides.kg },
    rag: { ...base.rag, ...overrides.rag },
    todos: { ...base.todos, ...overrides.todos },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MarkdownRenderer critical behavior', () => {
  it('keeps plain text unchanged and safely renders links and code variants', () => {
    expect(preprocessWikilinks('plain')).toBe('plain');
    const { container } = render(
      <MarkdownRenderer
        source={'[site](https://example.test) `inline`\n\n```ts\nconst x = 1\n```\n\n<script>alert(1)</script>'}
      />,
    );
    const link = screen.getByRole('link', { name: 'site' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('code.language-ts')).toHaveTextContent('const x = 1');
    expect(container.querySelector('code:not(.language-ts)')).toHaveTextContent('inline');
    expect(container.querySelector('pre')).toBeInTheDocument();
  });

  it('encodes and decodes wikilink targets and tolerates an absent callback', () => {
    const onClick = vi.fn();
    const view = render(<MarkdownRenderer source={'[[folder/a b|Alias]]'} onWikilinkClick={onClick} />);
    const link = screen.getByTestId('wikilink');
    expect(link).toHaveAttribute('href', 'wikilink:folder/a%20b');
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledWith('folder/a b');
    view.rerender(<MarkdownRenderer source={'[[other/path]]'} /> as ReactElement);
    expect(() => fireEvent.click(screen.getByTestId('wikilink'))).not.toThrow();
  });
});

describe('local ASR critical renderer boundary', () => {
  it('fails closed before microphone access when the local bridge is absent', async () => {
    const getUserMedia = vi.fn();
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: null,
      getUserMedia,
      mediaRecorder: null,
    }));
    await act(async () => {
      await expect(hook.result.current.start()).rejects.toMatchObject({
        code: 'NOT_READY',
      });
    });
    expect(hook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'NOT_READY',
      coreTruth: { state: 'NOT_READY', active: false },
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('rejects invalid audio without creating a decode request', async () => {
    await expect(buildLocalAsrDecodeRequest({
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Blob)).rejects.toEqual(expect.objectContaining({
      code: 'INVALID_AUDIO',
    }));
  });

  it('renders one neutral local truth surface and no transcript preview', () => {
    render(<VoiceInput />);
    expect(screen.getByTestId('voice-input-root')).toHaveAttribute(
      'data-truth-tone',
      'neutral',
    );
    expect(screen.getByTestId('voice-banner')).toHaveTextContent(
      'LOCAL ASR · NOT_READY',
    );
    expect(screen.queryByTestId('voice-transcript')).not.toBeInTheDocument();
  });
});

describe('copilot product bridge adapters', () => {
  it.each([
    [null, '本地服务桥接不可用'],
    [{}, '知识库 IPC'],
    [{ notes: { list() {}, get() {}, create() {}, update() {}, remove() {}, getBacklinks() {} } }, '知识图谱 IPC'],
    [{ notes: { list() {}, get() {}, create() {}, update() {}, remove() {}, getBacklinks() {} }, kg: { getSubgraph() {}, reindexNote() {} } }, '知识问答 IPC'],
    [{ notes: { list() {}, get() {}, create() {}, update() {}, remove() {}, getBacklinks() {} }, kg: { getSubgraph() {}, reindexNote() {} }, rag: { ask() {} } }, '日程 IPC'],
  ])('fails closed for incomplete preload bridge %#', (value, message) => {
    expect(resolveCopilotProductApi(value)).toMatchObject({ api: null, error: expect.stringContaining(message) });
  });

  it('maps every notes, KG, and todo operation to the domain bridge', async () => {
    const bridge = makeBridge();
    const api = resolvedApi(bridge);
    await expect(api.notes.list()).resolves.toMatchObject({ items: [NOTE_RECORD] });
    await expect(api.notes.get(NOTE_RECORD.path)).resolves.toMatchObject({ note: NOTE_RECORD, body: '# body' });
    await expect(api.notes.create({ path: NOTE_RECORD.path, title: 'One', body: 'new', tags: ['x'], type: null, status: null }))
      .resolves.toMatchObject({ path: NOTE_RECORD.path, body: 'new' });
    expect(bridge.notes.create).toHaveBeenCalledWith(expect.objectContaining({ body: 'new', tags: ['x'], type: null }));
    await expect(api.notes.update(NOTE_RECORD.path, { title: 'Updated', body: 'changed', tags: ['y'] }))
      .resolves.toMatchObject({ title: 'One', body: 'changed' });
    await expect(api.notes.update(NOTE_RECORD.path, { title: 'Updated' }))
      .resolves.toMatchObject({ body: '# body' });
    vi.mocked(bridge.notes.update).mockResolvedValueOnce(null);
    await expect(api.notes.update(NOTE_RECORD.path, {})).resolves.toBeNull();
    await expect(api.notes.remove(NOTE_RECORD.path)).resolves.toBe(true);
    await expect(api.notes.getBacklinks(NOTE_RECORD.path)).resolves.toEqual([
      expect.objectContaining({ sourceId: 'notes/from.md', sourceTitle: 'notes/from.md', excerpt: 'ref' }),
    ]);
    await expect(api.kg.getSubgraph(10)).resolves.toEqual({ nodes: [], edges: [], degree: {} });
    await expect(api.kg.reindexNote(NOTE_RECORD.path)).resolves.toMatchObject({ notePath: NOTE_RECORD.path });
    await expect(api.rag.ask('q')).resolves.toMatchObject({ text: 'answer' });

    await expect(api.todos.list()).resolves.toEqual([expect.objectContaining({ id: 'todo-1', due_at_ms: TODO_RECORD.due_at_ms })]);
    await expect(api.todos.create({ title: 'x', dueAt: 1, remindAt: null, linkedNotePaths: ['n'] }))
      .resolves.toMatchObject({ id: 'todo-1' });
    expect(bridge.todos.create).toHaveBeenCalledWith({ title: 'x', due_at_ms: 1, remind_at_ms: null, note_links: ['n'] });
    await expect(api.todos.update('todo-1', {
      title: 'new', status: 'done', dueAt: 2, remind_at_ms: 3, linkedNotePaths: ['a'],
    })).resolves.toMatchObject({ id: 'todo-1' });
    expect(bridge.todos.update).toHaveBeenCalledWith({ id: 'todo-1', patch: {
      title: 'new', status: 'done', due_at_ms: 2, remind_at_ms: 3, note_links: ['a'],
    } });
    vi.mocked(bridge.todos.update).mockResolvedValueOnce(null);
    await expect(api.todos.update('todo-1', { due_at_ms: null, note_links: [] })).resolves.toBeNull();
    await expect(api.todos.remove('todo-1')).resolves.toBe(true);
    await expect(api.todos.listDue(99)).resolves.toHaveLength(1);
    await expect(api.todos.markReminderFired('todo-1')).resolves.toMatchObject({ id: 'todo-1' });
    vi.mocked(bridge.todos.markReminderFired).mockResolvedValueOnce(null);
    await expect(api.todos.markReminderFired('missing')).resolves.toBeNull();
  });

  it('allowlists raw local/build truth without coercion or unknown-field passthrough', async () => {
    const bridge = makeBridge();
    const api = resolvedApi(bridge);
    const revision = `note:20:${'a'.repeat(64)}`;

    vi.mocked(bridge.notes.create).mockResolvedValueOnce({
      ...NOTE_RECORD,
      localState: 'LOCAL_SAVED',
      knowledgeBuild: {
        state: 'queued',
        revision,
        privateDetail: 'must-not-pass',
      },
      privateTopLevel: 'must-not-pass',
    } as unknown as NoteRecord);
    const queued = await api.notes.create({
      path: NOTE_RECORD.path,
      title: NOTE_RECORD.title,
      body: 'queued body',
    });
    expect(queued).toMatchObject({
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'queued', revision },
    });
    expect(queued).not.toHaveProperty('privateTopLevel');
    expect(queued.knowledgeBuild).toEqual({ state: 'queued', revision });

    vi.mocked(bridge.notes.update).mockResolvedValueOnce({
      ...NOTE_RECORD,
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'failed', revision },
    });
    await expect(api.notes.update(NOTE_RECORD.path, { body: 'failed body' }))
      .resolves.toMatchObject({
        localState: 'LOCAL_SAVED',
        knowledgeBuild: { state: 'failed', revision },
      });

    vi.mocked(bridge.notes.update).mockResolvedValueOnce({
      ...NOTE_RECORD,
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'not-ready', revision: null },
    });
    await expect(api.notes.update(NOTE_RECORD.path, { body: 'not ready body' }))
      .resolves.toMatchObject({
        localState: 'LOCAL_SAVED',
        knowledgeBuild: { state: 'not-ready', revision: null },
      });

    const invalidReceipts = [
      {
        ...NOTE_RECORD,
        localState: 'SAVED',
        knowledgeBuild: { state: 'ready', revision },
      },
      {
        ...NOTE_RECORD,
        localState: 'LOCAL_SAVED',
        knowledgeBuild: { state: 'current', revision },
      },
      {
        ...NOTE_RECORD,
        localState: 'LOCAL_SAVED',
        knowledgeBuild: { state: 'ready', revision: `note:20:${'A'.repeat(64)}` },
      },
      {
        ...NOTE_RECORD,
        localState: 'LOCAL_SAVED',
      },
    ] as unknown as NoteRecord[];
    for (const invalid of invalidReceipts) {
      vi.mocked(bridge.notes.create).mockResolvedValueOnce(invalid);
      const mapped = await api.notes.create({
        path: NOTE_RECORD.path,
        title: NOTE_RECORD.title,
        body: 'invalid receipt',
      });
      expect(mapped).not.toHaveProperty('localState');
      expect(mapped).not.toHaveProperty('knowledgeBuild');
    }
  });

  it('maps createWithBuild/updateWithBuild: missing null, update without body, and WIKI truth safe fields', async () => {
    const CURRENT_PROJECTION = {
      projectionId: 'p-current',
      notePath: NOTE_RECORD.path,
      status: 'current' as const,
      contentDigest: 'a'.repeat(64),
      summary: 'current summary',
      tags: ['local'],
      entityIds: ['concept:alpha'],
      relationSignatures: ['concept:alpha|related_to|concept:beta'],
      generatedAt: 1_753_000_000_000,
      failureStage: null,
      failureReason: null,
      provenance: { provider: 'minimax', model: 'MiniMax-M3', generatedAt: 1_753_000_000_000 },
    };
    const STALE_PROJECTION = {
      ...CURRENT_PROJECTION,
      projectionId: 'p-stale',
      status: 'stale' as const,
      contentDigest: 'b'.repeat(64),
    };
    const FAILED_PROJECTION = {
      ...CURRENT_PROJECTION,
      projectionId: 'p-failed',
      status: 'failed' as const,
      contentDigest: 'c'.repeat(64),
      summary: null,
      tags: [],
      entityIds: [],
      relationSignatures: [],
      failureStage: 'provider' as const,
      failureReason: 'WIKI_PROVIDER_DOWN',
      provenance: null,
    };
    const makeReceipt = (wikiTruth: 'current' | 'stale' | 'failed' | 'missing'): NoteCommitBuildReceipt => ({
      note: NOTE_RECORD,
      localState: 'LOCAL_SAVED',
      build: {
        state: wikiTruth === 'current' ? 'BUILT' : 'BUILD_FAILED',
        kg: { state: 'ready', entitiesAdded: 1, entitiesLinked: 1, reason: null },
        rag: { state: 'ready', chunksInserted: 1, reason: null },
        wiki: wikiTruth === 'current'
          ? { notePath: NOTE_RECORD.path, expectedContentDigest: 'a'.repeat(64), truth: 'current',
              projection: CURRENT_PROJECTION, current: CURRENT_PROJECTION, latest: CURRENT_PROJECTION,
              stale: [], failed: [], provenance: CURRENT_PROJECTION.provenance }
          : wikiTruth === 'stale'
          ? { notePath: NOTE_RECORD.path, expectedContentDigest: 'a'.repeat(64), truth: 'stale',
              projection: STALE_PROJECTION, current: null, latest: STALE_PROJECTION,
              stale: [STALE_PROJECTION], failed: [],
              provenance: { provider: 'minimax', model: 'MiniMax-M3', generatedAt: 1_753_000_000_000 } }
          : wikiTruth === 'failed'
          ? { notePath: NOTE_RECORD.path, expectedContentDigest: 'a'.repeat(64), truth: 'failed',
              projection: FAILED_PROJECTION, current: null, latest: null,
              stale: [], failed: [FAILED_PROJECTION], provenance: null }
          : MISSING_WIKI_RECEIPT,
        failureStage: wikiTruth === 'current' ? null : 'wiki',
        failureReason: wikiTruth === 'current' ? null
          : wikiTruth === 'stale' ? 'WIKI_STALE'
          : wikiTruth === 'failed' ? 'WIKI_PROVIDER_DOWN'
          : 'WIKI_MISSING',
      },
    });

    const bridge = makeBridge();
    vi.mocked(bridge.notes.createWithBuild).mockResolvedValue({
      ...makeReceipt('current'),
      note: {
        ...NOTE_RECORD,
        localState: 'LOCAL_SAVED',
        knowledgeBuild: {
          state: 'ready',
          revision: `note:20:${'a'.repeat(64)}`,
        },
      },
    });
    const api = resolvedApi(bridge);
    const legacyCreate = await api.notes.createWithBuild!({
      path: NOTE_RECORD.path,
      title: 'One',
      body: 'brand new',
    });
    expect(legacyCreate).toMatchObject({
      note: { path: NOTE_RECORD.path, body: 'brand new' },
      localState: 'LOCAL_SAVED',
      build: { state: 'BUILT', wiki: { truth: 'current',
        current: { contentDigest: 'a'.repeat(64) },
        latest: { contentDigest: 'a'.repeat(64) },
        stale: [], failed: [],
        provenance: { provider: 'minimax', model: 'MiniMax-M3' } } },
    });
    expect(legacyCreate.note).not.toHaveProperty('localState');
    expect(legacyCreate.note).not.toHaveProperty('knowledgeBuild');
    expect(bridge.notes.createWithBuild).toHaveBeenCalledWith(expect.objectContaining({
      path: NOTE_RECORD.path, title: 'One', body: 'brand new',
    }));

    // updateWithBuild with body: forwarded, no extra get needed.
    vi.mocked(bridge.notes.updateWithBuild).mockResolvedValueOnce(makeReceipt('current'));
    const withBody = await api.notes.updateWithBuild!(NOTE_RECORD.path, { title: 'Renamed', body: 'replaced' });
    expect(withBody).not.toBeNull();
    expect(withBody!.note.body).toBe('replaced');
    expect(withBody!.note.title).toBe(NOTE_RECORD.title);
    expect(withBody!.build.state).toBe('BUILT');
    expect(bridge.notes.updateWithBuild).toHaveBeenLastCalledWith({ path: NOTE_RECORD.path, patch: {
      title: 'Renamed', body: 'replaced', type: undefined, status: undefined, tags: undefined,
    } });
    expect(bridge.notes.get).not.toHaveBeenCalled();

    // updateWithBuild without body: the product API must fetch the current body
    // from bridge.notes.get and surface it on the returned note.
    vi.mocked(bridge.notes.get).mockResolvedValueOnce({
      note: { ...NOTE_RECORD, updatedAt: 30 },
      body: 'fetched current body',
    });
    vi.mocked(bridge.notes.updateWithBuild).mockResolvedValueOnce(makeReceipt('current'));
    // The mock returns NOTE_RECORD unchanged; the title is the record's title.
    const updated = await api.notes.updateWithBuild!(NOTE_RECORD.path, { title: 'No body change' });
    expect(updated).not.toBeNull();
    expect(updated!.note.body).toBe('fetched current body');
    expect(updated!.note.title).toBe(NOTE_RECORD.title);
    expect(bridge.notes.updateWithBuild).toHaveBeenLastCalledWith({ path: NOTE_RECORD.path, patch: {
      title: 'No body change', body: undefined, type: undefined, status: undefined, tags: undefined,
    } });
    expect(bridge.notes.get).toHaveBeenCalledWith(NOTE_RECORD.path);

    // updateWithBuild returning null: product API must return null and not call get.
    vi.mocked(bridge.notes.get).mockClear();
    vi.mocked(bridge.notes.updateWithBuild).mockResolvedValueOnce(null);
    await expect(api.notes.updateWithBuild!(NOTE_RECORD.path, { title: 'x' })).resolves.toBeNull();
    expect(bridge.notes.get).not.toHaveBeenCalled();

    // current / stale / failed / missing safe-field behavior is preserved through
    // the product mapping (renderer must display, not derive, the truth).
    for (const truth of ['current', 'stale', 'failed', 'missing'] as const) {
      vi.mocked(bridge.notes.updateWithBuild).mockReset();
      vi.mocked(bridge.notes.updateWithBuild).mockResolvedValueOnce(makeReceipt(truth));
      const receipt = await api.notes.updateWithBuild!(NOTE_RECORD.path, { body: 'x' });
      expect(receipt).toMatchObject({ build: { wiki: { truth } } });
      if (truth === 'current') {
        expect(receipt!.build.wiki).toMatchObject({
          expectedContentDigest: 'a'.repeat(64),
          projection: { contentDigest: 'a'.repeat(64) },
          current: { contentDigest: 'a'.repeat(64) },
          latest: { contentDigest: 'a'.repeat(64) },
          stale: [], failed: [],
          provenance: { provider: 'minimax', model: 'MiniMax-M3' },
        });
      } else if (truth === 'stale') {
        expect(receipt!.build.wiki).toMatchObject({
          expectedContentDigest: 'a'.repeat(64),
          projection: { contentDigest: 'b'.repeat(64), status: 'stale' },
          current: null,
          latest: { contentDigest: 'b'.repeat(64) },
          stale: [expect.objectContaining({ contentDigest: 'b'.repeat(64) })],
          failed: [],
          provenance: { provider: 'minimax', model: 'MiniMax-M3' },
        });
      } else if (truth === 'failed') {
        expect(receipt!.build.wiki).toMatchObject({
          expectedContentDigest: 'a'.repeat(64),
          projection: { contentDigest: 'c'.repeat(64), status: 'failed',
            summary: null, tags: [], entityIds: [], relationSignatures: [],
            failureStage: 'provider', failureReason: 'WIKI_PROVIDER_DOWN', provenance: null },
          current: null, latest: null, stale: [],
          failed: [expect.objectContaining({ contentDigest: 'c'.repeat(64),
            summary: null, tags: [], entityIds: [], relationSignatures: [],
            failureStage: 'provider', failureReason: 'WIKI_PROVIDER_DOWN', provenance: null })],
          provenance: null,
        });
      } else {
        expect(receipt!.build.wiki).toEqual(MISSING_WIKI_RECEIPT);
      }
    }
  });

  it('normalizes notes, data sources, graph source, and todo field aliases', async () => {
    const api = resolvedApi();
    expect(normalizeNoteList({ items: [NOTE_RECORD] })).toEqual([NOTE_RECORD]);
    expect(normalizeNoteList([NOTE_RECORD])).toEqual([NOTE_RECORD]);
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote({ note: NOTE_RECORD, body: 'body' })).toMatchObject({ path: NOTE_RECORD.path, body: 'body' });
    expect(normalizeNote({ ...NOTE_RECORD, body: 'body' })).toMatchObject({ body: 'body' });

    const noteSource = createNoteDataSource(api);
    await expect(noteSource.getNote(NOTE_RECORD.path)).resolves.toMatchObject({
      id: NOTE_RECORD.path, body: '# body', tags: ['local'], updatedAt: 20,
    });
    await expect(noteSource.getBacklinks(NOTE_RECORD.path)).resolves.toEqual([
      { sourceId: 'notes/from.md', sourceTitle: 'notes/from.md', sourcePath: 'notes/from.md', excerpt: 'ref' },
    ]);
    const missingApi = makeProductApi({ notes: { ...api.notes, get: vi.fn(async () => null) } });
    await expect(createNoteDataSource(missingApi).getNote('missing')).resolves.toBeNull();
    await expect(createKgDataSource(api).getSubgraph(2)).resolves.toEqual({ nodes: [], edges: [], degree: {} });

    expect(todoDueAt({ id: 1, title: 'x', status: 'pending', dueAt: 4, due_at_ms: 5 })).toBe(4);
    expect(todoDueAt({ id: 1, title: 'x', status: 'pending' })).toBeNull();
    expect(todoRemindAt({ id: 1, title: 'x', status: 'pending', remind_at_ms: 6 })).toBe(6);
    expect(todoRemindAt({ id: 1, title: 'x', status: 'pending', remindAt: 7, remind_at_ms: 6 })).toBe(7);
    expect(todoRemindAt({ id: 1, title: 'x', status: 'pending' })).toBeNull();
    expect(todoNoteLinks({ id: 1, title: 'x', status: 'pending', linkedNotePaths: ['x'], note_links: ['y'] })).toEqual(['x']);
    expect(todoNoteLinks({ id: 1, title: 'x', status: 'pending' })).toEqual([]);
  });

  it('uses the window bridge default, supports ask-only RAG, and fills adapter fallbacks', async () => {
    const bridge = makeBridge();
    Object.defineProperty(window, 'copilot', { configurable: true, writable: true, value: bridge });
    expect(resolveCopilotProductApi().api).not.toBeNull();

    const complete = makeBridge();
    const askOnly = {
      ...complete,
      rag: { ask: complete.rag.ask },
    } as unknown as CopilotDomainBridge;
    expect(resolveCopilotProductApi(askOnly).api?.rag.stream).toBeUndefined();

    vi.mocked(bridge.notes.update).mockResolvedValueOnce(NOTE_RECORD);
    vi.mocked(bridge.notes.get).mockResolvedValueOnce(null);
    await expect(resolvedApi(bridge).notes.update(NOTE_RECORD.path, { title: 'no body' }))
      .resolves.toMatchObject({ body: '' });

    vi.mocked(bridge.notes.getBacklinks).mockResolvedValueOnce([
      { fromPath: 'from-null', toPath: NOTE_RECORD.path, relation: null },
    ]);
    await expect(resolvedApi(bridge).notes.getBacklinks(NOTE_RECORD.path))
      .resolves.toEqual([expect.objectContaining({ excerpt: '' })]);

    const fallbackApi = makeProductApi({ notes: {
      ...resolvedApi(bridge).notes,
      get: vi.fn(async () => ({
        path: 'fallback', title: 'Fallback', body: 'body', tags: undefined,
        updatedAt: undefined, updated_at: 22,
      })),
      getBacklinks: vi.fn(async () => [{
        source_id: 'snake-id', source_title: 'Snake', source_path: 'snake/path',
      }, { fromPath: 'from/path' }, {}]),
    } });
    await expect(createNoteDataSource(fallbackApi).getNote('fallback'))
      .resolves.toMatchObject({ tags: [], updatedAt: 22 });
    await expect(createNoteDataSource(fallbackApi).getBacklinks('fallback')).resolves.toEqual([
      { sourceId: 'snake-id', sourceTitle: 'Snake', sourcePath: 'snake/path', excerpt: '' },
      { sourceId: 'from/path', sourceTitle: 'from/path', sourcePath: 'from/path', excerpt: '' },
      { sourceId: '', sourceTitle: '', sourcePath: '', excerpt: '' },
    ]);
  });

  it('resolves, rejects, cancels, and cleans real RAG stream handles', async () => {
    const bridge = makeBridge() as CopilotDomainBridge & { getStreamListener(): ((event: RagStreamEvent) => void) | null };
    const api = resolvedApi(bridge);
    const events: RagStreamEvent[] = [];
    const handle = api.rag.stream!('question', (event) => events.push(event));
    bridge.getStreamListener()?.({ requestId: 'other', type: 'cancel' });
    bridge.getStreamListener()?.({ requestId: handle.requestId, type: 'delta', delta: 'a', sources: [] });
    bridge.getStreamListener()?.({ requestId: handle.requestId, type: 'final', answer: { text: 'done', sources: [] } });
    await expect(handle.done).resolves.toEqual({ text: 'done', sources: [] });
    expect(events).toHaveLength(2);
    await expect(handle.cancel()).resolves.toBeUndefined();

    const errorBridge = makeBridge() as CopilotDomainBridge & { getStreamListener(): ((event: RagStreamEvent) => void) | null };
    const errorHandle = resolvedApi(errorBridge).rag.stream!('q', () => undefined);
    errorBridge.getStreamListener()?.({ requestId: errorHandle.requestId, type: 'error', code: 'OFFLINE', message: 'down' });
    await expect(errorHandle.done).rejects.toThrow('[OFFLINE] down');

    const cancelBridge = makeBridge() as CopilotDomainBridge & { getStreamListener(): ((event: RagStreamEvent) => void) | null };
    const cancelHandle = resolvedApi(cancelBridge).rag.stream!('q', () => undefined);
    cancelBridge.getStreamListener()?.({ requestId: cancelHandle.requestId, type: 'cancel' });
    await expect(cancelHandle.done).rejects.toMatchObject({ name: 'AbortError' });

    const listenerBridge = makeBridge() as CopilotDomainBridge & { getStreamListener(): ((event: RagStreamEvent) => void) | null };
    const listenerHandle = resolvedApi(listenerBridge).rag.stream!('q', () => { throw new Error('ui broke'); });
    listenerBridge.getStreamListener()?.({ requestId: listenerHandle.requestId, type: 'delta', delta: 'x', sources: [] });
    await expect(listenerHandle.done).rejects.toThrow('listener failed');
  });

  it('fails a stream on start mismatch/rejection and explicit cancellation', async () => {
    const mismatch = makeBridge();
    vi.mocked(mismatch.rag.startStream).mockResolvedValueOnce({ requestId: 'wrong', accepted: true });
    const mismatchHandle = resolvedApi(mismatch).rag.stream!('q', () => undefined);
    await expect(mismatchHandle.done).rejects.toThrow('request mismatch');

    const failed = makeBridge();
    vi.mocked(failed.rag.startStream).mockRejectedValueOnce('offline');
    const failedHandle = resolvedApi(failed).rag.stream!('q', () => undefined);
    await expect(failedHandle.done).rejects.toThrow('offline');

    const cancelled = makeBridge();
    vi.mocked(cancelled.rag.cancelStream).mockRejectedValueOnce(new Error('cancel IPC failed'));
    const cancelledHandle = resolvedApi(cancelled).rag.stream!('q', () => undefined);
    const done = expect(cancelledHandle.done).rejects.toMatchObject({ name: 'AbortError' });
    await expect(cancelledHandle.cancel()).rejects.toThrow('cancel IPC failed');
    await done;

    const errorFailure = makeBridge();
    vi.mocked(errorFailure.rag.startStream).mockRejectedValueOnce(new Error('typed offline'));
    const errorFailureHandle = resolvedApi(errorFailure).rag.stream!('q', () => undefined);
    await expect(errorFailureHandle.done).rejects.toThrow('typed offline');

    const successCancel = makeBridge();
    const successCancelHandle = resolvedApi(successCancel).rag.stream!('q', () => undefined);
    const cancelledDone = expect(successCancelHandle.done).rejects.toMatchObject({ name: 'AbortError' });
    await expect(successCancelHandle.cancel()).resolves.toBeUndefined();
    await cancelledDone;
  });

  it('uses a deterministic stream id fallback when randomUUID is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    const now = vi.spyOn(Date, 'now').mockReturnValue(123);
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    const bridge = makeBridge() as CopilotDomainBridge & { getStreamListener(): ((event: RagStreamEvent) => void) | null };
    const handle = resolvedApi(bridge).rag.stream!('q', () => undefined);
    expect(handle.requestId).toMatch(/^rag-123-/);
    bridge.getStreamListener()?.({ requestId: handle.requestId, type: 'final', answer: { text: 'ok', sources: [] } });
    await expect(handle.done).resolves.toMatchObject({ text: 'ok' });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    now.mockRestore();
  });
});

describe('AskWorkspace critical interaction', () => {
  it('keeps path-only sources unknown, never synthesizes evidence, and blocks navigation', async () => {
    const ask = vi.fn(async (): Promise<CopilotRagAnswer> => ({ text: 'Local answer', sources: ['notes/source.md'] }));
    const get = vi.fn();
    const onOpenSource = vi.fn();
    const api = makeProductApi({ notes: { get }, rag: { ask, stream: undefined } });
    render(<AskWorkspace api={api} onOpenSource={onOpenSource} />);
    const input = screen.getByLabelText('问题');
    const submit = screen.getByRole('button', { name: '提问' });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(ask).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' What? ' } });
    fireEvent.click(submit);
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('Local answer');
    expect(ask).toHaveBeenCalledWith('What?');
    expect(screen.getAllByText(/SOURCE_DETAILS_ABSENT/).length).toBeGreaterThan(0);
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/向量相似度/)).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    const source = screen.getByRole('button', { name: 'notes/source.md' });
    expect(source).toBeDisabled();
    fireEvent.click(source);
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it('checks an aligned detail locally, renders bounded text, copies, and opens local-present', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const get = vi.fn(async () => ({
      note: { ...NOTE_RECORD, path: 'notes/kg.md', title: 'KG Source' },
      body: '# Heading\u0000  local   preview',
    }));
    const ask = vi.fn(async (): Promise<CopilotRagAnswer> => ({
      text: '',
      sources: [' notes/kg.md '],
      sourceDetails: [{ notePath: 'notes/kg.md', evidence: ['vector', 'kg-entity', 'kg-neighbor'], score: 0.91 }],
    }));
    const onOpenSource = vi.fn();
    const api = makeProductApi({ notes: { get }, rag: { ask, stream: undefined } });
    render(<AskWorkspace api={api} onOpenSource={onOpenSource} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('知识库内未找到相关笔记');
    expect(await screen.findByText('LOCAL_PRESENT')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('notes/kg.md');
    expect(screen.getByText('标题：KG Source')).toBeInTheDocument();
    expect(screen.getByText('预览：# Heading local preview')).toBeInTheDocument();
    expect(screen.getByTitle('引用依据：向量相似度 + 知识图谱实体 + 知识图谱邻接')).toHaveTextContent('score 0.91');
    const source = screen.getByRole('button', { name: 'notes/kg.md' });
    expect(source).toBeEnabled();
    fireEvent.click(source);
    expect(onOpenSource).toHaveBeenCalledWith('notes/kg.md');
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }));
    expect(await screen.findByTestId('copy-status-answer')).toHaveTextContent('已复制');
    expect(writeText).toHaveBeenCalledWith('知识库内未找到相关笔记。');
    fireEvent.click(screen.getByRole('button', { name: '复制来源凭据 notes/kg.md' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('SOURCE_LOCAL_PRESENT')));
  });

  it('fails closed for invalid, mismatched, duplicate, and empty source identities', async () => {
    const get = vi.fn();
    const answer = {
      text: 'answer',
      sources: ['notes/invalid.md', 'notes/mismatch-a.md', 'notes/duplicate.md', 'notes/duplicate.md', ''],
      sourceDetails: [
        { notePath: 'notes/invalid.md', evidence: ['remote'], score: Number.NaN },
        { notePath: 'notes/mismatch-b.md', evidence: ['vector'], score: 0.5 },
        { notePath: 'notes/duplicate.md', evidence: ['vector'], score: 0.5 },
      ],
    } as unknown as CopilotRagAnswer;
    const api = makeProductApi({ notes: { get }, rag: { stream: undefined, ask: vi.fn(async () => answer) } });
    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('answer');
    expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/SOURCE_DETAIL_INVALID/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SOURCE_ID_MISMATCH/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SOURCE_ID_DUPLICATE/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/向量相似度/)).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('distinguishes local present, missing, and unavailable and gates navigation', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === 'notes/present.md') {
        return { note: { ...NOTE_RECORD, path, title: 'Present' }, body: 'present body' };
      }
      if (path === 'notes/missing.md') return null;
      throw new Error('raw provider detail must not escape');
    });
    const sources = ['notes/present.md', 'notes/missing.md', 'notes/unavailable.md'];
    const sourceDetails: NonNullable<CopilotRagAnswer['sourceDetails']> = sources.map((notePath) => ({
      notePath,
      evidence: ['vector'],
      score: 0.5,
    }));
    const onOpenSource = vi.fn();
    const api = makeProductApi({
      notes: { get },
      rag: { stream: undefined, ask: vi.fn(async () => ({ text: 'answer', sources, sourceDetails })) },
    });
    render(<AskWorkspace api={api} onOpenSource={onOpenSource} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('LOCAL_PRESENT')).toBeInTheDocument();
    expect(await screen.findByText('MISSING')).toBeInTheDocument();
    expect(await screen.findByText('UNAVAILABLE')).toBeInTheDocument();
    const present = screen.getByRole('button', { name: 'notes/present.md' });
    const missing = screen.getByRole('button', { name: 'notes/missing.md' });
    const unavailable = screen.getByRole('button', { name: 'notes/unavailable.md' });
    expect(present).toBeEnabled();
    expect(missing).toBeDisabled();
    expect(unavailable).toBeDisabled();
    fireEvent.click(present);
    fireEvent.click(missing);
    fireEvent.click(unavailable);
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onOpenSource).toHaveBeenCalledWith('notes/present.md');
  });

  it('suppresses a late source read after a newer question', async () => {
    const oldRead = deferred<Awaited<ReturnType<CopilotProductApi['notes']['get']>>>();
    const ask = vi.fn()
      .mockResolvedValueOnce({
        text: 'old answer',
        sources: ['notes/old.md'],
        sourceDetails: [{ notePath: 'notes/old.md', evidence: ['vector'], score: 0.5 }],
      })
      .mockResolvedValueOnce({
        text: 'new answer',
        sources: ['notes/new.md'],
        sourceDetails: [{ notePath: 'notes/new.md', evidence: ['vector'], score: 0.6 }],
      });
    const get = vi.fn((path: string) => path === 'notes/old.md'
      ? oldRead.promise
      : Promise.resolve({ note: { ...NOTE_RECORD, path, title: 'New title' }, body: 'new body' }));
    const api = makeProductApi({ notes: { get }, rag: { ask, stream: undefined } });
    render(<AskWorkspace api={api} />);
    const input = screen.getByLabelText('问题');
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('notes/old.md'));
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('标题：New title')).toBeInTheDocument();
    oldRead.resolve({ note: { ...NOTE_RECORD, path: 'notes/old.md', title: 'Old title' }, body: 'old body' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('标题：Old title')).not.toBeInTheDocument();
  });

  it('reports stable copy failure without exposing raw exception', async () => {
    const writeText = vi.fn(async () => { throw new Error('secret raw clipboard failure'); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const api = makeProductApi({
      notes: { get: vi.fn() },
      rag: { stream: undefined, ask: vi.fn(async () => ({ text: 'answer', sources: ['notes/path-only.md'] })) },
    });
    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await screen.findByTestId('rag-answer');
    fireEvent.click(screen.getByRole('button', { name: '复制来源凭据 notes/path-only.md' }));
    expect(await screen.findByTestId('copy-status-source-notes/path-only.md')).toHaveTextContent('复制不可用');
    expect(screen.queryByText(/secret raw clipboard failure/)).not.toBeInTheDocument();
  });

  it.each([
    [new Error('[CONFIG_REQUIRED] key missing'), '请先在设置中完成模型服务配置', 'RAG_CONFIG_REQUIRED'],
    [new Error('[OFFLINE] down'), '本地 AI 服务暂不可用', 'RAG_OFFLINE'],
    [new Error('offline'), '本地 AI 服务暂不可用', 'RAG_OFFLINE'],
    ['boom', '本地知识问答失败', 'RAG_REQUEST_FAILED'],
  ])('maps ask failure %# to safe text and stable reason', async (failure, expected, reason) => {
    const api = makeProductApi({ rag: { stream: undefined, ask: vi.fn(async () => { throw failure; }) } });
    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent(expected);
    expect(screen.getByTestId('workspace-state-error')).toHaveTextContent(reason);
    expect(screen.queryByText(/key missing|down|boom/)).not.toBeInTheDocument();
  });

  it('offers retry and copies only stable diagnostic reason', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const ask = vi.fn()
      .mockRejectedValueOnce(new Error('[OFFLINE] provider response'))
      .mockResolvedValueOnce({ text: 'Recovered', sources: [] });
    const api = makeProductApi({ rag: { ask, stream: undefined } });
    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'retry me' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('RAG_OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: '复制诊断' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('问答失败\nRAG_OFFLINE'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('Recovered');
    expect(ask).toHaveBeenNthCalledWith(2, 'retry me');
  });

  it('streams deltas, keeps cancellation terminal, and cancels once', async () => {
    const done = deferred<CopilotRagAnswer>();
    const cancel = vi.fn(async () => undefined);
    let onEvent: ((event: RagStreamEvent) => void) | null = null;
    const stream = vi.fn((_question: string, listener: (event: RagStreamEvent) => void) => {
      onEvent = listener;
      return { requestId: 'req', done: done.promise, cancel };
    });
    const get = vi.fn(async () => ({
      note: { ...NOTE_RECORD, path: 'notes/live.md', title: 'Live' },
      body: 'live',
    }));
    const api = makeProductApi({ notes: { get }, rag: { ask: vi.fn(), stream } });
    const view = render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'stream me' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('正在检索本地知识并生成回答…')).toBeInTheDocument();
    act(() => onEvent?.({
      requestId: 'req',
      type: 'delta',
      delta: 'partial',
      sources: [{ notePath: 'notes/live.md', evidence: ['vector'], score: 0.9 }],
    }));
    expect(screen.getByTestId('rag-answer')).toHaveTextContent('partial');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByText('已取消本次问答')).toBeInTheDocument();
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await act(async () => done.resolve({ text: 'late final', sources: ['notes/live.md'] }));
    expect(screen.queryByText('late final')).not.toBeInTheDocument();
    expect(screen.getByTestId('rag-answer')).toHaveTextContent('partial');
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('ignores abort rejection and cancels an active stream during unmount', async () => {
    const done = deferred<CopilotRagAnswer>();
    const cancel = vi.fn(async () => { throw new Error('cancel ignored'); });
    const api = makeProductApi({ rag: {
      ask: vi.fn(),
      stream: vi.fn(() => ({ requestId: 'req', done: done.promise, cancel })),
    } });
    const view = render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    await waitFor(() => expect(api.rag.stream).toHaveBeenCalled());
    view.unmount();
    expect(cancel).toHaveBeenCalled();
    done.reject(new DOMException('cancel', 'AbortError'));
    await act(async () => { await Promise.resolve(); });
  });

  it.each([
    ['checking', 'polite'],
    ['unknown', 'polite'],
    ['stale', 'polite'],
    ['unavailable', 'assertive'],
  ] as const)('adds the %s WorkspaceState without changing stable DOM', (kind, live) => {
    render(<WorkspaceState kind={kind} title={`${kind} title`} detail={`${kind} detail`} />);
    const state = screen.getByTestId(`workspace-state-${kind}`);
    expect(state).toHaveAttribute('aria-live', live);
    expect(state).toHaveTextContent(`${kind} title`);
    expect(state).toHaveTextContent(`${kind} detail`);
  });
});

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  static instances: FakeNotification[] = [];
  onclick: ((this: Notification, ev: Event) => unknown) | null = null;
  onclose: ((this: Notification, ev: Event) => unknown) | null = null;
  close = vi.fn();
  constructor(public readonly title: string, public readonly options?: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

function todo(overrides: Partial<CopilotTodo> = {}): CopilotTodo {
  return {
    id: 'todo-1',
    title: 'Ship MVP',
    status: 'pending',
    due_at_ms: Date.UTC(2026, 6, 20, 9, 30),
    remind_at_ms: Date.UTC(2026, 6, 20, 9, 0),
    note_links: ['notes/one.md'],
    ...overrides,
  };
}

function rendererTrashItem(
  kind: RendererTrashItem['kind'],
  id: string | number,
  title: string,
  state: RendererTrashItem['state'] = 'trashed',
): RendererTrashItem {
  return {
    trashId: `trash-${String(id)}`,
    kind,
    title,
    revision: `trash:${String(id)}:1`,
    state,
    movedAt: 1,
    recoveryRequired: false,
  };
}

function todoApi(items: CopilotTodo[], dueItems: CopilotTodo[] = []): CopilotProductApi {
  return makeProductApi({
    todos: {
      list: vi.fn(async () => items),
      listDue: vi.fn(async () => dueItems),
      create: vi.fn(async (input) => todo({ id: 'new', title: input.title, dueAt: input.dueAt, linkedNotePaths: input.linkedNotePaths })),
      update: vi.fn(async (id, patch) => todo({ id, ...patch })),
      remove: vi.fn(async () => true),
      markReminderFired: vi.fn(async (id) => todo({ id })),
    },
    trash: {
      moveNote: vi.fn(async (path) => rendererTrashItem('note', path, path)),
      moveTodo: vi.fn(async (id) => rendererTrashItem(
        'todo',
        id,
        items.find((item) => String(item.id) === String(id))?.title ?? String(id),
      )),
      list: vi.fn(async () => []),
      restore: vi.fn(async (request) => rendererTrashItem('todo', request.trashId, 'Restored', 'restored')),
      purge: vi.fn(async (request) => rendererTrashItem('todo', request.trashId, 'Purged', 'purged')),
    },
  });
}

describe('ScheduleWorkspace critical interaction', () => {
  const originalNotification = globalThis.Notification;

  afterEach(() => {
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: originalNotification });
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission.mockReset().mockResolvedValue('granted');
    FakeNotification.instances = [];
  });

  it('loads unique todos, handles reminder acknowledgement, CRUD, links, and calendar grouping', async () => {
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: FakeNotification });
    const dated = todo();
    const inbox = todo({ id: 'todo-2', title: 'Inbox item', due_at_ms: dated.due_at_ms, note_links: [] });
    const doneTodo = todo({ id: 'todo-3', title: 'Already done', status: 'done', dueAt: dated.due_at_ms });
    const api = todoApi([dated, { ...dated, title: 'deduped' }, inbox, doneTodo], [dated, dated]);
    const onOpenNote = vi.fn();
    render(<ScheduleWorkspace api={api} onOpenNote={onOpenNote} />);
    await waitFor(() => expect(api.todos.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '选择日期 2026-07-20' }));
    expect(await screen.findByRole('checkbox', { name: '完成 deduped' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '待办列表' }).children).toHaveLength(3);
    expect(screen.getByText('提醒：Ship MVP')).toBeInTheDocument();
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0]?.options).toMatchObject({ tag: 'copilot-todo-todo-1', requireInteraction: true });

    fireEvent.click(screen.getAllByRole('button', { name: '打开笔记：notes/one.md' })[0]!);
    expect(onOpenNote).toHaveBeenCalledWith('notes/one.md');
    fireEvent.click(screen.getByRole('checkbox', { name: '完成 deduped' }));
    await waitFor(() => expect(api.todos.update).toHaveBeenCalledWith('todo-1', { status: 'done' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '完成 Already done' }));
    await waitFor(() => expect(api.todos.update).toHaveBeenCalledWith('todo-3', { status: 'pending' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 Inbox item' }));
    await waitFor(() => expect(api.trash?.moveTodo).toHaveBeenCalledWith('todo-2'));
    expect(await screen.findByTestId('schedule-trash-feedback')).toHaveTextContent('Inbox item');
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
    await waitFor(() => expect(api.trash?.restore).toHaveBeenCalledWith({
      trashId: 'trash-todo-2',
      revision: 'trash:todo-2:1',
    }));

    fireEvent.click(screen.getByRole('button', { name: /\+ 新增待办/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办标题' }), { target: { value: ' New task ' } });
    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    fireEvent.change(screen.getByLabelText('临时日期与提醒时间'), { target: { value: '2026-07-21T10:30' } });
    fireEvent.click(screen.getByRole('button', { name: '使用此时间' }));
    fireEvent.change(screen.getByRole('combobox', { name: '搜索关联笔记' }), { target: { value: 'One' } });
    fireEvent.click(screen.getByRole('option', { name: /One/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New task', linkedNotePaths: ['notes/one.md'], dueAt: expect.any(Number), remindAt: expect.any(Number),
    })));

    expect(screen.getByLabelText('日历与当日概览')).toBeInTheDocument();
    expect(screen.getByLabelText('月历')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '待办列表' })).toHaveTextContent('Inbox item');
    expect(screen.queryByRole('button', { name: '日历视图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '列表视图' })).not.toBeInTheDocument();

    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const notification = FakeNotification.instances[0]!;
    await act(async () => {
      notification.onclick?.call(notification as unknown as Notification, new Event('click'));
      await Promise.resolve();
    });
    expect(focus).toHaveBeenCalled();

    await waitFor(() => expect(api.todos.markReminderFired).toHaveBeenCalledWith('todo-1'));
    await waitFor(() => expect(screen.queryByText('提醒：Ship MVP')).not.toBeInTheDocument());
    expect(FakeNotification.instances[0]?.close).toHaveBeenCalled();
    notification.onclose?.call(notification as unknown as Notification, new Event('close'));
  });

  it('shows the Demo-first calendar and empty truth, then creates without optional fields', async () => {
    const api = todoApi([]);
    render(<ScheduleWorkspace api={api} />);
    expect(await screen.findByText('暂无待办')).toBeInTheDocument();
    expect(screen.getByLabelText('月历')).toBeInTheDocument();
    expect(screen.getByText('这一天还没有本地待办。')).toBeInTheDocument();
    expect(screen.getByText('选中日期没有时间线项目。')).toBeInTheDocument();
    expect(screen.getByText('0 项当天待办 · 数据来自本地日程')).toBeInTheDocument();
    expect(screen.getByText('0 项未完成')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\+ 新增待办/ }));
    const title = screen.getByRole('textbox', { name: '待办标题' });
    fireEvent.submit(title.closest('form')!);
    expect(api.todos.create).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: 'No date' } });
    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    fireEvent.click(screen.getByRole('button', { name: '无日期' }));
    fireEvent.click(screen.getByRole('button', { name: '使用此时间' }));
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith({
      title: 'No date', dueAt: null, remindAt: null, linkedNotePaths: [],
    }));
  });

  it('surfaces refresh, create, mutate, and acknowledgement failures and supports retry', async () => {
    const api = todoApi([todo()], [todo()]);
    vi.mocked(api.todos.list).mockRejectedValueOnce('read failed');
    render(<ScheduleWorkspace api={api} />);
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('read failed');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(api.todos.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '选择日期 2026-07-20' }));
    expect(await screen.findByRole('checkbox', { name: '完成 Ship MVP' })).toBeInTheDocument();

    vi.mocked(api.todos.create).mockRejectedValueOnce(new Error('create failed'));
    fireEvent.click(screen.getByRole('button', { name: /\+ 新增待办/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办标题' }), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    fireEvent.click(screen.getByRole('button', { name: '无日期' }));
    fireEvent.click(screen.getByRole('button', { name: '使用此时间' }));
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('create failed');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    vi.mocked(api.todos.update).mockRejectedValueOnce('toggle failed');
    fireEvent.click(screen.getByRole('checkbox', { name: '完成 Ship MVP' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('toggle failed');

    vi.mocked(api.todos.markReminderFired).mockRejectedValueOnce(new Error('ack failed'));
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('ack failed');
  });

  it('requests notification permission once, handles denial/throwing constructors, and closes on unmount', async () => {
    FakeNotification.permission = 'default';
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: FakeNotification });
    const api = todoApi([todo()], [todo()]);
    const view = render(<ScheduleWorkspace api={api} />);
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1));
    // The initial empty-due effect is cancelled by refresh before the
    // permission promise settles, so no stale notification may be emitted.
    expect(FakeNotification.instances).toHaveLength(0);
    view.unmount();

    class ThrowingNotification extends FakeNotification {
      static permission: NotificationPermission = 'granted';
      constructor(title: string, options?: NotificationOptions) {
        super(title, options);
        throw new Error('notifications blocked');
      }
    }
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: ThrowingNotification });
    render(<ScheduleWorkspace api={todoApi([todo()], [todo()])} />);
    await waitFor(() => expect(screen.getByText('提醒：Ship MVP')).toBeInTheDocument());
  });

  it('contains permission, create, mutate, and acknowledge nonstandard failures', async () => {
    class RejectedPermission extends FakeNotification {
      static permission: NotificationPermission = 'default';
      static requestPermission = vi.fn(async (): Promise<NotificationPermission> => { throw new Error('permission failed'); });
    }
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: RejectedPermission });
    const api = todoApi([todo()], [todo()]);
    const view = render(<ScheduleWorkspace api={api} />);
    await waitFor(() => expect(RejectedPermission.requestPermission).toHaveBeenCalled());
    view.unmount();

    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: undefined });
    const api2 = todoApi([todo()], [todo()]);
    const second = render(<ScheduleWorkspace api={api2} />);
    await waitFor(() => expect(api2.todos.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '选择日期 2026-07-20' }));
    expect(await screen.findByRole('checkbox', { name: '完成 Ship MVP' })).toBeInTheDocument();
    vi.mocked(api2.todos.create).mockRejectedValueOnce('create string');
    fireEvent.click(screen.getByRole('button', { name: /\+ 新增待办/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办标题' }), { target: { value: 'bad create' } });
    fireEvent.click(screen.getByRole('button', { name: '选择日期与提醒' }));
    fireEvent.click(screen.getByRole('button', { name: '无日期' }));
    fireEvent.click(screen.getByRole('button', { name: '使用此时间' }));
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('create string');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    vi.mocked(api2.trash!.moveTodo).mockRejectedValueOnce(new Error('remove error'));
    fireEvent.click(screen.getByRole('button', { name: '删除 Ship MVP' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('remove error');
    vi.mocked(api2.todos.markReminderFired).mockRejectedValueOnce('ack string');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('ack string');
    second.unmount();
  });
});
