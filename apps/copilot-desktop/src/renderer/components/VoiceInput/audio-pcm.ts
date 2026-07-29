import {
  LOCAL_ASR_CHANNELS,
  LOCAL_ASR_FORMAT,
  LOCAL_ASR_MAX_BYTE_LENGTH,
  LOCAL_ASR_MAX_SAMPLE_COUNT,
  LOCAL_ASR_SAMPLE_RATE,
  type LocalAsrDecodeRequest,
  isUuidV4,
} from '../../../shared/local-asr';

export const LOCAL_ASR_MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
export const LOCAL_ASR_MAX_CAPTURE_MS = 60_000;
const MAX_DECODED_CHANNELS = 32;
const MAX_DECODED_SAMPLE_RATE = 384_000;

export type AudioPcmErrorCode =
  | 'CAPTURE_UNSUPPORTED'
  | 'CAPTURE_TOO_LARGE'
  | 'CAPTURE_TOO_LONG'
  | 'INVALID_AUDIO';

export class AudioPcmError extends Error {
  constructor(public readonly code: AudioPcmErrorCode) {
    super(code);
    this.name = 'AudioPcmError';
    this.stack = undefined;
  }
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface DecodeAudioContextLike {
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBufferLike>;
  close(): Promise<void>;
}

export interface OfflineAudioBufferLike {
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

export interface OfflineAudioSourceLike {
  buffer: OfflineAudioBufferLike | null;
  connect(destination: unknown): void;
  start(when?: number): void;
}

export interface OfflineAudioContextLike {
  readonly destination: unknown;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): OfflineAudioBufferLike;
  createBufferSource(): OfflineAudioSourceLike;
  startRendering(): Promise<AudioBufferLike>;
}

export interface AudioPcmCryptoLike {
  randomUUID(): string;
  subtle: {
    digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
  };
}

export interface AudioPcmDependencies {
  createDecodeContext?(): DecodeAudioContextLike;
  createOfflineContext?(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): OfflineAudioContextLike;
  crypto?: AudioPcmCryptoLike;
}

export async function buildLocalAsrDecodeRequest(
  blob: Blob,
  dependencies: AudioPcmDependencies = {},
): Promise<LocalAsrDecodeRequest> {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }
  if (blob.size <= 0) throw new AudioPcmError('INVALID_AUDIO');
  if (blob.size > LOCAL_ASR_MAX_CAPTURE_BYTES) {
    throw new AudioPcmError('CAPTURE_TOO_LARGE');
  }

  const createDecodeContext = dependencies.createDecodeContext
    ?? defaultDecodeContextFactory();
  const createOfflineContext = dependencies.createOfflineContext
    ?? defaultOfflineContextFactory();
  const cryptoApi = dependencies.crypto ?? defaultCrypto();
  if (!createDecodeContext || !createOfflineContext || !cryptoApi) {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }

  let decoded: AudioBufferLike;
  let decodeContext: DecodeAudioContextLike;
  try {
    decodeContext = createDecodeContext();
  } catch {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }
  try {
    const sourceBytes = await blob.arrayBuffer();
    if (sourceBytes.byteLength <= 0 || sourceBytes.byteLength > LOCAL_ASR_MAX_CAPTURE_BYTES) {
      throw new AudioPcmError(
        sourceBytes.byteLength > LOCAL_ASR_MAX_CAPTURE_BYTES
          ? 'CAPTURE_TOO_LARGE'
          : 'INVALID_AUDIO',
      );
    }
    decoded = await decodeContext.decodeAudioData(sourceBytes.slice(0));
  } catch (error) {
    if (error instanceof AudioPcmError) throw error;
    throw new AudioPcmError('INVALID_AUDIO');
  } finally {
    try {
      await decodeContext.close();
    } catch {
      // The bounded input lifetime still terminates even if close reports late.
    }
  }

  validateDecodedAudio(decoded);
  const targetLength = Math.round(
    (decoded.length / decoded.sampleRate) * LOCAL_ASR_SAMPLE_RATE,
  );
  if (
    !Number.isSafeInteger(targetLength)
    || targetLength <= 0
    || targetLength > LOCAL_ASR_MAX_SAMPLE_COUNT
  ) {
    throw new AudioPcmError(
      targetLength > LOCAL_ASR_MAX_SAMPLE_COUNT
        ? 'CAPTURE_TOO_LONG'
        : 'INVALID_AUDIO',
    );
  }
  const mono = downmixToMono(decoded);

  let offline: OfflineAudioContextLike;
  try {
    offline = createOfflineContext(1, targetLength, LOCAL_ASR_SAMPLE_RATE);
    const input = offline.createBuffer(1, mono.length, decoded.sampleRate);
    input.copyToChannel(mono, 0);
    const source = offline.createBufferSource();
    source.buffer = input;
    source.connect(offline.destination);
    source.start(0);
  } catch {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }

