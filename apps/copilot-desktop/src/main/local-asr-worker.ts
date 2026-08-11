import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import {
  LOCAL_ASR_CHANNELS,
  LOCAL_ASR_FORMAT,
  LOCAL_ASR_MAX_BYTE_LENGTH,
  LOCAL_ASR_MAX_SAMPLE_COUNT,
  LOCAL_ASR_SAMPLE_RATE,
  type LocalAsrWorkerData,
  type LocalAsrWorkerTerminal,
  isExactRecord,
  isUuidV4,
  normalizeLocalAsrTranscript,
} from '../shared/local-asr';

interface NoEgressState {
  workerConstructionAttempts: number;
  workerConstructions: number;
  unauthorizedWorkerAttempts: number;
  networkAttempts: number;
  childProcessAttempts: number;
  nativeLoads: number;
  helperLoads: number;
}

interface WasmModule {
  _SherpaOnnxGetVersionStr?: () => number;
}

interface RecognitionStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
  free(): void;
}

interface Recognizer {
  createStream(): RecognitionStream;
  isReady(stream: RecognitionStream): boolean;
  decode(stream: RecognitionStream): void;
  getResult(stream: RecognitionStream): { text?: unknown; tokens?: unknown };
  free(): void;
}

interface SherpaAsr {
  createOnlineRecognizer(module: WasmModule, config: unknown): Recognizer;
}

type WasmFactory = (options: Record<string, never>) => Promise<WasmModule>;

declare global {
  var __LOCAL_ASR_NO_EGRESS_STATE__: NoEgressState | undefined;
}

const port = requireParentPort();

let terminalSent = false;
function sendTerminal(terminal: LocalAsrWorkerTerminal): void {
  if (terminalSent) return;
  terminalSent = true;
  port.postMessage(terminal);
}

function requireParentPort(): NonNullable<typeof parentPort> {
  if (!parentPort) throw new Error('LOCAL_ASR_PARENT_PORT_UNAVAILABLE');
  return parentPort;
}

