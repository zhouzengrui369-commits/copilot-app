/**
 * useTranscriber tests — drive the orchestrator with mocked
 * MediaRecorder, getUserMedia, and fetch. Verify state transitions,
 * fallback behaviour, error mapping, and clean teardown.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTranscriber } from '../../src/renderer/components/VoiceInput/useTranscriber';
import type { CloudAsrFetchLike } from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import type { SpeechRecognitionCtor } from '../../src/renderer/components/VoiceInput/WebSpeechProvider';
import { CHROME_139_LOCAL_ASR_RUNTIME } from './local-asr-test-runtime';

// --- Mocks ----------------------------------------------------------------

class MockMediaRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' | 'stopped' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((ev: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
    // emit one chunk
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(32)], { type: 'audio/webm' }),
      } as unknown as BlobEvent);
    });
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.onstop?.();
    });
  });
}

class MockAudioContext {
  state = 'running';
  analyser = {
    fftSize: 256,
    smoothingTimeConstant: 0.5,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteTimeDomainData: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 128;
    },
  };
  source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  createAnalyser() {
    return this.analyser as unknown as AnalyserNode;
  }
  createMediaStreamSource() {
    return this.source as unknown as MediaStreamAudioSourceNode;
  }
  close() {
    return Promise.resolve();
  }
}

function mockStream(): MediaStream {
  return {
    getTracks: () => [
      {
        stop: vi.fn(),
        kind: 'audio',
        id: 't1',
        enabled: true,
        readyState: 'live',
        applyConstraints: () => Promise.resolve(),
        clone: () => mockStream().getTracks()[0]!,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        onended: null,
        onmute: null,
        onunmute: null,
        label: '',
        muted: false,
        contentHint: '',
        getSettings: () => ({}),
      } as unknown as MediaStreamTrack,
    ],
    active: true,
    id: 's1',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    getAudioTracks: () => mockStream().getTracks(),
    getVideoTracks: () => [],
    clone: () => mockStream(),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream;
}

function makeFetchReturning(text: string, confidence = 0.95): CloudAsrFetchLike {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, confidence }),
    json: async () => ({ text, confidence }),
  })) as unknown as CloudAsrFetchLike;
}

beforeEach(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMediaRecorder;
});

// --- Tests ----------------------------------------------------------------

describe('useTranscriber', () => {
  it('starts and produces a cloud transcript', async () => {
    const fetchImpl = makeFetchReturning('今天我们讨论项目进度');
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        cloudFetchImpl: fetchImpl,
        speechRecognitionCtor: null, // force cloud-only
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'http://127.0.0.1:38888',
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');

    const stopRes = await act(async () => result.current.stop());
    expect(stopRes.text).toBe('今天我们讨论项目进度');
    expect(stopRes.provider).toBe('cloud');
    expect(result.current.status).toBe('done');
  });

  it('marks error when getUserMedia rejects', async () => {
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => {
          const e = new Error('permission denied');
          (e as Error & { name: string }).name = 'NotAllowedError';
          throw e;
        },
        cloudFetchImpl: makeFetchReturning('x'),
        speechRecognitionCtor: null,
        strictLocal: false,
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.result?.errorCode).toBe('NotAllowedError');
  });

  it('cancel() returns to idle and tears down the stream', async () => {
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        cloudFetchImpl: makeFetchReturning('x'),
        speechRecognitionCtor: null,
        strictLocal: false,
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');

    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
  });

  it('maps cloud http error to errorCode', async () => {
    const failFetch: CloudAsrFetchLike = (async () => ({
      ok: false,
      status: 503,
      text: async () => 'asr down',
      json: async () => ({ error: 'asr down' }),
    })) as unknown as CloudAsrFetchLike;
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        cloudFetchImpl: failFetch,
        speechRecognitionCtor: null,
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'http://127.0.0.1:38888',
      }),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      const r = await result.current.stop();
      expect(r.errorCode).toBe('http-503');
    });
    expect(result.current.status).toBe('error');
  });

  it('returns errorCode=no-audio when there are no chunks', async () => {
    // Build a recorder that silently swallows dataavailable events
    // so chunksRef stays empty and the cloud blob has size 0.
    class NoChunkRecorder {
      static isTypeSupported = () => true;
      state: 'inactive' | 'recording' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((ev: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      start = vi.fn(() => {
        this.state = 'recording';
        // do NOT push any chunks
      });
      stop = vi.fn(() => {
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.());
      });
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = NoChunkRecorder;

    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        cloudFetchImpl: makeFetchReturning('x'),
        speechRecognitionCtor: null,
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'http://127.0.0.1:38888',
      }),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      const r = await result.current.stop();
      expect(r.errorCode).toBe('no-audio');
    });
    expect(result.current.status).toBe('error');
  });

  it('reset() clears the result', async () => {
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        cloudFetchImpl: makeFetchReturning('x'),
        speechRecognitionCtor: null,
        strictLocal: false,
        enableCloudFallback: true,
        cloudConsent: true,
        serverBaseUrl: 'http://127.0.0.1:38888',
      }),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.result).toBeNull());
  });

  it('fails closed before microphone/network when forced-local API is missing', async () => {
    const getUserMediaImpl = vi.fn(async () => mockStream());
    const cloudFetchImpl = vi.fn(makeFetchReturning('must-not-run')) as unknown as CloudAsrFetchLike;
    const ctor = function () {
      return {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
      };
    } as unknown as SpeechRecognitionCtor;
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl,
        cloudFetchImpl,
        speechRecognitionCtor: ctor,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
      }),
    );

    await act(async () => result.current.start());
    expect(result.current.status).toBe('error');
    expect(result.current.result?.errorCode).toBe('local-api-unavailable');
    expect(getUserMediaImpl).not.toHaveBeenCalled();
    expect(cloudFetchImpl).not.toHaveBeenCalled();
  });

  it('stops and awaits the same forced-local session and returns in-memory evidence', async () => {
    const instances: Array<InstanceType<SpeechRecognitionCtor>> = [];
    const ctor = function () {
      const inst = {
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
            inst.onresult?.({
              results: [{ isFinal: true, 0: { transcript: '本地转写', confidence: 0.95 } }],
            });
            inst.onend?.();
          });
        }),
        abort: vi.fn(),
      } as InstanceType<SpeechRecognitionCtor>;
      instances.push(inst);
      return inst;
    } as unknown as SpeechRecognitionCtor;
    ctor.available = vi.fn(async () => 'available' as const);
    const cloudFetchImpl = vi.fn(makeFetchReturning('must-not-run')) as unknown as CloudAsrFetchLike;
    const { result } = renderHook(() =>
      useTranscriber({
        getUserMediaImpl: async () => mockStream(),
        mediaRecorderCtor: MockMediaRecorder as unknown as typeof MediaRecorder,
        cloudFetchImpl,
        speechRecognitionCtor: ctor,
        localAsrRuntimeContext: CHROME_139_LOCAL_ASR_RUNTIME,
      }),
    );

    await act(async () => result.current.start());
    const stopped = await act(async () => result.current.stop());
    expect(instances).toHaveLength(1);
    expect(instances[0]?.stop).toHaveBeenCalledOnce();
    expect(instances[0]?.abort).not.toHaveBeenCalled();
    expect(stopped.text).toBe('本地转写');
    expect(stopped.runId).not.toBe('');
    expect(stopped.audioSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stopped.audioBytes).toBeGreaterThan(0);
    expect(stopped.audioMimeType).toContain('audio/webm');
    expect(stopped.providerTransitions.map((entry) => entry.state)).toEqual(
      expect.arrayContaining(['available', 'recording-local', 'stopping', 'completed-local']),
    );
    expect(cloudFetchImpl).not.toHaveBeenCalled();
  });

  it('keeps cloud upload disabled without all three explicit gates', async () => {
    const cloudFetchImpl = vi.fn(makeFetchReturning('must-not-run')) as unknown as CloudAsrFetchLike;
    const { result } = renderHook(() =>
      useTranscriber({
        strictLocal: false,
        getUserMediaImpl: async () => mockStream(),
        mediaRecorderCtor: MockMediaRecorder as unknown as typeof MediaRecorder,
        cloudFetchImpl,
      }),
    );
    await act(async () => result.current.start());
    const stopped = await act(async () => result.current.stop());
    expect(stopped.errorCode).toBe('cloud-disabled');
    expect(cloudFetchImpl).not.toHaveBeenCalled();
  });
});
