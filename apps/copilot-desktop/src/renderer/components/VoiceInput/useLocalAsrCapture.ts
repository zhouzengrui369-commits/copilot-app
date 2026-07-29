import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LocalAsrDecodeRequest,
  type LocalAsrDecodeResult,
  type LocalAsrErrorCode,
  type LocalAsrStatus,
  isExactRecord,
  isLocalAsrTimings,
  isUuidV4,
  normalizeLocalAsrTranscript,
} from '../../../shared/local-asr';
import { isKnownLocalAsrErrorCode } from '../../../shared/local-asr-ipc-envelope';
import {
  AudioPcmError,
  LOCAL_ASR_MAX_CAPTURE_BYTES,
  LOCAL_ASR_MAX_CAPTURE_MS,
  buildLocalAsrDecodeRequest,
} from './audio-pcm';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;

export type LocalAsrCapturePhase =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'processing'
  | 'decoding'
  | 'done'
  | 'error'
  | 'cancelled';

export type LocalAsrCaptureErrorCode =
  | LocalAsrErrorCode
  | 'NOT_READY'
  | 'MIC_PERMISSION_DENIED'
  | 'CAPTURE_UNSUPPORTED'
  | 'CAPTURE_TOO_LARGE'
  | 'CAPTURE_TOO_LONG'
  | 'EMPTY_TRANSCRIPT';

export interface LocalAsrCaptureBridge {
  status(): Promise<LocalAsrStatus>;
  decode(request: LocalAsrDecodeRequest): Promise<LocalAsrDecodeResult>;
  cancel(requestId: string): Promise<{ requestId: string; cancelled: boolean }>;
}

