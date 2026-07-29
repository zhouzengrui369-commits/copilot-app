import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  LocalAsrDecodeRequest,
  LocalAsrDecodeResult,
  LocalAsrStatus,
} from '../../src/shared/local-asr';
import {
  useLocalAsrCapture,
  type LocalAsrCaptureBridge,
  type MediaRecorderLike,
} from '../../src/renderer/components/VoiceInput/useLocalAsrCapture';

const REQUEST_ID = 'de305d54-75b4-431b-adb2-eb6b9e546014';

class Recorder implements MediaRecorderLike {
  static latest: Recorder | null = null;
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream) {
    Recorder.latest = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
  }
}

function stream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
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
    pcm: new Uint8Array([0, 0]),
  };
}

function bridge(
  overrides: Partial<LocalAsrCaptureBridge> = {},
): LocalAsrCaptureBridge {
  return {
    status: vi.fn(async (): Promise<LocalAsrStatus> => ({
      state: 'NOT_READY',
      active: false,
      lastErrorCode: null,
    })),
    decode: vi.fn(async (): Promise<LocalAsrDecodeResult> => ({
      requestId: REQUEST_ID,
      transcript: '本地结果',
      timings: { decodeMs: 1, totalMs: 2 },
    })),
    cancel: vi.fn(async (requestId) => ({ requestId, cancelled: true })),
    ...overrides,
  };
}

describe('local ASR bridge crash guard', () => {
  it('fails closed before microphone access when the bridge is absent', async () => {
    const getUserMedia = vi.fn(async () => stream());
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: null,
      getUserMedia,
      mediaRecorder: Recorder,
    }));
    await act(async () => {
      await expect(hook.result.current.start()).rejects.toMatchObject({ code: 'NOT_READY' });
    });
    expect(hook.result.current).toMatchObject({
      phase: 'error',
      errorCode: 'NOT_READY',
      coreTruth: { state: 'NOT_READY', active: false },
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('maps malformed or rejecting status to stable fail-closed worker failure', async () => {
    for (const status of [
      vi.fn(async () => ({ state: 'READY' }) as unknown as LocalAsrStatus),
      vi.fn(async () => { throw new Error('private bridge detail'); }),
    ]) {
      const getUserMedia = vi.fn(async () => stream());
      const hook = renderHook(() => useLocalAsrCapture({
        bridge: bridge({ status }),
        getUserMedia,
        mediaRecorder: Recorder,
      }));
      await act(async () => {
        await expect(hook.result.current.start()).rejects.toMatchObject({ code: 'WORKER_FAILURE' });
      });
      expect(hook.result.current).toMatchObject({
        phase: 'error',
        errorCode: 'WORKER_FAILURE',
        coreTruth: { state: 'NOT_READY', active: false },
      });
      expect(getUserMedia).not.toHaveBeenCalled();
      hook.unmount();
    }
  });

  it('cancels a decoding request at most once and ignores its late result', async () => {
    let resolveDecode!: (value: LocalAsrDecodeResult) => void;
    const decode = vi.fn(() => new Promise<LocalAsrDecodeResult>((resolve) => {
      resolveDecode = resolve;
    }));
    const localBridge = bridge({ decode });
    const hook = renderHook(() => useLocalAsrCapture({
      bridge: localBridge,
      getUserMedia: vi.fn(async () => stream()),
      mediaRecorder: Recorder,
      buildRequest: vi.fn(async () => request()),
    }));
    await act(async () => hook.result.current.start());
    const recorder = Recorder.latest!;
    let terminal!: Promise<LocalAsrDecodeResult | null>;
    act(() => {
      terminal = hook.result.current.stop();
      recorder.ondataavailable?.({ data: new Blob(['x']) });
      recorder.onstop?.();
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('decoding'));
    await act(async () => {
      await hook.result.current.cancel();
      await hook.result.current.cancel();
    });
    expect(localBridge.cancel).toHaveBeenCalledTimes(1);
    expect(localBridge.cancel).toHaveBeenCalledWith(REQUEST_ID);
    resolveDecode({
      requestId: REQUEST_ID,
      transcript: '迟到结果',
      timings: { decodeMs: 1, totalMs: 2 },
    });
    await expect(terminal).resolves.toBeNull();
    await act(async () => Promise.resolve());
    expect(hook.result.current).toMatchObject({
      phase: 'cancelled',
      transcript: '',
      result: null,
    });
  });
});
