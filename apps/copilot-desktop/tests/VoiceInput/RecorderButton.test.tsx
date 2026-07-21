/**
 * RecorderButton tests — verify the 5-state visual contract and
 * click → handler routing.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecorderButton } from '../../src/renderer/components/VoiceInput/RecorderButton';

describe('RecorderButton', () => {
  it('renders the idle label and forwards start click', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(
      <RecorderButton status="idle" onStart={onStart} onStop={onStop} />,
    );
    const btn = screen.getByTestId('voice-recorder-button');
    expect(btn.getAttribute('data-status')).toBe('idle');
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('routes recording click to onStop', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(
      <RecorderButton status="recording" onStart={onStart} onStop={onStop} />,
    );
    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('is disabled while processing', () => {
    const onStart = vi.fn();
    render(
      <RecorderButton status="processing" onStart={onStart} onStop={() => undefined} />,
    );
    const btn = screen.getByTestId('voice-recorder-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('is disabled in unsupported mode', () => {
    render(
      <RecorderButton status="unsupported" onStart={() => undefined} onStop={() => undefined} />,
    );
    expect(
      (screen.getByTestId('voice-recorder-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows cancel button when recording and onCancel is provided', () => {
    const onCancel = vi.fn();
    render(
      <RecorderButton
        status="recording"
        onStart={() => undefined}
        onStop={() => undefined}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('voice-recorder-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom label when provided', () => {
    render(
      <RecorderButton
        status="idle"
        onStart={() => undefined}
        onStop={() => undefined}
        label="按住说话"
      />,
    );
    expect(screen.getByTestId('voice-recorder-button').textContent).toContain(
      '按住说话',
    );
  });
});