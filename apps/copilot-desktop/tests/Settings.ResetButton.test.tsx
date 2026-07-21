/**
 * Settings/ResetButton tests.
 *
 *   - First click arms the button
 *   - Second click within the window + confirm()=true fires onReset
 *   - confirm()=false cancels the reset
 *   - After the arm window expires, the button returns to default state
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResetButton } from '../src/renderer/components/Settings/ResetButton';

describe('ResetButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders with default state on first paint', () => {
    render(<ResetButton onReset={() => undefined} confirm={() => true} />);
    const btn = screen.getByTestId('settings-reset-button');
    expect(btn.dataset.armed).toBe('false');
  });

  it('arms the button on first click and does not fire onReset', () => {
    const onReset = vi.fn();
    render(<ResetButton onReset={onReset} confirm={() => true} />);
    fireEvent.click(screen.getByTestId('settings-reset-button'));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-reset-button').dataset.armed).toBe('true');
  });

  it('fires onReset on second click within the arm window when confirm returns true', () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockReturnValue(true);
    render(<ResetButton onReset={onReset} confirm={confirm} />);
    const btn = screen.getByTestId('settings-reset-button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('does not fire onReset when confirm returns false', () => {
    const onReset = vi.fn();
    const confirm = vi.fn().mockReturnValue(false);
    render(<ResetButton onReset={onReset} confirm={confirm} />);
    const btn = screen.getByTestId('settings-reset-button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onReset).not.toHaveBeenCalled();
    // And the button should return to un-armed state.
    expect(btn.dataset.armed).toBe('false');
  });

  it('disarms after the countdown elapses (3s)', async () => {
    render(<ResetButton onReset={() => undefined} confirm={() => true} />);
    const btn = screen.getByTestId('settings-reset-button');
    fireEvent.click(btn);
    expect(btn.dataset.armed).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(btn.dataset.armed).toBe('false');
  }, 8000);
});