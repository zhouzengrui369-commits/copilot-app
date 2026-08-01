import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarkdownRenderer,
  safeMarkdownHref,
  sanitizeHtmlPreview,
} from '../src/renderer/components/NoteDetail/MarkdownRenderer.js';
import { VoiceInput } from '../src/renderer/components/VoiceInput/index.js';
import * as captureModule from '../src/renderer/components/VoiceInput/useLocalAsrCapture.js';
import type {
  LocalAsrCaptureErrorCode,
  LocalAsrCapturePhase,
  UseLocalAsrCaptureResult,
} from '../src/renderer/components/VoiceInput/useLocalAsrCapture.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function capture(
  phase: LocalAsrCapturePhase,
  overrides: Partial<UseLocalAsrCaptureResult> = {},
): UseLocalAsrCaptureResult {
  return {
    phase,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownRenderer remaining critical branches', () => {
  it('fails closed for active markdown URLs and preserves allowlisted external links', () => {
    expect(safeMarkdownHref(' javascript:alert(1) ')).toBe('');
    expect(safeMarkdownHref(' mailto:owner@example.test ')).toBe('mailto:owner@example.test');
    expect(safeMarkdownHref(' wikilink:notes/a ')).toBe('wikilink:notes/a');

    render(
      <MarkdownRenderer
        source={'[unsafe](javascript:alert(1)) [mail](mailto:owner@example.test)'}
      />,
    );

    expect(screen.getByRole('link', { name: 'unsafe' })).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute(
      'href',
      'mailto:owner@example.test',
    );
  });

  it('sanitizes active HTML, unwraps passive unknown tags, and rewrites anchor policy', () => {
    const source = [
      '<script>secret-script</script>',
      '<iframe>secret-frame</iframe>',
      '<custom><b title="kept" class="drop" onclick="bad()">Visible</b></custom>',
      '<a href="https://example.test/path" title="safe" onclick="bad()">Safe</a>',
      '<a href="javascript:alert(1)" data-private="x">Blocked</a>',
    ].join('');
    const sanitized = sanitizeHtmlPreview(source);

    expect(sanitized).not.toMatch(/script|iframe|onclick|data-private|class=/u);
    expect(sanitized).not.toContain('secret-script');
    expect(sanitized).not.toContain('secret-frame');
    expect(sanitized).toContain('<b title="kept">Visible</b>');
    expect(sanitized).toContain(
      '<a href="https://example.test/path" title="safe" target="_blank" rel="noopener noreferrer">Safe</a>',
    );
    expect(sanitized).toContain('<a>Blocked</a>');

    render(<MarkdownRenderer format="html" source={source} />);
    const preview = screen.getByTestId('safe-html-preview');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('target', '_blank');
  });
});

describe('VoiceInput remaining critical branches', () => {
  it.each([
    ['cancelled', null, { state: 'NOT_READY', active: false, lastErrorCode: null }, '已取消'],
    ['arming', null, { state: 'NOT_READY', active: false, lastErrorCode: null }, '正在请求麦克风权限'],
    ['recording', null, { state: 'NOT_READY', active: false, lastErrorCode: null }, '正在录音'],
    ['processing', null, { state: 'NOT_READY', active: false, lastErrorCode: null }, '正在处理本地音频'],
    ['decoding', null, { state: 'DECODING', active: true, lastErrorCode: null }, 'LOCAL ASR · DECODING'],
    ['idle', null, { state: 'AVAILABLE', active: true, lastErrorCode: null }, '本地解码占用中'],
    ['error', 'ASSETS_UNAVAILABLE', { state: 'FAILED', active: false, lastErrorCode: 'ASSETS_UNAVAILABLE' }, '本地语音资源不可用'],
  ] as const)(
    'renders %s truth without inventing transcript state',
    (phase, errorCode, coreTruth, expected) => {
      vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue(capture(
        phase,
        {
          errorCode: errorCode as LocalAsrCaptureErrorCode | null,
          coreTruth,
        },
      ));
      render(<VoiceInput />);
      expect(screen.getByTestId('voice-banner')).toHaveTextContent(expected);
      expect(screen.queryByTestId('voice-transcript')).not.toBeInTheDocument();
    },
  );

  it('routes start, stop, and cancel controls while isolating rejected promises', async () => {
    const start = vi.fn(async () => { throw new Error('start failure is contained'); });
    const hook = vi.spyOn(captureModule, 'useLocalAsrCapture');
    hook.mockReturnValue(capture('idle', { start }));
    const view = render(<VoiceInput />);
    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    const stop = vi.fn(async () => { throw new Error('stop failure is contained'); });
    hook.mockReturnValue(capture('recording', { stop }));
    view.rerender(<VoiceInput />);
    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    const cancel = vi.fn(async () => undefined);
    hook.mockReturnValue(capture('processing', { cancel }));
    view.rerender(<VoiceInput />);
    fireEvent.click(screen.getByTestId('voice-recorder-cancel'));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it('contains a synchronous transcript consumer failure and never redelivers the request', async () => {
    const onTranscriptDraft = vi.fn(() => { throw new Error('consumer failed'); });
    vi.spyOn(captureModule, 'useLocalAsrCapture').mockReturnValue(capture('done', {
      coreTruth: { state: 'READY', active: false, lastErrorCode: null },
      requestId: REQUEST_ID,
      transcript: ' local transcript ',
      result: {
        requestId: REQUEST_ID,
        transcript: 'local transcript',
        timings: { decodeMs: 1, totalMs: 2 },
      },
    }));

    const view = render(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);
    await waitFor(() => expect(onTranscriptDraft).toHaveBeenCalledWith(
      'local transcript',
      REQUEST_ID,
    ));
    view.rerender(<VoiceInput onTranscriptDraft={onTranscriptDraft} />);
    await act(async () => Promise.resolve());
    expect(onTranscriptDraft).toHaveBeenCalledTimes(1);
  });
});
