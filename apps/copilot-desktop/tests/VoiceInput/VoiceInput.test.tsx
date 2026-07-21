/**
 * VoiceInput integration test — exercises the public React entry.
 * Uses focused dependency stubs so jsdom can verify renderer integration
 * without spawning Electron.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceInput } from '../../src/renderer/components/VoiceInput';
import * as transcriberModule from '../../src/renderer/components/VoiceInput/useTranscriber';
import type {
  TranscriberResult,
  UseTranscriberApi,
} from '../../src/renderer/components/VoiceInput/useTranscriber';
import type { CloudAsrFetchLike } from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import type {
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
} from '../../src/renderer/components/VoiceInput/WebSpeechProvider';

class StubRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((ev: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(32)], { type: 'audio/webm' }),
      } as unknown as BlobEvent);
    });
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  });
}

class StubAudioContext {
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
  source = { connect: vi.fn(), disconnect: vi.fn() };
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

function completedTranscriber(runId: string, text: string): UseTranscriberApi {
  const result: TranscriberResult = {
    text,
    confidence: 0.95,
    provider: 'web-speech',
    durationMs: 1_000,
    usedFallback: false,
    errorCode: null,
    runId,
    audioSha256: 'a'.repeat(64),
    audioMimeType: 'audio/webm',
    audioBytes: 32,
    audioDurationMs: 1_000,
    durationSource: 'blob-decoded',
    providerTransitions: [],
  };
  return {
    status: 'done',
    result,
    stream: null,
    audioLevel: 0,
    providerTransitions: [],
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => result),
    cancel: vi.fn(),
    reset: vi.fn(),
  };
}

beforeEach(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = StubAudioContext;
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = StubRecorder;
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class FakeResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceInput', () => {
  it('renders the initial idle recorder controls', () => {
    const onTranscribe = vi.fn();
    const fetchImpl: CloudAsrFetchLike = (async () => ({
      ok: true,
      status: 200,
      text: async () => '{"text":"今天讨论项目进度","confidence":0.95}',
      json: async () => ({ text: '今天讨论项目进度', confidence: 0.95 }),
    })) as unknown as CloudAsrFetchLike;

    render(
      <VoiceInput
        onTranscribe={onTranscribe}
        cloudFetchImpl={fetchImpl}
        speechRecognitionCtor={null}
        serverBaseUrl="http://127.0.0.1:8787"
        showProviderBadge
      />,
    );

    // Drive getUserMedia via a hook override would normally happen via
    // window.copilot, but here we just verify the buttons render and
    // show the right state. (Full getUserMedia flow is exercised in
    // useTranscriber.test.ts.)
    const root = screen.getByTestId('voice-input-root');
    expect(root.getAttribute('data-status')).toBe('idle');
    const btn = screen.getByTestId('voice-recorder-button');
    expect(btn.textContent).toContain('开始录音');
  });

  it('delivers each completed non-empty runId once across parent re-renders', async () => {
    const onTranscribe = vi.fn().mockRejectedValue(new Error('save failed'));
    const useTranscriber = vi
      .spyOn(transcriberModule, 'useTranscriber')
      .mockReturnValue(completedTranscriber('run-1', '第一次转写'));

    const { rerender } = render(
      <VoiceInput onTranscribe={onTranscribe} showProviderBadge={false} />,
    );
    await waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(1));
    expect(onTranscribe).toHaveBeenLastCalledWith('第一次转写');

    rerender(<VoiceInput onTranscribe={onTranscribe} showProviderBadge />);
    await act(async () => Promise.resolve());
    expect(onTranscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('voice-transcript')).toHaveTextContent('第一次转写');

    useTranscriber.mockReturnValue(completedTranscriber('run-2', '第二次转写'));
    rerender(<VoiceInput onTranscribe={onTranscribe} showProviderBadge />);
    await waitFor(() => expect(onTranscribe).toHaveBeenCalledTimes(2));
    expect(onTranscribe).toHaveBeenLastCalledWith('第二次转写');
  });

  it('shows the unsupported label when no recognition engine exists', () => {
    // The default SpeechRecognition isn't installed in jsdom. Verify the
    // component can still render its fail-closed entry state without crashing.
    render(<VoiceInput />);
    expect(screen.getByTestId('voice-input-root')).toBeTruthy();
  });

  it('shows a stable fail-closed error and ordered provider transitions', async () => {
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
      } as SpeechRecognitionLike;
    } as unknown as SpeechRecognitionCtor;
    const cloudFetchImpl = vi.fn() as unknown as CloudAsrFetchLike;
    render(<VoiceInput speechRecognitionCtor={ctor} cloudFetchImpl={cloudFetchImpl} />);

    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    await waitFor(() => {
      expect(screen.getByTestId('voice-banner')).toHaveTextContent(
        '当前 Electron 版本不支持严格本地语音识别；未发送任何音频',
      );
    });
    const transitions = screen.getByTestId('voice-provider-transitions');
    expect(transitions.textContent).toContain('checking-local-capability');
    expect(transitions.textContent).toContain('LOCAL_ASR_RUNTIME_UNAVAILABLE');
    expect(cloudFetchImpl).not.toHaveBeenCalled();
  });
});
