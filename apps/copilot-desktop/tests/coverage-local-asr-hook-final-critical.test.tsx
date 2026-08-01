import '@testing-library/jest-dom/vitest';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalAsrCaptureError,
  useLocalAsrCapture,
  type LocalAsrCaptureBridge,
  type MediaRecorderConstructorLike,
  type MediaRecorderLike,
} from '../src/renderer/components/VoiceInput/useLocalAsrCapture.js';
import {
  AudioPcmError,
  LOCAL_ASR_MAX_CAPTURE_BYTES,
} from '../src/renderer/components/VoiceInput/audio-pcm.js';
import type {
  LocalAsrDecodeRequest,
  LocalAsrDecodeResult,
  LocalAsrStatus,
} from '../src/shared/local-asr.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function request(): LocalAsrDecodeRequest {
  return {
    requestId: REQUEST_ID,
    format: 'PCM16LE',
    sampleRate: 16_000,
    channels: 1,
    byteLength: 2,
    sampleCount: 1,
    sha256: 'a'.repeat(64),
    pcm: Uint8Array.of(0, 0),
  };
}

function result(overrides: Partial<LocalAsrDecodeResult> = {}): LocalAsrDecodeResult {
  return {
    requestId: REQUEST_ID,
    transcript: 'local transcript',
    timings: { decodeMs: 1, totalMs: 2 },
    ...overrides,
  };
}

function bridge(overrides: Partial<LocalAsrCaptureBridge> = {}) {
  return {
    status: vi.fn(async (): Promise<LocalAsrStatus> => ({
      state: 'NOT_READY',
      active: false,
      lastErrorCode: null,
    })),
    decode: vi.fn(async () => result()),
    cancel: vi.fn(async (requestId: string) => ({ requestId, cancelled: true })),
    ...overrides,
  } as LocalAsrCaptureBridge & {
    status: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
}

function mediaStream() {
  const stop = vi.fn();
  return {
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  };
}

function chunk(size = 1): Blob {
  return { size, type: 'audio/webm' } as Blob;
}

class Recorder implements MediaRecorderLike {
  static instances: Recorder[] = [];
  static supported = true;
  static throwOnStop = false;
  static isTypeSupported = vi.fn(() => Recorder.supported);

  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    Recorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (Recorder.throwOnStop) throw new Error('synthetic recorder stop failure');
    this.state = 'inactive';
    this.onstop?.();
  }

  emit(data: Blob): void {
    this.ondataavailable?.({ data });
  }
}

const RecorderConstructor = Recorder as unknown as MediaRecorderConstructorLike;

function hookOptions(overrides: Parameters<typeof useLocalAsrCapture>[0] = {}) {
  const media = mediaStream();
  return {
    media,
    options: {
      bridge: bridge(),
      getUserMedia: vi.fn(async () => media.stream),
      mediaRecorder: RecorderConstructor,
      buildRequest: vi.fn(async () => request()),
      ...overrides,
    },
  };
}

async function startRecording(
  options: Parameters<typeof useLocalAsrCapture>[0],
) {
  const hook = renderHook(() => useLocalAsrCapture(options));
  await act(async () => {
    await hook.result.current.start();
  });
  expect(hook.result.current.phase).toBe('recording');
  const recorder = Recorder.instances.at(-1);
  expect(recorder).toBeDefined();
  return { hook, recorder: recorder! };
}

async function stopAfterChunk(
  options: Parameters<typeof useLocalAsrCapture>[0],
  data = chunk(1),
) {
  const running = await startRecording(options);
  act(() => running.recorder.emit(data));
  let stopped: LocalAsrDecodeResult | null = null;
  await act(async () => {
    stopped = await running.hook.result.current.stop();
  });
  return { ...running, stopped };
}

afterEach(() => {
  vi.restoreAllMocks();
  Recorder.instances.length = 0;
  Recorder.supported = true;
  Recorder.throwOnStop = false;
});

