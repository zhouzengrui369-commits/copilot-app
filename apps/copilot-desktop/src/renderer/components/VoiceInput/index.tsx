/**
 * index.tsx — public React entry for the voice input panel.
 *
 * Wires useTranscriber → RecorderButton + Waveform + transcript
 * preview. After a successful transcription, the caller can supply
 * an `onTranscribe(text)` callback to persist the note (e.g. into
 * @copilot/kb via packages/kb createNote).
 *
 * Sprint 1.2 / T-1.2.4.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { RecorderButton } from './RecorderButton';
import { Waveform } from './Waveform';
import { useTranscriber } from './useTranscriber';
import type {
  SpeechRecognitionCtor,
} from './WebSpeechProvider';
import type { CloudAsrFetchLike } from './CloudAsrProvider';

export interface VoiceInputProps {
  /** Optional BCP-47 language tag. Default 'zh-CN'. */
  lang?: string;
  /** Called with the final transcript text after a successful stop. */
  onTranscribe?(text: string): void | Promise<void>;
  /** Show the cloud-fallback hint banner when cloud was used. */
  showProviderBadge?: boolean;
  /** Tests can inject these. */
  speechRecognitionCtor?: SpeechRecognitionCtor | null;
  cloudFetchImpl?: CloudAsrFetchLike;
  /** Override the server base URL. */
  serverBaseUrl?: string;
}

export function VoiceInput(props: VoiceInputProps): ReactElement {
  const transcriber = useTranscriber({
    lang: props.lang,
    speechRecognitionCtor: props.speechRecognitionCtor,
    cloudFetchImpl: props.cloudFetchImpl,
    serverBaseUrl: props.serverBaseUrl,
  });
  const [banner, setBanner] = useState<string | null>(null);
  const deliveredRunIdsRef = useRef<Set<string>>(new Set());

  // Keep user-facing completion/error state in sync with the active result.
  useEffect(() => {
    if (transcriber.status === 'done' && transcriber.result?.text) {
      setBanner(
        transcriber.result.usedFallback
          ? '端侧未识别，已通过云端 ASR 转写完成'
          : '转写完成',
      );
    }
    if (transcriber.status === 'error' && transcriber.result?.errorCode) {
      const code = transcriber.result.errorCode;
      const hint =
        code === 'mic-denied' || code === 'NotAllowedError'
          ? '麦克风权限被拒绝，请在系统设置中允许后再试'
          : code === 'local-api-unavailable' || code === 'LOCAL_ASR_RUNTIME_UNAVAILABLE'
            ? '当前 Electron 版本不支持严格本地语音识别；未发送任何音频'
            : code === 'local-model-downloadable'
              ? '本地语音模型尚未安装；本次未发送任何音频'
              : code === 'local-model-downloading'
                ? '本地语音模型仍在下载；本次未发送任何音频'
                : code === 'local-model-unavailable' || code === 'local-availability-error'
                  ? '严格本地语音识别当前不可用；未发送任何音频'
                  : code === 'recognition-timeout'
                    ? '本地语音识别超时；未切换到远程识别'
          : code === 'no-audio'
            ? '未检测到语音输入'
            : code.startsWith('http-')
              ? `云端 ASR 失败（${code}），请稍后重试`
              : code === 'network'
                ? '无法连接云端 ASR 服务，请确认 workbench 已启动'
                : `转写失败（${code}）`;
      setBanner(hint);
    }
  }, [transcriber.status, transcriber.result]);

  // A completed ASR run is a data-integrity boundary: parent re-renders must
  // not persist the same transcript more than once. Mark the run before the
  // fire-and-forget callback so rejected callbacks remain isolated and are
  // not retried implicitly by a later render.
  useEffect(() => {
    const runId = transcriber.result?.runId.trim();
    const text = transcriber.result?.text;
    const onTranscribe = props.onTranscribe;
    if (
      transcriber.status !== 'done'
      || !runId
      || !text
      || !onTranscribe
      || deliveredRunIdsRef.current.has(runId)
    ) {
      return;
    }

    deliveredRunIdsRef.current.add(runId);
    try {
      Promise.resolve(onTranscribe(text)).catch(() => undefined);
    } catch {
      // Keep caller failures isolated from the VoiceInput UI.
    }
  }, [
    transcriber.status,
    transcriber.result?.runId,
    transcriber.result?.text,
    props.onTranscribe,
  ]);

  const status = transcriber.status;
  const result = transcriber.result;
  const stream = transcriber.stream;
  const badge = useMemo(() => {
    if (!props.showProviderBadge) return null;
    if (status !== 'done' || !result?.provider) return null;
    return result.provider === 'cloud' ? '云端 ASR' : '端侧 ASR';
  }, [props.showProviderBadge, status, result]);

  return (
    <section
      className="voice-input"
      data-testid="voice-input-root"
      data-status={status}
    >
      <header className="voice-input__header">
        <h2>语音录入</h2>
        {badge && (
          <span className="voice-input__badge" data-testid="voice-provider-badge">
            {badge}
          </span>
        )}
      </header>

      <Waveform stream={stream} armed={status === 'armed' || status === 'recording'} />

      <div className="voice-input__controls">
        <RecorderButton
          status={status}
          onStart={() => {
            void transcriber.start();
          }}
          onStop={() => {
            void transcriber.stop();
          }}
          onCancel={() => transcriber.cancel()}
        />
      </div>

      {banner && (
        <p className="voice-input__banner" data-testid="voice-banner">
          {banner}
        </p>
      )}

      {transcriber.providerTransitions.length > 0 && (
        <ol className="voice-input__transitions" data-testid="voice-provider-transitions">
          {transcriber.providerTransitions.map((transition, index) => (
            <li key={`${transition.provider}-${transition.state}-${index}`}>
              {transition.provider}: {transition.state}
            </li>
          ))}
        </ol>
      )}

      {result && result.text && (
        <div
          className="voice-input__transcript"
          data-testid="voice-transcript"
          aria-live="polite"
        >
          {result.text}
        </div>
      )}
    </section>
  );
}

export { useTranscriber } from './useTranscriber';
export type { TranscriberStatus, TranscriberResult } from './useTranscriber';
export { WebSpeechProvider, WebSpeechError } from './WebSpeechProvider';
export type {
  Transcript,
  TranscribeOptions,
  SpeechRecognitionLike,
  SpeechRecognitionCtor,
} from './WebSpeechProvider';
export {
  CloudAsrProvider,
  characterAccuracy,
  normalizeAsrGateText,
  levenshteinDistance,
  evaluateAsrCorpus,
} from './CloudAsrProvider';
export type {
  CloudTranscript,
  CloudAsrFetchLike,
  CloudAsrResult,
  CloudAsrOptions,
} from './CloudAsrProvider';
export { Waveform } from './Waveform';
export { RecorderButton } from './RecorderButton';
