import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LocalAsrDecodeRequest,
  LocalAsrDecodeResult,
  LocalAsrStatus,
} from '../../src/shared/local-asr';
import {
  LOCAL_ASR_MAX_CAPTURE_BYTES,
} from '../../src/renderer/components/VoiceInput/audio-pcm';
import {
  LocalAsrCaptureError,
  useLocalAsrCapture,
  type LocalAsrCaptureBridge,
  type UseLocalAsrCaptureResult,
  type MediaRecorderLike,
} from '../../src/renderer/components/VoiceInput/useLocalAsrCapture';

const REQUEST_ID = 'de305d54-75b4-431b-adb2-eb6b9e546014';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function request(): LocalAsrDecodeRequest {
  return {
    requestId: REQUEST_ID,
    format: 'PCM16LE',
    sampleRate: 16_000,
    channels: 1,
    byteLength: 4,
    sampleCount: 2,
    sha256: 'a'.repeat(64),
    pcm: new Uint8Array([0, 0, 1, 0]),
  };
}

function decoded(
  transcript = ' 本地   语音 ',
  requestId = REQUEST_ID,
): LocalAsrDecodeResult {
  return {
    requestId,
    transcript,
    timings: { decodeMs: 4, totalMs: 5 },
  };
}

function truth(
  overrides: Partial<LocalAsrStatus> = {},
): LocalAsrStatus {
  return {
    state: 'NOT_READY',
    active: false,
    lastErrorCode: null,
    ...overrides,
  };
}

function fakeStream(stop = vi.fn()): {
  stream: MediaStream;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    stream: {
      getTracks: () => [{ stop }] as unknown as MediaStreamTrack[],
    } as unknown as MediaStream,
    stop,
  };
}

class FakeRecorder implements MediaRecorderLike {
  static latest: FakeRecorder | null = null;
  static supported = true;
  static isTypeSupported(mimeType: string): boolean {
    return FakeRecorder.supported && mimeType === 'audio/webm;codecs=opus';
  }

  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;

  constructor(
    readonly stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.latest = this;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
  }

  data(blob: Blob): void {
    this.ondataavailable?.({ data: blob });
  }

  stopped(): void {
    this.onstop?.();
  }
}

function bridge(
  overrides: Partial<LocalAsrCaptureBridge> = {},
): LocalAsrCaptureBridge {
  return {
    status: vi.fn(async () => truth()),
    decode: vi.fn(async () => decoded()),
    cancel: vi.fn(async (requestId) => ({ requestId, cancelled: true })),
    ...overrides,
  };
}

type CaptureHook = {
  result: {
    current: UseLocalAsrCaptureResult;
  };
};

async function startRecording(
  hook: CaptureHook,
): Promise<FakeRecorder> {
  await act(async () => {
    await hook.result.current.start();
  });
  const recorder = FakeRecorder.latest;
  if (!recorder) throw new Error('test recorder missing');
  return recorder;
}

async function finishRecording(
  hook: CaptureHook,
  recorder: FakeRecorder,
  blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
): Promise<LocalAsrDecodeResult | null> {
  let terminal!: Promise<LocalAsrDecodeResult | null>;
  act(() => {
    terminal = hook.result.current.stop();
    recorder.data(blob);
    recorder.stopped();
  });
  let value: LocalAsrDecodeResult | null = null;
  await act(async () => {
    value = await terminal;
  });
  return value;
}