async function run(): Promise<void> {
  const input = parseWorkerData(workerData);
  const guard = globalThis.__LOCAL_ASR_NO_EGRESS_STATE__;
  if (!guard) throw new Error('LOCAL_ASR_NO_EGRESS_PRELOAD_REQUIRED');

  const startedAt = performance.now();
  const require = createRequire(import.meta.url);
  const runtimeRoot = path.join(input.assetRoot, 'runtime');
  const modelRoot = path.join(input.assetRoot, 'model');
  const factory = require(path.join(
    runtimeRoot,
    'sherpa-onnx-wasm-nodejs.js',
  )) as unknown;
  if (typeof factory !== 'function') {
    throw new Error('LOCAL_ASR_WASM_FACTORY_INVALID');
  }
  const wasmModule = await (factory as WasmFactory)({});
  if (typeof wasmModule._SherpaOnnxGetVersionStr !== 'function') {
    throw new Error('LOCAL_ASR_WASM_MODULE_INVALID');
  }
  assertNoEgressGuard(guard, true);

  const sherpa = require(path.join(runtimeRoot, 'sherpa-onnx-asr.js')) as SherpaAsr;
  const recognizer = sherpa.createOnlineRecognizer(wasmModule, {
    featConfig: { sampleRate: LOCAL_ASR_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(modelRoot, 'encoder-epoch-99-avg-1.int8.onnx'),
        decoder: path.join(modelRoot, 'decoder-epoch-99-avg-1.int8.onnx'),
        joiner: path.join(modelRoot, 'joiner-epoch-99-avg-1.int8.onnx'),
      },
      paraformer: { encoder: '', decoder: '' },
      zipformer2Ctc: { model: '' },
      nemoCtc: { model: '' },
      toneCtc: { model: '' },
      tokens: path.join(modelRoot, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: 'cjkchar',
      bpeVocab: '',
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 0,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
    ruleFsts: '',
    ruleFars: '',
  });
  let stream: RecognitionStream | null = null;
  let cleanupFailed = false;
  let transcript: string | null = null;
  const decodeStartedAt = performance.now();
  try {
    stream = recognizer.createStream();
    const samples = pcm16LeToFloat32(input.pcm);
    const samplesPerChunk = 3_200;
    let steps = 0;
    for (let offset = 0; offset < samples.length; offset += samplesPerChunk) {
      stream.acceptWaveform(
        LOCAL_ASR_SAMPLE_RATE,
        samples.subarray(offset, Math.min(offset + samplesPerChunk, samples.length)),
      );
      steps = drainRecognizer(recognizer, stream, steps);
    }
    stream.inputFinished();
    drainRecognizer(recognizer, stream, steps);
    const result = recognizer.getResult(stream);
    transcript = normalizeLocalAsrTranscript(
      result.text
      ?? (Array.isArray(result.tokens) ? result.tokens.join('') : null),
    );
  } finally {
    if (stream) {
      try {
        stream.free();
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      recognizer.free();
    } catch {
      cleanupFailed = true;
    }
  }
  if (!transcript || cleanupFailed) {
    throw new Error('LOCAL_ASR_DECODE_OR_CLEANUP_FAILED');
  }
  assertNoEgressGuard(guard, false);
  const finishedAt = performance.now();
  sendTerminal({
    type: 'result',
    requestId: input.request.requestId,
    transcript,
    timings: {
      decodeMs: finishedAt - decodeStartedAt,
      totalMs: finishedAt - startedAt,
    },
  });
}

void run()
  .catch(() => {
    const requestId = getRequestId(workerData);
    if (requestId) {
      sendTerminal({
        type: 'error',
        requestId,
        code: 'DECODE_FAILURE',
      });
    }
  })
  .finally(() => {
    port.close();
  });

function parseWorkerData(value: unknown): LocalAsrWorkerData {
  if (!isExactRecord(value, ['request', 'pcm', 'assetRoot'])) {
    throw new Error('LOCAL_ASR_WORKER_DATA_INVALID');
  }
  const request = value.request;
  if (
    !isExactRecord(request, [
      'requestId',
      'format',
      'sampleRate',
      'channels',
      'byteLength',
      'sampleCount',
      'sha256',
    ])
    || !isUuidV4(request.requestId)
    || request.format !== LOCAL_ASR_FORMAT
    || request.sampleRate !== LOCAL_ASR_SAMPLE_RATE
    || request.channels !== LOCAL_ASR_CHANNELS
    || typeof request.byteLength !== 'number'
    || !Number.isSafeInteger(request.byteLength)
    || request.byteLength <= 0
    || request.byteLength > LOCAL_ASR_MAX_BYTE_LENGTH
    || request.byteLength % 2 !== 0
    || typeof request.sampleCount !== 'number'
    || !Number.isSafeInteger(request.sampleCount)
    || request.sampleCount <= 0
    || request.sampleCount > LOCAL_ASR_MAX_SAMPLE_COUNT
    || typeof request.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(request.sha256)
    || !(value.pcm instanceof ArrayBuffer)
    || Object.getPrototypeOf(value.pcm) !== ArrayBuffer.prototype
    || value.pcm.byteLength !== request.byteLength
    || request.sampleCount !== request.byteLength / 2
    || typeof value.assetRoot !== 'string'
    || !path.isAbsolute(value.assetRoot)
  ) {
    throw new Error('LOCAL_ASR_WORKER_DATA_INVALID');
  }
  if (createHash('sha256').update(new Uint8Array(value.pcm)).digest('hex') !== request.sha256) {
    throw new Error('LOCAL_ASR_WORKER_DATA_INVALID');
  }
  return value as unknown as LocalAsrWorkerData;
}

function getRequestId(value: unknown): string | null {
  if (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && isUuidV4((value as { request?: { requestId?: unknown } }).request?.requestId)
  ) {
    return (value as { request: { requestId: string } }).request.requestId;
  }
  return null;
}

function pcm16LeToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const output = new Float32Array(buffer.byteLength / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return output;
}

function drainRecognizer(
  recognizer: Recognizer,
  stream: RecognitionStream,
  initialSteps: number,
): number {
  let steps = initialSteps;
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
    steps += 1;
    if (steps > 100_000) throw new Error('LOCAL_ASR_DECODE_GUARD_EXCEEDED');
  }
  return steps;
}

function assertNoEgressGuard(
  state: NoEgressState,
  requireFourWorkers: boolean,
): void {
  if (
    state.unauthorizedWorkerAttempts !== 0
    || state.networkAttempts !== 0
    || state.childProcessAttempts !== 0
    || state.nativeLoads !== 0
    || state.helperLoads !== 0
    || (requireFourWorkers
      && (state.workerConstructionAttempts !== 4 || state.workerConstructions !== 4))
  ) {
    throw new Error('LOCAL_ASR_NO_EGRESS_GUARD_FAILED');
  }
}
