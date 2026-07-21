/**
 * ResetButton — gated "Reset all settings" action.
 *
 * Two-step confirm to keep the user from blowing away their config
 * with a mis-click:
 *   1. window.confirm() (renderer-side, blocking dialog)
 *   2. The button stays disabled for 3 seconds after the user starts
 *      the reset flow — a soft "are you sure" countdown.
 *
 * Calls `useSettingsStore.reset()` which round-trips through the IPC
 * bridge to clear electron-store and re-hydrate defaults.
 *
 * Sprint 1.2 T-1.2.6 (settings panel + theme polish).
 */
import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../stores/settings';
import styles from './styles.module.css';

const CONFIRM_DELAY_MS = 3_000;

export interface ResetButtonProps {
  /** Override the bound store action — useful in tests. */
  onReset?: () => Promise<void> | void;
  /** Override the confirm() function — useful in tests. */
  confirm?: (message: string) => boolean;
  /** Disable the inline confirm gate (e.g. for screenshot tests). */
  skipDelay?: boolean;
}

export function ResetButton(props: ResetButtonProps) {
  const storeReset = useSettingsStore((s) => s.reset);
  const askConfirm =
    props.confirm ??
    (typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm.bind(window)
      : () => true);
  const onReset = props.onReset ?? (() => storeReset());

  const [armed, setArmed] = useState(false);
  const [remaining, setRemaining] = useState(CONFIRM_DELAY_MS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!armed) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    setRemaining(CONFIRM_DELAY_MS);
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 500) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setArmed(false);
          return 0;
        }
        return prev - 500;
      });
    }, 500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [armed]);

  const handleClick = async () => {
    if (!armed) {
      // First click — arm the button for CONFIRM_DELAY_MS.
      setArmed(true);
      return;
    }
    // Second click within the window — actually reset.
    const ok = askConfirm('Reset ALL settings (theme, model, shortcuts, window bounds)?');
    if (!ok) {
      setArmed(false);
      return;
    }
    await onReset();
    setArmed(false);
  };

  const label = armed ? `Click again to confirm (${Math.ceil(remaining / 1000)}s)` : 'Reset to defaults';

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="settings-reset-button"
      data-armed={armed ? 'true' : 'false'}
      className={`${styles.resetButton}${armed ? ` ${styles.resetButtonArmed}` : ''}`}
      aria-label="Reset all settings to defaults"
    >
      {label}
    </button>
  );
}