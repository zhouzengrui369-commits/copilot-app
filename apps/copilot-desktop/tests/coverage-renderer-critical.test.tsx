import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotDomainBridge,
  NoteRecord,
  RagStreamEvent,
  TodoRecord,
} from '../src/shared/domain-api.js';
import {
  MarkdownRenderer,
  preprocessWikilinks,
} from '../src/renderer/components/NoteDetail/MarkdownRenderer.js';
import {
  CloudAsrProvider,
  characterAccuracy,
  makeCloudAsrError,
  parseCloudResponse,
  type CloudAsrFetchLike,
} from '../src/renderer/components/VoiceInput/CloudAsrProvider.js';
import {
  LOCAL_ASR_RUNTIME_UNAVAILABLE,
  WebSpeechError,
  WebSpeechProvider,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultEvent,
} from '../src/renderer/components/VoiceInput/WebSpeechProvider.js';
import {
  cloudAsrSecondary,
  nativeFallback,
  useTranscriber,
  webSpeechPrimary,
} from '../src/renderer/components/VoiceInput/useTranscriber.js';
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

function makeBridge(): CopilotDomainBridge {
  let streamListener: ((event: RagStreamEvent) => void) | null = null;
  return {
    notes: {
      list: vi.fn(async () => ({ items: [NOTE_RECORD], total: 1, limit: 100, offset: 0 })),
      get: vi.fn(async () => ({ note: NOTE_RECORD, body: '# body' })),
      create: vi.fn(async () => NOTE_RECORD),
      update: vi.fn(async () => NOTE_RECORD),
      remove: vi.fn(async () => true),
      getBacklinks: vi.fn(async () => [{ fromPath: 'notes/from.md', toPath: NOTE_RECORD.path, relation: 'ref' }]),
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

function makeProductApi(overrides: Partial<CopilotProductApi> = {}): CopilotProductApi {
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

function response(
  body: unknown,
  options: { ok?: boolean; status?: number; text?: () => Promise<string>; json?: () => Promise<unknown> } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: options.text ?? (async () => JSON.stringify(body)),
    json: options.json ?? (async () => body),
  };
}

describe('CloudAsrProvider critical behavior', () => {
  it('uses the default fetch, trims a trailing slash, passes language and signal, and reports health', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: FormData; signal?: AbortSignal }) => {
      if (url.endsWith('/health')) return response(null, { status: 204 });
      expect(url).toBe('https://asr.test/api/asr/transcribe');
      expect(init?.method).toBe('POST');
      expect(init?.body?.get('language')).toBe('en-US');
      expect(init?.signal).not.toBe(controller.signal);
      expect(init?.signal?.aborted).toBe(false);
      return response({ text: '  transcript  ', confidence: 0.8, durationMs: 12 });
    });
    const controller = new AbortController();
    const provider = new CloudAsrProvider({
      serverBaseUrl: 'https://asr.test/',
      fetchImpl: fetchMock as unknown as CloudAsrFetchLike,
    });
    await expect(provider.transcribe(new Blob(['audio']), { language: 'en-US', signal: controller.signal }))
      .resolves.toMatchObject({ text: 'transcript', confidence: 0.8, durationMs: 12 });
    await expect(provider.health()).resolves.toEqual({ ok: true, status: 204 });
  });

  it('combines caller cancellation and timeout into the actual fetch signal', async () => {
    const requestSignals: AbortSignal[] = [];
    const hangingFetch = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<ReturnType<typeof response>>((_resolve, reject) => {
          if (init?.signal) requestSignals.push(init.signal);
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as CloudAsrFetchLike;

    const caller = new AbortController();
    const callerProvider = new CloudAsrProvider({
      fetchImpl: hangingFetch,
      timeoutMs: 1_000,
    });
    const callerPending = callerProvider.transcribe(new Blob(['x']), {
      signal: caller.signal,
    });
    caller.abort();
    await expect(callerPending).rejects.toMatchObject({ code: 'aborted' });
    expect(requestSignals[0]).not.toBe(caller.signal);
    expect(requestSignals[0]?.aborted).toBe(true);

    const timeoutProvider = new CloudAsrProvider({
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    });
    await expect(timeoutProvider.transcribe(new Blob(['x']))).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(requestSignals[1]?.aborted).toBe(true);
  });

  it('maps non-Error fetch and JSON failures and HTTP bodies that cannot be read', async () => {
    const network = new CloudAsrProvider({ fetchImpl: vi.fn(async () => { throw 'down'; }) as unknown as CloudAsrFetchLike });
    await expect(network.transcribe(new Blob(['x']))).rejects.toMatchObject({ code: 'network', message: 'network error' });

    const badJson = new CloudAsrProvider({
      fetchImpl: vi.fn(async () => response(null, { json: async () => { throw 'bad'; } })) as unknown as CloudAsrFetchLike,
    });
    await expect(badJson.transcribe(new Blob(['x']))).rejects.toMatchObject({ code: 'bad-json', message: 'invalid JSON' });

    const unreadable = new CloudAsrProvider({
      fetchImpl: vi.fn(async () => response(null, {
        ok: false,
        status: 429,
        text: async () => { throw new Error('unreadable'); },
      })) as unknown as CloudAsrFetchLike,
    });
    await expect(unreadable.transcribe(new Blob(['x']))).rejects.toMatchObject({
      code: 'http-429',
      status: 429,
      message: 'cloud ASR returned 429',
    });
  });

  it('covers tolerant response aliases, invalid values, and accuracy boundaries', () => {
    expect(() => parseCloudResponse(null)).toThrowError(expect.objectContaining({ code: 'bad-shape' }));
    expect(parseCloudResponse({ transcript: ' t ', score: Number.NaN, provider: 'proxy', duration_ms: 9 }))
      .toMatchObject({ text: 't', confidence: 1, engine: 'proxy', durationMs: 9 });
    expect(parseCloudResponse({ result: 42, confidence: 'bad', engine: 7, durationMs: Number.NaN }))
      .toMatchObject({ text: '', confidence: 1, engine: undefined, durationMs: undefined });
    const noStatus = makeCloudAsrError('code', 'message');
    expect(noStatus).not.toHaveProperty('status');
    expect(characterAccuracy('', 'x')).toBe(0);
    expect(characterAccuracy('a', 'b')).toBe(0);
    expect(characterAccuracy('abc', 'ab')).toBeGreaterThan(0);
  });
});

interface SpeechHarness {
  ctor: SpeechRecognitionCtor;
  instances: SpeechRecognitionLike[];
  startBehavior?: () => void;
  abortBehavior?: () => void;
}

function speechHarness(): SpeechHarness {
  const harness: SpeechHarness = { ctor: null as unknown as SpeechRecognitionCtor, instances: [] };
  harness.ctor = function () {
    const instance: SpeechRecognitionLike = {
      lang: '',
      continuous: true,
      interimResults: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: () => harness.startBehavior?.(),
      stop: vi.fn(),
      abort: () => harness.abortBehavior?.(),
    };
    harness.instances.push(instance);
    return instance;
  } as unknown as SpeechRecognitionCtor;
  return harness;
}

function speechEvent(results: Array<unknown>): SpeechRecognitionResultEvent {
  return { results } as unknown as SpeechRecognitionResultEvent;
}

describe('WebSpeechProvider critical behavior', () => {
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('detects standard and webkit constructors and applies defaults', async () => {
    const harness = speechHarness();
    (window as unknown as { webkitSpeechRecognition: SpeechRecognitionCtor }).webkitSpeechRecognition = harness.ctor;
    harness.startBehavior = () => queueMicrotask(() => harness.instances[0]?.onend?.());
    const provider = new WebSpeechProvider();
    await expect(provider.transcribe()).resolves.toEqual({ text: '', confidence: -1 });
    expect(harness.instances[0]).toMatchObject({ lang: 'zh-CN', continuous: false, interimResults: false });

    const standard = speechHarness();
    (window as unknown as { SpeechRecognition: SpeechRecognitionCtor }).SpeechRecognition = standard.ctor;
    expect(new WebSpeechProvider().isAvailable()).toBe(true);
  });

  it('skips empty result slots, reports interim text, and defaults missing confidence', async () => {
    const harness = speechHarness();
    const partial = vi.fn();
    harness.startBehavior = () => queueMicrotask(() => {
      harness.instances[0]?.onresult?.(speechEvent([
        undefined,
        { isFinal: false, 0: undefined },
        { isFinal: false, 0: { transcript: 'part', confidence: 0 } },
        { isFinal: true, 0: { transcript: ' final ', confidence: undefined } },
      ]));
    });
    await expect(new WebSpeechProvider(harness.ctor).transcribe({ interim: true, onPartial: partial }))
      .resolves.toEqual({ text: 'final', confidence: -1 });
    expect(partial).toHaveBeenCalledWith('part');
  });

  it('maps missing error values, non-Error start failures, and ignores later events', async () => {
    const errorHarness = speechHarness();
    errorHarness.startBehavior = () => queueMicrotask(() => errorHarness.instances[0]?.onerror?.({}));
    await expect(new WebSpeechProvider(errorHarness.ctor).transcribe()).rejects.toMatchObject({ code: 'error', message: 'error' });

    const startHarness = speechHarness();
    startHarness.startBehavior = () => { throw 'blocked'; };
    await expect(new WebSpeechProvider(startHarness.ctor).transcribe()).rejects.toMatchObject({ code: 'start-failed', message: 'start failed' });

    const settledHarness = speechHarness();
    settledHarness.startBehavior = () => queueMicrotask(() => {
      settledHarness.instances[0]?.onend?.();
      settledHarness.instances[0]?.onerror?.({ error: 'late' });
    });
    await expect(new WebSpeechProvider(settledHarness.ctor).transcribe()).resolves.toEqual({ text: '', confidence: -1 });
  });

  it('removes abort listeners, handles throwing abort, and keeps abort idempotent', async () => {
    const harness = speechHarness();
    harness.abortBehavior = () => { throw new Error('engine abort failed'); };
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const provider = new WebSpeechProvider(harness.ctor);
    const pending = provider.transcribe({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(() => provider.abort()).not.toThrow();
    expect(() => new WebSpeechProvider(harness.ctor).abort()).not.toThrow();
  });

  it('short-circuits repeated settlement and contains abort failures', async () => {
    const harness = speechHarness();
    let capturedEnd: (() => void) | null = null;
    harness.startBehavior = () => {
      capturedEnd = harness.instances[0]?.onend ?? null;
      queueMicrotask(() => {
        capturedEnd?.();
        capturedEnd?.();
      });
    };
    const provider = new WebSpeechProvider(harness.ctor);
    await expect(provider.transcribe()).resolves.toEqual({ text: '', confidence: -1 });

    const abortHarness = speechHarness();
    const aborting = new WebSpeechProvider(abortHarness.ctor);
    const pending = aborting.transcribe();
    abortHarness.instances[0]!.abort = () => { throw new Error('late abort failure'); };
    expect(() => aborting.abort()).not.toThrow();
    abortHarness.instances[0]!.onend?.();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

class RecorderWithChunk {
  static isTypeSupported = vi.fn(() => false);
  state: RecordingState = 'inactive';
  mimeType = '';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? '';
  }
  start(): void {
    this.state = 'recording';
    queueMicrotask(() => this.ondataavailable?.({ data: new Blob(['voice']) } as BlobEvent));
  }
  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

function mediaStream(stop = vi.fn()): MediaStream {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

function finalSpeechCtor(text: string, confidence?: number): SpeechRecognitionCtor {
  const harness = speechHarness();
  harness.startBehavior = () => queueMicrotask(() => {
    const instance = harness.instances.at(-1);
    instance?.onresult?.(speechEvent([{ isFinal: true, 0: { transcript: text, confidence } }]));
  });
  const ctor = function () {
    const instance = new harness.ctor();
    instance.processLocally = false;
    return instance;
  } as unknown as SpeechRecognitionCtor;
  ctor.available = vi.fn(async () => 'available' as const);
  return ctor;
}

function guardedStrictLocalCtor() {
  const available = vi.fn(async () => 'available' as const);
  const install = vi.fn(async () => true);
  const start = vi.fn();
  const ctor = function () {
    return {
      lang: '',
      continuous: false,
      interimResults: false,
      processLocally: false,
      onresult: null,
      onerror: null,
      onend: null,
      start,
      stop: vi.fn(),
      abort: vi.fn(),
    } satisfies SpeechRecognitionLike;
  } as unknown as SpeechRecognitionCtor;
  ctor.available = available;
  ctor.install = install;
  return { ctor, available, install, start };
}

describe('useTranscriber critical behavior', () => {
  it('covers pure primary, secondary, and native path outcomes', async () => {
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.5, speechRecognitionCtor: null }))
      .resolves.toMatchObject({ provider: 'web-speech', errorCode: 'not-supported' });
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.99, speechRecognitionCtor: finalSpeechCtor('low', 0.2) }))
      .resolves.toMatchObject({ text: '', confidence: 0.2, errorCode: 'below-threshold' });
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.99, speechRecognitionCtor: finalSpeechCtor('unknown', undefined) }))
      .resolves.toMatchObject({ text: 'unknown', confidence: -1, errorCode: null });

    await expect(cloudAsrSecondary({ lang: 'zh-CN', minWebSpeechConfidence: 0.5, audioBlob: null }))
      .resolves.toMatchObject({ provider: 'cloud', errorCode: 'no-audio' });
    await expect(cloudAsrSecondary({
      lang: 'zh-CN',
      minWebSpeechConfidence: 0.9,
      audioBlob: new Blob(['x']),
      cloudFetchImpl: vi.fn(async () => response({ text: 'low', confidence: 0.2 })) as unknown as CloudAsrFetchLike,
    })).resolves.toMatchObject({ text: '', errorCode: 'below-threshold' });
    await expect(nativeFallback({ lang: 'zh-CN', minWebSpeechConfidence: 0.5 }))
      .resolves.toMatchObject({ provider: 'native', errorCode: 'no-fallback-available' });
  });

  it('preserves the non-Electron Chrome 139 local result path, recorder construction, and reset', async () => {
    const stopTrack = vi.fn();
    const { result } = renderHook(() => useTranscriber({
      speechRecognitionCtor: finalSpeechCtor('local answer', 0.95),
      localAsrRuntimeContext: {
        trustedMeta: null,
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36',
      },
      mediaRecorderCtor: RecorderWithChunk as unknown as typeof MediaRecorder,
      getUserMediaImpl: async () => mediaStream(stopTrack),
      disableCloud: true,
    }));
    await act(() => result.current.start());
    expect(result.current.status).toBe('recording');
    const answer = await act(() => result.current.stop());
    expect(answer).toMatchObject({ text: 'local answer', provider: 'web-speech', usedFallback: false });
    expect(stopTrack).toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ status: 'idle', result: null });
  });

  it('fails closed and remains resettable for trusted Electron without the local ASR binder', async () => {
    const speech = guardedStrictLocalCtor();
    const getUserMediaImpl = vi.fn(async () => mediaStream());
    const { result } = renderHook(() => useTranscriber({
      speechRecognitionCtor: speech.ctor,
      mediaRecorderCtor: null,
      getUserMediaImpl,
      localAsrRuntimeContext: {
        trustedMeta: {
          source: 'electron-preload-process-versions',
          shell: 'electron',
          electronVersion: '38.8.6',
          chromiumVersion: '140.0.7339.249',
          localAsrCapabilities: [],
        },
        userAgent: 'Mozilla/5.0 Chrome/140.0.7339.249 Electron/38.8.6 Safari/537.36',
      },
      disableCloud: true,
    }));
    await act(() => result.current.start());
    expect(result.current.result).toMatchObject({
      provider: 'web-speech',
      usedFallback: false,
      errorCode: LOCAL_ASR_RUNTIME_UNAVAILABLE,
    });
    expect(result.current.status).toBe('error');
    expect(speech.available).not.toHaveBeenCalled();
    expect(speech.install).not.toHaveBeenCalled();
    expect(speech.start).not.toHaveBeenCalled();
    expect(getUserMediaImpl).not.toHaveBeenCalled();

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
  });

  it('stops a stream acquired after cancellation', async () => {
    const acquired = deferred<MediaStream>();
    const stopTrack = vi.fn();
    const first = renderHook(() => useTranscriber({
      speechRecognitionCtor: null,
      mediaRecorderCtor: null,
      getUserMediaImpl: () => acquired.promise,
      strictLocal: false,
    }));
    const { result } = first;
    let startPromise!: Promise<void>;
    act(() => { startPromise = result.current.start(); });
    act(() => result.current.cancel());
    await act(async () => {
      acquired.resolve(mediaStream(stopTrack));
      await startPromise;
    });
    expect(stopTrack).toHaveBeenCalled();

    first.unmount();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('maps exceptional primary constructors and cloud payload failures', async () => {
    const codedCtor = function () { throw { code: 'ctor-code' }; } as unknown as SpeechRecognitionCtor;
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.5, speechRecognitionCtor: codedCtor }))
      .resolves.toMatchObject({ errorCode: 'ctor-code' });
    const plainCtor = function () { throw 'engine down'; } as unknown as SpeechRecognitionCtor;
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.5, speechRecognitionCtor: plainCtor }))
      .resolves.toMatchObject({ errorCode: 'engine-error' });
    const webError = speechHarness();
    webError.startBehavior = () => queueMicrotask(() => webError.instances[0]?.onerror?.({ error: 'no-speech' }));
    await expect(webSpeechPrimary({ lang: 'zh-CN', minWebSpeechConfidence: 0.5, speechRecognitionCtor: webError.ctor }))
      .resolves.toMatchObject({ errorCode: 'no-speech' });
    await expect(cloudAsrSecondary({
      lang: 'zh-CN', minWebSpeechConfidence: 0.5,
      audioBlob: { size: 1 } as Blob,
      cloudFetchImpl: vi.fn() as unknown as CloudAsrFetchLike,
    })).resolves.toMatchObject({ errorCode: 'unknown' });
  });

  it('covers default media discovery, non-Error denial, stop-before-start, and mounted teardown', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    const originalMediaDevices = navigator.mediaDevices;
    const originalRecorder = window.MediaRecorder;
    const getUserMedia = vi.fn(async () => mediaStream());
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: undefined });
    const defaults = renderHook(() => useTranscriber({ speechRecognitionCtor: null, disableCloud: true, strictLocal: false }));
    await act(() => defaults.result.current.start());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    defaults.unmount();

    const denied = renderHook(() => useTranscriber({
      getUserMediaImpl: async () => { throw 'denied'; },
      speechRecognitionCtor: null,
      mediaRecorderCtor: null,
      strictLocal: false,
    }));
    await act(() => denied.result.current.start());
    expect(denied.result.current.result?.errorCode).toBe('mic-denied');

    const immediate = renderHook(() => useTranscriber({
      getUserMediaImpl: async () => mediaStream(),
      speechRecognitionCtor: null,
      mediaRecorderCtor: null,
      disableCloud: true,
      strictLocal: false,
    }));
    let stopped;
    await act(async () => { stopped = await immediate.result.current.stop(); });
    expect(stopped).toMatchObject({ durationMs: 0, provider: null, errorCode: 'no-active-session' });

    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: originalRecorder });
  });

  it('contains cleanup failures and uses the webkit audio monitor fallback', async () => {
    const originalAudioContext = window.AudioContext;
    const originalWebkit = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    class ThrowingAudioContext {
      createAnalyser() {
        return {
          fftSize: 4,
          getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(128),
          disconnect: () => { throw new Error('disconnect failed'); },
        };
      }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close() { return Promise.resolve(); }
    }
    class ThrowingStopRecorder {
      static isTypeSupported = () => false;
      state: RecordingState = 'inactive';
      mimeType = '';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { throw new Error('stop failed'); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, writable: true, value: ThrowingAudioContext });
    const hook = renderHook(() => useTranscriber({
      speechRecognitionCtor: null,
      mediaRecorderCtor: ThrowingStopRecorder as unknown as typeof MediaRecorder,
      getUserMediaImpl: async () => mediaStream(),
      strictLocal: false,
    }));
    await act(() => hook.result.current.start());
    act(() => hook.result.current.cancel());
    expect(hook.result.current.status).toBe('idle');
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: originalAudioContext });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, writable: true, value: originalWebkit });
  });

  it('uses mic-denied when an Error has no name', async () => {
    const hook = renderHook(() => useTranscriber({
      speechRecognitionCtor: null,
      mediaRecorderCtor: null,
      getUserMediaImpl: async () => {
        const error = new Error('denied');
        error.name = '';
        throw error;
      },
      strictLocal: false,
    }));
    await act(() => hook.result.current.start());
    expect(hook.result.current.result?.errorCode).toBe('mic-denied');
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
  it('uses non-stream ask, renders source fallbacks, opens a source, and blocks blank queries', async () => {
    const ask = vi.fn(async (): Promise<CopilotRagAnswer> => ({ text: 'Local answer', sources: ['notes/source.md'] }));
    const onOpenSource = vi.fn();
    const api = makeProductApi({ rag: { ask, stream: undefined } });
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
    const source = screen.getByRole('button', { name: 'notes/source.md' });
    expect(source.closest('mark')).toHaveAttribute('title', '引用依据：向量相似度');
    fireEvent.click(source);
    expect(onOpenSource).toHaveBeenCalledWith('notes/source.md');
  });

  it('renders explicit multi-evidence sources and the empty answer/source fallbacks', async () => {
    const api = makeProductApi({ rag: { stream: undefined, ask: vi.fn(async (): Promise<CopilotRagAnswer> => ({
      text: '',
      sources: [],
      sourceDetails: [{ notePath: 'notes/kg.md', evidence: ['vector', 'kg-entity', 'kg-neighbor'], score: 1 }],
    })) } });
    const view = render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('rag-answer')).toHaveTextContent('知识库内未找到相关笔记');
    expect(screen.getByRole('button', { name: 'notes/kg.md' }).closest('mark'))
      .toHaveAttribute('title', '引用依据：向量相似度 + 知识图谱实体 + 知识图谱邻接');

    view.unmount();
    const empty = makeProductApi({ rag: { stream: undefined, ask: vi.fn(async () => ({ text: 'answer', sources: [] })) } });
    render(<AskWorkspace api={empty} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('本次回答没有可引用来源')).toBeInTheDocument();
  });

  it.each([
    [new Error('[CONFIG_REQUIRED] key missing'), '请先在设置中完成模型服务配置'],
    [new Error('[OFFLINE] down'), '本地 AI 服务暂不可用'],
    [new Error('offline'), 'offline'],
    ['boom', '本地知识问答失败'],
  ])('maps ask failure %# to a user-visible error', async (failure, expected) => {
    const api = makeProductApi({ rag: { stream: undefined, ask: vi.fn(async () => { throw failure; }) } });
    render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent(expected);
  });

  it('streams deltas, preserves source details, exposes cancel, and cancels on unmount', async () => {
    const done = deferred<CopilotRagAnswer>();
    const cancel = vi.fn(async () => undefined);
    let onEvent: ((event: RagStreamEvent) => void) | null = null;
    const stream = vi.fn((_question: string, listener: (event: RagStreamEvent) => void) => {
      onEvent = listener;
      return { requestId: 'req', done: done.promise, cancel };
    });
    const api = makeProductApi({ rag: { ask: vi.fn(), stream } });
    const view = render(<AskWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: 'stream me' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('正在检索本地知识并生成回答…')).toBeInTheDocument();
    act(() => onEvent?.({
      requestId: 'req', type: 'delta', delta: 'partial',
      sources: [{ notePath: 'notes/live.md', evidence: ['vector'], score: 0.9 }],
    }));
    expect(screen.getByTestId('rag-answer')).toHaveTextContent('partial');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await act(async () => done.resolve({ text: 'final', sources: ['notes/live.md'] }));
    expect(screen.getByTestId('rag-answer')).toHaveTextContent('final');
    expect(screen.getByRole('button', { name: 'notes/live.md' })).toBeInTheDocument();
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('ignores abort rejection from a stream and cancels an active stream during unmount', async () => {
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

function todoApi(items: CopilotTodo[], dueItems: CopilotTodo[] = []): CopilotProductApi {
  return makeProductApi({ todos: {
    list: vi.fn(async () => items),
    listDue: vi.fn(async () => dueItems),
    create: vi.fn(async (input) => todo({ id: 'new', title: input.title, dueAt: input.dueAt, linkedNotePaths: input.linkedNotePaths })),
    update: vi.fn(async (id, patch) => todo({ id, ...patch })),
    remove: vi.fn(async () => true),
    markReminderFired: vi.fn(async (id) => todo({ id })),
  } });
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
    const undated = todo({ id: 'todo-2', title: 'Inbox item', due_at_ms: null, note_links: [] });
    const doneTodo = todo({ id: 'todo-3', title: 'Already done', status: 'done', dueAt: dated.due_at_ms });
    const api = todoApi([dated, { ...dated, title: 'deduped' }, undated, doneTodo], [dated, dated]);
    const onOpenNote = vi.fn();
    render(<ScheduleWorkspace api={api} onOpenNote={onOpenNote} />);
    expect(await screen.findByText('deduped')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('提醒：Ship MVP')).toBeInTheDocument();
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0]?.options).toMatchObject({ tag: 'copilot-todo-todo-1', requireInteraction: true });

    fireEvent.click(screen.getAllByRole('button', { name: 'notes/one.md' })[0]!);
    expect(onOpenNote).toHaveBeenCalledWith('notes/one.md');
    fireEvent.click(screen.getByRole('button', { name: '切换 deduped' }));
    await waitFor(() => expect(api.todos.update).toHaveBeenCalledWith('todo-1', { status: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: '切换 Already done' }));
    await waitFor(() => expect(api.todos.update).toHaveBeenCalledWith('todo-3', { status: 'pending' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 Inbox item' }));
    await waitFor(() => expect(api.todos.remove).toHaveBeenCalledWith('todo-2'));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: ' New task ' } });
    fireEvent.change(screen.getByLabelText('到期与提醒时间'), { target: { value: '2026-07-21T10:30' } });
    fireEvent.change(inputs[1]!, { target: { value: ' notes/two.md ' } });
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    await waitFor(() => expect(api.todos.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New task', linkedNotePaths: ['notes/two.md'], dueAt: expect.any(Number), remindAt: expect.any(Number),
    })));

    fireEvent.click(screen.getByRole('button', { name: '日历视图' }));
    expect(screen.getByRole('region', { name: '日历视图' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '无日期' })).toHaveTextContent('Inbox item');
    expect(screen.queryByText('0 项')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('list', { name: '待办列表' })).toBeInTheDocument();

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

  it('shows empty state, undated calendar empty group, and creates without optional fields', async () => {
    const api = todoApi([]);
    render(<ScheduleWorkspace api={api} />);
    expect(await screen.findByText('暂无待办')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '日历视图' }));
    expect(screen.getByText('日历中暂无待办')).toBeInTheDocument();
    expect(screen.getAllByText('0 项')).toHaveLength(2);
    const title = screen.getAllByRole('textbox')[0]!;
    fireEvent.submit(title.closest('form')!);
    expect(api.todos.create).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: 'No date' } });
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
    expect(await screen.findByText('Ship MVP')).toBeInTheDocument();

    vi.mocked(api.todos.create).mockRejectedValueOnce(new Error('create failed'));
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('create failed');

    vi.mocked(api.todos.update).mockRejectedValueOnce('toggle failed');
    fireEvent.click(screen.getByRole('button', { name: '切换 Ship MVP' }));
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
    expect(await screen.findByText('Ship MVP')).toBeInTheDocument();
    vi.mocked(api2.todos.create).mockRejectedValueOnce('create string');
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'bad create' } });
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('create string');
    vi.mocked(api2.todos.remove).mockRejectedValueOnce(new Error('remove error'));
    fireEvent.click(screen.getByRole('button', { name: '删除 Ship MVP' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('remove error');
    vi.mocked(api2.todos.markReminderFired).mockRejectedValueOnce('ack string');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(await screen.findByTestId('workspace-state-error')).toHaveTextContent('ack string');
    second.unmount();
  });
});