export interface MediaRecorderLike {
  readonly state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface MediaRecorderConstructorLike {
  new (
    stream: MediaStream,
    options?: MediaRecorderOptions,
  ): MediaRecorderLike;
  isTypeSupported(mimeType: string): boolean;
}

export interface UseLocalAsrCaptureOptions {
  bridge?: LocalAsrCaptureBridge | null;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  mediaRecorder?: MediaRecorderConstructorLike | null;
  buildRequest?: (blob: Blob) => Promise<LocalAsrDecodeRequest>;
}

export interface UseLocalAsrCaptureResult {
  phase: LocalAsrCapturePhase;
  coreTruth: LocalAsrStatus;
  errorCode: LocalAsrCaptureErrorCode | null;
  requestId: string | null;
  transcript: string;
  result: LocalAsrDecodeResult | null;
  stream: MediaStream | null;
  start(): Promise<void>;
  stop(): Promise<LocalAsrDecodeResult | null>;
  cancel(): Promise<void>;
}

export class LocalAsrCaptureError extends Error {
  constructor(public readonly code: LocalAsrCaptureErrorCode) {
    super(code);
    this.name = 'LocalAsrCaptureError';
    this.stack = undefined;
  }
}

interface CaptureState {
  phase: LocalAsrCapturePhase;
  coreTruth: LocalAsrStatus;
  errorCode: LocalAsrCaptureErrorCode | null;
  requestId: string | null;
  transcript: string;
  result: LocalAsrDecodeResult | null;
  stream: MediaStream | null;
}

interface ActiveRun {
  generation: number;
  bridge: LocalAsrCaptureBridge;
  recorder: MediaRecorderLike | null;
  stream: MediaStream | null;
  chunks: Blob[];
  compressedBytes: number;
  requestId: string | null;
  cancelSent: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  completion: Promise<LocalAsrDecodeResult | null>;
  complete(value: LocalAsrDecodeResult | null): void;
}

type CoreTruthDisposition =
  | 'preserve'
  | 'fail-closed'
  | 'a3-error';

const INITIAL_TRUTH: LocalAsrStatus = {
  state: 'NOT_READY',
  active: false,
  lastErrorCode: null,
};

const INITIAL_STATE: CaptureState = {
  phase: 'idle',
  coreTruth: INITIAL_TRUTH,
  errorCode: null,
  requestId: null,
  transcript: '',
  result: null,
  stream: null,
};

export function useLocalAsrCapture(
  options: UseLocalAsrCaptureOptions = {},
): UseLocalAsrCaptureResult {
  const [state, setState] = useState<CaptureState>(INITIAL_STATE);
  const activeRef = useRef<ActiveRun | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const update = useCallback((patch: Partial<CaptureState>) => {
    if (mountedRef.current) setState((current) => ({ ...current, ...patch }));
  }, []);

  const finishRun = useCallback((
    run: ActiveRun,
    phase: 'error' | 'cancelled',
    code: LocalAsrCaptureErrorCode,
    truthDisposition: CoreTruthDisposition = 'preserve',
  ) => {
    if (activeRef.current !== run) return;
    activeRef.current = null;
    detachRecorder(run.recorder);
    stopRecorder(run.recorder);
    releaseRunTracks(run);
    clearRunTimer(run);
    run.chunks.length = 0;
    run.complete(null);
    update({
      phase,
      errorCode: code,
      requestId: run.requestId,
      result: null,
      transcript: '',
      stream: null,
      ...(truthDisposition === 'fail-closed'
        ? { coreTruth: INITIAL_TRUTH }
        : truthDisposition === 'a3-error'
          ? { coreTruth: coreTruthForA3Error(code) }
          : {}),
    });
  }, [update]);

  const processStopped = useCallback(async (run: ActiveRun) => {
    if (activeRef.current !== run) return;
    detachRecorder(run.recorder);
    releaseRunTracks(run);
    clearRunTimer(run);
    update({ phase: 'processing', stream: null });
    let blob: Blob;
    try {
      blob = new Blob(run.chunks, {
        type: run.chunks[0]?.type || 'audio/webm',
      });
    } catch {
      finishRun(run, 'error', 'INVALID_AUDIO');
      return;
    }
    run.chunks.length = 0;
    if (blob.size <= 0) {
      finishRun(run, 'error', 'INVALID_AUDIO');
      return;
    }

    let request: LocalAsrDecodeRequest;
    try {
      request = await (optionsRef.current.buildRequest
        ?? buildLocalAsrDecodeRequest)(blob);
    } catch (error) {
      finishRun(run, 'error', stableCaptureCode(error));
      return;
    }
    if (activeRef.current !== run || run.generation !== generationRef.current) return;
    run.requestId = request.requestId;
    update({
      phase: 'decoding',
      requestId: request.requestId,
      coreTruth: { state: 'DECODING', active: true, lastErrorCode: null },
    });

    let decoded: LocalAsrDecodeResult;
    try {
      decoded = await run.bridge.decode(request);
    } catch (error) {
      finishRun(run, 'error', stableCaptureCode(error), 'a3-error');
      return;
    }
    if (activeRef.current !== run || run.generation !== generationRef.current) return;
    if (!isLocalAsrDecodeResult(decoded, request.requestId)) {
      finishRun(run, 'error', 'INVALID_WORKER_REPLY', 'a3-error');
      return;
    }
    const transcript = normalizeLocalAsrTranscript(decoded.transcript);
    if (!transcript) {
      finishRun(run, 'error', 'EMPTY_TRANSCRIPT', 'fail-closed');
      return;
    }
    activeRef.current = null;
    run.complete(decoded);
    update({
      phase: 'done',
      coreTruth: { state: 'READY', active: false, lastErrorCode: null },
      errorCode: null,
      requestId: request.requestId,
      transcript,
      result: { ...decoded, transcript },
      stream: null,
    });
  }, [finishRun, update]);

  const start = useCallback(async () => {
    if (activeRef.current) throw new LocalAsrCaptureError('BUSY');
    const bridge = resolveBridge(optionsRef.current.bridge);
    if (!bridge) {
      update({
        phase: 'error',
        coreTruth: INITIAL_TRUTH,
        errorCode: 'NOT_READY',
      });
      throw new LocalAsrCaptureError('NOT_READY');
    }
    const Recorder = resolveRecorder(optionsRef.current.mediaRecorder);
    const mimeType = selectMimeType(Recorder);
    if (!Recorder || !mimeType) {
      update({ phase: 'error', errorCode: 'CAPTURE_UNSUPPORTED' });
      throw new LocalAsrCaptureError('CAPTURE_UNSUPPORTED');
    }
    const getUserMedia = optionsRef.current.getUserMedia ?? defaultGetUserMedia();
    if (!getUserMedia) {
      update({ phase: 'error', errorCode: 'CAPTURE_UNSUPPORTED' });
      throw new LocalAsrCaptureError('CAPTURE_UNSUPPORTED');
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let complete!: (value: LocalAsrDecodeResult | null) => void;
    const completion = new Promise<LocalAsrDecodeResult | null>((resolve) => {
      complete = resolve;
    });
    const run: ActiveRun = {
      generation,
      bridge,
      recorder: null,
      stream: null,
      chunks: [],
      compressedBytes: 0,
      requestId: null,
      cancelSent: false,
      timer: null,
      completion,
      complete,
    };
    activeRef.current = run;
    update({
      phase: 'arming',
      errorCode: null,
      requestId: null,
      transcript: '',
      result: null,
      stream: null,
    });

    let truth: LocalAsrStatus;
    try {
      const status = await bridge.status();
      if (!isLocalAsrStatus(status)) {
        throw new LocalAsrCaptureError('WORKER_FAILURE');
      }
      truth = status;
    } catch {
      if (activeRef.current === run) {
        finishRun(run, 'error', 'WORKER_FAILURE', 'fail-closed');
      }
      throw new LocalAsrCaptureError('WORKER_FAILURE');
    }
    if (activeRef.current !== run || generationRef.current !== generation) return;
    update({ coreTruth: truth });

    try {
      if (truth.active || truth.state === 'DECODING') {
        throw new LocalAsrCaptureError('BUSY');
      }

      const stream = await getUserMedia({ audio: true });
      if (activeRef.current !== run || generationRef.current !== generation) {
        stopTracks(stream);
        return;
      }
      run.stream = stream;
      const recorder = new Recorder(stream, { mimeType });
      run.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (activeRef.current !== run) return;
        const chunkSize = event.data?.size;
        if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
          finishRun(run, 'error', 'INVALID_AUDIO');
          return;
        }
        const nextSize = run.compressedBytes + chunkSize;
        if (
          !Number.isSafeInteger(nextSize)
          || nextSize > LOCAL_ASR_MAX_CAPTURE_BYTES
        ) {
          finishRun(run, 'error', 'CAPTURE_TOO_LARGE');
          return;
        }
        run.compressedBytes = nextSize;
        run.chunks.push(event.data);
      };
      recorder.onerror = () => finishRun(run, 'error', 'WORKER_FAILURE');
      recorder.onstop = () => {
        void processStopped(run);
      };
      recorder.start(250);
      run.timer = setTimeout(() => {
        finishRun(run, 'error', 'CAPTURE_TOO_LONG');
      }, LOCAL_ASR_MAX_CAPTURE_MS);
      update({ phase: 'recording', stream });
    } catch (error) {
      if (activeRef.current !== run) return;
      const code = permissionOrStableCode(error);
      finishRun(run, 'error', code);
      throw new LocalAsrCaptureError(code);
    }
  }, [finishRun, processStopped, update]);

