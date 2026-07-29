import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AudioPcmError,
  LOCAL_ASR_MAX_CAPTURE_BYTES,
  buildLocalAsrDecodeRequest,
  type AudioBufferLike,
  type AudioPcmDependencies,
} from '../../src/renderer/components/VoiceInput/audio-pcm';

const REQUEST_ID = 'de305d54-75b4-431b-adb2-eb6b9e546014';

function fixtureBlob(
  bytes: readonly number[] | Uint8Array,
  type = 'audio/webm',
): Blob {
  const privateBytes = Uint8Array.from(bytes);
  if (privateBytes.byteLength > LOCAL_ASR_MAX_CAPTURE_BYTES) {
    throw new Error('test fixture exceeds local capture bound');
  }
  return {
    size: privateBytes.byteLength,
    type,
    arrayBuffer: async () => Uint8Array.from(privateBytes).buffer,
  } as unknown as Blob;
}

function audio(
  channels: number[][],
  sampleRate = 16_000,
  overrides: Partial<AudioBufferLike> = {},
): AudioBufferLike {
  const length = channels[0]?.length ?? 0;
  return {
    duration: length / sampleRate,
    length,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (channel) => Float32Array.from(channels[channel] ?? []),
    ...overrides,
  };
}

function harness(
  decoded: AudioBufferLike,
  rendered: AudioBufferLike,
): {
  dependencies: AudioPcmDependencies;
  close: ReturnType<typeof vi.fn>;
  offlineFactory: ReturnType<typeof vi.fn>;
  copied: () => Float32Array | null;
} {
  const close = vi.fn(async () => undefined);
  let copied: Float32Array | null = null;
  const offlineFactory = vi.fn((
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ) => {
    const buffer = {
      copyToChannel: vi.fn((source: Float32Array) => {
        copied = Float32Array.from(source);
      }),
    };
    const source = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    };
    return {
      destination: {},
      createBuffer: vi.fn(() => buffer),
      createBufferSource: vi.fn(() => source),
      startRendering: vi.fn(async () => rendered),
      __args: [numberOfChannels, length, sampleRate],
    };
  });
  return {
    dependencies: {
      createDecodeContext: () => ({
        decodeAudioData: vi.fn(async () => decoded),
        close,
      }),
      createOfflineContext: offlineFactory,
      crypto: {
        randomUUID: () => REQUEST_ID,
        subtle: {
          digest: vi.fn(async (_algorithm, data) => Uint8Array.from(
            createHash('sha256')
              .update(new Uint8Array(data as ArrayBuffer))
              .digest(),
          ).buffer),
        },
      },
    },
    close,
    offlineFactory,
    copied: () => copied,
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: AudioPcmError['code'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'AudioPcmError',
    code,
  });
}

describe('local ASR in-memory PCM envelope', () => {
  it('downmixes all channels and emits exact PCM16LE edges, digest and envelope', async () => {
    const decoded = audio([
      [-1, -0.5, 0, 0.5, 1],
      [1, 0.5, 0, -0.5, -1],
    ]);
    const rendered = audio([[-1, -0.5, 0, 0.5, 1]]);
    const fakes = harness(decoded, rendered);

    const request = await buildLocalAsrDecodeRequest(
      fixtureBlob([1, 2, 3]),
      fakes.dependencies,
    );

    const expected = new Uint8Array([
      0x00, 0x80,
      0x00, 0xc0,
      0x00, 0x00,
      0x00, 0x40,
      0xff, 0x7f,
    ]);
    expect(fakes.copied()).toEqual(Float32Array.from([0, 0, 0, 0, 0]));
    expect(fakes.offlineFactory).toHaveBeenCalledWith(1, 5, 16_000);
    expect(fakes.close).toHaveBeenCalledTimes(1);
    expect(Object.keys(request).sort()).toEqual([
      'byteLength',
      'channels',
      'format',
      'pcm',
      'requestId',
      'sampleCount',
      'sampleRate',
      'sha256',
    ]);
    expect(request).toMatchObject({
      requestId: REQUEST_ID,
      format: 'PCM16LE',
      sampleRate: 16_000,
      channels: 1,
      byteLength: 10,
      sampleCount: 5,
      sha256: createHash('sha256').update(expected).digest('hex'),
    });
    expect(request.pcm).toEqual(expected);
  });

  it('uses browser-native resampling to the exact 16 kHz target length', async () => {
    const decoded = audio([[0.25, -0.25]], 8_000);
    const rendered = audio([[0.25, 0.125, -0.125, -0.25]], 16_000);
    const fakes = harness(decoded, rendered);

    const request = await buildLocalAsrDecodeRequest(
      fixtureBlob([9]),
      fakes.dependencies,
    );

    expect(fakes.offlineFactory).toHaveBeenCalledWith(1, 4, 16_000);
    expect(request.sampleCount).toBe(4);
    expect(request.byteLength).toBe(8);
    expect(fakes.close).toHaveBeenCalledTimes(1);
  });

  it('rejects empty, oversized, over-duration and malformed decoded audio', async () => {
    const valid = audio([[0]], 16_000);
    const fakes = harness(valid, valid);
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([]), fakes.dependencies),
      'INVALID_AUDIO',
    );

    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    await expectCode(
      buildLocalAsrDecodeRequest({
        size: LOCAL_ASR_MAX_CAPTURE_BYTES + 1,
        arrayBuffer,
      } as unknown as Blob, fakes.dependencies),
      'CAPTURE_TOO_LARGE',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();

    const tooLong = audio([[0]], 16_000, {
      duration: 60.001,
      length: 960_016,
    });
    const longFakes = harness(tooLong, valid);
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([1]), longFakes.dependencies),
      'CAPTURE_TOO_LONG',
    );
    expect(longFakes.close).toHaveBeenCalledTimes(1);

    const nonFinite = audio([[Number.NaN]]);
    const invalidFakes = harness(nonFinite, nonFinite);
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([1]), invalidFakes.dependencies),
      'INVALID_AUDIO',
    );
    expect(invalidFakes.close).toHaveBeenCalledTimes(1);
  });

  it('closes the decode context on rejection and rejects invalid render/crypto output', async () => {
    const close = vi.fn(async () => undefined);
    const rejected: AudioPcmDependencies = {
      createDecodeContext: () => ({
        decodeAudioData: vi.fn(async () => {
          throw new Error('raw decoder detail');
        }),
        close,
      }),
      createOfflineContext: vi.fn(),
      crypto: {
        randomUUID: () => REQUEST_ID,
        subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) },
      },
    };
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([1]), rejected),
      'INVALID_AUDIO',
    );
    expect(close).toHaveBeenCalledTimes(1);

    const valid = audio([[0]]);
    const wrongRendered = audio([[0, 0]]);
    const renderFakes = harness(valid, wrongRendered);
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([1]), renderFakes.dependencies),
      'INVALID_AUDIO',
    );

    const cryptoFakes = harness(valid, valid);
    cryptoFakes.dependencies.crypto = {
      randomUUID: () => 'not-a-uuid',
      subtle: { digest: vi.fn(async () => new ArrayBuffer(31)) },
    };
    await expectCode(
      buildLocalAsrDecodeRequest(fixtureBlob([1]), cryptoFakes.dependencies),
      'CAPTURE_UNSUPPORTED',
    );
  });
});
