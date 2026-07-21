/**
 * useTranscriber.ts — strict-local ASR orchestrator.
 *
 * ## Primary / Secondary / Fallback contract (钉子 #23 self-audit)
 *
 * The task contract requires explicit primary / secondary / fallback
 * markers in code (not just in comments). This file exposes three
 * pure, individually-testable functions:
 *
 *   - `webSpeechPrimary()`  — macOS Siri engine via webkitSpeechRecognition
 *                              (free, private, on-device). This is THE primary.
 *   - `cloudAsrSecondary()` — form-data POST to `/api/asr/transcribe`
 *                              on the workbench server (Tencent ASR proxy).
 *                              Engaged only when primary returns empty /
 *                              confidence < minWebSpeechConfidence.
 *   - `nativeFallback()`    — last-resort placeholder. Today it simply
 *                              surfaces a typed `no-fallback-available`
 *                              error; Sprint 1.3 may wire a Whisper.cpp
 *                              sidecar here.
 *
 * `useTranscriber` orchestrates them in order. Each function returns
 * the same `TranscriberResult` shape with `provider` set to the path
 * that produced it (so the UI can show "端侧 ASR" / "云端 ASR" / "native").
 *
 * Sprint 1.2 / T-1.2.4 — voice input (bugfix v2, 2026-07-10).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudAsrProvider,
  type CloudAsrFetchLike,
  type CloudAsrResult,
} from './CloudAsrProvider';
import {
  WebSpeechProvider,
  type LocalAsrRuntimeContext,
  type SpeechRecognitionCtor,
  WebSpeechError,
} from './WebSpeechProvider';

export type TranscriberStatus =
  | 'idle'
  | 'arming'
  | 'armed'
  | 'recording'
  | 'processing'
  | 'done'
  | 'error'
  | 'unsupported';

/** Path that produced the final transcript (钉子 #23 explicit markers). */
export type Provider = 'web-speech' | 'cloud' | 'native';

export interface ProviderTransition {
  provider: Provider | 'system';
  state: string;
  atMs: number;
}

export type AudioDurationSource = 'blob-decoded' | 'unknown';

export interface TranscriberResult {
  text: string;
  confidence: number;
  provider: Provider | null;
  durationMs: number;
  usedFallback: boolean;
  errorCode: string | null;
  /** Per-run evidence. Audio bytes are hashed in memory and never persisted here. */
  runId: string;
  audioSha256: string | null;
  audioMimeType: string | null;
  audioBytes: number;
  audioDurationMs: number | null;
  durationSource: AudioDurationSource;
  providerTransitions: ProviderTransition[];
}