  const stop = useCallback(async (): Promise<LocalAsrDecodeResult | null> => {
    const run = activeRef.current;
    if (!run || !run.recorder || run.recorder.state !== 'recording') {
      throw new LocalAsrCaptureError('INVALID_REQUEST');
    }
    clearRunTimer(run);
    update({ phase: 'processing', stream: null });
    try {
      run.recorder.stop();
    } catch {
      finishRun(run, 'error', 'WORKER_FAILURE');
      throw new LocalAsrCaptureError('WORKER_FAILURE');
    }
    releaseRunTracks(run);
    return run.completion;
  }, [update]);

  const cancel = useCallback(async () => {
    const run = activeRef.current;
    if (!run) return;
    generationRef.current += 1;
    activeRef.current = null;
    detachRecorder(run.recorder);
    stopRecorder(run.recorder);
    releaseRunTracks(run);
    clearRunTimer(run);
    run.chunks.length = 0;
    run.complete(null);
    update({
      phase: 'cancelled',
      errorCode: 'CANCELLED',
      requestId: run.requestId,
      transcript: '',
      result: null,
      stream: null,
      ...(run.requestId ? { coreTruth: INITIAL_TRUTH } : {}),
    });
    const requestId = run.requestId;
    if (requestId && !run.cancelSent) {
      run.cancelSent = true;
      void run.bridge.cancel(requestId)
        .then((reply) => {
          isExactCancelReply(reply, requestId);
        })
        .catch(() => undefined);
    }
  }, [update]);

  useEffect(() => () => {
    mountedRef.current = false;
    const run = activeRef.current;
    activeRef.current = null;
    generationRef.current += 1;
    if (!run) return;
    detachRecorder(run.recorder);
    stopRecorder(run.recorder);
    releaseRunTracks(run);
    clearRunTimer(run);
    run.chunks.length = 0;
    if (run.requestId && !run.cancelSent) {
      run.cancelSent = true;
      void run.bridge.cancel(run.requestId).catch(() => undefined);
    }
    run.complete(null);
  }, []);

  return {
    ...state,
    start,
    stop,
    cancel,
  };
}

function isLocalAsrDecodeResult(
  value: unknown,
  requestId: string,
): value is LocalAsrDecodeResult {
  if (!isExactRecord(value, ['requestId', 'transcript', 'timings'])) return false;
  return value.requestId === requestId
    && isUuidV4(value.requestId)
    && typeof value.transcript === 'string'
    && isLocalAsrTimings(value.timings);
}

