import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    expose: vi.fn(),
    invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      () => Promise.resolve({ ok: true }),
    ),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
    }),
    removeListener: vi.fn(),
    send: vi.fn(),
    listeners,
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
  },
}));

type AsyncMethod = (...args: unknown[]) => Promise<unknown>;
type MethodGroup = Record<string, AsyncMethod>;

interface ExposedBridge {
  settings: MethodGroup;
  window: MethodGroup;
  startup: {
    getMilestones: AsyncMethod;
    appRootVisible(): void;
    isComplete(): boolean;
  };
  localAsr: MethodGroup;
  notes: MethodGroup;
  wiki: MethodGroup;
  kg: MethodGroup;
  rag: MethodGroup & {
    onStreamEvent(listener: (event: unknown) => void): () => void;
  };
  askConversation: MethodGroup;
  todos: MethodGroup;
}

describe('preload domain bridge behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    electron.expose.mockClear();
    electron.invoke.mockReset();
    electron.invoke.mockImplementation((channel: unknown, payload?: unknown) => {
      if (channel === 'copilot:local-asr:status') {
        return Promise.resolve(jsonRoundTrip({
          ok: true,
          value: {
            state: 'NOT_READY',
            active: false,
            lastErrorCode: null,
          },
        }));
      }
      if (channel === 'copilot:local-asr:decode') {
        const request = payload as { requestId: string };
        return Promise.resolve(jsonRoundTrip({
          ok: true,
          value: {
            requestId: request.requestId,
            transcript: '本地语音',
            timings: { decodeMs: 1, totalMs: 2 },
          },
        }));
      }
      if (channel === 'copilot:local-asr:cancel') {
        return Promise.resolve(jsonRoundTrip({
          ok: true,
          value: { requestId: payload, cancelled: true },
        }));
      }
      return Promise.resolve({ ok: true });
    });
    electron.on.mockClear();
    electron.removeListener.mockClear();
    electron.send.mockClear();
    electron.listeners.clear();
  });

  it('routes every public bridge operation and owns listener lifecycle', async () => {
    await import('../src/main/preload.js');
    const bridge = electron.expose.mock.calls[0]?.[1] as ExposedBridge;

    await bridge.settings.get();
    await bridge.settings.setCloudBackup(true);
    await bridge.settings.setTheme('dark');
    await bridge.settings.setWindowBounds({ x: 1, y: 2, width: 800, height: 600 });
    await bridge.settings.setShortcuts([{ id: 'quick-note', accelerator: 'Cmd+N' }]);
    await bridge.settings.setModelApi({ provider: 'minimax', baseUrl: 'http://127.0.0.1', model: 'm', apiKey: '' });
    await bridge.settings.reset();

    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.close();

    await bridge.startup.getMilestones();
    bridge.startup.appRootVisible();
    expect(bridge.startup.isComplete()).toBe(false);
    electron.listeners.get('copilot:startup:complete')?.({});
    expect(bridge.startup.isComplete()).toBe(true);

    const localAsrRequest = {
      requestId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
      format: 'PCM16LE',
      sampleRate: 16_000,
      channels: 1,
      byteLength: 4,
      sampleCount: 2,
      sha256: 'a'.repeat(64),
      pcm: new Uint8Array([0, 0, 1, 0]),
    };
    await bridge.localAsr.status();
    await bridge.localAsr.decode(localAsrRequest);
    await bridge.localAsr.cancel(localAsrRequest.requestId);

    await bridge.notes.list({ limit: 2 });
    await bridge.notes.get('notes/a');
    await bridge.notes.create({ path: 'notes/a' });
    await bridge.notes.createWithBuild({ path: 'notes/a' });
    await bridge.notes.update({ path: 'notes/a', patch: { title: 'A' } });
    await bridge.notes.updateWithBuild({ path: 'notes/a', patch: { title: 'A' } });
    await bridge.notes.remove('notes/a');
    await bridge.notes.getBacklinks('notes/a');
    await bridge.wiki.getForNote('notes/a');
    await bridge.kg.getSubgraph({ center: 'person:a' });
    await bridge.kg.reindexNote('notes/a');
    await bridge.rag.ask('question');
    await bridge.rag.startStream({ question: 'question', requestId: 'r1' });
    await bridge.rag.cancelStream('r1');

    const streamListener = vi.fn();
    const unsubscribe = bridge.rag.onStreamEvent(streamListener);
    const streamWrapper = electron.listeners.get('copilot:rag:stream-event');
    streamWrapper?.({}, { type: 'delta', requestId: 'r1', delta: 'x' });
    expect(streamListener).toHaveBeenCalledWith({ type: 'delta', requestId: 'r1', delta: 'x' });
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith('copilot:rag:stream-event', streamWrapper);

    await bridge.askConversation.save({
      exchangeId: 'exchange-1',
      phase: 'completed',
      question: 'question',
      answer: { text: 'answer', sources: ['notes/a'], sourceDetails: [] },
      todoReceipt: null,
      completedAt: 1,
    });
    await bridge.askConversation.load();
    await bridge.askConversation.clear();

    await bridge.todos.list({ status: 'pending' });
    await bridge.todos.create({ title: 'Todo' });
    await bridge.todos.update({ id: 't1', patch: { status: 'done' } });
    await bridge.todos.remove('t1');
    await bridge.todos.listDue(123);
    await bridge.todos.markReminderFired('t1');

    expect(electron.invoke).toHaveBeenCalledTimes(37);
    expect(electron.invoke).toHaveBeenCalledWith('copilot:settings:set-window-bounds', {
      x: 1, y: 2, width: 800, height: 600,
    });
    expect(electron.invoke).toHaveBeenCalledWith('copilot:notes:get', 'notes/a');
    expect(electron.invoke).toHaveBeenCalledWith('copilot:wiki:get-for-note', 'notes/a');
    expect(electron.invoke).toHaveBeenCalledWith('copilot:kg:reindex-note', 'notes/a');
    expect(electron.invoke).toHaveBeenCalledWith('copilot:todos:list-due', 123);
    expect(electron.invoke).toHaveBeenCalledWith('copilot:local-asr:status', undefined);
    expect(electron.invoke).toHaveBeenCalledWith('copilot:local-asr:decode', localAsrRequest);
    expect(electron.invoke).toHaveBeenCalledWith(
      'copilot:local-asr:cancel',
      localAsrRequest.requestId,
    );
    expect(electron.send).toHaveBeenCalledWith('copilot:startup:app-root-visible');
  });

  it('pins the exact preload channel and payload for create/update-with-build and WIKI read', async () => {
    await import('../src/main/preload.js');
    const bridge = electron.expose.mock.calls[0]?.[1] as ExposedBridge;

    const createPayload = {
      path: 'notes/pinned',
      title: 'Pinned',
      body: 'pinned body',
      type: 'note',
      status: 'active',
      tags: ['pinned'],
    };
    const createResult = { note: { id: 1, path: createPayload.path, title: createPayload.title,
      type: 'note', status: 'active', tags: ['pinned'], related: [], folder: 'notes',
      createdAt: 1, updatedAt: 2, confidence: null, agent: null },
      localState: 'LOCAL_SAVED',
      build: { state: 'BUILT', kg: { state: 'ready', entitiesAdded: 1, entitiesLinked: 1, reason: null },
        rag: { state: 'ready', chunksInserted: 1, reason: null },
        wiki: { notePath: createPayload.path, expectedContentDigest: 'a'.repeat(64),
          truth: 'current', projection: null, current: null, latest: null, stale: [], failed: [],
          provenance: { provider: 'minimax', model: 'MiniMax-M3', generatedAt: 1 } },
        failureStage: null, failureReason: null },
    };
    electron.invoke.mockResolvedValueOnce(createResult);
    await expect(bridge.notes.createWithBuild(createPayload)).resolves.toEqual(createResult);
    expect(electron.invoke).toHaveBeenLastCalledWith('copilot:notes:create-with-build', createPayload);

    const updatePayload = {
      path: 'notes/pinned',
      patch: { body: 'updated body', title: 'Renamed', type: 'article', status: 'draft', tags: ['renamed'] },
    };
    const updateResult = { ...createResult, note: { ...createResult.note, title: 'Renamed', updatedAt: 3 } };
    electron.invoke.mockResolvedValueOnce(updateResult);
    await expect(bridge.notes.updateWithBuild(updatePayload)).resolves.toEqual(updateResult);
    expect(electron.invoke).toHaveBeenLastCalledWith('copilot:notes:update-with-build', updatePayload);

    const wikiResult = { notePath: 'notes/pinned', expectedContentDigest: 'a'.repeat(64),
      truth: 'current', projection: null, current: null, latest: null, stale: [], failed: [],
      provenance: { provider: 'minimax', model: 'MiniMax-M3', generatedAt: 1 } };
    electron.invoke.mockResolvedValueOnce(wikiResult);
    await expect(bridge.wiki.getForNote('notes/pinned')).resolves.toEqual(wikiResult);
    expect(electron.invoke).toHaveBeenLastCalledWith('copilot:wiki:get-for-note', 'notes/pinned');

    // Each call uses the exact channel name; the payload is forwarded unchanged.
    const channelCalls = electron.invoke.mock.calls.filter(
      (call) => ['copilot:notes:create-with-build', 'copilot:notes:update-with-build', 'copilot:wiki:get-for-note']
        .includes(call[0] as string),
    );
    expect(channelCalls).toEqual([
      ['copilot:notes:create-with-build', createPayload],
      ['copilot:notes:update-with-build', updatePayload],
      ['copilot:wiki:get-for-note', 'notes/pinned'],
    ]);
  });
});

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