describe('local ASR hook fail-closed status validation', () => {
  it.each([
    null,
    [],
    Object.assign(Object.create(null), { state: 'NOT_READY', active: false, lastErrorCode: null }),
    { state: 'NOT_READY', active: false, lastErrorCode: null, extra: true },
    { state: 'NOT_READY', active: 'false', lastErrorCode: null },
    { state: 'NOT_READY', active: false, lastErrorCode: 'UNKNOWN' },
    { state: 'NOT_READY', active: true, lastErrorCode: null },
    { state: 'AVAILABLE', active: false, lastErrorCode: null },
    { state: 'FAILED', active: false, lastErrorCode: null },
    { state: 'FAILED', active: false, lastErrorCode: 'BUSY' },
    { state: 'CANCELLED', active: false, lastErrorCode: null },
    { state: 'UNKNOWN', active: false, lastErrorCode: null },
  ])('rejects malformed core truth %# before microphone access', async (truth) => {
    const media = mediaStream();
    const getUserMedia = vi.fn(async () => media.stream);
    const localBridge = bridge({ status: vi.fn(async () => truth as never) });
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: localBridge,
      getUserMedia,
      mediaRecorder: RecorderConstructor,
      buildRequest: vi.fn(async () => request()),
    }));

    await act(async () => {
      await expect(hook.result.current.start()).rejects.toMatchObject({
        code: 'WORKER_FAILURE',
      });
    });
    expect(hook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'WORKER_FAILURE',
      coreTruth: { state: 'NOT_READY', active: false, lastErrorCode: null },
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe('local ASR hook recorder and preprocessing boundaries', () => {
  it('rejects unsupported recorder and missing media capture before starting a run', async () => {
    const missingRecorder = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia: vi.fn(async () => mediaStream().stream),
      mediaRecorder: null,
    }));
    await act(async () => {
      await expect(missingRecorder.result.current.start()).rejects.toMatchObject({
        code: 'CAPTURE_UNSUPPORTED',
      });
    });

    Recorder.supported = false;
    const unsupportedMime = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia: vi.fn(async () => mediaStream().stream),
      mediaRecorder: RecorderConstructor,
    }));
    await act(async () => {
      await expect(unsupportedMime.result.current.start()).rejects.toMatchObject({
        code: 'CAPTURE_UNSUPPORTED',
      });
    });
  });

  it.each([
    [chunk(0), 'INVALID_AUDIO'],
    [chunk(LOCAL_ASR_MAX_CAPTURE_BYTES + 1), 'CAPTURE_TOO_LARGE'],
    [{ size: Number.NaN, type: 'audio/webm' } as Blob, 'INVALID_AUDIO'],
  ] as const)('terminates invalid compressed input %#', async (data, code) => {
    const { options } = hookOptions();
    const { hook, recorder } = await startRecording(options);
    act(() => recorder.emit(data));
    expect(hook.result.current).toMatchObject({ phase: 'error', errorCode: code });
  });

  it('rejects stop outside recording and normalizes a recorder stop exception', async () => {
    const { options } = hookOptions();
    const idle = renderHook(() => useLocalAsrCapture(options));
    await act(async () => {
      await expect(idle.result.current.stop()).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    });

    const running = await startRecording(options);
    Recorder.throwOnStop = true;
    await act(async () => {
      await expect(running.hook.result.current.stop()).rejects.toMatchObject({
        code: 'WORKER_FAILURE',
      });
    });
    expect(running.hook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'WORKER_FAILURE',
    });
  });

  it.each([
    [new AudioPcmError('CAPTURE_TOO_LONG'), 'CAPTURE_TOO_LONG'],
    [new LocalAsrCaptureError('CAPTURE_UNSUPPORTED'), 'CAPTURE_UNSUPPORTED'],
    [new Error('private preprocessing failure'), 'WORKER_FAILURE'],
  ] as const)('normalizes preprocessing failure %#', async (failure, code) => {
    const { options } = hookOptions({
      buildRequest: vi.fn(async () => { throw failure; }),
    });
    const { hook, stopped } = await stopAfterChunk(options);
    expect(stopped).toBeNull();
    expect(hook.result.current).toMatchObject({ phase: 'error', errorCode: code });
  });
});