  let rendered: AudioBufferLike;
  try {
    rendered = await offline.startRendering();
  } catch {
    throw new AudioPcmError('INVALID_AUDIO');
  }
  if (
    rendered.numberOfChannels !== 1
    || rendered.sampleRate !== LOCAL_ASR_SAMPLE_RATE
    || rendered.length !== targetLength
    || rendered.length <= 0
    || rendered.length > LOCAL_ASR_MAX_SAMPLE_COUNT
  ) {
    throw new AudioPcmError('INVALID_AUDIO');
  }
  const samples = rendered.getChannelData(0);
  if (samples.length !== targetLength) throw new AudioPcmError('INVALID_AUDIO');

  const pcm = new Uint8Array(samples.length * 2);
  if (pcm.byteLength !== samples.length * 2 || pcm.byteLength > LOCAL_ASR_MAX_BYTE_LENGTH) {
    throw new AudioPcmError('INVALID_AUDIO');
  }
  const pcmView = new DataView(pcm.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined || !Number.isFinite(sample)) {
      throw new AudioPcmError('INVALID_AUDIO');
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    const signed = clamped < 0
      ? Math.round(clamped * 32_768)
      : Math.round(clamped * 32_767);
    pcmView.setInt16(index * 2, signed, true);
  }

  const pcmBuffer = pcm.buffer;
  if (!(pcmBuffer instanceof ArrayBuffer)) {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }
  let digest: ArrayBuffer;
  let requestId: string;
  try {
    digest = await cryptoApi.subtle.digest('SHA-256', pcmBuffer);
    requestId = cryptoApi.randomUUID();
  } catch {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }
  if (digest.byteLength !== 32 || !isUuidV4(requestId)) {
    throw new AudioPcmError('CAPTURE_UNSUPPORTED');
  }
  const sha256 = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const privatePcm = Uint8Array.from(pcm);
  return {
    requestId,
    format: LOCAL_ASR_FORMAT,
    sampleRate: LOCAL_ASR_SAMPLE_RATE,
    channels: LOCAL_ASR_CHANNELS,
    byteLength: privatePcm.byteLength,
    sampleCount: privatePcm.byteLength / 2,
    sha256,
    pcm: privatePcm,
  };
}

function validateDecodedAudio(decoded: AudioBufferLike): void {
  if (
    !decoded
    || !Number.isFinite(decoded.duration)
    || decoded.duration <= 0
    || decoded.duration * 1_000 > LOCAL_ASR_MAX_CAPTURE_MS
    || !Number.isSafeInteger(decoded.length)
    || decoded.length <= 0
    || !Number.isSafeInteger(decoded.numberOfChannels)
    || decoded.numberOfChannels <= 0
    || decoded.numberOfChannels > MAX_DECODED_CHANNELS
    || !Number.isFinite(decoded.sampleRate)
    || decoded.sampleRate <= 0
    || decoded.sampleRate > MAX_DECODED_SAMPLE_RATE
    || decoded.length > Math.ceil(
      decoded.sampleRate * (LOCAL_ASR_MAX_CAPTURE_MS / 1_000),
    )
    || Math.abs(decoded.duration - (decoded.length / decoded.sampleRate))
      > Math.max(1 / decoded.sampleRate, 0.001)
  ) {
    throw new AudioPcmError(
      decoded?.duration * 1_000 > LOCAL_ASR_MAX_CAPTURE_MS
        ? 'CAPTURE_TOO_LONG'
        : 'INVALID_AUDIO',
    );
  }
}

function downmixToMono(decoded: AudioBufferLike): Float32Array {
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const source = decoded.getChannelData(channel);
    if (source.length < decoded.length) throw new AudioPcmError('INVALID_AUDIO');
    for (let index = 0; index < decoded.length; index += 1) {
      const sample = source[index];
      if (sample === undefined || !Number.isFinite(sample)) {
        throw new AudioPcmError('INVALID_AUDIO');
      }
      mono[index] += sample / decoded.numberOfChannels;
      if (!Number.isFinite(mono[index])) {
        throw new AudioPcmError('INVALID_AUDIO');
      }
    }
  }
  return mono;
}

function defaultDecodeContextFactory(
): (() => DecodeAudioContextLike) | null {
  if (typeof window === 'undefined') return null;
  const Constructor = window.AudioContext;
  if (!Constructor) return null;
  return () => new Constructor() as unknown as DecodeAudioContextLike;
}

function defaultOfflineContextFactory(
): ((
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContextLike) | null {
  if (typeof window === 'undefined' || !window.OfflineAudioContext) return null;
  return (numberOfChannels, length, sampleRate) =>
    new window.OfflineAudioContext(
      numberOfChannels,
      length,
      sampleRate,
    ) as unknown as OfflineAudioContextLike;
}

function defaultCrypto(): AudioPcmCryptoLike | null {
  const cryptoApi = globalThis.crypto;
  if (
    !cryptoApi
    || typeof cryptoApi.randomUUID !== 'function'
    || !cryptoApi.subtle
    || typeof cryptoApi.subtle.digest !== 'function'
  ) {
    return null;
  }
  return cryptoApi as AudioPcmCryptoLike;
}
