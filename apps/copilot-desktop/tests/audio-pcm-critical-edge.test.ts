import { randomUUID, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPcmError,
  LOCAL_ASR_MAX_CAPTURE_BYTES,
  buildLocalAsrDecodeRequest,
  type AudioBufferLike,
  type AudioPcmCryptoLike,
  type DecodeAudioContextLike,
  type OfflineAudioBufferLike,
  type OfflineAudioContextLike,
  type OfflineAudioSourceLike,
} from '../src/renderer/components/VoiceInput/audio-pcm.js';
import { LOCAL_ASR_SAMPLE_RATE } from '../src/shared/local-asr.js';

const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
const originalOfflineAudioContext = Object.getOwnPropertyDescriptor(window, 'OfflineAudioContext');
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

afterEach(() => {
  vi.restoreAllMocks();
  restoreProperty(window, 'AudioContext', originalAudioContext);
  restoreProperty(window, 'OfflineAudioContext', originalOfflineAudioContext);
  restoreProperty(globalThis, 'crypto', originalCrypto);
});

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

function buffer(
  channels: readonly (readonly number[])[] = [[0, 0.25, -0.25, 1]],
  sampleRate: number = LOCAL_ASR_SAMPLE_RATE,
  overrides: Partial<AudioBufferLike> = {},
): AudioBufferLike {
  const arrays = channels.map((values) => Float32Array.from(values));
  const length = arrays[0]?.length ?? 0;
  return {
    duration: length / sampleRate,
    length,
    numberOfChannels: arrays.length,
    sampleRate,
    getChannelData: (channel) => arrays[channel] ?? new Float32Array(0),
    ...overrides,
  };
}

function cryptoMock(overrides: Partial<AudioPcmCryptoLike> = {}): AudioPcmCryptoLike {
  return {
    randomUUID,
    subtle: {
      digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data),
    },
    ...overrides,
  } as AudioPcmCryptoLike;
}

function contexts(
  decoded = buffer([[1, -1], [0.5, -0.5]]),
  rendered = buffer([[1.5, -1.5]], LOCAL_ASR_SAMPLE_RATE),
  overrides: {
    close?: () => Promise<void>;
    startRendering?: () => Promise<AudioBufferLike>;
    setup?: () => void;
  } = {},
) {
  const close = vi.fn(overrides.close ?? (async () => undefined));
  const decodeAudioData = vi.fn(async () => decoded);
  const createDecodeContext = () => ({ decodeAudioData, close } satisfies DecodeAudioContextLike);
  const copyToChannel = vi.fn();
  const input: OfflineAudioBufferLike = { copyToChannel };
  const source: OfflineAudioSourceLike = {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
  };
  const offline: OfflineAudioContextLike = {
    destination: {},
    createBuffer: vi.fn(() => input),
    createBufferSource: vi.fn(() => source),
    startRendering: vi.fn(overrides.startRendering ?? (async () => rendered)),
  };
  const createOfflineContext = vi.fn(() => {
    overrides.setup?.();
    return offline;
  });
  return {
    close,
    decodeAudioData,
    createDecodeContext,
    copyToChannel,
    input,
    source,
    offline,
    createOfflineContext,
  };
}

function fakeBlob(size: number, bytes: ArrayBuffer): Blob {
  return { size, arrayBuffer: async () => bytes } as Blob;
}

async function expectCode(promise: Promise<unknown>, code: AudioPcmError['code']): Promise<void> {
  await expect(promise).rejects.toEqual(expect.objectContaining({
    name: 'AudioPcmError',
    code,
    stack: undefined,
  }));
}