export interface UseTranscriberOptions {
  /** BCP-47 language tag. Default 'zh-CN'. */
  lang?: string;
  /** Below this we consider WebSpeech unreliable and fall back to cloud. */
  minWebSpeechConfidence?: number;
  /** Tests inject a mock SpeechRecognition constructor. */
  speechRecognitionCtor?: SpeechRecognitionCtor | null;
  /** Tests may inject runtime facts; production reads isolated preload meta. */
  localAsrRuntimeContext?: LocalAsrRuntimeContext;
  /** Tests inject a fetch stub. */
  cloudFetchImpl?: CloudAsrFetchLike;
  /** Override the server base URL (v5 workbench default). */
  serverBaseUrl?: string;
  /** Force WebSpeech to the on-device API. Default true. */
  strictLocal?: boolean;
  /** Explicitly opt into audio upload. Default false. */
  enableCloudFallback?: boolean;
  /** Separate, affirmative user consent for the configured cloud endpoint. */
  cloudConsent?: boolean;
  /** Legacy kill switch; cloud remains disabled unless enableCloudFallback is true. */
  disableCloud?: boolean;
  /** Bound recognition and recorder stop/end races. */
  recognitionTimeoutMs?: number;
  recorderStopTimeoutMs?: number;
  /** Bound cloud ASR processing. Default 15000. */
  cloudTimeoutMs?: number;
  /** Bound final Blob duration decoding. Default 1500. */
  audioDecodeTimeoutMs?: number;
  /** Focused tests may inject a final-Blob decoder returning milliseconds. */
  decodeAudioDurationImpl?: (blob: Blob) => Promise<number>;
  /** Override MediaRecorder constructor for tests. */
  mediaRecorderCtor?: typeof MediaRecorder | null;
  /** Override navigator.mediaDevices.getUserMedia. */
  getUserMediaImpl?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export interface PathDeps {
  lang: string;
  minWebSpeechConfidence: number;
  speechRecognitionCtor?: SpeechRecognitionCtor | null;
  cloudFetchImpl?: CloudAsrFetchLike;
  serverBaseUrl?: string;
  cloudTimeoutMs?: number;
  /** Audio bytes captured during the recording session (cloud path needs them). */
  audioBlob?: Blob | null;
  /** AbortSignal so the orchestrator can cancel a stale path. */
  signal?: AbortSignal;
}

export interface UseTranscriberApi {
  status: TranscriberStatus;
  result: TranscriberResult | null;
  stream: MediaStream | null;
  audioLevel: number;
  providerTransitions: ProviderTransition[];
  start(): Promise<void>;
  stop(): Promise<TranscriberResult>;
  cancel(): void;
  reset(): void;
}

const MIN_CONFIDENCE_DEFAULT = 0.55;

const EMPTY_RESULT: TranscriberResult = {
  text: '',
  confidence: -1,
  provider: null,
  durationMs: 0,
  usedFallback: false,
  errorCode: null,
  runId: '',
  audioSha256: null,
  audioMimeType: null,
  audioBytes: 0,
  audioDurationMs: null,
  durationSource: 'unknown',
  providerTransitions: [],
};

function isReliable(text: string, confidence: number, min: number): boolean {
  if (!text || !text.trim()) return false;
  if (confidence < 0) return true;
  return confidence >= min;
}

function getDefaultGetUserMedia(): (c: MediaStreamConstraints) => Promise<MediaStream> {
  const md = (typeof navigator !== 'undefined' ? navigator.mediaDevices : null) as
    | MediaDevices
    | null;
  if (!md || typeof md.getUserMedia !== 'function') {
    return () => Promise.reject(new Error('getUserMedia unavailable'));
  }
  return (c) => md.getUserMedia(c);
}

function getDefaultMediaRecorderCtor(): typeof MediaRecorder | null {
  if (typeof window === 'undefined') return null;
  return (window.MediaRecorder as typeof MediaRecorder | undefined) ?? null;
}

function createRunId(): string {
  const cryptoApi = globalThis.crypto;
  return typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `asr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('blob-read-failed'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

/** SHA-256 is computed in memory; this module never persists the captured Blob. */
export async function sha256Blob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('audio-hash-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blobArrayBuffer(blob));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode duration from the finalized audio Blob, never from wall-clock timing. */
export async function decodeAudioBlobDuration(blob: Blob): Promise<number> {
  if (blob.size === 0) throw new Error('audio-duration-unknown');
  const AudioContextCtor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;
  if (!AudioContextCtor) throw new Error('audio-duration-unknown');
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await blobArrayBuffer(blob));
    const durationMs = decoded.duration * 1_000;
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('audio-duration-unknown');
    }
    return durationMs;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function isExplicitHttpEndpoint(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PRIMARY PATH — WebSpeech (webkitSpeechRecognition, macOS Siri engine)
// ---------------------------------------------------------------------------

/**
 * webSpeechPrimary — run an end-side SpeechRecognition session and
 * return a normalized result. Resolves with empty text when the
 * engine reports silence / abort, so the orchestrator can fall back.
 */
export async function webSpeechPrimary(
  deps: PathDeps,
): Promise<TranscriberResult> {
  const startedAt = performance.now();
  const ws = new WebSpeechProvider(deps.speechRecognitionCtor);
  if (!ws.isAvailable()) {
    return {
      ...EMPTY_RESULT,
      provider: 'web-speech',
      durationMs: performance.now() - startedAt,
      errorCode: 'not-supported',
    };
  }
  try {
    const t = await ws.transcribe({
      language: deps.lang,
      interim: false,
      signal: deps.signal,
    });
    const ok = isReliable(t.text, t.confidence, deps.minWebSpeechConfidence);
    return {
      ...EMPTY_RESULT,
      text: ok ? t.text : '',
      confidence: t.confidence,
      provider: 'web-speech',
      durationMs: performance.now() - startedAt,
      usedFallback: false,
      errorCode: ok ? null : 'below-threshold',
    };
  } catch (err) {
    const code =
      err instanceof WebSpeechError
        ? err.code
        : err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'engine-error';
    return {
      ...EMPTY_RESULT,
      provider: 'web-speech',
      durationMs: performance.now() - startedAt,
      errorCode: code,
    };
  }
}

// ---------------------------------------------------------------------------
// SECONDARY PATH — Cloud ASR (form-data POST to /api/asr/transcribe)
// ---------------------------------------------------------------------------

/**
 * cloudAsrSecondary — POST the recorded audio blob to the workbench
 * ASR proxy and return the transcript. Throws when audioBlob is missing
 * or the server returns a non-2xx response (orchestrator maps to error).
 */
export async function cloudAsrSecondary(
  deps: PathDeps,
): Promise<TranscriberResult> {
  const startedAt = performance.now();
  const cloud = new CloudAsrProvider({
    fetchImpl: deps.cloudFetchImpl,
    serverBaseUrl: deps.serverBaseUrl,
    timeoutMs: deps.cloudTimeoutMs,
  });
  if (!deps.audioBlob || deps.audioBlob.size === 0) {
    return {
      ...EMPTY_RESULT,
      provider: 'cloud',
      durationMs: performance.now() - startedAt,
      errorCode: 'no-audio',
    };
  }
  try {
    const r: CloudAsrResult = await cloud.transcribe(deps.audioBlob, {
      language: deps.lang,
      signal: deps.signal,
      timeoutMs: deps.cloudTimeoutMs,
    });
    const ok = isReliable(r.text, r.confidence, deps.minWebSpeechConfidence);
    return {
      ...EMPTY_RESULT,
      text: ok ? r.text : '',
      confidence: r.confidence,
      provider: 'cloud',
      durationMs: performance.now() - startedAt,
      usedFallback: false,
      errorCode: ok ? null : 'below-threshold',
    };
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown';
    return {
      ...EMPTY_RESULT,
      provider: 'cloud',
      durationMs: performance.now() - startedAt,
      errorCode: code,
    };
  }
}

// ---------------------------------------------------------------------------
// NATIVE FALLBACK PATH — reserved (Sprint 1.3)
// ---------------------------------------------------------------------------

/**
 * nativeFallback — last-resort path. Today this resolves with a typed
 * `no-fallback-available` error so the orchestrator surfaces a clear
 * "no provider worked" state. Sprint 1.3 will wire a Whisper.cpp
 * sidecar here. The marker is intentionally explicit so a Sprint 1.3
 * worker can grep `nativeFallback` and slot in the sidecar without
 * touching webSpeechPrimary / cloudAsrSecondary.
 */
export async function nativeFallback(
  _deps: PathDeps,
): Promise<TranscriberResult> {
  const startedAt = performance.now();
  return {
    ...EMPTY_RESULT,
    provider: 'native',
    durationMs: performance.now() - startedAt,
    errorCode: 'no-fallback-available',
  };
}

// ---------------------------------------------------------------------------
// ORCHESTRATOR HOOK
// ---------------------------------------------------------------------------

type RecognitionOutcome = {
  text: string;
  confidence: number;
  errorCode: string | null;
};

type RunPhase = 'arming' | 'recording' | 'stopping' | 'cancelled' | 'finished';

interface TranscriberRun {
  id: string;
  startedAt: number;
  phase: RunPhase;
  controller: AbortController;
  ws: WebSpeechProvider | null;
  recognitionPromise: Promise<RecognitionOutcome> | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  stream: MediaStream | null;
  raf: number | null;
  analyser: AnalyserNode | null;
  audioContext: AudioContext | null;
  transitions: ProviderTransition[];
  stopPromise: Promise<TranscriberResult> | null;
}

async function measureFinalBlobDuration(
  blob: Blob,
  decoder: (blob: Blob) => Promise<number>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ audioDurationMs: number | null; durationSource: AudioDurationSource }> {
  if (blob.size === 0 || signal.aborted) {
    return { audioDurationMs: null, durationSource: 'unknown' };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (audioDurationMs: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve({
        audioDurationMs,
        durationSource: audioDurationMs === null ? 'unknown' : 'blob-decoded',
      });
    };
    const onAbort = () => finish(null);
    const timeout = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    void decoder(blob).then(
      (durationMs) =>
        finish(
          Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
        ),
      () => finish(null),
    );
  });
}

export function useTranscriber(opts: UseTranscriberOptions = {}): UseTranscriberApi {
  const lang = opts.lang ?? 'zh-CN';
  const minConfidence = opts.minWebSpeechConfidence ?? MIN_CONFIDENCE_DEFAULT;
  const strictLocal = opts.strictLocal !== false;
  const cloudEnabled = opts.enableCloudFallback === true && opts.disableCloud !== true;
  const getUserMedia = opts.getUserMediaImpl ?? getDefaultGetUserMedia();
  const MediaRecorderCtor =
    opts.mediaRecorderCtor === undefined
      ? getDefaultMediaRecorderCtor()
      : opts.mediaRecorderCtor;

  const [status, setStatus] = useState<TranscriberStatus>('idle');
  const [result, setResult] = useState<TranscriberResult | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [providerTransitions, setProviderTransitions] = useState<ProviderTransition[]>([]);
  const activeRunRef = useRef<TranscriberRun | null>(null);
  const latestResultRef = useRef<TranscriberResult | null>(null);

  const isCurrent = useCallback(
    (run: TranscriberRun) => activeRunRef.current === run,
    [],
  );

  const publishResult = useCallback((run: TranscriberRun, next: TranscriberResult) => {
    if (activeRunRef.current !== run) return;
    latestResultRef.current = next;
    setResult(next);
  }, []);

  const pushTransition = useCallback((run: TranscriberRun, provider: Provider | 'system', state: string) => {
    const next = [
      ...run.transitions,
      {
        provider,
        state,
        atMs: Math.max(0, performance.now() - run.startedAt),
      },
    ];
    run.transitions = next;
    if (activeRunRef.current === run) setProviderTransitions(next);
  }, []);

  const cleanupRun = useCallback((run: TranscriberRun, updateUi = true) => {
    if (run.raf !== null) {
      cancelAnimationFrame(run.raf);
      run.raf = null;
    }
    if (run.stream) {
      run.stream.getTracks().forEach((track) => track.stop());
      run.stream = null;
    }
    if (run.analyser) {
      try {
        run.analyser.disconnect();
      } catch {
        /* ignore */
      }
      run.analyser = null;
    }
    if (run.audioContext) {
      void run.audioContext.close().catch(() => undefined);
      run.audioContext = null;
    }
    if (run.recorder && run.recorder.state !== 'inactive') {
      try {
        run.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    run.recorder = null;
    run.chunks = [];
    if (updateUi && activeRunRef.current === run) {
      setStream(null);
      setAudioLevel(0);
    }
  }, []);

  const startLevelMonitor = useCallback((run: TranscriberRun, mediaStream: MediaStream) => {
    const audioCtor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined;
    if (!audioCtor) return;
    const ctx = new audioCtor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    run.audioContext = ctx;
    run.analyser = analyser;

    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (activeRunRef.current !== run || run.phase === 'cancelled') return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setAudioLevel(Math.min(1, rms * 2.5));
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const previous = activeRunRef.current;
    if (previous) {
      previous.phase = 'cancelled';
      previous.controller.abort();
      previous.ws?.abort();
      cleanupRun(previous, false);
    }
    const run: TranscriberRun = {
      id: createRunId(),
      startedAt: performance.now(),
      phase: 'arming',
      controller: new AbortController(),
      ws: null,
      recognitionPromise: null,
      recorder: null,
      chunks: [],
      stream: null,
      raf: null,
      analyser: null,
      audioContext: null,
      transitions: [],
      stopPromise: null,
    };
    activeRunRef.current = run;
    setProviderTransitions([]);
    setResult(null);
    setStatus('arming');

    if (strictLocal) {
      run.ws = new WebSpeechProvider(
        opts.speechRecognitionCtor,
        opts.localAsrRuntimeContext,
      );
      pushTransition(run, 'web-speech', 'checking-local-capability');
      const availability = await run.ws.prepareLocal(lang, run.controller.signal);
      if (!isCurrent(run) || run.phase !== 'arming' || run.controller.signal.aborted) {
        return;
      }
      pushTransition(run, 'web-speech', availability);
      if (availability !== 'available') {
        const failed: TranscriberResult = {
          ...EMPTY_RESULT,
          provider: 'web-speech',
          durationMs: performance.now() - run.startedAt,
          errorCode: availability,
          runId: run.id,
          providerTransitions: [...run.transitions],
        };
        publishResult(run, failed);
        setStatus('error');
        run.phase = 'finished';
        activeRunRef.current = null;
        return;
      }
    } else {
      // Non-strict mode never invokes ordinary WebSpeech because Chromium may
      // route it remotely. The only optional remote path is the consented cloud API.
      pushTransition(run, 'system', 'strict-local-disabled');
    }

    let mediaStream: MediaStream;
    try {
      mediaStream = await getUserMedia({ audio: true });
    } catch (err) {
      if (!isCurrent(run) || run.phase !== 'arming' || run.controller.signal.aborted) {
        return;
      }
      const code = err instanceof Error ? err.name || 'mic-denied' : 'mic-denied';
      const failed: TranscriberResult = {
        ...EMPTY_RESULT,
        durationMs: performance.now() - run.startedAt,
        errorCode: code,
        runId: run.id,
        providerTransitions: [...run.transitions],
      };
      publishResult(run, failed);
      setStatus('error');
      run.phase = 'finished';
      activeRunRef.current = null;
      return;
    }
    if (!isCurrent(run) || run.phase !== 'arming' || run.controller.signal.aborted) {
      mediaStream.getTracks().forEach((track) => track.stop());
      return;
    }
    run.stream = mediaStream;
    setStream(mediaStream);
    startLevelMonitor(run, mediaStream);

    // MediaRecorder captures the evidence Blob in memory. Upload is separately gated.
    if (MediaRecorderCtor) {
      try {
        const mime = MediaRecorderCtor.isTypeSupported?.('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : undefined;
        const recorder = mime
          ? new MediaRecorderCtor(mediaStream, { mimeType: mime })
          : new MediaRecorderCtor(mediaStream);
        run.chunks = [];
        recorder.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) run.chunks.push(ev.data);
        };
        run.recorder = recorder;
        recorder.start(250);
      } catch {
        run.recorder = null;
      }
    }

    if (run.ws) {
      run.recognitionPromise = run.ws
        .transcribe({
          language: lang,
          interim: false,
          strictLocal: true,
          timeoutMs: opts.recognitionTimeoutMs ?? 5_000,
        })
        .then((transcript) => ({ ...transcript, errorCode: null }))
        .catch((error: unknown) => ({
          text: '',
          confidence: -1,
          errorCode:
            error instanceof WebSpeechError
              ? error.code
              : error instanceof Error
                ? error.name || 'engine-error'
                : 'engine-error',
        }));
      pushTransition(run, 'web-speech', 'recording-local');
    } else {
      run.recognitionPromise = Promise.resolve({
        text: '',
        confidence: -1,
        errorCode: 'strict-local-disabled',
      });
    }
    run.phase = 'recording';
    setStatus('recording');
  }, [
    MediaRecorderCtor,
    cleanupRun,
    getUserMedia,
    isCurrent,
    lang,
    opts.recognitionTimeoutMs,
    opts.localAsrRuntimeContext,
    opts.speechRecognitionCtor,
    publishResult,
    pushTransition,
    startLevelMonitor,
    strictLocal,
  ]);

  const stop = useCallback(async (): Promise<TranscriberResult> => {
    const run = activeRunRef.current;
    if (!run) {
      return (
        latestResultRef.current ?? {
          ...EMPTY_RESULT,
          errorCode: 'no-active-session',
        }
      );
    }
    if (run.stopPromise) return run.stopPromise;

    if (run.phase === 'arming') {
      run.phase = 'stopping';
      run.controller.abort();
      pushTransition(run, 'system', 'stopped-during-arming');
      cleanupRun(run);
      const stopped: TranscriberResult = {
        ...EMPTY_RESULT,
        runId: run.id,
        durationMs: performance.now() - run.startedAt,
        errorCode: 'stopped-during-arming',
        providerTransitions: [...run.transitions],
      };
      publishResult(run, stopped);
      setStatus('idle');
      run.phase = 'finished';
      activeRunRef.current = null;
      return stopped;
    }

    const execute = async (): Promise<TranscriberResult> => {
      const sessionDurationMs = performance.now() - run.startedAt;
      const staleResult = (
        evidence: Partial<TranscriberResult> = {},
      ): TranscriberResult => {
        cleanupRun(run, false);
        return {
          ...EMPTY_RESULT,
          ...evidence,
          runId: evidence.runId ?? run.id,
          durationMs: sessionDurationMs,
          errorCode: 'aborted',
          providerTransitions: [...run.transitions],
        };
      };
      const runIsActive = () =>
        isCurrent(run) && !run.controller.signal.aborted;
      run.phase = 'stopping';
      setStatus('processing');
      pushTransition(run, strictLocal ? 'web-speech' : 'system', 'stopping');
      // Stop (never abort) the same recognition instance created by start().
      run.ws?.stop();

      const rec = run.recorder;
      let audioBlob: Blob;
      if (rec && rec.state !== 'inactive') {
        audioBlob = await new Promise<Blob>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve(new Blob(run.chunks, { type: rec.mimeType || 'audio/webm' }));
          };
          const timeout = setTimeout(finish, opts.recorderStopTimeoutMs ?? 1_000);
          rec.onstop = () => {
            clearTimeout(timeout);
            finish();
          };
          try {
            rec.stop();
          } catch {
            clearTimeout(timeout);
            finish();
          }
        });
      } else {
        audioBlob = new Blob(run.chunks, { type: rec?.mimeType || 'audio/webm' });
      }
      if (!runIsActive()) {
        return staleResult({
          audioMimeType: audioBlob.type || 'application/octet-stream',
          audioBytes: audioBlob.size,
        });
      }

      let audioSha256: string | null = null;
      let hashError: string | null = null;
      try {
        audioSha256 = await sha256Blob(audioBlob);
      } catch {
        hashError = 'audio-hash-unavailable';
      }
      if (!runIsActive()) {
        return staleResult({
          audioSha256,
          audioMimeType: audioBlob.type || 'application/octet-stream',
          audioBytes: audioBlob.size,
        });
      }
      if (hashError) {
        pushTransition(run, 'system', hashError);
      }
      const durationEvidence = await measureFinalBlobDuration(
        audioBlob,
        opts.decodeAudioDurationImpl ?? decodeAudioBlobDuration,
        opts.audioDecodeTimeoutMs ?? 1_500,
        run.controller.signal,
      );
      const evidence = {
        runId: run.id,
        audioSha256,
        audioMimeType: audioBlob.type || 'application/octet-stream',
        audioBytes: audioBlob.size,
        ...durationEvidence,
      };
      if (!runIsActive()) {
        return staleResult(evidence);
      }
      if (durationEvidence.durationSource === 'unknown') {
        pushTransition(run, 'system', 'audio-duration-unknown');
      }
      cleanupRun(run);

      const primary = await (run.recognitionPromise ??
        Promise.resolve({ text: '', confidence: -1, errorCode: 'no-recognition-session' }));
      if (!runIsActive()) {
        return staleResult(evidence);
      }
      if (strictLocal) {
        const reliable = isReliable(primary.text, primary.confidence, minConfidence);
        pushTransition(run, 'web-speech', reliable ? 'completed-local' : primary.errorCode ?? 'below-threshold');
        const next: TranscriberResult = {
          ...EMPTY_RESULT,
          ...evidence,
          text: reliable ? primary.text : '',
          confidence: primary.confidence,
          provider: 'web-speech',
          durationMs: sessionDurationMs,
          errorCode: hashError ?? (reliable ? null : primary.errorCode ?? 'below-threshold'),
          providerTransitions: [...run.transitions],
        };
        publishResult(run, next);
        setStatus(next.errorCode === null ? 'done' : 'error');
        run.phase = 'finished';
        activeRunRef.current = null;
        return next;
      }

      let cloudError: string | null = null;
      if (!cloudEnabled) cloudError = 'cloud-disabled';
      else if (opts.cloudConsent !== true) cloudError = 'cloud-consent-required';
      else if (!isExplicitHttpEndpoint(opts.serverBaseUrl)) cloudError = 'cloud-endpoint-required';
      if (cloudError) {
        pushTransition(run, 'cloud', cloudError);
        const next: TranscriberResult = {
          ...EMPTY_RESULT,
          ...evidence,
          durationMs: sessionDurationMs,
          errorCode: hashError ?? cloudError,
          providerTransitions: [...run.transitions],
        };
        publishResult(run, next);
        setStatus('error');
        run.phase = 'finished';
        activeRunRef.current = null;
        return next;
      }

      pushTransition(run, 'cloud', 'uploading-with-consent');
      const secondary = await cloudAsrSecondary({
        lang,
        minWebSpeechConfidence: minConfidence,
        cloudFetchImpl: opts.cloudFetchImpl,
        serverBaseUrl: opts.serverBaseUrl,
        audioBlob,
        signal: run.controller.signal,
        cloudTimeoutMs: opts.cloudTimeoutMs,
      });
      if (!runIsActive()) {
        return staleResult(evidence);
      }
      pushTransition(run, 'cloud', secondary.text ? 'completed-cloud' : secondary.errorCode ?? 'cloud-error');
      const next: TranscriberResult = {
        ...secondary,
        ...evidence,
        durationMs: sessionDurationMs,
        usedFallback: true,
        errorCode: hashError ?? secondary.errorCode,
        providerTransitions: [...run.transitions],
      };
      publishResult(run, next);
      setStatus(next.text && next.errorCode === null ? 'done' : 'error');
      run.phase = 'finished';
      activeRunRef.current = null;
      return next;
    };
    run.stopPromise = execute();
    return run.stopPromise;
  }, [
    cloudEnabled,
    cleanupRun,
    isCurrent,
    lang,
    minConfidence,
    opts.cloudFetchImpl,
    opts.cloudConsent,
    opts.cloudTimeoutMs,
    opts.decodeAudioDurationImpl,
    opts.audioDecodeTimeoutMs,
    opts.recorderStopTimeoutMs,
    opts.serverBaseUrl,
    publishResult,
    pushTransition,
    strictLocal,
  ]);

  const cancel = useCallback((): void => {
    const run = activeRunRef.current;
    if (!run) return;
    run.phase = 'cancelled';
    run.controller.abort();
    // Recognition abort is cancel-only. stop() never calls this path.
    run.ws?.abort();
    pushTransition(run, 'system', 'aborted');
    cleanupRun(run);
    const aborted: TranscriberResult = {
      ...EMPTY_RESULT,
      runId: run.id,
      durationMs: performance.now() - run.startedAt,
      errorCode: 'aborted',
      providerTransitions: [...run.transitions],
    };
    publishResult(run, aborted);
    activeRunRef.current = null;
    setStatus('idle');
  }, [cleanupRun, publishResult, pushTransition]);

  const reset = useCallback((): void => {
    const run = activeRunRef.current;
    if (run) {
      run.phase = 'cancelled';
      run.controller.abort();
      run.ws?.abort();
      cleanupRun(run, false);
      activeRunRef.current = null;
    }
    setResult(null);
    latestResultRef.current = null;
    setProviderTransitions([]);
    setStream(null);
    setAudioLevel(0);
    setStatus('idle');
  }, [cleanupRun]);

  useEffect(() => {
    return () => {
      const run = activeRunRef.current;
      if (!run) return;
      activeRunRef.current = null;
      run.phase = 'cancelled';
      run.controller.abort();
      run.ws?.abort();
      cleanupRun(run, false);
    };
  }, [cleanupRun]);

  return {
    status,
    result,
    stream,
    audioLevel,
    providerTransitions,
    start,
    stop,
    cancel,
    reset,
  };
}

export { WebSpeechError };
export type { WebSpeechProvider, SpeechRecognitionCtor } from './WebSpeechProvider';
export type { CloudAsrProvider } from './CloudAsrProvider';
