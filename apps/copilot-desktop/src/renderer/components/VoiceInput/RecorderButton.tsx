import type { MouseEvent, ReactElement } from 'react';
import type { LocalAsrCapturePhase } from './useLocalAsrCapture';

export interface RecorderButtonProps {
  status: LocalAsrCapturePhase;
  onStart(): void | Promise<void>;
  onStop(): void | Promise<void>;
  onCancel?(): void | Promise<void>;
  disabled?: boolean;
  label?: string;
}

const STATUS_LABEL: Record<LocalAsrCapturePhase, string> = {
  idle: '开始录音',
  arming: '准备中…',
  recording: '正在录音… 点击结束',
  processing: '正在处理…',
  decoding: '本地转写中…',
  done: '再次录音',
  error: '重试录音',
  cancelled: '再次录音',
};

const STATUS_VARIANT: Record<LocalAsrCapturePhase, string> = {
  idle: 'voice-btn--idle',
  arming: 'voice-btn--processing',
  recording: 'voice-btn--recording',
  processing: 'voice-btn--processing',
  decoding: 'voice-btn--processing',
  done: 'voice-btn--idle',
  error: 'voice-btn--error',
  cancelled: 'voice-btn--idle',
};

const STARTABLE = new Set<LocalAsrCapturePhase>([
  'idle',
  'done',
  'error',
  'cancelled',
]);
const CANCELLABLE = new Set<LocalAsrCapturePhase>([
  'arming',
  'recording',
  'processing',
  'decoding',
]);
const START_DISABLED = new Set<LocalAsrCapturePhase>([
  'arming',
  'processing',
  'decoding',
]);

export function RecorderButton({
  status,
  onStart,
  onStop,
  onCancel,
  disabled = false,
  label,
}: RecorderButtonProps): ReactElement {
  const startDisabled = disabled || START_DISABLED.has(status);

  const handleClick = () => {
    if (startDisabled) return;
    if (status === 'recording') {
      void onStop();
      return;
    }
    if (STARTABLE.has(status)) void onStart();
  };

  const handleCancel = (event: MouseEvent) => {
    event.stopPropagation();
    if (onCancel && CANCELLABLE.has(status)) void onCancel();
  };

  return (
    <div className="voice-btn-wrap">
      <button
        type="button"
        className={`voice-btn ${STATUS_VARIANT[status]}`}
        data-testid="voice-recorder-button"
        data-status={status}
        aria-pressed={status === 'recording'}
        aria-busy={status === 'arming' || status === 'processing' || status === 'decoding'}
        disabled={startDisabled}
        onClick={handleClick}
      >
        <span className="voice-btn__dot" aria-hidden="true" />
        <span className="voice-btn__label">{label ?? STATUS_LABEL[status]}</span>
      </button>
      {onCancel && CANCELLABLE.has(status) ? (
        <button
          type="button"
          className="voice-btn__cancel"
          data-testid="voice-recorder-cancel"
          onClick={handleCancel}
        >
          取消
        </button>
      ) : null}
    </div>
  );
}
