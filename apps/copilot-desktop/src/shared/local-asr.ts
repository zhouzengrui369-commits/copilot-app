export const LOCAL_ASR_SAMPLE_RATE = 16_000 as const;
export const LOCAL_ASR_CHANNELS = 1 as const;
export const LOCAL_ASR_FORMAT = 'PCM16LE' as const;
export const LOCAL_ASR_MAX_SAMPLE_COUNT = 960_000;
export const LOCAL_ASR_MAX_BYTE_LENGTH = 1_920_000;
export const LOCAL_ASR_MAX_TRANSCRIPT_CHARS = 32_768;
export const LOCAL_ASR_MAX_TIMING_MS = 300_000;

export type LocalAsrTruthState =
  | 'NOT_READY'
  | 'AVAILABLE'
  | 'DECODING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED';

export type LocalAsrErrorCode =
  | 'ASSETS_UNAVAILABLE'
  | 'ASSETS_TAMPERED'
  | 'INVALID_REQUEST'
  | 'INVALID_AUDIO'
  | 'BUSY'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'WORKER_FAILURE'
  | 'DECODE_FAILURE'
  | 'INVALID_WORKER_REPLY';

const ERROR_MESSAGES: Readonly<Record<LocalAsrErrorCode, string>> = {
  ASSETS_UNAVAILABLE: 'The local speech assets are unavailable.',
  ASSETS_TAMPERED: 'The local speech assets failed integrity verification.',
  INVALID_REQUEST: 'The local speech request is invalid.',
  INVALID_AUDIO: 'The local speech audio envelope is invalid.',
  BUSY: 'A local speech request is already active.',
  TIMEOUT: 'The local speech request timed out.',
  CANCELLED: 'The local speech request was cancelled.',
  WORKER_FAILURE: 'The local speech worker failed.',
  DECODE_FAILURE: 'Local speech decoding failed.',
  INVALID_WORKER_REPLY: 'The local speech worker returned an invalid reply.',
};

export class LocalAsrError extends Error {
  constructor(public readonly code: LocalAsrErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocalAsrError';
  }
}

export interface LocalAsrDecodeRequest {
  requestId: string;
  format: typeof LOCAL_ASR_FORMAT;
  sampleRate: typeof LOCAL_ASR_SAMPLE_RATE;
  channels: typeof LOCAL_ASR_CHANNELS;
  byteLength: number;
  sampleCount: number;
  sha256: string;
  pcm: Uint8Array;
}

export interface LocalAsrTimings {
  decodeMs: number;
  totalMs: number;
}

export interface LocalAsrDecodeResult {
  requestId: string;
  transcript: string;
  timings: LocalAsrTimings;
}

export interface LocalAsrStatus {
  state: LocalAsrTruthState;
  active: boolean;
  lastErrorCode: LocalAsrErrorCode | null;
}

export interface LocalAsrWorkerRequestMetadata {
  requestId: string;
  format: typeof LOCAL_ASR_FORMAT;
  sampleRate: typeof LOCAL_ASR_SAMPLE_RATE;
  channels: typeof LOCAL_ASR_CHANNELS;
  byteLength: number;
  sampleCount: number;
  sha256: string;
}

export interface LocalAsrWorkerData {
  request: LocalAsrWorkerRequestMetadata;
  pcm: ArrayBuffer;
  assetRoot: string;
}

export type LocalAsrWorkerTerminal =
  | {
    type: 'result';
    requestId: string;
    transcript: string;
    timings: LocalAsrTimings;
  }
  | {
    type: 'error';
    requestId: string;
    code: 'DECODE_FAILURE';
  };

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function normalizeLocalAsrTranscript(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0 || normalized.length > LOCAL_ASR_MAX_TRANSCRIPT_CHARS) {
    return null;
  }
  return normalized;
}

export function isLocalAsrTimings(value: unknown): value is LocalAsrTimings {
  if (!isExactRecord(value, ['decodeMs', 'totalMs'])) return false;
  const decodeMs = value.decodeMs;
  const totalMs = value.totalMs;
  return typeof decodeMs === 'number'
    && Number.isFinite(decodeMs)
    && decodeMs >= 0
    && decodeMs <= LOCAL_ASR_MAX_TIMING_MS
    && typeof totalMs === 'number'
    && Number.isFinite(totalMs)
    && totalMs >= decodeMs
    && totalMs <= LOCAL_ASR_MAX_TIMING_MS;
}

export function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
