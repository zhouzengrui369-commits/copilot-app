import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudAsrProvider,
  type CloudAsrFetchLike,
} from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import { useTranscriber } from '../../src/renderer/components/VoiceInput/useTranscriber';
import type {
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
} from '../../src/renderer/components/VoiceInput/WebSpeechProvider';
import { CHROME_139_LOCAL_ASR_RUNTIME } from './local-asr-test-runtime';

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

class Recorder {
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

function response(text = 'cloud-result') {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, confidence: 0.99 }),
    json: async () => ({ text, confidence: 0.99 }),
  };
}

function localCtor(options: {
  available?: () => Promise<'available'>;
  finalText?: string;
} = {}) {
  const instances: SpeechRecognitionLike[] = [];
  const ctor = function () {
    const instance: SpeechRecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      processLocally: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(() => {
        queueMicrotask(() => {
          if (options.finalText) {
            instance.onresult?.({
              results: [
                {
                  isFinal: true,
                  0: { transcript: options.finalText, confidence: 0.99 },
                },
              ],
            });
          }
          instance.onend?.();
        });
      }),
      abort: vi.fn(),
    };
    instances.push(instance);
    return instance;
  } as unknown as SpeechRecognitionCtor;
  ctor.available = options.available ?? vi.fn(async () => 'available' as const);
  return { ctor, instances };
}

beforeEach(() => {
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: Recorder,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ASR strict-local R2 run fencing', () => {
  it('stop during async local arming prevents microphone and recognition start', async () => {
    const availability = deferred<'available'>();
    const { ctor, instances } = localCtor({ available: () => availability.promise });
    const getUserMediaImpl = vi.fn(async () => stream());
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: ctor,
        getUserMediaImpl,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
      }),
    );

    let starting!: Promise<void>;
    act(() => {
      starting = hook.result.current.start();
    });
    await waitFor(() => expect(hook.result.current.status).toBe('arming'));
    await act(async () => {
      await hook.result.current.stop();
    });
    availability.resolve('available');
    await act(async () => starting);

    expect(getUserMediaImpl).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
    expect(hook.result.current.status).not.toBe('recording');
  });

  it('cancel plus new start fences the old prepare continuation', async () => {
    const firstAvailability = deferred<'available'>();
    let availabilityCalls = 0;
    const { ctor, instances } = localCtor({
      available: () => {
        availabilityCalls += 1;
        return availabilityCalls === 1
          ? firstAvailability.promise
          : Promise.resolve('available');
      },
    });
    const getUserMediaImpl = vi.fn(async () => stream());
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: ctor,
        getUserMediaImpl,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
      }),
    );

    let oldStart!: Promise<void>;
    act(() => {
      oldStart = hook.result.current.start();
    });
    await waitFor(() => expect(hook.result.current.status).toBe('arming'));
    act(() => hook.result.current.cancel());
    await act(async () => hook.result.current.start());
    firstAvailability.resolve('available');
    await act(async () => oldStart);

    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.start).toHaveBeenCalledOnce();
    expect(hook.result.current.status).toBe('recording');
    act(() => hook.result.current.cancel());
  });

  it('old cloud completion cannot overwrite or clean up a newer run', async () => {
    const cloud = deferred<ReturnType<typeof response>>();
    const fetchImpl = vi.fn(async () => cloud.promise) as unknown as CloudAsrFetchLike;
    const firstTrackStop = vi.fn();
    const secondTrackStop = vi.fn();
    let mediaCalls = 0;
    const hook = renderHook(() =>
      useTranscriber({
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'https://asr.example.test',
        cloudFetchImpl: fetchImpl,
        mediaRecorderCtor: Recorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => {
          mediaCalls += 1;
          return stream(mediaCalls === 1 ? firstTrackStop : secondTrackStop);
        },
      }),
    );

    await act(async () => hook.result.current.start());
    let oldStop!: Promise<unknown>;
    act(() => {
      oldStop = hook.result.current.stop();
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    act(() => hook.result.current.cancel());
    await act(async () => hook.result.current.start());
    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.result).toBeNull();

    cloud.resolve(response('stale-cloud-result'));
    await act(async () => oldStop);

    expect(hook.result.current.status).toBe('recording');
    expect(hook.result.current.result).toBeNull();
    expect(secondTrackStop).not.toHaveBeenCalled();
    act(() => hook.result.current.cancel());
  });
});

