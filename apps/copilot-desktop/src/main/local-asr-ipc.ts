import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import {
  LocalAsrError,
  type LocalAsrDecodeRequest,
  type LocalAsrDecodeResult,
  type LocalAsrErrorCode,
  type LocalAsrStatus,
} from '../shared/local-asr.js';
import {
  isKnownLocalAsrErrorCode,
  localAsrIpcFailure,
  localAsrIpcSuccess,
} from '../shared/local-asr-ipc-envelope.js';

export interface LocalAsrIpcRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, payload?: unknown) => unknown,
  ): unknown;
}

export interface LocalAsrIpcRuntime {
  status(): LocalAsrStatus;
  decode(request: LocalAsrDecodeRequest): Promise<LocalAsrDecodeResult>;
  cancel(requestId: string): Promise<{ requestId: string; cancelled: boolean }>;
}

export function registerLocalAsrIpc(
  ipc: LocalAsrIpcRegistrar,
  getManager: () => LocalAsrIpcRuntime,
  isTrustedSender: (event: unknown) => boolean,
): void {
  const register = (
    channel: string,
    action: (payload: unknown) => unknown,
  ) => {
    ipc.handle(channel, async (event, payload) => {
      let trusted = false;
      try {
        trusted = isTrustedSender(event);
      } catch {
        return localAsrIpcFailure('WORKER_FAILURE');
      }
      if (!trusted) return localAsrIpcFailure('INVALID_REQUEST');
      try {
        return localAsrIpcSuccess(await action(payload));
      } catch (error) {
        return localAsrIpcFailure(stableLocalAsrCode(error));
      }
    });
  };

  register(IPC_CHANNELS.LOCAL_ASR_STATUS, (payload) => {
    assertNoPayload(payload);
    return getManager().status();
  });
  register(IPC_CHANNELS.LOCAL_ASR_DECODE, (payload) =>
    getManager().decode(payload as LocalAsrDecodeRequest));
  register(IPC_CHANNELS.LOCAL_ASR_CANCEL, (payload) =>
    getManager().cancel(payload as string));
}

function assertNoPayload(payload: unknown): void {
  if (payload !== undefined && payload !== null) {
    throw new LocalAsrError('INVALID_REQUEST');
  }
}

function stableLocalAsrCode(error: unknown): LocalAsrErrorCode {
  try {
    return error instanceof LocalAsrError
      && isKnownLocalAsrErrorCode(error.code)
      ? error.code
      : 'WORKER_FAILURE';
  } catch {
    return 'WORKER_FAILURE';
  }
}