beforeEach(() => {
  FakeRecorder.latest = null;
  FakeRecorder.supported = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('local ASR renderer capture lifecycle', () => {
  it('keeps one active run and sends the exact private request before accepting a matching result', async () => {
    const localBridge = bridge();
    const built = request();
    const buildRequest = vi.fn(async (_blob: Blob) => built);
    const media = fakeStream();
    const networkCall = vi.fn();
    vi.stubGlobal('fetch', networkCall);
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: localBridge,
      getUserMedia: vi.fn(async () => media.stream),
      mediaRecorder: FakeRecorder,
      buildRequest,
    }));

    const recorder = await startRecording(hook);
    expect(hook.result.current.phase).toBe('recording');
    await expect(hook.result.current.start()).rejects.toMatchObject({
      code: 'BUSY',
    });
    expect(hook.result.current.phase).toBe('recording');

    const result = await finishRecording(hook, recorder);
    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(buildRequest.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(localBridge.decode).toHaveBeenCalledTimes(1);
    expect(localBridge.decode).toHaveBeenCalledWith(built);
    expect(result).toEqual(decoded());
    expect(hook.result.current).toMatchObject({
      phase: 'done',
      errorCode: null,
      requestId: REQUEST_ID,
      transcript: '本地 语音',
      coreTruth: {
        state: 'READY',
        active: false,
        lastErrorCode: null,
      },
    });
    expect(media.stop).toHaveBeenCalledTimes(1);
    expect(networkCall).not.toHaveBeenCalled();
  });

  it('maps permission denial and unsupported recording to stable local errors', async () => {
    const denied = new DOMException('private detail', 'NotAllowedError');
    const permissionHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia: vi.fn(async () => {
        throw denied;
      }),
      mediaRecorder: FakeRecorder,
    }));
    await act(async () => {
      await expect(permissionHook.result.current.start()).rejects.toMatchObject({
        code: 'MIC_PERMISSION_DENIED',
      });
    });
    expect(permissionHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'MIC_PERMISSION_DENIED',
    });

    FakeRecorder.supported = false;
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const unsupportedHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia,
      mediaRecorder: FakeRecorder,
    }));
    await act(async () => {
      await expect(unsupportedHook.result.current.start()).rejects.toMatchObject({
        code: 'CAPTURE_UNSUPPORTED',
      });
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(unsupportedHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'CAPTURE_UNSUPPORTED',
      coreTruth: truth(),
    });
  });

  it('stops a late permission stream after cancel and after unmount', async () => {
    const pendingAfterCancel = deferred<MediaStream>();
    const cancelledMedia = fakeStream();
    const cancelledGetUserMedia = vi.fn(() => pendingAfterCancel.promise);
    const cancelledHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia: cancelledGetUserMedia,
      mediaRecorder: FakeRecorder,
    }));
    let cancelledStart!: Promise<void>;
    act(() => {
      cancelledStart = cancelledHook.result.current.start();
    });
    await waitFor(() => expect(cancelledGetUserMedia).toHaveBeenCalledTimes(1));
    await act(async () => cancelledHook.result.current.cancel());
    await act(async () => {
      pendingAfterCancel.resolve(cancelledMedia.stream);
      await cancelledStart;
    });
    expect(cancelledMedia.stop).toHaveBeenCalledTimes(1);
    expect(cancelledHook.result.current.phase).toBe('cancelled');

    const pendingAfterUnmount = deferred<MediaStream>();
    const unmountedMedia = fakeStream();
    const unmountedGetUserMedia = vi.fn(() => pendingAfterUnmount.promise);
    const unmountedHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge(),
      getUserMedia: unmountedGetUserMedia,
      mediaRecorder: FakeRecorder,
    }));
    let unmountedStart!: Promise<void>;
    act(() => {
      unmountedStart = unmountedHook.result.current.start();
    });
    await waitFor(() => expect(unmountedGetUserMedia).toHaveBeenCalledTimes(1));
    unmountedHook.unmount();
    pendingAfterUnmount.resolve(unmountedMedia.stream);
    await unmountedStart;
    expect(unmountedMedia.stop).toHaveBeenCalledTimes(1);
  });

  it('fails closed for compressed overflow, duration timeout and empty stop', async () => {
    const overflowBridge = bridge();
    const overflowMedia = fakeStream();
    const overflowHook = renderHook(() => useLocalAsrCapture({
      bridge: overflowBridge,
      getUserMedia: vi.fn(async () => overflowMedia.stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    const overflowRecorder = await startRecording(overflowHook);
    act(() => {
      overflowRecorder.data({
        size: LOCAL_ASR_MAX_CAPTURE_BYTES + 1,
        type: 'audio/webm',
      } as Blob);
    });
    expect(overflowHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'CAPTURE_TOO_LARGE',
    });
    expect(overflowMedia.stop).toHaveBeenCalledTimes(1);
    expect(overflowBridge.decode).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const timeoutBridge = bridge();
    const timeoutMedia = fakeStream();
    const timeoutHook = renderHook(() => useLocalAsrCapture({
      bridge: timeoutBridge,
      getUserMedia: vi.fn(async () => timeoutMedia.stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    await act(async () => timeoutHook.result.current.start());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(timeoutHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'CAPTURE_TOO_LONG',
    });
    expect(timeoutMedia.stop).toHaveBeenCalledTimes(1);
    expect(timeoutBridge.decode).not.toHaveBeenCalled();
    vi.useRealTimers();

    const readyTruth = truth({
      state: 'READY',
      active: false,
      lastErrorCode: null,
    });
    const emptyBridge = bridge({
      status: vi.fn(async () => readyTruth),
    });
    const emptyHook = renderHook(() => useLocalAsrCapture({
      bridge: emptyBridge,
      getUserMedia: vi.fn(async () => fakeStream().stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    const emptyRecorder = await startRecording(emptyHook);
    let terminal!: Promise<LocalAsrDecodeResult | null>;
    act(() => {
      terminal = emptyHook.result.current.stop();
      emptyRecorder.stopped();
    });
    await act(async () => terminal);
    expect(emptyHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'INVALID_AUDIO',
      coreTruth: readyTruth,
    });
    expect(emptyBridge.decode).not.toHaveBeenCalled();
  });

  it('rejects mismatched, empty and malformed results without accepting transcript text', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['mismatch', decoded('wrong', '4c5575f8-1c83-4c57-aea0-413934b94244'), 'INVALID_WORKER_REPLY'],
      ['empty', decoded('   '), 'EMPTY_TRANSCRIPT'],
      ['malformed', { ...decoded(), extra: true }, 'INVALID_WORKER_REPLY'],
    ];
    for (const [, reply, expectedCode] of cases) {
      const localBridge = bridge({
        decode: vi.fn(async () => reply as LocalAsrDecodeResult),
      });
      const hook = renderHook(() => useLocalAsrCapture({
        bridge: localBridge,
        getUserMedia: vi.fn(async () => fakeStream().stream),
        mediaRecorder: FakeRecorder,
        buildRequest: vi.fn(async () => request()),
      }));
      const recorder = await startRecording(hook);
      await finishRecording(hook, recorder);
      expect(hook.result.current).toMatchObject({
        phase: 'error',
        errorCode: expectedCode,
        transcript: '',
        result: null,
        coreTruth: expectedCode === 'EMPTY_TRANSCRIPT'
          ? truth()
          : {
              state: 'FAILED',
              active: false,
              lastErrorCode: 'INVALID_WORKER_REPLY',
            },
      });
      hook.unmount();
    }
  });

  it('preserves exact A3 TIMEOUT and raced BUSY truth and normalizes unknown failures', async () => {
    const cases: Array<[unknown, string, LocalAsrStatus]> = [
      [
        new Error('[TIMEOUT] hidden detail'),
        'TIMEOUT',
        truth({
          state: 'FAILED',
          active: false,
          lastErrorCode: 'TIMEOUT',
        }),
      ],
      [
        new Error('[BUSY] hidden detail'),
        'BUSY',
        truth({
          state: 'DECODING',
          active: true,
          lastErrorCode: null,
        }),
      ],
      [
        new Error('unclassified raw failure'),
        'WORKER_FAILURE',
        truth({
          state: 'FAILED',
          active: false,
          lastErrorCode: 'WORKER_FAILURE',
        }),
      ],
    ];
    for (const [failure, expectedCode, expectedTruth] of cases) {
      const localBridge = bridge({
        decode: vi.fn(async () => {
          throw failure;
        }),
      });
      const hook = renderHook(() => useLocalAsrCapture({
        bridge: localBridge,
        getUserMedia: vi.fn(async () => fakeStream().stream),
        mediaRecorder: FakeRecorder,
        buildRequest: vi.fn(async () => request()),
      }));
      const recorder = await startRecording(hook);
      await finishRecording(hook, recorder);
      expect(hook.result.current).toMatchObject({
        phase: 'error',
        errorCode: expectedCode,
        transcript: '',
        coreTruth: expectedTruth,
      });
      hook.unmount();
    }
  });

  it('resets prior READY truth when a later start has no bridge', async () => {
    let injectedBridge: LocalAsrCaptureBridge | null = bridge();
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: injectedBridge,
      getUserMedia: vi.fn(async () => fakeStream().stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    const recorder = await startRecording(hook);
    await finishRecording(hook, recorder);
    expect(hook.result.current.coreTruth).toEqual(truth({
      state: 'READY',
      active: false,
      lastErrorCode: null,
    }));

    injectedBridge = null;
    hook.rerender();
    await act(async () => {
      await expect(hook.result.current.start()).rejects.toMatchObject({
        code: 'NOT_READY',
      });
    });
    expect(hook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'NOT_READY',
      coreTruth: truth(),
    });
  });

  it('cancels locally before decode and sends at most one IPC cancel after decode starts', async () => {
    const recordingBridge = bridge();
    const recordingMedia = fakeStream();
    const recordingHook = renderHook(() => useLocalAsrCapture({
      bridge: recordingBridge,
      getUserMedia: vi.fn(async () => recordingMedia.stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    await startRecording(recordingHook);
    await act(async () => recordingHook.result.current.cancel());
    expect(recordingHook.result.current.phase).toBe('cancelled');
    expect(recordingBridge.cancel).not.toHaveBeenCalled();
    expect(recordingMedia.stop).toHaveBeenCalledTimes(1);

    const pendingDecode = deferred<LocalAsrDecodeResult>();
    const pendingCancel = deferred<{ requestId: string; cancelled: boolean }>();
    const decodingBridge = bridge({
      decode: vi.fn(() => pendingDecode.promise),
      cancel: vi.fn(() => pendingCancel.promise),
    });
    const decodingHook = renderHook(() => useLocalAsrCapture({
      bridge: decodingBridge,
      getUserMedia: vi.fn(async () => fakeStream().stream),
      mediaRecorder: FakeRecorder,
      buildRequest: vi.fn(async () => request()),
    }));
    const recorder = await startRecording(decodingHook);
    let terminal!: Promise<LocalAsrDecodeResult | null>;
    act(() => {
      terminal = decodingHook.result.current.stop();
      recorder.data(new Blob([new Uint8Array([1])]));
      recorder.stopped();
    });
    await waitFor(() => expect(decodingHook.result.current.phase).toBe('decoding'));
    await act(async () => {
      await decodingHook.result.current.cancel();
      await decodingHook.result.current.cancel();
    });
    expect(decodingBridge.cancel).toHaveBeenCalledTimes(1);
    expect(decodingBridge.cancel).toHaveBeenCalledWith(REQUEST_ID);
    expect(decodingHook.result.current).toMatchObject({
      phase: 'cancelled',
      coreTruth: truth(),
    });
    await act(async () => {
      await expect(terminal).resolves.toBeNull();
    });
    await act(async () => {
      pendingDecode.resolve(decoded('late result'));
      await Promise.resolve();
    });
    expect(decodingHook.result.current).toMatchObject({
      phase: 'cancelled',
      transcript: '',
      result: null,
      coreTruth: truth(),
    });
  });

  it('completes local cancellation before late cancel resolve or reject', async () => {
    for (const terminal of ['resolve', 'reject'] as const) {
      const pendingDecode = deferred<LocalAsrDecodeResult>();
      const pendingCancel = deferred<{ requestId: string; cancelled: boolean }>();
      const localBridge = bridge({
        decode: vi.fn(() => pendingDecode.promise),
        cancel: vi.fn(() => pendingCancel.promise),
      });
      const hook = renderHook(() => useLocalAsrCapture({
        bridge: localBridge,
        getUserMedia: vi.fn(async () => fakeStream().stream),
        mediaRecorder: FakeRecorder,
        buildRequest: vi.fn(async () => request()),
      }));
      const recorder = await startRecording(hook);
      let completion!: Promise<LocalAsrDecodeResult | null>;
      act(() => {
        completion = hook.result.current.stop();
        recorder.data(new Blob([new Uint8Array([1])]));
        recorder.stopped();
      });
      await waitFor(() => expect(hook.result.current.phase).toBe('decoding'));
      await act(async () => hook.result.current.cancel());
      await expect(completion).resolves.toBeNull();
      const cancelledState = hook.result.current;

      await act(async () => {
        if (terminal === 'resolve') {
          pendingCancel.resolve({ requestId: REQUEST_ID, cancelled: true });
        } else {
          pendingCancel.reject(new Error('private late cancel failure'));
        }
        await Promise.resolve();
      });
      expect(hook.result.current).toEqual(cancelledState);
      expect(localBridge.cancel).toHaveBeenCalledTimes(1);
      hook.unmount();
    }
  });

  it('keeps rejected, malformed and incoherent status truth fail-closed', async () => {
    const statuses: Array<[string, () => Promise<LocalAsrStatus>]> = [
      ['rejected', async () => {
        throw new Error('private status failure');
      }],
      ['extra key', async () => ({
        state: 'READY',
        active: false,
        lastErrorCode: null,
        stale: true,
      } as LocalAsrStatus)],
      ['READY active', async () => truth({ state: 'READY', active: true })],
      ['FAILED without error', async () => truth({ state: 'FAILED' })],
      ['NOT_READY with error', async () => truth({ lastErrorCode: 'TIMEOUT' })],
      ['AVAILABLE inactive', async () => truth({ state: 'AVAILABLE' })],
      ['DECODING inactive', async () => truth({ state: 'DECODING' })],
      ['CANCELLED without error', async () => truth({ state: 'CANCELLED' })],
    ];
    for (const [, status] of statuses) {
      const getUserMedia = vi.fn(async () => fakeStream().stream);
      const hook = renderHook(() => useLocalAsrCapture({
        bridge: bridge({ status: vi.fn(status) }),
        getUserMedia,
        mediaRecorder: FakeRecorder,
      }));
      await act(async () => {
        await expect(hook.result.current.start()).rejects.toMatchObject({
          name: new LocalAsrCaptureError('WORKER_FAILURE').name,
          code: 'WORKER_FAILURE',
        });
      });
      expect(hook.result.current).toMatchObject({
        phase: 'error',
        errorCode: 'WORKER_FAILURE',
        coreTruth: truth(),
      });
      expect(getUserMedia).not.toHaveBeenCalled();
      hook.unmount();
    }
  });

  it('accepts exact AVAILABLE and CANCELLED core status combinations', async () => {
    const availableGetUserMedia = vi.fn(async () => fakeStream().stream);
    const availableHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge({
        status: vi.fn(async () => truth({
          state: 'AVAILABLE',
          active: true,
          lastErrorCode: null,
        })),
      }),
      getUserMedia: availableGetUserMedia,
      mediaRecorder: FakeRecorder,
    }));
    await act(async () => {
      await expect(availableHook.result.current.start()).rejects.toMatchObject({
        code: 'BUSY',
      });
    });
    expect(availableHook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'BUSY',
      coreTruth: {
        state: 'AVAILABLE',
        active: true,
        lastErrorCode: null,
      },
    });
    expect(availableGetUserMedia).not.toHaveBeenCalled();

    const cancelledHook = renderHook(() => useLocalAsrCapture({
      bridge: bridge({
        status: vi.fn(async () => truth({
          state: 'CANCELLED',
          active: false,
          lastErrorCode: 'CANCELLED',
        })),
      }),
      getUserMedia: vi.fn(async () => fakeStream().stream),
      mediaRecorder: FakeRecorder,
    }));
    await startRecording(cancelledHook);
    expect(cancelledHook.result.current).toMatchObject({
      phase: 'recording',
      coreTruth: {
        state: 'CANCELLED',
        active: false,
        lastErrorCode: 'CANCELLED',
      },
    });
    await act(async () => cancelledHook.result.current.cancel());
  });
});