describe('CloudAsrProvider cancellation and timeout', () => {
  it('uses timeoutMs to abort the actual fetch and settle with timeout', async () => {
    vi.useFakeTimers();
    let fetchAborted = false;
    const fetchImpl = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<ReturnType<typeof response>>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            fetchAborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as CloudAsrFetchLike;
    const provider = new CloudAsrProvider({ fetchImpl, timeoutMs: 20 });
    let outcome: string | null = null;
    void provider
      .transcribe(new Blob([new Uint8Array(8)]))
      .catch((error: { code?: string }) => {
        outcome = error.code ?? null;
      });

    await vi.advanceTimersByTimeAsync(21);
    expect(fetchAborted).toBe(true);
    expect(outcome).toBe('timeout');
  });

  it('caller cancellation aborts fetch and settles with aborted', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<ReturnType<typeof response>>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as CloudAsrFetchLike;
    const provider = new CloudAsrProvider({ fetchImpl, timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = provider.transcribe(new Blob([new Uint8Array(8)]), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('cloud upload requires all four gates', () => {
  async function exercise(options: Record<string, unknown>) {
    const fetchImpl = vi.fn(async () => response()) as unknown as CloudAsrFetchLike;
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: null,
        mediaRecorderCtor: Recorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        cloudFetchImpl: fetchImpl,
        ...options,
      }),
    );
    await act(async () => hook.result.current.start());
    if (hook.result.current.status === 'recording') {
      await act(async () => hook.result.current.stop());
    }
    return fetchImpl;
  }

  it('does not fetch when strictLocal=false is missing', async () => {
    const fetchImpl = await exercise({
      enableCloudFallback: true,
      cloudConsent: true,
      serverBaseUrl: 'https://asr.example.test',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch when enableCloudFallback=true is missing', async () => {
    const fetchImpl = await exercise({
      strictLocal: false,
      cloudConsent: true,
      serverBaseUrl: 'https://asr.example.test',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch when cloudConsent=true is missing', async () => {
    const fetchImpl = await exercise({
      strictLocal: false,
      enableCloudFallback: true,
      serverBaseUrl: 'https://asr.example.test',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch when a configured endpoint is missing', async () => {
    const fetchImpl = await exercise({
      strictLocal: false,
      enableCloudFallback: true,
      cloudConsent: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('audio duration provenance', () => {
  it('records duration from the finalized Blob decoder', async () => {
    const { ctor } = localCtor({ finalText: '本地结果' });
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: ctor,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
        mediaRecorderCtor: Recorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        decodeAudioDurationImpl: vi.fn(async () => 1_234),
      } as Parameters<typeof useTranscriber>[0] & {
        decodeAudioDurationImpl(blob: Blob): Promise<number>;
      }),
    );
    await act(async () => hook.result.current.start());
    const stopped = await act(async () => hook.result.current.stop());
    expect(stopped.audioDurationMs).toBe(1_234);
    expect((stopped as unknown as { durationSource?: string }).durationSource).toBe(
      'blob-decoded',
    );
  });

  it('records unknown when Blob decoding fails instead of using wall clock', async () => {
    const { ctor } = localCtor({ finalText: '本地结果' });
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: ctor,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
        mediaRecorderCtor: Recorder as unknown as typeof MediaRecorder,
        getUserMediaImpl: async () => stream(),
        decodeAudioDurationImpl: vi.fn(async () => {
          throw new Error('decode failed');
        }),
      } as Parameters<typeof useTranscriber>[0] & {
        decodeAudioDurationImpl(blob: Blob): Promise<number>;
      }),
    );
    await act(async () => hook.result.current.start());
    const stopped = await act(async () => hook.result.current.stop());
    expect(stopped.audioDurationMs).toBeNull();
    expect((stopped as unknown as { durationSource?: string }).durationSource).toBe(
      'unknown',
    );
  });
});
