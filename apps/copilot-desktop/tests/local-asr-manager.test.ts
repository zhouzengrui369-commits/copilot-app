import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_ASR_CHANNELS,
  LOCAL_ASR_FORMAT,
  LOCAL_ASR_SAMPLE_RATE,
  LocalAsrError,
  type LocalAsrDecodeRequest,
} from '../src/shared/local-asr';
import {
  LocalAsrManager,
  type LocalAsrWorkerFactory,
  type LocalAsrWorkerLaunch,
  type LocalAsrWorkerLike,
} from '../src/main/local-asr-manager';
import type { VerifiedLocalAsrAssets } from '../src/main/local-asr-assets';

const assets: VerifiedLocalAsrAssets = {
  root: '/verified/local-asr',
  manifestPath: '/verified/local-asr/BUNDLE-MANIFEST.json',
  noEgressPreloadPath: '/verified/local-asr/runtime/local-asr-no-egress-preload.cjs',
  fileCount: 14,
  coveredBytes: 46_632_117,
};

class FakeWorker extends EventEmitter implements LocalAsrWorkerLike {
  terminateCount = 0;

  terminate(): Promise<number> {
    this.terminateCount += 1;
    return Promise.resolve(0);
  }
}

function createHarness(options: {
  timeoutMs?: number;
  assetVerifier?: () => Promise<VerifiedLocalAsrAssets>;
  workerFactory?: LocalAsrWorkerFactory;
} = {}): {
  manager: LocalAsrManager;
  workers: FakeWorker[];
  launches: LocalAsrWorkerLaunch[];
} {
  const workers: FakeWorker[] = [];
  const launches: LocalAsrWorkerLaunch[] = [];
  const factory: LocalAsrWorkerFactory = options.workerFactory ?? ((launch) => {
    launches.push(launch);
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const manager = new LocalAsrManager({
    assetRoot: assets.root,
    assetVerifier: options.assetVerifier ?? (async () => assets),
    workerFactory: factory,
    workerEntryUrl: new URL('file:///isolated/local-asr-worker.js'),
    timeoutMs: options.timeoutMs,
  });
  return { manager, workers, launches };
}

describe('LocalAsrManager request and worker boundary', () => {
  it.each([
    ['malformed UUID', (request: LocalAsrDecodeRequest) => ({ ...request, requestId: 'not-uuid' }), 'INVALID_REQUEST'],
    ['extra envelope key', (request: LocalAsrDecodeRequest) => ({ ...request, extra: true }), 'INVALID_REQUEST'],
    ['wrong format', (request: LocalAsrDecodeRequest) => ({ ...request, format: 'WAV' }), 'INVALID_AUDIO'],
    ['wrong sample rate', (request: LocalAsrDecodeRequest) => ({ ...request, sampleRate: 48_000 }), 'INVALID_AUDIO'],
    ['wrong channel count', (request: LocalAsrDecodeRequest) => ({ ...request, channels: 2 }), 'INVALID_AUDIO'],
    ['byte length mismatch', (request: LocalAsrDecodeRequest) => ({ ...request, byteLength: request.byteLength + 2 }), 'INVALID_AUDIO'],
    ['sample count mismatch', (request: LocalAsrDecodeRequest) => ({ ...request, sampleCount: request.sampleCount + 1 }), 'INVALID_AUDIO'],
    ['digest mismatch', (request: LocalAsrDecodeRequest) => ({ ...request, sha256: '0'.repeat(64) }), 'INVALID_AUDIO'],
    ['odd PCM length', () => requestFor(new Uint8Array([0])), 'INVALID_AUDIO'],
    ['empty PCM', () => requestFor(new Uint8Array()), 'INVALID_AUDIO'],
  ])('rejects %s before Worker construction', async (_label, mutate, code) => {
    const harness = createHarness();
    const request = mutate(validRequest()) as LocalAsrDecodeRequest;
    await expect(harness.manager.decode(request)).rejects.toMatchObject({ code });
    expect(harness.workers).toHaveLength(0);
    expect(harness.manager.status()).toEqual({
      state: 'NOT_READY',
      active: false,
      lastErrorCode: null,
    });
  });

  it('rejects PCM backed by shared memory before Worker construction', async () => {
    const pcm = new Uint8Array(new SharedArrayBuffer(4));
    const harness = createHarness();
    await expect(harness.manager.decode(requestFor(pcm))).rejects.toMatchObject({
      code: 'INVALID_AUDIO',
    });
    expect(harness.workers).toHaveLength(0);
  });

  it('rejects the maximum-byte overflow before Worker construction', async () => {
    const harness = createHarness();
    const request = requestFor(new Uint8Array(1_920_002));
    await expect(harness.manager.decode(request)).rejects.toMatchObject({
      code: 'INVALID_AUDIO',
    });
    expect(harness.workers).toHaveLength(0);
  });

  it('reserves the single slot during asset verification and fails closed busy', async () => {
    let releaseAssets: ((value: VerifiedLocalAsrAssets) => void) | undefined;
    const assetVerifier = () => new Promise<VerifiedLocalAsrAssets>((resolve) => {
      releaseAssets = resolve;
    });
    const harness = createHarness({ assetVerifier });
    const first = validRequest();
    const firstOutcome = harness.manager.decode(first).catch((error: unknown) => error);
    await expect(harness.manager.decode(validRequest())).rejects.toMatchObject({
      code: 'BUSY',
    });
    const cancelled = await harness.manager.cancel(first.requestId);
    expect(cancelled).toEqual({ requestId: first.requestId, cancelled: true });
    expect(await firstOutcome).toMatchObject({ code: 'CANCELLED' });
    releaseAssets?.(assets);
    await Promise.resolve();
    expect(harness.workers).toHaveLength(0);
  });

  it('passes only validated metadata, copied PCM, exact root, and no-egress preload', async () => {
    const harness = createHarness();
    const request = validRequest();
    const originalByteLength = request.pcm.byteLength;
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    expect(harness.launches).toHaveLength(1);
    const launch = harness.launches[0];
    expect(launch.execArgv).toEqual(['--require', assets.noEgressPreloadPath]);
    expect(launch.workerData.assetRoot).toBe(assets.root);
    expect(launch.workerData.request).toEqual({
      requestId: request.requestId,
      format: request.format,
      sampleRate: request.sampleRate,
      channels: request.channels,
      byteLength: request.byteLength,
      sampleCount: request.sampleCount,
      sha256: request.sha256,
    });
    expect(launch.workerData.pcm).not.toBe(request.pcm.buffer);
    expect(new Uint8Array(launch.workerData.pcm)).toEqual(request.pcm);
    expect(request.pcm.byteLength).toBe(originalByteLength);

    worker.emit('message', {
      type: 'result',
      requestId: request.requestId,
      transcript: '  本地   语音  ',
      timings: { decodeMs: 12, totalMs: 20 },
    });
    await expect(pending).resolves.toEqual({
      requestId: request.requestId,
      transcript: '本地 语音',
      timings: { decodeMs: 12, totalMs: 20 },
    });
    expect(harness.manager.status()).toEqual({
      state: 'READY',
      active: false,
      lastErrorCode: null,
    });
    expect(worker.terminateCount).toBe(1);
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('snapshots the validated request before deferred asset verification', async () => {
    let releaseAssets: ((value: VerifiedLocalAsrAssets) => void) | undefined;
    const assetVerifier = () => new Promise<VerifiedLocalAsrAssets>((resolve) => {
      releaseAssets = resolve;
    });
    const harness = createHarness({ assetVerifier });
    const request = validRequest(new Uint8Array([1, 0, 2, 0]));
    const original = {
      requestId: request.requestId,
      format: request.format,
      sampleRate: request.sampleRate,
      channels: request.channels,
      byteLength: request.byteLength,
      sampleCount: request.sampleCount,
      sha256: request.sha256,
      pcm: Uint8Array.from(request.pcm),
    };

    const pending = harness.manager.decode(request);
    Object.assign(request as unknown as Record<string, unknown>, {
      requestId: randomUUID(),
      format: 'WAV',
      sampleRate: 48_000,
      channels: 2,
      byteLength: 2,
      sampleCount: 1,
      sha256: '0'.repeat(64),
    });
    request.pcm.fill(255);
    releaseAssets?.(assets);

    const worker = await waitForWorker(harness.workers);
    const launch = harness.launches[0];
    expect(launch?.workerData.request).toEqual({
      requestId: original.requestId,
      format: original.format,
      sampleRate: original.sampleRate,
      channels: original.channels,
      byteLength: original.byteLength,
      sampleCount: original.sampleCount,
      sha256: original.sha256,
    });
    expect(new Uint8Array(launch?.workerData.pcm ?? new ArrayBuffer(0)))
      .toEqual(original.pcm);

    worker.emit('message', {
      type: 'result',
      requestId: original.requestId,
      transcript: '同步快照',
      timings: { decodeMs: 1, totalMs: 2 },
    });
    await expect(pending).resolves.toMatchObject({
      requestId: original.requestId,
      transcript: '同步快照',
    });
  });

  it.each([
    ['empty transcript', (requestId: string) => ({
      type: 'result',
      requestId,
      transcript: '   ',
      timings: { decodeMs: 1, totalMs: 2 },
    })],
    ['wrong request ID', () => ({
      type: 'result',
      requestId: randomUUID(),
      transcript: 'text',
      timings: { decodeMs: 1, totalMs: 2 },
    })],
    ['invalid timing', (requestId: string) => ({
      type: 'result',
      requestId,
      transcript: 'text',
      timings: { decodeMs: 3, totalMs: 2 },
    })],
    ['extra reply key', (requestId: string) => ({
      type: 'result',
      requestId,
      transcript: 'text',
      timings: { decodeMs: 1, totalMs: 2 },
      extra: true,
    })],
    ['unknown reply', () => ({ type: 'unknown' })],
  ])('rejects %s as an invalid worker reply', async (_label, reply) => {
    const harness = createHarness();
    const request = validRequest();
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    worker.emit('message', reply(request.requestId));
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_WORKER_REPLY' });
    expect(worker.terminateCount).toBe(1);
    expect(harness.manager.status()).toMatchObject({
      state: 'FAILED',
      active: false,
      lastErrorCode: 'INVALID_WORKER_REPLY',
    });
  });

  it('maps the schema-valid decode failure terminal without raw details', async () => {
    const harness = createHarness();
    const request = validRequest();
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    worker.emit('message', {
      type: 'error',
      requestId: request.requestId,
      code: 'DECODE_FAILURE',
    });
    await expect(pending).rejects.toEqual(new LocalAsrError('DECODE_FAILURE'));
    expect(harness.manager.status()).toMatchObject({
      state: 'FAILED',
      lastErrorCode: 'DECODE_FAILURE',
    });
  });

  it('settles once and ignores a duplicate terminal', async () => {
    const harness = createHarness();
    const request = validRequest();
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    const terminal = {
      type: 'result',
      requestId: request.requestId,
      transcript: '唯一结果',
      timings: { decodeMs: 2, totalMs: 3 },
    };
    worker.emit('message', terminal);
    worker.emit('message', terminal);
    await expect(pending).resolves.toMatchObject({ transcript: '唯一结果' });
    expect(worker.terminateCount).toBe(1);
  });

  it.each(['error', 'exit'])('maps an early Worker %s event and cleans up', async (event) => {
    const harness = createHarness();
    const request = validRequest();
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    worker.emit(event, event === 'exit' ? 7 : new Error('secret raw worker error'));
    await expect(pending).rejects.toMatchObject({ code: 'WORKER_FAILURE' });
    expect(worker.terminateCount).toBe(1);
    expect(JSON.stringify(harness.manager.status())).not.toContain('secret');
  });

  it('fails closed when Worker construction or asset verification fails', async () => {
    const construction = createHarness({
      workerFactory: () => {
        throw new Error('constructor secret');
      },
    });
    await expect(construction.manager.decode(validRequest())).rejects.toMatchObject({
      code: 'WORKER_FAILURE',
    });
    expect(JSON.stringify(construction.manager.status())).not.toContain('constructor secret');

    const verification = createHarness({
      assetVerifier: async () => {
        throw new LocalAsrError('ASSETS_TAMPERED');
      },
    });
    await expect(verification.manager.decode(validRequest())).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });
    expect(verification.workers).toHaveLength(0);
  });

  it('terminates on timeout and leaves no active Worker', async () => {
    const harness = createHarness({ timeoutMs: 10 });
    const outcome = harness.manager.decode(validRequest()).catch((error: unknown) => error);
    const worker = await waitForWorker(harness.workers);
    expect(await outcome).toMatchObject({ code: 'TIMEOUT' });
    expect(worker.terminateCount).toBe(1);
    expect(harness.manager.status()).toEqual({
      state: 'FAILED',
      active: false,
      lastErrorCode: 'TIMEOUT',
    });
  });

  it('cancels only the matching active request and cleans every listener', async () => {
    const harness = createHarness();
    const request = validRequest();
    const pending = harness.manager.decode(request);
    const outcome = pending.catch((error: unknown) => error);
    const worker = await waitForWorker(harness.workers);
    await expect(harness.manager.cancel(randomUUID())).resolves.toMatchObject({
      cancelled: false,
    });
    await expect(harness.manager.cancel(request.requestId)).resolves.toEqual({
      requestId: request.requestId,
      cancelled: true,
    });
    expect(await outcome).toMatchObject({ code: 'CANCELLED' });
    expect(worker.terminateCount).toBe(1);
    expect(worker.eventNames()).toEqual([]);
    expect(harness.manager.status()).toEqual({
      state: 'CANCELLED',
      active: false,
      lastErrorCode: 'CANCELLED',
    });
  });

  it('retains no transcript, audio, user path, Authorization, or secret in public status', async () => {
    const harness = createHarness();
    const request = validRequest(new Uint8Array([83, 69, 67, 82]));
    const pending = harness.manager.decode(request);
    const worker = await waitForWorker(harness.workers);
    worker.emit('message', {
      type: 'result',
      requestId: request.requestId,
      transcript: 'TOP SECRET transcript',
      timings: { decodeMs: 1, totalMs: 1 },
    });
    await pending;
    const publicStatus = JSON.stringify(harness.manager.status());
    for (const forbidden of [
      'TOP SECRET',
      'SECR',
      '/verified/local-asr',
      'Authorization',
      'Bearer',
    ]) {
      expect(publicStatus).not.toContain(forbidden);
    }
    expect(Object.keys(harness.manager.status()).sort()).toEqual([
      'active',
      'lastErrorCode',
      'state',
    ]);
  });
});

function validRequest(pcm = new Uint8Array([0, 0, 1, 0])): LocalAsrDecodeRequest {
  return requestFor(pcm);
}

function requestFor(pcm: Uint8Array): LocalAsrDecodeRequest {
  return {
    requestId: randomUUID(),
    format: LOCAL_ASR_FORMAT,
    sampleRate: LOCAL_ASR_SAMPLE_RATE,
    channels: LOCAL_ASR_CHANNELS,
    byteLength: pcm.byteLength,
    sampleCount: pcm.byteLength / 2,
    sha256: createHash('sha256').update(pcm).digest('hex'),
    pcm,
  };
}

async function waitForWorker(workers: FakeWorker[]): Promise<FakeWorker> {
  await vi.waitFor(() => {
    expect(workers).toHaveLength(1);
  });
  const worker = workers[0];
  if (!worker) throw new Error('fake worker was not constructed');
  return worker;
}
