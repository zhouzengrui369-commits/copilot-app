import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  LOCAL_ASR_CHANNELS,
  LOCAL_ASR_FORMAT,
  LOCAL_ASR_MAX_BYTE_LENGTH,
  LOCAL_ASR_MAX_SAMPLE_COUNT,
  LOCAL_ASR_SAMPLE_RATE,
  LocalAsrError,
  type LocalAsrDecodeRequest,
  type LocalAsrDecodeResult,
  type LocalAsrErrorCode,
  type LocalAsrStatus,
  type LocalAsrWorkerData,
  isExactRecord,
  isLocalAsrTimings,
  isUuidV4,
  normalizeLocalAsrTranscript,
} from '../shared/local-asr';
import {
  verifyLocalAsrAssets,
  type VerifiedLocalAsrAssets,
} from './local-asr-assets';

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 300_000;
const REQUEST_KEYS = [
  'requestId',
  'format',
  'sampleRate',
  'channels',
  'byteLength',
  'sampleCount',
  'sha256',
  'pcm',
] as const;

type WorkerListener = (value: unknown) => void;

export interface LocalAsrWorkerLike {
  on(event: string, listener: WorkerListener): this;
  off(event: string, listener: WorkerListener): this;
  terminate(): Promise<number> | number;
}

export interface LocalAsrWorkerLaunch {
  entryUrl: URL;
  workerData: LocalAsrWorkerData;
  transferList: ArrayBuffer[];
  execArgv: string[];
}

export type LocalAsrWorkerFactory = (
  launch: LocalAsrWorkerLaunch,
) => LocalAsrWorkerLike;

export interface LocalAsrManagerOptions {
  assetRoot: string;
  workerFactory?: LocalAsrWorkerFactory;
  assetVerifier?: (root: string) => Promise<VerifiedLocalAsrAssets>;
  workerEntryUrl?: URL;
  timeoutMs?: number;
}

interface ActiveDecode {
  requestId: string;
  worker: LocalAsrWorkerLike | null;
  listeners: {
    message: WorkerListener;
    error: WorkerListener;
    exit: WorkerListener;
  } | null;
  timer: ReturnType<typeof setTimeout>;
  finalizing: boolean;
  resolve: (result: LocalAsrDecodeResult) => void;
  reject: (error: LocalAsrError) => void;
}

interface LocalAsrDecodeSnapshot {
  request: LocalAsrWorkerData['request'];
  pcm: Uint8Array;
}

export class LocalAsrManager {
  private readonly assetRoot: string;
  private readonly workerFactory: LocalAsrWorkerFactory;
  private readonly assetVerifier: (root: string) => Promise<VerifiedLocalAsrAssets>;
  private readonly workerEntryUrl: URL;
  private readonly timeoutMs: number;
  private active: ActiveDecode | null = null;
  private currentStatus: LocalAsrStatus = {
    state: 'NOT_READY',
    active: false,
    lastErrorCode: null,
  };

