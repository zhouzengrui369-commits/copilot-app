import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import {
  LocalAsrError,
  type LocalAsrDecodeRequest,
  type LocalAsrStatus,
} from '../src/shared/local-asr';
import {
  LOCAL_ASR_ERROR_CODES,
  isExactLocalAsrIpcEnvelope,
} from '../src/shared/local-asr-ipc-envelope';
import {
  registerLocalAsrIpc,
  type LocalAsrIpcRuntime,
} from '../src/main/local-asr-ipc';

type Handler = (event: unknown, payload?: unknown) => unknown;

function createRegistrar(): {
  handlers: Map<string, Handler>;
  handle: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const handle = vi.fn((channel: string, listener: Handler) => {
    handlers.set(channel, listener);
  });
  return { handlers, handle };
}

function createRuntime(): LocalAsrIpcRuntime {
  return {
    status: vi.fn((): LocalAsrStatus => ({
      state: 'NOT_READY',
      active: false,
      lastErrorCode: null,
    })),
    decode: vi.fn(async (request) => ({
      requestId: request.requestId,
      transcript: '本地语音',
      timings: { decodeMs: 1, totalMs: 2 },
    })),
    cancel: vi.fn(async (requestId) => ({ requestId, cancelled: true })),
  };
}

function request(): LocalAsrDecodeRequest {
  return {
    requestId: randomUUID(),
    format: 'PCM16LE',
    sampleRate: 16_000,
    channels: 1,
    byteLength: 4,
    sampleCount: 2,
    sha256: 'a'.repeat(64),
    pcm: new Uint8Array([0, 0, 1, 0]),
  };
}

function handler(
  handlers: Map<string, Handler>,
  channel: string,
): Handler {
  const registered = handlers.get(channel);
  if (!registered) throw new Error(`missing test handler: ${channel}`);
  return registered;
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('local ASR sender-bound IPC', () => {
  let registrar: ReturnType<typeof createRegistrar>;
  let runtime: LocalAsrIpcRuntime;
  let getManager: ReturnType<typeof vi.fn>;
  const trustedEvent = { sender: { id: 7 } };

  beforeEach(() => {
    registrar = createRegistrar();
    runtime = createRuntime();
    getManager = vi.fn(() => runtime);
    registerLocalAsrIpc(
      registrar,
      getManager,
      (event) => event === trustedEvent,
    );
  });

  it('registers exactly the three local ASR channels', () => {
    expect([...registrar.handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.LOCAL_ASR_CANCEL,
      IPC_CHANNELS.LOCAL_ASR_DECODE,
      IPC_CHANNELS.LOCAL_ASR_STATUS,
    ].sort());
    expect(getManager).not.toHaveBeenCalled();
  });

  it('keeps initial status fail-closed and creates the manager lazily', async () => {
    const status = handler(
      registrar.handlers,
      IPC_CHANNELS.LOCAL_ASR_STATUS,
    );
    const serialized = jsonRoundTrip(await status(trustedEvent));
    expect(serialized).toEqual({
      ok: true,
      value: {
        state: 'NOT_READY',
        active: false,
        lastErrorCode: null,
      },
    });
    expect(isExactLocalAsrIpcEnvelope(serialized)).toBe(true);
    expect(getManager).toHaveBeenCalledTimes(1);
    expect(runtime.status).toHaveBeenCalledTimes(1);
  });

  it('rejects untrusted senders before manager creation for every channel', async () => {
    const attempts: Array<[string, unknown]> = [
      [IPC_CHANNELS.LOCAL_ASR_STATUS, undefined],
      [IPC_CHANNELS.LOCAL_ASR_DECODE, request()],
      [IPC_CHANNELS.LOCAL_ASR_CANCEL, randomUUID()],
    ];
    for (const [channel, payload] of attempts) {
      const serialized = jsonRoundTrip(
        await handler(registrar.handlers, channel)({}, payload),
      );
      expect(serialized).toEqual({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
        },
      });
      expect(isExactLocalAsrIpcEnvelope(serialized)).toBe(true);
    }
    expect(getManager).not.toHaveBeenCalled();
  });

  it('forwards the exact decode and cancel payloads', async () => {
    const decodeRequest = request();
    await expect(handler(
      registrar.handlers,
      IPC_CHANNELS.LOCAL_ASR_DECODE,
    )(trustedEvent, decodeRequest)).resolves.toEqual({
      ok: true,
      value: {
        requestId: decodeRequest.requestId,
        transcript: '本地语音',
        timings: { decodeMs: 1, totalMs: 2 },
      },
    });
    await expect(handler(
      registrar.handlers,
      IPC_CHANNELS.LOCAL_ASR_CANCEL,
    )(trustedEvent, decodeRequest.requestId)).resolves.toEqual({
      ok: true,
      value: {
        requestId: decodeRequest.requestId,
        cancelled: true,
      },
    });
    expect(runtime.decode).toHaveBeenCalledWith(decodeRequest);
    expect(runtime.cancel).toHaveBeenCalledWith(decodeRequest.requestId);
  });

  it('rejects a status payload before lazy manager creation', async () => {
    await expect(handler(
      registrar.handlers,
      IPC_CHANNELS.LOCAL_ASR_STATUS,
    )(trustedEvent, { probe: true })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(getManager).not.toHaveBeenCalled();
  });

  it('serializes every known code as code-only exact plain data', async () => {
    const decode = handler(registrar.handlers, IPC_CHANNELS.LOCAL_ASR_DECODE);
    for (const code of LOCAL_ASR_ERROR_CODES) {
      runtime.decode = vi.fn(async () => {
        throw new LocalAsrError(code);
      });
      const serialized = jsonRoundTrip(await decode(trustedEvent, request()));
      expect(serialized).toEqual({ ok: false, error: { code } });
      expect(isExactLocalAsrIpcEnvelope(serialized)).toBe(true);
      expect(Object.getPrototypeOf(serialized as object)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(
        (serialized as { error: object }).error,
      )).toBe(Object.prototype);
    }
  });

  it('maps unknown raw failures to code-only WORKER_FAILURE', async () => {
    runtime.cancel = vi.fn(async () => {
      throw new Error('secret transcript /Users/private Authorization: Bearer token');
    });
    const cancel = handler(registrar.handlers, IPC_CHANNELS.LOCAL_ASR_CANCEL);
    const serialized = jsonRoundTrip(
      await cancel(trustedEvent, randomUUID()),
    );
    expect(serialized).toEqual({
      ok: false,
      error: { code: 'WORKER_FAILURE' },
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /Users|Authorization|Bearer|transcript|token/u,
    );
  });
});
