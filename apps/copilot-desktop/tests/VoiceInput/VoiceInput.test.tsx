import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceInput } from '../../src/renderer/components/VoiceInput';
import * as captureModule from '../../src/renderer/components/VoiceInput/useLocalAsrCapture';
import type { UseLocalAsrCaptureResult } from '../../src/renderer/components/VoiceInput/useLocalAsrCapture';

const REQUEST_1 = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const REQUEST_2 = 'de305d54-75b4-431b-adb2-eb6b9e546015';

function capture(
  overrides: Partial<UseLocalAsrCaptureResult> = {},
): UseLocalAsrCaptureResult {
  return {
    phase: 'idle',
    coreTruth: { state: 'NOT_READY', active: false, lastErrorCode: null },
    errorCode: null,
    requestId: null,
    transcript: '',
    result: null,
    stream: null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
}

function completed(requestId: string, transcript: string): UseLocalAsrCaptureResult {
  return capture({
    phase: 'done',
    coreTruth: { state: 'READY', active: false, lastErrorCode: null },
    requestId,
    transcript,
    result: { requestId, transcript, timings: { decodeMs: 4, totalMs: 5 } },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceInput local-only renderer boundary', () => {
  it('renders one fail-closed truth surface and starts explicitly', () => {
    const state = capture();
    vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue(state);
    render(<VoiceInput />);
    expect(screen.getByTestId('voice-input-root')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('voice-input-root')).toHaveAttribute('data-truth-tone', 'neutral');
    expect(screen.getByTestId('voice-banner')).toHaveTextContent('LOCAL ASR · NOT_READY');
    expect(screen.queryByTestId('voice-transcript')).not.toBeInTheDocument();
    expect(screen.queryByTestId('voice-provider-badge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    expect(state.start).toHaveBeenCalledTimes(1);
  });

  it('delivers each matching READY non-empty request once across rerenders', async () => {
    const onTranscriptDraft = vi.fn().mockRejectedValue(new Error('parent rejected'));
    const hook = vi.spyOn(captureModule, 'useLocalAsrCapture')
      .mockReturnValue(completed(REQUEST_1, ' 第一次转写 '));
    const view = render(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);

    await waitFor(() => expect(onTranscriptDraft).toHaveBeenCalledTimes(1));
    expect(onTranscriptDraft).toHaveBeenLastCalledWith('第一次转写', REQUEST_1);
    expect(screen.getByTestId('voice-input-root')).toHaveAttribute(
      'data-truth-tone',
      'success',
    );
    expect(screen.getByTestId('voice-banner')).toHaveTextContent('本地转写完成');
    view.rerender(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);
    await act(async () => Promise.resolve());
    expect(onTranscriptDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('voice-transcript')).not.toBeInTheDocument();

    hook.mockReturnValue(completed(REQUEST_2, '第二次转写'));
    view.rerender(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);
    await waitFor(() => expect(onTranscriptDraft).toHaveBeenCalledTimes(2));
    expect(onTranscriptDraft).toHaveBeenLastCalledWith('第二次转写', REQUEST_2);
  });

  it.each([
    ['stale core', completed(REQUEST_1, '不应交付'), { state: 'AVAILABLE', active: false, lastErrorCode: null }],
    ['active core', completed(REQUEST_1, '不应交付'), { state: 'READY', active: true, lastErrorCode: null }],
    ['missing result', { ...completed(REQUEST_1, '不应交付'), result: null }, { state: 'READY', active: false, lastErrorCode: null }],
    ['mismatched result', {
      ...completed(REQUEST_1, '不应交付'),
      result: {
        requestId: REQUEST_2,
        transcript: '不应交付',
        timings: { decodeMs: 4, totalMs: 5 },
      },
    }, { state: 'READY', active: false, lastErrorCode: null }],
    ['empty transcript', completed(REQUEST_1, '   '), { state: 'READY', active: false, lastErrorCode: null }],
  ] as const)('does not deliver %s', async (_label, value, coreTruth) => {
    const onTranscriptDraft = vi.fn();
    vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue({
      ...value,
      coreTruth,
    } as UseLocalAsrCaptureResult);
    render(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);
    await act(async () => Promise.resolve());
    expect(onTranscriptDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId('voice-input-root')).not.toHaveAttribute(
      'data-truth-tone',
      'success',
    );
    expect(screen.getByTestId('voice-banner')).not.toHaveTextContent('本地转写完成');
  });

  it('prioritizes coherent active-core BUSY truth and disables start', () => {
    const busy = capture({
      phase: 'error',
      coreTruth: { state: 'DECODING', active: true, lastErrorCode: null },
      errorCode: 'BUSY',
    });
    vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue(busy);
    render(<VoiceInput />);
    expect(screen.getByTestId('voice-input-root')).toHaveAttribute(
      'data-truth-tone',
      'activity',
    );
    expect(screen.getByTestId('voice-banner')).toHaveTextContent('本地解码占用中');
    const button = screen.getByTestId('voice-recorder-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(busy.start).not.toHaveBeenCalled();
  });

  it('maps stable local error copy and cancel routing without provider transitions', () => {
    const value = capture({
      phase: 'error',
      errorCode: 'MIC_PERMISSION_DENIED',
    });
    vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue(value);
    render(<VoiceInput />);
    expect(screen.getByTestId('voice-banner')).toHaveTextContent(
      '麦克风权限被拒绝，请在系统设置中允许后重试',
    );
    expect(screen.queryByTestId('voice-provider-transitions')).not.toBeInTheDocument();

    const decoding = capture({
      phase: 'decoding',
      coreTruth: { state: 'AVAILABLE', active: true, lastErrorCode: null },
      requestId: REQUEST_1,
    });
    vi.mocked(captureModule.useLocalAsrCapture).mockReturnValue(decoding);
    const view = render(<VoiceInput />);
    expect(screen.getAllByTestId('voice-banner').at(-1)).toHaveTextContent(
      '本地模型已校验 · 解码中',
    );
    fireEvent.click(screen.getAllByTestId('voice-recorder-cancel').at(-1)!);
    expect(decoding.cancel).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