function isExactCancelReply(
  value: unknown,
  requestId: string,
): value is { requestId: string; cancelled: boolean } {
  if (!isExactRecord(value, ['requestId', 'cancelled'])) return false;
  return value.requestId === requestId
    && isUuidV4(value.requestId)
    && typeof value.cancelled === 'boolean';
}

function resolveBridge(
  injected: LocalAsrCaptureBridge | null | undefined,
): LocalAsrCaptureBridge | null {
  if (injected !== undefined) return injected;
  if (typeof window === 'undefined') return null;
  return window.copilot?.localAsr ?? null;
}

function resolveRecorder(
  injected: MediaRecorderConstructorLike | null | undefined,
): MediaRecorderConstructorLike | null {
  if (injected !== undefined) return injected;
  if (typeof window === 'undefined' || !window.MediaRecorder) return null;
  return window.MediaRecorder as unknown as MediaRecorderConstructorLike;
}

function defaultGetUserMedia(): ((
  constraints: MediaStreamConstraints,
) => Promise<MediaStream>) | null {
  if (
    typeof navigator === 'undefined'
    || !navigator.mediaDevices
    || typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return null;
  }
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

function selectMimeType(
  Recorder: MediaRecorderConstructorLike | null,
): string | null {
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return null;
  return MIME_TYPES.find((type) => Recorder.isTypeSupported(type)) ?? null;
}

function isLocalAsrStatus(value: unknown): value is LocalAsrStatus {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'active'
    || keys[1] !== 'lastErrorCode'
    || keys[2] !== 'state'
  ) {
    return false;
  }
  const status = value as Partial<LocalAsrStatus>;
  if (
    typeof status.active !== 'boolean'
    || (status.lastErrorCode !== null
      && !isKnownLocalAsrErrorCode(status.lastErrorCode))
  ) {
    return false;
  }
  switch (status.state) {
    case 'NOT_READY':
    case 'READY':
      return !status.active && status.lastErrorCode === null;
    case 'AVAILABLE':
    case 'DECODING':
      return status.active && status.lastErrorCode === null;
    case 'FAILED':
      return !status.active
        && status.lastErrorCode !== null
        && status.lastErrorCode !== 'BUSY'
        && status.lastErrorCode !== 'CANCELLED';
    case 'CANCELLED':
      return !status.active && status.lastErrorCode === 'CANCELLED';
    default:
      return false;
  }
}

function coreTruthForA3Error(
  code: LocalAsrCaptureErrorCode,
): LocalAsrStatus {
  if (code === 'BUSY') {
    return {
      state: 'DECODING',
      active: true,
      lastErrorCode: null,
    };
  }
  if (code === 'CANCELLED') {
    return {
      state: 'CANCELLED',
      active: false,
      lastErrorCode: 'CANCELLED',
    };
  }
  if (
    code === 'ASSETS_UNAVAILABLE'
    || code === 'ASSETS_TAMPERED'
    || code === 'TIMEOUT'
    || code === 'WORKER_FAILURE'
    || code === 'DECODE_FAILURE'
    || code === 'INVALID_WORKER_REPLY'
  ) {
    return {
      state: 'FAILED',
      active: false,
      lastErrorCode: code,
    };
  }
  return INITIAL_TRUTH;
}

function permissionOrStableCode(error: unknown): LocalAsrCaptureErrorCode {
  if (
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'NotAllowedError'
  ) {
    return 'MIC_PERMISSION_DENIED';
  }
  return stableCaptureCode(error);
}

function stableCaptureCode(error: unknown): LocalAsrCaptureErrorCode {
  if (error instanceof LocalAsrCaptureError || error instanceof AudioPcmError) {
    return error.code;
  }
  if (error instanceof Error) {
    const matched = /^\[([A-Z_]+)\]/u.exec(error.message);
    if (matched?.[1] && isKnownLocalAsrErrorCode(matched[1])) return matched[1];
  }
  return 'WORKER_FAILURE';
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Cleanup is best effort; no raw device error is surfaced.
    }
  }
}

function releaseRunTracks(run: ActiveRun): void {
  const stream = run.stream;
  run.stream = null;
  stopTracks(stream);
}

function detachRecorder(recorder: MediaRecorderLike | null): void {
  if (!recorder) return;
  recorder.ondataavailable = null;
  recorder.onerror = null;
  recorder.onstop = null;
}

function stopRecorder(recorder: MediaRecorderLike | null): void {
  if (!recorder || recorder.state === 'inactive') return;
  try {
    recorder.stop();
  } catch {
    // Already terminal.
  }
}

function clearRunTimer(run: ActiveRun): void {
  if (run.timer === null) return;
  clearTimeout(run.timer);
  run.timer = null;
}
