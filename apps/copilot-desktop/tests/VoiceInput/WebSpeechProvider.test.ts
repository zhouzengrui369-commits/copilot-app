/**
 * WebSpeechProvider tests — use a mock SpeechRecognition constructor
 * to verify the Promise contract: final-result resolve, error reject,
 * abort, interim callback, not-supported.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  WebSpeechProvider,
  WebSpeechError,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from '../../src/renderer/components/VoiceInput/WebSpeechProvider';

interface MockHandle {
  /** Returns the most-recently-constructed instance. */
  getInstance(): SpeechRecognitionLike;
  /** Set what `start()` does for the next call. Reset after each call. */
  onStart(fn: () => void): void;
  /** Number of start() calls so far. */
  starts: number;
  /** Manually invoke onerror. */
  fireError(code: string, message?: string): void;
  /** Manually invoke onresult with a final transcript. */
  fireFinal(text: string, confidence?: number): void;
  /** Manually invoke onend. */
  fireEnd(): void;
}

/**
 * Build a mock SpeechRecognition constructor that captures instances
 * and lets tests control the onresult / onerror / onend events.
 *
 * Behaviour injection is done via `onStart(fn)` so the implementation
 * runs after `transcribe()` has wired up its event handlers (which
 * is the ordering the production code expects).
 */
function makeMockCtor(): { ctor: SpeechRecognitionCtor; handle: MockHandle } {
  let current: SpeechRecognitionLike | null = null;
  let startFn: (() => void) | null = null;
  const starts = { n: 0 };

  const ctor: SpeechRecognitionCtor = function () {
    const inst: SpeechRecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: () => {
        starts.n += 1;
        const fn = startFn;
        startFn = null; // single-shot
        if (fn) fn();
      },
      stop: vi.fn(),
      abort: vi.fn(),
    };
    current = inst;
    return inst;
  } as unknown as SpeechRecognitionCtor;

  const handle: MockHandle = {
    getInstance: () => {
      if (!current) throw new Error('no instance yet');
      return current;
    },
    onStart: (fn) => {
      startFn = fn;
    },
    get starts() {
      return starts.n;
    },
    fireError(code, message) {
      current?.onerror?.({ error: code, message });
    },
    fireFinal(text, confidence = 0.9) {
      current?.onresult?.({
        results: [
          { isFinal: true, 0: { transcript: text, confidence } },
        ],
      });
    },
    fireEnd() {
      current?.onend?.();
    },
  };
  return { ctor, handle };
}

describe('WebSpeechProvider', () => {
  it('reports unavailable when no constructor is available', async () => {
    const p = new WebSpeechProvider(null);
    expect(p.isAvailable()).toBe(false);
    await expect(p.transcribe()).rejects.toBeInstanceOf(WebSpeechError);
  });

  it('transcribes and resolves on the first final result', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      queueMicrotask(() => handle.fireFinal('  你好世界  ', 0.93));
    });
    const p = new WebSpeechProvider(ctor);
    const res = await p.transcribe({ language: 'zh-CN' });
    expect(res.text).toBe('你好世界');
    expect(res.confidence).toBeCloseTo(0.93);
  });

  it('rejects with WebSpeechError on engine error', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      queueMicrotask(() => handle.fireError('no-speech', 'no speech'));
    });
    const p = new WebSpeechProvider(ctor);
    await expect(p.transcribe({ language: 'zh-CN' })).rejects.toMatchObject({
      name: 'WebSpeechError',
      code: 'no-speech',
    });
  });

  it('resolves with empty text on engine onend without a final result', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      queueMicrotask(() => handle.fireEnd());
    });
    const p = new WebSpeechProvider(ctor);
    const res = await p.transcribe({ language: 'zh-CN' });
    expect(res.text).toBe('');
    expect(res.confidence).toBe(-1);
  });

  it('fires onPartial for interim results', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      queueMicrotask(() => {
        const inst = handle.getInstance();
        inst.onresult?.({
          results: [
            { isFinal: false, 0: { transcript: '你好', confidence: -1 } },
            { isFinal: true, 0: { transcript: '你好世界', confidence: 0.9 } },
          ],
        });
      });
    });
    const p = new WebSpeechProvider(ctor);
    const partials: string[] = [];
    const res = await p.transcribe({
      language: 'zh-CN',
      interim: true,
      onPartial: (t) => partials.push(t),
    });
    expect(partials).toContain('你好');
    expect(res.text).toBe('你好世界');
  });

  it('aborts an in-flight session and rejects with the stable aborted code', async () => {
    const { ctor, handle } = makeMockCtor();
    // never emits a result; start does nothing
    const p = new WebSpeechProvider(ctor);
    const promise = p.transcribe({ language: 'zh-CN' });
    p.abort();
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects when start() throws synchronously', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      throw new Error('mic blocked');
    });
    const p = new WebSpeechProvider(ctor);
    await expect(p.transcribe({ language: 'zh-CN' })).rejects.toMatchObject({
      code: 'start-failed',
    });
  });

  it('clears event handlers after settle', async () => {
    const { ctor, handle } = makeMockCtor();
    handle.onStart(() => {
      queueMicrotask(() => handle.fireFinal('done'));
    });
    const p = new WebSpeechProvider(ctor);
    await p.transcribe({ language: 'zh-CN' });
    const inst = handle.getInstance();
    expect(inst.onresult).toBeNull();
    expect(inst.onerror).toBeNull();
    expect(inst.onend).toBeNull();
  });

  it('honours already-aborted signal', async () => {
    const { ctor } = makeMockCtor();
    const p = new WebSpeechProvider(ctor);
    const ac = new AbortController();
    ac.abort();
    await expect(
      p.transcribe({ language: 'zh-CN', signal: ac.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
