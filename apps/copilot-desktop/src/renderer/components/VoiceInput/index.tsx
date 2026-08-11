import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { RecorderButton } from './RecorderButton';
import { Waveform } from './Waveform';
import {
  useLocalAsrCapture,
  type LocalAsrCaptureErrorCode,
  type LocalAsrCapturePhase,
} from './useLocalAsrCapture';

export interface VoiceInputProps {
  onTranscriptDraft?(text: string, requestId: string): void | Promise<void>;
}

const ERROR_COPY: Record<LocalAsrCaptureErrorCode, string> = {
  NOT_READY: '本地语音尚未就绪',
  BUSY: '本地语音正在处理另一项任务',
  MIC_PERMISSION_DENIED: '麦克风权限被拒绝，请在系统设置中允许后重试',
  CAPTURE_UNSUPPORTED: '当前环境不支持本地语音录入',
  CAPTURE_TOO_LARGE: '本次录音过大，已停止且未保存',
  CAPTURE_TOO_LONG: '本次录音已达到时长上限，已停止且未保存',
  INVALID_AUDIO: '未检测到可转写音频',
  EMPTY_TRANSCRIPT: '未识别到可用文字，草稿未更改',
  ASSETS_UNAVAILABLE: '本地语音资源不可用',
  ASSETS_TAMPERED: '本地语音资源完整性校验失败',
  TIMEOUT: '本地语音转写超时',
  WORKER_FAILURE: '本地语音工作进程失败',
  DECODE_FAILURE: '本地语音解码失败',
  INVALID_WORKER_REPLY: '本地语音返回结果无效',
  CANCELLED: '已取消',
  INVALID_REQUEST: '本地语音请求无效',
};

interface TruthPresentation {
  copy: string;
  tone: 'neutral' | 'activity' | 'success' | 'error';
}

function truthPresentation(
  phase: LocalAsrCapturePhase,
  coreState: ReturnType<typeof useLocalAsrCapture>['coreTruth']['state'],
  errorCode: LocalAsrCaptureErrorCode | null,
  completionReady: boolean,
  coreDecodeActive: boolean,
): TruthPresentation {
  if (phase === 'error' && errorCode === 'BUSY' && coreDecodeActive) {
    return { copy: '本地解码占用中', tone: 'activity' };
  }
  if (phase === 'error' && errorCode) {
    return { copy: ERROR_COPY[errorCode], tone: 'error' };
  }
  if (phase === 'cancelled') return { copy: '已取消', tone: 'neutral' };
  if (phase === 'arming') return { copy: '正在请求麦克风权限', tone: 'activity' };
  if (phase === 'recording') return { copy: '正在录音', tone: 'activity' };
  if (phase === 'processing') return { copy: '正在处理本地音频', tone: 'activity' };
  if (phase === 'decoding') {
    return {
      copy: coreState === 'AVAILABLE' && coreDecodeActive
        ? '本地模型已校验 · 解码中'
        : 'LOCAL ASR · DECODING',
      tone: 'activity',
    };
  }
  if (completionReady) {
    return { copy: '本地转写完成', tone: 'success' };
  }
  if (coreDecodeActive) {
    return { copy: '本地解码占用中', tone: 'activity' };
  }
  return { copy: 'LOCAL ASR · NOT_READY', tone: 'neutral' };
}

export function VoiceInput({
  onTranscriptDraft,
}: VoiceInputProps): ReactElement {
  const capture = useLocalAsrCapture();
  const deliveredRequestIdsRef = useRef(new Set<string>());
  const completion = useMemo(() => {
    const requestId = capture.requestId?.trim() ?? '';
    const text = capture.transcript.trim();
    const result = capture.result;
    return {
      ready: capture.phase === 'done'
        && capture.coreTruth.state === 'READY'
        && !capture.coreTruth.active
        && Boolean(requestId)
        && result !== null
        && result.requestId === requestId
        && Boolean(text),
      requestId,
      text,
    };
  }, [
    capture.coreTruth.active,
    capture.coreTruth.state,
    capture.phase,
    capture.requestId,
    capture.result,
    capture.transcript,
  ]);
  const coreDecodeActive = capture.coreTruth.active
    && (
      capture.coreTruth.state === 'DECODING'
      || capture.coreTruth.state === 'AVAILABLE'
    );

  useEffect(() => {
    if (
      !completion.ready
      || !onTranscriptDraft
      || deliveredRequestIdsRef.current.has(completion.requestId)
    ) {
      return;
    }

    deliveredRequestIdsRef.current.add(completion.requestId);
    try {
      Promise.resolve(
        onTranscriptDraft(completion.text, completion.requestId),
      ).catch(() => undefined);
    } catch {
      // Keep callback failures isolated without redelivering the request.
    }
  }, [
    completion,
    onTranscriptDraft,
  ]);

  const truth = useMemo(
    () => truthPresentation(
      capture.phase,
      capture.coreTruth.state,
      capture.errorCode,
      completion.ready,
      coreDecodeActive,
    ),
    [
      capture.coreTruth.active,
      capture.coreTruth.state,
      capture.errorCode,
      capture.phase,
      completion.ready,
      coreDecodeActive,
    ],
  );

  return (
    <section
      className="voice-input"
      data-testid="voice-input-root"
      data-status={capture.phase}
      data-core-state={capture.coreTruth.state}
      data-truth-tone={truth.tone}
    >
      <header className="voice-input__header">
        <h2>语音录入</h2>
      </header>
      <Waveform
        stream={capture.stream}
        armed={capture.phase === 'recording' && capture.stream !== null}
      />
      <div className="voice-input__controls">
        <RecorderButton
          status={capture.phase}
          disabled={coreDecodeActive}
          onStart={() => {
            void capture.start().catch(() => undefined);
          }}
          onStop={() => {
            void capture.stop().catch(() => undefined);
          }}
          onCancel={() => {
            void capture.cancel();
          }}
        />
      </div>
      <p
        className="voice-input__banner"
        data-testid="voice-banner"
        role="status"
      >
        {truth.copy}
      </p>
    </section>
  );
}

export { Waveform } from './Waveform';
export { RecorderButton } from './RecorderButton';
export { useLocalAsrCapture } from './useLocalAsrCapture';
export type {
  LocalAsrCaptureErrorCode,
  LocalAsrCapturePhase,
  UseLocalAsrCaptureResult,
} from './useLocalAsrCapture';