describe('local ASR PCM conversion critical edges', () => {
  it('downmixes, resamples, clamps PCM16LE and returns a private hashed request', async () => {
    const decoded = buffer([[1, -1], [0.5, -0.5]]);
    const rendered = buffer([[1.5, -1.5]], LOCAL_ASR_SAMPLE_RATE);
    const deps = contexts(decoded, rendered);

    const request = await buildLocalAsrDecodeRequest(new Blob([Uint8Array.of(1, 2, 3)]), {
      createDecodeContext: deps.createDecodeContext,
      createOfflineContext: deps.createOfflineContext,
      crypto: cryptoMock(),
    });

    expect(request).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
      format: 'PCM16LE',
      sampleRate: 16_000,
      channels: 1,
      byteLength: 4,
      sampleCount: 2,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(Array.from(request.pcm)).toEqual([255, 127, 0, 128]);
    expect(deps.copyToChannel).toHaveBeenCalledWith(Float32Array.from([0.75, -0.75]), 0);
    expect(deps.source.buffer).toBe(deps.input);
    expect(deps.source.connect).toHaveBeenCalledWith(deps.offline.destination);
    expect(deps.source.start).toHaveBeenCalledWith(0);
    expect(deps.close).toHaveBeenCalledTimes(1);
  });

  it('uses the browser default AudioContext, OfflineAudioContext and crypto factories', async () => {
    const decoded = buffer([[0.25, -0.25]]);
    const rendered = buffer([[0.25, -0.25]], LOCAL_ASR_SAMPLE_RATE);
    class FakeAudioContext {
      decodeAudioData = vi.fn(async () => decoded);
      close = vi.fn(async () => undefined);
    }
    class FakeOfflineAudioContext {
      destination = {};
      constructor(
        public readonly numberOfChannels: number,
        public readonly length: number,
        public readonly sampleRate: number,
      ) {}
      createBuffer(): OfflineAudioBufferLike {
        return { copyToChannel: vi.fn() };
      }
      createBufferSource(): OfflineAudioSourceLike {
        return { buffer: null, connect: vi.fn(), start: vi.fn() };
      }
      async startRendering() {
        return rendered;
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, 'OfflineAudioContext', {
      configurable: true,
      value: FakeOfflineAudioContext,
    });
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: cryptoMock(),
    });

    await expect(buildLocalAsrDecodeRequest(new Blob([Uint8Array.of(1)])))
      .resolves.toMatchObject({ sampleCount: 2, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) });
  });

  it('rejects unsupported, empty and oversized capture envelopes before decoding', async () => {
    await expectCode(buildLocalAsrDecodeRequest(null as never), 'CAPTURE_UNSUPPORTED');
    await expectCode(buildLocalAsrDecodeRequest({ size: 1 } as Blob), 'CAPTURE_UNSUPPORTED');
    await expectCode(buildLocalAsrDecodeRequest(fakeBlob(0, new ArrayBuffer(0))), 'INVALID_AUDIO');
    await expectCode(
      buildLocalAsrDecodeRequest(fakeBlob(LOCAL_ASR_MAX_CAPTURE_BYTES + 1, new ArrayBuffer(1))),
      'CAPTURE_TOO_LARGE',
    );

    const noFactories = new Blob([Uint8Array.of(1)]);
    Reflect.deleteProperty(window, 'AudioContext');
    Reflect.deleteProperty(window, 'OfflineAudioContext');
    await expectCode(buildLocalAsrDecodeRequest(noFactories, { crypto: cryptoMock() }), 'CAPTURE_UNSUPPORTED');
  });

  it('normalizes decode construction, source-byte, decode and close failures', async () => {
    const blob = fakeBlob(1, Uint8Array.of(1).buffer);
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: () => { throw new Error('constructor'); },
      createOfflineContext: contexts().createOfflineContext,
      crypto: cryptoMock(),
    }), 'CAPTURE_UNSUPPORTED');

    const empty = contexts();
    await expectCode(buildLocalAsrDecodeRequest(fakeBlob(1, new ArrayBuffer(0)), {
      createDecodeContext: empty.createDecodeContext,
      createOfflineContext: empty.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');

    const huge = contexts();
    await expectCode(buildLocalAsrDecodeRequest(
      fakeBlob(1, new ArrayBuffer(LOCAL_ASR_MAX_CAPTURE_BYTES + 1)),
      {
        createDecodeContext: huge.createDecodeContext,
        createOfflineContext: huge.createOfflineContext,
        crypto: cryptoMock(),
      },
    ), 'CAPTURE_TOO_LARGE');

    const decodeFailure = contexts();
    decodeFailure.decodeAudioData.mockRejectedValueOnce(new Error('decode'));
    decodeFailure.close.mockRejectedValueOnce(new Error('late close'));
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: decodeFailure.createDecodeContext,
      createOfflineContext: decodeFailure.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');
    expect(decodeFailure.close).toHaveBeenCalled();
  });

  it.each([
    [buffer([[1]], 16_000, { duration: Number.NaN }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { duration: 0 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { duration: 61 }), 'CAPTURE_TOO_LONG'],
    [buffer([[1]], 16_000, { length: 0 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { length: 1.5 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { numberOfChannels: 0 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { numberOfChannels: 33 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { sampleRate: 0 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { sampleRate: 384_001 }), 'INVALID_AUDIO'],
    [buffer([[1]], 16_000, { duration: 0.5 }), 'INVALID_AUDIO'],
  ] as const)('rejects malformed decoded audio %#', async (decoded, code) => {
    const deps = contexts(decoded);
    await expectCode(buildLocalAsrDecodeRequest(new Blob([Uint8Array.of(1)]), {
      createDecodeContext: deps.createDecodeContext,
      createOfflineContext: deps.createOfflineContext,
      crypto: cryptoMock(),
    }), code);
  });

  it('rejects short and non-finite decoded channel data during downmix', async () => {
    const short = buffer([[1]], 16_000, {
      length: 2,
      duration: 2 / 16_000,
      getChannelData: () => Float32Array.of(1),
    });
    const shortDeps = contexts(short);
    await expectCode(buildLocalAsrDecodeRequest(new Blob([Uint8Array.of(1)]), {
      createDecodeContext: shortDeps.createDecodeContext,
      createOfflineContext: shortDeps.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');

    const invalid = buffer([[Number.NaN]], 16_000);
    const invalidDeps = contexts(invalid);
    await expectCode(buildLocalAsrDecodeRequest(new Blob([Uint8Array.of(1)]), {
      createDecodeContext: invalidDeps.createDecodeContext,
      createOfflineContext: invalidDeps.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');
  });

  it('normalizes offline setup, rendering and rendered-envelope failures', async () => {
    const decoded = buffer([[0.25, -0.25]]);
    const blob = new Blob([Uint8Array.of(1)]);
    const setup = contexts(decoded, buffer([[0, 0]]), { setup: () => { throw new Error('setup'); } });
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: setup.createDecodeContext,
      createOfflineContext: setup.createOfflineContext,
      crypto: cryptoMock(),
    }), 'CAPTURE_UNSUPPORTED');

    const rendering = contexts(decoded, buffer([[0, 0]]), {
      startRendering: async () => { throw new Error('render'); },
    });
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: rendering.createDecodeContext,
      createOfflineContext: rendering.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');

    for (const rendered of [
      buffer([[0, 0], [0, 0]]),
      buffer([[0, 0]], 8_000),
      buffer([[0]], 16_000),
      buffer([[0, 0]], 16_000, { length: 0 }),
    ]) {
      const deps = contexts(decoded, rendered);
      await expectCode(buildLocalAsrDecodeRequest(blob, {
        createDecodeContext: deps.createDecodeContext,
        createOfflineContext: deps.createOfflineContext,
        crypto: cryptoMock(),
      }), 'INVALID_AUDIO');
    }
  });

  it('rejects rendered sample corruption and cryptographic failures', async () => {
    const decoded = buffer([[0.25, -0.25]]);
    const blob = new Blob([Uint8Array.of(1)]);
    const shortRendered = buffer([[0]], 16_000, {
      length: 2,
      duration: 2 / 16_000,
      getChannelData: () => Float32Array.of(0),
    });
    const short = contexts(decoded, shortRendered);
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: short.createDecodeContext,
      createOfflineContext: short.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');

    const nonFinite = contexts(decoded, buffer([[Number.POSITIVE_INFINITY, 0]]));
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: nonFinite.createDecodeContext,
      createOfflineContext: nonFinite.createOfflineContext,
      crypto: cryptoMock(),
    }), 'INVALID_AUDIO');

    const cryptoFailure = contexts(decoded, buffer([[0, 0]]));
    await expectCode(buildLocalAsrDecodeRequest(blob, {
      createDecodeContext: cryptoFailure.createDecodeContext,
      createOfflineContext: cryptoFailure.createOfflineContext,
      crypto: cryptoMock({
        subtle: { digest: async () => { throw new Error('digest'); } },
      }),
    }), 'CAPTURE_UNSUPPORTED');

    for (const crypto of [
      cryptoMock({ subtle: { digest: async () => new ArrayBuffer(31) } }),
      cryptoMock({ randomUUID: () => 'not-a-v4' }),
    ]) {
      const deps = contexts(decoded, buffer([[0, 0]]));
      await expectCode(buildLocalAsrDecodeRequest(blob, {
        createDecodeContext: deps.createDecodeContext,
        createOfflineContext: deps.createOfflineContext,
        crypto,
      }), 'CAPTURE_UNSUPPORTED');
    }
  });
});
