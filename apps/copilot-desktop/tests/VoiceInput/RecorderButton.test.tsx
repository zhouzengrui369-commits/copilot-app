import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecorderButton } from '../../src/renderer/components/VoiceInput/RecorderButton';
import type { LocalAsrCapturePhase } from '../../src/renderer/components/VoiceInput/useLocalAsrCapture';

function renderButton(
  status: LocalAsrCapturePhase,
  options: {
    onStart?: ReturnType<typeof vi.fn>;
    onStop?: ReturnType<typeof vi.fn>;
    onCancel?: ReturnType<typeof vi.fn>;
    disabled?: boolean;
    label?: string;
  } = {},
) {
  const onStart = options.onStart ?? vi.fn();
  const onStop = options.onStop ?? vi.fn();
  const onCancel = options.onCancel ?? vi.fn();
  render(
    <RecorderButton
      status={status}
      onStart={onStart}
      onStop={onStop}
      onCancel={onCancel}
      disabled={options.disabled}
      label={options.label}
    />,
  );
  return { onStart, onStop, onCancel };
}

describe('RecorderButton local capture phases', () => {
  it.each(['idle', 'done', 'error', 'cancelled'] as const)(
    'starts a new explicit run from %s',
    (status) => {
      const { onStart, onStop } = renderButton(status);
      fireEvent.click(screen.getByTestId('voice-recorder-button'));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStop).not.toHaveBeenCalled();
    },
  );

  it('routes recording click to stop and exposes cancel', () => {
    const { onStart, onStop, onCancel } = renderButton('recording');
    fireEvent.click(screen.getByTestId('voice-recorder-button'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('voice-recorder-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(['arming', 'processing', 'decoding'] as const)(
    'disables a second start and keeps cancel available during %s',
    (status) => {
      const { onStart, onCancel } = renderButton(status);
      const button = screen.getByTestId('voice-recorder-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(onStart).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('voice-recorder-cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    },
  );

  it('honors parent disable and custom label', () => {
    const { onStart } = renderButton('idle', { disabled: true, label: '按住说话' });
    const button = screen.getByTestId('voice-recorder-button') as HTMLButtonElement;
    expect(button).toHaveTextContent('按住说话');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });
});