  constructor(options: LocalAsrManagerOptions) {
    if (!options || typeof options.assetRoot !== 'string' || options.assetRoot.length === 0) {
      throw new LocalAsrError('INVALID_REQUEST');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isFinite(timeoutMs)
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs <= 0
      || timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new LocalAsrError('INVALID_REQUEST');
    }
    this.assetRoot = options.assetRoot;
    this.assetVerifier = options.assetVerifier ?? verifyLocalAsrAssets;
    this.workerEntryUrl = options.workerEntryUrl
      ?? resolveDefaultWorkerEntryUrl(import.meta.url);
    this.timeoutMs = timeoutMs;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  status(): LocalAsrStatus {
    return { ...this.currentStatus };
  }

  async decode(request: LocalAsrDecodeRequest): Promise<LocalAsrDecodeResult> {
    if (this.active) throw new LocalAsrError('BUSY');
    const snapshot = snapshotDecodeRequest(request);
    validateDecodeSnapshot(snapshot);

    const promise = new Promise<LocalAsrDecodeResult>((resolve, reject) => {
      const message: WorkerListener = (value) => {
        void this.handleWorkerMessage(active, value);
      };
      const error: WorkerListener = () => {
        void this.finish(active, { code: 'WORKER_FAILURE' });
      };
      const exit: WorkerListener = () => {
        void this.finish(active, { code: 'WORKER_FAILURE' });
      };
      const active: ActiveDecode = {
        requestId: snapshot.request.requestId,
        worker: null,
        listeners: { message, error, exit },
        timer: setTimeout(() => {
          void this.finish(active, { code: 'TIMEOUT' });
        }, this.timeoutMs),
        finalizing: false,
        resolve,
        reject,
      };
      this.active = active;
      this.currentStatus = {
        state: 'DECODING',
        active: true,
        lastErrorCode: null,
      };
      void this.start(active, snapshot);
    });
    return promise;
  }

  async cancel(requestId: string): Promise<{ requestId: string; cancelled: boolean }> {
    if (!isUuidV4(requestId)) throw new LocalAsrError('INVALID_REQUEST');
    const active = this.active;
    if (!active || active.requestId !== requestId || active.finalizing) {
      return { requestId, cancelled: false };
    }
    await this.finish(active, { code: 'CANCELLED' });
    return { requestId, cancelled: true };
  }

  async close(): Promise<void> {
    const active = this.active;
    if (active && !active.finalizing) {
      await this.finish(active, { code: 'CANCELLED' });
    }
  }

  private async start(
    active: ActiveDecode,
    snapshot: LocalAsrDecodeSnapshot,
  ): Promise<void> {
    let assets: VerifiedLocalAsrAssets;
    try {
      assets = await this.assetVerifier(this.assetRoot);
    } catch (error) {
      const code = error instanceof LocalAsrError
        ? error.code
        : 'ASSETS_UNAVAILABLE';
      await this.finish(active, { code });
      return;
    }
    if (this.active !== active || active.finalizing) return;

    this.currentStatus = {
      state: 'AVAILABLE',
      active: true,
      lastErrorCode: null,
    };
    const pcmCopy = snapshot.pcm;
    const pcmBuffer = pcmCopy.buffer;
    if (!(pcmBuffer instanceof ArrayBuffer)) {
      await this.finish(active, { code: 'WORKER_FAILURE' });
      return;
    }
    const workerData: LocalAsrWorkerData = {
      request: snapshot.request,
      pcm: pcmBuffer,
      assetRoot: assets.root,
    };

    let worker: LocalAsrWorkerLike;
    try {
      worker = this.workerFactory({
        entryUrl: this.workerEntryUrl,
        workerData,
        transferList: [pcmBuffer],
        execArgv: ['--require', assets.noEgressPreloadPath],
      });
    } catch {
      await this.finish(active, { code: 'WORKER_FAILURE' });
      return;
    }
    if (this.active !== active || active.finalizing) {
      await Promise.resolve(worker.terminate()).catch(() => undefined);
      return;
    }

    active.worker = worker;
    const listeners = active.listeners;
    if (!listeners) {
      await this.finish(active, { code: 'WORKER_FAILURE' });
      return;
    }
    worker.on('message', listeners.message);
    worker.on('error', listeners.error);
    worker.on('exit', listeners.exit);
    this.currentStatus = {
      state: 'DECODING',
      active: true,
      lastErrorCode: null,
    };
  }

  private async handleWorkerMessage(
    active: ActiveDecode,
    value: unknown,
  ): Promise<void> {
    if (this.active !== active || active.finalizing) return;
    if (!isExactRecord(value, ['type', 'requestId', 'transcript', 'timings'])) {
      if (
        isExactRecord(value, ['type', 'requestId', 'code'])
        && value.type === 'error'
        && value.requestId === active.requestId
        && value.code === 'DECODE_FAILURE'
      ) {
        await this.finish(active, { code: 'DECODE_FAILURE' });
        return;
      }
      await this.finish(active, { code: 'INVALID_WORKER_REPLY' });
      return;
    }

    const transcript = normalizeLocalAsrTranscript(value.transcript);
    if (
      value.type !== 'result'
      || value.requestId !== active.requestId
      || !transcript
      || !isLocalAsrTimings(value.timings)
    ) {
      await this.finish(active, { code: 'INVALID_WORKER_REPLY' });
      return;
    }
    await this.finish(active, {
      result: {
        requestId: active.requestId,
        transcript,
        timings: value.timings,
      },
    });
  }

  private async finish(
    active: ActiveDecode,
    outcome: { result: LocalAsrDecodeResult } | { code: LocalAsrErrorCode },
  ): Promise<void> {
    if (this.active !== active || active.finalizing) return;
    active.finalizing = true;
    clearTimeout(active.timer);
    const worker = active.worker;
    const listeners = active.listeners;
    active.listeners = null;
    if (worker && listeners) {
      worker.off('message', listeners.message);
      worker.off('error', listeners.error);
      worker.off('exit', listeners.exit);
    }
    if (worker) {
      await Promise.resolve(worker.terminate()).catch(() => undefined);
    }
    if (this.active !== active) return;
    active.worker = null;
    this.active = null;

    if ('result' in outcome) {
      this.currentStatus = {
        state: 'READY',
        active: false,
        lastErrorCode: null,
      };
      active.resolve(outcome.result);
      return;
    }
    this.currentStatus = {
      state: outcome.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      active: false,
      lastErrorCode: outcome.code,
    };
    active.reject(new LocalAsrError(outcome.code));
  }
}

function snapshotDecodeRequest(
  request: LocalAsrDecodeRequest,
): LocalAsrDecodeSnapshot {
  if (!isExactRecord(request, REQUEST_KEYS)) {
    throw new LocalAsrError('INVALID_REQUEST');
  }
  const pcm = request.pcm;
  if (
    !(pcm instanceof Uint8Array)
    || !(pcm.buffer instanceof ArrayBuffer)
    || Object.getPrototypeOf(pcm.buffer) !== ArrayBuffer.prototype
    || pcm.byteLength === 0
    || pcm.byteLength > LOCAL_ASR_MAX_BYTE_LENGTH
    || pcm.byteLength % 2 !== 0
  ) {
    throw new LocalAsrError('INVALID_AUDIO');
  }
  return {
    request: {
      requestId: request.requestId,
      format: request.format,
      sampleRate: request.sampleRate,
      channels: request.channels,
      byteLength: request.byteLength,
      sampleCount: request.sampleCount,
      sha256: request.sha256,
    },
    pcm: Uint8Array.from(pcm),
  };
}

function validateDecodeSnapshot(snapshot: LocalAsrDecodeSnapshot): void {
  const { request, pcm } = snapshot;
  if (!isUuidV4(request.requestId)) {
    throw new LocalAsrError('INVALID_REQUEST');
  }
  if (
    request.format !== LOCAL_ASR_FORMAT
    || request.sampleRate !== LOCAL_ASR_SAMPLE_RATE
    || request.channels !== LOCAL_ASR_CHANNELS
  ) {
    throw new LocalAsrError('INVALID_AUDIO');
  }
  if (
    request.byteLength !== pcm.byteLength
    || !Number.isSafeInteger(request.byteLength)
    || request.sampleCount !== request.byteLength / 2
    || !Number.isSafeInteger(request.sampleCount)
    || request.sampleCount <= 0
    || request.sampleCount > LOCAL_ASR_MAX_SAMPLE_COUNT
    || typeof request.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(request.sha256)
  ) {
    throw new LocalAsrError('INVALID_AUDIO');
  }
  if (createHash('sha256').update(pcm).digest('hex') !== request.sha256) {
    throw new LocalAsrError('INVALID_AUDIO');
  }
}

function defaultWorkerFactory(launch: LocalAsrWorkerLaunch): LocalAsrWorkerLike {
  return new Worker(launch.entryUrl, {
    workerData: launch.workerData,
    transferList: launch.transferList,
    execArgv: launch.execArgv,
  }) as unknown as LocalAsrWorkerLike;
}

function resolveDefaultWorkerEntryUrl(moduleUrl: string): URL {
  return new URL('./local-asr-worker.js', moduleUrl);
}