describe('local ASR hook decode, cancel and cleanup boundaries', () => {
  it.each([
    [new LocalAsrCaptureError('BUSY'), 'BUSY', { state: 'DECODING', active: true, lastErrorCode: null }],
    [new LocalAsrCaptureError('CANCELLED'), 'CANCELLED', { state: 'CANCELLED', active: false, lastErrorCode: 'CANCELLED' }],
    [new Error('[TIMEOUT] timed out'), 'TIMEOUT', { state: 'FAILED', active: false, lastErrorCode: 'TIMEOUT' }],
    [new Error('private worker detail'), 'WORKER_FAILURE', { state: 'FAILED', active: false, lastErrorCode: 'WORKER_FAILURE' }],
  ] as const)('projects decode failure %# to stable core truth', async (failure, code, coreTruth) => {
    const localBridge = bridge({ decode: vi.fn(async () => { throw failure; }) });
    const { options } = hookOptions({ bridge: localBridge });
    const { hook, stopped } = await stopAfterChunk(options);
    expect(stopped).toBeNull();
    expect(hook.result.current).toMatchObject({ phase: 'error', errorCode: code, coreTruth });
  });

  it.each([
    [result({ requestId: 'not-a-v4' }), 'INVALID_WORKER_REPLY'],
    [result({ transcript: '   ' }), 'EMPTY_TRANSCRIPT'],
    [result({ timings: { decodeMs: 3, totalMs: 2 } }), 'INVALID_WORKER_REPLY'],
  ] as const)('fails closed for invalid decode result %#', async (decoded, code) => {
    const localBridge = bridge({ decode: vi.fn(async () => decoded) });
    const { options } = hookOptions({ bridge: localBridge });
    const { hook, stopped } = await stopAfterChunk(options);
    expect(stopped).toBeNull();
    expect(hook.result.current).toMatchObject({ phase: 'error', errorCode: code });
  });

  it('cancels an active decode once, validates the reply, and completes the pending stop', async () => {
    const decode = deferred<LocalAsrDecodeResult>();
    const cancel = vi.fn(async (requestId: string) => ({ requestId, cancelled: true }));
    const localBridge = bridge({ decode: vi.fn(() => decode.promise), cancel });
    const { options } = hookOptions({ bridge: localBridge });
    const running = await startRecording(options);
    act(() => running.recorder.emit(chunk(1)));

    let stopPromise!: Promise<LocalAsrDecodeResult | null>;
    act(() => {
      stopPromise = running.hook.result.current.stop();
    });
    await waitFor(() => expect(running.hook.result.current.phase).toBe('decoding'));
    await act(async () => {
      await running.hook.result.current.cancel();
    });
    await expect(stopPromise).resolves.toBeNull();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(REQUEST_ID));
    expect(running.hook.result.current).toMatchObject({
      phase: 'cancelled',
      errorCode: 'CANCELLED',
      coreTruth: { state: 'NOT_READY', active: false, lastErrorCode: null },
    });

    decode.resolve(result());
    await act(async () => Promise.resolve());
    await running.hook.result.current.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the decoder during unmount and tolerates track cleanup failures', async () => {
    const decode = deferred<LocalAsrDecodeResult>();
    const cancel = vi.fn(async (requestId: string) => ({ requestId, cancelled: false }));
    const localBridge = bridge({ decode: vi.fn(() => decode.promise), cancel });
    const badTrack = { stop: vi.fn(() => { throw new Error('track already stopped'); }) };
    const stream = { getTracks: () => [badTrack] } as unknown as MediaStream;
    const running = await startRecording({
      bridge: localBridge,
      getUserMedia: vi.fn(async () => stream),
      mediaRecorder: RecorderConstructor,
      buildRequest: vi.fn(async () => request()),
    });
    act(() => running.recorder.emit(chunk(1)));
    act(() => {
      void running.hook.result.current.stop();
    });
    await waitFor(() => expect(running.hook.result.current.phase).toBe('decoding'));
    running.hook.unmount();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(REQUEST_ID));
    decode.resolve(result());
  });
});
