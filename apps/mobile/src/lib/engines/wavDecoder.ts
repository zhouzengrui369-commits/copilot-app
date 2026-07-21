// 2026-07-06 — R19B WAV decoder for the bundled sherpa-onnx test_wavs/.
//
// react-native-sherpa-onnx exposes a `decodeAudioFileToFloatSamples` on the
// same TurboModule as `createStreamingSTT`, but the package's `exports`
// field does not include that TurboModule in any public subpath, so the
// stt subpath (the only one we use) does not re-export it. We therefore
// read the WAV file via expo-file-system and decode it ourselves. We
// only need to handle the small subset the bundled `test_wavs/*.wav`
// actually contain: 16-bit signed little-endian mono PCM, 8 kHz or
// 16 kHz. We do a simple linear resample to 16 kHz if the source isn't
// already at the target rate. Anything fancier (LIST chunks, 24-bit,
// multi-channel) is gracefully ignored — we just stop at the first
// `data` chunk we find.

import * as Files from "expo-file-system";

export async function decodeWavToFloatSamples(
  fileUri: string,
  targetSampleRateHz: number,
): Promise<{ samples: number[]; sampleRate: number }> {
  const rawPath = fileUri.startsWith("file://")
    ? fileUri.slice("file://".length)
    : fileUri;
  const filePath = rawPath.startsWith("/") ? `file://${rawPath}` : rawPath;
  const file = new Files.File(filePath);
  if (!file.exists) {
    throw new Error(`decodeWavToFloatSamples: file not found: ${filePath}`);
  }
  const ab = await file.arrayBuffer();
  if (!ab || ab.byteLength === 0) {
    throw new Error("decodeWavToFloatSamples: file empty");
  }
  return decodeWavBytes(new Uint8Array(ab), targetSampleRateHz);
}

export function decodeWavBytes(
  bytes: Uint8Array,
  targetSampleRateHz: number,
): { samples: number[]; sampleRate: number } {
  if (bytes.length < 44) {
    throw new Error("decodeWavBytes: too short for WAV header");
  }
  const decoder = new TextDecoder("utf-8");
  const riff = decoder.decode(bytes.slice(0, 4));
  const wave = decoder.decode(bytes.slice(8, 12));
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("decodeWavBytes: not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number; byteRate: number; blockAlign: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = decoder.decode(bytes.slice(offset, offset + 4));
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    if (id === "fmt ") {
      const audioFormat = bytes[offset + 8] | (bytes[offset + 9] << 8);
      const numChannels = bytes[offset + 10] | (bytes[offset + 11] << 8);
      const sampleRate = bytes[offset + 12] | (bytes[offset + 13] << 8) | (bytes[offset + 14] << 16) | (bytes[offset + 15] << 24);
      const byteRate = bytes[offset + 16] | (bytes[offset + 17] << 8) | (bytes[offset + 18] << 16) | (bytes[offset + 19] << 24);
      const blockAlign = bytes[offset + 20] | (bytes[offset + 21] << 8);
      const bitsPerSample = bytes[offset + 22] | (bytes[offset + 23] << 8);
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample, byteRate, blockAlign };
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) {
    throw new Error("decodeWavBytes: missing fmt or data chunk");
  }
  if (fmt.audioFormat !== 1) {
    throw new Error(`decodeWavBytes: unsupported audioFormat=${fmt.audioFormat} (only PCM=1)`);
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`decodeWavBytes: unsupported bitsPerSample=${fmt.bitsPerSample} (only 16)`);
  }
  if (fmt.numChannels !== 1) {
    throw new Error(`decodeWavBytes: unsupported numChannels=${fmt.numChannels} (only 1)`);
  }
  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const lo = bytes[dataOffset + i * 2];
    const hi = bytes[dataOffset + i * 2 + 1];
    let s = lo | (hi << 8);
    if (s >= 0x8000) s -= 0x10000;
    samples[i] = s / 32768;
  }
  if (fmt.sampleRate === targetSampleRateHz) {
    return { samples, sampleRate: fmt.sampleRate };
  }
  return { samples: linearResample(samples, fmt.sampleRate, targetSampleRateHz), sampleRate: targetSampleRateHz };
}

function linearResample(
  samples: number[],
  fromRate: number,
  toRate: number,
): number[] {
  if (samples.length === 0) return samples;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(samples.length * ratio));
  const out = new Array<number>(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const t = i / ratio;
    const lo = Math.floor(t);
    const hi = Math.min(samples.length - 1, lo + 1);
    const frac = t - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}
