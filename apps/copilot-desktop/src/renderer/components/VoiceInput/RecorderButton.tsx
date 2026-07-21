/**
 * RecorderButton.tsx — 5-state microphone button.
 *
 * States:
 *   - idle       (default)
 *   - armed      (mic permission OK, ready to record)
 *   - recording  (active capture)
 *   - processing (transcribing)
 *   - error      (last attempt failed)
 *
 * Sprint 1.2 / T-1.2.4.
 */

import type { ReactElement } from 'react';
import type { TranscriberStatus } from './useTranscriber';

export interface RecorderButtonProps {
  status: TranscriberStatus;
  onStart(): void | Promise<void>;
  onStop(): void | Promise<void>;
  onCancel?(): void;
  disabled?: boolean;
  /** Optional override label (defaults follow status). */
  label?: string;
}

const STATUS_LABEL: Record<TranscriberStatus, string> = {
  idle: '开始录音',
  arming: '准备中…',
  armed: '点击录音',
  recording: '正在录音… 点击结束',
  processing: '转写中…',
  done: '已完成',
  error: '重试录音',
  unsupported: '当前环境不支持语音输入',
};

const STATUS_VARIANT: Record<TranscriberStatus, string> = {
  idle: 'voice-btn--idle',
  arming: 'voice-btn--processing',
  armed: 'voice-btn--armed',
  recording: 'voice-btn--recording',
  processing: 'voice-btn--processing',
  done: 'voice-btn--idle',
  error: 'voice-btn--error',
  unsupported: 'voice-btn--unsupported',
};

export function RecorderButton({
  status,
  onStart,
  onStop,
  onCancel,
  disabled,
  label,
}: RecorderButtonProps): ReactElement {
  const handleClick = () => {
    if (disabled || status === 'processing' || status === 'unsupported') return;
    if (status === 'recording') {
      void onStop();
    } else if (status === 'error' || status === 'idle' || status === 'armed') {
      void onStart();
    }
  };

  const handleAux = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCancel && (status === 'recording' || status === 'processing')) {
      onCancel();
    }
  };

  return (
    <div className="voice-btn-wrap">
      <button
        type="button"
        className={`voice-btn ${STATUS_VARIANT[status]}`}
        data-testid="voice-recorder-button"
        data-status={status}
        aria-pressed={status === 'recording'}
        aria-busy={status === 'processing'}
        disabled={disabled || status === 'processing' || status === 'unsupported'}
        onClick={handleClick}
      >
        <span className="voice-btn__dot" aria-hidden="true" />
        <span className="voice-btn__label">
          {label ?? STATUS_LABEL[status]}
        </span>
      </button>
      {onCancel && (status === 'recording' || status === 'processing') && (
        <button
          type="button"
          className="voice-btn__cancel"
          data-testid="voice-recorder-cancel"
          onClick={handleAux}
        >
          取消
        </button>
      )}
    </div>
  );
}