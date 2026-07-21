import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudAsrProvider,
  type CloudAsrFetchLike,
} from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import { useTranscriber } from '../../src/renderer/components/VoiceInput/useTranscriber';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stream(stop = vi.fn()): MediaStream {
  return {
    getTracks: () => [{ stop }] as unknown as MediaStreamTrack[],
  } as unknown as MediaStream;
}

class AutoRecorder {
  static isTypeSupported = () => true;
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  start(): void {
    this.state = 'recording';
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(64)], { type: this.mimeType }),
      } as BlobEvent);
    });
  }

  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

class DeferredStopRecorder extends AutoRecorder {
  static instances: DeferredStopRecorder[] = [];

  constructor() {
    super();
    DeferredStopRecorder.instances.push(this);
  }

  override stop(): void {
    // The test owns completion so cancellation can race the recorder boundary.
  }

  finish(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function responseWithJson(json: () => Promise<unknown>) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json,
  };
}

beforeEach(() => {
  DeferredStopRecorder.instances = [];
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: AutoRecorder,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CloudAsrProvider full-response abort lifetime', () => {
  it('keeps timeout armed through a hanging JSON body and exits as timeout', async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    let bodyAborted = false;
    let outcome: string | null = null;
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      fetchSignal = init?.signal;
      return responseWithJson(
        () =>
          new Promise((_resolve, reject) => {
            fetchSignal?.addEventListener('abort', () => {
              bodyAborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      );
    }) as unknown as CloudAsrFetchLike;
    const provider = new CloudAsrProvider({ fetchImpl, timeoutMs: 20 });
    void provider
      .transcribe(new Blob([new Uint8Array(8)]))
      .catch((error: { code?: string }) => {
        outcome = error.code ?? null;
      });

    await vi.advanceTimersByTimeAsync(21);
    await Promise.resolve();
    expect(fetchSignal?.aborted).toBe(true);
    expect(bodyAborted).toBe(true);
    expect(outcome).toBe('timeout');
  });

  it('keeps caller cancellation wired through a hanging JSON body', async () => {
    let fetchSignal: AbortSignal | undefined;
    let bodyStarted = false;
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      fetchSignal = init?.signal;
      return responseWithJson(
        () =>
          new Promise((_resolve, reject) => {
            bodyStarted = true;
            fetchSignal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
    }) as unknown as CloudAsrFetchLike;
    const provider = new CloudAsrProvider({ fetchImpl, timeoutMs: 5_000 });
    const caller = new AbortController();
    const pending = provider.transcribe(new Blob([new Uint8Array(8)]), {
      signal: caller.signal,
    });
    await waitFor(() => expect(bodyStarted).toBe(true));

    caller.abort();

    expect(fetchSignal).not.toBe(caller.signal);
    expect(fetchSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('stop-path active RunContext fences', () => {
  it('does not hash or decode an old run after cancellation during recorder stop', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(
      new ArrayBuffer(32),
    );
    const decode = vi.fn(async () => 1_000);
    const hook = renderHook(() =>
      useTranscriber({
        strictLocal: false,
        mediaRecorderCtor: DeferredStopRecorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        decodeAudioDurationImpl: decode,
      }),
    );
    await act(async () => hook.result.current.start());
    let oldStop!: Promise<unknown>;
    act(() => {
      oldStop = hook.result.current.stop();
    });
    act(() => hook.result.current.cancel());
    await act(async () => hook.result.current.start());
    DeferredStopRecorder.instances[0]?.finish();
    await act(async () => oldStop);

    expect(digest).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.result).toBeNull();
    act(() => hook.result.current.cancel());
  });

  it('does not decode or publish an old run after cancellation during hashing', async () => {
    const hashing = deferred<ArrayBuffer>();
    const digest = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockImplementation(async () => hashing.promise);
    const decode = vi.fn(async () => 1_000);
    const hook = renderHook(() =>
      useTranscriber({
        strictLocal: false,
        mediaRecorderCtor: AutoRecorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        decodeAudioDurationImpl: decode,
      }),
    );
    await act(async () => hook.result.current.start());
    let oldStop!: Promise<unknown>;
    act(() => {
      oldStop = hook.result.current.stop();
    });
    await waitFor(() => expect(digest).toHaveBeenCalledOnce());
    act(() => hook.result.current.cancel());
    await act(async () => hook.result.current.start());
    hashing.resolve(new ArrayBuffer(32));
    await act(async () => oldStop);

    expect(decode).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.result).toBeNull();
    act(() => hook.result.current.cancel());
  });

  it('returns immediately after stale decode without adding transitions or cloud work', async () => {
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
    const decoding = deferred<number>();
    const decode = vi.fn(async () => decoding.promise);
    const fetchImpl = vi.fn() as unknown as CloudAsrFetchLike;
    const hook = renderHook(() =>
      useTranscriber({
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'https://asr.example.test',
        cloudFetchImpl: fetchImpl,
        mediaRecorderCtor: AutoRecorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        decodeAudioDurationImpl: decode,
      }),
    );
    await act(async () => hook.result.current.start());
    let oldStop!: Promise<Awaited<ReturnType<typeof hook.result.current.stop>>>;
    act(() => {
      oldStop = hook.result.current.stop();
    });
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    act(() => hook.result.current.cancel());
    await act(async () => hook.result.current.start());
    const stale = await act(async () => oldStop);
    decoding.resolve(1_000);

    expect(stale.errorCode).toBe('aborted');
    expect(stale.providerTransitions.map((item) => item.state)).not.toContain(
      'audio-duration-unknown',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.result).toBeNull();
    act(() => hook.result.current.cancel());
  });
});
